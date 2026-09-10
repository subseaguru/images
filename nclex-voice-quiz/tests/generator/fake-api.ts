/**
 * A fake Claude API for generator tests: a `fetch` that records every request and answers from a
 * script of canned responses, plus builders for realistic Messages API bodies.
 */
import type { CategoryId, ClinicalJudgmentStep, Difficulty } from "../../src/shared/types.js";

export const BASE_URL = "http://claude.test";

export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** Parsed JSON body, or null for bodiless requests. */
  body: Record<string, unknown> | null;
}

export interface CannedResponse {
  status?: number;
  body: unknown;
}

export interface FakeApi {
  fetch: typeof globalThis.fetch;
  requests: RecordedRequest[];
  /** Queue another response; responses are consumed in order. */
  push(response: CannedResponse): void;
}

export function fakeApi(script: CannedResponse[] = []): FakeApi {
  const queue = [...script];
  const requests: RecordedRequest[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const req = new Request(input, init);
    const headers: Record<string, string> = {};
    req.headers.forEach((value, key) => {
      headers[key.toLowerCase()] = value;
    });
    const raw = req.method === "GET" || req.method === "HEAD" ? "" : await req.text();
    requests.push({
      method: req.method,
      url: req.url,
      headers,
      body: raw ? (JSON.parse(raw) as Record<string, unknown>) : null,
    });
    const next = queue.shift();
    if (!next) throw new Error(`fake API: no scripted response for ${req.method} ${req.url}`);
    return new Response(JSON.stringify(next.body), {
      status: next.status ?? 200,
      headers: { "content-type": "application/json" },
    });
  };
  return { fetch, requests, push: (r) => queue.push(r) };
}

// ---------------------------------------------------------------------------------------------
// Response bodies
// ---------------------------------------------------------------------------------------------

export interface MessageBodyOptions {
  model?: string;
  content?: unknown[];
  stop_reason?: string;
  stop_details?: unknown;
  usage?: Record<string, unknown>;
}

export function messageBody(opts: MessageBodyOptions = {}): Record<string, unknown> {
  return {
    id: "msg_x",
    type: "message",
    role: "assistant",
    model: opts.model ?? "claude-opus-5",
    content: opts.content ?? [],
    stop_reason: opts.stop_reason ?? "end_turn",
    stop_sequence: null,
    stop_details: opts.stop_details ?? null,
    usage: { input_tokens: 1200, output_tokens: 800, ...(opts.usage ?? {}) },
  };
}

export function batchResponse(batch: unknown, opts: MessageBodyOptions = {}): CannedResponse {
  return { body: messageBody({ content: [{ type: "text", text: JSON.stringify(batch) }], ...opts }) };
}

export function textResponse(text: string, opts: MessageBodyOptions = {}): CannedResponse {
  return { body: messageBody({ content: [{ type: "text", text }], ...opts }) };
}

export function errorResponse(status: number, type: string, message: string): CannedResponse {
  return { status, body: { type: "error", error: { type, message } } };
}

// ---------------------------------------------------------------------------------------------
// Generated question fixtures
// ---------------------------------------------------------------------------------------------

export interface FixtureOverrides {
  stem?: string;
  correct?: string;
  category?: CategoryId | string;
  subtopic?: string;
  clinicalJudgmentStep?: ClinicalJudgmentStep | string;
  difficulty?: Difficulty | string;
  options?: unknown[];
  teachingPoint?: string;
  references?: unknown;
  tags?: unknown;
}

let fixtureCounter = 0;

/** A valid generated question; pass overrides to break specific fields. */
export function generatedQuestion(overrides: FixtureOverrides = {}): Record<string, unknown> {
  fixtureCounter += 1;
  const n = fixtureCounter;
  return {
    stem:
      overrides.stem ??
      `A nurse is caring for a 64 year old client (case ${n}) admitted with heart failure who reports new shortness of breath at rest, has crackles in both lung bases and an oxygen saturation of 88 percent on room air. Which action should the nurse take first?`,
    options: overrides.options ?? [
      { label: "A", text: `Raise the head of the bed and apply oxygen (${n})`, rationale: "Oxygenation comes first: positioning and supplemental oxygen address the immediate hypoxia." },
      { label: "B", text: `Administer the scheduled oral furosemide (${n})`, rationale: "Diuresis matters, but it takes time and does not correct the immediate hypoxia." },
      { label: "C", text: `Notify the health care provider of the findings (${n})`, rationale: "The provider must be informed, but not before an immediate action that relieves hypoxia." },
    ],
    correct: overrides.correct ?? "A",
    category: overrides.category ?? "physiological_adaptation",
    subtopic: overrides.subtopic ?? "Medical Emergencies",
    clinicalJudgmentStep: overrides.clinicalJudgmentStep ?? "take_action",
    difficulty: overrides.difficulty ?? "medium",
    teachingPoint:
      overrides.teachingPoint ??
      "When a client is acutely hypoxic, act on airway and breathing before medications or notifications.",
    references: overrides.references ?? ["Cardiac notes"],
    tags: overrides.tags ?? ["heart failure", "priority"],
  };
}
