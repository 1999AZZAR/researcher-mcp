import axios from "axios";
import {
  freeSearch,
  freeExtract,
  unwrapUrl,
  listFreeEngines,
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

  test("freeExtract returns word count via jina reader", async () => {
    mockedAxios.get.mockResolvedValue({ data: "hello world foo bar" });
    const a = await freeExtract("https://example.com/x");
    expect(a.wordCount).toBe(4);
    expect(mockedAxios.get).toHaveBeenCalledWith(
      "https://r.jina.ai/https://example.com/x",
      expect.anything()
    );
  });
});
