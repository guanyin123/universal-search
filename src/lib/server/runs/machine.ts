import type { MachineDeps } from './deps';
import type { EventBus } from '../events';
import type { Run, RunPlan, Evidence, PlanSource, PlanDimension, DimensionKey } from './types';
import { newRunId, slugify } from '../ids';
import { buildProposePrompt, parseProposedQueries } from '../pipeline/propose';
import { buildCompressPrompt } from '../pipeline/compress';
import { buildSynthesisPrompt } from '../pipeline/template';
import { buildTagsPrompt, parseTags } from '../pipeline/tags';
import { buildDepositPlan } from '../vault/writer';
import { buildFrontmatter } from '../vault/frontmatter';
import { rankRelated, type VaultLibrary } from '../vault/library';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const DIMENSION_LABELS: Record<DimensionKey, string> = {
  web: 'Web',
  peoples_writing: '他人写作',
  community: '社区',
  images: '图片'
};
// Proposal order; only dimensions with a configured runner are actually used.
const DIMENSION_ORDER: DimensionKey[] = ['web', 'peoples_writing', 'community', 'images'];

export async function startRun(
  input: { question: string; models: { fanout: string; synth: string } },
  deps: MachineDeps,
  bus: EventBus
): Promise<Run> {
  const id = newRunId();
  const run: Run = {
    id,
    createdAt: deps.now().toISOString(),
    status: 'proposing',
    question: input.question,
    models: input.models,
    plan: { dimensions: [] },
    evidence: []
  };
  await deps.store.save(run);
  bus.emit(id, { phase: 'proposing' });

  try {
    // Propose queries for every configured dimension. A single dimension's
    // failure is skipped (not fatal) so e.g. an Exa hiccup never drops Web;
    // only if NO dimension yields queries do we abort.
    const available = DIMENSION_ORDER.filter((k) => deps.runners[k]);
    const dimensions: PlanDimension[] = [];
    for (const key of available) {
      const runner = deps.runners[key]!;
      try {
        const raw = await deps.llm.complete({
          role: 'fanout',
          model: input.models.fanout,
          prompt: buildProposePrompt(input.question, key)
        });
        const queries = parseProposedQueries(raw);
        const sources: PlanSource[] = queries.map((q, i) => ({
          id: `${key}-${i + 1}`,
          api: runner.api,
          query: q,
          enabled: true
        }));
        dimensions.push({ key, label: DIMENSION_LABELS[key], enabled: true, sources });
      } catch (err) {
        console.warn(`[propose] dimension ${key} failed; skipping:`, err instanceof Error ? err.message : err);
      }
    }
    if (dimensions.length === 0) {
      throw new Error('未能为任何维度生成搜索查询。');
    }
    run.plan = { dimensions };
    run.status = 'awaiting_edit';
    await deps.store.save(run);
    bus.emit(id, { phase: 'awaiting_edit', plan: run.plan });
    return run;
  } catch (err: any) {
    return fail(run, 'proposing', err, deps, bus);
  }
}

export async function runPlan(
  runId: string,
  editedPlan: RunPlan,
  deps: MachineDeps,
  bus: EventBus
): Promise<Run> {
  const run = await deps.store.get(runId);
  if (!run) throw new Error(`run not found: ${runId}`);
  run.plan = editedPlan;
  run.status = 'searching';
  await deps.store.save(run);

  try {
    const evidence: Evidence[] = [];
    const seenUrls = new Set<string>();

    // Iterate dimensions (not a flat source list) so each source keeps its
    // dimension context and dispatches to the right runner.
    for (const dim of editedPlan.dimensions) {
      if (!dim.enabled) continue;
      const runner = deps.runners[dim.key];
      for (const src of dim.sources) {
        if (!src.enabled) continue;
        bus.emit(runId, { phase: 'querying', sourceId: src.id, status: 'start' });
        if (!runner) {
          // Dimension has no configured runner (e.g. missing key) — fail this
          // source gracefully instead of crashing the whole run.
          bus.emit(runId, { phase: 'querying', sourceId: src.id, status: 'fail', title: src.query });
          continue;
        }
        try {
          const results = await runner.run(src.query);
          for (const r of results) {
            // Dedup by URL BEFORE the expensive extract+compress — multiple queries
            // may surface the same page; never pay Jina/LLM for it twice.
            // seenUrls is intentionally global across dimensions (declared above the
            // dimension loop), so a URL shared by Web + 他人写作 is fetched once and
            // tagged with the FIRST dimension to surface it (web, per DIMENSION_ORDER);
            // the later dimension's instance is dropped. Acceptable for v2.
            if (seenUrls.has(r.url)) continue;
            seenUrls.add(r.url);

            let compressed: string;
            if (r.imageUrl) {
              // Media result (e.g. an Unsplash photo): there's nothing to fetch or
              // text-compress — the text model can't "see" the image. Store an
              // embeddable Markdown figure + attribution directly so the synthesizer
              // can place it inline.
              compressed = `![${r.title}](${r.imageUrl})` + (r.snippet ? `\n${r.snippet}` : '');
            } else {
              const md = await deps.extract(r.url);
              const c = await deps.llm.complete({
                role: 'fanout',
                model: run.models.fanout,
                prompt: buildCompressPrompt(run.question, r.title, md || r.snippet)
              });
              if (c.trim() === 'IRRELEVANT') continue;
              compressed = c;
            }
            evidence.push({
              sourceId: src.id,
              dimension: dim.key,
              url: r.url,
              title: r.title,
              compressed,
              retrievedAt: isoDate(deps.now())
            });
          }
          bus.emit(runId, { phase: 'querying', sourceId: src.id, status: 'ok', title: src.query });
        } catch {
          bus.emit(runId, { phase: 'querying', sourceId: src.id, status: 'fail', title: src.query });
        }
      }
    }

    // Never synthesize from nothing: if every source failed (search/extract/compress),
    // abort loudly instead of letting the strong model fabricate a sourceless report
    // that the user might confirm into the vault.
    if (evidence.length === 0) {
      throw new Error('所有检索源均失败或无可用内容，已中止以避免生成无来源的报告。');
    }
    run.evidence = evidence;
    run.status = 'synthesizing';
    await deps.store.save(run);
    bus.emit(runId, { phase: 'synthesizing' });

    const markdown = await deps.llm.complete({
      role: 'synth',
      model: run.models.synth,
      prompt: buildSynthesisPrompt(run.question, evidence)
    });

    const date = isoDate(deps.now());
    const slug = slugify(run.question);
    const reportPath = `wiki/synthesis/${slug}.md`;

    // Read the existing vault once: its tags bias new-tag generation toward the
    // user's vocabulary, and its tag overlap auto-links related[]. Graceful — a
    // fresh/unreadable vault yields an empty library (no vocab, no related).
    let library: VaultLibrary = { vocab: [], notes: [] };
    try {
      library = await deps.readLibrary();
    } catch {
      library = { vocab: [], notes: [] };
    }

    let tags: string[] = [];
    try {
      const tagRaw = await deps.llm.complete({
        // tags is a cheap extraction task → fanout (cheap) model, not synth.
        role: 'fanout',
        model: run.models.fanout,
        prompt: buildTagsPrompt(run.question, library.vocab)
      });
      tags = parseTags(tagRaw);
    } catch {
      tags = [];
    }

    const frontmatter = buildFrontmatter({
      title: run.question,
      date,
      tags,
      sources: evidence.map((e) => e.url),
      related: rankRelated(library.notes, tags, reportPath)
    });
    const depositPlan = buildDepositPlan({ slug, date, frontmatter, reportBody: markdown, evidence });

    run.report = { templateKey: 'smart-default', frontmatter, markdown };
    run.depositPlan = depositPlan;
    run.status = 'awaiting_deposit';
    await deps.store.save(run);
    bus.emit(runId, { phase: 'awaiting_deposit', files: depositPlan.files, markdown });
    return run;
  } catch (err: any) {
    return fail(run, run.status, err, deps, bus);
  }
}

async function fail(
  run: Run,
  stage: Run['status'],
  err: any,
  deps: MachineDeps,
  bus: EventBus
): Promise<Run> {
  run.status = 'error';
  run.error = { stage, message: err?.message ?? String(err) };
  await deps.store.save(run);
  bus.emit(run.id, { phase: 'error', message: run.error.message });
  return run;
}
