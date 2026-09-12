/**
 * C1 provider-side HeLaResult envelope (self-contained mirror of the canonical
 * shape in chaining-mcp/src/agent/hela-result.ts; this repo is a standalone
 * package and must not import across repos).
 *
 * Flag-gated: set HELA_ENVELOPE=true to wrap tool payloads in the canonical
 * HelaResult envelope. Default (unset/anything else) returns the legacy raw
 * payload byte-for-byte identical to before.
 *
 * Wiring: tools are registered via `registerEnvTool(server, ...)` — a thin
 * wrapper over `server.registerTool` that envelopes the callback result.
 * Loose `any` typing is deliberate: several `registerTool` call sites already
 * hit TS2589 inference-depth errors pre-C1, and strict re-typing is out of
 * scope for the envelope migration.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

export interface HelaArtifactRef {
  uri: string;
  sha256?: string;
  size?: number;
  media_type?: string;
}

export interface HelaProvenanceRef {
  source: string;
  retrieved_at?: string;
  confidence?: number;
  freshness?: string;
}

export interface HelaRedaction {
  applied: boolean;
  fields: string[];
}

export interface HelaExecutionMeta {
  serverName?: string;
  toolName?: string;
  run_id?: string;
  step_id?: string;
  attempt?: number;
  executionTimeMs?: number;
  startedAt?: string;
  completedAt?: string;
}

export interface HelaResult<T = unknown> {
  ok: boolean;
  summary: string;
  /** Canonical payload field. */
  data: T;
  artifacts: HelaArtifactRef[];
  provenance: HelaProvenanceRef[];
  warnings: string[];
  sideEffects: string[];
  execution: HelaExecutionMeta;
  redaction: HelaRedaction;
  error?: string;
}

export const SERVER_NAME = 'wikipedia-mcp-server';

/** All researcher tools are read-only lookups; none declare side effects. */
export const TOOL_SIDE_EFFECTS: Record<string, string[]> = {
  search: [],
  getPage: [],
  getPageSummary: [],
  getPageById: [],
  random: [],
  pageLanguages: [],
  batchSearch: [],
  batchGetPages: [],
  searchNearby: [],
  getPagesInCategory: [],
};

export function isEnvelopeEnabled(): boolean {
  return process.env['HELA_ENVELOPE'] === 'true';
}

function baseExecution(toolName: string): HelaExecutionMeta {
  const meta: HelaExecutionMeta = {
    serverName: SERVER_NAME,
    toolName,
    completedAt: new Date().toISOString(),
  };
  const runId = process.env['HELA_RUN_ID'];
  const stepId = process.env['HELA_STEP_ID'];
  if (runId !== undefined) meta.run_id = runId;
  if (stepId !== undefined) meta.step_id = stepId;
  return meta;
}

export function wrapResult<T>(toolName: string, data: T, summary?: string): HelaResult<T> {
  return {
    ok: true,
    summary: summary || `${toolName} ok`,
    data,
    artifacts: [],
    provenance: [],
    warnings: [],
    sideEffects: TOOL_SIDE_EFFECTS[toolName] || [],
    execution: baseExecution(toolName),
    redaction: { applied: false, fields: [] },
  };
}

export function wrapError(toolName: string, message: string): HelaResult<null> {
  return {
    ok: false,
    summary: `${toolName} failed: ${message}`,
    data: null,
    artifacts: [],
    provenance: [],
    warnings: [],
    sideEffects: TOOL_SIDE_EFFECTS[toolName] || [],
    execution: baseExecution(toolName),
    redaction: { applied: false, fields: [] },
    error: message,
  };
}

/**
 * Post-hoc result wrapper. Envelope off: returns the SDK result untouched.
 * Envelope on: replaces the first text block with the envelope JSON whose
 * `data` carries the original text (parsed as JSON when possible, else raw
 * string); non-text blocks are preserved.
 */
export function withEnvelope(toolName: string, result: any): any {
  if (!isEnvelopeEnabled()) return result;
  if (!result || !Array.isArray(result.content)) return result;
  let replaced = false;
  const content = result.content.map((block: any) => {
    if (!replaced && block && block.type === 'text' && typeof block.text === 'string') {
      replaced = true;
      let data: unknown = block.text;
      try {
        data = JSON.parse(block.text);
      } catch {
        // human-readable text stays a string
      }
      return { type: 'text', text: JSON.stringify(wrapResult(toolName, data), null, 2) };
    }
    return block;
  });
  return { ...result, content };
}

/**
 * Drop-in replacement for `server.registerTool(name, config, cb)` that
 * envelopes the callback result. Same 3-arg shape, first arg is the server.
 * Generic over the zod input shape so callbacks keep the exact contextual
 * arg types they had under `registerTool` (no implicit-any regressions).
 */
export function registerEnvTool<TArgs extends z.ZodRawShape>(
  server: McpServer,
  name: string,
  config: {
    title?: string;
    description?: string;
    inputSchema: TArgs;
    annotations?: {
      title?: string;
      readOnlyHint?: boolean;
      destructiveHint?: boolean;
      idempotentHint?: boolean;
      openWorldHint?: boolean;
    };
  },
  cb: (args: z.objectOutputType<TArgs, z.ZodTypeAny, "strip">) => any,
): void {
  (server as any).registerTool(name, config, async (args: any) => withEnvelope(name, await cb(args)));
}
