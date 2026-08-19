import { appConfig, loadServers } from '../lib/config';
import {
  bumpIncidentFailCount,
  closeIncident,
  getOpenIncident,
  getRecentFails,
  insertProbe,
  openIncident,
  pruneProbes,
  upsertCert,
} from '../lib/db';
import { nextIncidentAction, transportLabel, type IncidentState } from '../lib/incidents';
import { sendAlertEmail } from '../lib/mailer';
import { TRANSPORTS, type ProbeResult, type ServerConfig, type Transport } from '../lib/types';
import { certDaysLeft } from '../lib/uptime';
import { checkCert } from './certs';
import { ensureProfile, probeServer } from './probe';

const log = (msg: string) => console.log(`${new Date().toISOString()} ${msg}`);

const states = new Map<string, IncidentState>();
const certWarned = new Map<string, number>();

function stateKey(serverId: string, transport: Transport): string {
  return `${serverId}/${transport}`;
}

/** Rebuild in-memory incident state from the database after a restart. */
function initStates(servers: ServerConfig[]): void {
  const threshold = appConfig.prober.failThreshold;
  for (const server of servers) {
    for (const transport of TRANSPORTS) {
      const open = getOpenIncident(server.id, transport);
      const recent = getRecentFails(server.id, transport, threshold);
      let consecutiveFails = 0;
      for (const row of recent) {
        if (row.ok === 0) consecutiveFails += 1;
        else break;
      }
      states.set(stateKey(server.id, transport), {
        consecutiveFails,
        openIncidentId: open ? open.id : null,
      });
    }
  }
}

async function handleResult(server: ServerConfig, result: ProbeResult): Promise<void> {
  insertProbe(result);
  const key = stateKey(server.id, result.transport);
  const prev = states.get(key) ?? { consecutiveFails: 0, openIncidentId: null };
  const { state, action } = nextIncidentAction(prev, result.ok, appConfig.prober.failThreshold);
  const label = transportLabel(result.transport);

  if (action.type === 'open') {
    const id = openIncident(server.id, result.transport, result.ts, action.failCount);
    state.openIncidentId = id;
    log(`INCIDENT OPEN ${server.name} ${label}: ${result.error ?? 'down'}`);
    try {
      await sendAlertEmail(
        `[simplex-monitor] DOWN: ${server.name} (${label})`,
        `${server.name} is failing checks over ${label}.\n\nLast error: ${result.error ?? 'unknown'}\nConsecutive failures: ${action.failCount}\nTime: ${new Date(result.ts).toISOString()}\n\nDashboard: check the fleet page for details.`,
      );
    } catch (err) {
      log(`ALERT EMAIL FAILED: ${(err as Error).message}`);
    }
  } else if (action.type === 'bump' && prev.openIncidentId !== null) {
    bumpIncidentFailCount(prev.openIncidentId);
  } else if (action.type === 'close' && prev.openIncidentId !== null) {
    closeIncident(prev.openIncidentId, result.ts);
    log(`INCIDENT CLOSED ${server.name} ${label}`);
    try {
      await sendAlertEmail(
        `[simplex-monitor] RECOVERED: ${server.name} (${label})`,
        `${server.name} is passing checks again over ${label}.\nTime: ${new Date(result.ts).toISOString()}`,
      );
    } catch (err) {
      log(`ALERT EMAIL FAILED: ${(err as Error).message}`);
    }
  }
  states.set(key, state);
}

/** One transport lane: probes every server sequentially (each lane has its own CLI profile db). */
async function runLane(servers: ServerConfig[], transport: Transport): Promise<void> {
  for (const server of servers) {
    try {
      const result = await probeServer(server, transport);
      await handleResult(server, result);
      log(
        `probe ${server.id} ${transport}: ${result.ok ? `ok ${result.latencyMs}ms` : `FAIL ${result.error}`}`,
      );
    } catch (err) {
      log(`probe ${server.id} ${transport} crashed: ${(err as Error).message}`);
    }
  }
}

async function probeCycle(servers: ServerConfig[]): Promise<void> {
  const lanes: Transport[] = appConfig.prober.ipv6Enabled
    ? ['ipv4', 'ipv6', 'tor']
    : ['ipv4', 'tor'];
  await Promise.all(lanes.map((t) => runLane(servers, t)));
  const cutoff = Date.now() - appConfig.prober.retentionDays * 24 * 60 * 60 * 1000;
  const pruned = pruneProbes(cutoff);
  if (pruned > 0) log(`pruned ${pruned} old probe rows`);
}

async function certCycle(servers: ServerConfig[]): Promise<void> {
  const now = Date.now();
  for (const server of servers) {
    const check = await checkCert(server);
    upsertCert({
      server_id: server.id,
      checked_at: now,
      not_after: check.notAfter,
      issuer: check.issuer,
      error: check.error,
    });
    const days = certDaysLeft(check.notAfter, now);
    if (days !== null && days < appConfig.prober.certWarnDays) {
      const lastWarn = certWarned.get(server.id) ?? 0;
      if (now - lastWarn > 24 * 60 * 60 * 1000) {
        certWarned.set(server.id, now);
        log(`CERT WARNING ${server.name}: ${days} days left`);
        try {
          await sendAlertEmail(
            `[simplex-monitor] TLS certificate expiring: ${server.name}`,
            `The TLS certificate for ${server.name} expires in ${days} day(s) (${new Date(check.notAfter ?? 0).toISOString()}).\nRotate it before it expires.`,
          );
        } catch (err) {
          log(`ALERT EMAIL FAILED: ${(err as Error).message}`);
        }
      }
    }
  }
}

async function main(): Promise<void> {
  const servers = loadServers();
  log(
    `simplex-monitor prober starting: ${servers.length} servers, interval ${appConfig.prober.intervalSec}s`,
  );

  const lanes: Transport[] = appConfig.prober.ipv6Enabled
    ? ['ipv4', 'ipv6', 'tor']
    : ['ipv4', 'tor'];
  for (const t of lanes) {
    await ensureProfile(t);
  }
  initStates(servers);

  let running = true;
  const stop = () => {
    log('shutting down');
    running = false;
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  let lastCertCheck = 0;
  while (running) {
    const cycleStart = Date.now();
    try {
      await probeCycle(servers);
    } catch (err) {
      log(`probe cycle failed: ${(err as Error).message}`);
    }
    if (Date.now() - lastCertCheck > 24 * 60 * 60 * 1000) {
      lastCertCheck = Date.now();
      try {
        await certCycle(servers);
      } catch (err) {
        log(`cert cycle failed: ${(err as Error).message}`);
      }
    }
    const elapsed = Date.now() - cycleStart;
    const waitMs = Math.max(0, appConfig.prober.intervalSec * 1000 - elapsed);
    await new Promise((resolve) => setTimeout(resolve, waitMs));
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
