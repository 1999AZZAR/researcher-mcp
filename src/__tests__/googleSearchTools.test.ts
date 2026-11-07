import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import ResearchMCPServer from '../../research-server';
import { createCombinedMcp } from '../combinedMcp';
import { EnhancedWikipediaService } from '../wikipediaService';
import { WikipediaExtendedFeatures } from '../additionalFeatures';
import { GoogleSearchService } from '../googleSearchService';

type SearchResult = { items: Array<{ title: string; link: string; snippet: string }> };
type SearchMock = jest.Mock<Promise<SearchResult>, [{ q: string; num?: number }]>;

const factories: Array<[string, (search: SearchMock) => Server | McpServer]> = [
  ['shipped server', search => {
    const app = new ResearchMCPServer() as unknown as { server: Server; googleSearch: { search: SearchMock } };
    app.googleSearch.search = search;
    return app.server;
  }],
  ['modular server', search => {
    const wikipedia = new EnhancedWikipediaService();
    return createCombinedMcp(wikipedia, new WikipediaExtendedFeatures(wikipedia), { search } as unknown as GoogleSearchService);
  }],
];

describe.each(factories)('%s google_search contract', (_name, factory) => {
  let client: Client;
  let server: Server | McpServer;
  let search: SearchMock;

  beforeEach(async () => {
    search = jest.fn<Promise<SearchResult>, [{ q: string; num?: number }]>().mockResolvedValue({ items: [{ title: 'Result', link: 'https://example.test/', snippet: 'Offline fixture' }] });
    server = factory(search);
    client = new Client({ name: 'enzyme-contract-test', version: '1.0.0' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  test('advertises query as the only required search field, never q', async () => {
    const { tools } = await client.listTools();
    const tool = tools.find(entry => entry.name === 'google_search');
    expect(tool?.inputSchema.required).toEqual(['query']);
    expect(tool?.inputSchema.properties).toHaveProperty('query');
    expect(tool?.inputSchema.properties).not.toHaveProperty('q');
    expect(tool?.inputSchema.additionalProperties).toBe(false);
    expect(tools.every(entry => !Object.hasOwn(entry.inputSchema.properties ?? {}, 'q'))).toBe(true);
  });

  test('maps query to the provider HTTP q parameter and defaults num', async () => {
    const result = await client.callTool({ name: 'google_search', arguments: { query: '  black holes  ' } });
    expect(result.isError).not.toBe(true);
    expect(search).toHaveBeenCalledWith({ q: 'black holes', num: 5 });
    expect(JSON.stringify(result)).toContain('Offline fixture');
  });

  test('preserves the requested result count', async () => {
    await client.callTool({ name: 'google_search', arguments: { query: 'black holes', num: 2 } });
    expect(search).toHaveBeenCalledWith({ q: 'black holes', num: 2 });
  });

  test.each([
    {},
    { q: 'old input' },
    { query: 'valid input', q: 'old input' },
    { query: '' },
    { query: '   ' },
    { query: 42 },
    { query: null },
    { query: ['black holes'] },
    { query: 'black holes', num: 0 },
    { query: 'black holes', num: 11 },
    { query: 'black holes', num: 1.5 },
    { query: 'black holes', num: '5' },
  ])('rejects invalid or obsolete input before calling the provider: %j', async arguments_ => {
    const result = await client.callTool({ name: 'google_search', arguments: arguments_ });
    expect(result.isError).toBe(true);
    expect(search).not.toHaveBeenCalled();
  });

  test('reports a provider failure as an MCP tool error', async () => {
    search.mockRejectedValueOnce(new Error('Offline provider failure'));
    const result = await client.callTool({ name: 'google_search', arguments: { query: 'black holes' } });
    expect(result.isError).toBe(true);
  });
});
