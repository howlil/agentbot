import { ChatSession } from "../types";

const STORE_KEY = "forge-sessions";
const LEGACY_STORE_KEY = "agy-sessions";
const DEFAULT_MODEL = "gemini-3.8-flash-medium";

interface StoreData {
  currentSessionId: string | null;
  sessions: Record<string, ChatSession>;
  defaultModel: string;
}

/**
 * SessionStore — persists sessions to Obsidian plugin data.
 *
 * Spike 5: sessions survive Obsidian restarts.
 * The store is a thin wrapper around plugin.loadData / plugin.saveData.
 */
export class SessionStore {
  private data: StoreData = {
    currentSessionId: null,
    sessions: {},
    defaultModel: DEFAULT_MODEL,
  };

  /** Call once on plugin load. */
  async load(rawData: Record<string, unknown> | null): Promise<void> {
    const stored = rawData?.[STORE_KEY] ?? rawData?.[LEGACY_STORE_KEY];
    if (stored) {
      this.data = stored as StoreData;
    }
  }

  /** Serialize to plugin data object. */
  serialize(): Record<string, unknown> {
    return { [STORE_KEY]: this.data };
  }

  // ── Session CRUD ─────────────────────────────────────────────────────────

  createSession(model: string): ChatSession {
    const session: ChatSession = {
      id: crypto.randomUUID(),
      model,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.data.sessions[session.id] = session;
    this.data.currentSessionId = session.id;
    return session;
  }

  getSession(id: string): ChatSession | null {
    return this.data.sessions[id] ?? null;
  }

  getCurrentSession(): ChatSession | null {
    if (!this.data.currentSessionId) return null;
    return this.getSession(this.data.currentSessionId);
  }

  updateSession(session: ChatSession): void {
    session.updatedAt = Date.now();
    this.data.sessions[session.id] = session;
  }

  setCurrentSession(id: string): void {
    this.data.currentSessionId = id;
  }

  // ── Model preference ─────────────────────────────────────────────────────

  getDefaultModel(): string {
    return this.data.defaultModel ?? DEFAULT_MODEL;
  }

  setDefaultModel(model: string): void {
    this.data.defaultModel = model;
  }

  // ── Utility ──────────────────────────────────────────────────────────────

  /** All sessions, newest first. */
  listSessions(): ChatSession[] {
    return Object.values(this.data.sessions).sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
  }
}
