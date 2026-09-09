import { execFile } from 'node:child_process';
import { appConfig } from './config';
import type { ServerConfig } from './types';

export type SshAction = 'restart' | 'status' | 'logs' | 'restart-tor' | 'status-tor';

export interface LogOptions {
  /** journalctl --since, already normalised to `YYYY-MM-DD HH:MM:SS UTC`. */
  since?: string;
  /** journalctl --until, same format. */
  until?: string;
  /** journalctl -n, 1..LOG_MAX_LINES. */
  lines?: number;
}

export const LOG_DEFAULT_LINES = 200;
export const LOG_MAX_LINES = 20000;

/** Only ever produced by normaliseTimestamp(), never taken from user input. */
const TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2} UTC$/;

/**
 * Accepts an ISO-8601 instant (what the dashboard sends) and re-formats it as a
 * journalctl UTC timestamp. Returning a value we build ourselves — rather than
 * passing the input through — keeps arbitrary text out of the remote command.
 */
export function normaliseTimestamp(value: string): string | null {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const iso = date.toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

/** ssh concatenates its command arguments, so quote each one for the remote shell. */
function shellQuote(arg: string): string {
  return `'${arg.replaceAll("'", `'\\''`)}'`;
}

function unitName(server: ServerConfig): string {
  return server.kind === 'smp' ? 'smp-server' : 'xftp-server';
}

/**
 * The remote command for each action. On the VM side the smmonitor user is
 * restricted (sudoers + authorized_keys) to exactly these commands — see
 * deploy/vm-setup.sh. Never interpolate user input here.
 */
function remoteCommand(server: ServerConfig, action: SshAction, logs?: LogOptions): string[] {
  const unit = unitName(server);
  switch (action) {
    case 'restart':
      return ['sudo', 'systemctl', 'restart', `${unit}.service`];
    case 'restart-tor':
      return ['sudo', 'systemctl', 'restart', 'tor.service'];
    case 'status':
      return ['systemctl', 'is-active', `${unit}.service`];
    case 'status-tor':
      return ['systemctl', 'is-active', 'tor.service'];
    case 'logs': {
      const lines = clampLines(logs?.lines);
      const cmd = ['journalctl', '-u', `${unit}.service`, '--no-pager', '-o', 'short-iso'];
      // Without a window journalctl would dump the whole journal, so a line cap
      // always applies; with a window the cap still bounds the response size.
      cmd.push('-n', String(lines));
      if (logs?.since && TIMESTAMP_RE.test(logs.since)) cmd.push('--since', logs.since);
      if (logs?.until && TIMESTAMP_RE.test(logs.until)) cmd.push('--until', logs.until);
      return cmd;
    }
  }
}

function clampLines(lines: number | undefined): number {
  if (!lines || !Number.isFinite(lines)) return LOG_DEFAULT_LINES;
  return Math.min(Math.max(Math.trunc(lines), 1), LOG_MAX_LINES);
}

export interface SshResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

export function runSsh(
  server: ServerConfig,
  action: SshAction,
  logs?: LogOptions,
): Promise<SshResult> {
  const { keyPath, timeoutSec: baseTimeout } = appConfig.ssh;
  // systemctl restart blocks until the unit is fully up; the xftp units wait
  // for Postgres in ExecStartPre, so restarts need far more headroom than
  // status checks or journal reads.
  const timeoutSec =
    action === 'restart' || action === 'restart-tor'
      ? Math.max(baseTimeout, 75)
      : // A wide --since/--until window makes journalctl walk a lot of journal.
        action === 'logs'
        ? Math.max(baseTimeout, 60)
        : baseTimeout;
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'StrictHostKeyChecking=accept-new',
    '-o',
    `ConnectTimeout=${Math.min(timeoutSec, 10)}`,
    '-p',
    String(server.ssh.port),
  ];
  if (keyPath) args.push('-i', keyPath);
  args.push(
    `${server.ssh.user}@${server.ssh.host}`,
    '--',
    ...remoteCommand(server, action, logs).map(shellQuote),
  );

  return new Promise((resolve) => {
    execFile(
      'ssh',
      args,
      { timeout: timeoutSec * 1000, maxBuffer: 32 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({ ok: error === null, stdout: stdout.trim(), stderr: stderr.trim() });
      },
    );
  });
}
