import { describe, it, expect } from 'vitest';
import {
	buildProposePrompt,
	buildGithubProposePrompt,
	buildCommunityTargetsPrompt,
	parseProposedQueries
} from './propose';

describe('buildProposePrompt', () => {
  it('embeds the question and asks for a JSON array of web queries', () => {
    const p = buildProposePrompt('How does RAG work?');
    expect(p).toContain('How does RAG work?');
    expect(p.toLowerCase()).toContain('json');
  });

  it('peoples_writing variant targets personal long-form writing', () => {
    const p = buildProposePrompt('How does RAG work?', 'peoples_writing');
    expect(p).toContain('How does RAG work?');
    expect(p.toLowerCase()).toMatch(/blog|essay|personal|long-form|newsletter/);
  });

  it('community variant targets discussion forums (Reddit / HN)', () => {
    const p = buildProposePrompt('How does RAG work?', 'community');
    expect(p).toContain('How does RAG work?');
    expect(p.toLowerCase()).toMatch(/reddit|hacker news|forum|discussion/);
  });

  it('images variant targets visual image search', () => {
    const p = buildProposePrompt('How does RAG work?', 'images');
    expect(p).toContain('How does RAG work?');
    expect(p.toLowerCase()).toMatch(/image|unsplash|photo|visual/);
  });
});

describe('buildGithubProposePrompt', () => {
  it('embeds the need, asks for a JSON array, and encourages GitHub qualifiers', () => {
    const p = buildGithubProposePrompt('a fast local vector database');
    expect(p).toContain('a fast local vector database');
    expect(p.toLowerCase()).toContain('json');
    expect(p.toLowerCase()).toMatch(/github|repositor/);
    expect(p).toMatch(/stars:|language:|topic:/);
  });
});

describe('buildCommunityTargetsPrompt', () => {
	it('mixed (default) embeds the question and asks for the JSON object shape', () => {
		const p = buildCommunityTargetsPrompt('How does RAG work?');
		expect(p).toContain('How does RAG work?');
		expect(p).toContain('"keywords"');
		expect(p).toContain('"targets"');
		expect(p).toMatch(/混合|MIX/);
		// mixed keeps HN as the auto-added head candidate
		expect(p.toLowerCase()).toContain('hacker news');
	});

	it('domestic asks for Chinese-only domain sources, no subreddits, no HN', () => {
		const p = buildCommunityTargetsPrompt('如何做 RAG 评测？', 'domestic');
		expect(p).toContain('如何做 RAG 评测？');
		expect(p).toContain('国内');
		expect(p).toContain('知乎'); // seeds a domestic site
		expect(p).toMatch(/no subreddit/i);
		expect(p).toMatch(/no hacker news/i); // domestic never adds HN
		expect(p).toMatch(/chinese/i);
	});

	it('foreign asks for English international communities', () => {
		const p = buildCommunityTargetsPrompt('How does RAG work?', 'foreign');
		expect(p).toContain('How does RAG work?');
		expect(p).toContain('国外');
		expect(p.toLowerCase()).toContain('reddit');
		expect(p.toLowerCase()).toMatch(/english/);
	});
});

describe('parseProposedQueries', () => {
  it('extracts queries from a clean JSON array', () => {
    expect(parseProposedQueries('["a","b","c"]')).toEqual(['a', 'b', 'c']);
  });
  it('extracts a JSON array embedded in prose / code fences', () => {
    const raw = 'Sure!\n```json\n["x", "y"]\n```';
    expect(parseProposedQueries(raw)).toEqual(['x', 'y']);
  });
  it('caps at 3 and drops empties', () => {
    expect(parseProposedQueries('["a","","b","c","d"]')).toEqual(['a', 'b', 'c']);
  });
  it('throws when no array can be found', () => {
    expect(() => parseProposedQueries('no json here')).toThrow(/parse/i);
  });
  it('throws when the array yields no usable queries', () => {
    expect(() => parseProposedQueries('[]')).toThrow(/no usable queries/i);
    expect(() => parseProposedQueries('["", "  "]')).toThrow(/no usable queries/i);
  });
});
