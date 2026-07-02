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

/** A named search target for the unified "搜索来源" (source guardrail) picker.
 *  Vetted targets: subreddit / hn / domain. Broad low-trust cards: web (open-web
 *  Tavily) / writing (Exa) — off by default, the opt-in discovery escape hatch. */
export type CommunityTargetKind = 'subreddit' | 'hn' | 'domain' | 'web' | 'writing';
/** value: subreddit name (no `r/` prefix) | 'hackernews' | a bare domain |
 *  'open-web' | 'exa' (the last two are broad, value is just an identifier). */
export interface CommunityTarget {
  kind: CommunityTargetKind;
  value: string;
}

export interface PlanSource {
  id: string;
  api: SourceApi;
  query: string;
  enabled: boolean;
  /** Community dimension only: the named target this source searches. Other
   *  dimensions leave it undefined (back-compat: optional everywhere). */
  target?: CommunityTarget;
  /** Display name for the target, e.g. "r/MachineLearning" / "stackoverflow.com". */
  label?: string;
  /** Human-readable score detail, e.g. "2.9M 订阅" / "排名 #38". */
  scoreLabel?: string;
  /** Normalized priority 0-100 — orders the picker + default-selects the top 3. */
  score?: number;
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
