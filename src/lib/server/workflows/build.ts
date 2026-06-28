import type { Run, RunPlan, Evidence, PlanDimension, PlanSource } from '../runs/types';
import { slugify } from '../ids';
import { SMART_DEFAULT_INSTRUCTIONS, SMART_DEFAULT_SECTIONS, composeSynthesisPrompt } from '../pipeline/template';
import type { WorkflowDoc, WorkflowDimension, WorkflowSource } from './types';

export const QUESTION_PLACEHOLDER = '{{question}}';

// Deposit layout the machine/writer use — mirrored here so a workflow records where
// its replays will land (kept in sync with vault/writer.ts buildDepositPlan).
const DEFAULT_DEPOSIT = { reportDir: 'wiki/synthesis', rawDir: 'raw/research' };

/** Escape a string for safe use as a literal RegExp source. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Normalize a question into a reusable pattern: collapse whitespace + trim.
 * (Decision: v3 keeps the abstraction lexical/deterministic — semantic NLP
 * abstraction is deferred. The pattern doubles as the canonical example question.)
 */
export function deriveQuestionPattern(question: string): string {
  return question.replace(/\s+/g, ' ').trim();
}

/**
 * Turn a concrete query into a reusable template: every (case-insensitive) literal
 * occurrence of the originating question becomes {{question}}. Keyword queries that
 * never embedded the question are kept verbatim as fixed reusable angles.
 */
export function templatizeQuery(query: string, question: string): string {
  const q = question.trim();
  if (!q) return query;
  return query.replace(new RegExp(escapeRegExp(q), 'gi'), QUESTION_PLACEHOLDER);
}

/** Fill a query template with a new question (verbatim if it has no placeholder). */
export function hydrateQuery(template: string, question: string): string {
  return template.split(QUESTION_PLACEHOLDER).join(question);
}

/**
 * Serialize a finished Run (awaiting_deposit / done) into a reusable WorkflowDoc.
 * Pure: dimensions/sources come from `run.plan` (enabled only), model_config from
 * `run.models`, run_history seeded with this run. `id`/`name` are derived from the
 * question unless overridden.
 */
export function buildWorkflowDoc(run: Run, opts: { name?: string; id?: string } = {}): WorkflowDoc {
  const name = (opts.name ?? run.question).trim() || run.question;
  const id = opts.id ?? `wf-${slugify(name)}`;
  const questionPattern = deriveQuestionPattern(run.question);

  const dimensions: WorkflowDimension[] = [];
  const sources: WorkflowSource[] = [];
  for (const dim of run.plan.dimensions) {
    if (!dim.enabled) continue;
    const enabledSources = dim.sources.filter((s) => s.enabled);
    if (enabledSources.length === 0) continue;
    dimensions.push({ key: dim.key, label: dim.label });
    for (const s of enabledSources) {
      sources.push({ dimension: dim.key, api: s.api, query: templatizeQuery(s.query, run.question) });
    }
  }

  return {
    id,
    name,
    version: 1,
    mode: run.mode ?? 'report',
    archetype: run.report?.templateKey ?? 'smart-default',
    questionPattern,
    dimensions,
    sources,
    deposit: { ...DEFAULT_DEPOSIT },
    modelConfig: { fanout: run.models.fanout, synth: run.models.synth },
    runHistory: [{ id: run.id, date: run.createdAt.slice(0, 10), question: run.question }],
    templateSections: [...SMART_DEFAULT_SECTIONS],
    // v1 ships one archetype (smart-default); the instruction block IS the prompt.
    synthesisPrompt: SMART_DEFAULT_INSTRUCTIONS
  };
}

/** Hydrate a workflow + new question into a concrete RunPlan (skips proposing). */
export function planFromWorkflow(workflow: WorkflowDoc, question: string): RunPlan {
  const dimensions: PlanDimension[] = workflow.dimensions.map((d) => {
    const sources: PlanSource[] = workflow.sources
      .filter((s) => s.dimension === d.key)
      .map((s, i) => ({
        id: `${d.key}-${i + 1}`,
        api: s.api,
        query: hydrateQuery(s.query, question),
        enabled: true
      }));
    return { key: d.key, label: d.label, enabled: true, sources };
  });
  return { dimensions };
}

/** A synthesis-prompt builder bound to a workflow's own instruction block. */
export function makeWorkflowSynthPrompt(workflow: WorkflowDoc): (question: string, evidence: Evidence[]) => string {
  return (question, evidence) => composeSynthesisPrompt(workflow.synthesisPrompt, question, evidence);
}
