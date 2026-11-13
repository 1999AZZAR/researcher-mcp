# HeLa Enzyme: canonical tools

Server version **4.0.1**. Generated from the ecosystem schema catalog; regenerate with `npm run docs:generate -- --servers` in the ecosystem checkout.

Only names advertised by `tools/list` are listed here. Older aliases in migration examples are not additional tools. Runtime namespace prefixes are optional and do not change these server-local names.

## `academic_search`

Search academic papers and research documents

## `archive_org_search`

Search archived web pages on Archive.org (Wayback Machine)

## `citation_formatter`

Format citations in APA, MLA, or Chicago style

## `content_deduplication`

Remove duplicate content from search results and consolidate similar items

## `content_sentiment_analysis`

Analyze sentiment of text content using built-in sentiment analysis

## `content_summarizer`

Summarize content from multiple URLs

## `data_export`

Export research data in various formats (JSON, CSV, Markdown)

## `extract_content`

Canonical content extraction: fetch a URL and extract its main content. Use hela-cytosol browser_get_content (format=markdown) only when client-side JavaScript is required.

## `fact_checker`

Verify claims by searching for fact-checking sources

## `google_search`

Canonical web search: Google Custom Search API. Use for factual lookups; prefer over browser-scoped search.

## `keyword_extraction`

Extract key terms and topics from text content

## `multi_site_search`

Search across multiple specific websites simultaneously

## `news_monitor`

Monitor news and get alerts for specific topics

## `research_assistant`

Comprehensive research assistant with multi-query analysis

## `research_brief`

One-call research brief: fans out to Google + Wikipedia in parallel, dedups cross-source overlap, ranks exact matches first. Replaces chaining google_search + wikipedia_search manually.

## `research_session_manager`

Manage research sessions, save findings, and organize notes

Actions: `save`, `load`, `list`, `delete`.

## `search_analytics`

Analyze search trends and get insights from multiple search queries

## `search_trends`

Track and analyze search interest trends over time

## `url_metadata_extractor`

Extract metadata from URLs including title, description, and basic info

## `wikipedia_get`

Get Wikipedia content by title, page ID, or multiple titles. Use format=summary for a short extract, format=full for cleaned article text. Exactly one of title, pageId, or titles is required.

## `wikipedia_get_pages_in_category`

Browse pages within a specific Wikipedia category

## `wikipedia_page_languages`

Get the languages a Wikipedia page is available in

## `wikipedia_random`

Get a random Wikipedia page

## `wikipedia_search`

Search Wikipedia by text query, multiple queries, or coordinates. Exactly one of query, queries, or coord is required. Nearby searches honour radius (metres).
