import type { SourceApi } from '../runs/types';

export interface SourceResult {
  url: string;
  title: string;
  snippet: string;
  publishedAt?: string;
}

export interface SourceRunner {
  dimension: 'web' | 'community' | 'peoples_writing' | 'images';
  /** Narrowed to the SourceApi union so a runner returning an unknown api fails
   *  at compile time instead of being force-cast into a PlanSource (was: string). */
  api: SourceApi;
  run(query: string): Promise<SourceResult[]>;
}
