import { describe, expect, it } from 'vitest';
import {
  freshIncidentState,
  nextIncidentAction,
  type IncidentOptions,
  type IncidentState,
} from '../lib/incidents';

const fresh: IncidentState = freshIncidentState;
const MIN = 60_000;
const T0 = 1_700_000_000_000;

/** threshold 2, alerts sent immediately — the old (pre-gating) behaviour */
const eager: IncidentOptions = { failThreshold: 2, alertAfterMs: 0 };
/** production-shaped: 3 failed checks and 10 minutes down before mail goes out */
const gated: IncidentOptions = { failThreshold: 3, alertAfterMs: 10 * MIN };

describe('nextIncidentAction', () => {
  it('does nothing on success with no incident', () => {
    const { state, action } = nextIncidentAction(fresh, true, T0, eager);
    expect(action.type).toBe('none');
    expect(state.consecutiveFails).toBe(0);
  });

  it('does not open before the threshold', () => {
    const { state, action } = nextIncidentAction(fresh, false, T0, eager);
    expect(action.type).toBe('none');
    expect(state.consecutiveFails).toBe(1);
    expect(state.openIncidentId).toBeNull();
    expect(state.firstFailTs).toBe(T0);
  });

  it('opens at the threshold', () => {
    const step1 = nextIncidentAction(fresh, false, T0, eager);
    const step2 = nextIncidentAction(step1.state, false, T0 + 3 * MIN, eager);
    expect(step2.action).toEqual({ type: 'open', failCount: 2 });
    expect(step2.alertDown).toBe(true);
  });

  it('bumps an open incident on further failures', () => {
    const open: IncidentState = {
      consecutiveFails: 2,
      firstFailTs: T0,
      openIncidentId: 7,
      alerted: true,
    };
    const { state, action, alertDown } = nextIncidentAction(open, false, T0 + MIN, eager);
    expect(action.type).toBe('bump');
    expect(state.openIncidentId).toBe(7);
    expect(state.consecutiveFails).toBe(3);
    expect(alertDown).toBe(false); // never mails twice for one incident
  });

  it('closes on first success and resets fail streak', () => {
    const open: IncidentState = {
      consecutiveFails: 5,
      firstFailTs: T0,
      openIncidentId: 7,
      alerted: true,
    };
    const { state, action, alertRecovered } = nextIncidentAction(open, true, T0 + MIN, eager);
    expect(action.type).toBe('close');
    expect(state.openIncidentId).toBeNull();
    expect(state.consecutiveFails).toBe(0);
    expect(state.firstFailTs).toBeNull();
    expect(alertRecovered).toBe(true);
  });

  it('a blip below threshold never alerts', () => {
    const fail = nextIncidentAction(fresh, false, T0, gated);
    const recover = nextIncidentAction(fail.state, true, T0 + 3 * MIN, gated);
    expect(recover.action.type).toBe('none');
    expect(recover.state.consecutiveFails).toBe(0);
    expect(recover.alertRecovered).toBe(false);
  });

  it('threshold 1 opens immediately', () => {
    const { action } = nextIncidentAction(fresh, false, T0, { ...eager, failThreshold: 1 });
    expect(action).toEqual({ type: 'open', failCount: 1 });
  });

  it('records the incident but holds the email until the outage persists', () => {
    // three failed checks, 3 min apart: incident opens, but only 6 min of downtime
    let d = nextIncidentAction(fresh, false, T0, gated);
    d = nextIncidentAction(d.state, false, T0 + 3 * MIN, gated);
    d = nextIncidentAction(d.state, false, T0 + 6 * MIN, gated);
    expect(d.action).toEqual({ type: 'open', failCount: 3 });
    expect(d.alertDown).toBe(false);
    expect(d.state.alerted).toBe(false);

    // still down past the 10 minute mark: now it mails, once
    d = { ...d, state: { ...d.state, openIncidentId: 42 } };
    const mail = nextIncidentAction(d.state, false, T0 + 12 * MIN, gated);
    expect(mail.alertDown).toBe(true);
    expect(mail.state.alerted).toBe(true);
    const again = nextIncidentAction(mail.state, false, T0 + 15 * MIN, gated);
    expect(again.alertDown).toBe(false);
  });

  it('sends no recovery mail for an incident that was never mailed', () => {
    let d = nextIncidentAction(fresh, false, T0, gated);
    d = nextIncidentAction(d.state, false, T0 + 3 * MIN, gated);
    d = nextIncidentAction(d.state, false, T0 + 6 * MIN, gated);
    expect(d.action.type).toBe('open');
    const recover = nextIncidentAction(
      { ...d.state, openIncidentId: 9 },
      true,
      T0 + 9 * MIN,
      gated,
    );
    expect(recover.action.type).toBe('close');
    expect(recover.alertRecovered).toBe(false);
  });

  it('keeps the outage start across the whole failure streak', () => {
    let d = nextIncidentAction(fresh, false, T0, gated);
    d = nextIncidentAction(d.state, false, T0 + 3 * MIN, gated);
    expect(d.state.firstFailTs).toBe(T0);
  });
});
