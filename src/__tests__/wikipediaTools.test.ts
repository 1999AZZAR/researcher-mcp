import {
  WIKIPEDIA_GET_TOOL,
  WIKIPEDIA_SEARCH_TOOL,
  WIKIPEDIA_TOOLS,
  WIKIPEDIA_LEGACY_ALIASES,
  normalizeWikipediaToolCall,
  resolveWikipediaGetArgs,
  resolveWikipediaSearchArgs,
  runWikipediaGet,
  runWikipediaSearch,
  type WikipediaToolDeps,
} from '../wikipediaTools';

function pagePayload(pages: Record<string, unknown>) {
  return { query: { pages } };
}

function searchPayload(results: Array<{ title: string; snippet?: string }>) {
  return { query: { search: results } };
}

function makeDeps(overrides: Partial<WikipediaToolDeps> = {}): WikipediaToolDeps {
  return {
    defaultLang: 'en',
    request: jest.fn(),
    search: jest.fn(),
    getPage: jest.fn(),
    getPageById: jest.fn(),
    cleanContent: jest.fn((text: string) => text.replace(/\s+/g, ' ').trim()),
    ...overrides,
  };
}

describe('Phase 3.B wikipedia tool consolidation', () => {
  test('advertises exactly the two consolidated tools', () => {
    expect(WIKIPEDIA_TOOLS).toHaveLength(2);
    expect(WIKIPEDIA_TOOLS.map((tool) => tool.name)).toEqual(['wikipedia_search', 'wikipedia_get']);
    expect(WIKIPEDIA_LEGACY_ALIASES).toHaveLength(6);
    for (const oldName of WIKIPEDIA_LEGACY_ALIASES) {
      expect(WIKIPEDIA_TOOLS.map((tool) => tool.name)).not.toContain(oldName);
    }
  });

  test('wikipedia_get schema exposes one-of selectors and summary/full formats', () => {
    expect(WIKIPEDIA_GET_TOOL.inputSchema.properties.title.type).toBe('string');
    expect(WIKIPEDIA_GET_TOOL.inputSchema.properties.pageId.minimum).toBe(1);
    expect(WIKIPEDIA_GET_TOOL.inputSchema.properties.titles.maxItems).toBe(10);
    expect(WIKIPEDIA_GET_TOOL.inputSchema.properties.format.enum).toEqual(['summary', 'full']);
    expect('required' in WIKIPEDIA_GET_TOOL.inputSchema).toBe(false);
  });

  test('wikipedia_search schema exposes query, batch, and nearby modes', () => {
    const props = WIKIPEDIA_SEARCH_TOOL.inputSchema.properties;
    expect(props.query.type).toBe('string');
    expect(props.queries.maxItems).toBe(10);
    expect(props.coord.required).toEqual(['lat', 'lon']);
    expect(props.radius.maximum).toBe(10000);
    expect(props.limit.maximum).toBe(50);
    expect('required' in WIKIPEDIA_SEARCH_TOOL.inputSchema).toBe(false);
  });
});

describe('wikipedia_get argument resolution', () => {
  test('defaults to full format and the dependency language', () => {
    expect(resolveWikipediaGetArgs({ title: 'Albert Einstein' }, 'id')).toEqual({
      mode: 'title',
      title: 'Albert Einstein',
      lang: 'id',
      format: 'full',
    });
  });

  test('resolves single-title summaries with an explicit language', () => {
    expect(resolveWikipediaGetArgs({ title: ' Einstein ', lang: 'de', format: 'summary' })).toEqual({
      mode: 'title',
      title: 'Einstein',
      lang: 'de',
      format: 'summary',
    });
  });

  test('resolves page IDs for full and summary reads', () => {
    expect(resolveWikipediaGetArgs({ pageId: 42 }, 'en')).toMatchObject({
      mode: 'pageId',
      pageId: 42,
      format: 'full',
    });
    expect(resolveWikipediaGetArgs({ pageId: 42, format: 'summary' }, 'en')).toMatchObject({
      mode: 'pageId',
      format: 'summary',
    });
  });

  test('resolves and trims title batches', () => {
    expect(resolveWikipediaGetArgs({ titles: [' A ', 'B'], format: 'summary' }, 'en')).toEqual({
      mode: 'titles',
      titles: ['A', 'B'],
      lang: 'en',
      format: 'summary',
    });
  });

  test.each([
    [{}, 'exactly one of title, pageId, or titles is required'],
    [{ title: 'A', pageId: 1 }, 'exactly one of title, pageId, or titles is required'],
    [{ titles: ['A'], format: 'unknown' }, "format must be 'summary' or 'full'"],
    [{ title: '   ' }, 'title must be a non-empty string'],
    [{ pageId: 0 }, 'pageId must be a positive integer'],
    [{ pageId: 1.5 }, 'pageId must be a positive integer'],
    [{ pageId: '1' }, 'pageId must be a positive integer'],
    [{ titles: [] }, 'titles must be a non-empty array'],
    [{ titles: ['A', ''], }, 'titles[1] must be a non-empty string'],
    [{ titles: new Array(11).fill('A') }, 'titles supports at most 10 entries'],
    [{ title: 'A', lang: '' }, 'lang must be a non-empty string'],
  ])('rejects invalid input %#', (input, message) => {
    expect(() => resolveWikipediaGetArgs(input as Record<string, unknown>)).toThrow(message);
  });
});

describe('wikipedia_search argument resolution', () => {
  test('resolves and clamps a single query', () => {
    expect(resolveWikipediaSearchArgs({ query: ' black holes ', limit: 99 }, 'fr')).toEqual({
      mode: 'query',
      query: 'black holes',
      lang: 'fr',
      limit: 10,
    });
  });

  test('resolves batch queries with a minimum limit of one', () => {
    expect(resolveWikipediaSearchArgs({ queries: ['a', 'b'], limit: -5 }, 'en')).toEqual({
      mode: 'queries',
      queries: ['a', 'b'],
      lang: 'en',
      limit: 1,
    });
  });

  test('resolves nearby defaults', () => {
    expect(resolveWikipediaSearchArgs({ coord: { lat: -6.2, lon: 106.8 } }, 'id')).toEqual({
      mode: 'coord',
      lat: -6.2,
      lon: 106.8,
      radius: 1000,
      lang: 'id',
      limit: 10,
    });
  });

  test('clamps nearby radius and result count', () => {
    expect(
      resolveWikipediaSearchArgs({ coord: { lat: 0, lon: 0 }, radius: 999999, limit: 999 }, 'en')
    ).toMatchObject({ radius: 10000, limit: 50 });
  });

  test.each([
    [{}, 'exactly one of query, queries, or coord is required'],
    [{ query: 'a', coord: { lat: 0, lon: 0 } }, 'exactly one of query, queries, or coord is required'],
    [{ query: '' }, 'query must be a non-empty string'],
    [{ queries: [] }, 'queries must be a non-empty array'],
    [{ queries: new Array(11).fill('a') }, 'queries supports at most 10 entries'],
    [{ coord: 'Jakarta' }, 'coord must contain numeric lat and lon'],
    [{ coord: { lat: 91, lon: 0 } }, 'coord.lat must be between -90 and 90'],
    [{ coord: { lat: 0, lon: 181 } }, 'coord.lon must be between -180 and 180'],
    [{ coord: { lat: '0', lon: 0 } }, 'coord.lat must be between -90 and 90'],
  ])('rejects invalid search input %#', (input, message) => {
    expect(() => resolveWikipediaSearchArgs(input as Record<string, unknown>)).toThrow(message);
  });
});

describe('legacy wikipedia aliases', () => {
  test.each([
    [
      'wikipedia_get_page',
      { title: 'A', lang: 'de' },
      { name: 'wikipedia_get', args: { title: 'A', lang: 'de', format: 'full' } },
    ],
    [
      'wikipedia_get_page_by_id',
      { id: 7, lang: 'fr' },
      { name: 'wikipedia_get', args: { pageId: 7, lang: 'fr', format: 'full' } },
    ],
    [
      'wikipedia_get_summary',
      { title: 'A', lang: 'es' },
      { name: 'wikipedia_get', args: { title: 'A', lang: 'es', format: 'summary' } },
    ],
    [
      'wikipedia_batch_get_pages',
      { titles: ['A', 'B'], lang: 'id' },
      { name: 'wikipedia_get', args: { titles: ['A', 'B'], lang: 'id', format: 'full' } },
    ],
    [
      'wikipedia_batch_search',
      { queries: ['a', 'b'], lang: 'en', limit: 3 },
      { name: 'wikipedia_search', args: { queries: ['a', 'b'], lang: 'en', limit: 3 } },
    ],
    [
      'wikipedia_search_nearby',
      { lat: 1, lon: 2, radius: 500, lang: 'id', limit: 4 },
      {
        name: 'wikipedia_search',
        args: { coord: { lat: 1, lon: 2 }, radius: 500, lang: 'id', limit: 4 },
      },
    ],
  ])('maps %s', (name, args, expected) => {
    expect(normalizeWikipediaToolCall(name, args as Record<string, unknown>)).toEqual(expected);
  });

  test('canonical names and unknown tools pass through unchanged', () => {
    const args = { title: 'A', format: 'summary' };
    expect(normalizeWikipediaToolCall('wikipedia_get', args)).toEqual({
      name: 'wikipedia_get',
      args,
    });
    expect(normalizeWikipediaToolCall('fact_checker', { claim: 'x' })).toEqual({
      name: 'fact_checker',
      args: { claim: 'x' },
    });
  });
});

describe('runWikipediaGet', () => {
  test('returns cleaned full text by title', async () => {
    const deps = makeDeps({
      getPage: jest.fn().mockResolvedValue(
        pagePayload({ 1: { title: 'Mercury', extract: 'Mercury   is  a planet.' } })
      ),
    });
    const result = await runWikipediaGet({ title: 'Mercury' }, deps);
    expect(result.content[0].text).toBe('**Mercury**\n\nMercury is a planet....');
    expect(deps.getPage).toHaveBeenCalledWith('Mercury', { lang: 'en' });
  });

  test('returns a three-sentence summary through the action API', async () => {
    const request = jest.fn().mockResolvedValue(pagePayload({ 1: { title: 'Mercury', extract: 'Short.' } }));
    const deps = makeDeps({ request });
    const result = await runWikipediaGet({ title: 'Mercury', format: 'summary', lang: 'de' }, deps);
    expect(result.content[0].text).toBe('Summary for "Mercury":\n\nShort.');
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ titles: 'Mercury', exsentences: '3', explaintext: '1' }),
      'de'
    );
  });

  test('reads full pages by ID', async () => {
    const deps = makeDeps({
      getPageById: jest.fn().mockResolvedValue(pagePayload({ 42: { title: 'Answer', extract: 'Forty two.' } })),
    });
    const result = await runWikipediaGet({ pageId: 42 }, deps);
    expect(result.content[0].text).toContain('**Answer**');
    expect(deps.getPageById).toHaveBeenCalledWith(42, { lang: 'en' });
  });

  test('reads summaries by ID and reports missing IDs', async () => {
    const request = jest
      .fn()
      .mockResolvedValueOnce(pagePayload({ 42: { title: 'Answer', extract: 'Forty two.' } }))
      .mockResolvedValueOnce(pagePayload({ '-1': { title: 'Missing', missing: '' } }));
    const deps = makeDeps({ request });
    await expect(runWikipediaGet({ pageId: 42, format: 'summary' }, deps)).resolves.toEqual({
      content: [{ type: 'text', text: 'Summary for "Answer":\n\nForty two.' }],
    });
    await expect(runWikipediaGet({ pageId: 99, format: 'summary' }, deps)).resolves.toEqual({
      content: [{ type: 'text', text: 'Summary for Wikipedia page ID 99 not found.' }],
    });
  });

  test('returns not-found text for a missing title', async () => {
    const deps = makeDeps({
      getPage: jest.fn().mockResolvedValue(pagePayload({ '-1': { title: 'Missing', missing: '' } })),
    });
    await expect(runWikipediaGet({ title: 'Missing' }, deps)).resolves.toEqual({
      content: [{ type: 'text', text: 'Wikipedia page "Missing" not found.' }],
    });
  });

  test('processes full-title batches and isolates failures', async () => {
    const deps = makeDeps({
      getPage: jest
        .fn()
        .mockResolvedValueOnce(pagePayload({ 1: { title: 'A', extract: 'Alpha' } }))
        .mockRejectedValueOnce(new Error('network down')),
    });
    const result = await runWikipediaGet({ titles: ['A', 'B'] }, deps);
    const text = result.content[0].text;
    expect(text).toContain('Batch Wikipedia page results for 2 pages');
    expect(text).toContain('**A**');
    expect(text).toContain('Alpha...');
    expect(text).toContain('**B**: network down');
  });

  test('processes summary batches without a trailing ellipsis', async () => {
    const deps = makeDeps({
      request: jest
        .fn()
        .mockResolvedValueOnce(pagePayload({ 1: { title: 'A', extract: 'Alpha summary.' } }))
        .mockResolvedValueOnce(pagePayload({ '-1': { title: 'B', missing: '' } })),
    });
    const text = (await runWikipediaGet({ titles: ['A', 'B'], format: 'summary' }, deps)).content[0].text;
    expect(text).toContain('**A**\n   Alpha summary.');
    expect(text).not.toContain('Alpha summary....');
    expect(text).toContain('**B**: Page not found');
  });

  test('returns validation and network errors as text', async () => {
    const deps = makeDeps({
      getPage: jest.fn().mockRejectedValue(new Error('offline')),
    });
    await expect(runWikipediaGet({}, deps)).resolves.toEqual({
      content: [{ type: 'text', text: 'Wikipedia get failed: exactly one of title, pageId, or titles is required' }],
    });
    await expect(runWikipediaGet({ title: 'A' }, deps)).resolves.toEqual({
      content: [{ type: 'text', text: 'Failed to get Wikipedia page: offline' }],
    });
  });
});

describe('runWikipediaSearch', () => {
  test('formats single-query results and strips HTML snippets', async () => {
    const deps = makeDeps({
      search: jest.fn().mockResolvedValue(
        searchPayload([
          { title: 'Black hole', snippet: '<span class="searchmatch">Black</span> hole snippet' },
          { title: 'Event horizon' },
        ])
      ),
    });
    const text = (await runWikipediaSearch({ query: 'black hole', limit: 2 }, deps)).content[0].text;
    expect(text).toContain('Found 2 Wikipedia results for "black hole"');
    expect(text).toContain('**Black hole**: Black hole snippet');
    expect(text).toContain('**Event horizon**: No snippet available');
    expect(deps.search).toHaveBeenCalledWith('black hole', { lang: 'en', limit: 2 });
  });

  test('summarises batch searches and isolates failures', async () => {
    const deps = makeDeps({
      search: jest
        .fn()
        .mockResolvedValueOnce(searchPayload([{ title: 'A' }, { title: 'B' }]))
        .mockRejectedValueOnce(new Error('quota')),
    });
    const text = (await runWikipediaSearch({ queries: ['a', 'b'] }, deps)).content[0].text;
    expect(text).toContain('Batch Wikipedia search results for 2 queries');
    expect(text).toContain('"a": 2 results');
    expect(text).toContain('"b" failed: quota');
  });

  test('formats nearby results with distance and coordinates', async () => {
    const deps = makeDeps({
      request: jest.fn().mockResolvedValue({
        query: {
          geosearch: [{ title: 'Monas', dist: 120, lat: -6.17, lon: 106.82 }],
        },
      }),
    });
    const text = (
      await runWikipediaSearch({ coord: { lat: -6.17, lon: 106.82 }, radius: 500, limit: 3 }, deps)
    ).content[0].text;
    expect(text).toContain('Found 1 Wikipedia articles near (-6.17, 106.82) within 500m');
    expect(text).toContain('1. Monas\n   Distance: 120m\n   Coordinates: -6.17, 106.82');
    expect(deps.request).toHaveBeenCalledWith(
      expect.objectContaining({ list: 'geosearch', gscoord: '-6.17|106.82', gsradius: 500, gslimit: 3 }),
      'en'
    );
  });

  test('handles empty nearby results', async () => {
    const deps = makeDeps({ request: jest.fn().mockResolvedValue({ query: { geosearch: [] } }) });
    await expect(runWikipediaSearch({ coord: { lat: 0, lon: 0 } }, deps)).resolves.toEqual({
      content: [
        {
          type: 'text',
          text: 'No Wikipedia articles found near coordinates (0, 0) within 1000m radius.',
        },
      ],
    });
  });

  test('returns validation, query, and nearby network errors as text', async () => {
    const deps = makeDeps({
      search: jest.fn().mockRejectedValue(new Error('search offline')),
      request: jest.fn().mockRejectedValue(new Error('geo offline')),
    });
    await expect(runWikipediaSearch({}, deps)).resolves.toEqual({
      content: [{ type: 'text', text: 'Wikipedia search failed: exactly one of query, queries, or coord is required' }],
    });
    await expect(runWikipediaSearch({ query: 'x' }, deps)).resolves.toEqual({
      content: [{ type: 'text', text: 'Wikipedia search failed: search offline' }],
    });
    await expect(runWikipediaSearch({ coord: { lat: 0, lon: 0 } }, deps)).resolves.toEqual({
      content: [{ type: 'text', text: 'Wikipedia nearby search failed: geo offline' }],
    });
  });
});
