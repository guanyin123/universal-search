import type { DimensionKey, SourceApi, RunMode, CommunityTarget } from '../runs/types';

/** A reusable search source — a query template (may contain the {{question}}
 *  placeholder) bound to a dimension + API. */
export interface WorkflowSource {
  dimension: DimensionKey;
  api: SourceApi;
  query: string;
  /** Community dimension: the named target + scoring metadata, carried so a replay
   *  re-targets the same subreddit / HN / website rather than searching broadly. */
  target?: CommunityTarget;
  label?: string;
  scoreLabel?: string;
  score?: number;
}

/** The dimension-level metadata of a workflow (its sources live in `sources`,
 *  tagged with `dimension`, mirroring spec §9's separate `dimensions`/`sources` keys). */
export interface WorkflowDimension {
  key: DimensionKey;
  label: string;
}

/** One entry in a workflow's run history — enough to trace provenance. */
export interface WorkflowRunRef {
  id: string;
  date: string; // YYYY-MM-DD
  question: string;
}

/**
 * A reusable research workflow, serialized to `<VAULT_ROOT>/.research-workflows/<slug>.md`.
 * Frontmatter holds the structured plan (spec §9 keys); the body holds the report
 * template + the synthesis system prompt this workflow replays with.
 */
export interface WorkflowDoc {
  id: string;
  name: string;
  version: number;
  /** Which track this workflow replays. Legacy docs without it parse as 'report'. */
  mode: RunMode;
  archetype: string;
  questionPattern: string;
  dimensions: WorkflowDimension[];
  sources: WorkflowSource[];
  deposit: { reportDir: string; rawDir: string };
  modelConfig: { fanout: string; synth: string };
  runHistory: WorkflowRunRef[];
  /** Report section headings this workflow renders (documentary; the prompt carries them too). */
  templateSections: string[];
  /** The synthesis instruction block replayed verbatim (composed with the new question + evidence). */
  synthesisPrompt: string;
}

/** Lightweight listing entry (no body) for the workflow picker. */
export interface WorkflowSummary {
  slug: string;
  id: string;
  name: string;
  mode: RunMode;
  archetype: string;
  questionPattern: string;
}
