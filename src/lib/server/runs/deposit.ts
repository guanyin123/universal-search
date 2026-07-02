import type { MachineDeps } from './deps';
import type { EventBus } from '../events';
import type { Run } from './types';
import { writeDepositPlan } from '../vault/writer';

export async function depositRun(runId: string, deps: MachineDeps, bus: EventBus): Promise<Run> {
  const run = await deps.store.get(runId);
  if (!run) throw new Error(`run not found: ${runId}`);
  if (!run.depositPlan) throw new Error('run has no deposit plan');
  if (!deps.vaultRoot) throw new Error('尚未配置保存目录：请在设置中指定一个保存目录。');
  // Idempotency: never re-write a finished run; never race a concurrent deposit.
  // ('error' is allowed so a failed deposit can be retried.)
  if (run.status === 'done') throw new Error(`run ${runId} already deposited`);
  if (run.status === 'depositing') throw new Error(`run ${runId} deposit already in progress`);

  run.status = 'depositing';
  await deps.store.save(run);

  try {
    // Public branch: plain file write into the user's chosen directory — no git.
    await writeDepositPlan(deps.vaultRoot, run.depositPlan);
    run.status = 'done';
    await deps.store.save(run);
    bus.emit(runId, { phase: 'done', reportPath: run.depositPlan.reportPath });
    return run;
  } catch (err: any) {
    run.status = 'error';
    run.error = { stage: 'depositing', message: err?.message ?? String(err) };
    await deps.store.save(run);
    bus.emit(runId, { phase: 'error', message: run.error.message });
    return run;
  }
}
