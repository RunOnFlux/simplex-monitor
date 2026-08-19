import { execFile } from 'node:child_process';
import { promises as dns } from 'node:dns';
import fs from 'node:fs';
import path from 'node:path';
import { appConfig } from '../lib/config';
import type { ProbeResult, ServerConfig, Transport } from '../lib/types';

/**
 * Builds the SimpleX server address probed for a given transport. Address
 * validation in SimpleX clients is fingerprint-based (not CA/hostname), so
 * dialing a resolved IP literal is a valid way to force the address family.
 */
export function buildAddress(server: ServerConfig, transport: Transport, ip?: string): string {
  const scheme = server.kind === 'smp' ? 'smp' : 'xftp';
  switch (transport) {
    case 'ipv4':
      return `${scheme}://${server.fingerprint}@${ip}:${server.port}`;
    case 'ipv6':
      return `${scheme}://${server.fingerprint}@[${ip}]:${server.port}`;
    case 'tor':
      return `${scheme}://${server.fingerprint}@${server.onion}`;
  }
}

export async function resolveHost(host: string, transport: Transport): Promise<string | null> {
  try {
    if (transport === 'ipv4') {
      const addrs = await dns.resolve4(host);
      return addrs[0] ?? null;
    }
    if (transport === 'ipv6') {
      const addrs = await dns.resolve6(host);
      return addrs[0] ?? null;
    }
    return null;
  } catch {
    return null;
  }
}

function profileDbPath(transport: Transport): string {
  return path.join(path.resolve(appConfig.prober.probeDbDir), `probe_${transport}`);
}

function profileExists(dbPath: string): boolean {
  return fs.existsSync(`${dbPath}_chat.db`) || fs.existsSync(`${dbPath}.chat.db`);
}

function tmpDirFor(transport: Transport): string {
  return path.join(path.resolve(appConfig.prober.probeDbDir), `tmp_${transport}`);
}

interface CliRun {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runCli(args: string[], transport: Transport, stdin?: string): Promise<CliRun> {
  const tmpDir = tmpDirFor(transport);
  fs.mkdirSync(tmpDir, { recursive: true });
  return new Promise((resolve) => {
    const child = execFile(
      appConfig.prober.simplexChatBin,
      args,
      {
        timeout: appConfig.prober.timeoutSec * 1000,
        maxBuffer: 4 * 1024 * 1024,
        // xftp tests write temp chunks; give the CLI a private tmp dir we can wipe
        env: { ...process.env, TMPDIR: tmpDir },
      },
      (error, stdout, stderr) => {
        const killed = error !== null && (error as { killed?: boolean }).killed === true;
        resolve({ code: error ? (child.exitCode ?? 1) : 0, stdout, stderr, timedOut: killed });
      },
    );
    if (stdin !== undefined && child.stdin) {
      child.stdin.write(stdin);
      child.stdin.end();
    }
  });
}

function cleanTmp(transport: Transport): void {
  const tmpDir = tmpDirFor(transport);
  try {
    for (const f of fs.readdirSync(tmpDir)) {
      fs.rmSync(path.join(tmpDir, f), { recursive: true, force: true });
    }
  } catch {
    // tmp dir may not exist yet
  }
}

/**
 * Creates the simplex-chat profile database for a transport lane if missing.
 * First run of the CLI asks for a display name on stdin.
 */
export async function ensureProfile(transport: Transport): Promise<void> {
  const dbPath = profileDbPath(transport);
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  if (profileExists(dbPath)) return;
  await runCli(['-d', dbPath, '-t', '0', '-e', '/version'], transport, 'monitor\n');
  if (!profileExists(dbPath)) {
    throw new Error(
      `Could not create simplex-chat profile at ${dbPath} - run manually: ${appConfig.prober.simplexChatBin} -d ${dbPath}`,
    );
  }
}

export async function probeServer(
  server: ServerConfig,
  transport: Transport,
): Promise<ProbeResult> {
  const ts = Date.now();
  let ip: string | undefined;
  if (transport !== 'tor') {
    const resolved = await resolveHost(server.host, transport);
    if (!resolved) {
      return {
        serverId: server.id,
        transport,
        ts,
        ok: false,
        latencyMs: null,
        error: `DNS: no ${transport === 'ipv4' ? 'A' : 'AAAA'} record for ${server.host}`,
      };
    }
    ip = resolved;
  }
  const address = buildAddress(server, transport, ip);
  const args = ['--tcp-timeout', '15', '-t', '0', '-d', profileDbPath(transport)];
  if (transport === 'tor') {
    args.push('--socks-proxy', appConfig.prober.torSocks);
  }
  args.push('-e', `/_server test 1 ${address}`);

  const start = Date.now();
  const run = await runCli(args, transport);
  const latencyMs = Date.now() - start;
  if (server.kind === 'xftp') cleanTmp(transport);

  if (run.stdout.includes('passed')) {
    return { serverId: server.id, transport, ts, ok: true, latencyMs, error: null };
  }
  if (run.timedOut) {
    return {
      serverId: server.id,
      transport,
      ts,
      ok: false,
      latencyMs: null,
      error: `timeout after ${appConfig.prober.timeoutSec}s`,
    };
  }
  const detail =
    run.stdout
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-1)[0] ?? run.stderr.trim().slice(0, 200);
  return {
    serverId: server.id,
    transport,
    ts,
    ok: false,
    latencyMs: null,
    error: detail || `simplex-chat exited with code ${run.code}`,
  };
}
