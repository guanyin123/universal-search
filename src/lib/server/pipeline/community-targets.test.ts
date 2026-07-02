import { describe, it, expect, vi } from 'vitest';
import { buildCommunityDimension, rankAndSelect, type CommunityScorers } from './community-targets';
import { parseCommunityProposal } from './propose';

describe('parseCommunityProposal', () => {
  it('parses keywords + targets and drops malformed entries', () => {
    const raw =
      'noise {"keywords":"rag eval","targets":[' +
      '{"kind":"subreddit","value":"MachineLearning"},' +
      '{"kind":"domain","value":"stackoverflow.com"},' +
      '{"kind":"bogus","value":"x"},{"kind":"domain","value":""}]} trailing';
    const out = parseCommunityProposal(raw);
    expect(out.keywords).toBe('rag eval');
    expect(out.targets).toEqual([
      { kind: 'subreddit', value: 'MachineLearning' },
      { kind: 'domain', value: 'stackoverflow.com' }
    ]);
  });

  it('throws when keywords or targets are missing', () => {
    expect(() => parseCommunityProposal('{"keywords":"","targets":[]}')).toThrow();
    expect(() => parseCommunityProposal('not json')).toThrow();
  });
});

describe('rankAndSelect', () => {
  it('keeps the top 5 by score and default-enables the top 3', () => {
    const scored = [10, 90, 50, 70, 30, 60].map((score, i) => ({
      target: { kind: 'domain' as const, value: `d${i}.com` },
      score,
      label: `d${i}.com`,
      scoreLabel: `排名 #${i}`
    }));
    const sources = rankAndSelect('kw', scored);
    expect(sources).toHaveLength(5);
    expect(sources.map((s) => s.score)).toEqual([90, 70, 60, 50, 30]); // sorted desc, 10 dropped
    expect(sources.map((s) => s.enabled)).toEqual([true, true, true, false, false]);
    expect(sources.every((s) => s.api === 'community' && s.query === 'kw')).toBe(true);
  });
});

describe('buildCommunityDimension', () => {
  const proposal = JSON.stringify({
    keywords: 'rag',
    targets: [
      { kind: 'subreddit', value: 'big' },
      { kind: 'subreddit', value: 's1' },
      { kind: 'subreddit', value: 'dead' },
      { kind: 'domain', value: 'top.com' },
      { kind: 'domain', value: 'd1.com' }
    ]
  });
  const llm = { complete: vi.fn(async () => proposal) } as any;

  const scorers: CommunityScorers = {
    scoreSubreddit: async (n) => {
      if (n === 'dead') throw new Error('private');
      return { score: n === 'big' ? 80 : 40, label: `r/${n}`, scoreLabel: '订阅' };
    },
    scoreDomain: (d) => ({ score: d === 'top.com' ? 90 : 10, scoreLabel: '排名' }),
    scoreHn: () => ({ score: 92, label: 'Hacker News', scoreLabel: '头部技术社区' })
  };

  it('prepends HN, scores in parallel, drops failures, keeps top 5, enables top 3', async () => {
    const dim = await buildCommunityDimension('q?', llm, 'm', '社区与网站', scorers);
    expect(dim.key).toBe('community');
    expect(dim.label).toBe('社区与网站');

    // candidates: HN(92), big(80), s1(40), dead(reject→dropped), top.com(90), d1(10)
    // ranked desc: HN, top.com, big, s1, d1 → exactly 5
    const labels = dim.sources.map((s) => s.label);
    expect(labels).toEqual(['Hacker News', 'top.com', 'r/big', 'r/s1', 'd1.com']);
    expect(dim.sources.map((s) => s.enabled)).toEqual([true, true, true, false, false]);
    expect(dim.sources[0].target).toEqual({ kind: 'hn', value: 'hackernews' });
    expect(dim.sources.every((s) => s.query === 'rag')).toBe(true);
  });

  it('appends an OFF-by-default open-web card after the vetted picks when broad.web', async () => {
    const dim = await buildCommunityDimension('q?', llm, 'm', '搜索来源', scorers, { web: true, writing: false });
    const last = dim.sources[dim.sources.length - 1];
    expect(last.target).toEqual({ kind: 'web', value: 'open-web' });
    expect(last.label).toBe('开放网络搜索');
    expect(last.enabled).toBe(false);
    // vetted top-3 still enabled; ids stay sequential across the appended card
    expect(dim.sources.slice(0, 3).every((s) => s.enabled)).toBe(true);
    expect(dim.sources.map((s) => s.id)).toEqual(dim.sources.map((_, i) => `community-${i + 1}`));
  });

  it('appends both broad cards (web then writing), both OFF, when broad.web+writing', async () => {
    const dim = await buildCommunityDimension('q?', llm, 'm', '搜索来源', scorers, { web: true, writing: true });
    const broad = dim.sources.filter((s) => s.target && (s.target.kind === 'web' || s.target.kind === 'writing'));
    expect(broad.map((s) => s.target!.kind)).toEqual(['web', 'writing']);
    expect(broad.every((s) => !s.enabled)).toBe(true);
  });

  it('国内 (domestic) drops subreddits and never prepends Hacker News', async () => {
    const dim = await buildCommunityDimension('q?', llm, 'm', '搜索来源', scorers, { web: false, writing: false }, 'domestic');
    // only the two domain targets survive (top.com 90, d1.com 10), ranked desc; no HN, no subreddits
    expect(dim.sources.map((s) => s.label)).toEqual(['top.com', 'd1.com']);
    expect(dim.sources.every((s) => s.target?.kind === 'domain')).toBe(true);
    expect(dim.sources.some((s) => s.target?.kind === 'hn' || s.target?.kind === 'subreddit')).toBe(false);
  });

  it('国外 (foreign) keeps Hacker News as the head-of-community candidate', async () => {
    const dim = await buildCommunityDimension('q?', llm, 'm', '搜索来源', scorers, { web: false, writing: false }, 'foreign');
    expect(dim.sources[0].target).toEqual({ kind: 'hn', value: 'hackernews' });
  });
});
