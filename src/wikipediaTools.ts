export type WikipediaFormat = 'summary' | 'full';

export interface ToolTextResult {
  content: Array<{ type: 'text'; text: string }>;
}

export interface WikipediaToolDeps {
  defaultLang: string;
  request(params: Record<string, unknown>, lang: string): Promise<any>;
  search(query: string, opts: { lang: string; limit: number }): Promise<any>;
  getPage(title: string, opts: { lang: string }): Promise<any>;
  getPageById(id: number, opts: { lang: string }): Promise<any>;
  cleanContent(text: string): string;
}

type GetPlan =
  | { mode: 'title'; title: string; lang: string; format: WikipediaFormat }
  | { mode: 'pageId'; pageId: number; lang: string; format: WikipediaFormat }
  | { mode: 'titles'; titles: string[]; lang: string; format: WikipediaFormat };

type SearchPlan =
  | { mode: 'query'; query: string; lang: string; limit: number }
  | { mode: 'queries'; queries: string[]; lang: string; limit: number }
  | { mode: 'coord'; lat: number; lon: number; radius: number; lang: string; limit: number };

export const WIKIPEDIA_GET_TOOL = {
  name: 'wikipedia_get',
  description:
    'Get Wikipedia content by title, page ID, or multiple titles. Use format=summary for a short extract, format=full for cleaned article text. Exactly one of title, pageId, or titles is required.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Page title (exactly one of title, pageId, or titles).' },
      pageId: { type: 'integer', minimum: 1, description: 'Wikipedia page ID.' },
      titles: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 10,
        description: 'Multiple page titles (max 10).',
      },
      lang: { type: 'string', description: 'Language code', default: 'en' },
      format: {
        type: 'string',
        enum: ['summary', 'full'],
        description: 'summary returns a three-sentence extract; full returns cleaned article text.',
        default: 'full',
      },
    },
  },
} as const;

export const WIKIPEDIA_SEARCH_TOOL = {
  name: 'wikipedia_search',
  description:
    'Search Wikipedia by text query, multiple queries, or coordinates. Exactly one of query, queries, or coord is required. Nearby searches honour radius (metres).',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Single search query.' },
      queries: {
        type: 'array',
        items: { type: 'string' },
        minItems: 1,
        maxItems: 10,
        description: 'Multiple search queries (max 10).',
      },
      coord: {
        type: 'object',
        properties: {
          lat: { type: 'number', minimum: -90, maximum: 90 },
          lon: { type: 'number', minimum: -180, maximum: 180 },
        },
        required: ['lat', 'lon'],
        description: 'Coordinates for a geosearch.',
      },
      lang: { type: 'string', description: 'Language code', default: 'en' },
      limit: {
        type: 'number',
        minimum: 1,
        maximum: 50,
        description: 'Results per query (max 10), or nearby results (max 50).',
        default: 5,
      },
      radius: {
        type: 'number',
        minimum: 1,
        maximum: 10000,
        description: 'Nearby search radius in metres.',
        default: 1000,
      },
    },
  },
} as const;

export const WIKIPEDIA_TOOLS = [WIKIPEDIA_SEARCH_TOOL, WIKIPEDIA_GET_TOOL] as const;

export const WIKIPEDIA_LEGACY_ALIASES = [
  'wikipedia_get_page',
  'wikipedia_get_page_by_id',
  'wikipedia_get_summary',
  'wikipedia_batch_get_pages',
  'wikipedia_batch_search',
  'wikipedia_search_nearby',
] as const;

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${field} must be a non-empty string`);
  }
  return value.trim();
}

function optionalLang(value: unknown, fallback: string): string {
  if (value === undefined) return fallback;
  return requiredString(value, 'lang');
}

function optionalFormat(value: unknown): WikipediaFormat {
  if (value === undefined) return 'full';
  if (value === 'summary' || value === 'full') return value;
  throw new Error("format must be 'summary' or 'full'");
}

function titles(value: unknown, field: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`${field} must be a non-empty array`);
  }
  if (value.length > 10) throw new Error(`${field} supports at most 10 entries`);
  return value.map((entry, index) => requiredString(entry, `${field}[${index}]`));
}

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(Math.floor(parsed), min), max);
}

export function resolveWikipediaGetArgs(input: Record<string, unknown> = {}, defaultLang = 'en'): GetPlan {
  const lang = optionalLang(input['lang'], defaultLang);
  const format = optionalFormat(input['format']);
  const selectors = [input['title'], input['pageId'], input['titles']].filter(
    (value) => value !== undefined && value !== null
  );
  if (selectors.length !== 1) {
    throw new Error('exactly one of title, pageId, or titles is required');
  }
  if (input['title'] !== undefined) {
    return { mode: 'title', title: requiredString(input['title'], 'title'), lang, format };
  }
  if (input['pageId'] !== undefined) {
    const pageId = input['pageId'];
    if (typeof pageId !== 'number' || !Number.isInteger(pageId) || pageId < 1) {
      throw new Error('pageId must be a positive integer');
    }
    return { mode: 'pageId', pageId, lang, format };
  }
  return { mode: 'titles', titles: titles(input['titles'], 'titles'), lang, format };
}

export function resolveWikipediaSearchArgs(input: Record<string, unknown> = {}, defaultLang = 'en'): SearchPlan {
  const lang = optionalLang(input['lang'], defaultLang);
  const modes = [input['query'], input['queries'], input['coord']].filter(
    (value) => value !== undefined && value !== null
  );
  if (modes.length !== 1) {
    throw new Error('exactly one of query, queries, or coord is required');
  }
  if (input['query'] !== undefined) {
    return {
      mode: 'query',
      query: requiredString(input['query'], 'query'),
      lang,
      limit: clamp(input['limit'], 5, 1, 10),
    };
  }
  if (input['queries'] !== undefined) {
    return {
      mode: 'queries',
      queries: titles(input['queries'], 'queries'),
      lang,
      limit: clamp(input['limit'], 5, 1, 10),
    };
  }
  const coord = input['coord'];
  if (typeof coord !== 'object' || coord === null || Array.isArray(coord)) {
    throw new Error('coord must contain numeric lat and lon');
  }
  const { lat, lon } = coord as Record<string, unknown>;
  if (typeof lat !== 'number' || !Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new Error('coord.lat must be between -90 and 90');
  }
  if (typeof lon !== 'number' || !Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new Error('coord.lon must be between -180 and 180');
  }
  return {
    mode: 'coord',
    lat,
    lon,
    radius: clamp(input['radius'], 1000, 1, 10000),
    lang,
    limit: clamp(input['limit'], 10, 1, 50),
  };
}

export function wikipediaDeprecationWarning(name: string): string | undefined {
  if (!(WIKIPEDIA_LEGACY_ALIASES as readonly string[]).includes(name)) return undefined;
  const target = normalizeWikipediaToolCall(name).name;
  return `Deprecated tool "${name}" is now "${target}". The legacy alias remains available during the v1.2 transition.`;
}

export function normalizeWikipediaToolCall(
  name: string,
  args: Record<string, unknown> = {}
): { name: string; args: Record<string, unknown> } {
  if (!(WIKIPEDIA_LEGACY_ALIASES as readonly string[]).includes(name)) {
    return { name, args };
  }
  if (name === 'wikipedia_get_page_by_id') {
    return { name: 'wikipedia_get', args: { pageId: args['id'], lang: args['lang'], format: 'full' } };
  }
  if (name === 'wikipedia_get_summary') {
    return { name: 'wikipedia_get', args: { title: args['title'], lang: args['lang'], format: 'summary' } };
  }
  if (name === 'wikipedia_batch_get_pages') {
    return { name: 'wikipedia_get', args: { titles: args['titles'], lang: args['lang'], format: 'full' } };
  }
  if (name === 'wikipedia_batch_search') {
    return { name: 'wikipedia_search', args: { queries: args['queries'], lang: args['lang'], limit: args['limit'] } };
  }
  if (name === 'wikipedia_search_nearby') {
    return {
      name: 'wikipedia_search',
      args: {
        coord: { lat: args['lat'], lon: args['lon'] },
        radius: args['radius'],
        lang: args['lang'],
        limit: args['limit'],
      },
    };
  }
  return { name: 'wikipedia_get', args: { title: args['title'], lang: args['lang'], format: 'full' } };
}

function textResult(text: string): ToolTextResult {
  return { content: [{ type: 'text', text }] };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : 'Unknown error';
}

function isMissingPage(page: any): boolean {
  return !page || page.missing === true || Object.prototype.hasOwnProperty.call(page, 'missing');
}

function firstPage(payload: any): any | null {
  const pages = payload?.query?.pages;
  if (!pages || typeof pages !== 'object') return null;
  const key = Object.keys(pages)[0];
  return key === undefined ? null : pages[key];
}

function cleanSnippet(value: unknown): string {
  return String(value ?? 'No snippet available').replace(/<[^>]+>/g, '').trim();
}

function missingSummary(title: string, lang: string): string {
  return `Summary for Wikipedia page "${title}" not found (${lang}).`;
}

export async function runWikipediaGet(
  input: Record<string, unknown>,
  deps: WikipediaToolDeps
): Promise<ToolTextResult> {
  let plan: GetPlan;
  try {
    plan = resolveWikipediaGetArgs(input, deps.defaultLang);
  } catch (error) {
    return textResult(`Wikipedia get failed: ${errorText(error)}`);
  }

  if (plan.mode === 'title') {
    try {
      if (plan.format === 'summary') {
        const payload = await deps.request(
          {
            action: 'query',
            format: 'json',
            prop: 'extracts',
            titles: plan.title,
            exsentences: '3',
            explaintext: '1',
            exsectionformat: 'plain',
          },
          plan.lang
        );
        const page = firstPage(payload);
        if (isMissingPage(page)) return textResult(missingSummary(plan.title, plan.lang));
        return textResult(`Summary for "${plan.title}":\n\n${page.extract || 'No summary available'}`);
      }
      const payload = await deps.getPage(plan.title, { lang: plan.lang });
      const page = firstPage(payload);
      if (isMissingPage(page)) {
        return textResult(`Wikipedia page "${plan.title}" not found.`);
      }
      const content = deps.cleanContent(page.extract || 'No content available').substring(0, 2000);
      return textResult(`**${page.title || plan.title}**\n\n${content}...`);
    } catch (error) {
      return textResult(`Failed to get Wikipedia page: ${errorText(error)}`);
    }
  }

  if (plan.mode === 'pageId') {
    try {
      if (plan.format === 'summary') {
        const payload = await deps.request(
          {
            action: 'query',
            format: 'json',
            prop: 'extracts',
            pageids: plan.pageId,
            exsentences: '3',
            explaintext: '1',
            exsectionformat: 'plain',
          },
          plan.lang
        );
        const page = firstPage(payload);
        if (isMissingPage(page)) {
          return textResult(`Summary for Wikipedia page ID ${plan.pageId} not found.`);
        }
        return textResult(`Summary for "${page.title}":\n\n${page.extract || 'No summary available'}`);
      }
      const payload = await deps.getPageById(plan.pageId, { lang: plan.lang });
      const page = firstPage(payload);
      if (isMissingPage(page)) {
        return textResult(`Wikipedia page with ID ${plan.pageId} not found.`);
      }
      const content = deps.cleanContent(page.extract || 'No content available').substring(0, 2000);
      return textResult(`**${page.title || `ID ${plan.pageId}`}**\n\n${content}...`);
    } catch (error) {
      return textResult(`Failed to get Wikipedia page by ID: ${errorText(error)}`);
    }
  }

  const results: Array<{ title: string; ok: boolean; text: string }> = [];
  for (const title of plan.titles) {
    try {
      if (plan.format === 'summary') {
        const payload = await deps.request(
          {
            action: 'query',
            format: 'json',
            prop: 'extracts',
            titles: title,
            exsentences: '3',
            explaintext: '1',
            exsectionformat: 'plain',
          },
          plan.lang
        );
        const page = firstPage(payload);
        results.push(
          !isMissingPage(page)
            ? { title, ok: true, text: page.extract || 'No summary available' }
            : { title, ok: false, text: 'Page not found' }
        );
      } else {
        const payload = await deps.getPage(title, { lang: plan.lang });
        const page = firstPage(payload);
        results.push(
          !isMissingPage(page)
            ? {
                title: page.title || title,
                ok: true,
                text: deps.cleanContent(page.extract || 'No content').substring(0, 500),
              }
            : { title, ok: false, text: 'Page not found' }
        );
      }
    } catch (error) {
      results.push({ title, ok: false, text: errorText(error) });
    }
  }

  const body = results
    .map((result) => {
      if (!result.ok) return `**${result.title}**: ${result.text}`;
      return plan.format === 'summary'
        ? `**${result.title}**\n   ${result.text}`
        : `**${result.title}**\n   ${result.text}...`;
    })
    .join('\n\n');
  const label = plan.format === 'summary' ? 'summary' : 'page';
  return textResult(`Batch Wikipedia ${label} results for ${results.length} pages:\n\n${body}`);
}

export async function runWikipediaSearch(
  input: Record<string, unknown>,
  deps: WikipediaToolDeps
): Promise<ToolTextResult> {
  let plan: SearchPlan;
  try {
    plan = resolveWikipediaSearchArgs(input, deps.defaultLang);
  } catch (error) {
    return textResult(`Wikipedia search failed: ${errorText(error)}`);
  }

  if (plan.mode === 'query') {
    try {
      const payload = await deps.search(plan.query, { lang: plan.lang, limit: plan.limit });
      const results = payload?.query?.search || [];
      const body = results
        .map((result: any) => `- **${result.title}**: ${cleanSnippet(result.snippet)}`)
        .join('\n');
      return textResult(`Found ${results.length} Wikipedia results for "${plan.query}":\n\n${body}`);
    } catch (error) {
      return textResult(`Wikipedia search failed: ${errorText(error)}`);
    }
  }

  if (plan.mode === 'queries') {
    const results: Array<{ query: string; ok: boolean; count: number; error?: string }> = [];
    for (const query of plan.queries) {
      try {
        const payload = await deps.search(query, { lang: plan.lang, limit: plan.limit });
        results.push({ query, ok: true, count: payload?.query?.search?.length || 0 });
      } catch (error) {
        results.push({ query, ok: false, count: 0, error: errorText(error) });
      }
    }
    const body = results
      .map((result) =>
        result.ok
          ? `"${result.query}": ${result.count} results`
          : `"${result.query}" failed: ${result.error}`
      )
      .join('\n');
    return textResult(`Batch Wikipedia search results for ${results.length} queries:\n\n${body}`);
  }

  try {
    const payload = await deps.request(
      {
        action: 'query',
        format: 'json',
        list: 'geosearch',
        gscoord: `${plan.lat}|${plan.lon}`,
        gsradius: plan.radius,
        gslimit: plan.limit,
        gsprop: 'type|name|country|region|globe',
      },
      plan.lang
    );
    const places = payload?.query?.geosearch || [];
    if (places.length === 0) {
      return textResult(
        `No Wikipedia articles found near coordinates (${plan.lat}, ${plan.lon}) within ${plan.radius}m radius.`
      );
    }
    const body = places
      .map(
        (place: any, index: number) =>
          `${index + 1}. ${place.title}\n   Distance: ${place.dist}m\n   Coordinates: ${place.lat}, ${place.lon}`
      )
      .join('\n\n');
    return textResult(
      `Found ${places.length} Wikipedia articles near (${plan.lat}, ${plan.lon}) within ${plan.radius}m:\n\n${body}`
    );
  } catch (error) {
    return textResult(`Wikipedia nearby search failed: ${errorText(error)}`);
  }
}
