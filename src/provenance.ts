/**
 * C2 provenance helpers for researcher-mcp.
 *
 * Every externally-sourced fact this server returns must carry a provenance
 * ref — source URI, retrieved_at, confidence, freshness — mirroring the
 * `HelaProvenanceRef` shape defined in chaining-mcp
 * (`src/agent/hela-result.ts`). Shape is duplicated (not imported) because
 * each MCP server builds and deploys independently.
 *
 * Confidence rubric (documented, not calibrated):
 * - full page parse (getPage):            0.95 (authoritative, verbatim)
 * - REST summary extract (getPageSummary): 0.9 (authoritative, abridged)
 * - search ranking hit (search):           0.85 (relevant, unverified content)
 *
 * Freshness is always `fresh`: these tools call the live Wikipedia API per
 * request. (The in-process LRU cache sits inside the service layer; tool
 * outputs reflect a live retrieval, never a persisted snapshot.)
 */

export type ProvenanceFreshness = 'fresh' | 'cached' | 'stale';

export interface SourceProvenance {
  /** Canonical URI of the source (page URL, search URL). */
  source: string;
  /** ISO-8601 timestamp of retrieval. */
  retrieved_at: string;
  /** 0..1 per the rubric above. */
  confidence: number;
  /** Retrieval freshness. */
  freshness: ProvenanceFreshness;
}

/** Canonical desktop URL for a Wikipedia article title. */
export function wikipediaPageUrl(title: string, lang = 'en'): string {
  return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`;
}

/** Reproducible URL for a Wikipedia full-text search. */
export function wikipediaSearchUrl(query: string, lang = 'en'): string {
  return `https://${lang}.wikipedia.org/w/index.php?search=${encodeURIComponent(query)}&title=Special%3ASearch&profile=default&fulltext=1`;
}

/** Provenance ref for a full page parse. */
export function pageProvenance(title: string, lang = 'en', retrievedAt = new Date().toISOString()): SourceProvenance {
  return {
    source: wikipediaPageUrl(title, lang),
    retrieved_at: retrievedAt,
    confidence: 0.95,
    freshness: 'fresh',
  };
}

/** Provenance ref for a REST summary extract. */
export function summaryProvenance(title: string, lang = 'en', retrievedAt = new Date().toISOString()): SourceProvenance {
  return {
    source: wikipediaPageUrl(title, lang),
    retrieved_at: retrievedAt,
    confidence: 0.9,
    freshness: 'fresh',
  };
}

/** Provenance ref for a search ranking (content unverified — see rubric). */
export function searchProvenance(query: string, lang = 'en', retrievedAt = new Date().toISOString()): SourceProvenance {
  return {
    source: wikipediaSearchUrl(query, lang),
    retrieved_at: retrievedAt,
    confidence: 0.85,
    freshness: 'fresh',
  };
}

/**
 * Render refs as a `Sources:` footer appended to tool text output.
 * Empty list renders empty string (no footer noise on not-found paths).
 */
export function formatSourcesFooter(sources: SourceProvenance[]): string {
  if (sources.length === 0) return '';
  const lines = sources.map(
    (s) => `- ${s.source} (retrieved ${s.retrieved_at}, confidence ${s.confidence}, ${s.freshness})`,
  );
  return `\n\nSources:\n${lines.join('\n')}`;
}
