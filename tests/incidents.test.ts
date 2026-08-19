import { describe, expect, it } from 'vitest';
import { nextIncidentAction, type IncidentState } from '../lib/incidents';

const fresh: IncidentState = { consecutiveFails: 0, openIncidentId: null };

describe('nextIncidentAction', () => {
  it('does nothing on success with no incident', () => {
    const { state, action } = nextIncidentAction(fresh, true, 2);
    expect(action.type).toBe('none');
    expect(state.consecutiveFails).toBe(0);
  });

  it('does not open before the threshold', () => {
    const { state, action } = nextIncidentAction(fresh, false, 2);
    expect(action.type).toBe('none');
    expect(state.consecutiveFails).toBe(1);
    expect(state.openIncidentId).toBeNull();
  });

  it('opens at the threshold', () => {
    const step1 = nextIncidentAction(fresh, false, 2);
    const step2 = nextIncidentAction(step1.state, false, 2);
    expect(step2.action).toEqual({ type: 'open', failCount: 2 });
  });

  it('bumps an open incident on further failures', () => {
    const open: IncidentState = { consecutiveFails: 2, openIncidentId: 7 };
    const { state, action } = nextIncidentAction(open, false, 2);
    expect(action.type).toBe('bump');
    expect(state.openIncidentId).toBe(7);
    expect(state.consecutiveFails).toBe(3);
  });

  it('closes on first success and resets fail streak', () => {
    const open: IncidentState = { consecutiveFails: 5, openIncidentId: 7 };
    const { state, action } = nextIncidentAction(open, true, 2);
    expect(action.type).toBe('close');
    expect(state.openIncidentId).toBeNull();
    expect(state.consecutiveFails).toBe(0);
  });

  it('a blip below threshold never alerts', () => {
    const fail = nextIncidentAction(fresh, false, 3);
    const recover = nextIncidentAction(fail.state, true, 3);
    expect(recover.action.type).toBe('none');
    expect(recover.state.consecutiveFails).toBe(0);
  });

  it('threshold 1 opens immediately', () => {
    const { action } = nextIncidentAction(fresh, false, 1);
    expect(action).toEqual({ type: 'open', failCount: 1 });
  });
});
