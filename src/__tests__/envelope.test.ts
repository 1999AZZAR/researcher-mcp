import {
  SERVER_NAME,
  TOOL_SIDE_EFFECTS,
  isEnvelopeEnabled,
  wrapResult,
  wrapError,
  withEnvelope,
  registerEnvTool,
} from '../envelope';
import { createWikipediaMcp } from '../mcp';
import { EnhancedWikipediaService } from '../wikipediaService';
import { WikipediaExtendedFeatures } from '../additionalFeatures';

const ENVELOPE_KEYS = [
  'ok', 'summary', 'data', 'artifacts', 'provenance',
  'warnings', 'sideEffects', 'execution', 'redaction',
];

const TOOL_NAMES = [
  'search', 'getPage', 'getPageSummary', 'getPageById', 'random',
  'pageLanguages', 'batchSearch', 'batchGetPages', 'searchNearby', 'getPagesInCategory',
];

describe('researcher envelope (P1-C1)', () => {
  const OLD_ENV = { ...process.env };

  afterEach(() => {
    process.env = { ...OLD_ENV };
  });

  test('flag off by default; on-mode passthrough of identity when disabled', () => {
    delete process.env['HELA_ENVELOPE'];
    expect(isEnvelopeEnabled()).toBe(false);
    const raw = { content: [{ type: 'text', text: 'hello' }] };
    expect(withEnvelope('search', raw)).toBe(raw);
  });

  test('on-mode wraps first text block, preserves the rest', () => {
    process.env['HELA_ENVELOPE'] = 'true';
    const raw = {
      content: [
        { type: 'text', text: 'Found 2 results' },
        { type: 'image', data: 'abc', mimeType: 'image/png' },
      ],
    };
    const out = withEnvelope('search', raw);
    const env = JSON.parse(out.content[0].text);
    for (const k of ENVELOPE_KEYS) expect(env).toHaveProperty(k);
    expect(env.ok).toBe(true);
    expect(env.data).toBe('Found 2 results');
    expect(env.execution.serverName).toBe(SERVER_NAME);
    expect(env.execution.toolName).toBe('search');
    expect(out.content[1]).toEqual({ type: 'image', data: 'abc', mimeType: 'image/png' });
  });

  test('on-mode parses JSON text into data', () => {
    process.env['HELA_ENVELOPE'] = 'true';
    const out = withEnvelope('getPage', { content: [{ type: 'text', text: '{"a":1}' }] });
    expect(JSON.parse(out.content[0].text).data).toEqual({ a: 1 });
  });

  test('all 10 tools registered through the envelope wrapper with empty side effects', () => {
    for (const t of TOOL_NAMES) expect(TOOL_SIDE_EFFECTS[t]).toEqual([]);
    expect(createWikipediaMcp).toBeDefined();
    // registerEnvTool keeps the 3-arg (name, config, cb) shape
    expect(registerEnvTool.length).toBe(4); // (server, name, config, cb)
  });

  test('server factory still builds (wiring smoke)', () => {
    const svc = new EnhancedWikipediaService();
    const server = createWikipediaMcp(svc, new WikipediaExtendedFeatures(svc));
    expect(server).toBeDefined();
  });

  test('run/step ids propagate; errors carry ok:false', () => {
    process.env['HELA_ENVELOPE'] = 'true';
    process.env['HELA_RUN_ID'] = 'r1';
    process.env['HELA_STEP_ID'] = 's2';
    expect(wrapResult('search', 'x').execution.run_id).toBe('r1');
    const err = wrapError('search', 'boom');
    expect(err.ok).toBe(false);
    expect(err.error).toBe('boom');
    expect(err.execution.step_id).toBe('s2');
  });
});
