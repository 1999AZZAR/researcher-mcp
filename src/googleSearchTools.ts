import { z } from 'zod';

export const googleSearchInput = z.strictObject({
  query: z.string().trim().min(1).describe('Search query'),
  num: z.number().int().min(1).max(10).default(5).describe('Number of results (1-10)'),
});

const inputSchema = z.toJSONSchema(googleSearchInput, { io: 'input' });
delete inputSchema.$schema;

export const GOOGLE_SEARCH_TOOL = {
  name: 'google_search',
  description: 'Canonical web search: Google Custom Search API. Use for factual lookups; prefer over browser-scoped search.',
  inputSchema: { ...inputSchema, type: 'object' as const },
};
