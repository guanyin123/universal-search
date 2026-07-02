import type { DimensionKey } from '../runs/types';
import type { SourceRegion } from '../settings';

export function buildProposePrompt(question: string, dimension: DimensionKey = 'web'): string {
  if (dimension === 'peoples_writing') {
    return [
      'You plan a search for INDIVIDUAL, opinionated long-form writing —',
      'personal blog posts, essays, newsletters, first-person deep dives —',
      'on a research question, NOT official docs or news articles.',
      'Output ONLY a JSON array of 2-3 concise search query strings that surface',
      'thoughtful personal perspectives from complementary angles.',
      'No prose, no keys — just the array.',
      '',
      `Question: ${question}`
    ].join('\n');
  }
  if (dimension === 'community') {
    return [
      'You plan a search across community discussion forums (Reddit, Hacker News)',
      'for first-hand experiences, debates, and practitioner opinions on a research',
      'question — what real people report, recommend, or warn against.',
      'Output ONLY a JSON array of 2-3 concise search query strings (keywords, not',
      'questions) likely to match relevant threads from complementary angles.',
      'No prose, no keys — just the array.',
      '',
      `Question: ${question}`
    ].join('\n');
  }
  if (dimension === 'images') {
    return [
      'You plan an image search (Unsplash) for photos that would illustrate a',
      'research report on the question — concrete visual subjects, scenes, or',
      'objects, NOT abstract phrases.',
      'Output ONLY a JSON array of 1-2 short visual search query strings.',
      'No prose, no keys — just the array.',
      '',
      `Question: ${question}`
    ].join('\n');
  }
  return [
    'You plan web searches for a research question.',
    'Output ONLY a JSON array of 2-3 concise, high-signal web search query strings',
    'that together cover the question from complementary angles.',
    'No prose, no keys — just the array.',
    '',
    `Question: ${question}`
  ].join('\n');
}

/**
 * Propose GitHub repository search queries for the github tool-search mode. Encourages
 * GitHub search qualifiers (language:, stars:>N, topic:) and keyword phrasing — these
 * are repo-search strings, not natural-language questions. Reuses parseProposedQueries.
 */
export function buildGithubProposePrompt(question: string): string {
  return [
    'You plan a search for open-source TOOLS on GitHub that solve a user need.',
    'Output ONLY a JSON array of 2-3 GitHub repository-search query strings that',
    'surface the strongest candidate tools from complementary angles.',
    'Use keywords (not a sentence) and GitHub search qualifiers where helpful,',
    'e.g. `language:rust`, `stars:>500`, `topic:cli`.',
    'No prose, no keys — just the array.',
    '',
    `Need: ${question}`
  ].join('\n');
}

/** A community-dimension proposal: shared keyword query + candidate named targets
 *  (subreddits + website domains). HN is added by the orchestrator, not the model. */
export interface CommunityProposal {
  keywords: string;
  targets: { kind: 'subreddit' | 'domain'; value: string }[];
}

/**
 * Prompt the model for a MIX of topical communities + authoritative websites to
 * search for a question, plus one keyword string to run against each. Returns a
 * single JSON object (parsed by parseCommunityProposal) — not a bare array.
 *
 * `region` biases which sources to propose: 国内 asks for Chinese-language domestic
 * sites only (domains, no subreddits/HN, Chinese keywords), 国外 for English/
 * international communities, 混合 for both.
 */
export function buildCommunityTargetsPrompt(question: string, region: SourceRegion = 'mixed'): string {
  const regionBlock =
    region === 'domestic'
      ? [
          'IMPORTANT — 信息源来源: 国内 (mainland China). Propose ONLY Chinese-language domestic',
          'communities and websites — e.g. 知乎 zhihu.com, 豆瓣 douban.com, V2EX v2ex.com,',
          '少数派 sspai.com, 掘金 juejin.cn, CSDN csdn.net, 虎扑 hupu.com, 微博 weibo.com,',
          'bilibili.com, 36氪 36kr.com. Return ONLY {"kind":"domain"} targets — NO subreddits,',
          'NO Reddit, NO Hacker News. The "keywords" MUST be in Chinese.'
        ]
      : region === 'foreign'
        ? [
            'IMPORTANT — 信息源来源: 国外 (international). Propose English-language international',
            'communities and websites (Reddit, Stack Overflow, GitHub, Medium, specialized forums).',
            'Avoid Chinese-only platforms. The "keywords" should be in English.'
          ]
        : [
            '信息源来源: 混合 — include a MIX of international sources (Reddit, English sites) AND',
            'Chinese-language domestic sources (知乎, V2EX, 掘金, etc.) where relevant.'
          ];
  const targetsLine =
    region === 'domestic'
      ? 'Give about 8 {"kind":"domain"} targets — authoritative Chinese topical websites and community sites.'
      : 'Give about 8 targets — a MIX of relevant subreddits and authoritative topical websites.';
  const hnLine =
    region === 'domestic'
      ? 'Domains must be bare (no https://, no path).'
      : 'Do NOT include Hacker News (added automatically). Domains must be bare (no https://, no path).';
  return [
    'You plan a search of high-signal COMMUNITIES and WEBSITES for a research question.',
    ...regionBlock,
    'Return ONLY a JSON object (no prose, no code fences) of EXACTLY this shape:',
    '{"keywords":"<2-5 word keyword search string, NOT a question>",',
    ' "targets":[{"kind":"subreddit","value":"<subreddit name, no r/ prefix>"},',
    '            {"kind":"domain","value":"<bare website domain, e.g. stackoverflow.com>"}]}',
    targetsLine,
    'These should be the sources most likely to hold first-hand discussion or expert content.',
    hnLine,
    '',
    `Question: ${question}`
  ].join('\n');
}

/** Parse + validate the community proposal object. Throws if unusable (caller falls back). */
export function parseCommunityProposal(raw: string): CommunityProposal {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`Could not parse community proposal object: ${raw.slice(0, 120)}`);
  let obj: unknown;
  try {
    obj = JSON.parse(match[0]);
  } catch {
    throw new Error(`Community proposal invalid JSON: ${match[0].slice(0, 120)}`);
  }
  const o = obj as { keywords?: unknown; targets?: unknown };
  const keywords = String(o?.keywords ?? '').trim();
  if (!keywords) throw new Error('Community proposal missing keywords');
  const rawTargets = Array.isArray(o?.targets) ? o.targets : [];
  const targets = rawTargets
    .map((t) => {
      const tt = t as { kind?: unknown; value?: unknown };
      return { kind: String(tt?.kind ?? '').trim(), value: String(tt?.value ?? '').trim() };
    })
    .filter((t): t is { kind: 'subreddit' | 'domain'; value: string } =>
      (t.kind === 'subreddit' || t.kind === 'domain') && t.value.length > 0
    )
    .slice(0, 10);
  if (targets.length === 0) throw new Error('Community proposal returned no usable targets');
  return { keywords, targets };
}

export function parseProposedQueries(raw: string): string[] {
  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`Could not parse query array from model output: ${raw.slice(0, 120)}`);
  let arr: unknown;
  try {
    arr = JSON.parse(match[0]);
  } catch {
    throw new Error(`Could not parse query array (invalid JSON): ${match[0].slice(0, 120)}`);
  }
  if (!Array.isArray(arr)) throw new Error('Parsed value is not an array');
  const queries = arr.map((x) => String(x).trim()).filter(Boolean).slice(0, 3);
  if (queries.length === 0) {
    throw new Error('Could not parse query array: model returned no usable queries');
  }
  return queries;
}
