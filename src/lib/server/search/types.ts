import type { SourceApi } from '../runs/types';

export interface SourceResult {
  url: string;
  title: string;
  snippet: string;
  publishedAt?: string;
  /** Set by media runners (e.g. Unsplash): the embeddable image src. Its presence
   *  tells the pipeline to render a Markdown figure instead of fetching+compressing. */
  imageUrl?: string;
  /** Set by the GitHub runner: repository metadata used for ranking + card display.
   *  Non-breaking — text runners simply leave these unset. */
  stars?: number;
  language?: string;
  license?: string;
  pushedAt?: string;
  topics?: string[];
}

export interface SourceRunner {
  dimension: 'web' | 'community' | 'peoples_writing' | 'images' | 'github';
  /** Narrowed to the SourceApi union so a runner returning an unknown api fails
   *  at compile time instead of being force-cast into a PlanSource (was: string). */
  api: SourceApi;
  run(query: string): Promise<SourceResult[]>;
}
