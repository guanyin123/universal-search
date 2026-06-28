import type { MachineDeps } from './deps';
import type { EventBus } from '../events';
import type { Run, RunPlan, Evidence, PlanSource, PlanDimension, DimensionKey, RunMode } from './types';
import type { SourceResult } from '../search/types';
import { newRunId, slugify } from '../ids';
import { buildProposePrompt, buildGithubProposePrompt, parseProposedQueries } from '../pipeline/propose';
import { buildRankPrompt, parseRankJudgments, rankRepos, type RepoJudgment } from '../pipeline/github-rank';
import { buildCompressPrompt } from '../pipeline/compress';
import { buildSynthesisPrompt } from '../pipeline/template';
import { buildTagsPrompt, parseTags } from '../pipeline/tags';
import { buildDepositPlan } from '../vault/writer';
import { buildFrontmatter } from '../vault/frontmatter';
import { rankRelated, type VaultLibrary } from '../vault/library';
import { planFromWorkflow, makeWorkflowSynthPrompt } from '../workflows/build';
import type { WorkflowDoc } from '../workflows/types';

/** Optional overrides for runPlan — lets v3 replay inject a workflow's own synthesis prompt. */
export interface RunPlanOptions {
  buildSynthPrompt?: (question: string, evidence: Evidence[]) => string;
}

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

const DIMENSION_LABELS: Record<DimensionKey, string> = {
  web: 'Web',
  peoples_writing: '他人写作',
  community: '社区',
  images: '图片',
  github: 'GitHub'
};
// Proposal order for REPORT mode; only dimensions with a configured runner are used.
// NOTE: 'github' is intentionally absent — it's a separate mode, never a report dimension.
const DIMENSION_ORDER: DimensionKey[] = ['web', 'peoples_writing', 'community', 'images'];

type ProposeInput = { question: string; models: { fanout: string; synth: string } };

/** Report mode: propose queries for every configured dimension. A single dimension's
 *  failure is skipped (not fatal) so e.g. an Exa hiccup never drops Web. */
async function proposeReportDimensions(input: ProposeInput, deps: MachineDeps): Promise<PlanDimension[]> {
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
  return dimensions;
}

/** github mode: a single 'github' dimension of repo-search queries (no dimension picking). */
async function proposeGithubDimension(input: ProposeInput, deps: MachineDeps): Promise<PlanDimension[]> {
  const raw = await deps.llm.complete({
    role: 'fanout',
    model: input.models.fanout,
    prompt: buildGithubProposePrompt(input.question)
  });
  const queries = parseProposedQueries(raw);
  const sources: PlanSource[] = queries.map((q, i) => ({
    id: `github-${i + 1}`,
    api: 'github',
    query: q,
    enabled: true
  }));
  return [{ key: 'github', label: DIMENSION_LABELS.github, enabled: true, sources }];
}

export async function startRun(
  input: ProposeInput,
  deps: MachineDeps,
  bus: EventBus,
  mode: RunMode = 'report'
): Promise<Run> {
  const id = newRunId();
  const run: Run = {
    id,
    createdAt: deps.now().toISOString(),
    status: 'proposing',
    mode,
    question: input.question,
    models: input.models,
    plan: { dimensions: [] },
    evidence: []
  };
  await deps.store.save(run);
  bus.emit(id, { phase: 'proposing' });

  try {
    const dimensions =
      mode === 'github'
        ? await proposeGithubDimension(input, deps)
        : await proposeReportDimensions(input, deps);
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
  bus: EventBus,
  opts: RunPlanOptions = {}
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
      // Replay injects the workflow's own synthesis prompt; otherwise the default template.
      prompt: (opts.buildSynthPrompt ?? buildSynthesisPrompt)(run.question, evidence)
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

/**
 * github mode tail — run the GitHub source over each enabled query, collect candidate
 * repos (dedup by url; NO Jina/compress, that's report-only), then rank by stars + a
 * strong-model reputation judgment and keep the top 5. Ends at `done` carrying run.repos
 * (no vault deposit). A separate same-level function so the report path stays untouched.
 */
export async function runGithubSearch(
  runId: string,
  editedPlan: RunPlan,
  deps: MachineDeps,
  bus: EventBus
): Promise<Run> {
  const run = await deps.store.get(runId);
  if (!run) throw new Error(`run not found: ${runId}`);
  run.plan = editedPlan;
  run.mode = 'github';
  run.status = 'searching';
  await deps.store.save(run);

  try {
    const runner = deps.runners.github;
    const candidates: SourceResult[] = [];
    const seen = new Set<string>();
    for (const dim of editedPlan.dimensions) {
      if (!dim.enabled) continue;
      for (const src of dim.sources) {
        if (!src.enabled) continue;
        bus.emit(runId, { phase: 'querying', sourceId: src.id, status: 'start' });
        if (!runner) {
          bus.emit(runId, { phase: 'querying', sourceId: src.id, status: 'fail', title: src.query });
          continue;
        }
        try {
          const results = await runner.run(src.query);
          for (const r of results) {
            if (seen.has(r.url)) continue; // same repo surfaced by two queries — keep once
            seen.add(r.url);
            candidates.push(r);
          }
          bus.emit(runId, { phase: 'querying', sourceId: src.id, status: 'ok', title: src.query });
        } catch {
          bus.emit(runId, { phase: 'querying', sourceId: src.id, status: 'fail', title: src.query });
        }
      }
    }

    if (candidates.length === 0) {
      throw new Error('GitHub 搜索无候选仓库，已中止。');
    }

    run.status = 'synthesizing';
    await deps.store.save(run);
    bus.emit(runId, { phase: 'synthesizing' });

    // Rank by stars + a strong-model reputation judgment. If the judgment call fails,
    // fall back to a stars-only ordering (empty map) so results still come through.
    let judgments: Map<string, RepoJudgment> = new Map();
    try {
      const raw = await deps.llm.complete({
        role: 'synth',
        model: run.models.synth,
        prompt: buildRankPrompt(run.question, candidates)
      });
      judgments = parseRankJudgments(raw);
    } catch (err) {
      console.warn(
        '[github-rank] reputation judging failed; ranking by stars only:',
        err instanceof Error ? err.message : err
      );
    }
    const repos = rankRepos(candidates, judgments);

    run.repos = repos;
    run.status = 'done';
    await deps.store.save(run);
    bus.emit(runId, { phase: 'done', repos });
    return run;
  } catch (err: any) {
    return fail(run, run.status, err, deps, bus);
  }
}

/**
 * Replay step 1 — hydrate a stored workflow + a new question straight into a Run that
 * already sits at `searching`, SKIPPING propose + awaiting_edit. Saved so runPlan can
 * pick it up. Returns the created run (with its hydrated plan) so callers get the id for SSE.
 */
export async function hydrateReplay(
  workflow: WorkflowDoc,
  input: { question: string; models?: { fanout: string; synth: string } },
  deps: MachineDeps
): Promise<Run> {
  const id = newRunId();
  const run: Run = {
    id,
    createdAt: deps.now().toISOString(),
    status: 'searching',
    mode: workflow.mode ?? 'report',
    question: input.question,
    models: input.models ?? workflow.modelConfig,
    plan: planFromWorkflow(workflow, input.question),
    evidence: []
  };
  await deps.store.save(run);
  return run;
}

/**
 * Replay a workflow end-to-end: hydrate (skip propose/edit) → reuse runPlan's
 * search→compress→synth→tags→deposit chain, but with the workflow's own synthesis prompt.
 */
export async function replayWorkflow(
  workflow: WorkflowDoc,
  input: { question: string; models?: { fanout: string; synth: string } },
  deps: MachineDeps,
  bus: EventBus
): Promise<Run> {
  const run = await hydrateReplay(workflow, input, deps);
  if ((workflow.mode ?? 'report') === 'github') {
    return runGithubSearch(run.id, run.plan, deps, bus);
  }
  return runPlan(run.id, run.plan, deps, bus, { buildSynthPrompt: makeWorkflowSynthPrompt(workflow) });
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
