import type { MachineDeps } from './deps';
import type { EventBus } from '../events';
import type { Run } from './types';
import { assertCleanVault, autocommit } from '../vault/git';
import { writeDepositPlan } from '../vault/writer';

export async function depositRun(runId: string, deps: MachineDeps, bus: EventBus): Promise<Run> {
  const run = await deps.store.get(runId);
  if (!run) throw new Error(`run not found: ${runId}`);
  if (!run.depositPlan) throw new Error('run has no deposit plan');
  // Idempotency: never re-commit a finished run; never race a concurrent deposit.
  // ('error' is allowed so a failed deposit — e.g. dirty vault — can be retried.)
  if (run.status === 'done') throw new Error(`run ${runId} already deposited`);
  if (run.status === 'depositing') throw new Error(`run ${runId} deposit already in progress`);

  run.status = 'depositing';
  await deps.store.save(run);

  try {
    await assertCleanVault(deps.vaultRoot); // hard-abort if dirty
    await writeDepositPlan(deps.vaultRoot, run.depositPlan);
    const sha = await autocommit(
      deps.vaultRoot,
      run.depositPlan.files.map((f) => f.path),
      `research: ${run.question}`
    );
    run.status = 'done';
    await deps.store.save(run);
    bus.emit(runId, { phase: 'done', reportPath: run.depositPlan.reportPath, sha });
    return run;
  } catch (err: any) {
    run.status = 'error';
    run.error = { stage: 'depositing', message: err?.message ?? String(err) };
    await deps.store.save(run);
    bus.emit(runId, { phase: 'error', message: run.error.message });
    return run;
  }
}
