import {
  wikipediaPageUrl,
  wikipediaSearchUrl,
  pageProvenance,
  summaryProvenance,
  searchProvenance,
  formatSourcesFooter,
} from '../provenance';

describe('provenance helpers (P1-C2)', () => {
  test('wikipediaPageUrl canonicalizes titles', () => {
    expect(wikipediaPageUrl('Albert Einstein')).toBe(
      'https://en.wikipedia.org/wiki/Albert_Einstein',
    );
    expect(wikipediaPageUrl('ChatGPT', 'id')).toBe(
      'https://id.wikipedia.org/wiki/ChatGPT',
    );
  });

  test('wikipediaSearchUrl is reproducible', () => {
    const url = wikipediaSearchUrl('black holes');
    expect(url).toContain('en.wikipedia.org');
    expect(url).toContain('Special%3ASearch');
    expect(url).toContain(encodeURIComponent('black holes'));
  });

  test('confidence rubric: page 0.95 > summary 0.9 > search 0.85', () => {
    const at = '2026-09-12T00:00:00.000Z';
    expect(pageProvenance('X', 'en', at)).toEqual({
      source: wikipediaPageUrl('X'),
      retrieved_at: at,
      confidence: 0.95,
      freshness: 'fresh',
    });
    expect(summaryProvenance('X', 'en', at).confidence).toBe(0.9);
    expect(searchProvenance('q', 'en', at).confidence).toBe(0.85);
    expect(searchProvenance('q', 'en', at).source).toBe(wikipediaSearchUrl('q'));
  });

  test('formatSourcesFooter renders one line per ref', () => {
    const at = '2026-09-12T00:00:00.000Z';
    const footer = formatSourcesFooter([
      pageProvenance('A', 'en', at),
      summaryProvenance('B', 'en', at),
    ]);
    expect(footer).toContain('Sources:');
    expect(footer).toContain(wikipediaPageUrl('A'));
    expect(footer).toContain(wikipediaPageUrl('B'));
    expect(footer).toContain('0.95');
    expect(footer).toContain('0.9');
    expect(footer).toContain(at);
  });

  test('formatSourcesFooter is empty for no refs (no not-found noise)', () => {
    expect(formatSourcesFooter([])).toBe('');
  });
});
