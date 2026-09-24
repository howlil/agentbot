// Shared transport/session types.

// ── Context ─────────────────────────────────────────────────────────────────

export type AgentContext =
  | { type: "selection"; file: string; content: string }
  | { type: "note"; file: string; content: string };

export interface AgentInput {
  prompt: string;
  context: AgentContext[];
}

// ── AGY transport ───────────────────────────────────────────────────────────

export interface AgyTurnInput {
  role: "user";
  content: string;
}

export type AgyStreamEvent =
  | { type: "text"; content: string }
  | { type: "done"; conversationId?: string }
  | { type: "error"; error: string };

// ── Mutation proposal ───────────────────────────────────────────────────────

export interface EditProposal {
  file: string;
  original: string;
  replacement: string;
  reason?: string;
}

export type ApplyResult =
  | { ok: true }
  | {
      ok: false;
      reason:
        | "stale"
        | "ambiguous"
        | "missing-file"
        | "no-editor"
        | "error";
      message: string;
    };

// ── Session ─────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  proposal?: EditProposal;
  proposalState?: "pending" | "applied" | "rejected" | "stale";
}

export interface ChatSession {
  id: string;
  conversationId?: string;
  model: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export interface AgyModel {
  id: string;
  name: string;
}

// ── Agent runtime boundary ──────────────────────────────────────────────────

export interface AgentAdapter {
  ping(): Promise<string>;

  send(
    input: AgentInput,
    opts: SendOptions,
  ): AsyncIterable<AgyStreamEvent>;

  listModels(): Promise<AgyModel[]>;

  abort(): void;
}

export interface SendOptions {
  model: string;
  conversationId?: string;
}
