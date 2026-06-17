import type { MachineDeps } from './deps';
import type { EventBus } from '../events';
import type { Run, RunPlan, Evidence, PlanSource } from './types';
import { newRunId, slugify } from '../ids';
import { buildProposePrompt, parseProposedQueries } from '../pipeline/propose';
import { buildCompressPrompt } from '../pipeline/compress';
import { buildSynthesisPrompt } from '../pipeline/template';
import { buildTagsPrompt, parseTags } from '../pipeline/tags';
import { buildDepositPlan } from '../vault/writer';
import { buildFrontmatter } from '../vault/frontmatter';

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

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
    const raw = await deps.llm.complete({
      role: 'fanout',
      model: input.models.fanout,
      prompt: buildProposePrompt(input.question)
    });
    const queries = parseProposedQueries(raw);
    const sources: PlanSource[] = queries.map((q, i) => ({
      id: `web-${i + 1}`,
      api: 'tavily',
      query: q,
      enabled: true
    }));
    run.plan = { dimensions: [{ key: 'web', label: 'Web', enabled: true, sources }] };
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
    const sources = editedPlan.dimensions
      .filter((d) => d.enabled)
      .flatMap((d) => d.sources)
      .filter((s) => s.enabled);

    for (const src of sources) {
      bus.emit(runId, { phase: 'querying', sourceId: src.id, status: 'start' });
      try {
        const results = await deps.web.run(src.query);
        for (const r of results) {
          // Dedup by URL BEFORE the expensive extract+compress — multiple queries
          // may surface the same page; never pay Jina/LLM for it twice.
          if (seenUrls.has(r.url)) continue;
          seenUrls.add(r.url);
          const md = await deps.extract(r.url);
          const compressed = await deps.llm.complete({
            role: 'fanout',
            model: run.models.fanout,
            prompt: buildCompressPrompt(run.question, r.title, md || r.snippet)
          });
          if (compressed.trim() === 'IRRELEVANT') continue;
          evidence.push({
            sourceId: src.id,
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

    let tags: string[] = [];
    try {
      const tagRaw = await deps.llm.complete({
        role: 'synth',
        model: run.models.synth,
        // vocab is empty in v1; biasing tag reuse from existing vault tags is a v2 item
        // (same deferral as related[] auto-linking, per the spec §15 decisions).
        prompt: buildTagsPrompt(run.question, [])
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
      related: []
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
