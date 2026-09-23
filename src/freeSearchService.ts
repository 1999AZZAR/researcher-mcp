import axios from "axios";
import * as cheerio from "cheerio";

export interface FreeSearchItem {
  title: string;
  link: string;
  snippet: string;
  engine: string;
}

const UA =
  process.env.RESEARCHER_USER_AGENT ?? "hela-enzyme/1.0 (researcher-mcp; keyless)";
const ENGINE_TIMEOUT_MS = 8000;

function get(url: string, params?: Record<string, string>) {
  return axios.get<string>(url, {
    params,
    timeout: ENGINE_TIMEOUT_MS,
    headers: { "User-Agent": UA, Accept: "text/html" },
    responseType: "text",
  });
}

function clean(s: string): string {
  return (s ?? "").replace(/\s+/g, " ").trim();
}

/** Drop tracker/redirect wrappers back to the real destination URL. */
export function unwrapUrl(href: string): string {
  try {
    if (href.startsWith("//")) href = "https:" + href;
    const u = new URL(href);
    const uddg = u.searchParams.get("uddg");
    if (uddg) return uddg;
    const url = u.searchParams.get("url");
    if (url && /^https?:\/\//.test(url)) return url;
    return href;
  } catch {
    return href;
  }
}

type Adapter = (query: string, n: number) => Promise<FreeSearchItem[]>;

async function mojeek(query: string, n: number): Promise<FreeSearchItem[]> {
  const res = await get("https://www.mojeek.com/search", { q: query });
  const $ = cheerio.load(res.data);
  const out: FreeSearchItem[] = [];
  $("ul.results-standard > li").each((_, li) => {
    if (out.length >= n) return;
    const a = $(li).find("h2 a[href^='http']").first();
    const link = a.attr("href");
    if (!link) return;
    const snippet = clean($(li).find("p").first().text());
    out.push({ title: clean(a.text()), link, snippet, engine: "mojeek" });
  });
  return out;
}

async function duckduckgo(query: string, n: number): Promise<FreeSearchItem[]> {
  const res = await axios.post<string>(
    "https://html.duckduckgo.com/html/",
    new URLSearchParams({ q: query }).toString(),
    {
      timeout: ENGINE_TIMEOUT_MS,
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      responseType: "text",
    }
  );
  const $ = cheerio.load(res.data);
  const out: FreeSearchItem[] = [];
  $("a.result__a").each((_, a) => {
    if (out.length >= n) return;
    const link = unwrapUrl($(a).attr("href") ?? "");
    if (!/^https?:\/\//.test(link)) return;
    const snippet = clean($(a).closest(".result").find(".result__snippet").text());
    out.push({ title: clean($(a).text()), link, snippet, engine: "duckduckgo" });
  });
  return out;
}

async function yep(query: string, n: number): Promise<FreeSearchItem[]> {
  const res = await get("https://yep.com/web", { q: query });
  const $ = cheerio.load(res.data);
  const out: FreeSearchItem[] = [];
  $("main a[href^='http']").each((_, a) => {
    if (out.length >= n) return;
    const link = $(a).attr("href") ?? "";
    if (/yep\.com/i.test(link)) return;
    const title = clean($(a).text());
    if (!title) return;
    out.push({ title, link, snippet: "", engine: "yep" });
  });
  return out;
}

async function bing(query: string, n: number): Promise<FreeSearchItem[]> {
  const res = await get("https://www.bing.com/search", { q: query });
  const $ = cheerio.load(res.data);
  const out: FreeSearchItem[] = [];
  $("li.b_algo h2 a[href^='http']").each((_, a) => {
    if (out.length >= n) return;
    const link = $(a).attr("href") ?? "";
    const snippet = clean($(a).closest("li.b_algo").find("p").first().text());
    out.push({ title: clean($(a).text()), link, snippet, engine: "bing" });
  });
  return out;
}

const ENGINES: Record<string, Adapter> = { mojeek, duckduckgo, yep, bing };

export function listFreeEngines(): string[] {
  return Object.keys(ENGINES);
}

function normalizeUrl(u: string): string {
  try {
    const p = new URL(u);
    return (p.hostname + p.pathname).toLowerCase().replace(/\/$/, "");
  } catch {
    return u.toLowerCase();
  }
}

export interface FreeSearchResult {
  items: FreeSearchItem[];
  enginesUsed: string[];
  enginesFailed: string[];
}

/**
 * Fan out to all keyless engines in parallel. One engine failing (bot
 * block, markup change, timeout) never fails the whole call — failures
 * are reported in enginesFailed so callers can see coverage.
 */
export async function freeSearch(
  query: string,
  opts: { maxResults?: number; engines?: string[] } = {}
): Promise<FreeSearchResult> {
  const maxResults = opts.maxResults ?? 10;
  const wanted = (opts.engines ?? Object.keys(ENGINES)).filter((e) => ENGINES[e]);
  const settled = await Promise.allSettled(
    wanted.map((e) => ENGINES[e](query, maxResults))
  );
  const items: FreeSearchItem[] = [];
  const enginesUsed: string[] = [];
  const enginesFailed: string[] = [];
  settled.forEach((r, i) => {
    if (r.status === "fulfilled" && r.value.length > 0) {
      enginesUsed.push(wanted[i]);
      items.push(...r.value);
    } else {
      enginesFailed.push(wanted[i]);
    }
  });
  const seen = new Set<string>();
  const deduped = items.filter((it) => {
    const k = normalizeUrl(it.link);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  return { items: deduped.slice(0, maxResults), enginesUsed, enginesFailed };
}

/**
 * Keyless content extraction via Jina reader. Anonymous use is rate
 * limited; set JINA_API_KEY for higher quota.
 */
export async function freeExtract(url: string): Promise<{
  title: string;
  content: string;
  wordCount: number;
}> {
  const headers: Record<string, string> = { "User-Agent": UA };
  if (process.env.JINA_API_KEY) {
    headers.Authorization = `Bearer ${process.env.JINA_API_KEY}`;
  }
  const res = await axios.get<string>(`https://r.jina.ai/${url}`, {
    timeout: 15000,
    headers,
    responseType: "text",
  });
  const content = clean(String(res.data)).slice(0, 10000);
  return {
    title: url,
    content,
    wordCount: content.split(/\s+/).filter(Boolean).length,
  };
}
