var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => AgyPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian3 = require("obsidian");

// src/agent/AgyAdapter.ts
var import_child_process = require("child_process");
var AgyAdapter = class {
  constructor() {
    this.proc = null;
  }
  // ── ping ──────────────────────────────────────────────────────────────────
  async ping() {
    return new Promise((resolve, reject) => {
      var _a;
      const which = process.platform === "win32" ? "where" : "which";
      const p = (0, import_child_process.spawn)(which, ["agy"]);
      let out = "";
      (_a = p.stdout) == null ? void 0 : _a.on("data", (d) => out += d.toString());
      p.on("close", (code) => {
        if (code === 0 && out.trim()) {
          resolve(out.trim().split(/\r?\n/)[0]);
        } else {
          reject(new Error("AGY CLI not found. Install it and ensure 'agy' is in PATH."));
        }
      });
    });
  }
  // ── send ──────────────────────────────────────────────────────────────────
  async *send(input, opts) {
    const bin = await this.ping();
    const fullPrompt = this.buildFullPrompt(input);
    const args = this.buildArgs(fullPrompt, opts);
    this.proc = (0, import_child_process.spawn)(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const { proc } = this;
    yield* this.readEvents(proc);
  }
  buildArgs(prompt, opts) {
    const args = [
      "--print",
      prompt,
      "--output-format",
      "stream-json",
      "--dangerously-skip-permissions"
    ];
    if (opts.model) {
      args.push("--model", opts.model);
    }
    if (opts.conversationId) {
      args.push("--conversation", opts.conversationId);
    }
    return args;
  }
  /**
   * Format AgentInput with context as a structured preamble before prompt.
   */
  buildFullPrompt(input) {
    const contextPreamble = this.formatContext(input.context);
    return contextPreamble ? `${contextPreamble}

---

${input.prompt}` : input.prompt;
  }
  formatContext(ctx) {
    if (ctx.length === 0) return "";
    return ctx.map((c) => {
      const label = c.type === "selection" ? `[Selected text from ${c.file}]` : `[Note: ${c.file}]`;
      return `${label}
\`\`\`
${c.content}
\`\`\``;
    }).join("\n\n");
  }
  // ── stdout reader ─────────────────────────────────────────────────────────
  async *readEvents(proc) {
    var _a, _b;
    let buffer = "";
    const queue = [];
    let notify = null;
    let closed = false;
    const push = (line) => {
      queue.push(line);
      notify == null ? void 0 : notify();
      notify = null;
    };
    (_a = proc.stdout) == null ? void 0 : _a.on("data", (chunk) => {
      var _a2;
      buffer += chunk.toString();
      const parts = buffer.split(/\r?\n/);
      buffer = (_a2 = parts.pop()) != null ? _a2 : "";
      for (const part of parts) {
        const line = part.trim();
        if (line) push(line);
      }
    });
    (_b = proc.stderr) == null ? void 0 : _b.on("data", (chunk) => {
      const msg = chunk.toString().trim();
      if (msg) console.warn("[AgyAdapter]", msg);
    });
    proc.on("close", () => {
      closed = true;
      notify == null ? void 0 : notify();
      notify = null;
    });
    while (true) {
      if (queue.length > 0) {
        const line = queue.shift();
        const event = this.parseLine(line);
        if (event) {
          yield event;
          if (event.type === "done" || event.type === "error") break;
        }
      } else if (closed) {
        break;
      } else {
        await new Promise((res) => {
          notify = res;
        });
      }
    }
  }
  /**
   * Parse one NDJSON line from AGY stdout into an AgyStreamEvent.
   *
   * Known AGY output events:
   *   {"event":"init","conversation_id":"..."}
   *   {"event":"text","text":"..."}
   *   {"event":"result","result":{...}}
   *   {"event":"error","error":"..."}
   */
  parseLine(line) {
    var _a, _b;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      return null;
    }
    const ev = obj["event"];
    if (ev === "init") {
      const convId = obj["conversation_id"] || ((_a = obj["init"]) == null ? void 0 : _a["conversation_id"]);
      this._lastConversationId = convId;
      return null;
    }
    if (ev === "step_update") {
      const su = obj["step_update"];
      const delta = su == null ? void 0 : su["text_delta"];
      if (delta) {
        return { type: "text", content: delta };
      }
      return null;
    }
    if (ev === "text") {
      const text = obj["text"];
      if (text) return { type: "text", content: text };
      return null;
    }
    if (ev === "result") {
      const res = obj["result"];
      const convId = (res == null ? void 0 : res["conversation_id"]) || this._lastConversationId;
      return { type: "done", conversationId: convId };
    }
    if (ev === "error") {
      return { type: "error", error: String((_b = obj["error"]) != null ? _b : "Unknown error") };
    }
    return null;
  }
  // ── listModels ────────────────────────────────────────────────────────────
  async listModels() {
    const bin = await this.ping();
    return new Promise((resolve, reject) => {
      var _a;
      const p = (0, import_child_process.spawn)(bin, ["models"]);
      let out = "";
      (_a = p.stdout) == null ? void 0 : _a.on("data", (d) => out += d.toString());
      p.on("close", () => {
        const models = out.split(/\r?\n/).filter((l) => l.includes("	")).map((l) => {
          const [id, ...rest] = l.split("	");
          return { id: id.trim(), name: rest.join("	").trim() };
        });
        resolve(models);
      });
      p.on("error", reject);
    });
  }
  // ── abort ─────────────────────────────────────────────────────────────────
  abort() {
    var _a;
    (_a = this.proc) == null ? void 0 : _a.kill("SIGTERM");
    this.proc = null;
  }
};

// src/context/ObsidianContext.ts
var import_obsidian = require("obsidian");
var ObsidianContext = class {
  constructor(app) {
    this.app = app;
  }
  /** Current editor selection, or null. */
  getSelection() {
    var _a, _b, _c, _d, _e;
    const editor = (_b = (_a = this.app.workspace.activeLeaf) == null ? void 0 : _a.view) == null ? void 0 : _b.editor;
    if (!editor) return null;
    const sel = (_d = (_c = editor.getSelection) == null ? void 0 : _c.call(editor)) != null ? _d : "";
    if (!sel) return null;
    const file = this.app.workspace.getActiveFile();
    return { file: (_e = file == null ? void 0 : file.path) != null ? _e : "untitled", content: sel };
  }
  /** Full content of the active note, or null. */
  async getCurrentNote() {
    const file = this.app.workspace.getActiveFile();
    if (!file || !(file instanceof import_obsidian.TFile)) return null;
    const content = await this.app.vault.cachedRead(file);
    return { file: file.path, content };
  }
  /**
   * Resolve the automatic context for a new turn.
   * Returns [selection] if present, else [current-note].
   */
  async resolveAuto() {
    const sel = this.getSelection();
    if (sel) {
      return [{ type: "selection", file: sel.file, content: sel.content }];
    }
    const note = await this.getCurrentNote();
    if (note) {
      return [{ type: "note", file: note.file, content: note.content }];
    }
    return [];
  }
  /**
   * Load a specific file by path for @mention context.
   * Returns null if file does not exist.
   */
  async loadFile(path) {
    const file = this.app.vault.getFileByPath(path);
    if (!file || !(file instanceof import_obsidian.TFile)) return null;
    const content = await this.app.vault.cachedRead(file);
    return { type: "note", file: path, content };
  }
  /**
   * Verify that `original` still exists verbatim in the active file.
   * Used before Apply to detect stale proposals.
   */
  async verifyOriginal(filePath, original) {
    const file = this.app.vault.getFileByPath(filePath);
    if (!file || !(file instanceof import_obsidian.TFile)) return false;
    const content = await this.app.vault.cachedRead(file);
    return content.includes(original);
  }
};

// src/session/SessionStore.ts
var STORE_KEY = "agy-sessions";
var DEFAULT_MODEL = "gemini-3.8-flash-medium";
var SessionStore = class {
  constructor() {
    this.data = {
      currentSessionId: null,
      sessions: {},
      defaultModel: DEFAULT_MODEL
    };
  }
  /** Call once on plugin load. */
  async load(rawData) {
    if (rawData && rawData[STORE_KEY]) {
      this.data = rawData[STORE_KEY];
    }
  }
  /** Serialize to plugin data object. */
  serialize() {
    return { [STORE_KEY]: this.data };
  }
  // ── Session CRUD ─────────────────────────────────────────────────────────
  createSession(model) {
    const session = {
      id: crypto.randomUUID(),
      model,
      messages: [],
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    this.data.sessions[session.id] = session;
    this.data.currentSessionId = session.id;
    return session;
  }
  getSession(id) {
    var _a;
    return (_a = this.data.sessions[id]) != null ? _a : null;
  }
  getCurrentSession() {
    if (!this.data.currentSessionId) return null;
    return this.getSession(this.data.currentSessionId);
  }
  updateSession(session) {
    session.updatedAt = Date.now();
    this.data.sessions[session.id] = session;
  }
  setCurrentSession(id) {
    this.data.currentSessionId = id;
  }
  // ── Model preference ─────────────────────────────────────────────────────
  getDefaultModel() {
    var _a;
    return (_a = this.data.defaultModel) != null ? _a : DEFAULT_MODEL;
  }
  setDefaultModel(model) {
    this.data.defaultModel = model;
  }
  // ── Utility ──────────────────────────────────────────────────────────────
  /** All sessions, newest first. */
  listSessions() {
    return Object.values(this.data.sessions).sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
  }
};

// src/session/SessionController.ts
var SessionController = class {
  constructor(plugin, store, adapter, ctx) {
    this.currentSession = null;
    this.models = [];
    this.plugin = plugin;
    this.store = store;
    this.adapter = adapter;
    this.ctx = ctx;
  }
  // ── Init ─────────────────────────────────────────────────────────────────
  async init() {
    const data = await this.plugin.loadData();
    await this.store.load(data);
    this.currentSession = this.store.getCurrentSession();
    if (!this.currentSession) {
      this.currentSession = this.store.createSession(this.store.getDefaultModel());
    }
    this.adapter.listModels().then((m) => {
      this.models = m;
    }).catch(() => {
    });
  }
  // ── Session ops ───────────────────────────────────────────────────────────
  getSession() {
    if (!this.currentSession) throw new Error("Session not initialized");
    return this.currentSession;
  }
  async newSession() {
    var _a, _b;
    const model = (_b = (_a = this.currentSession) == null ? void 0 : _a.model) != null ? _b : this.store.getDefaultModel();
    this.currentSession = this.store.createSession(model);
    await this.save();
    return this.currentSession;
  }
  setModel(modelId) {
    this.store.setDefaultModel(modelId);
    if (this.currentSession) {
      this.currentSession.model = modelId;
    }
  }
  getModels() {
    return this.models;
  }
  // ── Send a turn ───────────────────────────────────────────────────────────
  async *sendTurn(prompt, extraContext = []) {
    const session = this.getSession();
    const autoCtx = await this.ctx.resolveAuto();
    const context = [...autoCtx, ...extraContext];
    const input = { prompt, context };
    session.messages.push({ role: "user", content: prompt });
    let fullText = "";
    for await (const event of this.adapter.send(input, {
      model: session.model,
      conversationId: session.conversationId
    })) {
      if (event.type === "text") fullText += event.content;
      if (event.type === "done") {
        const convId = this.adapter._lastConversationId;
        if (convId) session.conversationId = convId;
      }
      yield event;
    }
    if (fullText) {
      session.messages.push({ role: "assistant", content: fullText });
    }
    this.store.updateSession(session);
    await this.save();
  }
  // ── Apply (Spike 4) ───────────────────────────────────────────────────────
  async applyProposal(proposal) {
    var _a;
    const isValid = await this.ctx.verifyOriginal(proposal.file, proposal.original);
    if (!isValid) {
      return {
        ok: false,
        reason: "stale",
        message: "Note changed since proposal was made. Regenerate the edit."
      };
    }
    const leaf = this.plugin.app.workspace.activeLeaf;
    const editor = (_a = leaf == null ? void 0 : leaf.view) == null ? void 0 : _a.editor;
    if (!editor) {
      return { ok: false, reason: "no-editor", message: "No active editor." };
    }
    try {
      const content = editor.getValue();
      const idx = content.indexOf(proposal.original);
      if (idx === -1) {
        return {
          ok: false,
          reason: "stale",
          message: "Original text not found in editor."
        };
      }
      const from = editor.offsetToPos(idx);
      const to = editor.offsetToPos(idx + proposal.original.length);
      editor.replaceRange(proposal.replacement, from, to);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: "error",
        message: err instanceof Error ? err.message : String(err)
      };
    }
  }
  // ── Persist ───────────────────────────────────────────────────────────────
  async save() {
    await this.plugin.saveData(this.store.serialize());
  }
  // ── Cleanup ───────────────────────────────────────────────────────────────
  destroy() {
    this.adapter.abort();
  }
};

// src/chat/ChatView.ts
var import_obsidian2 = require("obsidian");
var AGY_VIEW_TYPE = "agy-sidebar";
var ChatView = class extends import_obsidian2.ItemView {
  constructor(leaf, sc, ctx) {
    super(leaf);
    // Thread refs (reset per turn)
    this.agyCursorEl = null;
    this.statusEl = null;
    // State
    this.uiState = "EMPTY";
    // Extra context chips added by user
    this.extraCtx = [];
    this.sc = sc;
    this.ctx = ctx;
  }
  getViewType() {
    return AGY_VIEW_TYPE;
  }
  getDisplayText() {
    return "AGY";
  }
  getIcon() {
    return "sparkles";
  }
  // ─── Lifecycle ─────────────────────────────────────────────────────────────
  async onOpen() {
    var _a, _b;
    const root = this.contentEl;
    root.empty();
    root.addClass("agy-root");
    this.buildHeader(root);
    this.thread = root.createDiv({ cls: "agy-thread" });
    this.composer = root.createDiv({ cls: "agy-composer" });
    this.buildComposer(this.composer);
    try {
      await ((_b = (_a = this.sc["adapter"]) == null ? void 0 : _a.ping) == null ? void 0 : _b.call(_a));
    } catch (err) {
      this.showError(err.message);
      return;
    }
    this.showEmpty();
    this.syncChips();
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.syncChips())
    );
    this.registerEvent(
      this.app.workspace.on("editor-selection-change", () => this.syncChips())
    );
    this.refreshModelList();
  }
  async onClose() {
    this.sc.destroy();
  }
  // ─── Header ────────────────────────────────────────────────────────────────
  buildHeader(root) {
    this.headerEl = root.createDiv({ cls: "agy-header" });
    this.headerEl.createSpan({ cls: "agy-header-title", text: "AGY" });
    const right = this.headerEl.createDiv({ cls: "agy-header-right" });
    this.modelSelect = right.createEl("select", { cls: "agy-model-select" });
    this.modelSelect.addEventListener("change", () => {
      this.sc.setModel(this.modelSelect.value);
    });
    const placeholder = this.modelSelect.createEl("option", {
      text: "Loading models\u2026",
      attr: { disabled: "", selected: "" }
    });
    const newBtn = right.createEl("button", { cls: "agy-new-btn", text: "+" });
    newBtn.title = "New chat";
    newBtn.addEventListener("click", async () => {
      await this.sc.newSession();
      this.extraCtx = [];
      this.showEmpty();
    });
  }
  async refreshModelList() {
    const models = this.sc.getModels();
    if (models.length === 0) {
      await new Promise((r) => setTimeout(r, 1e3));
    }
    const fresh = this.sc.getModels();
    if (fresh.length === 0) return;
    this.modelSelect.empty();
    const currentModel = this.sc.getSession().model;
    for (const m of fresh) {
      const opt = this.modelSelect.createEl("option", {
        value: m.id,
        text: m.name
      });
      if (m.id === currentModel) opt.selected = true;
    }
  }
  // ─── Composer ──────────────────────────────────────────────────────────────
  buildComposer(parent) {
    const chips = parent.createDiv({ cls: "agy-chips" });
    this.selectionChip = chips.createSpan({ cls: "agy-chip agy-chip--hidden" });
    this.selectionChip.createSpan({ cls: "agy-chip-dot" });
    this.selectionChip.createSpan({ cls: "agy-chip-label", text: "@selection" });
    this.noteChip = chips.createSpan({ cls: "agy-chip" });
    this.noteChip.createSpan({ cls: "agy-chip-dot" });
    this.noteChip.createSpan({ cls: "agy-chip-label", text: "@note" });
    const row = parent.createDiv({ cls: "agy-composer-row" });
    this.input = row.createEl("textarea", {
      cls: "agy-input",
      attr: { placeholder: "Ask AGY\u2026", rows: "1" }
    });
    this.input.addEventListener("input", () => this.onInput());
    this.input.addEventListener("keydown", (e) => this.onKey(e));
    const btnGroup = row.createDiv({ cls: "agy-btn-group" });
    this.cancelBtn = btnGroup.createEl("button", {
      cls: "agy-cancel-btn agy-hidden",
      text: "\u2715"
    });
    this.cancelBtn.title = "Stop";
    this.cancelBtn.addEventListener("click", () => {
      this.sc.destroy();
      this.setUIState("ANSWER");
      this.appendInlineError(this.thread, "Stopped.");
    });
    this.sendBtn = btnGroup.createEl("button", {
      cls: "agy-send-btn",
      text: "\u2191"
    });
    this.sendBtn.disabled = true;
    this.sendBtn.addEventListener("click", () => this.doSend());
  }
  syncChips() {
    var _a;
    const file = this.app.workspace.getActiveFile();
    const name = (_a = file == null ? void 0 : file.basename) != null ? _a : "note";
    this.noteChip.querySelector(".agy-chip-label").textContent = `@${name}`;
    const hasSel = !!this.ctx.getSelection();
    this.selectionChip.toggleClass("agy-chip--hidden", !hasSel);
  }
  onInput() {
    this.sendBtn.disabled = this.input.value.trim() === "" || this.uiState === "RUNNING";
    this.input.style.height = "auto";
    this.input.style.height = Math.min(this.input.scrollHeight, 80) + "px";
  }
  onKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!this.sendBtn.disabled) this.doSend();
    }
    if (e.key === "Escape" && this.uiState === "RUNNING") {
      this.cancelBtn.click();
    }
  }
  // ─── Send turn ─────────────────────────────────────────────────────────────
  async doSend() {
    var _a, _b, _c, _d;
    const prompt = this.input.value.trim();
    if (!prompt || this.uiState === "RUNNING") return;
    this.input.value = "";
    this.input.style.height = "";
    this.sendBtn.disabled = true;
    this.appendUserBubble(prompt);
    this.setUIState("RUNNING");
    this.ensureAgyBubble();
    const TIMEOUT_MS = 3e4;
    const timeout = window.setTimeout(() => {
      this.sc.destroy();
      this.setUIState("ANSWER");
      this.appendInlineError(this.thread, "No response after 30 s. AGY may be busy.");
    }, TIMEOUT_MS);
    try {
      let proposalText = "";
      let inProposalBlock = false;
      let fullText = "";
      for await (const event of this.sc.sendTurn(prompt, this.extraCtx)) {
        if (event.type === "text") {
          fullText += event.content;
          const merged = fullText;
          const startTag = "```edit-proposal";
          const endTag = "```";
          if (!inProposalBlock && merged.includes(startTag)) {
            inProposalBlock = true;
            const before = merged.slice(0, merged.indexOf(startTag));
            this.appendToAgyBubble(before.replace(fullText.slice(0, fullText.indexOf(startTag)), ""));
          } else if (inProposalBlock) {
            proposalText = merged.slice(merged.indexOf(startTag) + startTag.length);
            const closeIdx = proposalText.indexOf("\n" + endTag);
            if (closeIdx !== -1) {
              const json = proposalText.slice(0, closeIdx).trim();
              inProposalBlock = false;
              try {
                const proposal = JSON.parse(json);
                window.clearTimeout(timeout);
                this.setUIState("PROPOSAL");
                this.appendProposalBubble(proposal);
              } catch (e) {
                this.appendInlineError(this.thread, "Could not parse edit proposal.");
                this.setUIState("ANSWER");
              }
            }
          } else {
            this.appendToAgyBubble(event.content);
            this.scrollThread();
          }
        }
        if (event.type === "done") {
          window.clearTimeout(timeout);
          if (this.uiState === "RUNNING") this.setUIState("ANSWER");
          (_a = this.agyCursorEl) == null ? void 0 : _a.removeClass("agy-bubble--streaming");
          (_b = this.statusEl) == null ? void 0 : _b.addClass("agy-hidden");
        }
        if (event.type === "error") {
          window.clearTimeout(timeout);
          (_c = this.agyCursorEl) == null ? void 0 : _c.removeClass("agy-bubble--streaming");
          (_d = this.statusEl) == null ? void 0 : _d.addClass("agy-hidden");
          this.appendInlineError(this.thread, event.error);
          this.setUIState("ANSWER");
        }
      }
    } catch (err) {
      window.clearTimeout(timeout);
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not found") || msg.includes("ENOENT")) {
        this.showError("AGY CLI not found. Make sure 'agy' is in PATH.");
      } else {
        this.appendInlineError(this.thread, msg);
        this.setUIState("ANSWER");
      }
    }
  }
  // ─── State management ───────────────────────────────────────────────────────
  setUIState(s) {
    var _a;
    this.uiState = s;
    const busy = s === "RUNNING";
    this.input.disabled = busy || s === "ERROR";
    this.sendBtn.disabled = busy || s === "ERROR" || this.input.value.trim() === "";
    this.cancelBtn.toggleClass("agy-hidden", !busy);
    (_a = this.statusEl) == null ? void 0 : _a.toggleClass("agy-hidden", !busy);
  }
  // ─── Empty / Error slates ───────────────────────────────────────────────────
  showEmpty() {
    this.thread.empty();
    this.agyCursorEl = null;
    this.statusEl = null;
    const slate = this.thread.createDiv({ cls: "agy-empty-slate" });
    slate.createDiv({ cls: "agy-empty-icon", text: "\u2726" });
    slate.createDiv({ cls: "agy-empty-label", text: "Ask AGY about this note" });
    this.setUIState("EMPTY");
    this.syncChips();
  }
  showError(msg) {
    this.thread.empty();
    this.agyCursorEl = null;
    this.statusEl = null;
    const slate = this.thread.createDiv({ cls: "agy-error-slate" });
    slate.createDiv({ cls: "agy-error-icon", text: "\u26A0" });
    slate.createDiv({ cls: "agy-error-title", text: "AGY unavailable" });
    slate.createDiv({ cls: "agy-error-body", text: msg });
    const btn = slate.createEl("button", {
      cls: "agy-configure-btn",
      text: "Configure AGY \u2192"
    });
    btn.addEventListener("click", () => {
      var _a, _b;
      (_b = (_a = this.app.setting) == null ? void 0 : _a.open) == null ? void 0 : _b.call(_a);
    });
    this.setUIState("ERROR");
  }
  // ─── Bubble builders ────────────────────────────────────────────────────────
  appendUserBubble(text) {
    var _a;
    (_a = this.thread.querySelector(".agy-empty-slate")) == null ? void 0 : _a.remove();
    const b = this.thread.createDiv({ cls: "agy-bubble agy-bubble--user" });
    b.setText(text);
  }
  ensureAgyBubble() {
    if (this.agyCursorEl) return;
    this.statusEl = this.thread.createDiv({ cls: "agy-status-line" });
    this.statusEl.createDiv({ cls: "agy-spinner" });
    const label = this.statusEl.createSpan();
    const sel = this.ctx.getSelection();
    label.textContent = sel ? "Reading selection\u2026" : "Reading note\u2026";
    this.agyCursorEl = this.thread.createDiv({
      cls: "agy-bubble agy-bubble--agy agy-bubble--streaming"
    });
  }
  appendToAgyBubble(text) {
    if (!this.agyCursorEl) return;
    this.agyCursorEl.appendText(text);
  }
  appendProposalBubble(proposal) {
    const wrap = this.thread.createDiv({ cls: "agy-proposal" });
    wrap.createDiv({ cls: "agy-proposal-badge", text: "\u{1F4C4} " + proposal.file });
    if (proposal.reason) {
      wrap.createDiv({ cls: "agy-proposal-reason", text: proposal.reason });
    }
    const diff = wrap.createDiv({ cls: "agy-proposal-diff" });
    proposal.original.split("\n").forEach(
      (line) => diff.createDiv({ cls: "agy-diff-removed", text: "- " + line })
    );
    proposal.replacement.split("\n").forEach(
      (line) => diff.createDiv({ cls: "agy-diff-added", text: "+ " + line })
    );
    const actions = wrap.createDiv({ cls: "agy-proposal-actions" });
    const rejectBtn = actions.createEl("button", {
      cls: "agy-btn-reject",
      text: "Reject"
    });
    const applyBtn = actions.createEl("button", {
      cls: "agy-btn-apply",
      text: "Apply \u2713"
    });
    rejectBtn.addEventListener("click", () => {
      actions.remove();
      wrap.createDiv({
        cls: "agy-result-badge agy-badge--rejected",
        text: "\u2715 Rejected"
      });
      this.setUIState("ANSWER");
    });
    applyBtn.addEventListener("click", async () => {
      applyBtn.disabled = true;
      applyBtn.textContent = "Applying\u2026";
      const result = await this.sc.applyProposal(proposal);
      actions.remove();
      if (result.ok) {
        wrap.createDiv({
          cls: "agy-result-badge agy-badge--applied",
          text: "\u2713 Applied to " + proposal.file
        });
        this.setUIState("APPLIED");
      } else {
        wrap.createDiv({
          cls: "agy-result-badge agy-badge--stale",
          text: "\u26A0 " + result.message
        });
        this.setUIState("ANSWER");
      }
    });
    this.scrollThread();
  }
  appendInlineError(parent, msg) {
    parent.createDiv({ cls: "agy-inline-error", text: "\u26A0 " + msg });
    this.scrollThread();
  }
  scrollThread() {
    this.thread.scrollTo({ top: this.thread.scrollHeight, behavior: "smooth" });
  }
};

// src/main.ts
var AgyPlugin = class extends import_obsidian3.Plugin {
  async onload() {
    this.adapter = new AgyAdapter();
    this.store = new SessionStore();
    this.ctx = new ObsidianContext(this.app);
    this.sc = new SessionController(this, this.store, this.adapter, this.ctx);
    await this.sc.init();
    this.registerView(
      AGY_VIEW_TYPE,
      (leaf) => new ChatView(leaf, this.sc, this.ctx)
    );
    this.addRibbonIcon("sparkles", "Open AGY", () => this.activateView());
    this.addCommand({
      id: "open-agy-sidebar",
      name: "Open AGY sidebar",
      callback: () => this.activateView()
    });
    this.addCommand({
      id: "focus-agy-composer",
      name: "Focus AGY composer",
      hotkeys: [{ modifiers: ["Mod"], key: "l" }],
      callback: async () => {
        await this.activateView();
        setTimeout(() => {
          var _a, _b, _c;
          const leaves = this.app.workspace.getLeavesOfType(AGY_VIEW_TYPE);
          const view = (_a = leaves[0]) == null ? void 0 : _a.view;
          (_c = (_b = view == null ? void 0 : view.input) == null ? void 0 : _b.focus) == null ? void 0 : _c.call(_b);
        }, 100);
      }
    });
  }
  async onunload() {
    this.app.workspace.detachLeavesOfType(AGY_VIEW_TYPE);
  }
  async activateView() {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(AGY_VIEW_TYPE);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: AGY_VIEW_TYPE, active: true });
    workspace.revealLeaf(leaf);
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2FnZW50L0FneUFkYXB0ZXIudHMiLCAic3JjL2NvbnRleHQvT2JzaWRpYW5Db250ZXh0LnRzIiwgInNyYy9zZXNzaW9uL1Nlc3Npb25TdG9yZS50cyIsICJzcmMvc2Vzc2lvbi9TZXNzaW9uQ29udHJvbGxlci50cyIsICJzcmMvY2hhdC9DaGF0Vmlldy50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgUGx1Z2luIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBBZ3lBZGFwdGVyIH0gZnJvbSBcIi4vYWdlbnQvQWd5QWRhcHRlclwiO1xuaW1wb3J0IHsgT2JzaWRpYW5Db250ZXh0IH0gZnJvbSBcIi4vY29udGV4dC9PYnNpZGlhbkNvbnRleHRcIjtcbmltcG9ydCB7IFNlc3Npb25TdG9yZSB9IGZyb20gXCIuL3Nlc3Npb24vU2Vzc2lvblN0b3JlXCI7XG5pbXBvcnQgeyBTZXNzaW9uQ29udHJvbGxlciB9IGZyb20gXCIuL3Nlc3Npb24vU2Vzc2lvbkNvbnRyb2xsZXJcIjtcbmltcG9ydCB7IENoYXRWaWV3LCBBR1lfVklFV19UWVBFIH0gZnJvbSBcIi4vY2hhdC9DaGF0Vmlld1wiO1xuXG4vKipcbiAqIEFneVBsdWdpbiBcdTIwMTQgZW50cnkgcG9pbnQuXG4gKlxuICogV2lyZXMgdG9nZXRoZXI6XG4gKiAgIEFneUFkYXB0ZXIgXHUyMTkwIFNlc3Npb25Db250cm9sbGVyIFx1MjE5MCBDaGF0Vmlld1xuICogICAgICAgICAgICAgICAgICAgICBcdTIxOTFcbiAqICAgICAgICAgICAgICAgU2Vzc2lvblN0b3JlICsgT2JzaWRpYW5Db250ZXh0XG4gKlxuICogTGlmZWN5Y2xlOlxuICogICBvbmxvYWQgIFx1MjE5MiByZWdpc3RlciB2aWV3ICsgcmliYm9uICsgY29tbWFuZHMsIGluaXQgU2Vzc2lvbkNvbnRyb2xsZXJcbiAqICAgb251bmxvYWQgXHUyMTkyIGRldGFjaCBsZWF2ZXMgKGtpbGxzIGFueSBydW5uaW5nIHByb2Nlc3MgdmlhIENoYXRWaWV3Lm9uQ2xvc2UpXG4gKi9cbmV4cG9ydCBkZWZhdWx0IGNsYXNzIEFneVBsdWdpbiBleHRlbmRzIFBsdWdpbiB7XG4gIHByaXZhdGUgYWRhcHRlciE6IEFneUFkYXB0ZXI7XG4gIHByaXZhdGUgc3RvcmUhOiBTZXNzaW9uU3RvcmU7XG4gIHByaXZhdGUgY3R4ITogT2JzaWRpYW5Db250ZXh0O1xuICBwcml2YXRlIHNjITogU2Vzc2lvbkNvbnRyb2xsZXI7XG5cbiAgYXN5bmMgb25sb2FkKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIC8vIEJ1aWxkIGNvcmUgc2VydmljZXNcbiAgICB0aGlzLmFkYXB0ZXIgPSBuZXcgQWd5QWRhcHRlcigpO1xuICAgIHRoaXMuc3RvcmUgICA9IG5ldyBTZXNzaW9uU3RvcmUoKTtcbiAgICB0aGlzLmN0eCAgICAgPSBuZXcgT2JzaWRpYW5Db250ZXh0KHRoaXMuYXBwKTtcbiAgICB0aGlzLnNjICAgICAgPSBuZXcgU2Vzc2lvbkNvbnRyb2xsZXIodGhpcywgdGhpcy5zdG9yZSwgdGhpcy5hZGFwdGVyLCB0aGlzLmN0eCk7XG5cbiAgICAvLyBJbml0IHNlc3Npb24gKGxvYWRzIHBlcnNpc3RlZCBkYXRhLCBmZXRjaGVzIG1vZGVscylcbiAgICBhd2FpdCB0aGlzLnNjLmluaXQoKTtcblxuICAgIC8vIFJlZ2lzdGVyIHNpZGViYXIgdmlld1xuICAgIHRoaXMucmVnaXN0ZXJWaWV3KFxuICAgICAgQUdZX1ZJRVdfVFlQRSxcbiAgICAgIChsZWFmKSA9PiBuZXcgQ2hhdFZpZXcobGVhZiwgdGhpcy5zYywgdGhpcy5jdHgpXG4gICAgKTtcblxuICAgIC8vIFJpYmJvbiBpY29uXG4gICAgdGhpcy5hZGRSaWJib25JY29uKFwic3BhcmtsZXNcIiwgXCJPcGVuIEFHWVwiLCAoKSA9PiB0aGlzLmFjdGl2YXRlVmlldygpKTtcblxuICAgIC8vIENvbW1hbmQgcGFsZXR0ZVxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XG4gICAgICBpZDogXCJvcGVuLWFneS1zaWRlYmFyXCIsXG4gICAgICBuYW1lOiBcIk9wZW4gQUdZIHNpZGViYXJcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLmFjdGl2YXRlVmlldygpLFxuICAgIH0pO1xuXG4gICAgLy8gS2V5Ym9hcmQgc2hvcnRjdXQ6IEN0cmwvQ21kK0xcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xuICAgICAgaWQ6IFwiZm9jdXMtYWd5LWNvbXBvc2VyXCIsXG4gICAgICBuYW1lOiBcIkZvY3VzIEFHWSBjb21wb3NlclwiLFxuICAgICAgaG90a2V5czogW3sgbW9kaWZpZXJzOiBbXCJNb2RcIl0sIGtleTogXCJsXCIgfV0sXG4gICAgICBjYWxsYmFjazogYXN5bmMgKCkgPT4ge1xuICAgICAgICBhd2FpdCB0aGlzLmFjdGl2YXRlVmlldygpO1xuICAgICAgICAvLyBHaXZlIHRoZSBsZWFmIHRpbWUgdG8gb3BlbiwgdGhlbiBmb2N1cyB0aGUgaW5wdXRcbiAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgICAgY29uc3QgbGVhdmVzID0gdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShBR1lfVklFV19UWVBFKTtcbiAgICAgICAgICBjb25zdCB2aWV3ID0gbGVhdmVzWzBdPy52aWV3IGFzIENoYXRWaWV3IHwgdW5kZWZpbmVkO1xuICAgICAgICAgICh2aWV3IGFzIGFueSk/LmlucHV0Py5mb2N1cz8uKCk7XG4gICAgICAgIH0sIDEwMCk7XG4gICAgICB9LFxuICAgIH0pO1xuICB9XG5cbiAgYXN5bmMgb251bmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgLy8gS2lsbHMgYW55IHJ1bm5pbmcgQUdZIHByb2Nlc3MgdmlhIENoYXRWaWV3Lm9uQ2xvc2UgXHUyMTkyIHNjLmRlc3Ryb3koKVxuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5kZXRhY2hMZWF2ZXNPZlR5cGUoQUdZX1ZJRVdfVFlQRSk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGFjdGl2YXRlVmlldygpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCB7IHdvcmtzcGFjZSB9ID0gdGhpcy5hcHA7XG4gICAgY29uc3QgZXhpc3RpbmcgPSB3b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEFHWV9WSUVXX1RZUEUpO1xuICAgIGlmIChleGlzdGluZy5sZW5ndGggPiAwKSB7XG4gICAgICB3b3Jrc3BhY2UucmV2ZWFsTGVhZihleGlzdGluZ1swXSk7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIGNvbnN0IGxlYWYgPSB3b3Jrc3BhY2UuZ2V0UmlnaHRMZWFmKGZhbHNlKTtcbiAgICBpZiAoIWxlYWYpIHJldHVybjtcbiAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7IHR5cGU6IEFHWV9WSUVXX1RZUEUsIGFjdGl2ZTogdHJ1ZSB9KTtcbiAgICB3b3Jrc3BhY2UucmV2ZWFsTGVhZihsZWFmKTtcbiAgfVxufVxuIiwgImltcG9ydCB7IHNwYXduLCBDaGlsZFByb2Nlc3MgfSBmcm9tIFwiY2hpbGRfcHJvY2Vzc1wiO1xuaW1wb3J0IHtcbiAgQWdlbnRBZGFwdGVyLFxuICBBZ2VudElucHV0LFxuICBBZ2VudENvbnRleHQsXG4gIEFneVN0cmVhbUV2ZW50LFxuICBBZ3lNb2RlbCxcbiAgU2VuZE9wdGlvbnMsXG59IGZyb20gXCIuLi90eXBlc1wiO1xuXG4vLyBcdTI1MDBcdTI1MDBcdTI1MDAgQUdZIENMSSBzdHJlYW0tanNvbiBwcm90b2NvbCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbi8vXG4vLyBJbnZvY2F0aW9uOlxuLy8gICBhZ3kgLS1pbnB1dC1mb3JtYXQgc3RyZWFtLWpzb24gLS1vdXRwdXQtZm9ybWF0IHN0cmVhbS1qc29uIFstLW1vZGVsIDxpZD5dXG4vLyAgICAgICBbLS1jb252ZXJzYXRpb24gPGlkPl1cbi8vXG4vLyBzdGRpbiAob25lIEpTT04gbGluZSBwZXIgdHVybik6XG4vLyAgIHtcInJvbGVcIjpcInVzZXJcIixcImNvbnRlbnRcIjpcIjxwcm9tcHQ+XCJ9XG4vL1xuLy8gc3Rkb3V0IChOREpTT04gc3RyZWFtKTpcbi8vICAge1wiZXZlbnRcIjpcImluaXRcIixcImNvbnZlcnNhdGlvbl9pZFwiOlwiPHV1aWQ+XCIsXCJpbml0XCI6ey4uLn19XG4vLyAgIHtcImV2ZW50XCI6XCJ0ZXh0XCIsXCJ0ZXh0XCI6XCI8ZGVsdGE+XCJ9ICAgICBcdTIxOTAgc3RyZWFtaW5nIHRleHQgdG9rZW5cbi8vICAge1wiZXZlbnRcIjpcInJlc3VsdFwiLFwicmVzdWx0XCI6ey4uLn19ICAgICBcdTIxOTAgdHVybiBjb21wbGV0ZVxuLy8gICB7XCJldmVudFwiOlwiZXJyb3JcIixcImVycm9yXCI6XCI8bXNnPlwifVxuLy9cbi8vIFJlZmVyZW5jZTogb2JzZXJ2ZWQgZnJvbSBgYWd5IC0taGVscGAgKyBsaXZlIHRlc3QuXG4vLyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuZXhwb3J0IGNsYXNzIEFneUFkYXB0ZXIgaW1wbGVtZW50cyBBZ2VudEFkYXB0ZXIge1xuICBwcml2YXRlIHByb2M6IENoaWxkUHJvY2VzcyB8IG51bGwgPSBudWxsO1xuXG4gIC8vIFx1MjUwMFx1MjUwMCBwaW5nIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIGFzeW5jIHBpbmcoKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3Qgd2hpY2ggPSBwcm9jZXNzLnBsYXRmb3JtID09PSBcIndpbjMyXCIgPyBcIndoZXJlXCIgOiBcIndoaWNoXCI7XG4gICAgICBjb25zdCBwID0gc3Bhd24od2hpY2gsIFtcImFneVwiXSk7XG4gICAgICBsZXQgb3V0ID0gXCJcIjtcbiAgICAgIHAuc3Rkb3V0Py5vbihcImRhdGFcIiwgKGQ6IEJ1ZmZlcikgPT4gKG91dCArPSBkLnRvU3RyaW5nKCkpKTtcbiAgICAgIHAub24oXCJjbG9zZVwiLCAoY29kZSkgPT4ge1xuICAgICAgICBpZiAoY29kZSA9PT0gMCAmJiBvdXQudHJpbSgpKSB7XG4gICAgICAgICAgcmVzb2x2ZShvdXQudHJpbSgpLnNwbGl0KC9cXHI/XFxuLylbMF0pO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHJlamVjdChuZXcgRXJyb3IoXCJBR1kgQ0xJIG5vdCBmb3VuZC4gSW5zdGFsbCBpdCBhbmQgZW5zdXJlICdhZ3knIGlzIGluIFBBVEguXCIpKTtcbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfSk7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgc2VuZCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBhc3luYyAqc2VuZChpbnB1dDogQWdlbnRJbnB1dCwgb3B0czogU2VuZE9wdGlvbnMpOiBBc3luY0l0ZXJhYmxlPEFneVN0cmVhbUV2ZW50PiB7XG4gICAgY29uc3QgYmluID0gYXdhaXQgdGhpcy5waW5nKCk7XG4gICAgY29uc3QgZnVsbFByb21wdCA9IHRoaXMuYnVpbGRGdWxsUHJvbXB0KGlucHV0KTtcbiAgICBjb25zdCBhcmdzID0gdGhpcy5idWlsZEFyZ3MoZnVsbFByb21wdCwgb3B0cyk7XG5cbiAgICB0aGlzLnByb2MgPSBzcGF3bihiaW4sIGFyZ3MsIHsgc3RkaW86IFtcImlnbm9yZVwiLCBcInBpcGVcIiwgXCJwaXBlXCJdIH0pO1xuICAgIGNvbnN0IHsgcHJvYyB9ID0gdGhpcztcblxuICAgIC8vIFlpZWxkIGV2ZW50cyBmcm9tIHN0ZG91dCBOREpTT04gc3RyZWFtXG4gICAgeWllbGQqIHRoaXMucmVhZEV2ZW50cyhwcm9jKTtcbiAgfVxuXG4gIHByaXZhdGUgYnVpbGRBcmdzKHByb21wdDogc3RyaW5nLCBvcHRzOiBTZW5kT3B0aW9ucyk6IHN0cmluZ1tdIHtcbiAgICBjb25zdCBhcmdzID0gW1xuICAgICAgXCItLXByaW50XCIsIHByb21wdCxcbiAgICAgIFwiLS1vdXRwdXQtZm9ybWF0XCIsIFwic3RyZWFtLWpzb25cIixcbiAgICAgIFwiLS1kYW5nZXJvdXNseS1za2lwLXBlcm1pc3Npb25zXCIsXG4gICAgXTtcbiAgICBpZiAob3B0cy5tb2RlbCkge1xuICAgICAgYXJncy5wdXNoKFwiLS1tb2RlbFwiLCBvcHRzLm1vZGVsKTtcbiAgICB9XG4gICAgaWYgKG9wdHMuY29udmVyc2F0aW9uSWQpIHtcbiAgICAgIGFyZ3MucHVzaChcIi0tY29udmVyc2F0aW9uXCIsIG9wdHMuY29udmVyc2F0aW9uSWQpO1xuICAgIH1cbiAgICByZXR1cm4gYXJncztcbiAgfVxuXG4gIC8qKlxuICAgKiBGb3JtYXQgQWdlbnRJbnB1dCB3aXRoIGNvbnRleHQgYXMgYSBzdHJ1Y3R1cmVkIHByZWFtYmxlIGJlZm9yZSBwcm9tcHQuXG4gICAqL1xuICBwcml2YXRlIGJ1aWxkRnVsbFByb21wdChpbnB1dDogQWdlbnRJbnB1dCk6IHN0cmluZyB7XG4gICAgY29uc3QgY29udGV4dFByZWFtYmxlID0gdGhpcy5mb3JtYXRDb250ZXh0KGlucHV0LmNvbnRleHQpO1xuICAgIHJldHVybiBjb250ZXh0UHJlYW1ibGVcbiAgICAgID8gYCR7Y29udGV4dFByZWFtYmxlfVxcblxcbi0tLVxcblxcbiR7aW5wdXQucHJvbXB0fWBcbiAgICAgIDogaW5wdXQucHJvbXB0O1xuICB9XG5cbiAgcHJpdmF0ZSBmb3JtYXRDb250ZXh0KGN0eDogQWdlbnRDb250ZXh0W10pOiBzdHJpbmcge1xuICAgIGlmIChjdHgubGVuZ3RoID09PSAwKSByZXR1cm4gXCJcIjtcbiAgICByZXR1cm4gY3R4XG4gICAgICAubWFwKChjKSA9PiB7XG4gICAgICAgIGNvbnN0IGxhYmVsID1cbiAgICAgICAgICBjLnR5cGUgPT09IFwic2VsZWN0aW9uXCJcbiAgICAgICAgICAgID8gYFtTZWxlY3RlZCB0ZXh0IGZyb20gJHtjLmZpbGV9XWBcbiAgICAgICAgICAgIDogYFtOb3RlOiAke2MuZmlsZX1dYDtcbiAgICAgICAgcmV0dXJuIGAke2xhYmVsfVxcblxcYFxcYFxcYFxcbiR7Yy5jb250ZW50fVxcblxcYFxcYFxcYGA7XG4gICAgICB9KVxuICAgICAgLmpvaW4oXCJcXG5cXG5cIik7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgc3Rkb3V0IHJlYWRlciBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIGFzeW5jICpyZWFkRXZlbnRzKHByb2M6IENoaWxkUHJvY2Vzcyk6IEFzeW5jSXRlcmFibGU8QWd5U3RyZWFtRXZlbnQ+IHtcbiAgICBsZXQgYnVmZmVyID0gXCJcIjtcbiAgICBjb25zdCBxdWV1ZTogc3RyaW5nW10gPSBbXTtcbiAgICBsZXQgbm90aWZ5OiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcbiAgICBsZXQgY2xvc2VkID0gZmFsc2U7XG5cbiAgICBjb25zdCBwdXNoID0gKGxpbmU6IHN0cmluZykgPT4ge1xuICAgICAgcXVldWUucHVzaChsaW5lKTtcbiAgICAgIG5vdGlmeT8uKCk7XG4gICAgICBub3RpZnkgPSBudWxsO1xuICAgIH07XG5cbiAgICBwcm9jLnN0ZG91dD8ub24oXCJkYXRhXCIsIChjaHVuazogQnVmZmVyKSA9PiB7XG4gICAgICBidWZmZXIgKz0gY2h1bmsudG9TdHJpbmcoKTtcbiAgICAgIGNvbnN0IHBhcnRzID0gYnVmZmVyLnNwbGl0KC9cXHI/XFxuLyk7XG4gICAgICBidWZmZXIgPSBwYXJ0cy5wb3AoKSA/PyBcIlwiO1xuICAgICAgZm9yIChjb25zdCBwYXJ0IG9mIHBhcnRzKSB7XG4gICAgICAgIGNvbnN0IGxpbmUgPSBwYXJ0LnRyaW0oKTtcbiAgICAgICAgaWYgKGxpbmUpIHB1c2gobGluZSk7XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICBwcm9jLnN0ZGVycj8ub24oXCJkYXRhXCIsIChjaHVuazogQnVmZmVyKSA9PiB7XG4gICAgICBjb25zdCBtc2cgPSBjaHVuay50b1N0cmluZygpLnRyaW0oKTtcbiAgICAgIGlmIChtc2cpIGNvbnNvbGUud2FybihcIltBZ3lBZGFwdGVyXVwiLCBtc2cpO1xuICAgIH0pO1xuXG4gICAgcHJvYy5vbihcImNsb3NlXCIsICgpID0+IHtcbiAgICAgIGNsb3NlZCA9IHRydWU7XG4gICAgICBub3RpZnk/LigpO1xuICAgICAgbm90aWZ5ID0gbnVsbDtcbiAgICB9KTtcblxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBpZiAocXVldWUubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zdCBsaW5lID0gcXVldWUuc2hpZnQoKSE7XG4gICAgICAgIGNvbnN0IGV2ZW50ID0gdGhpcy5wYXJzZUxpbmUobGluZSk7XG4gICAgICAgIGlmIChldmVudCkge1xuICAgICAgICAgIHlpZWxkIGV2ZW50O1xuICAgICAgICAgIGlmIChldmVudC50eXBlID09PSBcImRvbmVcIiB8fCBldmVudC50eXBlID09PSBcImVycm9yXCIpIGJyZWFrO1xuICAgICAgICB9XG4gICAgICB9IGVsc2UgaWYgKGNsb3NlZCkge1xuICAgICAgICBicmVhaztcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXMpID0+IHsgbm90aWZ5ID0gcmVzOyB9KTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogUGFyc2Ugb25lIE5ESlNPTiBsaW5lIGZyb20gQUdZIHN0ZG91dCBpbnRvIGFuIEFneVN0cmVhbUV2ZW50LlxuICAgKlxuICAgKiBLbm93biBBR1kgb3V0cHV0IGV2ZW50czpcbiAgICogICB7XCJldmVudFwiOlwiaW5pdFwiLFwiY29udmVyc2F0aW9uX2lkXCI6XCIuLi5cIn1cbiAgICogICB7XCJldmVudFwiOlwidGV4dFwiLFwidGV4dFwiOlwiLi4uXCJ9XG4gICAqICAge1wiZXZlbnRcIjpcInJlc3VsdFwiLFwicmVzdWx0XCI6ey4uLn19XG4gICAqICAge1wiZXZlbnRcIjpcImVycm9yXCIsXCJlcnJvclwiOlwiLi4uXCJ9XG4gICAqL1xuICBwcml2YXRlIHBhcnNlTGluZShsaW5lOiBzdHJpbmcpOiBBZ3lTdHJlYW1FdmVudCB8IG51bGwge1xuICAgIGxldCBvYmo6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xuICAgIHRyeSB7XG4gICAgICBvYmogPSBKU09OLnBhcnNlKGxpbmUpO1xuICAgIH0gY2F0Y2gge1xuICAgICAgcmV0dXJuIG51bGw7IC8vIG5vbi1KU09OIGRlYnVnIG91dHB1dCBcdTIwMTQgc2tpcFxuICAgIH1cblxuICAgIGNvbnN0IGV2ID0gb2JqW1wiZXZlbnRcIl0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xuXG4gICAgaWYgKGV2ID09PSBcImluaXRcIikge1xuICAgICAgLy8gRXh0cmFjdCBjb252ZXJzYXRpb25faWQgYW5kIGVtaXQgYXMgbWV0YWRhdGEgKGlnbm9yZSBpbiBzdHJlYW0pXG4gICAgICBjb25zdCBjb252SWQgPVxuICAgICAgICAob2JqW1wiY29udmVyc2F0aW9uX2lkXCJdIGFzIHN0cmluZyB8IHVuZGVmaW5lZCkgfHxcbiAgICAgICAgKChvYmpbXCJpbml0XCJdIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkKT8uW1wiY29udmVyc2F0aW9uX2lkXCJdIGFzIHN0cmluZyB8IHVuZGVmaW5lZCk7XG4gICAgICB0aGlzLl9sYXN0Q29udmVyc2F0aW9uSWQgPSBjb252SWQ7XG4gICAgICByZXR1cm4gbnVsbDsgLy8gaW5pdCBpcyBub3QgYSB1c2VyLXZpc2libGUgZXZlbnRcbiAgICB9XG5cbiAgICAvLyBSZWFsIEFHWSBzdHJlYW0gZXZlbnQ6IHtcImV2ZW50XCI6XCJzdGVwX3VwZGF0ZVwiLFwic3RlcF91cGRhdGVcIjp7XCJzdGF0ZVwiOlwiQUNUSVZFXCIsXCJzdGVwX3R5cGVcIjpcImFnZW50X3Jlc3BvbnNlXCIsXCJ0ZXh0X2RlbHRhXCI6XCIuLi5cIn19XG4gICAgaWYgKGV2ID09PSBcInN0ZXBfdXBkYXRlXCIpIHtcbiAgICAgIGNvbnN0IHN1ID0gb2JqW1wic3RlcF91cGRhdGVcIl0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XG4gICAgICBjb25zdCBkZWx0YSA9IHN1Py5bXCJ0ZXh0X2RlbHRhXCJdIGFzIHN0cmluZyB8IHVuZGVmaW5lZDtcbiAgICAgIGlmIChkZWx0YSkge1xuICAgICAgICByZXR1cm4geyB0eXBlOiBcInRleHRcIiwgY29udGVudDogZGVsdGEgfTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIC8vIEZhbGxiYWNrIGlmIGxlZ2FjeS9tb2NrIGVtaXRzIFwidGV4dFwiIGV2ZW50XG4gICAgaWYgKGV2ID09PSBcInRleHRcIikge1xuICAgICAgY29uc3QgdGV4dCA9IG9ialtcInRleHRcIl0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xuICAgICAgaWYgKHRleHQpIHJldHVybiB7IHR5cGU6IFwidGV4dFwiLCBjb250ZW50OiB0ZXh0IH07XG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XG5cbiAgICBpZiAoZXYgPT09IFwicmVzdWx0XCIpIHtcbiAgICAgIGNvbnN0IHJlcyA9IG9ialtcInJlc3VsdFwiXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcbiAgICAgIGNvbnN0IGNvbnZJZCA9XG4gICAgICAgIChyZXM/LltcImNvbnZlcnNhdGlvbl9pZFwiXSBhcyBzdHJpbmcgfCB1bmRlZmluZWQpIHx8IHRoaXMuX2xhc3RDb252ZXJzYXRpb25JZDtcbiAgICAgIHJldHVybiB7IHR5cGU6IFwiZG9uZVwiLCBjb252ZXJzYXRpb25JZDogY29udklkIH07XG4gICAgfVxuXG4gICAgaWYgKGV2ID09PSBcImVycm9yXCIpIHtcbiAgICAgIHJldHVybiB7IHR5cGU6IFwiZXJyb3JcIiwgZXJyb3I6IFN0cmluZyhvYmpbXCJlcnJvclwiXSA/PyBcIlVua25vd24gZXJyb3JcIikgfTtcbiAgICB9XG5cbiAgICByZXR1cm4gbnVsbDsgLy8gdW5rbm93biBldmVudCBcdTIwMTQgc2tpcFxuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIGxpc3RNb2RlbHMgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgYXN5bmMgbGlzdE1vZGVscygpOiBQcm9taXNlPEFneU1vZGVsW10+IHtcbiAgICBjb25zdCBiaW4gPSBhd2FpdCB0aGlzLnBpbmcoKTtcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xuICAgICAgY29uc3QgcCA9IHNwYXduKGJpbiwgW1wibW9kZWxzXCJdKTtcbiAgICAgIGxldCBvdXQgPSBcIlwiO1xuICAgICAgcC5zdGRvdXQ/Lm9uKFwiZGF0YVwiLCAoZDogQnVmZmVyKSA9PiAob3V0ICs9IGQudG9TdHJpbmcoKSkpO1xuICAgICAgcC5vbihcImNsb3NlXCIsICgpID0+IHtcbiAgICAgICAgY29uc3QgbW9kZWxzOiBBZ3lNb2RlbFtdID0gb3V0XG4gICAgICAgICAgLnNwbGl0KC9cXHI/XFxuLylcbiAgICAgICAgICAuZmlsdGVyKChsKSA9PiBsLmluY2x1ZGVzKFwiXFx0XCIpKVxuICAgICAgICAgIC5tYXAoKGwpID0+IHtcbiAgICAgICAgICAgIGNvbnN0IFtpZCwgLi4ucmVzdF0gPSBsLnNwbGl0KFwiXFx0XCIpO1xuICAgICAgICAgICAgcmV0dXJuIHsgaWQ6IGlkLnRyaW0oKSwgbmFtZTogcmVzdC5qb2luKFwiXFx0XCIpLnRyaW0oKSB9O1xuICAgICAgICAgIH0pO1xuICAgICAgICByZXNvbHZlKG1vZGVscyk7XG4gICAgICB9KTtcbiAgICAgIHAub24oXCJlcnJvclwiLCByZWplY3QpO1xuICAgIH0pO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIGFib3J0IFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIGFib3J0KCk6IHZvaWQge1xuICAgIHRoaXMucHJvYz8ua2lsbChcIlNJR1RFUk1cIik7XG4gICAgdGhpcy5wcm9jID0gbnVsbDtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBpbnRlcm5hbCBzdGF0ZSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICAvKiogUG9wdWxhdGVkIGZyb20gaW5pdCBldmVudDsgcmVhZCBieSBjYWxsZXIgYWZ0ZXIgdHVybiBjb21wbGV0ZXMuICovXG4gIF9sYXN0Q29udmVyc2F0aW9uSWQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcbn1cbiIsICJpbXBvcnQgeyBBcHAsIFRGaWxlIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBBZ2VudENvbnRleHQgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuLyoqXG4gKiBPYnNpZGlhbkNvbnRleHQgXHUyMDE0IHJlc29sdmVzIGNvbnRleHQgZnJvbSB0aGUgYWN0aXZlIE9ic2lkaWFuIHdvcmtzcGFjZS5cbiAqXG4gKiBSZXNvbHV0aW9uIHJ1bGVzIChTcGlrZSAyKTpcbiAqICAgMS4gU2VsZWN0aW9uIHByZXNlbnQgXHUyMTkyIGNvbnRleHQgPSBbc2VsZWN0aW9uXVxuICogICAyLiBObyBzZWxlY3Rpb24gICAgICBcdTIxOTIgY29udGV4dCA9IFtjdXJyZW50LW5vdGVdXG4gKiAgIDMuIFVzZXIgYWRkcyBAZmlsZSAgIFx1MjE5MiBjb250ZXh0ID0gW2F1dG9dICsgW2V4cGxpY2l0Li4uXVxuICpcbiAqIEV2ZXJ5IGNvbnRleHQgaXRlbSBpcyB2aXNpYmxlIGFzIGEgY2hpcCBpbiB0aGUgQ29tcG9zZXIuXG4gKiBOb3RoaW5nIGlzIHJlYWQgc2lsZW50bHkuXG4gKi9cbmV4cG9ydCBjbGFzcyBPYnNpZGlhbkNvbnRleHQge1xuICBjb25zdHJ1Y3Rvcihwcml2YXRlIGFwcDogQXBwKSB7fVxuXG4gIC8qKiBDdXJyZW50IGVkaXRvciBzZWxlY3Rpb24sIG9yIG51bGwuICovXG4gIGdldFNlbGVjdGlvbigpOiB7IGZpbGU6IHN0cmluZzsgY29udGVudDogc3RyaW5nIH0gfCBudWxsIHtcbiAgICAvLyBAdHMtaWdub3JlIFx1MjAxNCBNYXJrZG93blZpZXcgZXhwb3NlcyAuZWRpdG9yXG4gICAgY29uc3QgZWRpdG9yID0gdGhpcy5hcHAud29ya3NwYWNlLmFjdGl2ZUxlYWY/LnZpZXc/LmVkaXRvcjtcbiAgICBpZiAoIWVkaXRvcikgcmV0dXJuIG51bGw7XG4gICAgY29uc3Qgc2VsID0gZWRpdG9yLmdldFNlbGVjdGlvbj8uKCkgPz8gXCJcIjtcbiAgICBpZiAoIXNlbCkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgcmV0dXJuIHsgZmlsZTogZmlsZT8ucGF0aCA/PyBcInVudGl0bGVkXCIsIGNvbnRlbnQ6IHNlbCB9O1xuICB9XG5cbiAgLyoqIEZ1bGwgY29udGVudCBvZiB0aGUgYWN0aXZlIG5vdGUsIG9yIG51bGwuICovXG4gIGFzeW5jIGdldEN1cnJlbnROb3RlKCk6IFByb21pc2U8eyBmaWxlOiBzdHJpbmc7IGNvbnRlbnQ6IHN0cmluZyB9IHwgbnVsbD4ge1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgIGlmICghZmlsZSB8fCAhKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xuICAgIHJldHVybiB7IGZpbGU6IGZpbGUucGF0aCwgY29udGVudCB9O1xuICB9XG5cbiAgLyoqXG4gICAqIFJlc29sdmUgdGhlIGF1dG9tYXRpYyBjb250ZXh0IGZvciBhIG5ldyB0dXJuLlxuICAgKiBSZXR1cm5zIFtzZWxlY3Rpb25dIGlmIHByZXNlbnQsIGVsc2UgW2N1cnJlbnQtbm90ZV0uXG4gICAqL1xuICBhc3luYyByZXNvbHZlQXV0bygpOiBQcm9taXNlPEFnZW50Q29udGV4dFtdPiB7XG4gICAgY29uc3Qgc2VsID0gdGhpcy5nZXRTZWxlY3Rpb24oKTtcbiAgICBpZiAoc2VsKSB7XG4gICAgICByZXR1cm4gW3sgdHlwZTogXCJzZWxlY3Rpb25cIiwgZmlsZTogc2VsLmZpbGUsIGNvbnRlbnQ6IHNlbC5jb250ZW50IH1dO1xuICAgIH1cbiAgICBjb25zdCBub3RlID0gYXdhaXQgdGhpcy5nZXRDdXJyZW50Tm90ZSgpO1xuICAgIGlmIChub3RlKSB7XG4gICAgICByZXR1cm4gW3sgdHlwZTogXCJub3RlXCIsIGZpbGU6IG5vdGUuZmlsZSwgY29udGVudDogbm90ZS5jb250ZW50IH1dO1xuICAgIH1cbiAgICByZXR1cm4gW107XG4gIH1cblxuICAvKipcbiAgICogTG9hZCBhIHNwZWNpZmljIGZpbGUgYnkgcGF0aCBmb3IgQG1lbnRpb24gY29udGV4dC5cbiAgICogUmV0dXJucyBudWxsIGlmIGZpbGUgZG9lcyBub3QgZXhpc3QuXG4gICAqL1xuICBhc3luYyBsb2FkRmlsZShwYXRoOiBzdHJpbmcpOiBQcm9taXNlPEFnZW50Q29udGV4dCB8IG51bGw+IHtcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0RmlsZUJ5UGF0aChwYXRoKTtcbiAgICBpZiAoIWZpbGUgfHwgIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICByZXR1cm4geyB0eXBlOiBcIm5vdGVcIiwgZmlsZTogcGF0aCwgY29udGVudCB9O1xuICB9XG5cbiAgLyoqXG4gICAqIFZlcmlmeSB0aGF0IGBvcmlnaW5hbGAgc3RpbGwgZXhpc3RzIHZlcmJhdGltIGluIHRoZSBhY3RpdmUgZmlsZS5cbiAgICogVXNlZCBiZWZvcmUgQXBwbHkgdG8gZGV0ZWN0IHN0YWxlIHByb3Bvc2Fscy5cbiAgICovXG4gIGFzeW5jIHZlcmlmeU9yaWdpbmFsKGZpbGVQYXRoOiBzdHJpbmcsIG9yaWdpbmFsOiBzdHJpbmcpOiBQcm9taXNlPGJvb2xlYW4+IHtcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0RmlsZUJ5UGF0aChmaWxlUGF0aCk7XG4gICAgaWYgKCFmaWxlIHx8ICEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkgcmV0dXJuIGZhbHNlO1xuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xuICAgIHJldHVybiBjb250ZW50LmluY2x1ZGVzKG9yaWdpbmFsKTtcbiAgfVxufVxuIiwgImltcG9ydCB7IENoYXRTZXNzaW9uLCBBZ3lNb2RlbCB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5jb25zdCBTVE9SRV9LRVkgPSBcImFneS1zZXNzaW9uc1wiO1xuY29uc3QgREVGQVVMVF9NT0RFTCA9IFwiZ2VtaW5pLTMuOC1mbGFzaC1tZWRpdW1cIjtcblxuaW50ZXJmYWNlIFN0b3JlRGF0YSB7XG4gIGN1cnJlbnRTZXNzaW9uSWQ6IHN0cmluZyB8IG51bGw7XG4gIHNlc3Npb25zOiBSZWNvcmQ8c3RyaW5nLCBDaGF0U2Vzc2lvbj47XG4gIGRlZmF1bHRNb2RlbDogc3RyaW5nO1xufVxuXG4vKipcbiAqIFNlc3Npb25TdG9yZSBcdTIwMTQgcGVyc2lzdHMgc2Vzc2lvbnMgdG8gT2JzaWRpYW4gcGx1Z2luIGRhdGEuXG4gKlxuICogU3Bpa2UgNTogc2Vzc2lvbnMgc3Vydml2ZSBPYnNpZGlhbiByZXN0YXJ0cy5cbiAqIFRoZSBzdG9yZSBpcyBhIHRoaW4gd3JhcHBlciBhcm91bmQgcGx1Z2luLmxvYWREYXRhIC8gcGx1Z2luLnNhdmVEYXRhLlxuICovXG5leHBvcnQgY2xhc3MgU2Vzc2lvblN0b3JlIHtcbiAgcHJpdmF0ZSBkYXRhOiBTdG9yZURhdGEgPSB7XG4gICAgY3VycmVudFNlc3Npb25JZDogbnVsbCxcbiAgICBzZXNzaW9uczoge30sXG4gICAgZGVmYXVsdE1vZGVsOiBERUZBVUxUX01PREVMLFxuICB9O1xuXG4gIC8qKiBDYWxsIG9uY2Ugb24gcGx1Z2luIGxvYWQuICovXG4gIGFzeW5jIGxvYWQocmF3RGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKHJhd0RhdGEgJiYgcmF3RGF0YVtTVE9SRV9LRVldKSB7XG4gICAgICB0aGlzLmRhdGEgPSByYXdEYXRhW1NUT1JFX0tFWV0gYXMgU3RvcmVEYXRhO1xuICAgIH1cbiAgfVxuXG4gIC8qKiBTZXJpYWxpemUgdG8gcGx1Z2luIGRhdGEgb2JqZWN0LiAqL1xuICBzZXJpYWxpemUoKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xuICAgIHJldHVybiB7IFtTVE9SRV9LRVldOiB0aGlzLmRhdGEgfTtcbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMCBTZXNzaW9uIENSVUQgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgY3JlYXRlU2Vzc2lvbihtb2RlbDogc3RyaW5nKTogQ2hhdFNlc3Npb24ge1xuICAgIGNvbnN0IHNlc3Npb246IENoYXRTZXNzaW9uID0ge1xuICAgICAgaWQ6IGNyeXB0by5yYW5kb21VVUlEKCksXG4gICAgICBtb2RlbCxcbiAgICAgIG1lc3NhZ2VzOiBbXSxcbiAgICAgIGNyZWF0ZWRBdDogRGF0ZS5ub3coKSxcbiAgICAgIHVwZGF0ZWRBdDogRGF0ZS5ub3coKSxcbiAgICB9O1xuICAgIHRoaXMuZGF0YS5zZXNzaW9uc1tzZXNzaW9uLmlkXSA9IHNlc3Npb247XG4gICAgdGhpcy5kYXRhLmN1cnJlbnRTZXNzaW9uSWQgPSBzZXNzaW9uLmlkO1xuICAgIHJldHVybiBzZXNzaW9uO1xuICB9XG5cbiAgZ2V0U2Vzc2lvbihpZDogc3RyaW5nKTogQ2hhdFNlc3Npb24gfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy5kYXRhLnNlc3Npb25zW2lkXSA/PyBudWxsO1xuICB9XG5cbiAgZ2V0Q3VycmVudFNlc3Npb24oKTogQ2hhdFNlc3Npb24gfCBudWxsIHtcbiAgICBpZiAoIXRoaXMuZGF0YS5jdXJyZW50U2Vzc2lvbklkKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gdGhpcy5nZXRTZXNzaW9uKHRoaXMuZGF0YS5jdXJyZW50U2Vzc2lvbklkKTtcbiAgfVxuXG4gIHVwZGF0ZVNlc3Npb24oc2Vzc2lvbjogQ2hhdFNlc3Npb24pOiB2b2lkIHtcbiAgICBzZXNzaW9uLnVwZGF0ZWRBdCA9IERhdGUubm93KCk7XG4gICAgdGhpcy5kYXRhLnNlc3Npb25zW3Nlc3Npb24uaWRdID0gc2Vzc2lvbjtcbiAgfVxuXG4gIHNldEN1cnJlbnRTZXNzaW9uKGlkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLmRhdGEuY3VycmVudFNlc3Npb25JZCA9IGlkO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIE1vZGVsIHByZWZlcmVuY2UgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgZ2V0RGVmYXVsdE1vZGVsKCk6IHN0cmluZyB7XG4gICAgcmV0dXJuIHRoaXMuZGF0YS5kZWZhdWx0TW9kZWwgPz8gREVGQVVMVF9NT0RFTDtcbiAgfVxuXG4gIHNldERlZmF1bHRNb2RlbChtb2RlbDogc3RyaW5nKTogdm9pZCB7XG4gICAgdGhpcy5kYXRhLmRlZmF1bHRNb2RlbCA9IG1vZGVsO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIFV0aWxpdHkgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgLyoqIEFsbCBzZXNzaW9ucywgbmV3ZXN0IGZpcnN0LiAqL1xuICBsaXN0U2Vzc2lvbnMoKTogQ2hhdFNlc3Npb25bXSB7XG4gICAgcmV0dXJuIE9iamVjdC52YWx1ZXModGhpcy5kYXRhLnNlc3Npb25zKS5zb3J0KFxuICAgICAgKGEsIGIpID0+IGIudXBkYXRlZEF0IC0gYS51cGRhdGVkQXRcbiAgICApO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgUGx1Z2luIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBBZ3lBZGFwdGVyIH0gZnJvbSBcIi4uL2FnZW50L0FneUFkYXB0ZXJcIjtcbmltcG9ydCB7IE9ic2lkaWFuQ29udGV4dCB9IGZyb20gXCIuLi9jb250ZXh0L09ic2lkaWFuQ29udGV4dFwiO1xuaW1wb3J0IHsgU2Vzc2lvblN0b3JlIH0gZnJvbSBcIi4vU2Vzc2lvblN0b3JlXCI7XG5pbXBvcnQgeyBDaGF0U2Vzc2lvbiwgQWd5TW9kZWwsIEFnZW50SW5wdXQsIEVkaXRQcm9wb3NhbCwgQXBwbHlSZXN1bHQgfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuLyoqXG4gKiBTZXNzaW9uQ29udHJvbGxlciBcdTIwMTQgb3ducyB0aGUgc2Vzc2lvbiBsaWZlY3ljbGUgZm9yIG9uZSBwbHVnaW4gaW5zdGFuY2UuXG4gKlxuICogUmVzcG9uc2liaWxpdGllcyAoU3Bpa2UgNSk6XG4gKiAgIC0gY3JlYXRlIC8gcmVzdW1lIC8gcmVzdG9yZSBzZXNzaW9uc1xuICogICAtIG1haW50YWluIGNvbnZlcnNhdGlvbiBJRCBhY3Jvc3MgdHVybnNcbiAqICAgLSBoYW5kbGUgbW9kZWwgc3dpdGNoaW5nIHdpdGhvdXQgYnJlYWtpbmcgZXhpc3Rpbmcgc2Vzc2lvbnNcbiAqICAgLSBwZXJzaXN0IGFmdGVyIGV2ZXJ5IHR1cm4gdmlhIHBsdWdpbi5zYXZlRGF0YVxuICovXG5leHBvcnQgY2xhc3MgU2Vzc2lvbkNvbnRyb2xsZXIge1xuICBwcml2YXRlIHN0b3JlOiBTZXNzaW9uU3RvcmU7XG4gIHByaXZhdGUgYWRhcHRlcjogQWd5QWRhcHRlcjtcbiAgcHJpdmF0ZSBjdHg6IE9ic2lkaWFuQ29udGV4dDtcbiAgcHJpdmF0ZSBwbHVnaW46IFBsdWdpbjtcblxuICBwcml2YXRlIGN1cnJlbnRTZXNzaW9uOiBDaGF0U2Vzc2lvbiB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIG1vZGVsczogQWd5TW9kZWxbXSA9IFtdO1xuXG4gIGNvbnN0cnVjdG9yKFxuICAgIHBsdWdpbjogUGx1Z2luLFxuICAgIHN0b3JlOiBTZXNzaW9uU3RvcmUsXG4gICAgYWRhcHRlcjogQWd5QWRhcHRlcixcbiAgICBjdHg6IE9ic2lkaWFuQ29udGV4dCxcbiAgKSB7XG4gICAgdGhpcy5wbHVnaW4gPSBwbHVnaW47XG4gICAgdGhpcy5zdG9yZSA9IHN0b3JlO1xuICAgIHRoaXMuYWRhcHRlciA9IGFkYXB0ZXI7XG4gICAgdGhpcy5jdHggPSBjdHg7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgSW5pdCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBhc3luYyBpbml0KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGRhdGEgPSBhd2FpdCB0aGlzLnBsdWdpbi5sb2FkRGF0YSgpO1xuICAgIGF3YWl0IHRoaXMuc3RvcmUubG9hZChkYXRhKTtcblxuICAgIC8vIFJlc3RvcmUgb3IgY3JlYXRlIHNlc3Npb25cbiAgICB0aGlzLmN1cnJlbnRTZXNzaW9uID0gdGhpcy5zdG9yZS5nZXRDdXJyZW50U2Vzc2lvbigpO1xuICAgIGlmICghdGhpcy5jdXJyZW50U2Vzc2lvbikge1xuICAgICAgdGhpcy5jdXJyZW50U2Vzc2lvbiA9IHRoaXMuc3RvcmUuY3JlYXRlU2Vzc2lvbih0aGlzLnN0b3JlLmdldERlZmF1bHRNb2RlbCgpKTtcbiAgICB9XG5cbiAgICAvLyBGZXRjaCBtb2RlbHMgaW4gYmFja2dyb3VuZCAobm9uLWJsb2NraW5nKVxuICAgIHRoaXMuYWRhcHRlci5saXN0TW9kZWxzKClcbiAgICAgIC50aGVuKChtKSA9PiB7IHRoaXMubW9kZWxzID0gbTsgfSlcbiAgICAgIC5jYXRjaCgoKSA9PiB7IC8qIG1vZGVscyBsaXN0IGlzIGJlc3QtZWZmb3J0ICovIH0pO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIFNlc3Npb24gb3BzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIGdldFNlc3Npb24oKTogQ2hhdFNlc3Npb24ge1xuICAgIGlmICghdGhpcy5jdXJyZW50U2Vzc2lvbikgdGhyb3cgbmV3IEVycm9yKFwiU2Vzc2lvbiBub3QgaW5pdGlhbGl6ZWRcIik7XG4gICAgcmV0dXJuIHRoaXMuY3VycmVudFNlc3Npb247XG4gIH1cblxuICBhc3luYyBuZXdTZXNzaW9uKCk6IFByb21pc2U8Q2hhdFNlc3Npb24+IHtcbiAgICBjb25zdCBtb2RlbCA9IHRoaXMuY3VycmVudFNlc3Npb24/Lm1vZGVsID8/IHRoaXMuc3RvcmUuZ2V0RGVmYXVsdE1vZGVsKCk7XG4gICAgdGhpcy5jdXJyZW50U2Vzc2lvbiA9IHRoaXMuc3RvcmUuY3JlYXRlU2Vzc2lvbihtb2RlbCk7XG4gICAgYXdhaXQgdGhpcy5zYXZlKCk7XG4gICAgcmV0dXJuIHRoaXMuY3VycmVudFNlc3Npb247XG4gIH1cblxuICBzZXRNb2RlbChtb2RlbElkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3JlLnNldERlZmF1bHRNb2RlbChtb2RlbElkKTtcbiAgICBpZiAodGhpcy5jdXJyZW50U2Vzc2lvbikge1xuICAgICAgdGhpcy5jdXJyZW50U2Vzc2lvbi5tb2RlbCA9IG1vZGVsSWQ7XG4gICAgfVxuICB9XG5cbiAgZ2V0TW9kZWxzKCk6IEFneU1vZGVsW10geyByZXR1cm4gdGhpcy5tb2RlbHM7IH1cblxuICAvLyBcdTI1MDBcdTI1MDAgU2VuZCBhIHR1cm4gXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgYXN5bmMgKnNlbmRUdXJuKFxuICAgIHByb21wdDogc3RyaW5nLFxuICAgIGV4dHJhQ29udGV4dDogaW1wb3J0KFwiLi4vdHlwZXNcIikuQWdlbnRDb250ZXh0W10gPSBbXSxcbiAgKTogQXN5bmNJdGVyYWJsZTxpbXBvcnQoXCIuLi90eXBlc1wiKS5BZ3lTdHJlYW1FdmVudD4ge1xuICAgIGNvbnN0IHNlc3Npb24gPSB0aGlzLmdldFNlc3Npb24oKTtcblxuICAgIC8vIEF1dG8tcmVzb2x2ZSBjb250ZXh0XG4gICAgY29uc3QgYXV0b0N0eCA9IGF3YWl0IHRoaXMuY3R4LnJlc29sdmVBdXRvKCk7XG4gICAgY29uc3QgY29udGV4dCA9IFsuLi5hdXRvQ3R4LCAuLi5leHRyYUNvbnRleHRdO1xuXG4gICAgY29uc3QgaW5wdXQ6IEFnZW50SW5wdXQgPSB7IHByb21wdCwgY29udGV4dCB9O1xuXG4gICAgLy8gUmVjb3JkIHVzZXIgbWVzc2FnZVxuICAgIHNlc3Npb24ubWVzc2FnZXMucHVzaCh7IHJvbGU6IFwidXNlclwiLCBjb250ZW50OiBwcm9tcHQgfSk7XG5cbiAgICAvLyBTdHJlYW0gZnJvbSBhZGFwdGVyXG4gICAgbGV0IGZ1bGxUZXh0ID0gXCJcIjtcbiAgICBmb3IgYXdhaXQgKGNvbnN0IGV2ZW50IG9mIHRoaXMuYWRhcHRlci5zZW5kKGlucHV0LCB7XG4gICAgICBtb2RlbDogc2Vzc2lvbi5tb2RlbCxcbiAgICAgIGNvbnZlcnNhdGlvbklkOiBzZXNzaW9uLmNvbnZlcnNhdGlvbklkLFxuICAgIH0pKSB7XG4gICAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJ0ZXh0XCIpIGZ1bGxUZXh0ICs9IGV2ZW50LmNvbnRlbnQ7XG4gICAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJkb25lXCIpIHtcbiAgICAgICAgLy8gQ2FwdHVyZSBjb252ZXJzYXRpb24gSUQgZm9yIGZ1dHVyZSB0dXJuc1xuICAgICAgICBjb25zdCBjb252SWQgPSB0aGlzLmFkYXB0ZXIuX2xhc3RDb252ZXJzYXRpb25JZDtcbiAgICAgICAgaWYgKGNvbnZJZCkgc2Vzc2lvbi5jb252ZXJzYXRpb25JZCA9IGNvbnZJZDtcbiAgICAgIH1cbiAgICAgIHlpZWxkIGV2ZW50O1xuICAgIH1cblxuICAgIC8vIFJlY29yZCBhc3Npc3RhbnQgbWVzc2FnZVxuICAgIGlmIChmdWxsVGV4dCkge1xuICAgICAgc2Vzc2lvbi5tZXNzYWdlcy5wdXNoKHsgcm9sZTogXCJhc3Npc3RhbnRcIiwgY29udGVudDogZnVsbFRleHQgfSk7XG4gICAgfVxuXG4gICAgdGhpcy5zdG9yZS51cGRhdGVTZXNzaW9uKHNlc3Npb24pO1xuICAgIGF3YWl0IHRoaXMuc2F2ZSgpO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIEFwcGx5IChTcGlrZSA0KSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBhc3luYyBhcHBseVByb3Bvc2FsKHByb3Bvc2FsOiBFZGl0UHJvcG9zYWwpOiBQcm9taXNlPEFwcGx5UmVzdWx0PiB7XG4gICAgLy8gMS4gU3RhbGUgY2hlY2sgXHUyMDE0IHZlcmlmeSBvcmlnaW5hbCBzdGlsbCBleGlzdHNcbiAgICBjb25zdCBpc1ZhbGlkID0gYXdhaXQgdGhpcy5jdHgudmVyaWZ5T3JpZ2luYWwocHJvcG9zYWwuZmlsZSwgcHJvcG9zYWwub3JpZ2luYWwpO1xuICAgIGlmICghaXNWYWxpZCkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgb2s6IGZhbHNlLFxuICAgICAgICByZWFzb246IFwic3RhbGVcIixcbiAgICAgICAgbWVzc2FnZTogXCJOb3RlIGNoYW5nZWQgc2luY2UgcHJvcG9zYWwgd2FzIG1hZGUuIFJlZ2VuZXJhdGUgdGhlIGVkaXQuXCIsXG4gICAgICB9O1xuICAgIH1cblxuICAgIC8vIDIuIEdldCBhY3RpdmUgZWRpdG9yXG4gICAgY29uc3QgbGVhZiA9ICh0aGlzLnBsdWdpbi5hcHAud29ya3NwYWNlIGFzIGFueSkuYWN0aXZlTGVhZjtcbiAgICBjb25zdCBlZGl0b3IgPSBsZWFmPy52aWV3Py5lZGl0b3I7XG4gICAgaWYgKCFlZGl0b3IpIHtcbiAgICAgIHJldHVybiB7IG9rOiBmYWxzZSwgcmVhc29uOiBcIm5vLWVkaXRvclwiLCBtZXNzYWdlOiBcIk5vIGFjdGl2ZSBlZGl0b3IuXCIgfTtcbiAgICB9XG5cbiAgICAvLyAzLiBGaW5kIHJhbmdlIGFuZCByZXBsYWNlIFx1MjAxNCBzaW5nbGUgZWRpdG9yIHRyYW5zYWN0aW9uIFx1MjE5MiBuYXRpdmUgQ3RybCtaXG4gICAgdHJ5IHtcbiAgICAgIGNvbnN0IGNvbnRlbnQ6IHN0cmluZyA9IGVkaXRvci5nZXRWYWx1ZSgpO1xuICAgICAgY29uc3QgaWR4OiBudW1iZXIgPSBjb250ZW50LmluZGV4T2YocHJvcG9zYWwub3JpZ2luYWwpO1xuICAgICAgaWYgKGlkeCA9PT0gLTEpIHtcbiAgICAgICAgcmV0dXJuIHtcbiAgICAgICAgICBvazogZmFsc2UsXG4gICAgICAgICAgcmVhc29uOiBcInN0YWxlXCIsXG4gICAgICAgICAgbWVzc2FnZTogXCJPcmlnaW5hbCB0ZXh0IG5vdCBmb3VuZCBpbiBlZGl0b3IuXCIsXG4gICAgICAgIH07XG4gICAgICB9XG4gICAgICBjb25zdCBmcm9tID0gZWRpdG9yLm9mZnNldFRvUG9zKGlkeCk7XG4gICAgICBjb25zdCB0byAgID0gZWRpdG9yLm9mZnNldFRvUG9zKGlkeCArIHByb3Bvc2FsLm9yaWdpbmFsLmxlbmd0aCk7XG4gICAgICBlZGl0b3IucmVwbGFjZVJhbmdlKHByb3Bvc2FsLnJlcGxhY2VtZW50LCBmcm9tLCB0byk7XG4gICAgICByZXR1cm4geyBvazogdHJ1ZSB9O1xuICAgIH0gY2F0Y2ggKGVycikge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgb2s6IGZhbHNlLFxuICAgICAgICByZWFzb246IFwiZXJyb3JcIixcbiAgICAgICAgbWVzc2FnZTogZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIubWVzc2FnZSA6IFN0cmluZyhlcnIpLFxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgUGVyc2lzdCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIGFzeW5jIHNhdmUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZURhdGEodGhpcy5zdG9yZS5zZXJpYWxpemUoKSk7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgQ2xlYW51cCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBkZXN0cm95KCk6IHZvaWQge1xuICAgIHRoaXMuYWRhcHRlci5hYm9ydCgpO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgSXRlbVZpZXcsIFdvcmtzcGFjZUxlYWYgfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB7IFNlc3Npb25Db250cm9sbGVyIH0gZnJvbSBcIi4uL3Nlc3Npb24vU2Vzc2lvbkNvbnRyb2xsZXJcIjtcbmltcG9ydCB7IE9ic2lkaWFuQ29udGV4dCB9IGZyb20gXCIuLi9jb250ZXh0L09ic2lkaWFuQ29udGV4dFwiO1xuaW1wb3J0IHsgRWRpdFByb3Bvc2FsLCBBZ3lNb2RlbCwgQWdlbnRDb250ZXh0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmV4cG9ydCBjb25zdCBBR1lfVklFV19UWVBFID0gXCJhZ3ktc2lkZWJhclwiO1xuXG4vLyBcdTI1MDBcdTI1MDBcdTI1MDAgU3RhdGUgbWFjaGluZSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcbi8vXG4vLyAgIEVNUFRZIFx1MjUwMFx1MjUwMHNlbmRcdTI1MDBcdTI1MDBcdTI1QkEgUlVOTklORyBcdTI1MDBcdTI1MDB0ZXh0XHUyNTAwXHUyNTAwXHUyNUJBIEFOU1dFUlxuLy8gICAgICAgICAgICAgICAgICAgICAgIFx1MjUwMiAgICAgICAgICAgICAgICBcdTI1MDJcbi8vICAgICAgICAgICAgICAgICAgcHJvcG9zYWwgICAgICAgICAgcHJvcG9zYWxcbi8vICAgICAgICAgICAgICAgICAgICAgICBcdTI1MTRcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MkNcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MThcbi8vICAgICAgICAgICAgICAgICAgICAgICAgICAgICAgXHUyNUJDXG4vLyAgICAgICAgICAgICAgICAgICAgICAgICBQUk9QT1NBTFxuLy8gICAgICAgICAgICAgICAgICAgICAgICAgIC8gICAgXFxcbi8vICAgICAgICAgICAgICAgICAgICAgIFJlamVjdCAgQXBwbHlcbi8vICAgICAgICAgICAgICAgICAgICAgICAgXHUyNUJDICAgICAgIFx1MjVCQ1xuLy8gICAgICAgICAgICAgICAgICAgICBBTlNXRVIgIEFQUExJRURcbi8vXG4vLyAgIEFueSBzdGF0ZSBcdTI1MDBcdTI1MDBhZ3ktbm90LWZvdW5kXHUyNTAwXHUyNTAwXHUyNUJBIEVSUk9SXG4vLyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxudHlwZSBVSVN0YXRlID0gXCJFTVBUWVwiIHwgXCJSVU5OSU5HXCIgfCBcIkFOU1dFUlwiIHwgXCJQUk9QT1NBTFwiIHwgXCJBUFBMSUVEXCIgfCBcIkVSUk9SXCI7XG5cbmV4cG9ydCBjbGFzcyBDaGF0VmlldyBleHRlbmRzIEl0ZW1WaWV3IHtcbiAgcHJpdmF0ZSBzYzogU2Vzc2lvbkNvbnRyb2xsZXI7XG4gIHByaXZhdGUgY3R4OiBPYnNpZGlhbkNvbnRleHQ7XG5cbiAgLy8gUm9vdCBzZWN0aW9uc1xuICBwcml2YXRlIHRocmVhZCE6IEhUTUxFbGVtZW50O1xuICBwcml2YXRlIGNvbXBvc2VyITogSFRNTEVsZW1lbnQ7XG4gIHByaXZhdGUgaGVhZGVyRWwhOiBIVE1MRWxlbWVudDtcblxuICAvLyBDb21wb3NlciByZWZzXG4gIHByaXZhdGUgaW5wdXQhOiBIVE1MVGV4dEFyZWFFbGVtZW50O1xuICBwcml2YXRlIHNlbmRCdG4hOiBIVE1MQnV0dG9uRWxlbWVudDtcbiAgcHJpdmF0ZSBzZWxlY3Rpb25DaGlwITogSFRNTEVsZW1lbnQ7XG4gIHByaXZhdGUgbm90ZUNoaXAhOiBIVE1MRWxlbWVudDtcbiAgcHJpdmF0ZSBjYW5jZWxCdG4hOiBIVE1MQnV0dG9uRWxlbWVudDtcbiAgcHJpdmF0ZSBtb2RlbFNlbGVjdCE6IEhUTUxTZWxlY3RFbGVtZW50O1xuXG4gIC8vIFRocmVhZCByZWZzIChyZXNldCBwZXIgdHVybilcbiAgcHJpdmF0ZSBhZ3lDdXJzb3JFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdGF0dXNFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcblxuICAvLyBTdGF0ZVxuICBwcml2YXRlIHVpU3RhdGU6IFVJU3RhdGUgPSBcIkVNUFRZXCI7XG5cbiAgLy8gRXh0cmEgY29udGV4dCBjaGlwcyBhZGRlZCBieSB1c2VyXG4gIHByaXZhdGUgZXh0cmFDdHg6IEFnZW50Q29udGV4dFtdID0gW107XG5cbiAgY29uc3RydWN0b3IoXG4gICAgbGVhZjogV29ya3NwYWNlTGVhZixcbiAgICBzYzogU2Vzc2lvbkNvbnRyb2xsZXIsXG4gICAgY3R4OiBPYnNpZGlhbkNvbnRleHQsXG4gICkge1xuICAgIHN1cGVyKGxlYWYpO1xuICAgIHRoaXMuc2MgPSBzYztcbiAgICB0aGlzLmN0eCA9IGN0eDtcbiAgfVxuXG4gIGdldFZpZXdUeXBlKCkgICAgeyByZXR1cm4gQUdZX1ZJRVdfVFlQRTsgfVxuICBnZXREaXNwbGF5VGV4dCgpIHsgcmV0dXJuIFwiQUdZXCI7IH1cbiAgZ2V0SWNvbigpICAgICAgICB7IHJldHVybiBcInNwYXJrbGVzXCI7IH1cblxuICAvLyBcdTI1MDBcdTI1MDBcdTI1MDAgTGlmZWN5Y2xlIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIGFzeW5jIG9uT3BlbigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCByb290ID0gdGhpcy5jb250ZW50RWw7XG4gICAgcm9vdC5lbXB0eSgpO1xuICAgIHJvb3QuYWRkQ2xhc3MoXCJhZ3ktcm9vdFwiKTtcblxuICAgIHRoaXMuYnVpbGRIZWFkZXIocm9vdCk7XG4gICAgdGhpcy50aHJlYWQgICA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcImFneS10aHJlYWRcIiB9KTtcbiAgICB0aGlzLmNvbXBvc2VyID0gcm9vdC5jcmVhdGVEaXYoeyBjbHM6IFwiYWd5LWNvbXBvc2VyXCIgfSk7XG4gICAgdGhpcy5idWlsZENvbXBvc2VyKHRoaXMuY29tcG9zZXIpO1xuXG4gICAgLy8gVmVyaWZ5IEFHWSBpcyBpbnN0YWxsZWQgYXQgb3BlbiB0aW1lXG4gICAgdHJ5IHtcbiAgICAgIGF3YWl0IHRoaXMuc2NbXCJhZGFwdGVyXCJdPy5waW5nPy4oKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIHRoaXMuc2hvd0Vycm9yKChlcnIgYXMgRXJyb3IpLm1lc3NhZ2UpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMuc2hvd0VtcHR5KCk7XG4gICAgdGhpcy5zeW5jQ2hpcHMoKTtcblxuICAgIC8vIFVwZGF0ZSBjaGlwcyB3aGVuZXZlciBzZWxlY3Rpb24gb3IgYWN0aXZlIGZpbGUgY2hhbmdlc1xuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCAoKSA9PiB0aGlzLnN5bmNDaGlwcygpKVxuICAgICk7XG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiZWRpdG9yLXNlbGVjdGlvbi1jaGFuZ2VcIiBhcyBhbnksICgpID0+IHRoaXMuc3luY0NoaXBzKCkpXG4gICAgKTtcblxuICAgIC8vIFBvcHVsYXRlIG1vZGVsIHNlbGVjdG9yXG4gICAgdGhpcy5yZWZyZXNoTW9kZWxMaXN0KCk7XG4gIH1cblxuICBhc3luYyBvbkNsb3NlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIHRoaXMuc2MuZGVzdHJveSgpO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwXHUyNTAwIEhlYWRlciBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIGJ1aWxkSGVhZGVyKHJvb3Q6IEhUTUxFbGVtZW50KTogdm9pZCB7XG4gICAgdGhpcy5oZWFkZXJFbCA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcImFneS1oZWFkZXJcIiB9KTtcbiAgICB0aGlzLmhlYWRlckVsLmNyZWF0ZVNwYW4oeyBjbHM6IFwiYWd5LWhlYWRlci10aXRsZVwiLCB0ZXh0OiBcIkFHWVwiIH0pO1xuXG4gICAgY29uc3QgcmlnaHQgPSB0aGlzLmhlYWRlckVsLmNyZWF0ZURpdih7IGNsczogXCJhZ3ktaGVhZGVyLXJpZ2h0XCIgfSk7XG5cbiAgICAvLyBNb2RlbCBzZWxlY3RvciAoU3Bpa2UgNSlcbiAgICB0aGlzLm1vZGVsU2VsZWN0ID0gcmlnaHQuY3JlYXRlRWwoXCJzZWxlY3RcIiwgeyBjbHM6IFwiYWd5LW1vZGVsLXNlbGVjdFwiIH0pO1xuICAgIHRoaXMubW9kZWxTZWxlY3QuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICB0aGlzLnNjLnNldE1vZGVsKHRoaXMubW9kZWxTZWxlY3QudmFsdWUpO1xuICAgIH0pO1xuICAgIC8vIEFkZCBwbGFjZWhvbGRlciBvcHRpb25cbiAgICBjb25zdCBwbGFjZWhvbGRlciA9IHRoaXMubW9kZWxTZWxlY3QuY3JlYXRlRWwoXCJvcHRpb25cIiwge1xuICAgICAgdGV4dDogXCJMb2FkaW5nIG1vZGVsc1x1MjAyNlwiLFxuICAgICAgYXR0cjogeyBkaXNhYmxlZDogXCJcIiwgc2VsZWN0ZWQ6IFwiXCIgfSxcbiAgICB9KTtcblxuICAgIC8vIE5ldyBjaGF0IGJ1dHRvblxuICAgIGNvbnN0IG5ld0J0biA9IHJpZ2h0LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHsgY2xzOiBcImFneS1uZXctYnRuXCIsIHRleHQ6IFwiK1wiIH0pO1xuICAgIG5ld0J0bi50aXRsZSA9IFwiTmV3IGNoYXRcIjtcbiAgICBuZXdCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMuc2MubmV3U2Vzc2lvbigpO1xuICAgICAgdGhpcy5leHRyYUN0eCA9IFtdO1xuICAgICAgdGhpcy5zaG93RW1wdHkoKTtcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXN5bmMgcmVmcmVzaE1vZGVsTGlzdCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtb2RlbHMgPSB0aGlzLnNjLmdldE1vZGVscygpO1xuICAgIGlmIChtb2RlbHMubGVuZ3RoID09PSAwKSB7XG4gICAgICAvLyBNb2RlbHMgbWF5IG5vdCBiZSBsb2FkZWQgeWV0IFx1MjAxNCB3YWl0IGEgdGljayBhbmQgdHJ5IG9uY2VcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlKChyKSA9PiBzZXRUaW1lb3V0KHIsIDEwMDApKTtcbiAgICB9XG4gICAgY29uc3QgZnJlc2ggPSB0aGlzLnNjLmdldE1vZGVscygpO1xuICAgIGlmIChmcmVzaC5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgIHRoaXMubW9kZWxTZWxlY3QuZW1wdHkoKTtcbiAgICBjb25zdCBjdXJyZW50TW9kZWwgPSB0aGlzLnNjLmdldFNlc3Npb24oKS5tb2RlbDtcbiAgICBmb3IgKGNvbnN0IG0gb2YgZnJlc2gpIHtcbiAgICAgIGNvbnN0IG9wdCA9IHRoaXMubW9kZWxTZWxlY3QuY3JlYXRlRWwoXCJvcHRpb25cIiwge1xuICAgICAgICB2YWx1ZTogbS5pZCxcbiAgICAgICAgdGV4dDogbS5uYW1lLFxuICAgICAgfSk7XG4gICAgICBpZiAobS5pZCA9PT0gY3VycmVudE1vZGVsKSBvcHQuc2VsZWN0ZWQgPSB0cnVlO1xuICAgIH1cbiAgfVxuXG4gIC8vIFx1MjUwMFx1MjUwMFx1MjUwMCBDb21wb3NlciBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIGJ1aWxkQ29tcG9zZXIocGFyZW50OiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnN0IGNoaXBzID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJhZ3ktY2hpcHNcIiB9KTtcblxuICAgIHRoaXMuc2VsZWN0aW9uQ2hpcCA9IGNoaXBzLmNyZWF0ZVNwYW4oeyBjbHM6IFwiYWd5LWNoaXAgYWd5LWNoaXAtLWhpZGRlblwiIH0pO1xuICAgIHRoaXMuc2VsZWN0aW9uQ2hpcC5jcmVhdGVTcGFuKHsgY2xzOiBcImFneS1jaGlwLWRvdFwiIH0pO1xuICAgIHRoaXMuc2VsZWN0aW9uQ2hpcC5jcmVhdGVTcGFuKHsgY2xzOiBcImFneS1jaGlwLWxhYmVsXCIsIHRleHQ6IFwiQHNlbGVjdGlvblwiIH0pO1xuXG4gICAgdGhpcy5ub3RlQ2hpcCA9IGNoaXBzLmNyZWF0ZVNwYW4oeyBjbHM6IFwiYWd5LWNoaXBcIiB9KTtcbiAgICB0aGlzLm5vdGVDaGlwLmNyZWF0ZVNwYW4oeyBjbHM6IFwiYWd5LWNoaXAtZG90XCIgfSk7XG4gICAgdGhpcy5ub3RlQ2hpcC5jcmVhdGVTcGFuKHsgY2xzOiBcImFneS1jaGlwLWxhYmVsXCIsIHRleHQ6IFwiQG5vdGVcIiB9KTtcblxuICAgIGNvbnN0IHJvdyA9IHBhcmVudC5jcmVhdGVEaXYoeyBjbHM6IFwiYWd5LWNvbXBvc2VyLXJvd1wiIH0pO1xuXG4gICAgdGhpcy5pbnB1dCA9IHJvdy5jcmVhdGVFbChcInRleHRhcmVhXCIsIHtcbiAgICAgIGNsczogXCJhZ3ktaW5wdXRcIixcbiAgICAgIGF0dHI6IHsgcGxhY2Vob2xkZXI6IFwiQXNrIEFHWVx1MjAyNlwiLCByb3dzOiBcIjFcIiB9LFxuICAgIH0pO1xuICAgIHRoaXMuaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImlucHV0XCIsICAgKCkgPT4gdGhpcy5vbklucHV0KCkpO1xuICAgIHRoaXMuaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGUpID0+IHRoaXMub25LZXkoZSkpO1xuXG4gICAgY29uc3QgYnRuR3JvdXAgPSByb3cuY3JlYXRlRGl2KHsgY2xzOiBcImFneS1idG4tZ3JvdXBcIiB9KTtcblxuICAgIHRoaXMuY2FuY2VsQnRuID0gYnRuR3JvdXAuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgY2xzOiBcImFneS1jYW5jZWwtYnRuIGFneS1oaWRkZW5cIixcbiAgICAgIHRleHQ6IFwiXHUyNzE1XCIsXG4gICAgfSk7XG4gICAgdGhpcy5jYW5jZWxCdG4udGl0bGUgPSBcIlN0b3BcIjtcbiAgICB0aGlzLmNhbmNlbEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5zYy5kZXN0cm95KCk7XG4gICAgICB0aGlzLnNldFVJU3RhdGUoXCJBTlNXRVJcIik7XG4gICAgICB0aGlzLmFwcGVuZElubGluZUVycm9yKHRoaXMudGhyZWFkLCBcIlN0b3BwZWQuXCIpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5zZW5kQnRuID0gYnRuR3JvdXAuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgY2xzOiBcImFneS1zZW5kLWJ0blwiLFxuICAgICAgdGV4dDogXCJcdTIxOTFcIixcbiAgICB9KTtcbiAgICB0aGlzLnNlbmRCdG4uZGlzYWJsZWQgPSB0cnVlO1xuICAgIHRoaXMuc2VuZEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5kb1NlbmQoKSk7XG4gIH1cblxuICBwcml2YXRlIHN5bmNDaGlwcygpOiB2b2lkIHtcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICBjb25zdCBuYW1lID0gZmlsZT8uYmFzZW5hbWUgPz8gXCJub3RlXCI7XG4gICAgdGhpcy5ub3RlQ2hpcC5xdWVyeVNlbGVjdG9yPEhUTUxFbGVtZW50PihcIi5hZ3ktY2hpcC1sYWJlbFwiKSEudGV4dENvbnRlbnQgPSBgQCR7bmFtZX1gO1xuXG4gICAgY29uc3QgaGFzU2VsID0gISF0aGlzLmN0eC5nZXRTZWxlY3Rpb24oKTtcbiAgICB0aGlzLnNlbGVjdGlvbkNoaXAudG9nZ2xlQ2xhc3MoXCJhZ3ktY2hpcC0taGlkZGVuXCIsICFoYXNTZWwpO1xuICB9XG5cbiAgcHJpdmF0ZSBvbklucHV0KCk6IHZvaWQge1xuICAgIHRoaXMuc2VuZEJ0bi5kaXNhYmxlZCA9IHRoaXMuaW5wdXQudmFsdWUudHJpbSgpID09PSBcIlwiIHx8ICh0aGlzLnVpU3RhdGUgYXMgVUlTdGF0ZSkgPT09IFwiUlVOTklOR1wiO1xuICAgIHRoaXMuaW5wdXQuc3R5bGUuaGVpZ2h0ID0gXCJhdXRvXCI7XG4gICAgdGhpcy5pbnB1dC5zdHlsZS5oZWlnaHQgPSBNYXRoLm1pbih0aGlzLmlucHV0LnNjcm9sbEhlaWdodCwgODApICsgXCJweFwiO1xuICB9XG5cbiAgcHJpdmF0ZSBvbktleShlOiBLZXlib2FyZEV2ZW50KTogdm9pZCB7XG4gICAgaWYgKGUua2V5ID09PSBcIkVudGVyXCIgJiYgIWUuc2hpZnRLZXkpIHtcbiAgICAgIGUucHJldmVudERlZmF1bHQoKTtcbiAgICAgIGlmICghdGhpcy5zZW5kQnRuLmRpc2FibGVkKSB0aGlzLmRvU2VuZCgpO1xuICAgIH1cbiAgICBpZiAoZS5rZXkgPT09IFwiRXNjYXBlXCIgJiYgKHRoaXMudWlTdGF0ZSBhcyBVSVN0YXRlKSA9PT0gXCJSVU5OSU5HXCIpIHtcbiAgICAgIHRoaXMuY2FuY2VsQnRuLmNsaWNrKCk7XG4gICAgfVxuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwXHUyNTAwIFNlbmQgdHVybiBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIGFzeW5jIGRvU2VuZCgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBwcm9tcHQgPSB0aGlzLmlucHV0LnZhbHVlLnRyaW0oKTtcbiAgICBpZiAoIXByb21wdCB8fCAodGhpcy51aVN0YXRlIGFzIFVJU3RhdGUpID09PSBcIlJVTk5JTkdcIikgcmV0dXJuO1xuXG4gICAgdGhpcy5pbnB1dC52YWx1ZSA9IFwiXCI7XG4gICAgdGhpcy5pbnB1dC5zdHlsZS5oZWlnaHQgPSBcIlwiO1xuICAgIHRoaXMuc2VuZEJ0bi5kaXNhYmxlZCA9IHRydWU7XG5cbiAgICB0aGlzLmFwcGVuZFVzZXJCdWJibGUocHJvbXB0KTtcbiAgICB0aGlzLnNldFVJU3RhdGUoXCJSVU5OSU5HXCIpO1xuICAgIHRoaXMuZW5zdXJlQWd5QnViYmxlKCk7XG5cbiAgICBjb25zdCBUSU1FT1VUX01TID0gMzBfMDAwO1xuICAgIGNvbnN0IHRpbWVvdXQgPSB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLnNjLmRlc3Ryb3koKTtcbiAgICAgIHRoaXMuc2V0VUlTdGF0ZShcIkFOU1dFUlwiKTtcbiAgICAgIHRoaXMuYXBwZW5kSW5saW5lRXJyb3IodGhpcy50aHJlYWQsIFwiTm8gcmVzcG9uc2UgYWZ0ZXIgMzAgcy4gQUdZIG1heSBiZSBidXN5LlwiKTtcbiAgICB9LCBUSU1FT1VUX01TKTtcblxuICAgIHRyeSB7XG4gICAgICBsZXQgcHJvcG9zYWxUZXh0ID0gXCJcIjtcbiAgICAgIGxldCBpblByb3Bvc2FsQmxvY2sgPSBmYWxzZTtcbiAgICAgIGxldCBmdWxsVGV4dCA9IFwiXCI7XG5cbiAgICAgIGZvciBhd2FpdCAoY29uc3QgZXZlbnQgb2YgdGhpcy5zYy5zZW5kVHVybihwcm9tcHQsIHRoaXMuZXh0cmFDdHgpKSB7XG4gICAgICAgIGlmIChldmVudC50eXBlID09PSBcInRleHRcIikge1xuICAgICAgICAgIGZ1bGxUZXh0ICs9IGV2ZW50LmNvbnRlbnQ7XG5cbiAgICAgICAgICAvLyBcdTI1MDBcdTI1MDAgRGV0ZWN0IHN0cnVjdHVyZWQgZWRpdCBwcm9wb3NhbCAoU3Bpa2UgMykgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG4gICAgICAgICAgLy8gQUdZIGlzIHByb21wdGVkICh2aWEgc3lzdGVtIGluc3RydWN0aW9ucykgdG8gZW1pdCBwcm9wb3NhbHMgYXNcbiAgICAgICAgICAvLyBhIGZlbmNlZCBKU09OIGJsb2NrOiBgYGBlZGl0LXByb3Bvc2FsXFxuey4uLn1cXG5gYGBcbiAgICAgICAgICAvLyBXZSBidWZmZXIgYW5kIGRldGVjdCB0aGF0IGJsb2NrIHdpdGhvdXQgc2hvd2luZyBpdCByYXcuXG4gICAgICAgICAgY29uc3QgbWVyZ2VkID0gZnVsbFRleHQ7XG4gICAgICAgICAgY29uc3Qgc3RhcnRUYWcgPSBcImBgYGVkaXQtcHJvcG9zYWxcIjtcbiAgICAgICAgICBjb25zdCBlbmRUYWcgICA9IFwiYGBgXCI7XG5cbiAgICAgICAgICBpZiAoIWluUHJvcG9zYWxCbG9jayAmJiBtZXJnZWQuaW5jbHVkZXMoc3RhcnRUYWcpKSB7XG4gICAgICAgICAgICBpblByb3Bvc2FsQmxvY2sgPSB0cnVlO1xuICAgICAgICAgICAgLy8gUmVuZGVyIHRleHQgYmVmb3JlIHRoZSBibG9ja1xuICAgICAgICAgICAgY29uc3QgYmVmb3JlID0gbWVyZ2VkLnNsaWNlKDAsIG1lcmdlZC5pbmRleE9mKHN0YXJ0VGFnKSk7XG4gICAgICAgICAgICB0aGlzLmFwcGVuZFRvQWd5QnViYmxlKGJlZm9yZS5yZXBsYWNlKGZ1bGxUZXh0LnNsaWNlKDAsIGZ1bGxUZXh0LmluZGV4T2Yoc3RhcnRUYWcpKSwgXCJcIikpO1xuICAgICAgICAgIH0gZWxzZSBpZiAoaW5Qcm9wb3NhbEJsb2NrKSB7XG4gICAgICAgICAgICBwcm9wb3NhbFRleHQgPSBtZXJnZWQuc2xpY2UobWVyZ2VkLmluZGV4T2Yoc3RhcnRUYWcpICsgc3RhcnRUYWcubGVuZ3RoKTtcbiAgICAgICAgICAgIGNvbnN0IGNsb3NlSWR4ID0gcHJvcG9zYWxUZXh0LmluZGV4T2YoXCJcXG5cIiArIGVuZFRhZyk7XG4gICAgICAgICAgICBpZiAoY2xvc2VJZHggIT09IC0xKSB7XG4gICAgICAgICAgICAgIC8vIFByb3Bvc2FsIGNvbXBsZXRlIFx1MjAxNCBwYXJzZSBhbmQgc2hvdyBwcm9wb3NhbCBidWJibGVcbiAgICAgICAgICAgICAgY29uc3QganNvbiA9IHByb3Bvc2FsVGV4dC5zbGljZSgwLCBjbG9zZUlkeCkudHJpbSgpO1xuICAgICAgICAgICAgICBpblByb3Bvc2FsQmxvY2sgPSBmYWxzZTtcbiAgICAgICAgICAgICAgdHJ5IHtcbiAgICAgICAgICAgICAgICBjb25zdCBwcm9wb3NhbCA9IEpTT04ucGFyc2UoanNvbikgYXMgRWRpdFByb3Bvc2FsO1xuICAgICAgICAgICAgICAgIHdpbmRvdy5jbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICAgICAgICAgICAgdGhpcy5zZXRVSVN0YXRlKFwiUFJPUE9TQUxcIik7XG4gICAgICAgICAgICAgICAgdGhpcy5hcHBlbmRQcm9wb3NhbEJ1YmJsZShwcm9wb3NhbCk7XG4gICAgICAgICAgICAgIH0gY2F0Y2gge1xuICAgICAgICAgICAgICAgIHRoaXMuYXBwZW5kSW5saW5lRXJyb3IodGhpcy50aHJlYWQsIFwiQ291bGQgbm90IHBhcnNlIGVkaXQgcHJvcG9zYWwuXCIpO1xuICAgICAgICAgICAgICAgIHRoaXMuc2V0VUlTdGF0ZShcIkFOU1dFUlwiKTtcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAvLyBOb3JtYWwgc3RyZWFtaW5nIHRleHRcbiAgICAgICAgICAgIHRoaXMuYXBwZW5kVG9BZ3lCdWJibGUoZXZlbnQuY29udGVudCk7XG4gICAgICAgICAgICB0aGlzLnNjcm9sbFRocmVhZCgpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChldmVudC50eXBlID09PSBcImRvbmVcIikge1xuICAgICAgICAgIHdpbmRvdy5jbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICAgICAgaWYgKCh0aGlzLnVpU3RhdGUgYXMgVUlTdGF0ZSkgPT09IFwiUlVOTklOR1wiKSB0aGlzLnNldFVJU3RhdGUoXCJBTlNXRVJcIik7XG4gICAgICAgICAgdGhpcy5hZ3lDdXJzb3JFbD8ucmVtb3ZlQ2xhc3MoXCJhZ3ktYnViYmxlLS1zdHJlYW1pbmdcIik7XG4gICAgICAgICAgdGhpcy5zdGF0dXNFbD8uYWRkQ2xhc3MoXCJhZ3ktaGlkZGVuXCIpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGV2ZW50LnR5cGUgPT09IFwiZXJyb3JcIikge1xuICAgICAgICAgIHdpbmRvdy5jbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICAgICAgdGhpcy5hZ3lDdXJzb3JFbD8ucmVtb3ZlQ2xhc3MoXCJhZ3ktYnViYmxlLS1zdHJlYW1pbmdcIik7XG4gICAgICAgICAgdGhpcy5zdGF0dXNFbD8uYWRkQ2xhc3MoXCJhZ3ktaGlkZGVuXCIpO1xuICAgICAgICAgIHRoaXMuYXBwZW5kSW5saW5lRXJyb3IodGhpcy50aHJlYWQsIGV2ZW50LmVycm9yKTtcbiAgICAgICAgICB0aGlzLnNldFVJU3RhdGUoXCJBTlNXRVJcIik7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIHdpbmRvdy5jbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICBjb25zdCBtc2cgPSBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogU3RyaW5nKGVycik7XG4gICAgICBpZiAobXNnLmluY2x1ZGVzKFwibm90IGZvdW5kXCIpIHx8IG1zZy5pbmNsdWRlcyhcIkVOT0VOVFwiKSkge1xuICAgICAgICB0aGlzLnNob3dFcnJvcihcIkFHWSBDTEkgbm90IGZvdW5kLiBNYWtlIHN1cmUgJ2FneScgaXMgaW4gUEFUSC5cIik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICB0aGlzLmFwcGVuZElubGluZUVycm9yKHRoaXMudGhyZWFkLCBtc2cpO1xuICAgICAgICB0aGlzLnNldFVJU3RhdGUoXCJBTlNXRVJcIik7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwXHUyNTAwIFN0YXRlIG1hbmFnZW1lbnQgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgcHJpdmF0ZSBzZXRVSVN0YXRlKHM6IFVJU3RhdGUpOiB2b2lkIHtcbiAgICB0aGlzLnVpU3RhdGUgPSBzO1xuICAgIGNvbnN0IGJ1c3kgPSBzID09PSBcIlJVTk5JTkdcIjtcbiAgICB0aGlzLmlucHV0LmRpc2FibGVkID0gYnVzeSB8fCBzID09PSBcIkVSUk9SXCI7XG4gICAgdGhpcy5zZW5kQnRuLmRpc2FibGVkID0gYnVzeSB8fCBzID09PSBcIkVSUk9SXCIgfHwgdGhpcy5pbnB1dC52YWx1ZS50cmltKCkgPT09IFwiXCI7XG4gICAgdGhpcy5jYW5jZWxCdG4udG9nZ2xlQ2xhc3MoXCJhZ3ktaGlkZGVuXCIsICFidXN5KTtcbiAgICB0aGlzLnN0YXR1c0VsPy50b2dnbGVDbGFzcyhcImFneS1oaWRkZW5cIiwgIWJ1c3kpO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwXHUyNTAwIEVtcHR5IC8gRXJyb3Igc2xhdGVzIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIHByaXZhdGUgc2hvd0VtcHR5KCk6IHZvaWQge1xuICAgIHRoaXMudGhyZWFkLmVtcHR5KCk7XG4gICAgdGhpcy5hZ3lDdXJzb3JFbCA9IG51bGw7XG4gICAgdGhpcy5zdGF0dXNFbCA9IG51bGw7XG4gICAgY29uc3Qgc2xhdGUgPSB0aGlzLnRocmVhZC5jcmVhdGVEaXYoeyBjbHM6IFwiYWd5LWVtcHR5LXNsYXRlXCIgfSk7XG4gICAgc2xhdGUuY3JlYXRlRGl2KHsgY2xzOiBcImFneS1lbXB0eS1pY29uXCIsIHRleHQ6IFwiXHUyNzI2XCIgfSk7XG4gICAgc2xhdGUuY3JlYXRlRGl2KHsgY2xzOiBcImFneS1lbXB0eS1sYWJlbFwiLCB0ZXh0OiBcIkFzayBBR1kgYWJvdXQgdGhpcyBub3RlXCIgfSk7XG4gICAgdGhpcy5zZXRVSVN0YXRlKFwiRU1QVFlcIik7XG4gICAgdGhpcy5zeW5jQ2hpcHMoKTtcbiAgfVxuXG4gIHByaXZhdGUgc2hvd0Vycm9yKG1zZzogc3RyaW5nKTogdm9pZCB7XG4gICAgdGhpcy50aHJlYWQuZW1wdHkoKTtcbiAgICB0aGlzLmFneUN1cnNvckVsID0gbnVsbDtcbiAgICB0aGlzLnN0YXR1c0VsID0gbnVsbDtcbiAgICBjb25zdCBzbGF0ZSA9IHRoaXMudGhyZWFkLmNyZWF0ZURpdih7IGNsczogXCJhZ3ktZXJyb3Itc2xhdGVcIiB9KTtcbiAgICBzbGF0ZS5jcmVhdGVEaXYoeyBjbHM6IFwiYWd5LWVycm9yLWljb25cIiwgdGV4dDogXCJcdTI2QTBcIiB9KTtcbiAgICBzbGF0ZS5jcmVhdGVEaXYoeyBjbHM6IFwiYWd5LWVycm9yLXRpdGxlXCIsIHRleHQ6IFwiQUdZIHVuYXZhaWxhYmxlXCIgfSk7XG4gICAgc2xhdGUuY3JlYXRlRGl2KHsgY2xzOiBcImFneS1lcnJvci1ib2R5XCIsIHRleHQ6IG1zZyB9KTtcbiAgICBjb25zdCBidG4gPSBzbGF0ZS5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICBjbHM6IFwiYWd5LWNvbmZpZ3VyZS1idG5cIixcbiAgICAgIHRleHQ6IFwiQ29uZmlndXJlIEFHWSBcdTIxOTJcIixcbiAgICB9KTtcbiAgICBidG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgICh0aGlzLmFwcCBhcyBhbnkpLnNldHRpbmc/Lm9wZW4/LigpO1xuICAgIH0pO1xuICAgIHRoaXMuc2V0VUlTdGF0ZShcIkVSUk9SXCIpO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwXHUyNTAwIEJ1YmJsZSBidWlsZGVycyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBwcml2YXRlIGFwcGVuZFVzZXJCdWJibGUodGV4dDogc3RyaW5nKTogdm9pZCB7XG4gICAgLy8gUmVtb3ZlIGVtcHR5IHNsYXRlIGlmIGZpcnN0IG1lc3NhZ2VcbiAgICB0aGlzLnRocmVhZC5xdWVyeVNlbGVjdG9yKFwiLmFneS1lbXB0eS1zbGF0ZVwiKT8ucmVtb3ZlKCk7XG4gICAgY29uc3QgYiA9IHRoaXMudGhyZWFkLmNyZWF0ZURpdih7IGNsczogXCJhZ3ktYnViYmxlIGFneS1idWJibGUtLXVzZXJcIiB9KTtcbiAgICBiLnNldFRleHQodGV4dCk7XG4gIH1cblxuICBwcml2YXRlIGVuc3VyZUFneUJ1YmJsZSgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5hZ3lDdXJzb3JFbCkgcmV0dXJuO1xuXG4gICAgLy8gU3RhdHVzIGxpbmVcbiAgICB0aGlzLnN0YXR1c0VsID0gdGhpcy50aHJlYWQuY3JlYXRlRGl2KHsgY2xzOiBcImFneS1zdGF0dXMtbGluZVwiIH0pO1xuICAgIHRoaXMuc3RhdHVzRWwuY3JlYXRlRGl2KHsgY2xzOiBcImFneS1zcGlubmVyXCIgfSk7XG4gICAgY29uc3QgbGFiZWwgPSB0aGlzLnN0YXR1c0VsLmNyZWF0ZVNwYW4oKTtcbiAgICBjb25zdCBzZWwgPSB0aGlzLmN0eC5nZXRTZWxlY3Rpb24oKTtcbiAgICBsYWJlbC50ZXh0Q29udGVudCA9IHNlbCA/IFwiUmVhZGluZyBzZWxlY3Rpb25cdTIwMjZcIiA6IFwiUmVhZGluZyBub3RlXHUyMDI2XCI7XG5cbiAgICAvLyBSZXNwb25zZSBidWJibGVcbiAgICB0aGlzLmFneUN1cnNvckVsID0gdGhpcy50aHJlYWQuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJhZ3ktYnViYmxlIGFneS1idWJibGUtLWFneSBhZ3ktYnViYmxlLS1zdHJlYW1pbmdcIixcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYXBwZW5kVG9BZ3lCdWJibGUodGV4dDogc3RyaW5nKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmFneUN1cnNvckVsKSByZXR1cm47XG4gICAgdGhpcy5hZ3lDdXJzb3JFbC5hcHBlbmRUZXh0KHRleHQpO1xuICB9XG5cbiAgcHJpdmF0ZSBhcHBlbmRQcm9wb3NhbEJ1YmJsZShwcm9wb3NhbDogRWRpdFByb3Bvc2FsKTogdm9pZCB7XG4gICAgY29uc3Qgd3JhcCA9IHRoaXMudGhyZWFkLmNyZWF0ZURpdih7IGNsczogXCJhZ3ktcHJvcG9zYWxcIiB9KTtcblxuICAgIC8vIEZpbGUgYmFkZ2VcbiAgICB3cmFwLmNyZWF0ZURpdih7IGNsczogXCJhZ3ktcHJvcG9zYWwtYmFkZ2VcIiwgdGV4dDogXCJcdUQ4M0RcdURDQzQgXCIgKyBwcm9wb3NhbC5maWxlIH0pO1xuXG4gICAgLy8gRGlmZlxuICAgIGlmIChwcm9wb3NhbC5yZWFzb24pIHtcbiAgICAgIHdyYXAuY3JlYXRlRGl2KHsgY2xzOiBcImFneS1wcm9wb3NhbC1yZWFzb25cIiwgdGV4dDogcHJvcG9zYWwucmVhc29uIH0pO1xuICAgIH1cbiAgICBjb25zdCBkaWZmID0gd3JhcC5jcmVhdGVEaXYoeyBjbHM6IFwiYWd5LXByb3Bvc2FsLWRpZmZcIiB9KTtcbiAgICBwcm9wb3NhbC5vcmlnaW5hbC5zcGxpdChcIlxcblwiKS5mb3JFYWNoKChsaW5lKSA9PlxuICAgICAgZGlmZi5jcmVhdGVEaXYoeyBjbHM6IFwiYWd5LWRpZmYtcmVtb3ZlZFwiLCB0ZXh0OiBcIi0gXCIgKyBsaW5lIH0pXG4gICAgKTtcbiAgICBwcm9wb3NhbC5yZXBsYWNlbWVudC5zcGxpdChcIlxcblwiKS5mb3JFYWNoKChsaW5lKSA9PlxuICAgICAgZGlmZi5jcmVhdGVEaXYoeyBjbHM6IFwiYWd5LWRpZmYtYWRkZWRcIiwgICB0ZXh0OiBcIisgXCIgKyBsaW5lIH0pXG4gICAgKTtcblxuICAgIC8vIEFjdGlvbnMgKFNwaWtlIDQpXG4gICAgY29uc3QgYWN0aW9ucyA9IHdyYXAuY3JlYXRlRGl2KHsgY2xzOiBcImFneS1wcm9wb3NhbC1hY3Rpb25zXCIgfSk7XG5cbiAgICBjb25zdCByZWplY3RCdG4gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcbiAgICAgIGNsczogXCJhZ3ktYnRuLXJlamVjdFwiLFxuICAgICAgdGV4dDogXCJSZWplY3RcIixcbiAgICB9KTtcbiAgICBjb25zdCBhcHBseUJ0biA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgY2xzOiBcImFneS1idG4tYXBwbHlcIixcbiAgICAgIHRleHQ6IFwiQXBwbHkgXHUyNzEzXCIsXG4gICAgfSk7XG5cbiAgICByZWplY3RCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIGFjdGlvbnMucmVtb3ZlKCk7XG4gICAgICB3cmFwLmNyZWF0ZURpdih7XG4gICAgICAgIGNsczogXCJhZ3ktcmVzdWx0LWJhZGdlIGFneS1iYWRnZS0tcmVqZWN0ZWRcIixcbiAgICAgICAgdGV4dDogXCJcdTI3MTUgUmVqZWN0ZWRcIixcbiAgICAgIH0pO1xuICAgICAgdGhpcy5zZXRVSVN0YXRlKFwiQU5TV0VSXCIpO1xuICAgIH0pO1xuXG4gICAgYXBwbHlCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGFwcGx5QnRuLmRpc2FibGVkID0gdHJ1ZTtcbiAgICAgIGFwcGx5QnRuLnRleHRDb250ZW50ID0gXCJBcHBseWluZ1x1MjAyNlwiO1xuXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLnNjLmFwcGx5UHJvcG9zYWwocHJvcG9zYWwpO1xuICAgICAgYWN0aW9ucy5yZW1vdmUoKTtcblxuICAgICAgaWYgKHJlc3VsdC5vaykge1xuICAgICAgICB3cmFwLmNyZWF0ZURpdih7XG4gICAgICAgICAgY2xzOiBcImFneS1yZXN1bHQtYmFkZ2UgYWd5LWJhZGdlLS1hcHBsaWVkXCIsXG4gICAgICAgICAgdGV4dDogXCJcdTI3MTMgQXBwbGllZCB0byBcIiArIHByb3Bvc2FsLmZpbGUsXG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLnNldFVJU3RhdGUoXCJBUFBMSUVEXCIpO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgd3JhcC5jcmVhdGVEaXYoe1xuICAgICAgICAgIGNsczogXCJhZ3ktcmVzdWx0LWJhZGdlIGFneS1iYWRnZS0tc3RhbGVcIixcbiAgICAgICAgICB0ZXh0OiBcIlx1MjZBMCBcIiArIHJlc3VsdC5tZXNzYWdlLFxuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5zZXRVSVN0YXRlKFwiQU5TV0VSXCIpO1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgdGhpcy5zY3JvbGxUaHJlYWQoKTtcbiAgfVxuXG4gIHByaXZhdGUgYXBwZW5kSW5saW5lRXJyb3IocGFyZW50OiBIVE1MRWxlbWVudCwgbXNnOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBwYXJlbnQuY3JlYXRlRGl2KHsgY2xzOiBcImFneS1pbmxpbmUtZXJyb3JcIiwgdGV4dDogXCJcdTI2QTAgXCIgKyBtc2cgfSk7XG4gICAgdGhpcy5zY3JvbGxUaHJlYWQoKTtcbiAgfVxuXG4gIHByaXZhdGUgc2Nyb2xsVGhyZWFkKCk6IHZvaWQge1xuICAgIHRoaXMudGhyZWFkLnNjcm9sbFRvKHsgdG9wOiB0aGlzLnRocmVhZC5zY3JvbGxIZWlnaHQsIGJlaGF2aW9yOiBcInNtb290aFwiIH0pO1xuICB9XG59XG4iXSwKICAibWFwcGluZ3MiOiAiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBLElBQUFBLG1CQUF1Qjs7O0FDQXZCLDJCQUFvQztBQTRCN0IsSUFBTSxhQUFOLE1BQXlDO0FBQUEsRUFBekM7QUFDTCxTQUFRLE9BQTRCO0FBQUE7QUFBQTtBQUFBLEVBSXBDLE1BQU0sT0FBd0I7QUFDNUIsV0FBTyxJQUFJLFFBQVEsQ0FBQyxTQUFTLFdBQVc7QUFsQzVDO0FBbUNNLFlBQU0sUUFBUSxRQUFRLGFBQWEsVUFBVSxVQUFVO0FBQ3ZELFlBQU0sUUFBSSw0QkFBTSxPQUFPLENBQUMsS0FBSyxDQUFDO0FBQzlCLFVBQUksTUFBTTtBQUNWLGNBQUUsV0FBRixtQkFBVSxHQUFHLFFBQVEsQ0FBQyxNQUFlLE9BQU8sRUFBRSxTQUFTO0FBQ3ZELFFBQUUsR0FBRyxTQUFTLENBQUMsU0FBUztBQUN0QixZQUFJLFNBQVMsS0FBSyxJQUFJLEtB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
