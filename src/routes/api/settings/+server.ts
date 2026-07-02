import { json } from '@sveltejs/kit';
import { mkdir, writeFile, rm } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { randomBytes } from 'node:crypto';
import { getSaveDir, setSaveDir } from '$lib/server/settings';

/** GET → the currently configured save directory (empty string when unset). */
export async function GET() {
  return json({ saveDir: getSaveDir() });
}

/**
 * POST { saveDir } → validate the directory is writable (create it if needed, write
 * then remove a probe file), persist it, and echo it back. Always 200 with
 * `{ ok, saveDir, error? }` so the UI can render the verdict (mirrors channels/test).
 */
export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const saveDir = (body.saveDir ?? '').toString().trim();
  if (!saveDir) return json({ ok: false, error: '请填写保存目录' });
  if (!isAbsolute(saveDir)) return json({ ok: false, error: '请使用绝对路径（如 /Users/you/research）' });

  try {
    await mkdir(saveDir, { recursive: true });
    const probe = join(saveDir, `.us-write-test-${randomBytes(4).toString('hex')}`);
    await writeFile(probe, 'ok', 'utf8');
    await rm(probe, { force: true });
  } catch (e) {
    return json({ ok: false, error: `目录不可写：${e instanceof Error ? e.message : String(e)}` });
  }

  setSaveDir(saveDir);
  return json({ ok: true, saveDir });
}
