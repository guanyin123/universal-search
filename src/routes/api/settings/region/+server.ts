import { json } from '@sveltejs/kit';
import { getSourceRegion, setSourceRegion, type SourceRegion } from '$lib/server/settings';

const VALID: SourceRegion[] = ['domestic', 'foreign', 'mixed'];

/** GET → the currently configured information-source region ('mixed' when unset). */
export async function GET() {
  return json({ region: getSourceRegion() });
}

/**
 * POST { region } → validate it's one of 国内/国外/混合, persist it, echo it back.
 * Always 200 with `{ ok, region, error? }` so the UI can render the verdict.
 */
export async function POST({ request }) {
  const body = await request.json().catch(() => ({}));
  const region = (body.region ?? '').toString().trim();
  if (!VALID.includes(region as SourceRegion)) {
    return json({ ok: false, error: '无效的区域选择' });
  }
  setSourceRegion(region as SourceRegion);
  return json({ ok: true, region });
}
