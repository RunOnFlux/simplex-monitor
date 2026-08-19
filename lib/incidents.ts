import type { Transport } from './types';

export interface IncidentState {
  /** consecutive failures seen so far (before this probe) */
  consecutiveFails: number;
  /** id of the currently open incident, if any */
  openIncidentId: number | null;
}

export type IncidentAction =
  { type: 'none' } | { type: 'open'; failCount: number } | { type: 'bump' } | { type: 'close' };

/**
 * Pure incident state machine. Given the previous state for a (server, transport)
 * pair and a new probe outcome, decide what to do. An incident opens after
 * `failThreshold` consecutive failures and closes on the first success.
 */
export function nextIncidentAction(
  state: IncidentState,
  probeOk: boolean,
  failThreshold: number,
): { state: IncidentState; action: IncidentAction } {
  if (probeOk) {
    if (state.openIncidentId !== null) {
      return {
        state: { consecutiveFails: 0, openIncidentId: null },
        action: { type: 'close' },
      };
    }
    return { state: { consecutiveFails: 0, openIncidentId: null }, action: { type: 'none' } };
  }
  const fails = state.consecutiveFails + 1;
  if (state.openIncidentId !== null) {
    return {
      state: { consecutiveFails: fails, openIncidentId: state.openIncidentId },
      action: { type: 'bump' },
    };
  }
  if (fails >= failThreshold) {
    return {
      state: { consecutiveFails: fails, openIncidentId: -1 }, // caller replaces -1 with the real id
      action: { type: 'open', failCount: fails },
    };
  }
  return { state: { consecutiveFails: fails, openIncidentId: null }, action: { type: 'none' } };
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
