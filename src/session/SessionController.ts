import { Plugin } from "obsidian";
import { SessionStore } from "./SessionStore";
import {
  AgentAdapter,
  AgentContext,
  AgentInput,
  AgentModel,
  AgentStreamEvent,
  ChatSession,
} from "../types";

/**
 * Owns chat/agent conversation persistence only.
 *
 * Learning orchestration, context resolution, and Markdown mutation live above
 * or beside this class. This keeps session state independent of Learning OS
 * behavior.
 */
export class SessionController {
  private currentSession: ChatSession | null = null;
  private models: AgentModel[] = [];

  constructor(
    private readonly plugin: Plugin,
    private readonly store: SessionStore,
    private readonly adapter: AgentAdapter,
  ) {}

  async init(): Promise<void> {
    const data = await this.plugin.loadData();
    await this.store.load(data);

    this.currentSession = this.store.getCurrentSession();
    if (!this.currentSession) {
      this.currentSession = this.store.createSession(this.store.getDefaultModel());
    }

    this.adapter
      .listModels()
      .then((models) => {
        this.models = models;
      })
      .catch(() => {
        // Model discovery is best-effort; the persisted default remains usable.
      });
  }

  ping(): Promise<string> {
    return this.adapter.ping();
  }

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
      this.store.updateSession(this.currentSession);
      void this.save();
    }
  }

  getModels(): AgentModel[] {
    return this.models;
  }

  /**
   * Execute one prepared agent turn.
   *
   * Context is already resolved by LearningController. displayPrompt is the raw
   * user text stored in local history so internal learning instructions do not
   * leak into the visible/session transcript.
   */
  async *sendTurn(
    prompt: string,
    context: AgentContext[] = [],
    displayPrompt: string = prompt,
  ): AsyncIterable<AgentStreamEvent> {
    const session = this.getSession();
    const input: AgentInput = { prompt, context };

    session.messages.push({
      role: "user",
      content: displayPrompt,
    });

    let fullText = "";

    for await (const event of this.adapter.send(input, {
      model: session.model,
      conversationId: session.conversationId,
    })) {
      if (event.type === "text") {
        fullText += event.content;
      }

      if (event.type === "done" && event.conversationId) {
        session.conversationId = event.conversationId;
      }

      yield event;
    }

    if (fullText) {
      session.messages.push({
        role: "assistant",
        content: fullText,
      });
    }

    this.store.updateSession(session);
    await this.save();
  }

  cancel(): void {
    this.adapter.abort();
  }

  destroy(): void {
    this.adapter.abort();
  }

  private async save(): Promise<void> {
    await this.plugin.saveData(this.store.serialize());
  }
}
