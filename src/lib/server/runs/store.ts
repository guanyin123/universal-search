import { mkdir, readFile, writeFile, rename, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { Run, RunStatus } from './types';

export interface RunSummary {
  id: string;
  createdAt: string;
  status: RunStatus;
  question: string;
}

export function makeRunStore(dir: string) {
  const ensure = async () => { await mkdir(dir, { recursive: true }); };
  const file = (id: string) => join(dir, `${id}.json`);

  return {
    async save(run: Run): Promise<void> {
      await ensure();
      const tmp = join(dir, `${run.id}.${Date.now()}.${randomBytes(4).toString('hex')}.tmp`);
      await writeFile(tmp, JSON.stringify(run, null, 2), 'utf8');
      await rename(tmp, file(run.id)); // atomic on same filesystem
    },

    async get(id: string): Promise<Run | null> {
      try {
        return JSON.parse(await readFile(file(id), 'utf8')) as Run;
      } catch (err: any) {
        if (err?.code === 'ENOENT') return null;
        throw err;
      }
    },

    async query(): Promise<RunSummary[]> {
      await ensure();
      const names = (await readdir(dir)).filter((n) => n.endsWith('.json'));
      const runs = await Promise.all(
        names.map(async (n) => {
          try {
            const r = JSON.parse(await readFile(join(dir, n), 'utf8')) as Run;
            return { id: r.id, createdAt: r.createdAt, status: r.status, question: r.question };
          } catch {
            return null;
          }
        })
      );
      return runs
        .filter((r): r is RunSummary => r !== null)
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
    }
  };
}

export type RunStore = ReturnType<typeof makeRunStore>;
