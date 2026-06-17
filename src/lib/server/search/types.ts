export interface SourceResult {
  url: string;
  title: string;
  snippet: string;
  publishedAt?: string;
}

export interface SourceRunner {
  dimension: 'web' | 'community' | 'peoples_writing' | 'images';
  api: string;
  run(query: string): Promise<SourceResult[]>;
}
