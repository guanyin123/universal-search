import { describe, it, expect } from 'vitest';
import { makeEventBus } from './events';

describe('makeEventBus', () => {
  it('delivers events emitted after subscribe', async () => {
    const bus = makeEventBus();
    const got: string[] = [];
    const unsub = bus.subscribe('run-1', (e) => got.push(e.phase));
    bus.emit('run-1', { phase: 'proposing' });
    bus.emit('run-1', { phase: 'done', reportPath: 'p' });
    unsub();
    bus.emit('run-1', { phase: 'error', message: 'after-unsub' });
    expect(got).toEqual(['proposing', 'done']);
  });

  it('isolates events by runId', () => {
    const bus = makeEventBus();
    const a: string[] = [];
    bus.subscribe('run-a', (e) => a.push(e.phase));
    bus.emit('run-b', { phase: 'proposing' });
    expect(a).toEqual([]);
  });
});
