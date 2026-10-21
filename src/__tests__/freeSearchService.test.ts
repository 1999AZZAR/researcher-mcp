import axios from "axios";
import {
  freeSearch,
  freeExtract,
  unwrapUrl,
  listFreeEngines,
  arxivSearch,
  googleNewsSearch,
  hackerNewsSearch,
} from "../freeSearchService.js";

jest.mock("axios");
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe("freeSearchService", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("listFreeEngines exposes the keyless set", () => {
    expect(listFreeEngines()).toEqual(
      expect.arrayContaining(["mojeek", "duckduckgo", "yep", "bing"])
    );
  });

  test("unwrapUrl resolves duckduckgo redirect wrappers", () => {
    expect(unwrapUrl("//duckduckgo.com/l/?uddg=https%3A%2F%2Fexample.com%2Fx&rut=1")).toBe(
      "https://example.com/x"
    );
    expect(unwrapUrl("https://example.com/plain")).toBe("https://example.com/plain");
  });

  test("freeSearch merges engines and dedups by URL", async () => {
    mockedAxios.get.mockImplementation((url: string) => {
      if (url.includes("mojeek")) {
        return Promise.resolve({
          data: `<ul class="results-standard"><li><h2><a href="https://example.com/a">A title</a></h2><p>snip a</p></li></ul>`,
        });
      }
      if (url.includes("bing")) {
        return Promise.resolve({
          data: `<li class="b_algo"><h2><a href="https://example.com/a">A title</a></h2><p>snip a2</p></li><li class="b_algo"><h2><a href="https://example.com/b">B title</a></h2><p>snip b</p></li>`,
        });
      }
      return Promise.reject(new Error("blocked"));
    });
    mockedAxios.post.mockRejectedValue(new Error("blocked"));

    const r = await freeSearch("test query", { maxResults: 10, engines: ["mojeek", "bing"] });
    const links = r.items.map((i) => i.link);
    // example.com/a appears in both engines -> deduped to one
    expect(links).toEqual(["https://example.com/a", "https://example.com/b"]);
    expect(r.enginesUsed).toEqual(expect.arrayContaining(["mojeek", "bing"]));
    expect(r.enginesFailed).toEqual([]);
  });

  test("freeSearch reports failed engines instead of throwing", async () => {
    mockedAxios.get.mockRejectedValue(new Error("bot block"));
    mockedAxios.post.mockRejectedValue(new Error("bot block"));
    const r = await freeSearch("test query");
    expect(r.items).toEqual([]);
    expect(r.enginesUsed).toEqual([]);
    expect(r.enginesFailed).toEqual(
      expect.arrayContaining(["mojeek", "duckduckgo", "yep", "bing"])
    );
  });

  test("freeExtract returns word count and extracted title via jina reader", async () => {
    mockedAxios.get.mockResolvedValue({ data: "Title: Test Page Title\n\nhello world foo bar" });
    const a = await freeExtract("https://example.com/x");
    expect(a.title).toBe("Test Page Title");
    expect(a.wordCount).toBe(8);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://r.jina.ai/https://example.com/x",
      expect.anything()
    );
  });

  test("arxivSearch parses Atom XML feed", async () => {
    const mockXml = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>http://arxiv.org/abs/2301.00001</id>
    <title>Quantum Transformers in Deep Learning</title>
    <summary>A study on quantum transformer architectures.</summary>
    <published>2023-01-01T00:00:00Z</published>
    <author><name>Alice Smith</name></author>
    <author><name>Bob Jones</name></author>
    <category term="cs.AI"/>
  </entry>
</feed>`;
    mockedAxios.get.mockResolvedValue({ data: mockXml });

    const papers = await arxivSearch("quantum transformers", 5);
    expect(papers).toHaveLength(1);
    expect(papers[0].title).toBe("Quantum Transformers in Deep Learning");
    expect(papers[0].authors).toEqual(["Alice Smith", "Bob Jones"]);
    expect(papers[0].link).toBe("http://arxiv.org/abs/2301.00001");
    expect(papers[0].category).toBe("cs.AI");
  });

  test("googleNewsSearch parses RSS feed", async () => {
    const mockRss = `<?xml version="1.0" encoding="utf-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>Breakthrough in Fusion Energy Announced</title>
      <link>https://news.example.com/fusion-breakthrough</link>
      <pubDate>Wed, 21 Oct 2026 12:00:00 GMT</pubDate>
      <source url="https://reuters.com">Reuters</source>
      <description>&lt;p&gt;Scientists achieve net positive energy gain in fusion reactor.&lt;/p&gt;</description>
    </item>
  </channel>
</rss>`;
    mockedAxios.get.mockResolvedValue({ data: mockRss });

    const articles = await googleNewsSearch("fusion energy", { maxResults: 5 });
    expect(articles).toHaveLength(1);
    expect(articles[0].title).toBe("Breakthrough in Fusion Energy Announced");
    expect(articles[0].source).toBe("Reuters");
    expect(articles[0].snippet).toContain("Scientists achieve net positive energy gain");
  });

  test("hackerNewsSearch parses Algolia response", async () => {
    mockedAxios.get.mockResolvedValue({
      data: {
        hits: [
          {
            title: "Show HN: Modern Zero-Key Search Engine",
            url: "https://github.com/example/engine",
            points: 245,
            num_comments: 88,
            created_at: "2026-10-21T10:00:00Z",
            objectID: "123456",
          },
        ],
      },
    });

    const trends = await hackerNewsSearch("search engine", 5);
    expect(trends).toHaveLength(1);
    expect(trends[0].title).toBe("Show HN: Modern Zero-Key Search Engine");
    expect(trends[0].points).toBe(245);
    expect(trends[0].comments).toBe(88);
  });
});
