import { pino } from 'pino';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { startOutboxLoops } from './loops.js';

function logger() {
  let raw = '';
  const stream = new Writable({ write: (c, _e, cb) => ((raw += String(c)), cb()) });
  return {
    log: pino({ level: 'info' }, stream),
    lines: () =>
      raw
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l)),
  };
}

afterEach(() => vi.useRealTimers());

describe('startOutboxLoops', () => {
  it('ticks both loops on their intervals', async () => {
    vi.useFakeTimers();
    const dispatch = vi.fn(async () => undefined);
    const reconcile = vi.fn(async () => undefined);
    const loops = startOutboxLoops({
      dispatcher: { dispatch, reconcile },
      logger: logger().log,
      intervalMs: 1000,
      reconcileMs: 5000,
    });
    await vi.advanceTimersByTimeAsync(5000);
    expect(dispatch.mock.calls.length).toBe(6); // immediately, then every second
    expect(reconcile.mock.calls.length).toBe(2);
    await loops.stop();
  });

  it('does not re-enter a slow tick', async () => {
    vi.useFakeTimers();
    let active = 0;
    let maxActive = 0;
    const dispatch = async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 3500));
      active -= 1;
    };
    const loops = startOutboxLoops({
      dispatcher: { dispatch, reconcile: async () => undefined },
      logger: logger().log,
      intervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(maxActive).toBe(1);
    const stopping = loops.stop();
    await vi.advanceTimersByTimeAsync(5000);
    await stopping;
  });

  it('survives errors, logs the class name once, and logs recovery', async () => {
    vi.useFakeTimers();
    const l = logger();
    let fail = true;
    const dispatch = async () => {
      if (fail) throw new TypeError('postgresql://user:pw@host failed');
    };
    const loops = startOutboxLoops({
      dispatcher: { dispatch, reconcile: async () => undefined },
      logger: l.log,
      intervalMs: 1000,
    });
    await vi.advanceTimersByTimeAsync(4000);
    fail = false;
    await vi.advanceTimersByTimeAsync(2000);
    const msgs = l.lines().map((x) => x.msg);
    expect(msgs.filter((m) => m === 'outbox loop failing')).toHaveLength(1);
    expect(msgs).toContain('outbox loop recovered');
    expect(JSON.stringify(l.lines())).not.toContain('pw@host');
    expect(l.lines().find((x) => x.msg === 'outbox loop failing').error).toBe('TypeError');
    await loops.stop();
  });

  it('stop() waits for the running tick and stops ticking', async () => {
    vi.useFakeTimers();
    let finished = false;
    const dispatch = vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 2000));
      finished = true;
    });
    const loops = startOutboxLoops({
      dispatcher: { dispatch, reconcile: async () => undefined },
      logger: logger().log,
      intervalMs: 1000,
    });
    const stopping = loops.stop();
    await vi.advanceTimersByTimeAsync(2000);
    await stopping;
    expect(finished).toBe(true);
    await vi.advanceTimersByTimeAsync(5000);
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});
