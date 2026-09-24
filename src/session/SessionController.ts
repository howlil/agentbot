import { Plugin } from "obsidian";
import { AgyAdapter } from "../agent/AgyAdapter";
import { ObsidianContext } from "../context/ObsidianContext";
import { SessionStore } from "./SessionStore";
import { ChatSession, AgyModel, AgentInput, EditProposal, ApplyResult } from "../types";

/**
 * SessionController — owns the session lifecycle for one plugin instance.
 *
 * Responsibilities (Spike 5):
 *   - create / resume / restore sessions
 *   - maintain conversation ID across turns
 *   - handle model switching without breaking existing sessions
 *   - persist after every turn via plugin.saveData
 */
export class SessionController {
  private store: SessionStore;
  private adapter: AgyAdapter;
  private ctx: ObsidianContext;
  private plugin: Plugin;

  private currentSession: ChatSession | null = null;
  private models: AgyModel[] = [];

  constructor(
    plugin: Plugin,
    store: SessionStore,
    adapter: AgyAdapter,
    ctx: ObsidianContext,
  ) {
    this.plugin = plugin;
    this.store = store;
    this.adapter = adapter;
    this.ctx = ctx;
  }

  // ── Init ─────────────────────────────────────────────────────────────────

  async init(): Promise<void> {
    const data = await this.plugin.loadData();
    await this.store.load(data);

    // Restore or create session
    this.currentSession = this.store.getCurrentSession();
    if (!this.currentSession) {
      this.currentSession = this.store.createSession(this.store.getDefaultModel());
    }

    // Fetch models in background (non-blocking)
    this.adapter.listModels()
      .then((m) => { this.models = m; })
      .catch(() => { /* models list is best-effort */ });
  }

  // ── Session ops ───────────────────────────────────────────────────────────

  getSession(): ChatSession {
    if (!this.currentSession) throw new Error("Session not initialized");
    return this.currentSession;
  }

  async newSession(): Promise<ChatSession> {
    const model = this.currentSession?.model ?? this.store.getDefaultModel();
    this.currentSession = this.store.createSession(model);
    await this.save();
    return this.currentSession;
  }

  setModel(modelId: string): void {
    this.store.setDefaultModel(modelId);
    if (this.currentSession) {
      this.currentSession.model = modelId;
    }
  }

  getModels(): AgyModel[] { return this.models; }

  // ── Send a turn ───────────────────────────────────────────────────────────

  async *sendTurn(
    prompt: string,
    extraContext: import("../types").AgentContext[] = [],
  ): AsyncIterable<import("../types").AgyStreamEvent> {
    const session = this.getSession();

    // Auto-resolve context
    const autoCtx = await this.ctx.resolveAuto();
    const context = [...autoCtx, ...extraContext];

    const input: AgentInput = { prompt, context };

    // Record user message
    session.messages.push({ role: "user", content: prompt });

    // Stream from adapter
    let fullText = "";
    for await (const event of this.adapter.send(input, {
      model: session.model,
      conversationId: session.conversationId,
    })) {
      if (event.type === "text") fullText += event.content;
      if (event.type === "done") {
        // Capture conversation ID for future turns
        const convId = this.adapter._lastConversationId;
        if (convId) session.conversationId = convId;
      }
      yield event;
    }

    // Record assistant message
    if (fullText) {
      session.messages.push({ role: "assistant", content: fullText });
    }

    this.store.updateSession(session);
    await this.save();
  }

  // ── Apply (Spike 4) ───────────────────────────────────────────────────────

  async applyProposal(proposal: EditProposal): Promise<ApplyResult> {
    // 1. Stale check — verify original still exists
    const isValid = await this.ctx.verifyOriginal(proposal.file, proposal.original);
    if (!isValid) {
      return {
        ok: false,
        reason: "stale",
        message: "Note changed since proposal was made. Regenerate the edit.",
      };
    }

    // 2. Get active editor
    const leaf = (this.plugin.app.workspace as any).activeLeaf;
    const editor = leaf?.view?.editor;
    if (!editor) {
      return { ok: false, reason: "no-editor", message: "No active editor." };
    }

    // 3. Find range and replace — single editor transaction → native Ctrl+Z
    try {
      const content: string = editor.getValue();
      const idx: number = content.indexOf(proposal.original);
      if (idx === -1) {
        return {
          ok: false,
          reason: "stale",
          message: "Original text not found in editor.",
        };
      }
      const from = editor.offsetToPos(idx);
      const to   = editor.offsetToPos(idx + proposal.original.length);
      editor.replaceRange(proposal.replacement, from, to);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }

  // ── Persist ───────────────────────────────────────────────────────────────

  private async save(): Promise<void> {
    await this.plugin.saveData(this.store.serialize());
  }

  // ── Cleanup ───────────────────────────────────────────────────────────────

  destroy(): void {
    this.adapter.abort();
  }
}
