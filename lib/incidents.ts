import type { Transport } from './types';

export interface IncidentState {
  /** consecutive failures seen so far (before this probe) */
  consecutiveFails: number;
  /** timestamp of the first failure in the current streak */
  firstFailTs: number | null;
  /** id of the currently open incident, if any */
  openIncidentId: number | null;
  /** whether a DOWN email has already gone out for the open incident */
  alerted: boolean;
}

export type IncidentAction =
  { type: 'none' } | { type: 'open'; failCount: number } | { type: 'bump' } | { type: 'close' };

export interface IncidentOptions {
  /** consecutive failed checks before an incident is recorded */
  failThreshold: number;
  /** how long failures must persist before a DOWN email is sent */
  alertAfterMs: number;
}

export interface IncidentDecision {
  state: IncidentState;
  action: IncidentAction;
  /** send the DOWN email now */
  alertDown: boolean;
  /** send the RECOVERED email now (only when a DOWN email went out earlier) */
  alertRecovered: boolean;
}

export const freshIncidentState: IncidentState = {
  consecutiveFails: 0,
  firstFailTs: null,
  openIncidentId: null,
  alerted: false,
};

/**
 * Pure incident state machine. Given the previous state for a (server, transport)
 * pair and a new probe outcome, decide what to do.
 *
 * An incident is *recorded* after `failThreshold` consecutive failed checks, but
 * the DOWN email is held back until the failures have persisted for
 * `alertAfterMs` — a server that fails a couple of checks and comes straight
 * back never generates mail. Incidents close on the first success; the RECOVERED
 * email is only sent if a DOWN email was actually sent.
 */
export function nextIncidentAction(
  state: IncidentState,
  probeOk: boolean,
  ts: number,
  opts: IncidentOptions,
): IncidentDecision {
  if (probeOk) {
    if (state.openIncidentId !== null) {
      return {
        state: { ...freshIncidentState },
        action: { type: 'close' },
        alertDown: false,
        alertRecovered: state.alerted,
      };
    }
    return {
      state: { ...freshIncidentState },
      action: { type: 'none' },
      alertDown: false,
      alertRecovered: false,
    };
  }

  const fails = state.consecutiveFails + 1;
  const firstFailTs = state.firstFailTs ?? ts;
  const downLongEnough = ts - firstFailTs >= opts.alertAfterMs;

  if (state.openIncidentId !== null) {
    const alertDown = !state.alerted && downLongEnough;
    return {
      state: {
        consecutiveFails: fails,
        firstFailTs,
        openIncidentId: state.openIncidentId,
        alerted: state.alerted || alertDown,
      },
      action: { type: 'bump' },
      alertDown,
      alertRecovered: false,
    };
  }

  if (fails >= opts.failThreshold) {
    return {
      state: {
        consecutiveFails: fails,
        firstFailTs,
        openIncidentId: -1, // caller replaces -1 with the real id
        alerted: downLongEnough,
      },
      action: { type: 'open', failCount: fails },
      alertDown: downLongEnough,
      alertRecovered: false,
    };
  }

  return {
    state: { consecutiveFails: fails, firstFailTs, openIncidentId: null, alerted: false },
    action: { type: 'none' },
    alertDown: false,
    alertRecovered: false,
  };
}

export function transportLabel(t: Transport): string {
  switch (t) {
    case 'ipv4':
      return 'IPv4';
    case 'ipv6':
      return 'IPv6';
    case 'tor':
      return 'Tor';
  }
}
