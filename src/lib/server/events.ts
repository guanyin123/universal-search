import type { RunPlan, DepositFile } from './runs/types';

export type RunEvent =
  | { phase: 'proposing' }
  | { phase: 'awaiting_edit'; plan: RunPlan }
  | { phase: 'querying'; sourceId: string; status: 'start' | 'ok' | 'fail'; title?: string }
  | { phase: 'synthesizing'; delta?: string }
  | { phase: 'awaiting_deposit'; files: DepositFile[]; markdown: string }
  | { phase: 'done'; reportPath: string; sha?: string }
  | { phase: 'error'; message: string }
  | { phase: 'heartbeat' };

type Listener = (e: RunEvent) => void;

export function makeEventBus() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    subscribe(runId: string, fn: Listener): () => void {
      if (!listeners.has(runId)) listeners.set(runId, new Set());
      listeners.get(runId)!.add(fn);
      return () => listeners.get(runId)?.delete(fn);
    },
    emit(runId: string, e: RunEvent): void {
      listeners.get(runId)?.forEach((fn) => fn(e));
    }
  };
}

export type EventBus = ReturnType<typeof makeEventBus>;

// Single process-wide bus shared by routes + machine.
export const bus: EventBus = makeEventBus();
