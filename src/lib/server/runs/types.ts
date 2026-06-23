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

/** Dimensions the planner can model. v2 adds peoples_writing (Exa) and community
 *  (Reddit + HN); web is v1. */
export type DimensionKey = 'web' | 'peoples_writing' | 'community';
/** Search APIs backing a source. ('community' fans out to Reddit + HN.) */
export type SourceApi = 'tavily' | 'exa' | 'community';

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
  kind: 'synthesis' | 'raw';
  contents: string;
}

export interface ReportData {
  templateKey: 'smart-default';
  frontmatter: Frontmatter;
  markdown: string;
}

export interface Run {
  id: string;
  createdAt: string;
  status: RunStatus;
  question: string;
  models: { fanout: string; synth: string };
  plan: RunPlan;
  evidence: Evidence[];
  report?: ReportData;
  depositPlan?: { files: DepositFile[]; reportPath: string };
  error?: { stage: RunStatus; message: string };
}
