import type { Frontmatter } from '../vault/frontmatter';

export type RunStatus =
  | 'proposing'
  | 'awaiting_edit'
  | 'searching'
  | 'synthesizing'
  | 'awaiting_deposit'
  | 'depositing'
  | 'done'
  | 'error';

/** A run's track. 'report' is the v1/v2/v3 search→synthesis→deposit flow; 'github'
 *  is the peer "find GitHub tools" flow (single GitHub source, ranked top-5, no vault). */
export type RunMode = 'report' | 'github';

/** Dimensions the planner can model. v2 adds peoples_writing (Exa), community
 *  (Reddit + HN), and images (Unsplash); web is v1. 'github' is the github-mode source. */
export type DimensionKey = 'web' | 'peoples_writing' | 'community' | 'images' | 'github';
/** Search APIs backing a source. ('community' fans out to Reddit + HN.) */
export type SourceApi = 'tavily' | 'exa' | 'community' | 'unsplash' | 'github';

export interface PlanSource {
  id: string;
  api: SourceApi;
  query: string;
  enabled: boolean;
}

export interface PlanDimension {
  key: DimensionKey;
  label: string;
  enabled: boolean;
  sources: PlanSource[];
}

export interface RunPlan {
  dimensions: PlanDimension[];
}

export interface Evidence {
  sourceId: string;
  dimension: DimensionKey;
  url: string;
  title: string;
  compressed: string;
  retrievedAt: string;
}

export interface DepositFile {
  path: string; // vault-relative
  kind: 'synthesis' | 'raw' | 'workflow';
  contents: string;
}

export interface ReportData {
  templateKey: 'smart-default';
  frontmatter: Frontmatter;
  markdown: string;
}

/** A scored GitHub repository — the github mode's output unit (top-5 ranked by
 *  stars + a strong-model reputation judgment). */
export interface RankedRepo {
  url: string;
  fullName: string;
  description: string;
  stars: number;
  language?: string;
  license?: string;
  pushedAt?: string;
  topics?: string[];
  /** Strong-model online-reputation judgment, 0-10. */
  reputation: number;
  /** Combined score: log-normalized stars + reputation, weighted. */
  score: number;
  /** One-line why-recommended. */
  reason: string;
}

export interface Run {
  id: string;
  createdAt: string;
  status: RunStatus;
  /** Which track this run is on. Absent on legacy runs → treated as 'report'. */
  mode?: RunMode;
  question: string;
  models: { fanout: string; synth: string };
  plan: RunPlan;
  evidence: Evidence[];
  report?: ReportData;
  /** github mode: the ranked top-5 repos (set when status reaches 'done'). */
  repos?: RankedRepo[];
  depositPlan?: { files: DepositFile[]; reportPath: string };
  error?: { stage: RunStatus; message: string };
}
