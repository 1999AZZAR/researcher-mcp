import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { EnhancedWikipediaService } from "./wikipediaService.js";
import { WikipediaExtendedFeatures } from "./additionalFeatures.js";
import { GoogleSearchService } from "./googleSearchService.js";
import { createWikipediaMcp } from "./mcp.js";
import { registerEnvTool } from "./envelope.js";
import {
  searchProvenance,
  wikipediaSearchUrl,
  formatSourcesFooter,
  type SourceProvenance,
} from "./provenance.js";

function googleSource(query: string): SourceProvenance {
  return {
    source: `https://www.google.com/search?q=${encodeURIComponent(query)}`,
    retrieved_at: new Date().toISOString(),
    confidence: 0.85,
    freshness: "fresh",
  };
}

function formatGoogleItems(items: Array<{ title: string; link: string; snippet: string }>): string {
  if (!items || items.length === 0) return "No results.";
  return items
    .map((r, i) => `${i + 1}. ${r.title}\n   ${r.link}\n   ${r.snippet ?? ""}`)
    .join("\n");
}

/**
 * Build the combined modular server: the 10 Wikipedia tools from mcp.ts
 * plus the Google-backed tools. Google tools are registered only when a
 * GoogleSearchService is provided (API keys present); Wikipedia always is.
 */
export function createCombinedMcp(
  wikipediaService: EnhancedWikipediaService,
  extendedFeatures: WikipediaExtendedFeatures,
  googleSearchService: GoogleSearchService | null
): McpServer {
  const server = createWikipediaMcp(wikipediaService, extendedFeatures);

  if (!googleSearchService) {
    console.error("Google tools skipped: GOOGLE_API_KEY / GOOGLE_CSE_ID not set");
    return server;
  }
  const google = googleSearchService;

  registerEnvTool(
    server,
    "google_search",
    {
      title: "Google Search",
      description: "Web search via Google Custom Search.",
      inputSchema: {
        query: z.string().describe("The search query."),
        num: z.number().min(1).max(10).optional().describe("Max results (1-10)."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const data = await google.search({ q: args.query, num: args.num ?? 5 });
      const items = data.items ?? [];
      const footer = formatSourcesFooter([
        googleSource(args.query),
        searchProvenance(args.query),
      ]);
      return `${formatGoogleItems(items)}\n\n${footer}`;
    }
  );

  registerEnvTool(
    server,
    "academic_search",
    {
      title: "Academic Search",
      description: "Search academic sources (arXiv, Scholar, ResearchGate).",
      inputSchema: {
        query: z.string().describe("The research query."),
        sites: z.array(z.string()).optional().describe("Academic sites to restrict to."),
        maxResults: z.number().min(1).max(10).optional().describe("Max results."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const data = await google.searchAcademic(args.query, {
        sites: args.sites,
        maxResults: args.maxResults ?? 5,
      });
      const footer = formatSourcesFooter([
        googleSource(args.query),
        searchProvenance(args.query),
      ]);
      return `${formatGoogleItems(data.items ?? [])}\n\n${footer}`;
    }
  );

  registerEnvTool(
    server,
    "news_search",
    {
      title: "News Search",
      description: "Search recent news on a topic.",
      inputSchema: {
        topic: z.string().describe("The news topic."),
        language: z.string().optional().describe("Language code, e.g. en."),
        maxResults: z.number().min(1).max(10).optional().describe("Max results."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const data = await google.searchNews(args.topic, {
        language: args.language,
        maxResults: args.maxResults ?? 5,
      });
      const footer = formatSourcesFooter([
        googleSource(args.topic),
        searchProvenance(args.topic),
      ]);
      return `${formatGoogleItems(data.items ?? [])}\n\n${footer}`;
    }
  );

  registerEnvTool(
    server,
    "multi_site_search",
    {
      title: "Multi-site Search",
      description: "Search one query across several specific sites.",
      inputSchema: {
        query: z.string().describe("The search query."),
        sites: z.array(z.string()).describe("Sites to search, e.g. [\"arxiv.org\"]."),
        maxResults: z.number().min(1).max(10).optional().describe("Max results per site."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const data = await google.searchMultipleSites(args.query, args.sites, {
        maxResults: args.maxResults ?? 5,
      });
      const footer = formatSourcesFooter([
        googleSource(`site:${args.sites.join(" OR site:")} ${args.query}`),
        searchProvenance(args.query),
      ]);
      return `${formatGoogleItems(data.items ?? [])}\n\n${footer}`;
    }
  );

  registerEnvTool(
    server,
    "extract_content",
    {
      title: "Extract Content",
      description: "Fetch a URL and extract/analyze its main content.",
      inputSchema: {
        url: z.string().describe("The URL to extract."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const a = await google.extractContent(args.url);
      const footer = formatSourcesFooter([
        {
          source: args.url,
          retrieved_at: new Date().toISOString(),
          confidence: 0.9,
          freshness: "fresh",
        },
      ]);
      return [
        `# ${a.title}`,
        ``,
        a.content.slice(0, 8000),
        ``,
        `(${a.wordCount} words, sentiment ${a.sentiment.score})`,
        ``,
        footer,
      ].join("\n");
    }
  );

  registerEnvTool(
    server,
    "research_brief",
    {
      title: "Research Brief",
      description:
        "One-call brief: fans out to Google + Wikipedia in parallel, dedups overlap, exact matches first.",
      inputSchema: {
        query: z.string().describe("The research question."),
        maxResults: z.number().min(1).max(10).optional().describe("Max results per source."),
        lang: z.string().optional().describe("Wikipedia language, default en."),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    async (args) => {
      const n = args.maxResults ?? 5;
      const lang = args.lang ?? "en";
      const [g, w] = await Promise.all([
        google.search({ q: args.query, num: n }),
        wikipediaService.search(args.query, { limit: n, lang }),
      ]);
      const gItems: Array<{ title: string; link: string; snippet: string }> = g.items ?? [];
      const seen = new Set(gItems.map((r) => r.link));
      const wikiUrl = (title: string) =>
        `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`;
      const wItems: Array<{ title: string; link: string; snippet: string }> = (w ?? [])
        .filter((p: any) => !seen.has(wikiUrl(p.title ?? "")))
        .map((p: any) => ({
          title: p.title ?? "",
          link: wikiUrl(p.title ?? ""),
          snippet: p.snippet ?? p.description ?? "",
        }));
      const footer = formatSourcesFooter([
        googleSource(args.query),
        searchProvenance(args.query, lang),
        {
          source: wikipediaSearchUrl(args.query, lang),
          retrieved_at: new Date().toISOString(),
          confidence: 0.85,
          freshness: "fresh",
        },
      ]);
      return [
        `# Research brief: ${args.query}`,
        ``,
        `## Google`,
        formatGoogleItems(gItems),
        ``,
        `## Wikipedia`,
        formatGoogleItems(wItems),
        ``,
        footer,
      ].join("\n");
    }
  );

  return server;
}
