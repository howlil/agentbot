// ─── All shared types — spikes 1-6 ───────────────────────────────────────────

// ── Context (Spike 2) ───────────────────────────────────────────────────────

export type AgentContext =
  | { type: "selection"; file: string; content: string }
  | { type: "note";      file: string; content: string };

export interface AgentInput {
  prompt: string;
  context: AgentContext[];
}

// ── AGY stream-json protocol (Spike 1) ─────────────────────────────────────
// AGY CLI: agy --input-format stream-json --output-format stream-json [flags]
// stdin:  one NDJSON line per turn: { role: "user", content: string }
// stdout: NDJSON stream — one event per line

/** What we write to AGY stdin (one JSON line per turn). */
export interface AgyTurnInput {
  role: "user";
  content: string;      // formatted prompt + context
}

/** Events read from AGY stdout. */
export type AgyStreamEvent =
  | { type: "text";     content: string }
  | { type: "done";     conversationId?: string }
  | { type: "error";    error: string };

// ── Edit proposal (Spike 3) ─────────────────────────────────────────────────

export interface EditProposal {
  file: string;
  original: string;     // verbatim text — must exist in file at Apply time
  replacement: string;
  reason?: string;
}

// ── Apply result (Spike 4) ──────────────────────────────────────────────────

export type ApplyResult =
  | { ok: true }
  | { ok: false; reason: "stale" | "no-editor" | "error"; message: string };

// ── Session (Spike 5) ───────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;        // raw markdown text
  proposal?: EditProposal;
  proposalState?: "pending" | "applied" | "rejected" | "stale";
}

export interface ChatSession {
  id: string;
  conversationId?: string; // AGY conversation ID for --conversation flag
  model: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface AgyModel {
  id: string;
  name: string;
}

// ── Adapter interface ────────────────────────────────────────────────────────

export interface AgentAdapter {
  /** Resolve AGY binary path. Throws if not found. */
  ping(): Promise<string>;
  /** Send one turn; yields text deltas and finally a done/error event. */
  send(input: AgentInput, opts: SendOptions): AsyncIterable<AgyStreamEvent>;
  /** List available models. */
  listModels(): Promise<AgyModel[]>;
  /** Abort in-flight request. */
  abort(): void;
}

export interface SendOptions {
  model: string;
  conversationId?: string;  // undefined = new conversation
}
