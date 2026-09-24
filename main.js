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
  default: () => ForgePlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian6 = require("obsidian");

// src/agent/AgyAdapter.ts
var import_child_process = require("child_process");
var import_fs = require("fs");
var import_os = require("os");
var import_path = require("path");
function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
var AgyAdapter = class {
  constructor(cwd) {
    this.cwd = cwd;
    this.proc = null;
  }
  // ── binary resolution ─────────────────────────────────────────────────────
  async ping() {
    var _a;
    const configured = (_a = process.env.AGY_PATH) == null ? void 0 : _a.trim();
    const candidates = [
      configured,
      ...process.platform === "win32" ? [
        process.env.LOCALAPPDATA ? (0, import_path.join)(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe") : void 0,
        process.env.ProgramFiles ? (0, import_path.join)(process.env.ProgramFiles, "Google", "antigravity-cli", "agy.exe") : void 0
      ] : [(0, import_path.join)((0, import_os.homedir)(), ".local", "bin", "agy")]
    ].filter((value) => Boolean(value));
    for (const candidate of candidates) {
      if ((0, import_fs.existsSync)(candidate)) return candidate;
    }
    return new Promise((resolve, reject) => {
      var _a2;
      const locator = process.platform === "win32" ? "where" : "which";
      const p = (0, import_child_process.spawn)(locator, ["agy"]);
      let out = "";
      let settled = false;
      const fail = () => {
        if (settled) return;
        settled = true;
        reject(
          new Error(
            "AGY CLI not found. Install it, restart Obsidian after changing PATH, or set AGY_PATH to the AGY executable."
          )
        );
      };
      (_a2 = p.stdout) == null ? void 0 : _a2.on("data", (d) => out += d.toString());
      p.on("error", fail);
      p.on("close", (code) => {
        if (settled) return;
        if (code === 0 && out.trim()) {
          settled = true;
          resolve(out.trim().split(/\r?\n/)[0]);
          return;
        }
        fail();
      });
    });
  }
  // ── send ──────────────────────────────────────────────────────────────────
  async *send(input, opts) {
    const bin = await this.ping();
    const fullPrompt = this.buildFullPrompt(input);
    const args = this.buildArgs(fullPrompt, opts);
    const proc = (0, import_child_process.spawn)(bin, args, {
      cwd: this.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    this.proc = proc;
    proc.once("close", () => {
      if (this.proc === proc) this.proc = null;
    });
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
    return ctx.map((c, index) => {
      const type = c.type === "selection" ? "selection" : "note";
      const header = `<obsidian-context index="${index + 1}" type="${type}" file="${escapeAttribute(c.file)}">`;
      return `${header}
${c.content}
</obsidian-context>`;
    }).join("\n\n");
  }
  // ── stdout reader ─────────────────────────────────────────────────────────
  async *readEvents(proc) {
    var _a, _b, _c;
    let buffer = "";
    let stderr = "";
    let exitCode = null;
    const processState = {};
    let closed = false;
    let sawTerminalEvent = false;
    const queue = [];
    let notify = null;
    const wake = () => {
      notify == null ? void 0 : notify();
      notify = null;
    };
    const push = (line) => {
      queue.push(line);
      wake();
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
      const msg = chunk.toString();
      stderr += msg;
      const trimmed = msg.trim();
      if (trimmed) console.warn("[Forge agent provider]", trimmed);
    });
    proc.on("error", (err) => {
      processState.spawnError = err;
      wake();
    });
    proc.on("close", (code) => {
      exitCode = code;
      const finalLine = buffer.trim();
      buffer = "";
      if (finalLine) queue.push(finalLine);
      closed = true;
      wake();
    });
    while (true) {
      if (queue.length > 0) {
        const line = queue.shift();
        const event = this.parseLine(line);
        if (!event) continue;
        yield event;
        if (event.type === "done" || event.type === "error") {
          sawTerminalEvent = true;
          break;
        }
        continue;
      }
      if (closed) {
        if (!sawTerminalEvent) {
          const detail = ((_c = processState.spawnError) == null ? void 0 : _c.message) || stderr.trim() || (exitCode !== 0 ? `AGY exited with code ${exitCode != null ? exitCode : "unknown"} before returning a result.` : "AGY exited without returning a result.");
          yield { type: "error", error: detail };
        }
        break;
      }
      if (processState.spawnError) {
        yield { type: "error", error: processState.spawnError.message };
        break;
      }
      await new Promise((resolve) => {
        notify = resolve;
      });
    }
  }
  /**
   * Parse one AGY NDJSON line into a normalized event.
   */
  parseLine(line) {
    var _a, _b, _c, _d;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      return null;
    }
    const ev = obj["event"];
    if (ev === "init") {
      const convId = obj["conversation_id"] || ((_a = obj["init"]) == null ? void 0 : _a["conversation_id"]);
      if (convId) this._lastConversationId = convId;
      return null;
    }
    if (ev === "step_update") {
      const su = obj["step_update"];
      const delta = su == null ? void 0 : su["text_delta"];
      if (delta) return { type: "text", content: delta };
      return null;
    }
    if (ev === "text") {
      const text = obj["text"];
      if (text) return { type: "text", content: text };
      return null;
    }
    if (ev === "result") {
      const result = obj["result"];
      const status = String((_b = result == null ? void 0 : result["status"]) != null ? _b : "").toUpperCase();
      const convId = (result == null ? void 0 : result["conversation_id"]) || this._lastConversationId;
      if (convId) this._lastConversationId = convId;
      if (status && status !== "SUCCESS") {
        const message = String(
          (_c = result == null ? void 0 : result["error"]) != null ? _c : `AGY finished with status ${status} without an error message.`
        );
        return { type: "error", error: message };
      }
      return { type: "done", conversationId: convId };
    }
    if (ev === "error") {
      return {
        type: "error",
        error: String((_d = obj["error"]) != null ? _d : "Unknown AGY error")
      };
    }
    return null;
  }
  // ── listModels ────────────────────────────────────────────────────────────
  async listModels() {
    const bin = await this.ping();
    return new Promise((resolve, reject) => {
      var _a, _b;
      const p = (0, import_child_process.spawn)(bin, ["models"], {
        cwd: this.cwd,
        windowsHide: true
      });
      let out = "";
      let err = "";
      (_a = p.stdout) == null ? void 0 : _a.on("data", (d) => out += d.toString());
      (_b = p.stderr) == null ? void 0 : _b.on("data", (d) => err += d.toString());
      p.on("error", reject);
      p.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(
              err.trim() || `Failed to list AGY models (exit ${code != null ? code : "unknown"}).`
            )
          );
          return;
        }
        const models = out.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).map((line) => {
          const columns = line.split(/\t+|\s{2,}/).filter(Boolean);
          if (columns.length < 2) return null;
          return {
            id: columns[0].trim(),
            name: columns.slice(1).join(" ").trim()
          };
        }).filter((model) => model !== null);
        resolve(models);
      });
    });
  }
  // ── abort ─────────────────────────────────────────────────────────────────
  abort() {
    const proc = this.proc;
    this.proc = null;
    if (proc && proc.exitCode === null && !proc.killed) {
      proc.kill("SIGTERM");
    }
  }
};

// src/chat/ChatView.ts
var import_obsidian = require("obsidian");
var FORGE_VIEW_TYPE = "forge-sidebar";
var ACTIONS = [
  { kind: "ask", label: "Ask" },
  { kind: "explain", label: "Explain" },
  { kind: "practice", label: "Practice" },
  { kind: "review", label: "Review" },
  { kind: "edit", label: "Edit" }
];
var PROMPT_COMMANDS = [
  { kind: "ask", name: "/ask", description: "Ask about the current context" },
  { kind: "explain", name: "/explain", description: "Break down a concept" },
  { kind: "practice", name: "/practice", description: "Generate a practice question" },
  { kind: "review", name: "/review", description: "Review understanding and gaps" },
  { kind: "edit", name: "/edit", description: "Improve the current note" }
];
function parsePromptToken(value) {
  const match = /(^|\s)([@/])([\w-]*)$/.exec(value);
  if (!match) return null;
  return {
    kind: match[2] === "@" ? "source" : "command",
    query: match[3].toLowerCase(),
    start: match.index + match[1].length
  };
}
var ChatView = class extends import_obsidian.ItemView {
  constructor(leaf, learning) {
    super(leaf);
    this.learning = learning;
    this.attachmentsEl = null;
    this.promptMenuEl = null;
    this.promptMenu = null;
    this.promptMenuActive = 0;
    this.promptMenuRows = [];
    this.dictationRecognition = null;
    this.dictationListening = false;
    this.attachments = [];
    this.agentCursorEl = null;
    this.agentContentEl = null;
    this.statusEl = null;
    this.loadingElapsedEl = null;
    this.loadingStartedAt = 0;
    this.loadingTimer = null;
    this.thinkingToggleEl = null;
    this.thinkingLabelEl = null;
    this.thinkingChevronEl = null;
    this.thinkingPanelEl = null;
    this.thinkingRows = [];
    this.thinkingStageTimer = null;
    this.thinkingStage = 0;
    this.thinkingManualExpanded = null;
    this.streamedResponseText = "";
    this.streamingPendingText = "";
    this.responseTimeEl = null;
    this.uiState = "EMPTY";
    this.selectedAction = "ask";
    this.actionButtons = /* @__PURE__ */ new Map();
    this.extraCtx = [];
    this.currentContext = null;
  }
  getViewType() {
    return FORGE_VIEW_TYPE;
  }
  getDisplayText() {
    return "Forge";
  }
  getIcon() {
    return "sparkles";
  }
  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("forge-root");
    this.buildHeader(root);
    this.thread = root.createDiv({ cls: "forge-thread" });
    this.composer = root.createDiv({ cls: "forge-composer" });
    this.buildComposer(this.composer);
    try {
      await this.learning.ping();
    } catch (err) {
      this.showError(this.runtimeErrorMessage(err));
      return;
    }
    await this.syncChips();
    this.showEmpty();
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        void this.syncChips();
      })
    );
    this.registerEvent(
      this.app.workspace.on("editor-selection-change", () => {
        void this.syncChips();
      })
    );
    void this.refreshModelList();
  }
  async onClose() {
    var _a, _b;
    this.learning.cancel();
    (_b = (_a = this.dictationRecognition) == null ? void 0 : _a.stop) == null ? void 0 : _b.call(_a);
    this.dictationRecognition = null;
    this.dictationListening = false;
    this.stopThinkingSequence();
    this.stopLoadingTimer();
  }
  buildHeader(root) {
    this.headerEl = root.createDiv({ cls: "forge-header" });
    const top = this.headerEl.createDiv({ cls: "forge-header-top" });
    const brand = top.createDiv({ cls: "forge-header-brand" });
    brand.createSpan({ cls: "forge-header-mark", text: "\u2726" });
    const copy = brand.createDiv({ cls: "forge-header-copy" });
    copy.createSpan({
      cls: "forge-header-title",
      text: "Forge"
    });
    copy.createSpan({
      cls: "forge-header-subtitle",
      text: "Learning OS"
    });
    const right = top.createDiv({ cls: "forge-header-right" });
    const newBtn = right.createEl("button", {
      cls: "forge-new-btn",
      text: "\uFF0B"
    });
    newBtn.title = "New learning session";
    newBtn.setAttribute("aria-label", "New learning session");
    newBtn.addEventListener("click", async () => {
      await this.learning.newSession();
      this.extraCtx = [];
      this.attachments = [];
      this.renderAttachments();
      this.closePromptMenu();
      this.selectedAction = "ask";
      this.syncActionButtons();
      await this.syncChips();
      this.showEmpty();
    });
    const tabs = this.headerEl.createDiv({ cls: "forge-mode-tabs" });
    this.buildActionButtons(tabs);
  }
  buildActionButtons(parent) {
    for (const action of ACTIONS) {
      const button = parent.createEl("button", {
        cls: "forge-action-btn",
        text: action.label
      });
      button.type = "button";
      button.setAttribute("aria-label", `Use ${action.label} mode`);
      button.title = `${action.label} mode`;
      button.addEventListener("click", () => {
        this.selectedAction = action.kind;
        this.syncActionButtons();
        this.updatePlaceholder();
      });
      this.actionButtons.set(action.kind, button);
    }
    this.syncActionButtons();
  }
  async refreshModelList() {
    let models = this.learning.getModels();
    if (models.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1e3));
      models = this.learning.getModels();
    }
    if (models.length === 0) return;
    this.modelSelect.empty();
    const currentModel = this.learning.getSession().model;
    for (const model of models) {
      const option = this.modelSelect.createEl("option", {
        value: model.id,
        text: model.name
      });
      if (model.id === currentModel) option.selected = true;
    }
  }
  buildComposer(parent) {
    const contextRow = parent.createDiv({ cls: "forge-context-row" });
    contextRow.createSpan({
      cls: "forge-context-label",
      text: "Using"
    });
    const chips = contextRow.createDiv({ cls: "forge-chips" });
    this.selectionChip = chips.createSpan({
      cls: "forge-chip forge-chip--hidden"
    });
    this.selectionChip.createSpan({ cls: "forge-chip-dot" });
    this.selectionChip.createSpan({
      cls: "forge-chip-label",
      text: "@selection"
    });
    this.noteChip = chips.createSpan({
      cls: "forge-chip forge-chip--hidden"
    });
    this.noteChip.createSpan({ cls: "forge-chip-dot" });
    this.noteChip.createSpan({
      cls: "forge-chip-label",
      text: "@note"
    });
    const anchor = parent.createDiv({ cls: "forge-prompt-anchor" });
    this.promptMenuEl = anchor.createDiv({
      cls: "forge-prompt-menu forge-hidden"
    });
    const box = anchor.createDiv({ cls: "forge-composer-box" });
    box.addEventListener("click", (event) => {
      if (!(event.target instanceof HTMLButtonElement) && !(event.target instanceof HTMLSelectElement)) {
        this.input.focus();
      }
    });
    this.attachmentsEl = box.createDiv({
      cls: "forge-attachments forge-hidden"
    });
    this.fileInput = box.createEl("input", {
      cls: "forge-file-input",
      attr: {
        type: "file",
        multiple: "",
        accept: ".md,.txt,.csv,.json,.yaml,.yml"
      }
    });
    this.fileInput.addEventListener("change", () => {
      void this.handleFiles(this.fileInput.files);
    });
    const controls = box.createDiv({ cls: "forge-composer-controls" });
    this.promptPlusBtn = controls.createEl("button", {
      cls: "forge-prompt-plus",
      text: "\uFF0B",
      attr: {
        type: "button",
        "aria-label": "Add context or file",
        "aria-expanded": "false"
      }
    });
    this.promptPlusBtn.title = "Add context or file";
    this.promptPlusBtn.addEventListener("click", () => {
      this.promptMenu = this.promptMenu === "source" ? null : "source";
      this.promptMenuActive = 0;
      this.renderPromptMenu();
      this.input.focus();
    });
    this.input = controls.createEl("textarea", {
      cls: "forge-input",
      attr: {
        placeholder: "Ask about what you're learning\u2026",
        rows: "1"
      }
    });
    this.input.addEventListener("input", () => this.onInput());
    this.input.addEventListener("keydown", (event) => this.onKey(event));
    const footer = box.createDiv({ cls: "forge-composer-footer" });
    const tools = footer.createDiv({ cls: "forge-composer-tools" });
    this.modelSelect = tools.createEl("select", {
      cls: "forge-model-select"
    });
    this.modelSelect.addEventListener("change", () => {
      this.learning.setModel(this.modelSelect.value);
    });
    this.modelSelect.setAttribute("aria-label", "Learning model");
    this.modelSelect.title = "Learning model";
    this.modelSelect.createEl("option", {
      text: "Loading models\u2026",
      attr: {
        disabled: "",
        selected: ""
      }
    });
    this.dictationBtn = tools.createEl("button", {
      cls: "forge-composer-icon-btn",
      text: "\u25C9",
      attr: {
        type: "button",
        "aria-label": "Start dictation",
        "aria-pressed": "false"
      }
    });
    this.dictationBtn.title = "Start dictation";
    this.dictationBtn.addEventListener("click", () => this.toggleDictation());
    const btnGroup = footer.createDiv({ cls: "forge-btn-group" });
    this.cancelBtn = btnGroup.createEl("button", {
      cls: "forge-cancel-btn forge-hidden",
      text: "\xD7"
    });
    this.cancelBtn.title = "Stop";
    this.cancelBtn.setAttribute("aria-label", "Stop generating");
    this.cancelBtn.addEventListener("click", () => {
      this.learning.cancel();
      this.setUIState("ANSWER");
      this.appendInlineError(this.thread, "Stopped.");
      this.finishStreamingBubble("Stopped");
    });
    this.sendBtn = btnGroup.createEl("button", {
      cls: "forge-send-btn",
      text: "\u2191"
    });
    this.sendBtn.title = "Send message";
    this.sendBtn.setAttribute("aria-label", "Send message");
    this.sendBtn.disabled = true;
    this.sendBtn.addEventListener("click", () => {
      void this.doSend();
    });
    this.setupDictation();
    parent.createDiv({
      cls: "forge-composer-hint",
      text: "Enter to send \xB7 Shift + Enter for a new line"
    });
  }
  renderAttachments() {
    if (!this.attachmentsEl) return;
    this.attachmentsEl.empty();
    this.attachmentsEl.toggleClass("forge-hidden", this.attachments.length === 0);
    for (const [index, attachment] of this.attachments.entries()) {
      const chip = this.attachmentsEl.createDiv({
        cls: "forge-attachment-chip"
      });
      chip.createSpan({ cls: "forge-attachment-icon", text: "\u25A7" });
      chip.createSpan({ cls: "forge-attachment-name", text: attachment.name });
      const remove = chip.createEl("button", {
        cls: "forge-attachment-remove",
        text: "\xD7",
        attr: {
          type: "button",
          "aria-label": `Remove ${attachment.name}`
        }
      });
      remove.addEventListener("click", () => {
        this.attachments.splice(index, 1);
        this.extraCtx = this.attachments.map((item) => item.context);
        this.renderAttachments();
        void this.syncChips();
      });
    }
  }
  async handleFiles(files) {
    if (!files || files.length === 0) return;
    this.closePromptMenu();
    for (const file of Array.from(files)) {
      const content = await file.text();
      this.attachments.push({
        name: file.name,
        context: {
          type: "note",
          file: `attachment/${file.name}`,
          content
        }
      });
    }
    this.extraCtx = this.attachments.map((item) => item.context);
    this.renderAttachments();
    this.fileInput.value = "";
    await this.syncChips();
    this.input.focus();
  }
  getPromptMenuItems() {
    var _a, _b;
    if (this.promptMenu === "command") {
      return PROMPT_COMMANDS.map((command) => ({
        key: command.kind,
        name: command.name,
        description: command.description,
        action: command.kind
      }));
    }
    const items = [
      {
        key: "attach",
        name: "Add text files",
        description: "Attach Markdown or data context",
        action: "attach"
      }
    ];
    if ((_a = this.currentContext) == null ? void 0 : _a.selection) {
      items.push({
        key: "selection",
        name: "Current selection",
        description: "Use the selected text",
        action: "selection"
      });
    }
    if ((_b = this.currentContext) == null ? void 0 : _b.activeNote) {
      items.push({
        key: "note",
        name: "Current note",
        description: "Use the active note",
        action: "note"
      });
    }
    return items;
  }
  renderPromptMenu() {
    var _a;
    if (!this.promptMenuEl) return;
    this.promptMenuEl.empty();
    this.promptMenuRows = [];
    this.promptMenuEl.toggleClass("forge-hidden", this.promptMenu === null);
    (_a = this.promptPlusBtn) == null ? void 0 : _a.setAttribute(
      "aria-expanded",
      String(this.promptMenu !== null)
    );
    if (!this.promptMenu) return;
    const token = parsePromptToken(this.input.value);
    const query = (token == null ? void 0 : token.kind) === this.promptMenu ? token.query : "";
    const rows = this.getPromptMenuItems().filter(
      (item) => `${item.name} ${item.description}`.toLowerCase().includes(query)
    );
    rows.forEach((item, index) => {
      const button = this.promptMenuEl.createEl("button", {
        cls: `forge-prompt-menu-row${index === this.promptMenuActive ? " is-active" : ""}`,
        attr: { type: "button" }
      });
      button.createSpan({ cls: "forge-prompt-menu-icon", text: item.action === "attach" ? "\uFF0B" : "@" });
      button.createSpan({ cls: "forge-prompt-menu-name", text: item.name });
      button.createSpan({ cls: "forge-prompt-menu-description", text: item.description });
      button.addEventListener("mouseenter", () => {
        this.promptMenuActive = index;
        this.promptMenuRows.forEach((row, rowIndex) => {
          row.toggleClass("is-active", rowIndex === this.promptMenuActive);
        });
      });
      button.addEventListener("click", () => this.pickPromptMenuItem(item));
      this.promptMenuRows.push(button);
    });
    if (rows.length === 0) {
      this.promptMenuEl.createDiv({
        cls: "forge-prompt-menu-empty",
        text: `No matches for \u201C${query}\u201D`
      });
    }
    this.promptMenuEl.createDiv({
      cls: "forge-prompt-menu-hint",
      text: this.promptMenu === "source" ? "Select a source or attach a text file" : "Choose a learning action"
    });
  }
  pickPromptMenuItem(item) {
    if (item.action === "attach") {
      this.closePromptMenu();
      this.fileInput.click();
      return;
    }
    const token = parsePromptToken(this.input.value);
    const prefix = token ? this.input.value.slice(0, token.start) : this.input.value;
    if (item.action === "selection" || item.action === "note") {
      this.input.value = `${prefix}@${item.action === "selection" ? "selection" : "current-note"} `;
    } else {
      this.selectedAction = item.action;
      this.syncActionButtons();
      this.updatePlaceholder();
      this.input.value = `${prefix}${item.name} `;
    }
    this.closePromptMenu();
    this.onInput();
    this.input.focus();
  }
  closePromptMenu() {
    this.promptMenu = null;
    this.promptMenuActive = 0;
    this.renderPromptMenu();
  }
  setupDictation() {
    var _a;
    const SpeechRecognition = (_a = window.SpeechRecognition) != null ? _a : window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      this.dictationBtn.disabled = true;
      this.dictationBtn.title = "Dictation is unavailable in this environment";
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "id-ID";
    recognition.onresult = (event) => {
      var _a2, _b, _c, _d;
      const transcript = (_d = (_c = (_b = (_a2 = event.results) == null ? void 0 : _a2[0]) == null ? void 0 : _b[0]) == null ? void 0 : _c.transcript) == null ? void 0 : _d.trim();
      if (transcript) {
        this.input.value = `${this.input.value.trimEnd()}${this.input.value ? " " : ""}${transcript}`;
        this.onInput();
      }
    };
    recognition.onerror = () => {
      this.dictationListening = false;
      this.syncDictationButton();
    };
    recognition.onend = () => {
      this.dictationListening = false;
      this.syncDictationButton();
    };
    this.dictationRecognition = recognition;
  }
  toggleDictation() {
    if (!this.dictationRecognition) return;
    if (this.dictationListening) {
      this.dictationRecognition.stop();
      return;
    }
    this.dictationListening = true;
    this.syncDictationButton();
    this.input.focus();
    try {
      this.dictationRecognition.start();
    } catch (e) {
      this.dictationListening = false;
      this.syncDictationButton();
    }
  }
  syncDictationButton() {
    if (!this.dictationBtn) return;
    this.dictationBtn.toggleClass("is-active", this.dictationListening);
    this.dictationBtn.setAttribute("aria-pressed", String(this.dictationListening));
    this.dictationBtn.setAttribute(
      "aria-label",
      this.dictationListening ? "Stop dictation" : "Start dictation"
    );
    this.dictationBtn.title = this.dictationListening ? "Stop dictation" : "Start dictation";
    this.dictationBtn.textContent = this.dictationListening ? "\u25CC" : "\u25C9";
  }
  syncActionButtons() {
    for (const [kind, button] of this.actionButtons) {
      const active = kind === this.selectedAction;
      button.toggleClass("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }
  updatePlaceholder() {
    const placeholders = {
      ask: "Ask about what you're learning\u2026",
      explain: "What should I explain?",
      practice: "What should we practice?",
      review: "What should I review?",
      edit: "How should I improve this note?"
    };
    if (this.input) {
      this.input.placeholder = placeholders[this.selectedAction];
    }
  }
  async syncChips() {
    var _a;
    const context = await this.learning.resolveContext(this.extraCtx);
    this.currentContext = context;
    const hasSelection = Boolean(context.selection);
    this.selectionChip.toggleClass("agy-chip--hidden", !hasSelection);
    const activeNote = context.activeNote;
    this.noteChip.toggleClass("agy-chip--hidden", !activeNote);
    if (activeNote) {
      const name = (_a = activeNote.path.split("/").pop()) != null ? _a : activeNote.path;
      const label = this.noteChip.querySelector(".agy-chip-label");
      if (label) label.textContent = `@${name}`;
      this.noteChip.title = activeNote.path;
    }
  }
  onInput() {
    this.sendBtn.disabled = !this.canSend() || this.uiState === "RUNNING";
    const token = parsePromptToken(this.input.value);
    if (token && this.promptMenu !== token.kind) {
      this.promptMenu = token.kind;
      this.promptMenuActive = 0;
    } else if (!token) {
      this.closePromptMenu();
    }
    this.renderPromptMenu();
    this.input.style.height = "auto";
    this.input.style.height = Math.min(this.input.scrollHeight, 80) + "px";
  }
  onKey(event) {
    if (this.promptMenu && this.promptMenuRows.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        this.promptMenuActive = (this.promptMenuActive + direction + this.promptMenuRows.length) % this.promptMenuRows.length;
        this.promptMenuRows.forEach((row, index) => {
          row.toggleClass("is-active", index === this.promptMenuActive);
        });
        return;
      }
      if (event.key === "Enter" && !event.shiftKey || event.key === "Tab") {
        event.preventDefault();
        const row = this.promptMenuRows[this.promptMenuActive];
        if (row) row.click();
        return;
      }
    }
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!this.sendBtn.disabled) void this.doSend();
    }
    if (event.key === "Escape") {
      if (this.promptMenu) {
        this.closePromptMenu();
      } else if (this.uiState === "RUNNING") {
        this.cancelBtn.click();
      }
    }
  }
  async doSend() {
    var _a, _b;
    const prompt = this.input.value.trim() || "Review the attached context.";
    if (!this.canSend() || this.uiState === "RUNNING") return;
    const explicitContext = this.extraCtx;
    this.closePromptMenu();
    if (this.dictationListening) (_b = (_a = this.dictationRecognition) == null ? void 0 : _a.stop) == null ? void 0 : _b.call(_a);
    this.input.value = "";
    this.input.style.height = "";
    this.attachments = [];
    this.extraCtx = [];
    this.renderAttachments();
    this.sendBtn.disabled = true;
    this.agyCursorEl = null;
    this.agyContentEl = null;
    this.statusEl = null;
    this.streamedResponseText = "";
    this.streamingPendingText = "";
    this.stopThinkingSequence();
    this.stopLoadingTimer();
    this.appendUserBubble(prompt);
    this.setUIState("RUNNING");
    this.ensureAgentBubble();
    const timeout = window.setTimeout(() => {
      this.learning.cancel();
      this.setUIState("ANSWER");
      this.finishStreamingBubble("Timed out");
      this.appendInlineError(
        this.thread,
        "No response after 60 s. The agent runtime may be busy."
      );
    }, 6e4);
    try {
      for await (const event of this.learning.run({
        prompt,
        action: this.selectedAction,
        explicitContext
      })) {
        this.handleLearningEvent(event, timeout);
      }
    } catch (err) {
      window.clearTimeout(timeout);
      this.finishStreamingBubble("Stopped");
      const message = err instanceof Error ? err.message : String(err);
      if (message.includes("not found") || message.includes("ENOENT")) {
        this.showError("Agent runtime not found. Check Forge runtime settings.");
      } else {
        console.warn("[Forge] Agent runtime error", message);
        this.appendInlineError(
          this.thread,
          this.runtimeErrorMessage(err)
        );
        this.setUIState("ANSWER");
      }
    }
  }
  handleLearningEvent(event, timeout) {
    if (event.type === "context-ready") {
      this.currentContext = event.context;
      return;
    }
    if (event.type === "response-delta") {
      this.appendToAgentBubble(event.text);
      this.scrollThread();
      return;
    }
    if (event.type === "practice-question") {
      this.appendPracticeQuestion(event.question);
      return;
    }
    if (event.type === "practice-evaluation") {
      this.appendPracticeEvaluation(event.evaluation);
      return;
    }
    if (event.type === "learning-state-updated") {
      return;
    }
    if (event.type === "mutation-proposed") {
      this.setUIState("PROPOSAL");
      this.appendProposalBubble(event.proposal);
      return;
    }
    if (event.type === "completed") {
      window.clearTimeout(timeout);
      if (this.uiState === "RUNNING") {
        this.setUIState("ANSWER");
      }
      this.finishStreamingBubble();
      return;
    }
    if (event.type === "error") {
      window.clearTimeout(timeout);
      this.finishStreamingBubble("Unable to finish");
      console.warn("[Forge] Agent runtime error", event.message);
      this.appendInlineError(
        this.thread,
        this.runtimeErrorMessage(event.message)
      );
      this.setUIState("ANSWER");
    }
  }
  finishStreamingBubble(doneLabel) {
    var _a;
    const elapsed = this.formatElapsed(Date.now() - this.loadingStartedAt);
    this.stopThinkingSequence();
    this.flushStreamingText();
    this.renderMarkdownResponse();
    if (doneLabel === void 0) this.appendStreamActions();
    this.settleThinking(doneLabel != null ? doneLabel : `Thought for ${elapsed}`);
    if (this.responseTimeEl) this.responseTimeEl.textContent = `for ${elapsed}`;
    this.stopLoadingTimer();
    (_a = this.agyCursorEl) == null ? void 0 : _a.removeClass("forge-bubble--streaming");
    this.agyCursorEl = null;
    this.agyContentEl = null;
    this.statusEl = null;
    this.thinkingToggleEl = null;
    this.thinkingLabelEl = null;
    this.thinkingChevronEl = null;
    this.thinkingPanelEl = null;
    this.thinkingRows = [];
    this.thinkingManualExpanded = null;
    this.responseTimeEl = null;
  }
  settleThinking(doneLabel) {
    var _a, _b, _c, _d;
    if (!this.thinkingLabelEl) return;
    this.thinkingLabelEl.textContent = doneLabel;
    this.thinkingLabelEl.removeClass("forge-thinking-label--active");
    this.thinkingLabelEl.addClass("forge-thinking-label--done");
    for (const row of this.thinkingRows) {
      row.removeClass("forge-hidden");
      row.removeClass("is-active");
      row.addClass("is-done");
      const marker = row.firstElementChild;
      if (marker) {
        marker.textContent = "\u2713";
        marker.removeClass("forge-thinking-marker--spinner");
      }
    }
    const expanded = (_a = this.thinkingManualExpanded) != null ? _a : false;
    (_b = this.thinkingPanelEl) == null ? void 0 : _b.toggleClass("is-expanded", expanded);
    (_c = this.thinkingToggleEl) == null ? void 0 : _c.setAttribute("aria-expanded", String(expanded));
    (_d = this.thinkingChevronEl) == null ? void 0 : _d.toggleClass("is-expanded", expanded);
  }
  stopThinkingSequence() {
    if (this.thinkingStageTimer !== null) {
      window.clearTimeout(this.thinkingStageTimer);
      this.thinkingStageTimer = null;
    }
  }
  startThinkingSequence() {
    this.thinkingStage = 0;
    this.renderThinkingStage();
    this.scheduleThinkingStage();
  }
  scheduleThinkingStage() {
    var _a;
    if (this.thinkingStage >= this.thinkingRows.length - 1) return;
    const delays = [800, 600, 1800, 2600];
    const delay = (_a = delays[this.thinkingStage]) != null ? _a : 1200;
    this.thinkingStageTimer = window.setTimeout(() => {
      this.thinkingStage += 1;
      this.renderThinkingStage();
      this.scheduleThinkingStage();
    }, delay);
  }
  renderThinkingStage() {
    const visible = Math.min(
      this.thinkingStage + 1,
      this.thinkingRows.length
    );
    this.thinkingRows.forEach((row, index) => {
      const active = index === visible - 1;
      const done = index < visible - 1;
      const marker = row.firstElementChild;
      row.toggleClass("forge-hidden", index >= visible);
      row.toggleClass("is-active", active);
      row.toggleClass("is-done", done);
      if (marker) {
        marker.textContent = done ? "\u2713" : "";
        marker.toggleClass("forge-thinking-marker--spinner", active);
      }
    });
  }
  startLoadingTimer() {
    if (this.loadingTimer !== null) {
      window.clearInterval(this.loadingTimer);
      this.loadingTimer = null;
    }
    const update = () => {
      const elapsed = this.formatElapsed(Date.now() - this.loadingStartedAt);
      if (this.loadingElapsedEl) this.loadingElapsedEl.textContent = elapsed;
      if (this.responseTimeEl) this.responseTimeEl.textContent = `for ${elapsed}`;
    };
    this.loadingStartedAt = Date.now();
    update();
    this.loadingTimer = window.setInterval(update, 100);
  }
  stopLoadingTimer() {
    if (this.loadingTimer !== null) {
      window.clearInterval(this.loadingTimer);
      this.loadingTimer = null;
    }
    this.loadingElapsedEl = null;
  }
  formatElapsed(milliseconds) {
    const seconds = milliseconds / 1e3;
    if (seconds < 60) return `${seconds.toFixed(1)}s`;
    return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
  }
  setUIState(state) {
    this.uiState = state;
    const busy = state === "RUNNING";
    this.input.disabled = busy || state === "ERROR";
    this.sendBtn.disabled = busy || state === "ERROR" || !this.canSend();
    this.cancelBtn.toggleClass("forge-hidden", !busy);
  }
  canSend() {
    return this.input.value.trim().length > 0 || this.attachments.length > 0;
  }
  showEmpty() {
    var _a, _b, _c;
    this.stopLoadingTimer();
    this.thread.empty();
    this.agyCursorEl = null;
    this.statusEl = null;
    const slate = this.thread.createDiv({
      cls: "forge-empty-slate"
    });
    slate.createDiv({
      cls: "forge-empty-mark",
      text: "\u2726"
    });
    slate.createDiv({
      cls: "forge-empty-kicker",
      text: "LEARNING OS"
    });
    let label = "Open a note or ask about your Learning OS.";
    if ((_a = this.currentContext) == null ? void 0 : _a.selection) {
      label = "Selection ready \u2014 explain, practice, review, or edit it.";
    } else if ((_b = this.currentContext) == null ? void 0 : _b.activeNote) {
      const name = (_c = this.currentContext.activeNote.path.split("/").pop()) != null ? _c : this.currentContext.activeNote.path;
      label = `Learn with ${name}`;
    }
    slate.createDiv({
      cls: "forge-empty-label",
      text: label
    });
    slate.createDiv({
      cls: "forge-empty-hint",
      text: "Ask, explain, practice, review, or edit from the current context."
    });
    this.setUIState("EMPTY");
  }
  showError(message) {
    this.stopLoadingTimer();
    this.thread.empty();
    this.agyCursorEl = null;
    this.statusEl = null;
    const slate = this.thread.createDiv({
      cls: "forge-error-slate"
    });
    slate.createDiv({
      cls: "forge-error-icon",
      text: "\u26A0"
    });
    slate.createDiv({
      cls: "forge-error-title",
      text: "Forge unavailable"
    });
    slate.createDiv({
      cls: "forge-error-body",
      text: message
    });
    const button = slate.createEl("button", {
      cls: "forge-configure-btn",
      text: "Configure Forge \u2192"
    });
    button.addEventListener("click", () => {
      var _a, _b;
      (_b = (_a = this.app.setting) == null ? void 0 : _a.open) == null ? void 0 : _b.call(_a);
    });
    this.setUIState("ERROR");
  }
  runtimeErrorMessage(error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes("not found") || message.includes("ENOENT")) {
      return "Agent runtime not found. Check Forge runtime settings.";
    }
    return "Forge could not complete the request. Check the agent runtime connection and try again.";
  }
  appendUserBubble(text) {
    var _a;
    (_a = this.thread.querySelector(".forge-empty-slate")) == null ? void 0 : _a.remove();
    const bubble = this.thread.createDiv({
      cls: "forge-bubble forge-bubble--user"
    });
    bubble.setText(text);
  }
  ensureAgentBubble() {
    var _a, _b;
    if (this.agyCursorEl) return;
    this.statusEl = this.buildThinkingTrace();
    this.agyCursorEl = this.thread.createDiv({
      cls: "forge-bubble forge-bubble--agent forge-bubble--streaming"
    });
    const meta = this.agyCursorEl.createDiv({ cls: "forge-response-meta" });
    meta.createSpan({ cls: "forge-response-label", text: "Forge" });
    meta.createSpan({
      cls: "forge-response-sub",
      text: (_b = (_a = ACTIONS.find((action) => action.kind === this.selectedAction)) == null ? void 0 : _a.label) != null ? _b : "Response"
    });
    this.responseTimeEl = meta.createSpan({ cls: "forge-response-time", text: "for 0.0s" });
    this.agyContentEl = this.agyCursorEl.createDiv({
      cls: "forge-bubble-content"
    });
  }
  buildThinkingTrace() {
    var _a, _b, _c, _d, _e;
    const trace = this.thread.createDiv({
      cls: "forge-thinking"
    });
    trace.setAttribute("role", "status");
    trace.setAttribute("aria-live", "polite");
    const toggle = trace.createEl("button", {
      cls: "forge-thinking-toggle",
      attr: {
        type: "button",
        "aria-expanded": "true"
      }
    });
    this.thinkingToggleEl = toggle;
    toggle.createSpan({
      cls: "forge-thinking-icon",
      text: "\u2726"
    });
    this.thinkingLabelEl = toggle.createSpan({
      cls: "forge-thinking-label forge-thinking-label--active",
      text: "Thinking"
    });
    this.loadingElapsedEl = toggle.createSpan({
      cls: "forge-thinking-elapsed"
    });
    this.loadingElapsedEl.setAttribute("aria-hidden", "true");
    const chevron = toggle.createSpan({
      cls: "forge-thinking-chevron",
      text: "\u2304"
    });
    this.thinkingChevronEl = chevron;
    const panel = trace.createDiv({
      cls: "forge-thinking-panel is-expanded"
    });
    this.thinkingPanelEl = panel;
    const traceList = panel.createDiv({
      cls: "forge-thinking-trace"
    });
    const source = ((_a = this.currentContext) == null ? void 0 : _a.selection) ? this.currentContext.selection.file : (_c = (_b = this.currentContext) == null ? void 0 : _b.activeNote) == null ? void 0 : _c.path;
    const sourceName = source == null ? void 0 : source.split("/").pop();
    const readingLabel = ((_d = this.currentContext) == null ? void 0 : _d.selection) ? "Reading selected text" : ((_e = this.currentContext) == null ? void 0 : _e.activeNote) ? "Reading current note" : "Resolving workspace context";
    const rows = [
      { primary: "Resolving current context" },
      { primary: readingLabel, secondary: sourceName },
      { primary: "Loading Learning OS policy" },
      { primary: "Preparing response" }
    ];
    this.thinkingRows = rows.map((row) => {
      const rowEl = traceList.createDiv({
        cls: "forge-thinking-row"
      });
      rowEl.createSpan({
        cls: "forge-thinking-marker forge-thinking-marker--spinner"
      });
      rowEl.createSpan({
        cls: "forge-thinking-primary",
        text: row.primary
      });
      if (row.secondary) {
        rowEl.createSpan({
          cls: "forge-thinking-secondary",
          text: row.secondary
        });
      }
      return rowEl;
    });
    toggle.addEventListener("click", () => {
      const expanded = !panel.hasClass("is-expanded");
      panel.toggleClass("is-expanded", expanded);
      toggle.setAttribute("aria-expanded", String(expanded));
      chevron.toggleClass("is-expanded", expanded);
      this.thinkingManualExpanded = expanded;
    });
    this.startLoadingTimer();
    this.startThinkingSequence();
    return trace;
  }
  appendToAgentBubble(text) {
    var _a, _b;
    if (!this.agyContentEl) return;
    this.streamedResponseText += text;
    this.streamingPendingText += text;
    const parts = this.streamingPendingText.split(/(\s+)/);
    const lastPart = (_a = parts[parts.length - 1]) != null ? _a : "";
    const hasTrailingWhitespace = /\s$/.test(this.streamingPendingText);
    if (!hasTrailingWhitespace) {
      this.streamingPendingText = (_b = parts.pop()) != null ? _b : lastPart;
    } else {
      this.streamingPendingText = "";
    }
    for (const part of parts) {
      if (!part) continue;
      if (/\s+/.test(part)) {
        this.agyContentEl.appendText(part);
        continue;
      }
      this.agyContentEl.createSpan({
        cls: "forge-stream-word",
        text: part
      });
    }
    this.scrollThread();
  }
  flushStreamingText() {
    if (!this.agyContentEl || !this.streamingPendingText) return;
    this.agyContentEl.createSpan({
      cls: "forge-stream-word",
      text: this.streamingPendingText
    });
    this.streamingPendingText = "";
  }
  renderMarkdownResponse() {
    var _a, _b, _c, _d, _e, _f;
    if (!this.agyContentEl || !this.streamedResponseText.trim()) return;
    const content = this.agyContentEl;
    const markdown = this.streamedResponseText;
    const sourcePath = (_f = (_e = (_b = (_a = this.currentContext) == null ? void 0 : _a.selection) == null ? void 0 : _b.file) != null ? _e : (_d = (_c = this.currentContext) == null ? void 0 : _c.activeNote) == null ? void 0 : _d.path) != null ? _f : "Forge.md";
    content.empty();
    content.addClass("forge-markdown");
    void import_obsidian.MarkdownRenderer.render(this.app, markdown, content, sourcePath, this).catch(() => {
      content.empty();
      content.removeClass("forge-markdown");
      content.addClass("forge-markdown-error");
      content.setText("Markdown response could not be rendered.");
    });
  }
  appendStreamActions() {
    if (!this.agyCursorEl || !this.streamedResponseText.trim()) return;
    const responseText = this.streamedResponseText.trim();
    const actions = this.agyCursorEl.createDiv({
      cls: "forge-stream-actions"
    });
    const copyButton = actions.createEl("button", {
      cls: "forge-stream-action",
      text: "Copy",
      attr: {
        type: "button",
        "aria-label": "Copy response"
      }
    });
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(responseText);
        copyButton.textContent = "Copied";
      } catch (e) {
        copyButton.textContent = "Copy failed";
      }
      window.setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1400);
    });
  }
  appendPracticeQuestion(question) {
    if (!this.agyCursorEl) return;
    const card = this.agyCursorEl.createDiv({
      cls: "forge-practice-card"
    });
    card.createDiv({
      cls: "forge-practice-label",
      text: `Practice \xB7 ${question.concept}`
    });
    card.createDiv({
      cls: "forge-practice-question",
      text: question.question
    });
    if (question.hint) {
      card.createDiv({
        cls: "forge-practice-hint",
        text: `Hint: ${question.hint}`
      });
    }
    this.scrollThread();
  }
  appendPracticeEvaluation(evaluation) {
    if (!this.agyCursorEl) return;
    const card = this.agyCursorEl.createDiv({
      cls: "forge-practice-evaluation"
    });
    const outcomeLabel = evaluation.outcome === "correct" ? "Correct" : evaluation.outcome === "partial" ? "Partial" : "Needs work";
    card.createDiv({
      cls: "forge-practice-label",
      text: `${outcomeLabel} \xB7 ${evaluation.concept}`
    });
    card.createDiv({
      cls: "forge-practice-feedback",
      text: evaluation.feedback
    });
    if (evaluation.misconceptions.length > 0) {
      const gaps = card.createDiv({
        cls: "forge-practice-gaps"
      });
      gaps.createDiv({
        cls: "forge-practice-gaps-label",
        text: "Gap"
      });
      for (const misconception of evaluation.misconceptions) {
        gaps.createDiv({
          cls: "forge-practice-gap",
          text: misconception
        });
      }
    }
    this.scrollThread();
  }
  appendProposalBubble(proposal) {
    const wrap = this.thread.createDiv({
      cls: "forge-proposal"
    });
    wrap.createDiv({
      cls: "forge-proposal-badge",
      text: "\u{1F4C4} " + proposal.file
    });
    if (proposal.reason) {
      wrap.createDiv({
        cls: "forge-proposal-reason",
        text: proposal.reason
      });
    }
    const diff = wrap.createDiv({
      cls: "forge-proposal-diff"
    });
    proposal.original.split("\n").forEach((line) => {
      diff.createDiv({
        cls: "forge-diff-removed",
        text: "- " + line
      });
    });
    proposal.replacement.split("\n").forEach((line) => {
      diff.createDiv({
        cls: "forge-diff-added",
        text: "+ " + line
      });
    });
    const actions = wrap.createDiv({
      cls: "forge-proposal-actions"
    });
    const rejectBtn = actions.createEl("button", {
      cls: "forge-btn-reject",
      text: "Reject"
    });
    const applyBtn = actions.createEl("button", {
      cls: "forge-btn-apply",
      text: "Apply \u2713"
    });
    rejectBtn.addEventListener("click", () => {
      actions.remove();
      wrap.createDiv({
        cls: "forge-result-badge forge-badge--rejected",
        text: "\u2715 Rejected"
      });
      this.setUIState("ANSWER");
    });
    applyBtn.addEventListener("click", async () => {
      applyBtn.disabled = true;
      applyBtn.textContent = "Applying\u2026";
      const result = await this.learning.applyProposal(proposal);
      actions.remove();
      if (result.ok) {
        wrap.createDiv({
          cls: "forge-result-badge forge-badge--applied",
          text: "\u2713 Applied to " + proposal.file
        });
        this.setUIState("APPLIED");
      } else {
        wrap.createDiv({
          cls: "forge-result-badge forge-badge--stale",
          text: "\u26A0 " + result.message
        });
        this.setUIState("ANSWER");
      }
    });
    this.scrollThread();
  }
  appendInlineError(parent, message) {
    parent.createDiv({
      cls: "forge-inline-error",
      text: "\u26A0 " + message
    });
    this.scrollThread();
  }
  scrollThread() {
    this.thread.scrollTo({
      top: this.thread.scrollHeight,
      behavior: "smooth"
    });
  }
};

// src/context/ContextResolver.ts
var ContextResolver = class {
  constructor(obsidian) {
    this.obsidian = obsidian;
  }
  async resolve(explicit = []) {
    const selection = this.obsidian.getSelection();
    const activeNote = await this.obsidian.getCurrentNote();
    const explicitDocs = explicit.map((item) => ({
      type: item.type,
      path: item.file,
      content: item.content,
      source: "explicit"
    }));
    return {
      selection: selection != null ? selection : void 0,
      activeNote: activeNote ? { path: activeNote.file, content: activeNote.content } : void 0,
      explicit: explicitDocs
    };
  }
  /**
   * Convert resolved learning context to the existing agent transport shape.
   * Only one automatic primary material is included:
   * selection when present, otherwise the current note.
   */
  toAgentContext(context) {
    const result = [];
    if (context.selection) {
      result.push({
        type: "selection",
        file: context.selection.file,
        content: context.selection.content
      });
    } else if (context.activeNote) {
      result.push({
        type: "note",
        file: context.activeNote.path,
        content: context.activeNote.content
      });
    }
    for (const item of context.explicit) {
      const duplicate = result.some(
        (existing) => existing.type === item.type && existing.file === item.path && existing.content === item.content
      );
      if (duplicate) continue;
      result.push({
        type: item.type,
        file: item.path,
        content: item.content
      });
    }
    return result;
  }
};

// src/context/ObsidianContext.ts
var import_obsidian2 = require("obsidian");
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
    if (!file || !(file instanceof import_obsidian2.TFile)) return null;
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
    if (!file || !(file instanceof import_obsidian2.TFile)) return null;
    const content = await this.app.vault.cachedRead(file);
    return { type: "note", file: path, content };
  }
  /**
   * Verify that `original` still exists verbatim in the active file.
   * Used before Apply to detect stale proposals.
   */
  async verifyOriginal(filePath, original) {
    const file = this.app.vault.getFileByPath(filePath);
    if (!file || !(file instanceof import_obsidian2.TFile)) return false;
    const content = await this.app.vault.cachedRead(file);
    return content.includes(original);
  }
};

// src/context/PolicyLoader.ts
var import_obsidian3 = require("obsidian");
var PolicyLoader = class {
  constructor(app) {
    this.app = app;
  }
  async load() {
    var _a;
    const file = this.app.vault.getFileByPath("AGENTS.md");
    if (!file || !(file instanceof import_obsidian3.TFile)) {
      this.cached = void 0;
      return {
        path: "AGENTS.md",
        rawInstructions: ""
      };
    }
    if (((_a = this.cached) == null ? void 0 : _a.mtime) === file.stat.mtime) {
      return this.cached.policy;
    }
    const policy = {
      path: file.path,
      rawInstructions: await this.app.vault.cachedRead(file)
    };
    this.cached = {
      mtime: file.stat.mtime,
      policy
    };
    return policy;
  }
};

// src/learning/action-builders.ts
var BASE_INSTRUCTION = `
You are the learning agent inside an Obsidian vault.

Important environment rules:
- Context blocks already identify the active note, selection, policy, and learning-state files.
- Do not ask the user for a path that is already present in context.
- Treat AGENTS.md context as the vault-level learning policy.
- Treat Learning OS progress context as evidence-backed state, not as infallible truth.
- Stay focused on the user's current learning goal and material.
`.trim();
var ACTION_INSTRUCTIONS = {
  ask: `
Answer the request directly using the supplied learning context.
Prefer the smallest useful mental model and important relationships.
`.trim(),
  explain: `
Explain the selected or current concept for learning.
Prioritize:
- the correct mental model,
- important cause/effect or dependency relationships,
- one concrete example,
- no unnecessary breadth.
End only when the user has enough understanding to continue.
`.trim(),
  review: `
Review the supplied learning material.
Look only for issues that materially affect understanding:
- factual errors,
- misconceptions,
- missing prerequisite relationships,
- weak or misleading explanations.
Explain each concrete gap and avoid cosmetic rewriting.
`.trim(),
  edit: `
Help improve the current Markdown material.
First explain the important change briefly.
When a concrete file edit is appropriate, emit exactly one fenced block:

\`\`\`edit-proposal
{"file":"exact/path/from/context.md","original":"verbatim existing text","replacement":"new text","reason":"why"}
\`\`\`

Rules:
- "file" must exactly match a path shown in supplied context.
- "original" must be copied verbatim from supplied context.
- Never claim a file was changed; the plugin applies proposals only after approval.
`.trim()
};
function buildActionInstruction(action) {
  return `${BASE_INSTRUCTION}

Learning mode: ${action}

${ACTION_INSTRUCTIONS[action]}`;
}
function buildPracticeQuestionInstruction(userRequest) {
  return `
${BASE_INSTRUCTION}

Learning mode: practice

Generate exactly one active-recall question grounded in the supplied context.
Do not reveal the answer. Choose a question that tests an important relationship,
mechanism, dependency, or application rather than trivia.

Emit the question as exactly one fenced block:

\`\`\`learning-practice
{"kind":"question","concept":"specific concept","question":"one question","hint":"optional short hint"}
\`\`\`

User request:
${userRequest}
`.trim();
}
function buildPracticeEvaluationInstruction(input) {
  var _a;
  return `
${BASE_INSTRUCTION}

Learning mode: practice evaluation

Evaluate the user's answer to the active practice question.

Question:
${input.question}

Concept:
${(_a = input.concept) != null ? _a : "infer from the question and supplied context"}

User answer:
${input.answer}

Evaluate understanding, not writing style.
Use "correct" only when the core mental model is correct.
Use "partial" when the important direction is right but a material relationship
or mechanism is missing.
Use "incorrect" when the core model is wrong.

Return exactly one fenced block:

\`\`\`learning-practice
{"kind":"evaluation","concept":"specific concept","outcome":"correct|partial|incorrect","feedback":"concise feedback","misconceptions":["specific misconception if any"],"nextQuestion":"optional next question"}
\`\`\`

If another question would add useful evidence, include nextQuestion.
Otherwise omit it.
`.trim();
}

// src/learning/StructuredStreamParser.ts
var START_TAGS = [
  { kind: "edit-proposal", marker: "```edit-proposal" },
  { kind: "learning-practice", marker: "```learning-practice" }
];
var END_TAG = "\n```";
var MAX_MARKER_LENGTH = Math.max(
  ...START_TAGS.map((item) => item.marker.length)
);
function isEditProposal(value) {
  if (!value || typeof value !== "object") return false;
  const obj = value;
  return typeof obj.file === "string" && typeof obj.original === "string" && typeof obj.replacement === "string" && (obj.reason === void 0 || typeof obj.reason === "string");
}
function isPracticePayload(value) {
  if (!value || typeof value !== "object") return false;
  const obj = value;
  if (obj.kind === "question") {
    return typeof obj.concept === "string" && typeof obj.question === "string" && (obj.hint === void 0 || typeof obj.hint === "string");
  }
  if (obj.kind === "evaluation") {
    return typeof obj.concept === "string" && (obj.outcome === "correct" || obj.outcome === "partial" || obj.outcome === "incorrect") && typeof obj.feedback === "string" && Array.isArray(obj.misconceptions) && obj.misconceptions.every((item) => typeof item === "string") && (obj.nextQuestion === void 0 || typeof obj.nextQuestion === "string");
  }
  return false;
}
function findStart(buffer) {
  let best;
  for (const candidate of START_TAGS) {
    const index = buffer.indexOf(candidate.marker);
    if (index < 0) continue;
    if (!best || index < best.index) {
      best = {
        ...candidate,
        index
      };
    }
  }
  return best;
}
var StructuredStreamParser = class {
  constructor() {
    this.buffer = "";
    this.mode = "text";
  }
  push(chunk) {
    this.buffer += chunk;
    return this.drain(false);
  }
  finish() {
    return this.drain(true);
  }
  drain(final) {
    const events = [];
    while (this.buffer.length > 0) {
      if (this.mode === "text") {
        const start = findStart(this.buffer);
        if (start) {
          const visible = this.buffer.slice(0, start.index);
          if (visible) {
            events.push({
              type: "text",
              text: visible
            });
          }
          this.buffer = this.buffer.slice(
            start.index + start.marker.length
          );
          this.mode = start.kind;
          continue;
        }
        if (final) {
          events.push({
            type: "text",
            text: this.buffer
          });
          this.buffer = "";
          break;
        }
        const keep = Math.min(
          MAX_MARKER_LENGTH - 1,
          this.buffer.length
        );
        const emitLength = this.buffer.length - keep;
        if (emitLength > 0) {
          events.push({
            type: "text",
            text: this.buffer.slice(0, emitLength)
          });
          this.buffer = this.buffer.slice(emitLength);
        }
        break;
      }
      const end = this.buffer.indexOf(END_TAG);
      if (end < 0) {
        if (final) {
          events.push({
            type: "error",
            message: `Incomplete ${this.mode} block returned by the agent.`
          });
          this.buffer = "";
          this.mode = "text";
        }
        break;
      }
      const raw = this.buffer.slice(0, end).trim();
      const blockKind = this.mode;
      this.buffer = this.buffer.slice(end + END_TAG.length);
      this.mode = "text";
      let parsed;
      try {
        parsed = JSON.parse(raw);
      } catch (e) {
        events.push({
          type: "error",
          message: `Could not parse ${blockKind} returned by the agent.`
        });
        continue;
      }
      if (blockKind === "edit-proposal") {
        if (!isEditProposal(parsed)) {
          events.push({
            type: "error",
            message: "Agent returned an invalid edit proposal."
          });
          continue;
        }
        events.push({
          type: "proposal",
          proposal: parsed
        });
        continue;
      }
      if (!isPracticePayload(parsed)) {
        events.push({
          type: "error",
          message: "Agent returned an invalid practice payload."
        });
        continue;
      }
      if (parsed.kind === "question") {
        events.push({
          type: "practice-question",
          question: parsed
        });
      } else {
        events.push({
          type: "practice-evaluation",
          evaluation: parsed
        });
      }
    }
    return events;
  }
};

// src/learning/LearningController.ts
var LearningController = class {
  constructor(sessions, contexts, policies, mutations, learningState) {
    this.sessions = sessions;
    this.contexts = contexts;
    this.policies = policies;
    this.mutations = mutations;
    this.learningState = learningState;
    this.practiceSession = null;
  }
  async ping() {
    return this.sessions.ping();
  }
  getSession() {
    return this.sessions.getSession();
  }
  getModels() {
    return this.sessions.getModels();
  }
  setModel(modelId) {
    this.sessions.setModel(modelId);
  }
  async newSession() {
    this.practiceSession = null;
    return this.sessions.newSession();
  }
  async resolveContext(explicitContext = []) {
    return this.contexts.resolve(explicitContext);
  }
  async *run(request) {
    const context = await this.contexts.resolve(request.explicitContext);
    yield {
      type: "context-ready",
      context
    };
    const [policy, state] = await Promise.all([
      this.policies.load(),
      this.learningState.load()
    ]);
    const agentContext = this.contexts.toAgentContext(context);
    if (policy.rawInstructions) {
      const alreadyIncluded = agentContext.some(
        (item) => item.type === "note" && item.file === policy.path
      );
      if (!alreadyIncluded) {
        agentContext.push({
          type: "note",
          file: policy.path,
          content: policy.rawInstructions
        });
      }
    }
    agentContext.push({
      type: "note",
      file: "00-learning-os/progress.json",
      content: JSON.stringify(state, null, 2)
    });
    let preparedPrompt;
    if (request.action === "practice") {
      const activePractice = this.practiceSession;
      if ((activePractice == null ? void 0 : activePractice.state) === "waiting-answer" && activePractice.currentQuestion) {
        activePractice.state = "evaluating";
        preparedPrompt = buildPracticeEvaluationInstruction({
          question: activePractice.currentQuestion,
          answer: request.prompt,
          concept: activePractice.concept
        });
      } else {
        this.practiceSession = {
          id: crypto.randomUUID(),
          state: "generating",
          turns: []
        };
        preparedPrompt = buildPracticeQuestionInstruction(
          request.prompt
        );
      }
    } else {
      this.practiceSession = null;
      const instruction = buildActionInstruction(request.action);
      preparedPrompt = `${instruction}

User request:
${request.prompt}`;
    }
    const parser = new StructuredStreamParser();
    for await (const event of this.sessions.sendTurn(
      preparedPrompt,
      agentContext,
      request.prompt
    )) {
      if (event.type === "text") {
        for await (const mapped of this.mapStructuredEvents(
          parser.push(event.content),
          request,
          context
        )) {
          yield mapped;
        }
        continue;
      }
      if (event.type === "done") {
        for await (const mapped of this.mapStructuredEvents(
          parser.finish(),
          request,
          context
        )) {
          yield mapped;
        }
        yield { type: "completed" };
        continue;
      }
      if (event.type === "error") {
        yield {
          type: "error",
          message: event.error
        };
      }
    }
  }
  applyProposal(proposal) {
    return this.mutations.apply(proposal);
  }
  cancel() {
    this.sessions.cancel();
  }
  dispose() {
    this.sessions.destroy();
  }
  async *mapStructuredEvents(events, request, context) {
    var _a, _b, _c, _d, _e;
    for (const event of events) {
      if (event.type === "text") {
        if (event.text) {
          yield {
            type: "response-delta",
            text: event.text
          };
        }
        continue;
      }
      if (event.type === "proposal") {
        yield {
          type: "mutation-proposed",
          proposal: event.proposal
        };
        continue;
      }
      if (event.type === "practice-question") {
        this.acceptPracticeQuestion(event.question);
        yield {
          type: "practice-question",
          question: event.question
        };
        continue;
      }
      if (event.type === "practice-evaluation") {
        const evaluation = event.evaluation;
        this.acceptPracticeEvaluation(
          evaluation,
          request.prompt
        );
        yield {
          type: "practice-evaluation",
          evaluation
        };
        const source = (_d = (_c = (_a = context.selection) == null ? void 0 : _a.file) != null ? _c : (_b = context.activeNote) == null ? void 0 : _b.path) != null ? _d : "learning-session";
        const state = await this.learningState.recordPracticeEvaluation({
          evaluation,
          source
        });
        yield {
          type: "learning-state-updated",
          state
        };
        if ((_e = evaluation.nextQuestion) == null ? void 0 : _e.trim()) {
          const next = {
            kind: "question",
            concept: evaluation.concept,
            question: evaluation.nextQuestion.trim()
          };
          this.acceptPracticeQuestion(next);
          yield {
            type: "practice-question",
            question: next
          };
        }
        continue;
      }
      yield {
        type: "error",
        message: event.message
      };
    }
  }
  acceptPracticeQuestion(question) {
    if (!this.practiceSession) {
      this.practiceSession = {
        id: crypto.randomUUID(),
        state: "generating",
        turns: []
      };
    }
    this.practiceSession.concept = question.concept;
    this.practiceSession.currentQuestion = question.question;
    this.practiceSession.state = "waiting-answer";
    const current = this.practiceSession.turns[this.practiceSession.turns.length - 1];
    if (current && !current.answer && current.question === question.question) {
      return;
    }
    this.practiceSession.turns.push({
      id: crypto.randomUUID(),
      concept: question.concept,
      question: question.question
    });
  }
  acceptPracticeEvaluation(evaluation, answer) {
    var _a;
    if (!this.practiceSession) return;
    const current = this.practiceSession.turns[this.practiceSession.turns.length - 1];
    if (current) {
      current.answer = answer;
      current.evaluation = evaluation;
    }
    this.practiceSession.concept = evaluation.concept;
    if ((_a = evaluation.nextQuestion) == null ? void 0 : _a.trim()) {
      this.practiceSession.state = "waiting-answer";
      this.practiceSession.currentQuestion = evaluation.nextQuestion.trim();
    } else {
      this.practiceSession.state = "complete";
      this.practiceSession.currentQuestion = void 0;
    }
  }
};

// src/mutation/MutationService.ts
var import_obsidian4 = require("obsidian");
function findOccurrences(content, needle) {
  if (!needle) return [];
  const matches = [];
  let cursor = 0;
  while (cursor <= content.length - needle.length) {
    const index = content.indexOf(needle, cursor);
    if (index === -1) break;
    matches.push(index);
    cursor = index + needle.length;
  }
  return matches;
}
var MutationService = class {
  constructor(app) {
    this.app = app;
  }
  async apply(proposal) {
    const file = this.app.vault.getFileByPath(proposal.file);
    if (!file || !(file instanceof import_obsidian4.TFile)) {
      return {
        ok: false,
        reason: "missing-file",
        message: `Target note not found: ${proposal.file}`
      };
    }
    try {
      const activeFile = this.app.workspace.getActiveFile();
      const activeView = this.app.workspace.getActiveViewOfType(import_obsidian4.MarkdownView);
      if ((activeFile == null ? void 0 : activeFile.path) === file.path && (activeView == null ? void 0 : activeView.editor)) {
        const editor = activeView.editor;
        const content2 = editor.getValue();
        const matches2 = findOccurrences(content2, proposal.original);
        if (matches2.length === 0) {
          return {
            ok: false,
            reason: "stale",
            message: "Note changed since the proposal was made. Regenerate the edit."
          };
        }
        if (matches2.length > 1) {
          return {
            ok: false,
            reason: "ambiguous",
            message: "The original text occurs more than once. Regenerate with a more specific selection."
          };
        }
        const index2 = matches2[0];
        const from = editor.offsetToPos(index2);
        const to = editor.offsetToPos(index2 + proposal.original.length);
        editor.replaceRange(proposal.replacement, from, to);
        return { ok: true };
      }
      const content = await this.app.vault.cachedRead(file);
      const matches = findOccurrences(content, proposal.original);
      if (matches.length === 0) {
        return {
          ok: false,
          reason: "stale",
          message: "Note changed since the proposal was made. Regenerate the edit."
        };
      }
      if (matches.length > 1) {
        return {
          ok: false,
          reason: "ambiguous",
          message: "The original text occurs more than once. Regenerate with a more specific selection."
        };
      }
      const index = matches[0];
      const next = content.slice(0, index) + proposal.replacement + content.slice(index + proposal.original.length);
      await this.app.vault.modify(file, next);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: "error",
        message: err instanceof Error ? err.message : String(err)
      };
    }
  }
};

// src/persistence/VaultLearningStore.ts
var import_obsidian5 = require("obsidian");

// src/learning/learning-state.ts
var DEFAULT_LEARNING_STATE = {
  version: 1,
  target: "Backend Software Engineer",
  gaps: [],
  evidence: []
};

// src/persistence/VaultLearningStore.ts
var ROOT = "00-learning-os";
var PROGRESS_PATH = `${ROOT}/progress.json`;
function cloneDefaultState() {
  return {
    ...DEFAULT_LEARNING_STATE,
    gaps: [],
    evidence: []
  };
}
function isLearningState(value) {
  if (!value || typeof value !== "object") return false;
  const obj = value;
  return obj.version === 1 && typeof obj.target === "string" && Array.isArray(obj.gaps) && Array.isArray(obj.evidence);
}
function normalize(value) {
  return value.trim().toLowerCase();
}
var VaultLearningStore = class {
  constructor(app) {
    this.app = app;
  }
  async load() {
    const file = this.app.vault.getFileByPath(PROGRESS_PATH);
    if (!file || !(file instanceof import_obsidian5.TFile)) {
      return cloneDefaultState();
    }
    const raw = await this.app.vault.cachedRead(file);
    let parsed;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      throw new Error(
        `Learning state is invalid JSON: ${PROGRESS_PATH}`
      );
    }
    if (!isLearningState(parsed)) {
      throw new Error(
        `Learning state has an unsupported shape: ${PROGRESS_PATH}`
      );
    }
    return parsed;
  }
  async save(state) {
    await this.ensureRoot();
    const content = JSON.stringify(state, null, 2) + "\n";
    const file = this.app.vault.getFileByPath(PROGRESS_PATH);
    if (file && file instanceof import_obsidian5.TFile) {
      await this.app.vault.modify(file, content);
      return;
    }
    await this.app.vault.create(PROGRESS_PATH, content);
  }
  async recordPracticeEvaluation(input) {
    const state = await this.load();
    const evidence = {
      id: crypto.randomUUID(),
      type: "practice",
      concept: input.evaluation.concept,
      source: input.source,
      outcome: input.evaluation.outcome,
      createdAt: Date.now()
    };
    state.evidence.push(evidence);
    state.currentTopic = input.evaluation.concept;
    for (const misconception of input.evaluation.misconceptions) {
      const existing = state.gaps.find(
        (gap) => normalize(gap.concept) === normalize(input.evaluation.concept) && normalize(gap.reason) === normalize(misconception)
      );
      if (existing) {
        if (!existing.evidenceIds.includes(evidence.id)) {
          existing.evidenceIds.push(evidence.id);
        }
        existing.status = "open";
      } else {
        state.gaps.push({
          id: crypto.randomUUID(),
          concept: input.evaluation.concept,
          reason: misconception,
          evidenceIds: [evidence.id],
          status: "open"
        });
      }
    }
    if (input.evaluation.outcome === "correct" && input.evaluation.misconceptions.length === 0) {
      for (const gap of state.gaps) {
        if (normalize(gap.concept) === normalize(input.evaluation.concept) && gap.status === "open") {
          gap.status = "improving";
          gap.evidenceIds.push(evidence.id);
        }
      }
    }
    await this.save(state);
    return state;
  }
  async ensureRoot() {
    const existing = this.app.vault.getAbstractFileByPath(ROOT);
    if (existing) return;
    await this.app.vault.createFolder(ROOT);
  }
};

// src/session/SessionController.ts
var SessionController = class {
  constructor(plugin, store, adapter) {
    this.plugin = plugin;
    this.store = store;
    this.adapter = adapter;
    this.currentSession = null;
    this.models = [];
  }
  async init() {
    const data = await this.plugin.loadData();
    await this.store.load(data);
    this.currentSession = this.store.getCurrentSession();
    if (!this.currentSession) {
      this.currentSession = this.store.createSession(this.store.getDefaultModel());
    }
    this.adapter.listModels().then((models) => {
      this.models = models;
    }).catch(() => {
    });
  }
  ping() {
    return this.adapter.ping();
  }
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
      this.store.updateSession(this.currentSession);
      void this.save();
    }
  }
  getModels() {
    return this.models;
  }
  /**
   * Execute one prepared agent turn.
   *
   * Context is already resolved by LearningController. displayPrompt is the raw
   * user text stored in local history so internal learning instructions do not
   * leak into the visible/session transcript.
   */
  async *sendTurn(prompt, context = [], displayPrompt = prompt) {
    const session = this.getSession();
    const input = { prompt, context };
    session.messages.push({
      role: "user",
      content: displayPrompt
    });
    let fullText = "";
    for await (const event of this.adapter.send(input, {
      model: session.model,
      conversationId: session.conversationId
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
        content: fullText
      });
    }
    this.store.updateSession(session);
    await this.save();
  }
  cancel() {
    this.adapter.abort();
  }
  destroy() {
    this.adapter.abort();
  }
  async save() {
    await this.plugin.saveData(this.store.serialize());
  }
};

// src/session/SessionStore.ts
var STORE_KEY = "forge-sessions";
var LEGACY_STORE_KEY = "agy-sessions";
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
    var _a;
    const stored = (_a = rawData == null ? void 0 : rawData[STORE_KEY]) != null ? _a : rawData == null ? void 0 : rawData[LEGACY_STORE_KEY];
    if (stored) {
      this.data = stored;
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

// src/main.ts
var ForgePlugin = class extends import_obsidian6.Plugin {
  async onload() {
    const vaultAdapter = this.app.vault.adapter;
    const vaultPath = vaultAdapter instanceof import_obsidian6.FileSystemAdapter ? vaultAdapter.getBasePath() : void 0;
    const adapter = new AgyAdapter(vaultPath);
    const sessionStore = new SessionStore();
    const sessions = new SessionController(
      this,
      sessionStore,
      adapter
    );
    await sessions.init();
    const obsidianContext = new ObsidianContext(this.app);
    const contexts = new ContextResolver(obsidianContext);
    const policies = new PolicyLoader(this.app);
    const mutations = new MutationService(this.app);
    const learningState = new VaultLearningStore(this.app);
    this.learning = new LearningController(
      sessions,
      contexts,
      policies,
      mutations,
      learningState
    );
    this.registerView(
      FORGE_VIEW_TYPE,
      (leaf) => new ChatView(leaf, this.learning)
    );
    this.addRibbonIcon(
      "sparkles",
      "Open Forge",
      () => this.activateView()
    );
    this.addCommand({
      id: "open-forge-sidebar",
      name: "Open Forge sidebar",
      callback: () => this.activateView()
    });
    this.addCommand({
      id: "focus-forge-composer",
      name: "Focus Forge composer",
      hotkeys: [{ modifiers: ["Mod"], key: "l" }],
      callback: async () => {
        await this.activateView();
        setTimeout(() => {
          var _a, _b, _c;
          const leaves = this.app.workspace.getLeavesOfType(FORGE_VIEW_TYPE);
          const view = (_a = leaves[0]) == null ? void 0 : _a.view;
          (_c = (_b = view == null ? void 0 : view.input) == null ? void 0 : _b.focus) == null ? void 0 : _c.call(_b);
        }, 100);
      }
    });
  }
  async onunload() {
    var _a;
    this.app.workspace.detachLeavesOfType(FORGE_VIEW_TYPE);
    (_a = this.learning) == null ? void 0 : _a.dispose();
  }
  async activateView() {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(FORGE_VIEW_TYPE);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({
      type: FORGE_VIEW_TYPE,
      active: true
    });
    workspace.revealLeaf(leaf);
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2FnZW50L0FneUFkYXB0ZXIudHMiLCAic3JjL2NoYXQvQ2hhdFZpZXcudHMiLCAic3JjL2NvbnRleHQvQ29udGV4dFJlc29sdmVyLnRzIiwgInNyYy9jb250ZXh0L09ic2lkaWFuQ29udGV4dC50cyIsICJzcmMvY29udGV4dC9Qb2xpY3lMb2FkZXIudHMiLCAic3JjL2xlYXJuaW5nL2FjdGlvbi1idWlsZGVycy50cyIsICJzcmMvbGVhcm5pbmcvU3RydWN0dXJlZFN0cmVhbVBhcnNlci50cyIsICJzcmMvbGVhcm5pbmcvTGVhcm5pbmdDb250cm9sbGVyLnRzIiwgInNyYy9tdXRhdGlvbi9NdXRhdGlvblNlcnZpY2UudHMiLCAic3JjL3BlcnNpc3RlbmNlL1ZhdWx0TGVhcm5pbmdTdG9yZS50cyIsICJzcmMvbGVhcm5pbmcvbGVhcm5pbmctc3RhdGUudHMiLCAic3JjL3Nlc3Npb24vU2Vzc2lvbkNvbnRyb2xsZXIudHMiLCAic3JjL3Nlc3Npb24vU2Vzc2lvblN0b3JlLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgeyBGaWxlU3lzdGVtQWRhcHRlciwgUGx1Z2luIH0gZnJvbSBcIm9ic2lkaWFuXCI7XHJcbmltcG9ydCB7IEFneUFkYXB0ZXIgfSBmcm9tIFwiLi9hZ2VudC9BZ3lBZGFwdGVyXCI7XHJcbmltcG9ydCB7IENoYXRWaWV3LCBGT1JHRV9WSUVXX1RZUEUgfSBmcm9tIFwiLi9jaGF0L0NoYXRWaWV3XCI7XG5pbXBvcnQgeyBDb250ZXh0UmVzb2x2ZXIgfSBmcm9tIFwiLi9jb250ZXh0L0NvbnRleHRSZXNvbHZlclwiO1xyXG5pbXBvcnQgeyBPYnNpZGlhbkNvbnRleHQgfSBmcm9tIFwiLi9jb250ZXh0L09ic2lkaWFuQ29udGV4dFwiO1xyXG5pbXBvcnQgeyBQb2xpY3lMb2FkZXIgfSBmcm9tIFwiLi9jb250ZXh0L1BvbGljeUxvYWRlclwiO1xyXG5pbXBvcnQgeyBMZWFybmluZ0NvbnRyb2xsZXIgfSBmcm9tIFwiLi9sZWFybmluZy9MZWFybmluZ0NvbnRyb2xsZXJcIjtcclxuaW1wb3J0IHsgTXV0YXRpb25TZXJ2aWNlIH0gZnJvbSBcIi4vbXV0YXRpb24vTXV0YXRpb25TZXJ2aWNlXCI7XHJcbmltcG9ydCB7IFZhdWx0TGVhcm5pbmdTdG9yZSB9IGZyb20gXCIuL3BlcnNpc3RlbmNlL1ZhdWx0TGVhcm5pbmdTdG9yZVwiO1xyXG5pbXBvcnQgeyBTZXNzaW9uQ29udHJvbGxlciB9IGZyb20gXCIuL3Nlc3Npb24vU2Vzc2lvbkNvbnRyb2xsZXJcIjtcclxuaW1wb3J0IHsgU2Vzc2lvblN0b3JlIH0gZnJvbSBcIi4vc2Vzc2lvbi9TZXNzaW9uU3RvcmVcIjtcclxuXHJcbi8qKlxyXG4gKiBDb21wb3NpdGlvbiByb290LlxyXG4gKlxyXG4gKiBCdXNpbmVzcyBiZWhhdmlvciBiZWxvbmdzIGluIExlYXJuaW5nQ29udHJvbGxlci9zZXJ2aWNlczsgdGhpcyBmaWxlIG9ubHlcclxuICogY29uc3RydWN0cyBkZXBlbmRlbmNpZXMsIHJlZ2lzdGVycyBPYnNpZGlhbiBzdXJmYWNlcywgYW5kIGRpc3Bvc2VzIHJ1bnRpbWVcclxuICogcmVzb3VyY2VzLlxyXG4gKi9cclxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRm9yZ2VQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBwcml2YXRlIGxlYXJuaW5nITogTGVhcm5pbmdDb250cm9sbGVyO1xyXG5cclxuICBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCB2YXVsdEFkYXB0ZXIgPSB0aGlzLmFwcC52YXVsdC5hZGFwdGVyO1xyXG4gICAgY29uc3QgdmF1bHRQYXRoID1cclxuICAgICAgdmF1bHRBZGFwdGVyIGluc3RhbmNlb2YgRmlsZVN5c3RlbUFkYXB0ZXJcclxuICAgICAgICA/IHZhdWx0QWRhcHRlci5nZXRCYXNlUGF0aCgpXHJcbiAgICAgICAgOiB1bmRlZmluZWQ7XHJcblxyXG4gICAgY29uc3QgYWRhcHRlciA9IG5ldyBBZ3lBZGFwdGVyKHZhdWx0UGF0aCk7XHJcbiAgICBjb25zdCBzZXNzaW9uU3RvcmUgPSBuZXcgU2Vzc2lvblN0b3JlKCk7XHJcbiAgICBjb25zdCBzZXNzaW9ucyA9IG5ldyBTZXNzaW9uQ29udHJvbGxlcihcclxuICAgICAgdGhpcyxcclxuICAgICAgc2Vzc2lvblN0b3JlLFxyXG4gICAgICBhZGFwdGVyLFxyXG4gICAgKTtcclxuXHJcbiAgICBhd2FpdCBzZXNzaW9ucy5pbml0KCk7XHJcblxyXG4gICAgY29uc3Qgb2JzaWRpYW5Db250ZXh0ID0gbmV3IE9ic2lkaWFuQ29udGV4dCh0aGlzLmFwcCk7XHJcbiAgICBjb25zdCBjb250ZXh0cyA9IG5ldyBDb250ZXh0UmVzb2x2ZXIob2JzaWRpYW5Db250ZXh0KTtcclxuICAgIGNvbnN0IHBvbGljaWVzID0gbmV3IFBvbGljeUxvYWRlcih0aGlzLmFwcCk7XHJcbiAgICBjb25zdCBtdXRhdGlvbnMgPSBuZXcgTXV0YXRpb25TZXJ2aWNlKHRoaXMuYXBwKTtcclxuICAgIGNvbnN0IGxlYXJuaW5nU3RhdGUgPSBuZXcgVmF1bHRMZWFybmluZ1N0b3JlKHRoaXMuYXBwKTtcclxuXHJcbiAgICB0aGlzLmxlYXJuaW5nID0gbmV3IExlYXJuaW5nQ29udHJvbGxlcihcclxuICAgICAgc2Vzc2lvbnMsXHJcbiAgICAgIGNvbnRleHRzLFxyXG4gICAgICBwb2xpY2llcyxcclxuICAgICAgbXV0YXRpb25zLFxyXG4gICAgICBsZWFybmluZ1N0YXRlLFxyXG4gICAgKTtcclxuXHJcbiAgICB0aGlzLnJlZ2lzdGVyVmlldyhcclxuICAgICAgRk9SR0VfVklFV19UWVBFLFxuICAgICAgKGxlYWYpID0+IG5ldyBDaGF0VmlldyhsZWFmLCB0aGlzLmxlYXJuaW5nKSxcclxuICAgICk7XHJcblxyXG4gICAgdGhpcy5hZGRSaWJib25JY29uKFxuICAgICAgXCJzcGFya2xlc1wiLFxuICAgICAgXCJPcGVuIEZvcmdlXCIsXG4gICAgICAoKSA9PiB0aGlzLmFjdGl2YXRlVmlldygpLFxuICAgICk7XHJcblxyXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcclxuICAgICAgaWQ6IFwib3Blbi1mb3JnZS1zaWRlYmFyXCIsXG4gICAgICBuYW1lOiBcIk9wZW4gRm9yZ2Ugc2lkZWJhclwiLFxuICAgICAgY2FsbGJhY2s6ICgpID0+IHRoaXMuYWN0aXZhdGVWaWV3KCksXHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xyXG4gICAgICBpZDogXCJmb2N1cy1mb3JnZS1jb21wb3NlclwiLFxuICAgICAgbmFtZTogXCJGb2N1cyBGb3JnZSBjb21wb3NlclwiLFxuICAgICAgaG90a2V5czogW3sgbW9kaWZpZXJzOiBbXCJNb2RcIl0sIGtleTogXCJsXCIgfV0sXHJcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5hY3RpdmF0ZVZpZXcoKTtcclxuXHJcbiAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICBjb25zdCBsZWF2ZXMgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKEZPUkdFX1ZJRVdfVFlQRSk7XG4gICAgICAgICAgY29uc3QgdmlldyA9IGxlYXZlc1swXT8udmlldyBhcyBDaGF0VmlldyB8IHVuZGVmaW5lZDtcclxuICAgICAgICAgICh2aWV3IGFzIGFueSk/LmlucHV0Py5mb2N1cz8uKCk7XHJcbiAgICAgICAgfSwgMTAwKTtcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgb251bmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICB0aGlzLmFwcC53b3Jrc3BhY2UuZGV0YWNoTGVhdmVzT2ZUeXBlKEZPUkdFX1ZJRVdfVFlQRSk7XG4gICAgdGhpcy5sZWFybmluZz8uZGlzcG9zZSgpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBhY3RpdmF0ZVZpZXcoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCB7IHdvcmtzcGFjZSB9ID0gdGhpcy5hcHA7XHJcbiAgICBjb25zdCBleGlzdGluZyA9IHdvcmtzcGFjZS5nZXRMZWF2ZXNPZlR5cGUoRk9SR0VfVklFV19UWVBFKTtcblxyXG4gICAgaWYgKGV4aXN0aW5nLmxlbmd0aCA+IDApIHtcclxuICAgICAgd29ya3NwYWNlLnJldmVhbExlYWYoZXhpc3RpbmdbMF0pO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgbGVhZiA9IHdvcmtzcGFjZS5nZXRSaWdodExlYWYoZmFsc2UpO1xyXG4gICAgaWYgKCFsZWFmKSByZXR1cm47XHJcblxyXG4gICAgYXdhaXQgbGVhZi5zZXRWaWV3U3RhdGUoe1xyXG4gICAgICB0eXBlOiBGT1JHRV9WSUVXX1RZUEUsXG4gICAgICBhY3RpdmU6IHRydWUsXHJcbiAgICB9KTtcclxuICAgIHdvcmtzcGFjZS5yZXZlYWxMZWFmKGxlYWYpO1xyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgQ2hpbGRQcm9jZXNzLCBzcGF3biB9IGZyb20gXCJjaGlsZF9wcm9jZXNzXCI7XHJcbmltcG9ydCB7IGV4aXN0c1N5bmMgfSBmcm9tIFwiZnNcIjtcclxuaW1wb3J0IHsgaG9tZWRpciB9IGZyb20gXCJvc1wiO1xyXG5pbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcclxuaW1wb3J0IHtcclxuICBBZ2VudEFkYXB0ZXIsXHJcbiAgQWdlbnRJbnB1dCxcclxuICBBZ2VudENvbnRleHQsXHJcbiAgQWdlbnRTdHJlYW1FdmVudCxcbiAgQWdlbnRNb2RlbCxcbiAgU2VuZE9wdGlvbnMsXHJcbn0gZnJvbSBcIi4uL3R5cGVzXCI7XHJcblxyXG5mdW5jdGlvbiBlc2NhcGVBdHRyaWJ1dGUodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgcmV0dXJuIHZhbHVlXHJcbiAgICAucmVwbGFjZSgvJi9nLCBcIiZhbXA7XCIpXHJcbiAgICAucmVwbGFjZSgvXCIvZywgXCImcXVvdDtcIilcclxuICAgIC5yZXBsYWNlKC88L2csIFwiJmx0O1wiKVxyXG4gICAgLnJlcGxhY2UoLz4vZywgXCImZ3Q7XCIpO1xyXG59XHJcblxyXG4vLyBBR1kgcHJpbnQtbW9kZSBwcm90b2NvbCB1c2VkIGJ5IHRoaXMgYWRhcHRlcjpcclxuLy9cclxuLy8gICBhZ3kgLS1wcmludCA8cHJvbXB0PiAtLW91dHB1dC1mb3JtYXQgc3RyZWFtLWpzb24gWy0tbW9kZWwgPGlkPl1cclxuLy8gICAgICAgWy0tY29udmVyc2F0aW9uIDxpZD5dXHJcbi8vXHJcbi8vIHN0ZG91dCBpcyBOREpTT046XHJcbi8vICAge1wiZXZlbnRcIjpcImluaXRcIiwgLi4ufVxyXG4vLyAgIHtcImV2ZW50XCI6XCJzdGVwX3VwZGF0ZVwiLFwic3RlcF91cGRhdGVcIjp7XCJzdGVwX3R5cGVcIjpcImFnZW50X3Jlc3BvbnNlXCIsXCJ0ZXh0X2RlbHRhXCI6XCIuLi5cIn19XHJcbi8vICAge1wiZXZlbnRcIjpcInJlc3VsdFwiLFwicmVzdWx0XCI6e1wic3RhdHVzXCI6XCJTVUNDRVNTfEVSUk9SfC4uLlwiLFwicmVzcG9uc2VcIjpcIi4uLlwiLFwiZXJyb3JcIjpcIi4uLlwifX1cclxuLy9cclxuLy8gRWFjaCBzZW5kKCkgc3RhcnRzIG9uZSBwcmludC1tb2RlIHByb2Nlc3MuIENvbnZlcnNhdGlvbiBjb250aW51aXR5IGlzIHJlc3RvcmVkXHJcbi8vIHdpdGggLS1jb252ZXJzYXRpb24gPGlkPi4gVGhlIFVJIG9ubHkgc2VlcyBub3JtYWxpemVkIEFnZW50U3RyZWFtRXZlbnQgdmFsdWVzLlxuXHJcbmV4cG9ydCBjbGFzcyBBZ3lBZGFwdGVyIGltcGxlbWVudHMgQWdlbnRBZGFwdGVyIHtcclxuICBwcml2YXRlIHByb2M6IENoaWxkUHJvY2VzcyB8IG51bGwgPSBudWxsO1xyXG5cclxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGN3ZD86IHN0cmluZykge31cclxuXHJcbiAgLy8gXHUyNTAwXHUyNTAwIGJpbmFyeSByZXNvbHV0aW9uIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuICBhc3luYyBwaW5nKCk6IFByb21pc2U8c3RyaW5nPiB7XHJcbiAgICBjb25zdCBjb25maWd1cmVkID0gcHJvY2Vzcy5lbnYuQUdZX1BBVEg/LnRyaW0oKTtcclxuICAgIGNvbnN0IGNhbmRpZGF0ZXMgPSBbXHJcbiAgICAgIGNvbmZpZ3VyZWQsXHJcbiAgICAgIC4uLihwcm9jZXNzLnBsYXRmb3JtID09PSBcIndpbjMyXCJcclxuICAgICAgICA/IFtcclxuICAgICAgICAgICAgcHJvY2Vzcy5lbnYuTE9DQUxBUFBEQVRBXHJcbiAgICAgICAgICAgICAgPyBqb2luKHByb2Nlc3MuZW52LkxPQ0FMQVBQREFUQSwgXCJhZ3lcIiwgXCJiaW5cIiwgXCJhZ3kuZXhlXCIpXHJcbiAgICAgICAgICAgICAgOiB1bmRlZmluZWQsXHJcbiAgICAgICAgICAgIHByb2Nlc3MuZW52LlByb2dyYW1GaWxlc1xyXG4gICAgICAgICAgICAgID8gam9pbihwcm9jZXNzLmVudi5Qcm9ncmFtRmlsZXMsIFwiR29vZ2xlXCIsIFwiYW50aWdyYXZpdHktY2xpXCIsIFwiYWd5LmV4ZVwiKVxyXG4gICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxyXG4gICAgICAgICAgXVxyXG4gICAgICAgIDogW2pvaW4oaG9tZWRpcigpLCBcIi5sb2NhbFwiLCBcImJpblwiLCBcImFneVwiKV0pLFxyXG4gICAgXS5maWx0ZXIoKHZhbHVlKTogdmFsdWUgaXMgc3RyaW5nID0+IEJvb2xlYW4odmFsdWUpKTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBjYW5kaWRhdGVzKSB7XHJcbiAgICAgIGlmIChleGlzdHNTeW5jKGNhbmRpZGF0ZSkpIHJldHVybiBjYW5kaWRhdGU7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIG5ldyBQcm9taXNlKChyZXNvbHZlLCByZWplY3QpID0+IHtcclxuICAgICAgY29uc3QgbG9jYXRvciA9IHByb2Nlc3MucGxhdGZvcm0gPT09IFwid2luMzJcIiA/IFwid2hlcmVcIiA6IFwid2hpY2hcIjtcclxuICAgICAgY29uc3QgcCA9IHNwYXduKGxvY2F0b3IsIFtcImFneVwiXSk7XHJcbiAgICAgIGxldCBvdXQgPSBcIlwiO1xyXG4gICAgICBsZXQgc2V0dGxlZCA9IGZhbHNlO1xyXG5cclxuICAgICAgY29uc3QgZmFpbCA9ICgpID0+IHtcclxuICAgICAgICBpZiAoc2V0dGxlZCkgcmV0dXJuO1xyXG4gICAgICAgIHNldHRsZWQgPSB0cnVlO1xyXG4gICAgICAgIHJlamVjdChcclxuICAgICAgICAgIG5ldyBFcnJvcihcclxuICAgICAgICAgICAgXCJBR1kgQ0xJIG5vdCBmb3VuZC4gSW5zdGFsbCBpdCwgcmVzdGFydCBPYnNpZGlhbiBhZnRlciBjaGFuZ2luZyBQQVRILCBvciBzZXQgQUdZX1BBVEggdG8gdGhlIEFHWSBleGVjdXRhYmxlLlwiLFxyXG4gICAgICAgICAgKSxcclxuICAgICAgICApO1xyXG4gICAgICB9O1xyXG5cclxuICAgICAgcC5zdGRvdXQ/Lm9uKFwiZGF0YVwiLCAoZDogQnVmZmVyKSA9PiAob3V0ICs9IGQudG9TdHJpbmcoKSkpO1xyXG4gICAgICBwLm9uKFwiZXJyb3JcIiwgZmFpbCk7XHJcbiAgICAgIHAub24oXCJjbG9zZVwiLCAoY29kZSkgPT4ge1xyXG4gICAgICAgIGlmIChzZXR0bGVkKSByZXR1cm47XHJcbiAgICAgICAgaWYgKGNvZGUgPT09IDAgJiYgb3V0LnRyaW0oKSkge1xyXG4gICAgICAgICAgc2V0dGxlZCA9IHRydWU7XHJcbiAgICAgICAgICByZXNvbHZlKG91dC50cmltKCkuc3BsaXQoL1xccj9cXG4vKVswXSk7XHJcbiAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGZhaWwoKTtcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBzZW5kIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuICBhc3luYyAqc2VuZChpbnB1dDogQWdlbnRJbnB1dCwgb3B0czogU2VuZE9wdGlvbnMpOiBBc3luY0l0ZXJhYmxlPEFnZW50U3RyZWFtRXZlbnQ+IHtcbiAgICBjb25zdCBiaW4gPSBhd2FpdCB0aGlzLnBpbmcoKTtcclxuICAgIGNvbnN0IGZ1bGxQcm9tcHQgPSB0aGlzLmJ1aWxkRnVsbFByb21wdChpbnB1dCk7XHJcbiAgICBjb25zdCBhcmdzID0gdGhpcy5idWlsZEFyZ3MoZnVsbFByb21wdCwgb3B0cyk7XHJcblxyXG4gICAgY29uc3QgcHJvYyA9IHNwYXduKGJpbiwgYXJncywge1xyXG4gICAgICBjd2Q6IHRoaXMuY3dkLFxyXG4gICAgICBzdGRpbzogW1wiaWdub3JlXCIsIFwicGlwZVwiLCBcInBpcGVcIl0sXHJcbiAgICAgIHdpbmRvd3NIaWRlOiB0cnVlLFxyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5wcm9jID0gcHJvYztcclxuICAgIHByb2Mub25jZShcImNsb3NlXCIsICgpID0+IHtcclxuICAgICAgaWYgKHRoaXMucHJvYyA9PT0gcHJvYykgdGhpcy5wcm9jID0gbnVsbDtcclxuICAgIH0pO1xyXG5cclxuICAgIHlpZWxkKiB0aGlzLnJlYWRFdmVudHMocHJvYyk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGJ1aWxkQXJncyhwcm9tcHQ6IHN0cmluZywgb3B0czogU2VuZE9wdGlvbnMpOiBzdHJpbmdbXSB7XHJcbiAgICBjb25zdCBhcmdzID0gW1xyXG4gICAgICBcIi0tcHJpbnRcIixcclxuICAgICAgcHJvbXB0LFxyXG4gICAgICBcIi0tb3V0cHV0LWZvcm1hdFwiLFxyXG4gICAgICBcInN0cmVhbS1qc29uXCIsXHJcbiAgICAgIFwiLS1kYW5nZXJvdXNseS1za2lwLXBlcm1pc3Npb25zXCIsXHJcbiAgICBdO1xyXG5cclxuICAgIGlmIChvcHRzLm1vZGVsKSB7XHJcbiAgICAgIGFyZ3MucHVzaChcIi0tbW9kZWxcIiwgb3B0cy5tb2RlbCk7XHJcbiAgICB9XHJcbiAgICBpZiAob3B0cy5jb252ZXJzYXRpb25JZCkge1xyXG4gICAgICBhcmdzLnB1c2goXCItLWNvbnZlcnNhdGlvblwiLCBvcHRzLmNvbnZlcnNhdGlvbklkKTtcclxuICAgIH1cclxuICAgIHJldHVybiBhcmdzO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRm9ybWF0IEFnZW50SW5wdXQgd2l0aCBjb250ZXh0IGFzIGEgc3RydWN0dXJlZCBwcmVhbWJsZSBiZWZvcmUgcHJvbXB0LlxyXG4gICAqL1xyXG4gIHByaXZhdGUgYnVpbGRGdWxsUHJvbXB0KGlucHV0OiBBZ2VudElucHV0KTogc3RyaW5nIHtcclxuICAgIGNvbnN0IGNvbnRleHRQcmVhbWJsZSA9IHRoaXMuZm9ybWF0Q29udGV4dChpbnB1dC5jb250ZXh0KTtcclxuICAgIHJldHVybiBjb250ZXh0UHJlYW1ibGVcclxuICAgICAgPyBgJHtjb250ZXh0UHJlYW1ibGV9XFxuXFxuLS0tXFxuXFxuJHtpbnB1dC5wcm9tcHR9YFxyXG4gICAgICA6IGlucHV0LnByb21wdDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZm9ybWF0Q29udGV4dChjdHg6IEFnZW50Q29udGV4dFtdKTogc3RyaW5nIHtcclxuICAgIGlmIChjdHgubGVuZ3RoID09PSAwKSByZXR1cm4gXCJcIjtcclxuXHJcbiAgICByZXR1cm4gY3R4XHJcbiAgICAgIC5tYXAoKGMsIGluZGV4KSA9PiB7XHJcbiAgICAgICAgY29uc3QgdHlwZSA9IGMudHlwZSA9PT0gXCJzZWxlY3Rpb25cIiA/IFwic2VsZWN0aW9uXCIgOiBcIm5vdGVcIjtcclxuICAgICAgICBjb25zdCBoZWFkZXIgPSBgPG9ic2lkaWFuLWNvbnRleHQgaW5kZXg9XCIke2luZGV4ICsgMX1cIiB0eXBlPVwiJHt0eXBlfVwiIGZpbGU9XCIke2VzY2FwZUF0dHJpYnV0ZShjLmZpbGUpfVwiPmA7XHJcblxyXG4gICAgICAgIHJldHVybiBgJHtoZWFkZXJ9XFxuJHtjLmNvbnRlbnR9XFxuPC9vYnNpZGlhbi1jb250ZXh0PmA7XHJcbiAgICAgIH0pXHJcbiAgICAgIC5qb2luKFwiXFxuXFxuXCIpO1xyXG4gIH1cclxuXHJcbiAgLy8gXHUyNTAwXHUyNTAwIHN0ZG91dCByZWFkZXIgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4gIHByaXZhdGUgYXN5bmMgKnJlYWRFdmVudHMocHJvYzogQ2hpbGRQcm9jZXNzKTogQXN5bmNJdGVyYWJsZTxBZ2VudFN0cmVhbUV2ZW50PiB7XG4gICAgbGV0IGJ1ZmZlciA9IFwiXCI7XHJcbiAgICBsZXQgc3RkZXJyID0gXCJcIjtcclxuICAgIGxldCBleGl0Q29kZTogbnVtYmVyIHwgbnVsbCA9IG51bGw7XHJcbiAgICBjb25zdCBwcm9jZXNzU3RhdGU6IHsgc3Bhd25FcnJvcj86IEVycm9yIH0gPSB7fTtcclxuICAgIGxldCBjbG9zZWQgPSBmYWxzZTtcclxuICAgIGxldCBzYXdUZXJtaW5hbEV2ZW50ID0gZmFsc2U7XHJcblxyXG4gICAgY29uc3QgcXVldWU6IHN0cmluZ1tdID0gW107XHJcbiAgICBsZXQgbm90aWZ5OiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcclxuXHJcbiAgICBjb25zdCB3YWtlID0gKCkgPT4ge1xyXG4gICAgICBub3RpZnk/LigpO1xyXG4gICAgICBub3RpZnkgPSBudWxsO1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBwdXNoID0gKGxpbmU6IHN0cmluZykgPT4ge1xyXG4gICAgICBxdWV1ZS5wdXNoKGxpbmUpO1xyXG4gICAgICB3YWtlKCk7XHJcbiAgICB9O1xyXG5cclxuICAgIHByb2Muc3Rkb3V0Py5vbihcImRhdGFcIiwgKGNodW5rOiBCdWZmZXIpID0+IHtcclxuICAgICAgYnVmZmVyICs9IGNodW5rLnRvU3RyaW5nKCk7XHJcbiAgICAgIGNvbnN0IHBhcnRzID0gYnVmZmVyLnNwbGl0KC9cXHI/XFxuLyk7XHJcbiAgICAgIGJ1ZmZlciA9IHBhcnRzLnBvcCgpID8/IFwiXCI7XHJcblxyXG4gICAgICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcclxuICAgICAgICBjb25zdCBsaW5lID0gcGFydC50cmltKCk7XHJcbiAgICAgICAgaWYgKGxpbmUpIHB1c2gobGluZSk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIHByb2Muc3RkZXJyPy5vbihcImRhdGFcIiwgKGNodW5rOiBCdWZmZXIpID0+IHtcclxuICAgICAgY29uc3QgbXNnID0gY2h1bmsudG9TdHJpbmcoKTtcclxuICAgICAgc3RkZXJyICs9IG1zZztcclxuICAgICAgY29uc3QgdHJpbW1lZCA9IG1zZy50cmltKCk7XHJcbiAgICAgIGlmICh0cmltbWVkKSBjb25zb2xlLndhcm4oXCJbRm9yZ2UgYWdlbnQgcHJvdmlkZXJdXCIsIHRyaW1tZWQpO1xuICAgIH0pO1xyXG5cclxuICAgIHByb2Mub24oXCJlcnJvclwiLCAoZXJyKSA9PiB7XHJcbiAgICAgIHByb2Nlc3NTdGF0ZS5zcGF3bkVycm9yID0gZXJyO1xyXG4gICAgICB3YWtlKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBwcm9jLm9uKFwiY2xvc2VcIiwgKGNvZGUpID0+IHtcclxuICAgICAgZXhpdENvZGUgPSBjb2RlO1xyXG4gICAgICBjb25zdCBmaW5hbExpbmUgPSBidWZmZXIudHJpbSgpO1xyXG4gICAgICBidWZmZXIgPSBcIlwiO1xyXG4gICAgICBpZiAoZmluYWxMaW5lKSBxdWV1ZS5wdXNoKGZpbmFsTGluZSk7XHJcbiAgICAgIGNsb3NlZCA9IHRydWU7XHJcbiAgICAgIHdha2UoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIHdoaWxlICh0cnVlKSB7XHJcbiAgICAgIGlmIChxdWV1ZS5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgY29uc3QgbGluZSA9IHF1ZXVlLnNoaWZ0KCkhO1xyXG4gICAgICAgIGNvbnN0IGV2ZW50ID0gdGhpcy5wYXJzZUxpbmUobGluZSk7XHJcblxyXG4gICAgICAgIGlmICghZXZlbnQpIGNvbnRpbnVlO1xyXG5cclxuICAgICAgICB5aWVsZCBldmVudDtcclxuXHJcbiAgICAgICAgaWYgKGV2ZW50LnR5cGUgPT09IFwiZG9uZVwiIHx8IGV2ZW50LnR5cGUgPT09IFwiZXJyb3JcIikge1xyXG4gICAgICAgICAgc2F3VGVybWluYWxFdmVudCA9IHRydWU7XHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAoY2xvc2VkKSB7XHJcbiAgICAgICAgaWYgKCFzYXdUZXJtaW5hbEV2ZW50KSB7XHJcbiAgICAgICAgICBjb25zdCBkZXRhaWwgPVxyXG4gICAgICAgICAgICBwcm9jZXNzU3RhdGUuc3Bhd25FcnJvcj8ubWVzc2FnZSB8fFxyXG4gICAgICAgICAgICBzdGRlcnIudHJpbSgpIHx8XHJcbiAgICAgICAgICAgIChleGl0Q29kZSAhPT0gMFxyXG4gICAgICAgICAgICAgID8gYEFHWSBleGl0ZWQgd2l0aCBjb2RlICR7ZXhpdENvZGUgPz8gXCJ1bmtub3duXCJ9IGJlZm9yZSByZXR1cm5pbmcgYSByZXN1bHQuYFxyXG4gICAgICAgICAgICAgIDogXCJBR1kgZXhpdGVkIHdpdGhvdXQgcmV0dXJuaW5nIGEgcmVzdWx0LlwiKTtcclxuXHJcbiAgICAgICAgICB5aWVsZCB7IHR5cGU6IFwiZXJyb3JcIiwgZXJyb3I6IGRldGFpbCB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICBicmVhaztcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKHByb2Nlc3NTdGF0ZS5zcGF3bkVycm9yKSB7XHJcbiAgICAgICAgeWllbGQgeyB0eXBlOiBcImVycm9yXCIsIGVycm9yOiBwcm9jZXNzU3RhdGUuc3Bhd25FcnJvci5tZXNzYWdlIH07XHJcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlKSA9PiB7XHJcbiAgICAgICAgbm90aWZ5ID0gcmVzb2x2ZTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBQYXJzZSBvbmUgQUdZIE5ESlNPTiBsaW5lIGludG8gYSBub3JtYWxpemVkIGV2ZW50LlxyXG4gICAqL1xyXG4gIHByaXZhdGUgcGFyc2VMaW5lKGxpbmU6IHN0cmluZyk6IEFnZW50U3RyZWFtRXZlbnQgfCBudWxsIHtcbiAgICBsZXQgb2JqOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBvYmogPSBKU09OLnBhcnNlKGxpbmUpO1xyXG4gICAgfSBjYXRjaCB7XHJcbiAgICAgIC8vIHN0ZG91dCBzaG91bGQgYmUgbWFjaGluZS1yZWFkYWJsZSBpbiBzdHJlYW0tanNvbiBtb2RlLiBJZ25vcmUgYW5cclxuICAgICAgLy8gdW5leHBlY3RlZCBkaWFnbm9zdGljIGxpbmUgaGVyZTsgc3RkZXJyL2V4aXQgaGFuZGxpbmcgd2lsbCBzdGlsbFxyXG4gICAgICAvLyBzdXJmYWNlIGEgZmFpbGVkIHJ1biB0byB0aGUgVUkuXHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGV2ID0gb2JqW1wiZXZlbnRcIl0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xyXG5cclxuICAgIGlmIChldiA9PT0gXCJpbml0XCIpIHtcclxuICAgICAgY29uc3QgY29udklkID1cclxuICAgICAgICAob2JqW1wiY29udmVyc2F0aW9uX2lkXCJdIGFzIHN0cmluZyB8IHVuZGVmaW5lZCkgfHxcclxuICAgICAgICAoKG9ialtcImluaXRcIl0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQpPy5bXHJcbiAgICAgICAgICBcImNvbnZlcnNhdGlvbl9pZFwiXHJcbiAgICAgICAgXSBhcyBzdHJpbmcgfCB1bmRlZmluZWQpO1xyXG5cclxuICAgICAgaWYgKGNvbnZJZCkgdGhpcy5fbGFzdENvbnZlcnNhdGlvbklkID0gY29udklkO1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoZXYgPT09IFwic3RlcF91cGRhdGVcIikge1xyXG4gICAgICBjb25zdCBzdSA9IG9ialtcInN0ZXBfdXBkYXRlXCJdIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xyXG4gICAgICBjb25zdCBkZWx0YSA9IHN1Py5bXCJ0ZXh0X2RlbHRhXCJdIGFzIHN0cmluZyB8IHVuZGVmaW5lZDtcclxuXHJcbiAgICAgIGlmIChkZWx0YSkgcmV0dXJuIHsgdHlwZTogXCJ0ZXh0XCIsIGNvbnRlbnQ6IGRlbHRhIH07XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIC8vIENvbXBhdGliaWxpdHkgd2l0aCBvbGRlciBtb2Nrcy9wcm90b2NvbCBleHBlcmltZW50cy5cclxuICAgIGlmIChldiA9PT0gXCJ0ZXh0XCIpIHtcclxuICAgICAgY29uc3QgdGV4dCA9IG9ialtcInRleHRcIl0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xyXG4gICAgICBpZiAodGV4dCkgcmV0dXJuIHsgdHlwZTogXCJ0ZXh0XCIsIGNvbnRlbnQ6IHRleHQgfTtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGV2ID09PSBcInJlc3VsdFwiKSB7XHJcbiAgICAgIGNvbnN0IHJlc3VsdCA9IG9ialtcInJlc3VsdFwiXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcclxuICAgICAgY29uc3Qgc3RhdHVzID0gU3RyaW5nKHJlc3VsdD8uW1wic3RhdHVzXCJdID8/IFwiXCIpLnRvVXBwZXJDYXNlKCk7XHJcbiAgICAgIGNvbnN0IGNvbnZJZCA9XHJcbiAgICAgICAgKHJlc3VsdD8uW1wiY29udmVyc2F0aW9uX2lkXCJdIGFzIHN0cmluZyB8IHVuZGVmaW5lZCkgfHxcclxuICAgICAgICB0aGlzLl9sYXN0Q29udmVyc2F0aW9uSWQ7XHJcblxyXG4gICAgICBpZiAoY29udklkKSB0aGlzLl9sYXN0Q29udmVyc2F0aW9uSWQgPSBjb252SWQ7XHJcblxyXG4gICAgICAvLyBBR1kgcmVwb3J0cyBwcmludC1tb2RlIGZhaWx1cmVzIGluc2lkZSB0aGUgdGVybWluYWwgcmVzdWx0IGVudmVsb3BlLlxyXG4gICAgICAvLyBUcmVhdCBldmVyeSBleHBsaWNpdCBub24tU1VDQ0VTUyB0ZXJtaW5hbCBzdGF0ZSBhcyBhbiBlcnJvciBpbnN0ZWFkXHJcbiAgICAgIC8vIG9mIHNpbGVudGx5IGNvbnZlcnRpbmcgaXQgdG8gXCJkb25lXCIuXHJcbiAgICAgIGlmIChzdGF0dXMgJiYgc3RhdHVzICE9PSBcIlNVQ0NFU1NcIikge1xyXG4gICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBTdHJpbmcoXHJcbiAgICAgICAgICByZXN1bHQ/LltcImVycm9yXCJdID8/XHJcbiAgICAgICAgICAgIGBBR1kgZmluaXNoZWQgd2l0aCBzdGF0dXMgJHtzdGF0dXN9IHdpdGhvdXQgYW4gZXJyb3IgbWVzc2FnZS5gLFxyXG4gICAgICAgICk7XHJcblxyXG4gICAgICAgIHJldHVybiB7IHR5cGU6IFwiZXJyb3JcIiwgZXJyb3I6IG1lc3NhZ2UgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgcmV0dXJuIHsgdHlwZTogXCJkb25lXCIsIGNvbnZlcnNhdGlvbklkOiBjb252SWQgfTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoZXYgPT09IFwiZXJyb3JcIikge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHR5cGU6IFwiZXJyb3JcIixcclxuICAgICAgICBlcnJvcjogU3RyaW5nKG9ialtcImVycm9yXCJdID8/IFwiVW5rbm93biBBR1kgZXJyb3JcIiksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIG51bGw7XHJcbiAgfVxyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgbGlzdE1vZGVscyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbiAgYXN5bmMgbGlzdE1vZGVscygpOiBQcm9taXNlPEFnZW50TW9kZWxbXT4ge1xuICAgIGNvbnN0IGJpbiA9IGF3YWl0IHRoaXMucGluZygpO1xyXG5cclxuICAgIHJldHVybiBuZXcgUHJvbWlzZSgocmVzb2x2ZSwgcmVqZWN0KSA9PiB7XHJcbiAgICAgIGNvbnN0IHAgPSBzcGF3bihiaW4sIFtcIm1vZGVsc1wiXSwge1xyXG4gICAgICAgIGN3ZDogdGhpcy5jd2QsXHJcbiAgICAgICAgd2luZG93c0hpZGU6IHRydWUsXHJcbiAgICAgIH0pO1xyXG4gICAgICBsZXQgb3V0ID0gXCJcIjtcclxuICAgICAgbGV0IGVyciA9IFwiXCI7XHJcblxyXG4gICAgICBwLnN0ZG91dD8ub24oXCJkYXRhXCIsIChkOiBCdWZmZXIpID0+IChvdXQgKz0gZC50b1N0cmluZygpKSk7XHJcbiAgICAgIHAuc3RkZXJyPy5vbihcImRhdGFcIiwgKGQ6IEJ1ZmZlcikgPT4gKGVyciArPSBkLnRvU3RyaW5nKCkpKTtcclxuICAgICAgcC5vbihcImVycm9yXCIsIHJlamVjdCk7XHJcbiAgICAgIHAub24oXCJjbG9zZVwiLCAoY29kZSkgPT4ge1xyXG4gICAgICAgIGlmIChjb2RlICE9PSAwKSB7XHJcbiAgICAgICAgICByZWplY3QoXHJcbiAgICAgICAgICAgIG5ldyBFcnJvcihcclxuICAgICAgICAgICAgICBlcnIudHJpbSgpIHx8IGBGYWlsZWQgdG8gbGlzdCBBR1kgbW9kZWxzIChleGl0ICR7Y29kZSA/PyBcInVua25vd25cIn0pLmAsXHJcbiAgICAgICAgICAgICksXHJcbiAgICAgICAgICApO1xyXG4gICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgbW9kZWxzOiBBZ2VudE1vZGVsW10gPSBvdXRcbiAgICAgICAgICAuc3BsaXQoL1xccj9cXG4vKVxyXG4gICAgICAgICAgLm1hcCgobGluZSkgPT4gbGluZS50cmltKCkpXHJcbiAgICAgICAgICAuZmlsdGVyKEJvb2xlYW4pXHJcbiAgICAgICAgICAubWFwKChsaW5lKSA9PiB7XHJcbiAgICAgICAgICAgIC8vIEN1cnJlbnQgaHVtYW4tcmVhZGFibGUgb3V0cHV0IGlzIGNvbHVtbi1vcmllbnRlZC4gQWNjZXB0IHRhYnNcclxuICAgICAgICAgICAgLy8gYW5kIDIrIHNwYWNlcyBzbyB0aGUgc2VsZWN0b3Igc3RpbGwgd29ya3MgYWNyb3NzIENMSSB2ZXJzaW9ucy5cclxuICAgICAgICAgICAgY29uc3QgY29sdW1ucyA9IGxpbmUuc3BsaXQoL1xcdCt8XFxzezIsfS8pLmZpbHRlcihCb29sZWFuKTtcclxuICAgICAgICAgICAgaWYgKGNvbHVtbnMubGVuZ3RoIDwgMikgcmV0dXJuIG51bGw7XHJcbiAgICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgICAgaWQ6IGNvbHVtbnNbMF0udHJpbSgpLFxyXG4gICAgICAgICAgICAgIG5hbWU6IGNvbHVtbnMuc2xpY2UoMSkuam9pbihcIiBcIikudHJpbSgpLFxyXG4gICAgICAgICAgICB9O1xyXG4gICAgICAgICAgfSlcclxuICAgICAgICAgIC5maWx0ZXIoKG1vZGVsKTogbW9kZWwgaXMgQWdlbnRNb2RlbCA9PiBtb2RlbCAhPT0gbnVsbCk7XG5cclxuICAgICAgICByZXNvbHZlKG1vZGVscyk7XHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgYWJvcnQgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4gIGFib3J0KCk6IHZvaWQge1xyXG4gICAgY29uc3QgcHJvYyA9IHRoaXMucHJvYztcclxuICAgIHRoaXMucHJvYyA9IG51bGw7XHJcblxyXG4gICAgaWYgKHByb2MgJiYgcHJvYy5leGl0Q29kZSA9PT0gbnVsbCAmJiAhcHJvYy5raWxsZWQpIHtcclxuICAgICAgcHJvYy5raWxsKFwiU0lHVEVSTVwiKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBpbnRlcm5hbCBzdGF0ZSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbiAgLyoqIFBvcHVsYXRlZCBmcm9tIEFHWSBpbml0L3Jlc3VsdCBldmVudHM7IHVzZWQgdG8gcmVzdW1lIHRoZSBuZXh0IHR1cm4uICovXHJcbiAgX2xhc3RDb252ZXJzYXRpb25JZDogc3RyaW5nIHwgdW5kZWZpbmVkO1xyXG59XHJcbiIsICJpbXBvcnQgeyBJdGVtVmlldywgTWFya2Rvd25SZW5kZXJlciwgV29ya3NwYWNlTGVhZiB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHsgTGVhcm5pbmdDb250cm9sbGVyIH0gZnJvbSBcIi4uL2xlYXJuaW5nL0xlYXJuaW5nQ29udHJvbGxlclwiO1xyXG5pbXBvcnQge1xyXG4gIExlYXJuaW5nQWN0aW9uS2luZCxcclxuICBMZWFybmluZ0V2ZW50LFxyXG59IGZyb20gXCIuLi9sZWFybmluZy9sZWFybmluZy10eXBlc1wiO1xyXG5pbXBvcnQgeyBMZWFybmluZ0NvbnRleHQgfSBmcm9tIFwiLi4vY29udGV4dC9jb250ZXh0LXR5cGVzXCI7XHJcbmltcG9ydCB7XHJcbiAgUHJhY3RpY2VFdmFsdWF0aW9uLFxyXG4gIFByYWN0aWNlUXVlc3Rpb24sXHJcbn0gZnJvbSBcIi4uL2xlYXJuaW5nL3ByYWN0aWNlLXR5cGVzXCI7XHJcbmltcG9ydCB7IEFnZW50Q29udGV4dCwgRWRpdFByb3Bvc2FsIH0gZnJvbSBcIi4uL3R5cGVzXCI7XHJcblxyXG5leHBvcnQgY29uc3QgRk9SR0VfVklFV19UWVBFID0gXCJmb3JnZS1zaWRlYmFyXCI7XG5cclxudHlwZSBVSVN0YXRlID1cclxuICB8IFwiRU1QVFlcIlxyXG4gIHwgXCJSVU5OSU5HXCJcclxuICB8IFwiQU5TV0VSXCJcclxuICB8IFwiUFJPUE9TQUxcIlxyXG4gIHwgXCJBUFBMSUVEXCJcclxuICB8IFwiRVJST1JcIjtcclxuXHJcbmNvbnN0IEFDVElPTlM6IEFycmF5PHtcbiAga2luZDogTGVhcm5pbmdBY3Rpb25LaW5kO1xuICBsYWJlbDogc3RyaW5nO1xufT4gPSBbXG4gIHsga2luZDogXCJhc2tcIiwgbGFiZWw6IFwiQXNrXCIgfSxcclxuICB7IGtpbmQ6IFwiZXhwbGFpblwiLCBsYWJlbDogXCJFeHBsYWluXCIgfSxcclxuICB7IGtpbmQ6IFwicHJhY3RpY2VcIiwgbGFiZWw6IFwiUHJhY3RpY2VcIiB9LFxyXG4gIHsga2luZDogXCJyZXZpZXdcIiwgbGFiZWw6IFwiUmV2aWV3XCIgfSxcclxuICB7IGtpbmQ6IFwiZWRpdFwiLCBsYWJlbDogXCJFZGl0XCIgfSxcbl07XG5cbmNvbnN0IFBST01QVF9DT01NQU5EUzogQXJyYXk8e1xuICBraW5kOiBMZWFybmluZ0FjdGlvbktpbmQ7XG4gIG5hbWU6IHN0cmluZztcbiAgZGVzY3JpcHRpb246IHN0cmluZztcbn0+ID0gW1xuICB7IGtpbmQ6IFwiYXNrXCIsIG5hbWU6IFwiL2Fza1wiLCBkZXNjcmlwdGlvbjogXCJBc2sgYWJvdXQgdGhlIGN1cnJlbnQgY29udGV4dFwiIH0sXG4gIHsga2luZDogXCJleHBsYWluXCIsIG5hbWU6IFwiL2V4cGxhaW5cIiwgZGVzY3JpcHRpb246IFwiQnJlYWsgZG93biBhIGNvbmNlcHRcIiB9LFxuICB7IGtpbmQ6IFwicHJhY3RpY2VcIiwgbmFtZTogXCIvcHJhY3RpY2VcIiwgZGVzY3JpcHRpb246IFwiR2VuZXJhdGUgYSBwcmFjdGljZSBxdWVzdGlvblwiIH0sXG4gIHsga2luZDogXCJyZXZpZXdcIiwgbmFtZTogXCIvcmV2aWV3XCIsIGRlc2NyaXB0aW9uOiBcIlJldmlldyB1bmRlcnN0YW5kaW5nIGFuZCBnYXBzXCIgfSxcbiAgeyBraW5kOiBcImVkaXRcIiwgbmFtZTogXCIvZWRpdFwiLCBkZXNjcmlwdGlvbjogXCJJbXByb3ZlIHRoZSBjdXJyZW50IG5vdGVcIiB9LFxuXTtcblxudHlwZSBQcm9tcHRNZW51S2luZCA9IFwic291cmNlXCIgfCBcImNvbW1hbmRcIjtcblxuZnVuY3Rpb24gcGFyc2VQcm9tcHRUb2tlbih2YWx1ZTogc3RyaW5nKToge1xuICBraW5kOiBQcm9tcHRNZW51S2luZDtcbiAgcXVlcnk6IHN0cmluZztcbiAgc3RhcnQ6IG51bWJlcjtcbn0gfCBudWxsIHtcbiAgY29uc3QgbWF0Y2ggPSAvKF58XFxzKShbQC9dKShbXFx3LV0qKSQvLmV4ZWModmFsdWUpO1xuICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcblxuICByZXR1cm4ge1xuICAgIGtpbmQ6IG1hdGNoWzJdID09PSBcIkBcIiA/IFwic291cmNlXCIgOiBcImNvbW1hbmRcIixcbiAgICBxdWVyeTogbWF0Y2hbM10udG9Mb3dlckNhc2UoKSxcbiAgICBzdGFydDogbWF0Y2guaW5kZXggKyBtYXRjaFsxXS5sZW5ndGgsXG4gIH07XG59XG5cclxuZXhwb3J0IGNsYXNzIENoYXRWaWV3IGV4dGVuZHMgSXRlbVZpZXcge1xyXG4gIHByaXZhdGUgdGhyZWFkITogSFRNTEVsZW1lbnQ7XHJcbiAgcHJpdmF0ZSBjb21wb3NlciE6IEhUTUxFbGVtZW50O1xyXG4gIHByaXZhdGUgaGVhZGVyRWwhOiBIVE1MRWxlbWVudDtcclxuXHJcbiAgcHJpdmF0ZSBpbnB1dCE6IEhUTUxUZXh0QXJlYUVsZW1lbnQ7XHJcbiAgcHJpdmF0ZSBzZW5kQnRuITogSFRNTEJ1dHRvbkVsZW1lbnQ7XHJcbiAgcHJpdmF0ZSBzZWxlY3Rpb25DaGlwITogSFRNTEVsZW1lbnQ7XHJcbiAgcHJpdmF0ZSBub3RlQ2hpcCE6IEhUTUxFbGVtZW50O1xyXG4gIHByaXZhdGUgY2FuY2VsQnRuITogSFRNTEJ1dHRvbkVsZW1lbnQ7XG4gIHByaXZhdGUgbW9kZWxTZWxlY3QhOiBIVE1MU2VsZWN0RWxlbWVudDtcbiAgcHJpdmF0ZSBkaWN0YXRpb25CdG4hOiBIVE1MQnV0dG9uRWxlbWVudDtcbiAgcHJpdmF0ZSBmaWxlSW5wdXQhOiBIVE1MSW5wdXRFbGVtZW50O1xuICBwcml2YXRlIHByb21wdFBsdXNCdG4hOiBIVE1MQnV0dG9uRWxlbWVudDtcbiAgcHJpdmF0ZSBhdHRhY2htZW50c0VsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHByb21wdE1lbnVFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBwcm9tcHRNZW51OiBQcm9tcHRNZW51S2luZCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHByb21wdE1lbnVBY3RpdmUgPSAwO1xuICBwcml2YXRlIHByb21wdE1lbnVSb3dzOiBIVE1MQnV0dG9uRWxlbWVudFtdID0gW107XG4gIHByaXZhdGUgZGljdGF0aW9uUmVjb2duaXRpb246IGFueSA9IG51bGw7XG4gIHByaXZhdGUgZGljdGF0aW9uTGlzdGVuaW5nID0gZmFsc2U7XG4gIHByaXZhdGUgYXR0YWNobWVudHM6IEFycmF5PHsgbmFtZTogc3RyaW5nOyBjb250ZXh0OiBBZ2VudENvbnRleHQgfT4gPSBbXTtcblxyXG4gIHByaXZhdGUgYWdlbnRDdXJzb3JFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBhZ2VudENvbnRlbnRFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdGF0dXNFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBsb2FkaW5nRWxhcHNlZEVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIGxvYWRpbmdTdGFydGVkQXQgPSAwO1xuICBwcml2YXRlIGxvYWRpbmdUaW1lcjogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdGhpbmtpbmdUb2dnbGVFbDogSFRNTEJ1dHRvbkVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSB0aGlua2luZ0xhYmVsRWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdGhpbmtpbmdDaGV2cm9uRWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdGhpbmtpbmdQYW5lbEVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHRoaW5raW5nUm93czogSFRNTEVsZW1lbnRbXSA9IFtdO1xuICBwcml2YXRlIHRoaW5raW5nU3RhZ2VUaW1lcjogbnVtYmVyIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdGhpbmtpbmdTdGFnZSA9IDA7XG4gIHByaXZhdGUgdGhpbmtpbmdNYW51YWxFeHBhbmRlZDogYm9vbGVhbiB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHN0cmVhbWVkUmVzcG9uc2VUZXh0ID0gXCJcIjtcbiAgcHJpdmF0ZSBzdHJlYW1pbmdQZW5kaW5nVGV4dCA9IFwiXCI7XG4gIHByaXZhdGUgcmVzcG9uc2VUaW1lRWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG5cclxuICBwcml2YXRlIHVpU3RhdGU6IFVJU3RhdGUgPSBcIkVNUFRZXCI7XHJcbiAgcHJpdmF0ZSBzZWxlY3RlZEFjdGlvbjogTGVhcm5pbmdBY3Rpb25LaW5kID0gXCJhc2tcIjtcclxuICBwcml2YXRlIGFjdGlvbkJ1dHRvbnMgPSBuZXcgTWFwPExlYXJuaW5nQWN0aW9uS2luZCwgSFRNTEJ1dHRvbkVsZW1lbnQ+KCk7XHJcblxyXG4gIHByaXZhdGUgZXh0cmFDdHg6IEFnZW50Q29udGV4dFtdID0gW107XHJcbiAgcHJpdmF0ZSBjdXJyZW50Q29udGV4dDogTGVhcm5pbmdDb250ZXh0IHwgbnVsbCA9IG51bGw7XHJcblxyXG4gIGNvbnN0cnVjdG9yKFxyXG4gICAgbGVhZjogV29ya3NwYWNlTGVhZixcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgbGVhcm5pbmc6IExlYXJuaW5nQ29udHJvbGxlcixcclxuICApIHtcclxuICAgIHN1cGVyKGxlYWYpO1xyXG4gIH1cclxuXHJcbiAgZ2V0Vmlld1R5cGUoKSB7XHJcbiAgICByZXR1cm4gRk9SR0VfVklFV19UWVBFO1xuICB9XHJcblxyXG4gIGdldERpc3BsYXlUZXh0KCkge1xuICAgIHJldHVybiBcIkZvcmdlXCI7XG4gIH1cclxuXHJcbiAgZ2V0SWNvbigpIHtcclxuICAgIHJldHVybiBcInNwYXJrbGVzXCI7XHJcbiAgfVxyXG5cclxuICBhc3luYyBvbk9wZW4oKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCByb290ID0gdGhpcy5jb250ZW50RWw7XHJcbiAgICByb290LmVtcHR5KCk7XHJcbiAgICByb290LmFkZENsYXNzKFwiZm9yZ2Utcm9vdFwiKTtcblxyXG4gICAgdGhpcy5idWlsZEhlYWRlcihyb290KTtcclxuICAgIHRoaXMudGhyZWFkID0gcm9vdC5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtdGhyZWFkXCIgfSk7XG4gICAgdGhpcy5jb21wb3NlciA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLWNvbXBvc2VyXCIgfSk7XG4gICAgdGhpcy5idWlsZENvbXBvc2VyKHRoaXMuY29tcG9zZXIpO1xyXG5cclxuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLmxlYXJuaW5nLnBpbmcoKTtcbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIHRoaXMuc2hvd0Vycm9yKHRoaXMucnVudGltZUVycm9yTWVzc2FnZShlcnIpKTtcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBhd2FpdCB0aGlzLnN5bmNDaGlwcygpO1xyXG4gICAgdGhpcy5zaG93RW1wdHkoKTtcclxuXHJcbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXHJcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImFjdGl2ZS1sZWFmLWNoYW5nZVwiLCAoKSA9PiB7XHJcbiAgICAgICAgdm9pZCB0aGlzLnN5bmNDaGlwcygpO1xyXG4gICAgICB9KSxcclxuICAgICk7XHJcbiAgICB0aGlzLnJlZ2lzdGVyRXZlbnQoXHJcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5vbihcImVkaXRvci1zZWxlY3Rpb24tY2hhbmdlXCIgYXMgYW55LCAoKSA9PiB7XHJcbiAgICAgICAgdm9pZCB0aGlzLnN5bmNDaGlwcygpO1xyXG4gICAgICB9KSxcclxuICAgICk7XHJcblxyXG4gICAgdm9pZCB0aGlzLnJlZnJlc2hNb2RlbExpc3QoKTtcclxuICB9XHJcblxyXG4gIGFzeW5jIG9uQ2xvc2UoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5sZWFybmluZy5jYW5jZWwoKTtcbiAgICB0aGlzLmRpY3RhdGlvblJlY29nbml0aW9uPy5zdG9wPy4oKTtcbiAgICB0aGlzLmRpY3RhdGlvblJlY29nbml0aW9uID0gbnVsbDtcbiAgICB0aGlzLmRpY3RhdGlvbkxpc3RlbmluZyA9IGZhbHNlO1xuICAgIHRoaXMuc3RvcFRoaW5raW5nU2VxdWVuY2UoKTtcbiAgICB0aGlzLnN0b3BMb2FkaW5nVGltZXIoKTtcbiAgfVxuXG4gIHByaXZhdGUgYnVpbGRIZWFkZXIocm9vdDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICB0aGlzLmhlYWRlckVsID0gcm9vdC5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtaGVhZGVyXCIgfSk7XG4gICAgY29uc3QgdG9wID0gdGhpcy5oZWFkZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtaGVhZGVyLXRvcFwiIH0pO1xuICAgIGNvbnN0IGJyYW5kID0gdG9wLmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1oZWFkZXItYnJhbmRcIiB9KTtcbiAgICBicmFuZC5jcmVhdGVTcGFuKHsgY2xzOiBcImZvcmdlLWhlYWRlci1tYXJrXCIsIHRleHQ6IFwiXHUyNzI2XCIgfSk7XG5cbiAgICBjb25zdCBjb3B5ID0gYnJhbmQuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLWhlYWRlci1jb3B5XCIgfSk7XG4gICAgY29weS5jcmVhdGVTcGFuKHtcbiAgICAgIGNsczogXCJmb3JnZS1oZWFkZXItdGl0bGVcIixcbiAgICAgIHRleHQ6IFwiRm9yZ2VcIixcbiAgICB9KTtcbiAgICBjb3B5LmNyZWF0ZVNwYW4oe1xuICAgICAgY2xzOiBcImZvcmdlLWhlYWRlci1zdWJ0aXRsZVwiLFxuICAgICAgdGV4dDogXCJMZWFybmluZyBPU1wiLFxuICAgIH0pO1xuXG4gICAgY29uc3QgcmlnaHQgPSB0b3AuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLWhlYWRlci1yaWdodFwiIH0pO1xuXG4gICAgY29uc3QgbmV3QnRuID0gcmlnaHQuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgY2xzOiBcImZvcmdlLW5ldy1idG5cIixcbiAgICAgIHRleHQ6IFwiXHVGRjBCXCIsXG4gICAgfSk7XG4gICAgbmV3QnRuLnRpdGxlID0gXCJOZXcgbGVhcm5pbmcgc2Vzc2lvblwiO1xuICAgIG5ld0J0bi5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIFwiTmV3IGxlYXJuaW5nIHNlc3Npb25cIik7XG4gICAgbmV3QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGF3YWl0IHRoaXMubGVhcm5pbmcubmV3U2Vzc2lvbigpO1xuICAgICAgdGhpcy5leHRyYUN0eCA9IFtdO1xuICAgICAgdGhpcy5hdHRhY2htZW50cyA9IFtdO1xuICAgICAgdGhpcy5yZW5kZXJBdHRhY2htZW50cygpO1xuICAgICAgdGhpcy5jbG9zZVByb21wdE1lbnUoKTtcbiAgICAgIHRoaXMuc2VsZWN0ZWRBY3Rpb24gPSBcImFza1wiO1xuICAgICAgdGhpcy5zeW5jQWN0aW9uQnV0dG9ucygpO1xyXG4gICAgICBhd2FpdCB0aGlzLnN5bmNDaGlwcygpO1xyXG4gICAgICB0aGlzLnNob3dFbXB0eSgpO1xuICAgIH0pO1xuXG4gICAgY29uc3QgdGFicyA9IHRoaXMuaGVhZGVyRWwuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLW1vZGUtdGFic1wiIH0pO1xuICAgIHRoaXMuYnVpbGRBY3Rpb25CdXR0b25zKHRhYnMpO1xuICB9XG5cbiAgcHJpdmF0ZSBidWlsZEFjdGlvbkJ1dHRvbnMocGFyZW50OiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgYWN0aW9uIG9mIEFDVElPTlMpIHtcbiAgICAgIGNvbnN0IGJ1dHRvbiA9IHBhcmVudC5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICAgIGNsczogXCJmb3JnZS1hY3Rpb24tYnRuXCIsXG4gICAgICAgIHRleHQ6IGFjdGlvbi5sYWJlbCxcbiAgICAgIH0pO1xuICAgICAgYnV0dG9uLnR5cGUgPSBcImJ1dHRvblwiO1xuICAgICAgYnV0dG9uLnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgYFVzZSAke2FjdGlvbi5sYWJlbH0gbW9kZWApO1xuICAgICAgYnV0dG9uLnRpdGxlID0gYCR7YWN0aW9uLmxhYmVsfSBtb2RlYDtcbiAgICAgIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgICB0aGlzLnNlbGVjdGVkQWN0aW9uID0gYWN0aW9uLmtpbmQ7XG4gICAgICAgIHRoaXMuc3luY0FjdGlvbkJ1dHRvbnMoKTtcbiAgICAgICAgdGhpcy51cGRhdGVQbGFjZWhvbGRlcigpO1xuICAgICAgfSk7XG4gICAgICB0aGlzLmFjdGlvbkJ1dHRvbnMuc2V0KGFjdGlvbi5raW5kLCBidXR0b24pO1xuICAgIH1cblxuICAgIHRoaXMuc3luY0FjdGlvbkJ1dHRvbnMoKTtcbiAgfVxuXHJcbiAgcHJpdmF0ZSBhc3luYyByZWZyZXNoTW9kZWxMaXN0KCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgbGV0IG1vZGVscyA9IHRoaXMubGVhcm5pbmcuZ2V0TW9kZWxzKCk7XHJcblxyXG4gICAgaWYgKG1vZGVscy5sZW5ndGggPT09IDApIHtcclxuICAgICAgYXdhaXQgbmV3IFByb21pc2UoKHJlc29sdmUpID0+IHNldFRpbWVvdXQocmVzb2x2ZSwgMTAwMCkpO1xyXG4gICAgICBtb2RlbHMgPSB0aGlzLmxlYXJuaW5nLmdldE1vZGVscygpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChtb2RlbHMubGVuZ3RoID09PSAwKSByZXR1cm47XHJcblxyXG4gICAgdGhpcy5tb2RlbFNlbGVjdC5lbXB0eSgpO1xyXG4gICAgY29uc3QgY3VycmVudE1vZGVsID0gdGhpcy5sZWFybmluZy5nZXRTZXNzaW9uKCkubW9kZWw7XHJcblxyXG4gICAgZm9yIChjb25zdCBtb2RlbCBvZiBtb2RlbHMpIHtcclxuICAgICAgY29uc3Qgb3B0aW9uID0gdGhpcy5tb2RlbFNlbGVjdC5jcmVhdGVFbChcIm9wdGlvblwiLCB7XHJcbiAgICAgICAgdmFsdWU6IG1vZGVsLmlkLFxyXG4gICAgICAgIHRleHQ6IG1vZGVsLm5hbWUsXHJcbiAgICAgIH0pO1xyXG5cclxuICAgICAgaWYgKG1vZGVsLmlkID09PSBjdXJyZW50TW9kZWwpIG9wdGlvbi5zZWxlY3RlZCA9IHRydWU7XHJcbiAgICB9XHJcbiAgfVxyXG5cbiAgcHJpdmF0ZSBidWlsZENvbXBvc2VyKHBhcmVudDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcbiAgICBjb25zdCBjb250ZXh0Um93ID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1jb250ZXh0LXJvd1wiIH0pO1xuICAgIGNvbnRleHRSb3cuY3JlYXRlU3Bhbih7XG4gICAgICBjbHM6IFwiZm9yZ2UtY29udGV4dC1sYWJlbFwiLFxuICAgICAgdGV4dDogXCJVc2luZ1wiLFxuICAgIH0pO1xuXG4gICAgY29uc3QgY2hpcHMgPSBjb250ZXh0Um93LmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1jaGlwc1wiIH0pO1xuXG4gICAgdGhpcy5zZWxlY3Rpb25DaGlwID0gY2hpcHMuY3JlYXRlU3Bhbih7XG4gICAgICBjbHM6IFwiZm9yZ2UtY2hpcCBmb3JnZS1jaGlwLS1oaWRkZW5cIixcbiAgICB9KTtcbiAgICB0aGlzLnNlbGVjdGlvbkNoaXAuY3JlYXRlU3Bhbih7IGNsczogXCJmb3JnZS1jaGlwLWRvdFwiIH0pO1xuICAgIHRoaXMuc2VsZWN0aW9uQ2hpcC5jcmVhdGVTcGFuKHtcbiAgICAgIGNsczogXCJmb3JnZS1jaGlwLWxhYmVsXCIsXG4gICAgICB0ZXh0OiBcIkBzZWxlY3Rpb25cIixcbiAgICB9KTtcblxuICAgIHRoaXMubm90ZUNoaXAgPSBjaGlwcy5jcmVhdGVTcGFuKHtcbiAgICAgIGNsczogXCJmb3JnZS1jaGlwIGZvcmdlLWNoaXAtLWhpZGRlblwiLFxuICAgIH0pO1xuICAgIHRoaXMubm90ZUNoaXAuY3JlYXRlU3Bhbih7IGNsczogXCJmb3JnZS1jaGlwLWRvdFwiIH0pO1xuICAgIHRoaXMubm90ZUNoaXAuY3JlYXRlU3Bhbih7XG4gICAgICBjbHM6IFwiZm9yZ2UtY2hpcC1sYWJlbFwiLFxuICAgICAgdGV4dDogXCJAbm90ZVwiLFxuICAgIH0pO1xuXG4gICAgY29uc3QgYW5jaG9yID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1wcm9tcHQtYW5jaG9yXCIgfSk7XG4gICAgdGhpcy5wcm9tcHRNZW51RWwgPSBhbmNob3IuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS1wcm9tcHQtbWVudSBmb3JnZS1oaWRkZW5cIixcbiAgICB9KTtcblxuICAgIGNvbnN0IGJveCA9IGFuY2hvci5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtY29tcG9zZXItYm94XCIgfSk7XG4gICAgYm94LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmICghKGV2ZW50LnRhcmdldCBpbnN0YW5jZW9mIEhUTUxCdXR0b25FbGVtZW50KSAmJlxuICAgICAgICAgICEoZXZlbnQudGFyZ2V0IGluc3RhbmNlb2YgSFRNTFNlbGVjdEVsZW1lbnQpKSB7XG4gICAgICAgIHRoaXMuaW5wdXQuZm9jdXMoKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHRoaXMuYXR0YWNobWVudHNFbCA9IGJveC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLWF0dGFjaG1lbnRzIGZvcmdlLWhpZGRlblwiLFxuICAgIH0pO1xuXG4gICAgdGhpcy5maWxlSW5wdXQgPSBib3guY3JlYXRlRWwoXCJpbnB1dFwiLCB7XG4gICAgICBjbHM6IFwiZm9yZ2UtZmlsZS1pbnB1dFwiLFxuICAgICAgYXR0cjoge1xuICAgICAgICB0eXBlOiBcImZpbGVcIixcbiAgICAgICAgbXVsdGlwbGU6IFwiXCIsXG4gICAgICAgIGFjY2VwdDogXCIubWQsLnR4dCwuY3N2LC5qc29uLC55YW1sLC55bWxcIixcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgdGhpcy5maWxlSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICB2b2lkIHRoaXMuaGFuZGxlRmlsZXModGhpcy5maWxlSW5wdXQuZmlsZXMpO1xuICAgIH0pO1xuXG4gICAgY29uc3QgY29udHJvbHMgPSBib3guY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLWNvbXBvc2VyLWNvbnRyb2xzXCIgfSk7XG4gICAgdGhpcy5wcm9tcHRQbHVzQnRuID0gY29udHJvbHMuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgY2xzOiBcImZvcmdlLXByb21wdC1wbHVzXCIsXG4gICAgICB0ZXh0OiBcIlx1RkYwQlwiLFxuICAgICAgYXR0cjoge1xuICAgICAgICB0eXBlOiBcImJ1dHRvblwiLFxuICAgICAgICBcImFyaWEtbGFiZWxcIjogXCJBZGQgY29udGV4dCBvciBmaWxlXCIsXG4gICAgICAgIFwiYXJpYS1leHBhbmRlZFwiOiBcImZhbHNlXCIsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHRoaXMucHJvbXB0UGx1c0J0bi50aXRsZSA9IFwiQWRkIGNvbnRleHQgb3IgZmlsZVwiO1xuICAgIHRoaXMucHJvbXB0UGx1c0J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5wcm9tcHRNZW51ID0gdGhpcy5wcm9tcHRNZW51ID09PSBcInNvdXJjZVwiID8gbnVsbCA6IFwic291cmNlXCI7XG4gICAgICB0aGlzLnByb21wdE1lbnVBY3RpdmUgPSAwO1xuICAgICAgdGhpcy5yZW5kZXJQcm9tcHRNZW51KCk7XG4gICAgICB0aGlzLmlucHV0LmZvY3VzKCk7XG4gICAgfSk7XG5cbiAgICB0aGlzLmlucHV0ID0gY29udHJvbHMuY3JlYXRlRWwoXCJ0ZXh0YXJlYVwiLCB7XG4gICAgICBjbHM6IFwiZm9yZ2UtaW5wdXRcIixcbiAgICAgIGF0dHI6IHtcbiAgICAgICAgcGxhY2Vob2xkZXI6IFwiQXNrIGFib3V0IHdoYXQgeW91J3JlIGxlYXJuaW5nXHUyMDI2XCIsXG4gICAgICAgIHJvd3M6IFwiMVwiLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICB0aGlzLmlucHV0LmFkZEV2ZW50TGlzdGVuZXIoXCJpbnB1dFwiLCAoKSA9PiB0aGlzLm9uSW5wdXQoKSk7XG4gICAgdGhpcy5pbnB1dC5hZGRFdmVudExpc3RlbmVyKFwia2V5ZG93blwiLCAoZXZlbnQpID0+IHRoaXMub25LZXkoZXZlbnQpKTtcblxuICAgIGNvbnN0IGZvb3RlciA9IGJveC5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtY29tcG9zZXItZm9vdGVyXCIgfSk7XG4gICAgY29uc3QgdG9vbHMgPSBmb290ZXIuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLWNvbXBvc2VyLXRvb2xzXCIgfSk7XG5cbiAgICB0aGlzLm1vZGVsU2VsZWN0ID0gdG9vbHMuY3JlYXRlRWwoXCJzZWxlY3RcIiwge1xuICAgICAgY2xzOiBcImZvcmdlLW1vZGVsLXNlbGVjdFwiLFxuICAgIH0pO1xuICAgIHRoaXMubW9kZWxTZWxlY3QuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICB0aGlzLmxlYXJuaW5nLnNldE1vZGVsKHRoaXMubW9kZWxTZWxlY3QudmFsdWUpO1xuICAgIH0pO1xuICAgIHRoaXMubW9kZWxTZWxlY3Quc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBcIkxlYXJuaW5nIG1vZGVsXCIpO1xuICAgIHRoaXMubW9kZWxTZWxlY3QudGl0bGUgPSBcIkxlYXJuaW5nIG1vZGVsXCI7XG4gICAgdGhpcy5tb2RlbFNlbGVjdC5jcmVhdGVFbChcIm9wdGlvblwiLCB7XG4gICAgICB0ZXh0OiBcIkxvYWRpbmcgbW9kZWxzXHUyMDI2XCIsXG4gICAgICBhdHRyOiB7XG4gICAgICAgIGRpc2FibGVkOiBcIlwiLFxuICAgICAgICBzZWxlY3RlZDogXCJcIixcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmRpY3RhdGlvbkJ0biA9IHRvb2xzLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcbiAgICAgIGNsczogXCJmb3JnZS1jb21wb3Nlci1pY29uLWJ0blwiLFxuICAgICAgdGV4dDogXCJcdTI1QzlcIixcbiAgICAgIGF0dHI6IHtcbiAgICAgICAgdHlwZTogXCJidXR0b25cIixcbiAgICAgICAgXCJhcmlhLWxhYmVsXCI6IFwiU3RhcnQgZGljdGF0aW9uXCIsXG4gICAgICAgIFwiYXJpYS1wcmVzc2VkXCI6IFwiZmFsc2VcIixcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgdGhpcy5kaWN0YXRpb25CdG4udGl0bGUgPSBcIlN0YXJ0IGRpY3RhdGlvblwiO1xuICAgIHRoaXMuZGljdGF0aW9uQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnRvZ2dsZURpY3RhdGlvbigpKTtcblxuICAgIGNvbnN0IGJ0bkdyb3VwID0gZm9vdGVyLmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1idG4tZ3JvdXBcIiB9KTtcblxuICAgIHRoaXMuY2FuY2VsQnRuID0gYnRuR3JvdXAuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgY2xzOiBcImZvcmdlLWNhbmNlbC1idG4gZm9yZ2UtaGlkZGVuXCIsXG4gICAgICB0ZXh0OiBcIlx1MDBEN1wiLFxuICAgIH0pO1xuICAgIHRoaXMuY2FuY2VsQnRuLnRpdGxlID0gXCJTdG9wXCI7XG4gICAgdGhpcy5jYW5jZWxCdG4uc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBcIlN0b3AgZ2VuZXJhdGluZ1wiKTtcbiAgICB0aGlzLmNhbmNlbEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICB0aGlzLmxlYXJuaW5nLmNhbmNlbCgpO1xuICAgICAgdGhpcy5zZXRVSVN0YXRlKFwiQU5TV0VSXCIpO1xuICAgICAgdGhpcy5hcHBlbmRJbmxpbmVFcnJvcih0aGlzLnRocmVhZCwgXCJTdG9wcGVkLlwiKTtcbiAgICAgIHRoaXMuZmluaXNoU3RyZWFtaW5nQnViYmxlKFwiU3RvcHBlZFwiKTtcbiAgICB9KTtcclxuXG4gICAgdGhpcy5zZW5kQnRuID0gYnRuR3JvdXAuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgY2xzOiBcImZvcmdlLXNlbmQtYnRuXCIsXG4gICAgICB0ZXh0OiBcIlx1MjE5MVwiLFxuICAgIH0pO1xuICAgIHRoaXMuc2VuZEJ0bi50aXRsZSA9IFwiU2VuZCBtZXNzYWdlXCI7XG4gICAgdGhpcy5zZW5kQnRuLnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgXCJTZW5kIG1lc3NhZ2VcIik7XG4gICAgdGhpcy5zZW5kQnRuLmRpc2FibGVkID0gdHJ1ZTtcbiAgICB0aGlzLnNlbmRCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIHZvaWQgdGhpcy5kb1NlbmQoKTtcbiAgICB9KTtcblxuICAgIHRoaXMuc2V0dXBEaWN0YXRpb24oKTtcblxuICAgIHBhcmVudC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLWNvbXBvc2VyLWhpbnRcIixcbiAgICAgIHRleHQ6IFwiRW50ZXIgdG8gc2VuZCBcdTAwQjcgU2hpZnQgKyBFbnRlciBmb3IgYSBuZXcgbGluZVwiLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJBdHRhY2htZW50cygpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuYXR0YWNobWVudHNFbCkgcmV0dXJuO1xuXG4gICAgdGhpcy5hdHRhY2htZW50c0VsLmVtcHR5KCk7XG4gICAgdGhpcy5hdHRhY2htZW50c0VsLnRvZ2dsZUNsYXNzKFwiZm9yZ2UtaGlkZGVuXCIsIHRoaXMuYXR0YWNobWVudHMubGVuZ3RoID09PSAwKTtcblxuICAgIGZvciAoY29uc3QgW2luZGV4LCBhdHRhY2htZW50XSBvZiB0aGlzLmF0dGFjaG1lbnRzLmVudHJpZXMoKSkge1xuICAgICAgY29uc3QgY2hpcCA9IHRoaXMuYXR0YWNobWVudHNFbC5jcmVhdGVEaXYoe1xuICAgICAgICBjbHM6IFwiZm9yZ2UtYXR0YWNobWVudC1jaGlwXCIsXG4gICAgICB9KTtcbiAgICAgIGNoaXAuY3JlYXRlU3Bhbih7IGNsczogXCJmb3JnZS1hdHRhY2htZW50LWljb25cIiwgdGV4dDogXCJcdTI1QTdcIiB9KTtcbiAgICAgIGNoaXAuY3JlYXRlU3Bhbih7IGNsczogXCJmb3JnZS1hdHRhY2htZW50LW5hbWVcIiwgdGV4dDogYXR0YWNobWVudC5uYW1lIH0pO1xuXG4gICAgICBjb25zdCByZW1vdmUgPSBjaGlwLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcbiAgICAgICAgY2xzOiBcImZvcmdlLWF0dGFjaG1lbnQtcmVtb3ZlXCIsXG4gICAgICAgIHRleHQ6IFwiXHUwMEQ3XCIsXG4gICAgICAgIGF0dHI6IHtcbiAgICAgICAgICB0eXBlOiBcImJ1dHRvblwiLFxuICAgICAgICAgIFwiYXJpYS1sYWJlbFwiOiBgUmVtb3ZlICR7YXR0YWNobWVudC5uYW1lfWAsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIHJlbW92ZS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgICB0aGlzLmF0dGFjaG1lbnRzLnNwbGljZShpbmRleCwgMSk7XG4gICAgICAgIHRoaXMuZXh0cmFDdHggPSB0aGlzLmF0dGFjaG1lbnRzLm1hcCgoaXRlbSkgPT4gaXRlbS5jb250ZXh0KTtcbiAgICAgICAgdGhpcy5yZW5kZXJBdHRhY2htZW50cygpO1xuICAgICAgICB2b2lkIHRoaXMuc3luY0NoaXBzKCk7XG4gICAgICB9KTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGhhbmRsZUZpbGVzKGZpbGVzOiBGaWxlTGlzdCB8IG51bGwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWZpbGVzIHx8IGZpbGVzLmxlbmd0aCA9PT0gMCkgcmV0dXJuO1xuXG4gICAgdGhpcy5jbG9zZVByb21wdE1lbnUoKTtcblxuICAgIGZvciAoY29uc3QgZmlsZSBvZiBBcnJheS5mcm9tKGZpbGVzKSkge1xuICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IGZpbGUudGV4dCgpO1xuICAgICAgdGhpcy5hdHRhY2htZW50cy5wdXNoKHtcbiAgICAgICAgbmFtZTogZmlsZS5uYW1lLFxuICAgICAgICBjb250ZXh0OiB7XG4gICAgICAgICAgdHlwZTogXCJub3RlXCIsXG4gICAgICAgICAgZmlsZTogYGF0dGFjaG1lbnQvJHtmaWxlLm5hbWV9YCxcbiAgICAgICAgICBjb250ZW50LFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgdGhpcy5leHRyYUN0eCA9IHRoaXMuYXR0YWNobWVudHMubWFwKChpdGVtKSA9PiBpdGVtLmNvbnRleHQpO1xuICAgIHRoaXMucmVuZGVyQXR0YWNobWVudHMoKTtcbiAgICB0aGlzLmZpbGVJbnB1dC52YWx1ZSA9IFwiXCI7XG4gICAgYXdhaXQgdGhpcy5zeW5jQ2hpcHMoKTtcbiAgICB0aGlzLmlucHV0LmZvY3VzKCk7XG4gIH1cblxuICBwcml2YXRlIGdldFByb21wdE1lbnVJdGVtcygpOiBBcnJheTx7XG4gICAga2V5OiBzdHJpbmc7XG4gICAgbmFtZTogc3RyaW5nO1xuICAgIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG4gICAgYWN0aW9uOiBcImF0dGFjaFwiIHwgXCJzZWxlY3Rpb25cIiB8IFwibm90ZVwiIHwgTGVhcm5pbmdBY3Rpb25LaW5kO1xuICB9PiB7XG4gICAgaWYgKHRoaXMucHJvbXB0TWVudSA9PT0gXCJjb21tYW5kXCIpIHtcbiAgICAgIHJldHVybiBQUk9NUFRfQ09NTUFORFMubWFwKChjb21tYW5kKSA9PiAoe1xuICAgICAgICBrZXk6IGNvbW1hbmQua2luZCxcbiAgICAgICAgbmFtZTogY29tbWFuZC5uYW1lLFxuICAgICAgICBkZXNjcmlwdGlvbjogY29tbWFuZC5kZXNjcmlwdGlvbixcbiAgICAgICAgYWN0aW9uOiBjb21tYW5kLmtpbmQsXG4gICAgICB9KSk7XG4gICAgfVxuXG4gICAgY29uc3QgaXRlbXM6IEFycmF5PHtcbiAgICAgIGtleTogc3RyaW5nO1xuICAgICAgbmFtZTogc3RyaW5nO1xuICAgICAgZGVzY3JpcHRpb246IHN0cmluZztcbiAgICAgIGFjdGlvbjogXCJhdHRhY2hcIiB8IFwic2VsZWN0aW9uXCIgfCBcIm5vdGVcIjtcbiAgICB9PiA9IFtcbiAgICAgIHtcbiAgICAgICAga2V5OiBcImF0dGFjaFwiLFxuICAgICAgICBuYW1lOiBcIkFkZCB0ZXh0IGZpbGVzXCIsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkF0dGFjaCBNYXJrZG93biBvciBkYXRhIGNvbnRleHRcIixcbiAgICAgICAgYWN0aW9uOiBcImF0dGFjaFwiLFxuICAgICAgfSxcbiAgICBdO1xuXG4gICAgaWYgKHRoaXMuY3VycmVudENvbnRleHQ/LnNlbGVjdGlvbikge1xuICAgICAgaXRlbXMucHVzaCh7XG4gICAgICAgIGtleTogXCJzZWxlY3Rpb25cIixcbiAgICAgICAgbmFtZTogXCJDdXJyZW50IHNlbGVjdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJVc2UgdGhlIHNlbGVjdGVkIHRleHRcIixcbiAgICAgICAgYWN0aW9uOiBcInNlbGVjdGlvblwiLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuY3VycmVudENvbnRleHQ/LmFjdGl2ZU5vdGUpIHtcbiAgICAgIGl0ZW1zLnB1c2goe1xuICAgICAgICBrZXk6IFwibm90ZVwiLFxuICAgICAgICBuYW1lOiBcIkN1cnJlbnQgbm90ZVwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJVc2UgdGhlIGFjdGl2ZSBub3RlXCIsXG4gICAgICAgIGFjdGlvbjogXCJub3RlXCIsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICByZXR1cm4gaXRlbXM7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclByb21wdE1lbnUoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLnByb21wdE1lbnVFbCkgcmV0dXJuO1xuXG4gICAgdGhpcy5wcm9tcHRNZW51RWwuZW1wdHkoKTtcbiAgICB0aGlzLnByb21wdE1lbnVSb3dzID0gW107XG4gICAgdGhpcy5wcm9tcHRNZW51RWwudG9nZ2xlQ2xhc3MoXCJmb3JnZS1oaWRkZW5cIiwgdGhpcy5wcm9tcHRNZW51ID09PSBudWxsKTtcbiAgICB0aGlzLnByb21wdFBsdXNCdG4/LnNldEF0dHJpYnV0ZShcbiAgICAgIFwiYXJpYS1leHBhbmRlZFwiLFxuICAgICAgU3RyaW5nKHRoaXMucHJvbXB0TWVudSAhPT0gbnVsbCksXG4gICAgKTtcblxuICAgIGlmICghdGhpcy5wcm9tcHRNZW51KSByZXR1cm47XG5cbiAgICBjb25zdCB0b2tlbiA9IHBhcnNlUHJvbXB0VG9rZW4odGhpcy5pbnB1dC52YWx1ZSk7XG4gICAgY29uc3QgcXVlcnkgPSB0b2tlbj8ua2luZCA9PT0gdGhpcy5wcm9tcHRNZW51ID8gdG9rZW4ucXVlcnkgOiBcIlwiO1xuICAgIGNvbnN0IHJvd3MgPSB0aGlzLmdldFByb21wdE1lbnVJdGVtcygpLmZpbHRlcigoaXRlbSkgPT5cbiAgICAgIGAke2l0ZW0ubmFtZX0gJHtpdGVtLmRlc2NyaXB0aW9ufWAudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhxdWVyeSksXG4gICAgKTtcblxuICAgIHJvd3MuZm9yRWFjaCgoaXRlbSwgaW5kZXgpID0+IHtcbiAgICAgIGNvbnN0IGJ1dHRvbiA9IHRoaXMucHJvbXB0TWVudUVsIS5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICAgIGNsczogYGZvcmdlLXByb21wdC1tZW51LXJvdyR7aW5kZXggPT09IHRoaXMucHJvbXB0TWVudUFjdGl2ZSA/IFwiIGlzLWFjdGl2ZVwiIDogXCJcIn1gLFxuICAgICAgICBhdHRyOiB7IHR5cGU6IFwiYnV0dG9uXCIgfSxcbiAgICAgIH0pO1xuICAgICAgYnV0dG9uLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9yZ2UtcHJvbXB0LW1lbnUtaWNvblwiLCB0ZXh0OiBpdGVtLmFjdGlvbiA9PT0gXCJhdHRhY2hcIiA/IFwiXHVGRjBCXCIgOiBcIkBcIiB9KTtcbiAgICAgIGJ1dHRvbi5jcmVhdGVTcGFuKHsgY2xzOiBcImZvcmdlLXByb21wdC1tZW51LW5hbWVcIiwgdGV4dDogaXRlbS5uYW1lIH0pO1xuICAgICAgYnV0dG9uLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9yZ2UtcHJvbXB0LW1lbnUtZGVzY3JpcHRpb25cIiwgdGV4dDogaXRlbS5kZXNjcmlwdGlvbiB9KTtcbiAgICAgIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwibW91c2VlbnRlclwiLCAoKSA9PiB7XG4gICAgICAgIHRoaXMucHJvbXB0TWVudUFjdGl2ZSA9IGluZGV4O1xuICAgICAgICB0aGlzLnByb21wdE1lbnVSb3dzLmZvckVhY2goKHJvdywgcm93SW5kZXgpID0+IHtcbiAgICAgICAgICByb3cudG9nZ2xlQ2xhc3MoXCJpcy1hY3RpdmVcIiwgcm93SW5kZXggPT09IHRoaXMucHJvbXB0TWVudUFjdGl2ZSk7XG4gICAgICAgIH0pO1xuICAgICAgfSk7XG4gICAgICBidXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMucGlja1Byb21wdE1lbnVJdGVtKGl0ZW0pKTtcbiAgICAgIHRoaXMucHJvbXB0TWVudVJvd3MucHVzaChidXR0b24pO1xuICAgIH0pO1xuXG4gICAgaWYgKHJvd3MubGVuZ3RoID09PSAwKSB7XG4gICAgICB0aGlzLnByb21wdE1lbnVFbC5jcmVhdGVEaXYoe1xuICAgICAgICBjbHM6IFwiZm9yZ2UtcHJvbXB0LW1lbnUtZW1wdHlcIixcbiAgICAgICAgdGV4dDogYE5vIG1hdGNoZXMgZm9yIFx1MjAxQyR7cXVlcnl9XHUyMDFEYCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHRoaXMucHJvbXB0TWVudUVsLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiZm9yZ2UtcHJvbXB0LW1lbnUtaGludFwiLFxuICAgICAgdGV4dDogdGhpcy5wcm9tcHRNZW51ID09PSBcInNvdXJjZVwiXG4gICAgICAgID8gXCJTZWxlY3QgYSBzb3VyY2Ugb3IgYXR0YWNoIGEgdGV4dCBmaWxlXCJcbiAgICAgICAgOiBcIkNob29zZSBhIGxlYXJuaW5nIGFjdGlvblwiLFxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBwaWNrUHJvbXB0TWVudUl0ZW0oaXRlbToge1xuICAgIG5hbWU6IHN0cmluZztcbiAgICBhY3Rpb246IFwiYXR0YWNoXCIgfCBcInNlbGVjdGlvblwiIHwgXCJub3RlXCIgfCBMZWFybmluZ0FjdGlvbktpbmQ7XG4gIH0pOiB2b2lkIHtcbiAgICBpZiAoaXRlbS5hY3Rpb24gPT09IFwiYXR0YWNoXCIpIHtcbiAgICAgIHRoaXMuY2xvc2VQcm9tcHRNZW51KCk7XG4gICAgICB0aGlzLmZpbGVJbnB1dC5jbGljaygpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHRva2VuID0gcGFyc2VQcm9tcHRUb2tlbih0aGlzLmlucHV0LnZhbHVlKTtcbiAgICBjb25zdCBwcmVmaXggPSB0b2tlbiA/IHRoaXMuaW5wdXQudmFsdWUuc2xpY2UoMCwgdG9rZW4uc3RhcnQpIDogdGhpcy5pbnB1dC52YWx1ZTtcblxuICAgIGlmIChpdGVtLmFjdGlvbiA9PT0gXCJzZWxlY3Rpb25cIiB8fCBpdGVtLmFjdGlvbiA9PT0gXCJub3RlXCIpIHtcbiAgICAgIHRoaXMuaW5wdXQudmFsdWUgPSBgJHtwcmVmaXh9QCR7aXRlbS5hY3Rpb24gPT09IFwic2VsZWN0aW9uXCIgPyBcInNlbGVjdGlvblwiIDogXCJjdXJyZW50LW5vdGVcIn0gYDtcbiAgICB9IGVsc2Uge1xuICAgICAgdGhpcy5zZWxlY3RlZEFjdGlvbiA9IGl0ZW0uYWN0aW9uO1xuICAgICAgdGhpcy5zeW5jQWN0aW9uQnV0dG9ucygpO1xuICAgICAgdGhpcy51cGRhdGVQbGFjZWhvbGRlcigpO1xuICAgICAgdGhpcy5pbnB1dC52YWx1ZSA9IGAke3ByZWZpeH0ke2l0ZW0ubmFtZX0gYDtcbiAgICB9XG5cbiAgICB0aGlzLmNsb3NlUHJvbXB0TWVudSgpO1xuICAgIHRoaXMub25JbnB1dCgpO1xuICAgIHRoaXMuaW5wdXQuZm9jdXMoKTtcbiAgfVxuXG4gIHByaXZhdGUgY2xvc2VQcm9tcHRNZW51KCk6IHZvaWQge1xuICAgIHRoaXMucHJvbXB0TWVudSA9IG51bGw7XG4gICAgdGhpcy5wcm9tcHRNZW51QWN0aXZlID0gMDtcbiAgICB0aGlzLnJlbmRlclByb21wdE1lbnUoKTtcbiAgfVxuXG4gIHByaXZhdGUgc2V0dXBEaWN0YXRpb24oKTogdm9pZCB7XG4gICAgY29uc3QgU3BlZWNoUmVjb2duaXRpb24gPSAod2luZG93IGFzIGFueSkuU3BlZWNoUmVjb2duaXRpb24gPz9cbiAgICAgICh3aW5kb3cgYXMgYW55KS53ZWJraXRTcGVlY2hSZWNvZ25pdGlvbjtcblxuICAgIGlmICghU3BlZWNoUmVjb2duaXRpb24pIHtcbiAgICAgIHRoaXMuZGljdGF0aW9uQnRuLmRpc2FibGVkID0gdHJ1ZTtcbiAgICAgIHRoaXMuZGljdGF0aW9uQnRuLnRpdGxlID0gXCJEaWN0YXRpb24gaXMgdW5hdmFpbGFibGUgaW4gdGhpcyBlbnZpcm9ubWVudFwiO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIGNvbnN0IHJlY29nbml0aW9uID0gbmV3IFNwZWVjaFJlY29nbml0aW9uKCk7XG4gICAgcmVjb2duaXRpb24uY29udGludW91cyA9IGZhbHNlO1xuICAgIHJlY29nbml0aW9uLmludGVyaW1SZXN1bHRzID0gZmFsc2U7XG4gICAgcmVjb2duaXRpb24ubGFuZyA9IFwiaWQtSURcIjtcbiAgICByZWNvZ25pdGlvbi5vbnJlc3VsdCA9IChldmVudDogYW55KSA9PiB7XG4gICAgICBjb25zdCB0cmFuc2NyaXB0ID0gZXZlbnQucmVzdWx0cz8uWzBdPy5bMF0/LnRyYW5zY3JpcHQ/LnRyaW0oKTtcbiAgICAgIGlmICh0cmFuc2NyaXB0KSB7XG4gICAgICAgIHRoaXMuaW5wdXQudmFsdWUgPSBgJHt0aGlzLmlucHV0LnZhbHVlLnRyaW1FbmQoKX0ke3RoaXMuaW5wdXQudmFsdWUgPyBcIiBcIiA6IFwiXCJ9JHt0cmFuc2NyaXB0fWA7XG4gICAgICAgIHRoaXMub25JbnB1dCgpO1xuICAgICAgfVxuICAgIH07XG4gICAgcmVjb2duaXRpb24ub25lcnJvciA9ICgpID0+IHtcbiAgICAgIHRoaXMuZGljdGF0aW9uTGlzdGVuaW5nID0gZmFsc2U7XG4gICAgICB0aGlzLnN5bmNEaWN0YXRpb25CdXR0b24oKTtcbiAgICB9O1xuICAgIHJlY29nbml0aW9uLm9uZW5kID0gKCkgPT4ge1xuICAgICAgdGhpcy5kaWN0YXRpb25MaXN0ZW5pbmcgPSBmYWxzZTtcbiAgICAgIHRoaXMuc3luY0RpY3RhdGlvbkJ1dHRvbigpO1xuICAgIH07XG4gICAgdGhpcy5kaWN0YXRpb25SZWNvZ25pdGlvbiA9IHJlY29nbml0aW9uO1xuICB9XG5cbiAgcHJpdmF0ZSB0b2dnbGVEaWN0YXRpb24oKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmRpY3RhdGlvblJlY29nbml0aW9uKSByZXR1cm47XG5cbiAgICBpZiAodGhpcy5kaWN0YXRpb25MaXN0ZW5pbmcpIHtcbiAgICAgIHRoaXMuZGljdGF0aW9uUmVjb2duaXRpb24uc3RvcCgpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHRoaXMuZGljdGF0aW9uTGlzdGVuaW5nID0gdHJ1ZTtcbiAgICB0aGlzLnN5bmNEaWN0YXRpb25CdXR0b24oKTtcbiAgICB0aGlzLmlucHV0LmZvY3VzKCk7XG4gICAgdHJ5IHtcbiAgICAgIHRoaXMuZGljdGF0aW9uUmVjb2duaXRpb24uc3RhcnQoKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHRoaXMuZGljdGF0aW9uTGlzdGVuaW5nID0gZmFsc2U7XG4gICAgICB0aGlzLnN5bmNEaWN0YXRpb25CdXR0b24oKTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHN5bmNEaWN0YXRpb25CdXR0b24oKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmRpY3RhdGlvbkJ0bikgcmV0dXJuO1xuXG4gICAgdGhpcy5kaWN0YXRpb25CdG4udG9nZ2xlQ2xhc3MoXCJpcy1hY3RpdmVcIiwgdGhpcy5kaWN0YXRpb25MaXN0ZW5pbmcpO1xuICAgIHRoaXMuZGljdGF0aW9uQnRuLnNldEF0dHJpYnV0ZShcImFyaWEtcHJlc3NlZFwiLCBTdHJpbmcodGhpcy5kaWN0YXRpb25MaXN0ZW5pbmcpKTtcbiAgICB0aGlzLmRpY3RhdGlvbkJ0bi5zZXRBdHRyaWJ1dGUoXG4gICAgICBcImFyaWEtbGFiZWxcIixcbiAgICAgIHRoaXMuZGljdGF0aW9uTGlzdGVuaW5nID8gXCJTdG9wIGRpY3RhdGlvblwiIDogXCJTdGFydCBkaWN0YXRpb25cIixcbiAgICApO1xuICAgIHRoaXMuZGljdGF0aW9uQnRuLnRpdGxlID0gdGhpcy5kaWN0YXRpb25MaXN0ZW5pbmcgPyBcIlN0b3AgZGljdGF0aW9uXCIgOiBcIlN0YXJ0IGRpY3RhdGlvblwiO1xuICAgIHRoaXMuZGljdGF0aW9uQnRuLnRleHRDb250ZW50ID0gdGhpcy5kaWN0YXRpb25MaXN0ZW5pbmcgPyBcIlx1MjVDQ1wiIDogXCJcdTI1QzlcIjtcbiAgfVxuXG4gIHByaXZhdGUgc3luY0FjdGlvbkJ1dHRvbnMoKTogdm9pZCB7XG4gICAgZm9yIChjb25zdCBba2luZCwgYnV0dG9uXSBvZiB0aGlzLmFjdGlvbkJ1dHRvbnMpIHtcclxuICAgICAgY29uc3QgYWN0aXZlID0ga2luZCA9PT0gdGhpcy5zZWxlY3RlZEFjdGlvbjtcclxuICAgICAgYnV0dG9uLnRvZ2dsZUNsYXNzKFwiaXMtYWN0aXZlXCIsIGFjdGl2ZSk7XHJcbiAgICAgIGJ1dHRvbi5zZXRBdHRyaWJ1dGUoXCJhcmlhLXByZXNzZWRcIiwgU3RyaW5nKGFjdGl2ZSkpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSB1cGRhdGVQbGFjZWhvbGRlcigpOiB2b2lkIHtcclxuICAgIGNvbnN0IHBsYWNlaG9sZGVyczogUmVjb3JkPExlYXJuaW5nQWN0aW9uS2luZCwgc3RyaW5nPiA9IHtcclxuICAgICAgYXNrOiBcIkFzayBhYm91dCB3aGF0IHlvdSdyZSBsZWFybmluZ1x1MjAyNlwiLFxyXG4gICAgICBleHBsYWluOiBcIldoYXQgc2hvdWxkIEkgZXhwbGFpbj9cIixcclxuICAgICAgcHJhY3RpY2U6IFwiV2hhdCBzaG91bGQgd2UgcHJhY3RpY2U/XCIsXHJcbiAgICAgIHJldmlldzogXCJXaGF0IHNob3VsZCBJIHJldmlldz9cIixcclxuICAgICAgZWRpdDogXCJIb3cgc2hvdWxkIEkgaW1wcm92ZSB0aGlzIG5vdGU/XCIsXHJcbiAgICB9O1xyXG5cclxuICAgIGlmICh0aGlzLmlucHV0KSB7XHJcbiAgICAgIHRoaXMuaW5wdXQucGxhY2Vob2xkZXIgPSBwbGFjZWhvbGRlcnNbdGhpcy5zZWxlY3RlZEFjdGlvbl07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHN5bmNDaGlwcygpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IGNvbnRleHQgPSBhd2FpdCB0aGlzLmxlYXJuaW5nLnJlc29sdmVDb250ZXh0KHRoaXMuZXh0cmFDdHgpO1xyXG4gICAgdGhpcy5jdXJyZW50Q29udGV4dCA9IGNvbnRleHQ7XHJcblxyXG4gICAgY29uc3QgaGFzU2VsZWN0aW9uID0gQm9vbGVhbihjb250ZXh0LnNlbGVjdGlvbik7XHJcbiAgICB0aGlzLnNlbGVjdGlvbkNoaXAudG9nZ2xlQ2xhc3MoXCJhZ3ktY2hpcC0taGlkZGVuXCIsICFoYXNTZWxlY3Rpb24pO1xyXG5cclxuICAgIGNvbnN0IGFjdGl2ZU5vdGUgPSBjb250ZXh0LmFjdGl2ZU5vdGU7XHJcbiAgICB0aGlzLm5vdGVDaGlwLnRvZ2dsZUNsYXNzKFwiYWd5LWNoaXAtLWhpZGRlblwiLCAhYWN0aXZlTm90ZSk7XHJcblxyXG4gICAgaWYgKGFjdGl2ZU5vdGUpIHtcclxuICAgICAgY29uc3QgbmFtZSA9IGFjdGl2ZU5vdGUucGF0aC5zcGxpdChcIi9cIikucG9wKCkgPz8gYWN0aXZlTm90ZS5wYXRoO1xyXG4gICAgICBjb25zdCBsYWJlbCA9IHRoaXMubm90ZUNoaXAucXVlcnlTZWxlY3RvcjxIVE1MRWxlbWVudD4oXCIuYWd5LWNoaXAtbGFiZWxcIik7XHJcbiAgICAgIGlmIChsYWJlbCkgbGFiZWwudGV4dENvbnRlbnQgPSBgQCR7bmFtZX1gO1xyXG4gICAgICB0aGlzLm5vdGVDaGlwLnRpdGxlID0gYWN0aXZlTm90ZS5wYXRoO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBvbklucHV0KCk6IHZvaWQge1xuICAgIHRoaXMuc2VuZEJ0bi5kaXNhYmxlZCA9XG4gICAgICAhdGhpcy5jYW5TZW5kKCkgfHwgdGhpcy51aVN0YXRlID09PSBcIlJVTk5JTkdcIjtcblxuICAgIGNvbnN0IHRva2VuID0gcGFyc2VQcm9tcHRUb2tlbih0aGlzLmlucHV0LnZhbHVlKTtcbiAgICBpZiAodG9rZW4gJiYgdGhpcy5wcm9tcHRNZW51ICE9PSB0b2tlbi5raW5kKSB7XG4gICAgICB0aGlzLnByb21wdE1lbnUgPSB0b2tlbi5raW5kO1xuICAgICAgdGhpcy5wcm9tcHRNZW51QWN0aXZlID0gMDtcbiAgICB9IGVsc2UgaWYgKCF0b2tlbikge1xuICAgICAgdGhpcy5jbG9zZVByb21wdE1lbnUoKTtcbiAgICB9XG5cbiAgICB0aGlzLnJlbmRlclByb21wdE1lbnUoKTtcblxuICAgIHRoaXMuaW5wdXQuc3R5bGUuaGVpZ2h0ID0gXCJhdXRvXCI7XG4gICAgdGhpcy5pbnB1dC5zdHlsZS5oZWlnaHQgPVxyXG4gICAgICBNYXRoLm1pbih0aGlzLmlucHV0LnNjcm9sbEhlaWdodCwgODApICsgXCJweFwiO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBvbktleShldmVudDogS2V5Ym9hcmRFdmVudCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnByb21wdE1lbnUgJiYgdGhpcy5wcm9tcHRNZW51Um93cy5sZW5ndGggPiAwKSB7XG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkFycm93RG93blwiIHx8IGV2ZW50LmtleSA9PT0gXCJBcnJvd1VwXCIpIHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgY29uc3QgZGlyZWN0aW9uID0gZXZlbnQua2V5ID09PSBcIkFycm93RG93blwiID8gMSA6IC0xO1xuICAgICAgICB0aGlzLnByb21wdE1lbnVBY3RpdmUgPVxuICAgICAgICAgICh0aGlzLnByb21wdE1lbnVBY3RpdmUgKyBkaXJlY3Rpb24gKyB0aGlzLnByb21wdE1lbnVSb3dzLmxlbmd0aCkgJVxuICAgICAgICAgIHRoaXMucHJvbXB0TWVudVJvd3MubGVuZ3RoO1xuICAgICAgICB0aGlzLnByb21wdE1lbnVSb3dzLmZvckVhY2goKHJvdywgaW5kZXgpID0+IHtcbiAgICAgICAgICByb3cudG9nZ2xlQ2xhc3MoXCJpcy1hY3RpdmVcIiwgaW5kZXggPT09IHRoaXMucHJvbXB0TWVudUFjdGl2ZSk7XG4gICAgICAgIH0pO1xuICAgICAgICByZXR1cm47XG4gICAgICB9XG5cbiAgICAgIGlmICgoZXZlbnQua2V5ID09PSBcIkVudGVyXCIgJiYgIWV2ZW50LnNoaWZ0S2V5KSB8fCBldmVudC5rZXkgPT09IFwiVGFiXCIpIHtcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcbiAgICAgICAgY29uc3Qgcm93ID0gdGhpcy5wcm9tcHRNZW51Um93c1t0aGlzLnByb21wdE1lbnVBY3RpdmVdO1xuICAgICAgICBpZiAocm93KSByb3cuY2xpY2soKTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChldmVudC5rZXkgPT09IFwiRW50ZXJcIiAmJiAhZXZlbnQuc2hpZnRLZXkpIHtcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICBpZiAoIXRoaXMuc2VuZEJ0bi5kaXNhYmxlZCkgdm9pZCB0aGlzLmRvU2VuZCgpO1xuICAgIH1cblxuICAgIGlmIChldmVudC5rZXkgPT09IFwiRXNjYXBlXCIpIHtcbiAgICAgIGlmICh0aGlzLnByb21wdE1lbnUpIHtcbiAgICAgICAgdGhpcy5jbG9zZVByb21wdE1lbnUoKTtcbiAgICAgIH0gZWxzZSBpZiAodGhpcy51aVN0YXRlID09PSBcIlJVTk5JTkdcIikge1xuICAgICAgICB0aGlzLmNhbmNlbEJ0bi5jbGljaygpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXHJcbiAgcHJpdmF0ZSBhc3luYyBkb1NlbmQoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgcHJvbXB0ID0gdGhpcy5pbnB1dC52YWx1ZS50cmltKCkgfHwgXCJSZXZpZXcgdGhlIGF0dGFjaGVkIGNvbnRleHQuXCI7XG4gICAgaWYgKCF0aGlzLmNhblNlbmQoKSB8fCB0aGlzLnVpU3RhdGUgPT09IFwiUlVOTklOR1wiKSByZXR1cm47XG5cbiAgICBjb25zdCBleHBsaWNpdENvbnRleHQgPSB0aGlzLmV4dHJhQ3R4O1xuICAgIHRoaXMuY2xvc2VQcm9tcHRNZW51KCk7XG4gICAgaWYgKHRoaXMuZGljdGF0aW9uTGlzdGVuaW5nKSB0aGlzLmRpY3RhdGlvblJlY29nbml0aW9uPy5zdG9wPy4oKTtcblxuICAgIHRoaXMuaW5wdXQudmFsdWUgPSBcIlwiO1xuICAgIHRoaXMuaW5wdXQuc3R5bGUuaGVpZ2h0ID0gXCJcIjtcbiAgICB0aGlzLmF0dGFjaG1lbnRzID0gW107XG4gICAgdGhpcy5leHRyYUN0eCA9IFtdO1xuICAgIHRoaXMucmVuZGVyQXR0YWNobWVudHMoKTtcbiAgICB0aGlzLnNlbmRCdG4uZGlzYWJsZWQgPSB0cnVlO1xuXHJcbiAgICB0aGlzLmFneUN1cnNvckVsID0gbnVsbDtcbiAgICB0aGlzLmFneUNvbnRlbnRFbCA9IG51bGw7XG4gICAgdGhpcy5zdGF0dXNFbCA9IG51bGw7XG4gICAgdGhpcy5zdHJlYW1lZFJlc3BvbnNlVGV4dCA9IFwiXCI7XG4gICAgdGhpcy5zdHJlYW1pbmdQZW5kaW5nVGV4dCA9IFwiXCI7XG4gICAgdGhpcy5zdG9wVGhpbmtpbmdTZXF1ZW5jZSgpO1xuICAgIHRoaXMuc3RvcExvYWRpbmdUaW1lcigpO1xuXHJcbiAgICB0aGlzLmFwcGVuZFVzZXJCdWJibGUocHJvbXB0KTtcclxuICAgIHRoaXMuc2V0VUlTdGF0ZShcIlJVTk5JTkdcIik7XHJcbiAgICB0aGlzLmVuc3VyZUFnZW50QnViYmxlKCk7XG5cclxuICAgIGNvbnN0IHRpbWVvdXQgPSB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgIHRoaXMubGVhcm5pbmcuY2FuY2VsKCk7XG4gICAgICB0aGlzLnNldFVJU3RhdGUoXCJBTlNXRVJcIik7XG4gICAgICB0aGlzLmZpbmlzaFN0cmVhbWluZ0J1YmJsZShcIlRpbWVkIG91dFwiKTtcbiAgICAgIHRoaXMuYXBwZW5kSW5saW5lRXJyb3IoXHJcbiAgICAgICAgdGhpcy50aHJlYWQsXHJcbiAgICAgICAgXCJObyByZXNwb25zZSBhZnRlciA2MCBzLiBUaGUgYWdlbnQgcnVudGltZSBtYXkgYmUgYnVzeS5cIixcbiAgICAgICk7XHJcbiAgICB9LCA2MF8wMDApO1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGZvciBhd2FpdCAoY29uc3QgZXZlbnQgb2YgdGhpcy5sZWFybmluZy5ydW4oe1xuICAgICAgICBwcm9tcHQsXG4gICAgICAgIGFjdGlvbjogdGhpcy5zZWxlY3RlZEFjdGlvbixcbiAgICAgICAgZXhwbGljaXRDb250ZXh0LFxuICAgICAgfSkpIHtcbiAgICAgICAgdGhpcy5oYW5kbGVMZWFybmluZ0V2ZW50KGV2ZW50LCB0aW1lb3V0KTtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyKSB7XG4gICAgICB3aW5kb3cuY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xuICAgICAgdGhpcy5maW5pc2hTdHJlYW1pbmdCdWJibGUoXCJTdG9wcGVkXCIpO1xuXHJcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPVxyXG4gICAgICAgIGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyLm1lc3NhZ2UgOiBTdHJpbmcoZXJyKTtcclxuXHJcbiAgICAgIGlmIChtZXNzYWdlLmluY2x1ZGVzKFwibm90IGZvdW5kXCIpIHx8IG1lc3NhZ2UuaW5jbHVkZXMoXCJFTk9FTlRcIikpIHtcbiAgICAgICAgdGhpcy5zaG93RXJyb3IoXCJBZ2VudCBydW50aW1lIG5vdCBmb3VuZC4gQ2hlY2sgRm9yZ2UgcnVudGltZSBzZXR0aW5ncy5cIik7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBjb25zb2xlLndhcm4oXCJbRm9yZ2VdIEFnZW50IHJ1bnRpbWUgZXJyb3JcIiwgbWVzc2FnZSk7XG4gICAgICAgIHRoaXMuYXBwZW5kSW5saW5lRXJyb3IoXG4gICAgICAgICAgdGhpcy50aHJlYWQsXG4gICAgICAgICAgdGhpcy5ydW50aW1lRXJyb3JNZXNzYWdlKGVyciksXG4gICAgICAgICk7XG4gICAgICAgIHRoaXMuc2V0VUlTdGF0ZShcIkFOU1dFUlwiKTtcbiAgICAgIH1cbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGhhbmRsZUxlYXJuaW5nRXZlbnQoXHJcbiAgICBldmVudDogTGVhcm5pbmdFdmVudCxcclxuICAgIHRpbWVvdXQ6IG51bWJlcixcclxuICApOiB2b2lkIHtcclxuICAgIGlmIChldmVudC50eXBlID09PSBcImNvbnRleHQtcmVhZHlcIikge1xyXG4gICAgICB0aGlzLmN1cnJlbnRDb250ZXh0ID0gZXZlbnQuY29udGV4dDtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChldmVudC50eXBlID09PSBcInJlc3BvbnNlLWRlbHRhXCIpIHtcclxuICAgICAgdGhpcy5hcHBlbmRUb0FnZW50QnViYmxlKGV2ZW50LnRleHQpO1xuICAgICAgdGhpcy5zY3JvbGxUaHJlYWQoKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChldmVudC50eXBlID09PSBcInByYWN0aWNlLXF1ZXN0aW9uXCIpIHtcclxuICAgICAgdGhpcy5hcHBlbmRQcmFjdGljZVF1ZXN0aW9uKGV2ZW50LnF1ZXN0aW9uKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChldmVudC50eXBlID09PSBcInByYWN0aWNlLWV2YWx1YXRpb25cIikge1xyXG4gICAgICB0aGlzLmFwcGVuZFByYWN0aWNlRXZhbHVhdGlvbihldmVudC5ldmFsdWF0aW9uKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChldmVudC50eXBlID09PSBcImxlYXJuaW5nLXN0YXRlLXVwZGF0ZWRcIikge1xyXG4gICAgICAvLyBEdXJhYmxlIHByb2dyZXNzIGlzIGludGVudGlvbmFsbHkgcXVpZXQuIFRoZSBpbnRlcmFjdGlvbiBpdHNlbGYgaXMgdGhlXHJcbiAgICAgIC8vIHByaW1hcnkgVUk7IHByb2dyZXNzIHN0YXRlIGlzIHN1cHBvcnRpbmcgY29udGV4dCBmb3IgZnV0dXJlIHR1cm5zLlxyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGV2ZW50LnR5cGUgPT09IFwibXV0YXRpb24tcHJvcG9zZWRcIikge1xyXG4gICAgICB0aGlzLnNldFVJU3RhdGUoXCJQUk9QT1NBTFwiKTtcclxuICAgICAgdGhpcy5hcHBlbmRQcm9wb3NhbEJ1YmJsZShldmVudC5wcm9wb3NhbCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJjb21wbGV0ZWRcIikge1xyXG4gICAgICB3aW5kb3cuY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xyXG4gICAgICBpZiAodGhpcy51aVN0YXRlID09PSBcIlJVTk5JTkdcIikge1xyXG4gICAgICAgIHRoaXMuc2V0VUlTdGF0ZShcIkFOU1dFUlwiKTtcclxuICAgICAgfVxyXG4gICAgICB0aGlzLmZpbmlzaFN0cmVhbWluZ0J1YmJsZSgpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGV2ZW50LnR5cGUgPT09IFwiZXJyb3JcIikge1xuICAgICAgd2luZG93LmNsZWFyVGltZW91dCh0aW1lb3V0KTtcbiAgICAgIHRoaXMuZmluaXNoU3RyZWFtaW5nQnViYmxlKFwiVW5hYmxlIHRvIGZpbmlzaFwiKTtcbiAgICAgIGNvbnNvbGUud2FybihcIltGb3JnZV0gQWdlbnQgcnVudGltZSBlcnJvclwiLCBldmVudC5tZXNzYWdlKTtcbiAgICAgIHRoaXMuYXBwZW5kSW5saW5lRXJyb3IoXG4gICAgICAgIHRoaXMudGhyZWFkLFxuICAgICAgICB0aGlzLnJ1bnRpbWVFcnJvck1lc3NhZ2UoZXZlbnQubWVzc2FnZSksXG4gICAgICApO1xuICAgICAgdGhpcy5zZXRVSVN0YXRlKFwiQU5TV0VSXCIpO1xuICAgIH1cbiAgfVxyXG5cclxuICBwcml2YXRlIGZpbmlzaFN0cmVhbWluZ0J1YmJsZShkb25lTGFiZWw/OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBlbGFwc2VkID0gdGhpcy5mb3JtYXRFbGFwc2VkKERhdGUubm93KCkgLSB0aGlzLmxvYWRpbmdTdGFydGVkQXQpO1xuICAgIHRoaXMuc3RvcFRoaW5raW5nU2VxdWVuY2UoKTtcbiAgICB0aGlzLmZsdXNoU3RyZWFtaW5nVGV4dCgpO1xuICAgIHRoaXMucmVuZGVyTWFya2Rvd25SZXNwb25zZSgpO1xuICAgIGlmIChkb25lTGFiZWwgPT09IHVuZGVmaW5lZCkgdGhpcy5hcHBlbmRTdHJlYW1BY3Rpb25zKCk7XG4gICAgdGhpcy5zZXR0bGVUaGlua2luZyhkb25lTGFiZWwgPz8gYFRob3VnaHQgZm9yICR7ZWxhcHNlZH1gKTtcbiAgICBpZiAodGhpcy5yZXNwb25zZVRpbWVFbCkgdGhpcy5yZXNwb25zZVRpbWVFbC50ZXh0Q29udGVudCA9IGBmb3IgJHtlbGFwc2VkfWA7XG4gICAgdGhpcy5zdG9wTG9hZGluZ1RpbWVyKCk7XG4gICAgdGhpcy5hZ3lDdXJzb3JFbD8ucmVtb3ZlQ2xhc3MoXCJmb3JnZS1idWJibGUtLXN0cmVhbWluZ1wiKTtcbiAgICB0aGlzLmFneUN1cnNvckVsID0gbnVsbDtcbiAgICB0aGlzLmFneUNvbnRlbnRFbCA9IG51bGw7XG4gICAgdGhpcy5zdGF0dXNFbCA9IG51bGw7XG4gICAgdGhpcy50aGlua2luZ1RvZ2dsZUVsID0gbnVsbDtcbiAgICB0aGlzLnRoaW5raW5nTGFiZWxFbCA9IG51bGw7XG4gICAgdGhpcy50aGlua2luZ0NoZXZyb25FbCA9IG51bGw7XG4gICAgdGhpcy50aGlua2luZ1BhbmVsRWwgPSBudWxsO1xuICAgIHRoaXMudGhpbmtpbmdSb3dzID0gW107XG4gICAgdGhpcy50aGlua2luZ01hbnVhbEV4cGFuZGVkID0gbnVsbDtcbiAgICB0aGlzLnJlc3BvbnNlVGltZUVsID0gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgc2V0dGxlVGhpbmtpbmcoZG9uZUxhYmVsOiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMudGhpbmtpbmdMYWJlbEVsKSByZXR1cm47XG5cbiAgICB0aGlzLnRoaW5raW5nTGFiZWxFbC50ZXh0Q29udGVudCA9IGRvbmVMYWJlbDtcbiAgICB0aGlzLnRoaW5raW5nTGFiZWxFbC5yZW1vdmVDbGFzcyhcImZvcmdlLXRoaW5raW5nLWxhYmVsLS1hY3RpdmVcIik7XG4gICAgdGhpcy50aGlua2luZ0xhYmVsRWwuYWRkQ2xhc3MoXCJmb3JnZS10aGlua2luZy1sYWJlbC0tZG9uZVwiKTtcblxuICAgIGZvciAoY29uc3Qgcm93IG9mIHRoaXMudGhpbmtpbmdSb3dzKSB7XG4gICAgICByb3cucmVtb3ZlQ2xhc3MoXCJmb3JnZS1oaWRkZW5cIik7XG4gICAgICByb3cucmVtb3ZlQ2xhc3MoXCJpcy1hY3RpdmVcIik7XG4gICAgICByb3cuYWRkQ2xhc3MoXCJpcy1kb25lXCIpO1xuXG4gICAgICBjb25zdCBtYXJrZXIgPSByb3cuZmlyc3RFbGVtZW50Q2hpbGQgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuICAgICAgaWYgKG1hcmtlcikge1xuICAgICAgICBtYXJrZXIudGV4dENvbnRlbnQgPSBcIlx1MjcxM1wiO1xuICAgICAgICBtYXJrZXIucmVtb3ZlQ2xhc3MoXCJmb3JnZS10aGlua2luZy1tYXJrZXItLXNwaW5uZXJcIik7XG4gICAgICB9XG4gICAgfVxuXG4gICAgY29uc3QgZXhwYW5kZWQgPSB0aGlzLnRoaW5raW5nTWFudWFsRXhwYW5kZWQgPz8gZmFsc2U7XG4gICAgdGhpcy50aGlua2luZ1BhbmVsRWw/LnRvZ2dsZUNsYXNzKFwiaXMtZXhwYW5kZWRcIiwgZXhwYW5kZWQpO1xuICAgIHRoaXMudGhpbmtpbmdUb2dnbGVFbD8uc2V0QXR0cmlidXRlKFwiYXJpYS1leHBhbmRlZFwiLCBTdHJpbmcoZXhwYW5kZWQpKTtcbiAgICB0aGlzLnRoaW5raW5nQ2hldnJvbkVsPy50b2dnbGVDbGFzcyhcImlzLWV4cGFuZGVkXCIsIGV4cGFuZGVkKTtcbiAgfVxuXG4gIHByaXZhdGUgc3RvcFRoaW5raW5nU2VxdWVuY2UoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMudGhpbmtpbmdTdGFnZVRpbWVyICE9PSBudWxsKSB7XG4gICAgICB3aW5kb3cuY2xlYXJUaW1lb3V0KHRoaXMudGhpbmtpbmdTdGFnZVRpbWVyKTtcbiAgICAgIHRoaXMudGhpbmtpbmdTdGFnZVRpbWVyID0gbnVsbDtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIHN0YXJ0VGhpbmtpbmdTZXF1ZW5jZSgpOiB2b2lkIHtcbiAgICB0aGlzLnRoaW5raW5nU3RhZ2UgPSAwO1xuICAgIHRoaXMucmVuZGVyVGhpbmtpbmdTdGFnZSgpO1xuICAgIHRoaXMuc2NoZWR1bGVUaGlua2luZ1N0YWdlKCk7XG4gIH1cblxuICBwcml2YXRlIHNjaGVkdWxlVGhpbmtpbmdTdGFnZSgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy50aGlua2luZ1N0YWdlID49IHRoaXMudGhpbmtpbmdSb3dzLmxlbmd0aCAtIDEpIHJldHVybjtcblxuICAgIGNvbnN0IGRlbGF5cyA9IFs4MDAsIDYwMCwgMTgwMCwgMjYwMF07XG4gICAgY29uc3QgZGVsYXkgPSBkZWxheXNbdGhpcy50aGlua2luZ1N0YWdlXSA/PyAxMjAwO1xuXG4gICAgdGhpcy50aGlua2luZ1N0YWdlVGltZXIgPSB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICB0aGlzLnRoaW5raW5nU3RhZ2UgKz0gMTtcbiAgICAgIHRoaXMucmVuZGVyVGhpbmtpbmdTdGFnZSgpO1xuICAgICAgdGhpcy5zY2hlZHVsZVRoaW5raW5nU3RhZ2UoKTtcbiAgICB9LCBkZWxheSk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclRoaW5raW5nU3RhZ2UoKTogdm9pZCB7XG4gICAgY29uc3QgdmlzaWJsZSA9IE1hdGgubWluKFxuICAgICAgdGhpcy50aGlua2luZ1N0YWdlICsgMSxcbiAgICAgIHRoaXMudGhpbmtpbmdSb3dzLmxlbmd0aCxcbiAgICApO1xuXG4gICAgdGhpcy50aGlua2luZ1Jvd3MuZm9yRWFjaCgocm93LCBpbmRleCkgPT4ge1xuICAgICAgY29uc3QgYWN0aXZlID0gaW5kZXggPT09IHZpc2libGUgLSAxO1xuICAgICAgY29uc3QgZG9uZSA9IGluZGV4IDwgdmlzaWJsZSAtIDE7XG4gICAgICBjb25zdCBtYXJrZXIgPSByb3cuZmlyc3RFbGVtZW50Q2hpbGQgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xuXG4gICAgICByb3cudG9nZ2xlQ2xhc3MoXCJmb3JnZS1oaWRkZW5cIiwgaW5kZXggPj0gdmlzaWJsZSk7XG4gICAgICByb3cudG9nZ2xlQ2xhc3MoXCJpcy1hY3RpdmVcIiwgYWN0aXZlKTtcbiAgICAgIHJvdy50b2dnbGVDbGFzcyhcImlzLWRvbmVcIiwgZG9uZSk7XG5cbiAgICAgIGlmIChtYXJrZXIpIHtcbiAgICAgICAgbWFya2VyLnRleHRDb250ZW50ID0gZG9uZSA/IFwiXHUyNzEzXCIgOiBcIlwiO1xuICAgICAgICBtYXJrZXIudG9nZ2xlQ2xhc3MoXCJmb3JnZS10aGlua2luZy1tYXJrZXItLXNwaW5uZXJcIiwgYWN0aXZlKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgc3RhcnRMb2FkaW5nVGltZXIoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMubG9hZGluZ1RpbWVyICE9PSBudWxsKSB7XG4gICAgICB3aW5kb3cuY2xlYXJJbnRlcnZhbCh0aGlzLmxvYWRpbmdUaW1lcik7XG4gICAgICB0aGlzLmxvYWRpbmdUaW1lciA9IG51bGw7XG4gICAgfVxuXG4gICAgY29uc3QgdXBkYXRlID0gKCkgPT4ge1xuICAgICAgY29uc3QgZWxhcHNlZCA9IHRoaXMuZm9ybWF0RWxhcHNlZChEYXRlLm5vdygpIC0gdGhpcy5sb2FkaW5nU3RhcnRlZEF0KTtcbiAgICAgIGlmICh0aGlzLmxvYWRpbmdFbGFwc2VkRWwpIHRoaXMubG9hZGluZ0VsYXBzZWRFbC50ZXh0Q29udGVudCA9IGVsYXBzZWQ7XG4gICAgICBpZiAodGhpcy5yZXNwb25zZVRpbWVFbCkgdGhpcy5yZXNwb25zZVRpbWVFbC50ZXh0Q29udGVudCA9IGBmb3IgJHtlbGFwc2VkfWA7XG4gICAgfTtcblxuICAgIHRoaXMubG9hZGluZ1N0YXJ0ZWRBdCA9IERhdGUubm93KCk7XG4gICAgdXBkYXRlKCk7XG4gICAgdGhpcy5sb2FkaW5nVGltZXIgPSB3aW5kb3cuc2V0SW50ZXJ2YWwodXBkYXRlLCAxMDApO1xuICB9XG5cbiAgcHJpdmF0ZSBzdG9wTG9hZGluZ1RpbWVyKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLmxvYWRpbmdUaW1lciAhPT0gbnVsbCkge1xuICAgICAgd2luZG93LmNsZWFySW50ZXJ2YWwodGhpcy5sb2FkaW5nVGltZXIpO1xuICAgICAgdGhpcy5sb2FkaW5nVGltZXIgPSBudWxsO1xuICAgIH1cblxuICAgIHRoaXMubG9hZGluZ0VsYXBzZWRFbCA9IG51bGw7XG4gIH1cblxuICBwcml2YXRlIGZvcm1hdEVsYXBzZWQobWlsbGlzZWNvbmRzOiBudW1iZXIpOiBzdHJpbmcge1xuICAgIGNvbnN0IHNlY29uZHMgPSBtaWxsaXNlY29uZHMgLyAxMDAwO1xuXG4gICAgaWYgKHNlY29uZHMgPCA2MCkgcmV0dXJuIGAke3NlY29uZHMudG9GaXhlZCgxKX1zYDtcblxuICAgIHJldHVybiBgJHtNYXRoLmZsb29yKHNlY29uZHMgLyA2MCl9bSAkeyhzZWNvbmRzICUgNjApLnRvRml4ZWQoMSl9c2A7XG4gIH1cblxyXG4gIHByaXZhdGUgc2V0VUlTdGF0ZShzdGF0ZTogVUlTdGF0ZSk6IHZvaWQge1xuICAgIHRoaXMudWlTdGF0ZSA9IHN0YXRlO1xuXG4gICAgY29uc3QgYnVzeSA9IHN0YXRlID09PSBcIlJVTk5JTkdcIjtcbiAgICB0aGlzLmlucHV0LmRpc2FibGVkID0gYnVzeSB8fCBzdGF0ZSA9PT0gXCJFUlJPUlwiO1xuICAgIHRoaXMuc2VuZEJ0bi5kaXNhYmxlZCA9XG4gICAgICBidXN5IHx8IHN0YXRlID09PSBcIkVSUk9SXCIgfHwgIXRoaXMuY2FuU2VuZCgpO1xuICAgIHRoaXMuY2FuY2VsQnRuLnRvZ2dsZUNsYXNzKFwiZm9yZ2UtaGlkZGVuXCIsICFidXN5KTtcbiAgfVxuXG4gIHByaXZhdGUgY2FuU2VuZCgpOiBib29sZWFuIHtcbiAgICByZXR1cm4gdGhpcy5pbnB1dC52YWx1ZS50cmltKCkubGVuZ3RoID4gMCB8fCB0aGlzLmF0dGFjaG1lbnRzLmxlbmd0aCA+IDA7XG4gIH1cblxyXG4gIHByaXZhdGUgc2hvd0VtcHR5KCk6IHZvaWQge1xuICAgIHRoaXMuc3RvcExvYWRpbmdUaW1lcigpO1xuICAgIHRoaXMudGhyZWFkLmVtcHR5KCk7XG4gICAgdGhpcy5hZ3lDdXJzb3JFbCA9IG51bGw7XHJcbiAgICB0aGlzLnN0YXR1c0VsID0gbnVsbDtcclxuXG4gICAgY29uc3Qgc2xhdGUgPSB0aGlzLnRocmVhZC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLWVtcHR5LXNsYXRlXCIsXG4gICAgfSk7XG4gICAgc2xhdGUuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS1lbXB0eS1tYXJrXCIsXG4gICAgICB0ZXh0OiBcIlx1MjcyNlwiLFxuICAgIH0pO1xuICAgIHNsYXRlLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiZm9yZ2UtZW1wdHkta2lja2VyXCIsXG4gICAgICB0ZXh0OiBcIkxFQVJOSU5HIE9TXCIsXG4gICAgfSk7XG5cclxuICAgIGxldCBsYWJlbCA9IFwiT3BlbiBhIG5vdGUgb3IgYXNrIGFib3V0IHlvdXIgTGVhcm5pbmcgT1MuXCI7XHJcblxyXG4gICAgaWYgKHRoaXMuY3VycmVudENvbnRleHQ/LnNlbGVjdGlvbikge1xyXG4gICAgICBsYWJlbCA9IFwiU2VsZWN0aW9uIHJlYWR5IFx1MjAxNCBleHBsYWluLCBwcmFjdGljZSwgcmV2aWV3LCBvciBlZGl0IGl0LlwiO1xyXG4gICAgfSBlbHNlIGlmICh0aGlzLmN1cnJlbnRDb250ZXh0Py5hY3RpdmVOb3RlKSB7XHJcbiAgICAgIGNvbnN0IG5hbWUgPVxyXG4gICAgICAgIHRoaXMuY3VycmVudENvbnRleHQuYWN0aXZlTm90ZS5wYXRoLnNwbGl0KFwiL1wiKS5wb3AoKSA/P1xyXG4gICAgICAgIHRoaXMuY3VycmVudENvbnRleHQuYWN0aXZlTm90ZS5wYXRoO1xyXG4gICAgICBsYWJlbCA9IGBMZWFybiB3aXRoICR7bmFtZX1gO1xyXG4gICAgfVxyXG5cbiAgICBzbGF0ZS5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLWVtcHR5LWxhYmVsXCIsXG4gICAgICB0ZXh0OiBsYWJlbCxcbiAgICB9KTtcbiAgICBzbGF0ZS5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLWVtcHR5LWhpbnRcIixcbiAgICAgIHRleHQ6IFwiQXNrLCBleHBsYWluLCBwcmFjdGljZSwgcmV2aWV3LCBvciBlZGl0IGZyb20gdGhlIGN1cnJlbnQgY29udGV4dC5cIixcbiAgICB9KTtcblxyXG4gICAgdGhpcy5zZXRVSVN0YXRlKFwiRU1QVFlcIik7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHNob3dFcnJvcihtZXNzYWdlOiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BMb2FkaW5nVGltZXIoKTtcbiAgICB0aGlzLnRocmVhZC5lbXB0eSgpO1xuICAgIHRoaXMuYWd5Q3Vyc29yRWwgPSBudWxsO1xyXG4gICAgdGhpcy5zdGF0dXNFbCA9IG51bGw7XHJcblxuICAgIGNvbnN0IHNsYXRlID0gdGhpcy50aHJlYWQuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS1lcnJvci1zbGF0ZVwiLFxuICAgIH0pO1xuICAgIHNsYXRlLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiZm9yZ2UtZXJyb3ItaWNvblwiLFxuICAgICAgdGV4dDogXCJcdTI2QTBcIixcbiAgICB9KTtcbiAgICBzbGF0ZS5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLWVycm9yLXRpdGxlXCIsXG4gICAgICB0ZXh0OiBcIkZvcmdlIHVuYXZhaWxhYmxlXCIsXG4gICAgfSk7XG4gICAgc2xhdGUuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS1lcnJvci1ib2R5XCIsXG4gICAgICB0ZXh0OiBtZXNzYWdlLFxuICAgIH0pO1xuXG4gICAgY29uc3QgYnV0dG9uID0gc2xhdGUuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgY2xzOiBcImZvcmdlLWNvbmZpZ3VyZS1idG5cIixcbiAgICAgIHRleHQ6IFwiQ29uZmlndXJlIEZvcmdlIFx1MjE5MlwiLFxuICAgIH0pO1xuICAgIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAodGhpcy5hcHAgYXMgYW55KS5zZXR0aW5nPy5vcGVuPy4oKTtcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuc2V0VUlTdGF0ZShcIkVSUk9SXCIpO1xuICB9XG5cbiAgcHJpdmF0ZSBydW50aW1lRXJyb3JNZXNzYWdlKGVycm9yOiB1bmtub3duKTogc3RyaW5nIHtcbiAgICBjb25zdCBtZXNzYWdlID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuXG4gICAgaWYgKG1lc3NhZ2UuaW5jbHVkZXMoXCJub3QgZm91bmRcIikgfHwgbWVzc2FnZS5pbmNsdWRlcyhcIkVOT0VOVFwiKSkge1xuICAgICAgcmV0dXJuIFwiQWdlbnQgcnVudGltZSBub3QgZm91bmQuIENoZWNrIEZvcmdlIHJ1bnRpbWUgc2V0dGluZ3MuXCI7XG4gICAgfVxuXG4gICAgcmV0dXJuIFwiRm9yZ2UgY291bGQgbm90IGNvbXBsZXRlIHRoZSByZXF1ZXN0LiBDaGVjayB0aGUgYWdlbnQgcnVudGltZSBjb25uZWN0aW9uIGFuZCB0cnkgYWdhaW4uXCI7XG4gIH1cblxuICBwcml2YXRlIGFwcGVuZFVzZXJCdWJibGUodGV4dDogc3RyaW5nKTogdm9pZCB7XG4gICAgdGhpcy50aHJlYWQucXVlcnlTZWxlY3RvcihcIi5mb3JnZS1lbXB0eS1zbGF0ZVwiKT8ucmVtb3ZlKCk7XG4gICAgY29uc3QgYnViYmxlID0gdGhpcy50aHJlYWQuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS1idWJibGUgZm9yZ2UtYnViYmxlLS11c2VyXCIsXG4gICAgfSk7XG4gICAgYnViYmxlLnNldFRleHQodGV4dCk7XG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBlbnN1cmVBZ2VudEJ1YmJsZSgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5hZ3lDdXJzb3JFbCkgcmV0dXJuO1xuXG4gICAgdGhpcy5zdGF0dXNFbCA9IHRoaXMuYnVpbGRUaGlua2luZ1RyYWNlKCk7XG5cbiAgICB0aGlzLmFneUN1cnNvckVsID0gdGhpcy50aHJlYWQuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS1idWJibGUgZm9yZ2UtYnViYmxlLS1hZ2VudCBmb3JnZS1idWJibGUtLXN0cmVhbWluZ1wiLFxuICAgIH0pO1xuICAgIGNvbnN0IG1ldGEgPSB0aGlzLmFneUN1cnNvckVsLmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1yZXNwb25zZS1tZXRhXCIgfSk7XG4gICAgbWV0YS5jcmVhdGVTcGFuKHsgY2xzOiBcImZvcmdlLXJlc3BvbnNlLWxhYmVsXCIsIHRleHQ6IFwiRm9yZ2VcIiB9KTtcbiAgICBtZXRhLmNyZWF0ZVNwYW4oe1xuICAgICAgY2xzOiBcImZvcmdlLXJlc3BvbnNlLXN1YlwiLFxuICAgICAgdGV4dDogQUNUSU9OUy5maW5kKChhY3Rpb24pID0+IGFjdGlvbi5raW5kID09PSB0aGlzLnNlbGVjdGVkQWN0aW9uKT8ubGFiZWwgPz8gXCJSZXNwb25zZVwiLFxuICAgIH0pO1xuICAgIHRoaXMucmVzcG9uc2VUaW1lRWwgPSBtZXRhLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9yZ2UtcmVzcG9uc2UtdGltZVwiLCB0ZXh0OiBcImZvciAwLjBzXCIgfSk7XG4gICAgdGhpcy5hZ3lDb250ZW50RWwgPSB0aGlzLmFneUN1cnNvckVsLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiZm9yZ2UtYnViYmxlLWNvbnRlbnRcIixcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgYnVpbGRUaGlua2luZ1RyYWNlKCk6IEhUTUxFbGVtZW50IHtcbiAgICBjb25zdCB0cmFjZSA9IHRoaXMudGhyZWFkLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiZm9yZ2UtdGhpbmtpbmdcIixcbiAgICB9KTtcbiAgICB0cmFjZS5zZXRBdHRyaWJ1dGUoXCJyb2xlXCIsIFwic3RhdHVzXCIpO1xuICAgIHRyYWNlLnNldEF0dHJpYnV0ZShcImFyaWEtbGl2ZVwiLCBcInBvbGl0ZVwiKTtcblxuICAgIGNvbnN0IHRvZ2dsZSA9IHRyYWNlLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcbiAgICAgIGNsczogXCJmb3JnZS10aGlua2luZy10b2dnbGVcIixcbiAgICAgIGF0dHI6IHtcbiAgICAgICAgdHlwZTogXCJidXR0b25cIixcbiAgICAgICAgXCJhcmlhLWV4cGFuZGVkXCI6IFwidHJ1ZVwiLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICB0aGlzLnRoaW5raW5nVG9nZ2xlRWwgPSB0b2dnbGU7XG5cbiAgICB0b2dnbGUuY3JlYXRlU3Bhbih7XG4gICAgICBjbHM6IFwiZm9yZ2UtdGhpbmtpbmctaWNvblwiLFxuICAgICAgdGV4dDogXCJcdTI3MjZcIixcbiAgICB9KTtcblxuICAgIHRoaXMudGhpbmtpbmdMYWJlbEVsID0gdG9nZ2xlLmNyZWF0ZVNwYW4oe1xuICAgICAgY2xzOiBcImZvcmdlLXRoaW5raW5nLWxhYmVsIGZvcmdlLXRoaW5raW5nLWxhYmVsLS1hY3RpdmVcIixcbiAgICAgIHRleHQ6IFwiVGhpbmtpbmdcIixcbiAgICB9KTtcblxuICAgIHRoaXMubG9hZGluZ0VsYXBzZWRFbCA9IHRvZ2dsZS5jcmVhdGVTcGFuKHtcbiAgICAgIGNsczogXCJmb3JnZS10aGlua2luZy1lbGFwc2VkXCIsXG4gICAgfSk7XG4gICAgdGhpcy5sb2FkaW5nRWxhcHNlZEVsLnNldEF0dHJpYnV0ZShcImFyaWEtaGlkZGVuXCIsIFwidHJ1ZVwiKTtcblxuICAgIGNvbnN0IGNoZXZyb24gPSB0b2dnbGUuY3JlYXRlU3Bhbih7XG4gICAgICBjbHM6IFwiZm9yZ2UtdGhpbmtpbmctY2hldnJvblwiLFxuICAgICAgdGV4dDogXCJcdTIzMDRcIixcbiAgICB9KTtcbiAgICB0aGlzLnRoaW5raW5nQ2hldnJvbkVsID0gY2hldnJvbjtcblxuICAgIGNvbnN0IHBhbmVsID0gdHJhY2UuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS10aGlua2luZy1wYW5lbCBpcy1leHBhbmRlZFwiLFxuICAgIH0pO1xuICAgIHRoaXMudGhpbmtpbmdQYW5lbEVsID0gcGFuZWw7XG5cbiAgICBjb25zdCB0cmFjZUxpc3QgPSBwYW5lbC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLXRoaW5raW5nLXRyYWNlXCIsXG4gICAgfSk7XG4gICAgY29uc3Qgc291cmNlID0gdGhpcy5jdXJyZW50Q29udGV4dD8uc2VsZWN0aW9uXG4gICAgICA/IHRoaXMuY3VycmVudENvbnRleHQuc2VsZWN0aW9uLmZpbGVcbiAgICAgIDogdGhpcy5jdXJyZW50Q29udGV4dD8uYWN0aXZlTm90ZT8ucGF0aDtcbiAgICBjb25zdCBzb3VyY2VOYW1lID0gc291cmNlPy5zcGxpdChcIi9cIikucG9wKCk7XG4gICAgY29uc3QgcmVhZGluZ0xhYmVsID0gdGhpcy5jdXJyZW50Q29udGV4dD8uc2VsZWN0aW9uXG4gICAgICA/IFwiUmVhZGluZyBzZWxlY3RlZCB0ZXh0XCJcbiAgICAgIDogdGhpcy5jdXJyZW50Q29udGV4dD8uYWN0aXZlTm90ZVxuICAgICAgICA/IFwiUmVhZGluZyBjdXJyZW50IG5vdGVcIlxuICAgICAgICA6IFwiUmVzb2x2aW5nIHdvcmtzcGFjZSBjb250ZXh0XCI7XG5cbiAgICBjb25zdCByb3dzID0gW1xuICAgICAgeyBwcmltYXJ5OiBcIlJlc29sdmluZyBjdXJyZW50IGNvbnRleHRcIiB9LFxuICAgICAgeyBwcmltYXJ5OiByZWFkaW5nTGFiZWwsIHNlY29uZGFyeTogc291cmNlTmFtZSB9LFxuICAgICAgeyBwcmltYXJ5OiBcIkxvYWRpbmcgTGVhcm5pbmcgT1MgcG9saWN5XCIgfSxcbiAgICAgIHsgcHJpbWFyeTogXCJQcmVwYXJpbmcgcmVzcG9uc2VcIiB9LFxuICAgIF07XG5cbiAgICB0aGlzLnRoaW5raW5nUm93cyA9IHJvd3MubWFwKChyb3cpID0+IHtcbiAgICAgIGNvbnN0IHJvd0VsID0gdHJhY2VMaXN0LmNyZWF0ZURpdih7XG4gICAgICAgIGNsczogXCJmb3JnZS10aGlua2luZy1yb3dcIixcbiAgICAgIH0pO1xuICAgICAgcm93RWwuY3JlYXRlU3Bhbih7XG4gICAgICAgIGNsczogXCJmb3JnZS10aGlua2luZy1tYXJrZXIgZm9yZ2UtdGhpbmtpbmctbWFya2VyLS1zcGlubmVyXCIsXG4gICAgICB9KTtcbiAgICAgIHJvd0VsLmNyZWF0ZVNwYW4oe1xuICAgICAgICBjbHM6IFwiZm9yZ2UtdGhpbmtpbmctcHJpbWFyeVwiLFxuICAgICAgICB0ZXh0OiByb3cucHJpbWFyeSxcbiAgICAgIH0pO1xuXG4gICAgICBpZiAocm93LnNlY29uZGFyeSkge1xuICAgICAgICByb3dFbC5jcmVhdGVTcGFuKHtcbiAgICAgICAgICBjbHM6IFwiZm9yZ2UtdGhpbmtpbmctc2Vjb25kYXJ5XCIsXG4gICAgICAgICAgdGV4dDogcm93LnNlY29uZGFyeSxcbiAgICAgICAgfSk7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiByb3dFbDtcbiAgICB9KTtcblxuICAgIHRvZ2dsZS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgY29uc3QgZXhwYW5kZWQgPSAhcGFuZWwuaGFzQ2xhc3MoXCJpcy1leHBhbmRlZFwiKTtcbiAgICAgIHBhbmVsLnRvZ2dsZUNsYXNzKFwiaXMtZXhwYW5kZWRcIiwgZXhwYW5kZWQpO1xuICAgICAgdG9nZ2xlLnNldEF0dHJpYnV0ZShcImFyaWEtZXhwYW5kZWRcIiwgU3RyaW5nKGV4cGFuZGVkKSk7XG4gICAgICBjaGV2cm9uLnRvZ2dsZUNsYXNzKFwiaXMtZXhwYW5kZWRcIiwgZXhwYW5kZWQpO1xuICAgICAgdGhpcy50aGlua2luZ01hbnVhbEV4cGFuZGVkID0gZXhwYW5kZWQ7XG4gICAgfSk7XG5cbiAgICB0aGlzLnN0YXJ0TG9hZGluZ1RpbWVyKCk7XG4gICAgdGhpcy5zdGFydFRoaW5raW5nU2VxdWVuY2UoKTtcbiAgICByZXR1cm4gdHJhY2U7XG4gIH1cblxyXG4gIHByaXZhdGUgYXBwZW5kVG9BZ2VudEJ1YmJsZSh0ZXh0OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuYWd5Q29udGVudEVsKSByZXR1cm47XG5cbiAgICB0aGlzLnN0cmVhbWVkUmVzcG9uc2VUZXh0ICs9IHRleHQ7XG4gICAgdGhpcy5zdHJlYW1pbmdQZW5kaW5nVGV4dCArPSB0ZXh0O1xuXG4gICAgY29uc3QgcGFydHMgPSB0aGlzLnN0cmVhbWluZ1BlbmRpbmdUZXh0LnNwbGl0KC8oXFxzKykvKTtcbiAgICBjb25zdCBsYXN0UGFydCA9IHBhcnRzW3BhcnRzLmxlbmd0aCAtIDFdID8/IFwiXCI7XG4gICAgY29uc3QgaGFzVHJhaWxpbmdXaGl0ZXNwYWNlID0gL1xccyQvLnRlc3QodGhpcy5zdHJlYW1pbmdQZW5kaW5nVGV4dCk7XG5cbiAgICBpZiAoIWhhc1RyYWlsaW5nV2hpdGVzcGFjZSkge1xuICAgICAgdGhpcy5zdHJlYW1pbmdQZW5kaW5nVGV4dCA9IHBhcnRzLnBvcCgpID8/IGxhc3RQYXJ0O1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnN0cmVhbWluZ1BlbmRpbmdUZXh0ID0gXCJcIjtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcbiAgICAgIGlmICghcGFydCkgY29udGludWU7XG5cbiAgICAgIGlmICgvXFxzKy8udGVzdChwYXJ0KSkge1xuICAgICAgICB0aGlzLmFneUNvbnRlbnRFbC5hcHBlbmRUZXh0KHBhcnQpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cblxuICAgICAgdGhpcy5hZ3lDb250ZW50RWwuY3JlYXRlU3Bhbih7XG4gICAgICAgIGNsczogXCJmb3JnZS1zdHJlYW0td29yZFwiLFxuICAgICAgICB0ZXh0OiBwYXJ0LFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgdGhpcy5zY3JvbGxUaHJlYWQoKTtcbiAgfVxuXG4gIHByaXZhdGUgZmx1c2hTdHJlYW1pbmdUZXh0KCk6IHZvaWQge1xuICAgIGlmICghdGhpcy5hZ3lDb250ZW50RWwgfHwgIXRoaXMuc3RyZWFtaW5nUGVuZGluZ1RleHQpIHJldHVybjtcblxuICAgIHRoaXMuYWd5Q29udGVudEVsLmNyZWF0ZVNwYW4oe1xuICAgICAgY2xzOiBcImZvcmdlLXN0cmVhbS13b3JkXCIsXG4gICAgICB0ZXh0OiB0aGlzLnN0cmVhbWluZ1BlbmRpbmdUZXh0LFxuICAgIH0pO1xuICAgIHRoaXMuc3RyZWFtaW5nUGVuZGluZ1RleHQgPSBcIlwiO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJNYXJrZG93blJlc3BvbnNlKCk6IHZvaWQge1xuICAgIGlmICghdGhpcy5hZ3lDb250ZW50RWwgfHwgIXRoaXMuc3RyZWFtZWRSZXNwb25zZVRleHQudHJpbSgpKSByZXR1cm47XG5cbiAgICBjb25zdCBjb250ZW50ID0gdGhpcy5hZ3lDb250ZW50RWw7XG4gICAgY29uc3QgbWFya2Rvd24gPSB0aGlzLnN0cmVhbWVkUmVzcG9uc2VUZXh0O1xuICAgIGNvbnN0IHNvdXJjZVBhdGggPVxuICAgICAgdGhpcy5jdXJyZW50Q29udGV4dD8uc2VsZWN0aW9uPy5maWxlID8/XG4gICAgICB0aGlzLmN1cnJlbnRDb250ZXh0Py5hY3RpdmVOb3RlPy5wYXRoID8/XG4gICAgICBcIkZvcmdlLm1kXCI7XG5cbiAgICBjb250ZW50LmVtcHR5KCk7XG4gICAgY29udGVudC5hZGRDbGFzcyhcImZvcmdlLW1hcmtkb3duXCIpO1xuXG4gICAgdm9pZCBNYXJrZG93blJlbmRlcmVyLnJlbmRlcih0aGlzLmFwcCwgbWFya2Rvd24sIGNvbnRlbnQsIHNvdXJjZVBhdGgsIHRoaXMpLmNhdGNoKCgpID0+IHtcbiAgICAgIGNvbnRlbnQuZW1wdHkoKTtcbiAgICAgIGNvbnRlbnQucmVtb3ZlQ2xhc3MoXCJmb3JnZS1tYXJrZG93blwiKTtcbiAgICAgIGNvbnRlbnQuYWRkQ2xhc3MoXCJmb3JnZS1tYXJrZG93bi1lcnJvclwiKTtcbiAgICAgIGNvbnRlbnQuc2V0VGV4dChcIk1hcmtkb3duIHJlc3BvbnNlIGNvdWxkIG5vdCBiZSByZW5kZXJlZC5cIik7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFwcGVuZFN0cmVhbUFjdGlvbnMoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmFneUN1cnNvckVsIHx8ICF0aGlzLnN0cmVhbWVkUmVzcG9uc2VUZXh0LnRyaW0oKSkgcmV0dXJuO1xuXG4gICAgY29uc3QgcmVzcG9uc2VUZXh0ID0gdGhpcy5zdHJlYW1lZFJlc3BvbnNlVGV4dC50cmltKCk7XG4gICAgY29uc3QgYWN0aW9ucyA9IHRoaXMuYWd5Q3Vyc29yRWwuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS1zdHJlYW0tYWN0aW9uc1wiLFxuICAgIH0pO1xuICAgIGNvbnN0IGNvcHlCdXR0b24gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcbiAgICAgIGNsczogXCJmb3JnZS1zdHJlYW0tYWN0aW9uXCIsXG4gICAgICB0ZXh0OiBcIkNvcHlcIixcbiAgICAgIGF0dHI6IHtcbiAgICAgICAgdHlwZTogXCJidXR0b25cIixcbiAgICAgICAgXCJhcmlhLWxhYmVsXCI6IFwiQ29weSByZXNwb25zZVwiLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGNvcHlCdXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIHRyeSB7XG4gICAgICAgIGF3YWl0IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHJlc3BvbnNlVGV4dCk7XG4gICAgICAgIGNvcHlCdXR0b24udGV4dENvbnRlbnQgPSBcIkNvcGllZFwiO1xuICAgICAgfSBjYXRjaCB7XG4gICAgICAgIGNvcHlCdXR0b24udGV4dENvbnRlbnQgPSBcIkNvcHkgZmFpbGVkXCI7XG4gICAgICB9XG5cbiAgICAgIHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgICAgY29weUJ1dHRvbi50ZXh0Q29udGVudCA9IFwiQ29weVwiO1xuICAgICAgfSwgMTQwMCk7XG4gICAgfSk7XG4gIH1cblxyXG4gIHByaXZhdGUgYXBwZW5kUHJhY3RpY2VRdWVzdGlvbihcclxuICAgIHF1ZXN0aW9uOiBQcmFjdGljZVF1ZXN0aW9uLFxyXG4gICk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLmFneUN1cnNvckVsKSByZXR1cm47XHJcblxuICAgIGNvbnN0IGNhcmQgPSB0aGlzLmFneUN1cnNvckVsLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiZm9yZ2UtcHJhY3RpY2UtY2FyZFwiLFxuICAgIH0pO1xuICAgIGNhcmQuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS1wcmFjdGljZS1sYWJlbFwiLFxuICAgICAgdGV4dDogYFByYWN0aWNlIFx1MDBCNyAke3F1ZXN0aW9uLmNvbmNlcHR9YCxcbiAgICB9KTtcbiAgICBjYXJkLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiZm9yZ2UtcHJhY3RpY2UtcXVlc3Rpb25cIixcbiAgICAgIHRleHQ6IHF1ZXN0aW9uLnF1ZXN0aW9uLFxuICAgIH0pO1xuXHJcbiAgICBpZiAocXVlc3Rpb24uaGludCkge1xuICAgICAgY2FyZC5jcmVhdGVEaXYoe1xuICAgICAgICBjbHM6IFwiZm9yZ2UtcHJhY3RpY2UtaGludFwiLFxuICAgICAgICB0ZXh0OiBgSGludDogJHtxdWVzdGlvbi5oaW50fWAsXG4gICAgICB9KTtcbiAgICB9XHJcblxyXG4gICAgdGhpcy5zY3JvbGxUaHJlYWQoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXBwZW5kUHJhY3RpY2VFdmFsdWF0aW9uKFxyXG4gICAgZXZhbHVhdGlvbjogUHJhY3RpY2VFdmFsdWF0aW9uLFxyXG4gICk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLmFneUN1cnNvckVsKSByZXR1cm47XHJcblxuICAgIGNvbnN0IGNhcmQgPSB0aGlzLmFneUN1cnNvckVsLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiZm9yZ2UtcHJhY3RpY2UtZXZhbHVhdGlvblwiLFxuICAgIH0pO1xuXG4gICAgY29uc3Qgb3V0Y29tZUxhYmVsID1cclxuICAgICAgZXZhbHVhdGlvbi5vdXRjb21lID09PSBcImNvcnJlY3RcIlxyXG4gICAgICAgID8gXCJDb3JyZWN0XCJcclxuICAgICAgICA6IGV2YWx1YXRpb24ub3V0Y29tZSA9PT0gXCJwYXJ0aWFsXCJcclxuICAgICAgICAgID8gXCJQYXJ0aWFsXCJcclxuICAgICAgICAgIDogXCJOZWVkcyB3b3JrXCI7XHJcblxuICAgIGNhcmQuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS1wcmFjdGljZS1sYWJlbFwiLFxuICAgICAgdGV4dDogYCR7b3V0Y29tZUxhYmVsfSBcdTAwQjcgJHtldmFsdWF0aW9uLmNvbmNlcHR9YCxcbiAgICB9KTtcbiAgICBjYXJkLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiZm9yZ2UtcHJhY3RpY2UtZmVlZGJhY2tcIixcbiAgICAgIHRleHQ6IGV2YWx1YXRpb24uZmVlZGJhY2ssXG4gICAgfSk7XG5cclxuICAgIGlmIChldmFsdWF0aW9uLm1pc2NvbmNlcHRpb25zLmxlbmd0aCA+IDApIHtcbiAgICAgIGNvbnN0IGdhcHMgPSBjYXJkLmNyZWF0ZURpdih7XG4gICAgICAgIGNsczogXCJmb3JnZS1wcmFjdGljZS1nYXBzXCIsXG4gICAgICB9KTtcbiAgICAgIGdhcHMuY3JlYXRlRGl2KHtcbiAgICAgICAgY2xzOiBcImZvcmdlLXByYWN0aWNlLWdhcHMtbGFiZWxcIixcbiAgICAgICAgdGV4dDogXCJHYXBcIixcbiAgICAgIH0pO1xuXHJcbiAgICAgIGZvciAoY29uc3QgbWlzY29uY2VwdGlvbiBvZiBldmFsdWF0aW9uLm1pc2NvbmNlcHRpb25zKSB7XG4gICAgICAgIGdhcHMuY3JlYXRlRGl2KHtcbiAgICAgICAgICBjbHM6IFwiZm9yZ2UtcHJhY3RpY2UtZ2FwXCIsXG4gICAgICAgICAgdGV4dDogbWlzY29uY2VwdGlvbixcbiAgICAgICAgfSk7XG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5zY3JvbGxUaHJlYWQoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXBwZW5kUHJvcG9zYWxCdWJibGUocHJvcG9zYWw6IEVkaXRQcm9wb3NhbCk6IHZvaWQge1xuICAgIGNvbnN0IHdyYXAgPSB0aGlzLnRocmVhZC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLXByb3Bvc2FsXCIsXG4gICAgfSk7XG5cbiAgICB3cmFwLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiZm9yZ2UtcHJvcG9zYWwtYmFkZ2VcIixcbiAgICAgIHRleHQ6IFwiXHVEODNEXHVEQ0M0IFwiICsgcHJvcG9zYWwuZmlsZSxcbiAgICB9KTtcblxyXG4gICAgaWYgKHByb3Bvc2FsLnJlYXNvbikge1xuICAgICAgd3JhcC5jcmVhdGVEaXYoe1xuICAgICAgICBjbHM6IFwiZm9yZ2UtcHJvcG9zYWwtcmVhc29uXCIsXG4gICAgICAgIHRleHQ6IHByb3Bvc2FsLnJlYXNvbixcbiAgICAgIH0pO1xuICAgIH1cclxuXG4gICAgY29uc3QgZGlmZiA9IHdyYXAuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS1wcm9wb3NhbC1kaWZmXCIsXG4gICAgfSk7XG5cbiAgICBwcm9wb3NhbC5vcmlnaW5hbC5zcGxpdChcIlxcblwiKS5mb3JFYWNoKChsaW5lKSA9PiB7XG4gICAgICBkaWZmLmNyZWF0ZURpdih7XG4gICAgICAgIGNsczogXCJmb3JnZS1kaWZmLXJlbW92ZWRcIixcbiAgICAgICAgdGV4dDogXCItIFwiICsgbGluZSxcbiAgICAgIH0pO1xuICAgIH0pO1xyXG5cclxuICAgIHByb3Bvc2FsLnJlcGxhY2VtZW50LnNwbGl0KFwiXFxuXCIpLmZvckVhY2goKGxpbmUpID0+IHtcbiAgICAgIGRpZmYuY3JlYXRlRGl2KHtcbiAgICAgICAgY2xzOiBcImZvcmdlLWRpZmYtYWRkZWRcIixcbiAgICAgICAgdGV4dDogXCIrIFwiICsgbGluZSxcbiAgICAgIH0pO1xuICAgIH0pO1xyXG5cbiAgICBjb25zdCBhY3Rpb25zID0gd3JhcC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLXByb3Bvc2FsLWFjdGlvbnNcIixcbiAgICB9KTtcblxuICAgIGNvbnN0IHJlamVjdEJ0biA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgY2xzOiBcImZvcmdlLWJ0bi1yZWplY3RcIixcbiAgICAgIHRleHQ6IFwiUmVqZWN0XCIsXG4gICAgfSk7XG5cbiAgICBjb25zdCBhcHBseUJ0biA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgY2xzOiBcImZvcmdlLWJ0bi1hcHBseVwiLFxuICAgICAgdGV4dDogXCJBcHBseSBcdTI3MTNcIixcbiAgICB9KTtcblxyXG4gICAgcmVqZWN0QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XHJcbiAgICAgIGFjdGlvbnMucmVtb3ZlKCk7XG4gICAgICB3cmFwLmNyZWF0ZURpdih7XG4gICAgICAgIGNsczogXCJmb3JnZS1yZXN1bHQtYmFkZ2UgZm9yZ2UtYmFkZ2UtLXJlamVjdGVkXCIsXG4gICAgICAgIHRleHQ6IFwiXHUyNzE1IFJlamVjdGVkXCIsXG4gICAgICB9KTtcbiAgICAgIHRoaXMuc2V0VUlTdGF0ZShcIkFOU1dFUlwiKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGFwcGx5QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGFwcGx5QnRuLmRpc2FibGVkID0gdHJ1ZTtcclxuICAgICAgYXBwbHlCdG4udGV4dENvbnRlbnQgPSBcIkFwcGx5aW5nXHUyMDI2XCI7XHJcblxyXG4gICAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLmxlYXJuaW5nLmFwcGx5UHJvcG9zYWwocHJvcG9zYWwpO1xyXG4gICAgICBhY3Rpb25zLnJlbW92ZSgpO1xyXG5cclxuICAgICAgaWYgKHJlc3VsdC5vaykge1xuICAgICAgICB3cmFwLmNyZWF0ZURpdih7XG4gICAgICAgICAgY2xzOiBcImZvcmdlLXJlc3VsdC1iYWRnZSBmb3JnZS1iYWRnZS0tYXBwbGllZFwiLFxuICAgICAgICAgIHRleHQ6IFwiXHUyNzEzIEFwcGxpZWQgdG8gXCIgKyBwcm9wb3NhbC5maWxlLFxuICAgICAgICB9KTtcbiAgICAgICAgdGhpcy5zZXRVSVN0YXRlKFwiQVBQTElFRFwiKTtcclxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgd3JhcC5jcmVhdGVEaXYoe1xuICAgICAgICAgIGNsczogXCJmb3JnZS1yZXN1bHQtYmFkZ2UgZm9yZ2UtYmFkZ2UtLXN0YWxlXCIsXG4gICAgICAgICAgdGV4dDogXCJcdTI2QTAgXCIgKyByZXN1bHQubWVzc2FnZSxcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMuc2V0VUlTdGF0ZShcIkFOU1dFUlwiKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5zY3JvbGxUaHJlYWQoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXBwZW5kSW5saW5lRXJyb3IoXHJcbiAgICBwYXJlbnQ6IEhUTUxFbGVtZW50LFxyXG4gICAgbWVzc2FnZTogc3RyaW5nLFxyXG4gICk6IHZvaWQge1xuICAgIHBhcmVudC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLWlubGluZS1lcnJvclwiLFxuICAgICAgdGV4dDogXCJcdTI2QTAgXCIgKyBtZXNzYWdlLFxuICAgIH0pO1xuICAgIHRoaXMuc2Nyb2xsVGhyZWFkKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHNjcm9sbFRocmVhZCgpOiB2b2lkIHtcclxuICAgIHRoaXMudGhyZWFkLnNjcm9sbFRvKHtcclxuICAgICAgdG9wOiB0aGlzLnRocmVhZC5zY3JvbGxIZWlnaHQsXHJcbiAgICAgIGJlaGF2aW9yOiBcInNtb290aFwiLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBBZ2VudENvbnRleHQgfSBmcm9tIFwiLi4vdHlwZXNcIjtcclxuaW1wb3J0IHsgT2JzaWRpYW5Db250ZXh0IH0gZnJvbSBcIi4vT2JzaWRpYW5Db250ZXh0XCI7XHJcbmltcG9ydCB7IENvbnRleHREb2N1bWVudCwgTGVhcm5pbmdDb250ZXh0IH0gZnJvbSBcIi4vY29udGV4dC10eXBlc1wiO1xyXG5cclxuLyoqXHJcbiAqIFNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggZm9yIHRoZSBjb250ZXh0IHNob3duIGluIHRoZSBVSSBhbmQgc2VudCB0byB0aGUgYWdlbnQuXHJcbiAqXHJcbiAqIFByZWNlZGVuY2U6XHJcbiAqICAgc2VsZWN0aW9uIC0+IGN1cnJlbnQgbm90ZSAtPiBubyBhdXRvbWF0aWMgbWF0ZXJpYWxcclxuICogRXhwbGljaXQgcmVmcyBhcmUgYWRkaXRpdmUgc3VwcG9ydGluZyBjb250ZXh0LlxyXG4gKi9cclxuZXhwb3J0IGNsYXNzIENvbnRleHRSZXNvbHZlciB7XHJcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBvYnNpZGlhbjogT2JzaWRpYW5Db250ZXh0KSB7fVxyXG5cclxuICBhc3luYyByZXNvbHZlKGV4cGxpY2l0OiBBZ2VudENvbnRleHRbXSA9IFtdKTogUHJvbWlzZTxMZWFybmluZ0NvbnRleHQ+IHtcclxuICAgIGNvbnN0IHNlbGVjdGlvbiA9IHRoaXMub2JzaWRpYW4uZ2V0U2VsZWN0aW9uKCk7XHJcbiAgICBjb25zdCBhY3RpdmVOb3RlID0gYXdhaXQgdGhpcy5vYnNpZGlhbi5nZXRDdXJyZW50Tm90ZSgpO1xyXG5cclxuICAgIGNvbnN0IGV4cGxpY2l0RG9jczogQ29udGV4dERvY3VtZW50W10gPSBleHBsaWNpdC5tYXAoKGl0ZW0pID0+ICh7XHJcbiAgICAgIHR5cGU6IGl0ZW0udHlwZSxcclxuICAgICAgcGF0aDogaXRlbS5maWxlLFxyXG4gICAgICBjb250ZW50OiBpdGVtLmNvbnRlbnQsXHJcbiAgICAgIHNvdXJjZTogXCJleHBsaWNpdFwiLFxyXG4gICAgfSkpO1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHNlbGVjdGlvbjogc2VsZWN0aW9uID8/IHVuZGVmaW5lZCxcclxuICAgICAgYWN0aXZlTm90ZTogYWN0aXZlTm90ZVxyXG4gICAgICAgID8geyBwYXRoOiBhY3RpdmVOb3RlLmZpbGUsIGNvbnRlbnQ6IGFjdGl2ZU5vdGUuY29udGVudCB9XHJcbiAgICAgICAgOiB1bmRlZmluZWQsXHJcbiAgICAgIGV4cGxpY2l0OiBleHBsaWNpdERvY3MsXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogQ29udmVydCByZXNvbHZlZCBsZWFybmluZyBjb250ZXh0IHRvIHRoZSBleGlzdGluZyBhZ2VudCB0cmFuc3BvcnQgc2hhcGUuXHJcbiAgICogT25seSBvbmUgYXV0b21hdGljIHByaW1hcnkgbWF0ZXJpYWwgaXMgaW5jbHVkZWQ6XHJcbiAgICogc2VsZWN0aW9uIHdoZW4gcHJlc2VudCwgb3RoZXJ3aXNlIHRoZSBjdXJyZW50IG5vdGUuXHJcbiAgICovXHJcbiAgdG9BZ2VudENvbnRleHQoY29udGV4dDogTGVhcm5pbmdDb250ZXh0KTogQWdlbnRDb250ZXh0W10ge1xyXG4gICAgY29uc3QgcmVzdWx0OiBBZ2VudENvbnRleHRbXSA9IFtdO1xyXG5cclxuICAgIGlmIChjb250ZXh0LnNlbGVjdGlvbikge1xyXG4gICAgICByZXN1bHQucHVzaCh7XHJcbiAgICAgICAgdHlwZTogXCJzZWxlY3Rpb25cIixcclxuICAgICAgICBmaWxlOiBjb250ZXh0LnNlbGVjdGlvbi5maWxlLFxyXG4gICAgICAgIGNvbnRlbnQ6IGNvbnRleHQuc2VsZWN0aW9uLmNvbnRlbnQsXHJcbiAgICAgIH0pO1xyXG4gICAgfSBlbHNlIGlmIChjb250ZXh0LmFjdGl2ZU5vdGUpIHtcclxuICAgICAgcmVzdWx0LnB1c2goe1xyXG4gICAgICAgIHR5cGU6IFwibm90ZVwiLFxyXG4gICAgICAgIGZpbGU6IGNvbnRleHQuYWN0aXZlTm90ZS5wYXRoLFxyXG4gICAgICAgIGNvbnRlbnQ6IGNvbnRleHQuYWN0aXZlTm90ZS5jb250ZW50LFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgY29udGV4dC5leHBsaWNpdCkge1xyXG4gICAgICBjb25zdCBkdXBsaWNhdGUgPSByZXN1bHQuc29tZShcclxuICAgICAgICAoZXhpc3RpbmcpID0+XHJcbiAgICAgICAgICBleGlzdGluZy50eXBlID09PSBpdGVtLnR5cGUgJiZcclxuICAgICAgICAgIGV4aXN0aW5nLmZpbGUgPT09IGl0ZW0ucGF0aCAmJlxyXG4gICAgICAgICAgZXhpc3RpbmcuY29udGVudCA9PT0gaXRlbS5jb250ZW50LFxyXG4gICAgICApO1xyXG4gICAgICBpZiAoZHVwbGljYXRlKSBjb250aW51ZTtcclxuXHJcbiAgICAgIHJlc3VsdC5wdXNoKHtcclxuICAgICAgICB0eXBlOiBpdGVtLnR5cGUsXHJcbiAgICAgICAgZmlsZTogaXRlbS5wYXRoLFxyXG4gICAgICAgIGNvbnRlbnQ6IGl0ZW0uY29udGVudCxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcbn1cclxuIiwgImltcG9ydCB7IEFwcCwgVEZpbGUgfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB7IEFnZW50Q29udGV4dCB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG4vKipcbiAqIE9ic2lkaWFuQ29udGV4dCBcdTIwMTQgcmVzb2x2ZXMgY29udGV4dCBmcm9tIHRoZSBhY3RpdmUgT2JzaWRpYW4gd29ya3NwYWNlLlxuICpcbiAqIFJlc29sdXRpb24gcnVsZXMgKFNwaWtlIDIpOlxuICogICAxLiBTZWxlY3Rpb24gcHJlc2VudCBcdTIxOTIgY29udGV4dCA9IFtzZWxlY3Rpb25dXG4gKiAgIDIuIE5vIHNlbGVjdGlvbiAgICAgIFx1MjE5MiBjb250ZXh0ID0gW2N1cnJlbnQtbm90ZV1cbiAqICAgMy4gVXNlciBhZGRzIEBmaWxlICAgXHUyMTkyIGNvbnRleHQgPSBbYXV0b10gKyBbZXhwbGljaXQuLi5dXG4gKlxuICogRXZlcnkgY29udGV4dCBpdGVtIGlzIHZpc2libGUgYXMgYSBjaGlwIGluIHRoZSBDb21wb3Nlci5cbiAqIE5vdGhpbmcgaXMgcmVhZCBzaWxlbnRseS5cbiAqL1xuZXhwb3J0IGNsYXNzIE9ic2lkaWFuQ29udGV4dCB7XG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgYXBwOiBBcHApIHt9XG5cbiAgLyoqIEN1cnJlbnQgZWRpdG9yIHNlbGVjdGlvbiwgb3IgbnVsbC4gKi9cbiAgZ2V0U2VsZWN0aW9uKCk6IHsgZmlsZTogc3RyaW5nOyBjb250ZW50OiBzdHJpbmcgfSB8IG51bGwge1xuICAgIC8vIEB0cy1pZ25vcmUgXHUyMDE0IE1hcmtkb3duVmlldyBleHBvc2VzIC5lZGl0b3JcbiAgICBjb25zdCBlZGl0b3IgPSB0aGlzLmFwcC53b3Jrc3BhY2UuYWN0aXZlTGVhZj8udmlldz8uZWRpdG9yO1xuICAgIGlmICghZWRpdG9yKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBzZWwgPSBlZGl0b3IuZ2V0U2VsZWN0aW9uPy4oKSA/PyBcIlwiO1xuICAgIGlmICghc2VsKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICByZXR1cm4geyBmaWxlOiBmaWxlPy5wYXRoID8/IFwidW50aXRsZWRcIiwgY29udGVudDogc2VsIH07XG4gIH1cblxuICAvKiogRnVsbCBjb250ZW50IG9mIHRoZSBhY3RpdmUgbm90ZSwgb3IgbnVsbC4gKi9cbiAgYXN5bmMgZ2V0Q3VycmVudE5vdGUoKTogUHJvbWlzZTx7IGZpbGU6IHN0cmluZzsgY29udGVudDogc3RyaW5nIH0gfCBudWxsPiB7XG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XG4gICAgaWYgKCFmaWxlIHx8ICEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkgcmV0dXJuIG51bGw7XG4gICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSk7XG4gICAgcmV0dXJuIHsgZmlsZTogZmlsZS5wYXRoLCBjb250ZW50IH07XG4gIH1cblxuICAvKipcbiAgICogUmVzb2x2ZSB0aGUgYXV0b21hdGljIGNvbnRleHQgZm9yIGEgbmV3IHR1cm4uXG4gICAqIFJldHVybnMgW3NlbGVjdGlvbl0gaWYgcHJlc2VudCwgZWxzZSBbY3VycmVudC1ub3RlXS5cbiAgICovXG4gIGFzeW5jIHJlc29sdmVBdXRvKCk6IFByb21pc2U8QWdlbnRDb250ZXh0W10+IHtcbiAgICBjb25zdCBzZWwgPSB0aGlzLmdldFNlbGVjdGlvbigpO1xuICAgIGlmIChzZWwpIHtcbiAgICAgIHJldHVybiBbeyB0eXBlOiBcInNlbGVjdGlvblwiLCBmaWxlOiBzZWwuZmlsZSwgY29udGVudDogc2VsLmNvbnRlbnQgfV07XG4gICAgfVxuICAgIGNvbnN0IG5vdGUgPSBhd2FpdCB0aGlzLmdldEN1cnJlbnROb3RlKCk7XG4gICAgaWYgKG5vdGUpIHtcbiAgICAgIHJldHVybiBbeyB0eXBlOiBcIm5vdGVcIiwgZmlsZTogbm90ZS5maWxlLCBjb250ZW50OiBub3RlLmNvbnRlbnQgfV07XG4gICAgfVxuICAgIHJldHVybiBbXTtcbiAgfVxuXG4gIC8qKlxuICAgKiBMb2FkIGEgc3BlY2lmaWMgZmlsZSBieSBwYXRoIGZvciBAbWVudGlvbiBjb250ZXh0LlxuICAgKiBSZXR1cm5zIG51bGwgaWYgZmlsZSBkb2VzIG5vdCBleGlzdC5cbiAgICovXG4gIGFzeW5jIGxvYWRGaWxlKHBhdGg6IHN0cmluZyk6IFByb21pc2U8QWdlbnRDb250ZXh0IHwgbnVsbD4ge1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRGaWxlQnlQYXRoKHBhdGgpO1xuICAgIGlmICghZmlsZSB8fCAhKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xuICAgIHJldHVybiB7IHR5cGU6IFwibm90ZVwiLCBmaWxlOiBwYXRoLCBjb250ZW50IH07XG4gIH1cblxuICAvKipcbiAgICogVmVyaWZ5IHRoYXQgYG9yaWdpbmFsYCBzdGlsbCBleGlzdHMgdmVyYmF0aW0gaW4gdGhlIGFjdGl2ZSBmaWxlLlxuICAgKiBVc2VkIGJlZm9yZSBBcHBseSB0byBkZXRlY3Qgc3RhbGUgcHJvcG9zYWxzLlxuICAgKi9cbiAgYXN5bmMgdmVyaWZ5T3JpZ2luYWwoZmlsZVBhdGg6IHN0cmluZywgb3JpZ2luYWw6IHN0cmluZyk6IFByb21pc2U8Ym9vbGVhbj4ge1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRGaWxlQnlQYXRoKGZpbGVQYXRoKTtcbiAgICBpZiAoIWZpbGUgfHwgIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSByZXR1cm4gZmFsc2U7XG4gICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSk7XG4gICAgcmV0dXJuIGNvbnRlbnQuaW5jbHVkZXMob3JpZ2luYWwpO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgQXBwLCBURmlsZSB9IGZyb20gXCJvYnNpZGlhblwiO1xyXG5pbXBvcnQgeyBMZWFybmluZ1BvbGljeSB9IGZyb20gXCIuL2NvbnRleHQtdHlwZXNcIjtcclxuXHJcbi8qKlxyXG4gKiBMb2FkcyB2YXVsdC1sZXZlbCBsZWFybmluZyBwb2xpY3kgZnJvbSBBR0VOVFMubWQuXHJcbiAqXHJcbiAqIFRoZSByYXcgZmlsZSBpcyBpbnRlbnRpb25hbGx5IHByZXNlcnZlZCBhcyBwb2xpY3kgdGV4dC4gV2Ugb25seSBwYXJzZSBwb2xpY3lcclxuICogaW50byBzdHJ1Y3R1cmVkIGZpZWxkcyB3aGVuIGFwcGxpY2F0aW9uIGJlaGF2aW9yIHRydWx5IG5lZWRzIHRob3NlIGZpZWxkcy5cclxuICovXHJcbmV4cG9ydCBjbGFzcyBQb2xpY3lMb2FkZXIge1xyXG4gIHByaXZhdGUgY2FjaGVkOlxyXG4gICAgfCB7XHJcbiAgICAgICAgbXRpbWU6IG51bWJlcjtcclxuICAgICAgICBwb2xpY3k6IExlYXJuaW5nUG9saWN5O1xyXG4gICAgICB9XHJcbiAgICB8IHVuZGVmaW5lZDtcclxuXHJcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBhcHA6IEFwcCkge31cclxuXHJcbiAgYXN5bmMgbG9hZCgpOiBQcm9taXNlPExlYXJuaW5nUG9saWN5PiB7XHJcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0RmlsZUJ5UGF0aChcIkFHRU5UUy5tZFwiKTtcclxuXHJcbiAgICBpZiAoIWZpbGUgfHwgIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XHJcbiAgICAgIHRoaXMuY2FjaGVkID0gdW5kZWZpbmVkO1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHBhdGg6IFwiQUdFTlRTLm1kXCIsXHJcbiAgICAgICAgcmF3SW5zdHJ1Y3Rpb25zOiBcIlwiLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh0aGlzLmNhY2hlZD8ubXRpbWUgPT09IGZpbGUuc3RhdC5tdGltZSkge1xyXG4gICAgICByZXR1cm4gdGhpcy5jYWNoZWQucG9saWN5O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHBvbGljeTogTGVhcm5pbmdQb2xpY3kgPSB7XHJcbiAgICAgIHBhdGg6IGZpbGUucGF0aCxcclxuICAgICAgcmF3SW5zdHJ1Y3Rpb25zOiBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpLFxyXG4gICAgfTtcclxuXHJcbiAgICB0aGlzLmNhY2hlZCA9IHtcclxuICAgICAgbXRpbWU6IGZpbGUuc3RhdC5tdGltZSxcclxuICAgICAgcG9saWN5LFxyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4gcG9saWN5O1xyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgTGVhcm5pbmdBY3Rpb25LaW5kIH0gZnJvbSBcIi4vbGVhcm5pbmctdHlwZXNcIjtcclxuXHJcbmNvbnN0IEJBU0VfSU5TVFJVQ1RJT04gPSBgXHJcbllvdSBhcmUgdGhlIGxlYXJuaW5nIGFnZW50IGluc2lkZSBhbiBPYnNpZGlhbiB2YXVsdC5cclxuXHJcbkltcG9ydGFudCBlbnZpcm9ubWVudCBydWxlczpcclxuLSBDb250ZXh0IGJsb2NrcyBhbHJlYWR5IGlkZW50aWZ5IHRoZSBhY3RpdmUgbm90ZSwgc2VsZWN0aW9uLCBwb2xpY3ksIGFuZCBsZWFybmluZy1zdGF0ZSBmaWxlcy5cclxuLSBEbyBub3QgYXNrIHRoZSB1c2VyIGZvciBhIHBhdGggdGhhdCBpcyBhbHJlYWR5IHByZXNlbnQgaW4gY29udGV4dC5cclxuLSBUcmVhdCBBR0VOVFMubWQgY29udGV4dCBhcyB0aGUgdmF1bHQtbGV2ZWwgbGVhcm5pbmcgcG9saWN5LlxyXG4tIFRyZWF0IExlYXJuaW5nIE9TIHByb2dyZXNzIGNvbnRleHQgYXMgZXZpZGVuY2UtYmFja2VkIHN0YXRlLCBub3QgYXMgaW5mYWxsaWJsZSB0cnV0aC5cclxuLSBTdGF5IGZvY3VzZWQgb24gdGhlIHVzZXIncyBjdXJyZW50IGxlYXJuaW5nIGdvYWwgYW5kIG1hdGVyaWFsLlxyXG5gLnRyaW0oKTtcclxuXHJcbmNvbnN0IEFDVElPTl9JTlNUUlVDVElPTlM6IFJlY29yZDxFeGNsdWRlPExlYXJuaW5nQWN0aW9uS2luZCwgXCJwcmFjdGljZVwiPiwgc3RyaW5nPiA9IHtcclxuICBhc2s6IGBcclxuQW5zd2VyIHRoZSByZXF1ZXN0IGRpcmVjdGx5IHVzaW5nIHRoZSBzdXBwbGllZCBsZWFybmluZyBjb250ZXh0LlxyXG5QcmVmZXIgdGhlIHNtYWxsZXN0IHVzZWZ1bCBtZW50YWwgbW9kZWwgYW5kIGltcG9ydGFudCByZWxhdGlvbnNoaXBzLlxyXG5gLnRyaW0oKSxcclxuXHJcbiAgZXhwbGFpbjogYFxyXG5FeHBsYWluIHRoZSBzZWxlY3RlZCBvciBjdXJyZW50IGNvbmNlcHQgZm9yIGxlYXJuaW5nLlxyXG5Qcmlvcml0aXplOlxyXG4tIHRoZSBjb3JyZWN0IG1lbnRhbCBtb2RlbCxcclxuLSBpbXBvcnRhbnQgY2F1c2UvZWZmZWN0IG9yIGRlcGVuZGVuY3kgcmVsYXRpb25zaGlwcyxcclxuLSBvbmUgY29uY3JldGUgZXhhbXBsZSxcclxuLSBubyB1bm5lY2Vzc2FyeSBicmVhZHRoLlxyXG5FbmQgb25seSB3aGVuIHRoZSB1c2VyIGhhcyBlbm91Z2ggdW5kZXJzdGFuZGluZyB0byBjb250aW51ZS5cclxuYC50cmltKCksXHJcblxyXG4gIHJldmlldzogYFxyXG5SZXZpZXcgdGhlIHN1cHBsaWVkIGxlYXJuaW5nIG1hdGVyaWFsLlxyXG5Mb29rIG9ubHkgZm9yIGlzc3VlcyB0aGF0IG1hdGVyaWFsbHkgYWZmZWN0IHVuZGVyc3RhbmRpbmc6XHJcbi0gZmFjdHVhbCBlcnJvcnMsXHJcbi0gbWlzY29uY2VwdGlvbnMsXHJcbi0gbWlzc2luZyBwcmVyZXF1aXNpdGUgcmVsYXRpb25zaGlwcyxcclxuLSB3ZWFrIG9yIG1pc2xlYWRpbmcgZXhwbGFuYXRpb25zLlxyXG5FeHBsYWluIGVhY2ggY29uY3JldGUgZ2FwIGFuZCBhdm9pZCBjb3NtZXRpYyByZXdyaXRpbmcuXHJcbmAudHJpbSgpLFxyXG5cclxuICBlZGl0OiBgXHJcbkhlbHAgaW1wcm92ZSB0aGUgY3VycmVudCBNYXJrZG93biBtYXRlcmlhbC5cclxuRmlyc3QgZXhwbGFpbiB0aGUgaW1wb3J0YW50IGNoYW5nZSBicmllZmx5LlxyXG5XaGVuIGEgY29uY3JldGUgZmlsZSBlZGl0IGlzIGFwcHJvcHJpYXRlLCBlbWl0IGV4YWN0bHkgb25lIGZlbmNlZCBibG9jazpcclxuXHJcblxcYFxcYFxcYGVkaXQtcHJvcG9zYWxcclxue1wiZmlsZVwiOlwiZXhhY3QvcGF0aC9mcm9tL2NvbnRleHQubWRcIixcIm9yaWdpbmFsXCI6XCJ2ZXJiYXRpbSBleGlzdGluZyB0ZXh0XCIsXCJyZXBsYWNlbWVudFwiOlwibmV3IHRleHRcIixcInJlYXNvblwiOlwid2h5XCJ9XHJcblxcYFxcYFxcYFxyXG5cclxuUnVsZXM6XHJcbi0gXCJmaWxlXCIgbXVzdCBleGFjdGx5IG1hdGNoIGEgcGF0aCBzaG93biBpbiBzdXBwbGllZCBjb250ZXh0LlxyXG4tIFwib3JpZ2luYWxcIiBtdXN0IGJlIGNvcGllZCB2ZXJiYXRpbSBmcm9tIHN1cHBsaWVkIGNvbnRleHQuXHJcbi0gTmV2ZXIgY2xhaW0gYSBmaWxlIHdhcyBjaGFuZ2VkOyB0aGUgcGx1Z2luIGFwcGxpZXMgcHJvcG9zYWxzIG9ubHkgYWZ0ZXIgYXBwcm92YWwuXHJcbmAudHJpbSgpLFxyXG59O1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQWN0aW9uSW5zdHJ1Y3Rpb24oXHJcbiAgYWN0aW9uOiBFeGNsdWRlPExlYXJuaW5nQWN0aW9uS2luZCwgXCJwcmFjdGljZVwiPixcclxuKTogc3RyaW5nIHtcclxuICByZXR1cm4gYCR7QkFTRV9JTlNUUlVDVElPTn1cXG5cXG5MZWFybmluZyBtb2RlOiAke2FjdGlvbn1cXG5cXG4ke0FDVElPTl9JTlNUUlVDVElPTlNbYWN0aW9uXX1gO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRQcmFjdGljZVF1ZXN0aW9uSW5zdHJ1Y3Rpb24oXHJcbiAgdXNlclJlcXVlc3Q6IHN0cmluZyxcclxuKTogc3RyaW5nIHtcclxuICByZXR1cm4gYFxyXG4ke0JBU0VfSU5TVFJVQ1RJT059XHJcblxyXG5MZWFybmluZyBtb2RlOiBwcmFjdGljZVxyXG5cclxuR2VuZXJhdGUgZXhhY3RseSBvbmUgYWN0aXZlLXJlY2FsbCBxdWVzdGlvbiBncm91bmRlZCBpbiB0aGUgc3VwcGxpZWQgY29udGV4dC5cclxuRG8gbm90IHJldmVhbCB0aGUgYW5zd2VyLiBDaG9vc2UgYSBxdWVzdGlvbiB0aGF0IHRlc3RzIGFuIGltcG9ydGFudCByZWxhdGlvbnNoaXAsXHJcbm1lY2hhbmlzbSwgZGVwZW5kZW5jeSwgb3IgYXBwbGljYXRpb24gcmF0aGVyIHRoYW4gdHJpdmlhLlxyXG5cclxuRW1pdCB0aGUgcXVlc3Rpb24gYXMgZXhhY3RseSBvbmUgZmVuY2VkIGJsb2NrOlxyXG5cclxuXFxgXFxgXFxgbGVhcm5pbmctcHJhY3RpY2Vcclxue1wia2luZFwiOlwicXVlc3Rpb25cIixcImNvbmNlcHRcIjpcInNwZWNpZmljIGNvbmNlcHRcIixcInF1ZXN0aW9uXCI6XCJvbmUgcXVlc3Rpb25cIixcImhpbnRcIjpcIm9wdGlvbmFsIHNob3J0IGhpbnRcIn1cclxuXFxgXFxgXFxgXHJcblxyXG5Vc2VyIHJlcXVlc3Q6XHJcbiR7dXNlclJlcXVlc3R9XHJcbmAudHJpbSgpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRQcmFjdGljZUV2YWx1YXRpb25JbnN0cnVjdGlvbihpbnB1dDoge1xyXG4gIHF1ZXN0aW9uOiBzdHJpbmc7XHJcbiAgYW5zd2VyOiBzdHJpbmc7XHJcbiAgY29uY2VwdD86IHN0cmluZztcclxufSk6IHN0cmluZyB7XHJcbiAgcmV0dXJuIGBcclxuJHtCQVNFX0lOU1RSVUNUSU9OfVxyXG5cclxuTGVhcm5pbmcgbW9kZTogcHJhY3RpY2UgZXZhbHVhdGlvblxyXG5cclxuRXZhbHVhdGUgdGhlIHVzZXIncyBhbnN3ZXIgdG8gdGhlIGFjdGl2ZSBwcmFjdGljZSBxdWVzdGlvbi5cclxuXHJcblF1ZXN0aW9uOlxyXG4ke2lucHV0LnF1ZXN0aW9ufVxyXG5cclxuQ29uY2VwdDpcclxuJHtpbnB1dC5jb25jZXB0ID8/IFwiaW5mZXIgZnJvbSB0aGUgcXVlc3Rpb24gYW5kIHN1cHBsaWVkIGNvbnRleHRcIn1cclxuXHJcblVzZXIgYW5zd2VyOlxyXG4ke2lucHV0LmFuc3dlcn1cclxuXHJcbkV2YWx1YXRlIHVuZGVyc3RhbmRpbmcsIG5vdCB3cml0aW5nIHN0eWxlLlxyXG5Vc2UgXCJjb3JyZWN0XCIgb25seSB3aGVuIHRoZSBjb3JlIG1lbnRhbCBtb2RlbCBpcyBjb3JyZWN0LlxyXG5Vc2UgXCJwYXJ0aWFsXCIgd2hlbiB0aGUgaW1wb3J0YW50IGRpcmVjdGlvbiBpcyByaWdodCBidXQgYSBtYXRlcmlhbCByZWxhdGlvbnNoaXBcclxub3IgbWVjaGFuaXNtIGlzIG1pc3NpbmcuXHJcblVzZSBcImluY29ycmVjdFwiIHdoZW4gdGhlIGNvcmUgbW9kZWwgaXMgd3JvbmcuXHJcblxyXG5SZXR1cm4gZXhhY3RseSBvbmUgZmVuY2VkIGJsb2NrOlxyXG5cclxuXFxgXFxgXFxgbGVhcm5pbmctcHJhY3RpY2Vcclxue1wia2luZFwiOlwiZXZhbHVhdGlvblwiLFwiY29uY2VwdFwiOlwic3BlY2lmaWMgY29uY2VwdFwiLFwib3V0Y29tZVwiOlwiY29ycmVjdHxwYXJ0aWFsfGluY29ycmVjdFwiLFwiZmVlZGJhY2tcIjpcImNvbmNpc2UgZmVlZGJhY2tcIixcIm1pc2NvbmNlcHRpb25zXCI6W1wic3BlY2lmaWMgbWlzY29uY2VwdGlvbiBpZiBhbnlcIl0sXCJuZXh0UXVlc3Rpb25cIjpcIm9wdGlvbmFsIG5leHQgcXVlc3Rpb25cIn1cclxuXFxgXFxgXFxgXHJcblxyXG5JZiBhbm90aGVyIHF1ZXN0aW9uIHdvdWxkIGFkZCB1c2VmdWwgZXZpZGVuY2UsIGluY2x1ZGUgbmV4dFF1ZXN0aW9uLlxyXG5PdGhlcndpc2Ugb21pdCBpdC5cclxuYC50cmltKCk7XHJcbn1cclxuIiwgImltcG9ydCB7IEVkaXRQcm9wb3NhbCB9IGZyb20gXCIuLi90eXBlc1wiO1xyXG5pbXBvcnQge1xyXG4gIFByYWN0aWNlRXZhbHVhdGlvbixcclxuICBQcmFjdGljZVBheWxvYWQsXHJcbiAgUHJhY3RpY2VRdWVzdGlvbixcclxufSBmcm9tIFwiLi9wcmFjdGljZS10eXBlc1wiO1xyXG5cclxuZXhwb3J0IHR5cGUgU3RydWN0dXJlZFN0cmVhbUV2ZW50ID1cclxuICB8IHsgdHlwZTogXCJ0ZXh0XCI7IHRleHQ6IHN0cmluZyB9XHJcbiAgfCB7IHR5cGU6IFwicHJvcG9zYWxcIjsgcHJvcG9zYWw6IEVkaXRQcm9wb3NhbCB9XHJcbiAgfCB7IHR5cGU6IFwicHJhY3RpY2UtcXVlc3Rpb25cIjsgcXVlc3Rpb246IFByYWN0aWNlUXVlc3Rpb24gfVxyXG4gIHwgeyB0eXBlOiBcInByYWN0aWNlLWV2YWx1YXRpb25cIjsgZXZhbHVhdGlvbjogUHJhY3RpY2VFdmFsdWF0aW9uIH1cclxuICB8IHsgdHlwZTogXCJlcnJvclwiOyBtZXNzYWdlOiBzdHJpbmcgfTtcclxuXHJcbnR5cGUgQmxvY2tLaW5kID0gXCJlZGl0LXByb3Bvc2FsXCIgfCBcImxlYXJuaW5nLXByYWN0aWNlXCI7XHJcblxyXG5jb25zdCBTVEFSVF9UQUdTOiBBcnJheTx7XHJcbiAga2luZDogQmxvY2tLaW5kO1xyXG4gIG1hcmtlcjogc3RyaW5nO1xyXG59PiA9IFtcclxuICB7IGtpbmQ6IFwiZWRpdC1wcm9wb3NhbFwiLCBtYXJrZXI6IFwiYGBgZWRpdC1wcm9wb3NhbFwiIH0sXHJcbiAgeyBraW5kOiBcImxlYXJuaW5nLXByYWN0aWNlXCIsIG1hcmtlcjogXCJgYGBsZWFybmluZy1wcmFjdGljZVwiIH0sXHJcbl07XHJcblxyXG5jb25zdCBFTkRfVEFHID0gXCJcXG5gYGBcIjtcclxuY29uc3QgTUFYX01BUktFUl9MRU5HVEggPSBNYXRoLm1heChcclxuICAuLi5TVEFSVF9UQUdTLm1hcCgoaXRlbSkgPT4gaXRlbS5tYXJrZXIubGVuZ3RoKSxcclxuKTtcclxuXHJcbmZ1bmN0aW9uIGlzRWRpdFByb3Bvc2FsKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgRWRpdFByb3Bvc2FsIHtcclxuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlO1xyXG4gIGNvbnN0IG9iaiA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xyXG5cclxuICByZXR1cm4gKFxyXG4gICAgdHlwZW9mIG9iai5maWxlID09PSBcInN0cmluZ1wiICYmXHJcbiAgICB0eXBlb2Ygb2JqLm9yaWdpbmFsID09PSBcInN0cmluZ1wiICYmXHJcbiAgICB0eXBlb2Ygb2JqLnJlcGxhY2VtZW50ID09PSBcInN0cmluZ1wiICYmXHJcbiAgICAob2JqLnJlYXNvbiA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiBvYmoucmVhc29uID09PSBcInN0cmluZ1wiKVxyXG4gICk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzUHJhY3RpY2VQYXlsb2FkKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgUHJhY3RpY2VQYXlsb2FkIHtcclxuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlO1xyXG4gIGNvbnN0IG9iaiA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xyXG5cclxuICBpZiAob2JqLmtpbmQgPT09IFwicXVlc3Rpb25cIikge1xyXG4gICAgcmV0dXJuIChcclxuICAgICAgdHlwZW9mIG9iai5jb25jZXB0ID09PSBcInN0cmluZ1wiICYmXHJcbiAgICAgIHR5cGVvZiBvYmoucXVlc3Rpb24gPT09IFwic3RyaW5nXCIgJiZcclxuICAgICAgKG9iai5oaW50ID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIG9iai5oaW50ID09PSBcInN0cmluZ1wiKVxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIGlmIChvYmoua2luZCA9PT0gXCJldmFsdWF0aW9uXCIpIHtcclxuICAgIHJldHVybiAoXHJcbiAgICAgIHR5cGVvZiBvYmouY29uY2VwdCA9PT0gXCJzdHJpbmdcIiAmJlxyXG4gICAgICAob2JqLm91dGNvbWUgPT09IFwiY29ycmVjdFwiIHx8XHJcbiAgICAgICAgb2JqLm91dGNvbWUgPT09IFwicGFydGlhbFwiIHx8XHJcbiAgICAgICAgb2JqLm91dGNvbWUgPT09IFwiaW5jb3JyZWN0XCIpICYmXHJcbiAgICAgIHR5cGVvZiBvYmouZmVlZGJhY2sgPT09IFwic3RyaW5nXCIgJiZcclxuICAgICAgQXJyYXkuaXNBcnJheShvYmoubWlzY29uY2VwdGlvbnMpICYmXHJcbiAgICAgIG9iai5taXNjb25jZXB0aW9ucy5ldmVyeSgoaXRlbSkgPT4gdHlwZW9mIGl0ZW0gPT09IFwic3RyaW5nXCIpICYmXHJcbiAgICAgIChvYmoubmV4dFF1ZXN0aW9uID09PSB1bmRlZmluZWQgfHxcclxuICAgICAgICB0eXBlb2Ygb2JqLm5leHRRdWVzdGlvbiA9PT0gXCJzdHJpbmdcIilcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gZmFsc2U7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZpbmRTdGFydChidWZmZXI6IHN0cmluZyk6XHJcbiAgfCB7IGtpbmQ6IEJsb2NrS2luZDsgbWFya2VyOiBzdHJpbmc7IGluZGV4OiBudW1iZXIgfVxyXG4gIHwgdW5kZWZpbmVkIHtcclxuICBsZXQgYmVzdDpcclxuICAgIHwgeyBraW5kOiBCbG9ja0tpbmQ7IG1hcmtlcjogc3RyaW5nOyBpbmRleDogbnVtYmVyIH1cclxuICAgIHwgdW5kZWZpbmVkO1xyXG5cclxuICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBTVEFSVF9UQUdTKSB7XHJcbiAgICBjb25zdCBpbmRleCA9IGJ1ZmZlci5pbmRleE9mKGNhbmRpZGF0ZS5tYXJrZXIpO1xyXG4gICAgaWYgKGluZGV4IDwgMCkgY29udGludWU7XHJcblxyXG4gICAgaWYgKCFiZXN0IHx8IGluZGV4IDwgYmVzdC5pbmRleCkge1xyXG4gICAgICBiZXN0ID0ge1xyXG4gICAgICAgIC4uLmNhbmRpZGF0ZSxcclxuICAgICAgICBpbmRleCxcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHJldHVybiBiZXN0O1xyXG59XHJcblxyXG4vKipcclxuICogSW5jcmVtZW50YWwgcGFyc2VyIGZvciB0aGUgc21hbGwgc3RydWN0dXJlZCBwcm90b2NvbCBlbWJlZGRlZCBpbiBzdHJlYW1lZFxyXG4gKiBtb2RlbCB0ZXh0LiBVSSBjb2RlIG9ubHkgcmVjZWl2ZXMgbm9ybWFsaXplZCBldmVudHMuXHJcbiAqL1xyXG5leHBvcnQgY2xhc3MgU3RydWN0dXJlZFN0cmVhbVBhcnNlciB7XHJcbiAgcHJpdmF0ZSBidWZmZXIgPSBcIlwiO1xyXG4gIHByaXZhdGUgbW9kZTogXCJ0ZXh0XCIgfCBCbG9ja0tpbmQgPSBcInRleHRcIjtcclxuXHJcbiAgcHVzaChjaHVuazogc3RyaW5nKTogU3RydWN0dXJlZFN0cmVhbUV2ZW50W10ge1xyXG4gICAgdGhpcy5idWZmZXIgKz0gY2h1bms7XHJcbiAgICByZXR1cm4gdGhpcy5kcmFpbihmYWxzZSk7XHJcbiAgfVxyXG5cclxuICBmaW5pc2goKTogU3RydWN0dXJlZFN0cmVhbUV2ZW50W10ge1xyXG4gICAgcmV0dXJuIHRoaXMuZHJhaW4odHJ1ZSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGRyYWluKGZpbmFsOiBib29sZWFuKTogU3RydWN0dXJlZFN0cmVhbUV2ZW50W10ge1xyXG4gICAgY29uc3QgZXZlbnRzOiBTdHJ1Y3R1cmVkU3RyZWFtRXZlbnRbXSA9IFtdO1xyXG5cclxuICAgIHdoaWxlICh0aGlzLmJ1ZmZlci5sZW5ndGggPiAwKSB7XHJcbiAgICAgIGlmICh0aGlzLm1vZGUgPT09IFwidGV4dFwiKSB7XHJcbiAgICAgICAgY29uc3Qgc3RhcnQgPSBmaW5kU3RhcnQodGhpcy5idWZmZXIpO1xyXG5cclxuICAgICAgICBpZiAoc3RhcnQpIHtcclxuICAgICAgICAgIGNvbnN0IHZpc2libGUgPSB0aGlzLmJ1ZmZlci5zbGljZSgwLCBzdGFydC5pbmRleCk7XHJcbiAgICAgICAgICBpZiAodmlzaWJsZSkge1xyXG4gICAgICAgICAgICBldmVudHMucHVzaCh7XHJcbiAgICAgICAgICAgICAgdHlwZTogXCJ0ZXh0XCIsXHJcbiAgICAgICAgICAgICAgdGV4dDogdmlzaWJsZSxcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgdGhpcy5idWZmZXIgPSB0aGlzLmJ1ZmZlci5zbGljZShcclxuICAgICAgICAgICAgc3RhcnQuaW5kZXggKyBzdGFydC5tYXJrZXIubGVuZ3RoLFxyXG4gICAgICAgICAgKTtcclxuICAgICAgICAgIHRoaXMubW9kZSA9IHN0YXJ0LmtpbmQ7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChmaW5hbCkge1xyXG4gICAgICAgICAgZXZlbnRzLnB1c2goe1xyXG4gICAgICAgICAgICB0eXBlOiBcInRleHRcIixcclxuICAgICAgICAgICAgdGV4dDogdGhpcy5idWZmZXIsXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIHRoaXMuYnVmZmVyID0gXCJcIjtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3Qga2VlcCA9IE1hdGgubWluKFxyXG4gICAgICAgICAgTUFYX01BUktFUl9MRU5HVEggLSAxLFxyXG4gICAgICAgICAgdGhpcy5idWZmZXIubGVuZ3RoLFxyXG4gICAgICAgICk7XHJcbiAgICAgICAgY29uc3QgZW1pdExlbmd0aCA9IHRoaXMuYnVmZmVyLmxlbmd0aCAtIGtlZXA7XHJcblxyXG4gICAgICAgIGlmIChlbWl0TGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgZXZlbnRzLnB1c2goe1xyXG4gICAgICAgICAgICB0eXBlOiBcInRleHRcIixcclxuICAgICAgICAgICAgdGV4dDogdGhpcy5idWZmZXIuc2xpY2UoMCwgZW1pdExlbmd0aCksXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIHRoaXMuYnVmZmVyID0gdGhpcy5idWZmZXIuc2xpY2UoZW1pdExlbmd0aCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGJyZWFrO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCBlbmQgPSB0aGlzLmJ1ZmZlci5pbmRleE9mKEVORF9UQUcpO1xyXG5cclxuICAgICAgaWYgKGVuZCA8IDApIHtcclxuICAgICAgICBpZiAoZmluYWwpIHtcclxuICAgICAgICAgIGV2ZW50cy5wdXNoKHtcclxuICAgICAgICAgICAgdHlwZTogXCJlcnJvclwiLFxyXG4gICAgICAgICAgICBtZXNzYWdlOiBgSW5jb21wbGV0ZSAke3RoaXMubW9kZX0gYmxvY2sgcmV0dXJuZWQgYnkgdGhlIGFnZW50LmAsXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIHRoaXMuYnVmZmVyID0gXCJcIjtcclxuICAgICAgICAgIHRoaXMubW9kZSA9IFwidGV4dFwiO1xyXG4gICAgICAgIH1cclxuICAgICAgICBicmVhaztcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgcmF3ID0gdGhpcy5idWZmZXIuc2xpY2UoMCwgZW5kKS50cmltKCk7XHJcbiAgICAgIGNvbnN0IGJsb2NrS2luZCA9IHRoaXMubW9kZTtcclxuXHJcbiAgICAgIHRoaXMuYnVmZmVyID0gdGhpcy5idWZmZXIuc2xpY2UoZW5kICsgRU5EX1RBRy5sZW5ndGgpO1xyXG4gICAgICB0aGlzLm1vZGUgPSBcInRleHRcIjtcclxuXHJcbiAgICAgIGxldCBwYXJzZWQ6IHVua25vd247XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpO1xyXG4gICAgICB9IGNhdGNoIHtcclxuICAgICAgICBldmVudHMucHVzaCh7XHJcbiAgICAgICAgICB0eXBlOiBcImVycm9yXCIsXHJcbiAgICAgICAgICBtZXNzYWdlOiBgQ291bGQgbm90IHBhcnNlICR7YmxvY2tLaW5kfSByZXR1cm5lZCBieSB0aGUgYWdlbnQuYCxcclxuICAgICAgICB9KTtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKGJsb2NrS2luZCA9PT0gXCJlZGl0LXByb3Bvc2FsXCIpIHtcclxuICAgICAgICBpZiAoIWlzRWRpdFByb3Bvc2FsKHBhcnNlZCkpIHtcclxuICAgICAgICAgIGV2ZW50cy5wdXNoKHtcclxuICAgICAgICAgICAgdHlwZTogXCJlcnJvclwiLFxyXG4gICAgICAgICAgICBtZXNzYWdlOiBcIkFnZW50IHJldHVybmVkIGFuIGludmFsaWQgZWRpdCBwcm9wb3NhbC5cIixcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBldmVudHMucHVzaCh7XHJcbiAgICAgICAgICB0eXBlOiBcInByb3Bvc2FsXCIsXHJcbiAgICAgICAgICBwcm9wb3NhbDogcGFyc2VkLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAoIWlzUHJhY3RpY2VQYXlsb2FkKHBhcnNlZCkpIHtcclxuICAgICAgICBldmVudHMucHVzaCh7XHJcbiAgICAgICAgICB0eXBlOiBcImVycm9yXCIsXHJcbiAgICAgICAgICBtZXNzYWdlOiBcIkFnZW50IHJldHVybmVkIGFuIGludmFsaWQgcHJhY3RpY2UgcGF5bG9hZC5cIixcclxuICAgICAgICB9KTtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKHBhcnNlZC5raW5kID09PSBcInF1ZXN0aW9uXCIpIHtcclxuICAgICAgICBldmVudHMucHVzaCh7XHJcbiAgICAgICAgICB0eXBlOiBcInByYWN0aWNlLXF1ZXN0aW9uXCIsXHJcbiAgICAgICAgICBxdWVzdGlvbjogcGFyc2VkLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGV2ZW50cy5wdXNoKHtcclxuICAgICAgICAgIHR5cGU6IFwicHJhY3RpY2UtZXZhbHVhdGlvblwiLFxyXG4gICAgICAgICAgZXZhbHVhdGlvbjogcGFyc2VkLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGV2ZW50cztcclxuICB9XHJcbn1cclxuIiwgImltcG9ydCB7XHJcbiAgQWdlbnRDb250ZXh0LFxyXG4gIEFwcGx5UmVzdWx0LFxyXG4gIEFnZW50TW9kZWwsXG4gIENoYXRTZXNzaW9uLFxyXG4gIEVkaXRQcm9wb3NhbCxcclxufSBmcm9tIFwiLi4vdHlwZXNcIjtcclxuaW1wb3J0IHsgQ29udGV4dFJlc29sdmVyIH0gZnJvbSBcIi4uL2NvbnRleHQvQ29udGV4dFJlc29sdmVyXCI7XHJcbmltcG9ydCB7IExlYXJuaW5nQ29udGV4dCB9IGZyb20gXCIuLi9jb250ZXh0L2NvbnRleHQtdHlwZXNcIjtcclxuaW1wb3J0IHsgUG9saWN5TG9hZGVyIH0gZnJvbSBcIi4uL2NvbnRleHQvUG9saWN5TG9hZGVyXCI7XHJcbmltcG9ydCB7IE11dGF0aW9uU2VydmljZSB9IGZyb20gXCIuLi9tdXRhdGlvbi9NdXRhdGlvblNlcnZpY2VcIjtcclxuaW1wb3J0IHsgVmF1bHRMZWFybmluZ1N0b3JlIH0gZnJvbSBcIi4uL3BlcnNpc3RlbmNlL1ZhdWx0TGVhcm5pbmdTdG9yZVwiO1xyXG5pbXBvcnQgeyBTZXNzaW9uQ29udHJvbGxlciB9IGZyb20gXCIuLi9zZXNzaW9uL1Nlc3Npb25Db250cm9sbGVyXCI7XHJcbmltcG9ydCB7XHJcbiAgYnVpbGRBY3Rpb25JbnN0cnVjdGlvbixcclxuICBidWlsZFByYWN0aWNlRXZhbHVhdGlvbkluc3RydWN0aW9uLFxyXG4gIGJ1aWxkUHJhY3RpY2VRdWVzdGlvbkluc3RydWN0aW9uLFxyXG59IGZyb20gXCIuL2FjdGlvbi1idWlsZGVyc1wiO1xyXG5pbXBvcnQgeyBMZWFybmluZ0V2ZW50LCBMZWFybmluZ1JlcXVlc3QgfSBmcm9tIFwiLi9sZWFybmluZy10eXBlc1wiO1xyXG5pbXBvcnQge1xyXG4gIFByYWN0aWNlRXZhbHVhdGlvbixcclxuICBQcmFjdGljZVF1ZXN0aW9uLFxyXG4gIFByYWN0aWNlU2Vzc2lvbixcclxufSBmcm9tIFwiLi9wcmFjdGljZS10eXBlc1wiO1xyXG5pbXBvcnQge1xyXG4gIFN0cnVjdHVyZWRTdHJlYW1FdmVudCxcclxuICBTdHJ1Y3R1cmVkU3RyZWFtUGFyc2VyLFxyXG59IGZyb20gXCIuL1N0cnVjdHVyZWRTdHJlYW1QYXJzZXJcIjtcclxuXHJcbi8qKlxyXG4gKiBBcHBsaWNhdGlvbiBib3VuZGFyeSBmb3IgdGhlIExlYXJuaW5nIE9TLlxyXG4gKlxyXG4gKiBUaGUgdmlldyBzZW5kcyB1c2VyIGludGVudCBoZXJlLiBUaGlzIGNvbnRyb2xsZXIgb3ducyBvcmNoZXN0cmF0aW9uOlxyXG4gKiBjb250ZXh0IC0+IHBvbGljeSAtPiBsZWFybmluZyBzdGF0ZSAtPiBhY3Rpb24gLT4gYWdlbnQgc2Vzc2lvbiAtPiBub3JtYWxpemVkXHJcbiAqIFVJIGV2ZW50cy4gSXQgZGVsaWJlcmF0ZWx5IGhpZGVzIHByb3ZpZGVyIHRyYW5zcG9ydCBkZXRhaWxzIGZyb20gdGhlIFVJLlxuICovXHJcbmV4cG9ydCBjbGFzcyBMZWFybmluZ0NvbnRyb2xsZXIge1xyXG4gIHByaXZhdGUgcHJhY3RpY2VTZXNzaW9uOiBQcmFjdGljZVNlc3Npb24gfCBudWxsID0gbnVsbDtcclxuXHJcbiAgY29uc3RydWN0b3IoXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IHNlc3Npb25zOiBTZXNzaW9uQ29udHJvbGxlcixcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgY29udGV4dHM6IENvbnRleHRSZXNvbHZlcixcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgcG9saWNpZXM6IFBvbGljeUxvYWRlcixcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgbXV0YXRpb25zOiBNdXRhdGlvblNlcnZpY2UsXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IGxlYXJuaW5nU3RhdGU6IFZhdWx0TGVhcm5pbmdTdG9yZSxcclxuICApIHt9XHJcblxyXG4gIGFzeW5jIHBpbmcoKTogUHJvbWlzZTxzdHJpbmc+IHtcclxuICAgIHJldHVybiB0aGlzLnNlc3Npb25zLnBpbmcoKTtcclxuICB9XHJcblxyXG4gIGdldFNlc3Npb24oKTogQ2hhdFNlc3Npb24ge1xyXG4gICAgcmV0dXJuIHRoaXMuc2Vzc2lvbnMuZ2V0U2Vzc2lvbigpO1xyXG4gIH1cclxuXHJcbiAgZ2V0TW9kZWxzKCk6IEFnZW50TW9kZWxbXSB7XG4gICAgcmV0dXJuIHRoaXMuc2Vzc2lvbnMuZ2V0TW9kZWxzKCk7XHJcbiAgfVxyXG5cclxuICBzZXRNb2RlbChtb2RlbElkOiBzdHJpbmcpOiB2b2lkIHtcclxuICAgIHRoaXMuc2Vzc2lvbnMuc2V0TW9kZWwobW9kZWxJZCk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBuZXdTZXNzaW9uKCk6IFByb21pc2U8Q2hhdFNlc3Npb24+IHtcclxuICAgIHRoaXMucHJhY3RpY2VTZXNzaW9uID0gbnVsbDtcclxuICAgIHJldHVybiB0aGlzLnNlc3Npb25zLm5ld1Nlc3Npb24oKTtcclxuICB9XHJcblxyXG4gIGFzeW5jIHJlc29sdmVDb250ZXh0KFxyXG4gICAgZXhwbGljaXRDb250ZXh0OiBBZ2VudENvbnRleHRbXSA9IFtdLFxyXG4gICk6IFByb21pc2U8TGVhcm5pbmdDb250ZXh0PiB7XHJcbiAgICByZXR1cm4gdGhpcy5jb250ZXh0cy5yZXNvbHZlKGV4cGxpY2l0Q29udGV4dCk7XHJcbiAgfVxyXG5cclxuICBhc3luYyAqcnVuKHJlcXVlc3Q6IExlYXJuaW5nUmVxdWVzdCk6IEFzeW5jSXRlcmFibGU8TGVhcm5pbmdFdmVudD4ge1xyXG4gICAgY29uc3QgY29udGV4dCA9IGF3YWl0IHRoaXMuY29udGV4dHMucmVzb2x2ZShyZXF1ZXN0LmV4cGxpY2l0Q29udGV4dCk7XHJcbiAgICB5aWVsZCB7XHJcbiAgICAgIHR5cGU6IFwiY29udGV4dC1yZWFkeVwiLFxyXG4gICAgICBjb250ZXh0LFxyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBbcG9saWN5LCBzdGF0ZV0gPSBhd2FpdCBQcm9taXNlLmFsbChbXHJcbiAgICAgIHRoaXMucG9saWNpZXMubG9hZCgpLFxyXG4gICAgICB0aGlzLmxlYXJuaW5nU3RhdGUubG9hZCgpLFxyXG4gICAgXSk7XHJcblxyXG4gICAgY29uc3QgYWdlbnRDb250ZXh0ID0gdGhpcy5jb250ZXh0cy50b0FnZW50Q29udGV4dChjb250ZXh0KTtcclxuXHJcbiAgICBpZiAocG9saWN5LnJhd0luc3RydWN0aW9ucykge1xyXG4gICAgICBjb25zdCBhbHJlYWR5SW5jbHVkZWQgPSBhZ2VudENvbnRleHQuc29tZShcclxuICAgICAgICAoaXRlbSkgPT4gaXRlbS50eXBlID09PSBcIm5vdGVcIiAmJiBpdGVtLmZpbGUgPT09IHBvbGljeS5wYXRoLFxyXG4gICAgICApO1xyXG5cclxuICAgICAgaWYgKCFhbHJlYWR5SW5jbHVkZWQpIHtcclxuICAgICAgICBhZ2VudENvbnRleHQucHVzaCh7XHJcbiAgICAgICAgICB0eXBlOiBcIm5vdGVcIixcclxuICAgICAgICAgIGZpbGU6IHBvbGljeS5wYXRoLFxyXG4gICAgICAgICAgY29udGVudDogcG9saWN5LnJhd0luc3RydWN0aW9ucyxcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGFnZW50Q29udGV4dC5wdXNoKHtcclxuICAgICAgdHlwZTogXCJub3RlXCIsXHJcbiAgICAgIGZpbGU6IFwiMDAtbGVhcm5pbmctb3MvcHJvZ3Jlc3MuanNvblwiLFxyXG4gICAgICBjb250ZW50OiBKU09OLnN0cmluZ2lmeShzdGF0ZSwgbnVsbCwgMiksXHJcbiAgICB9KTtcclxuXHJcbiAgICBsZXQgcHJlcGFyZWRQcm9tcHQ6IHN0cmluZztcclxuXHJcbiAgICBpZiAocmVxdWVzdC5hY3Rpb24gPT09IFwicHJhY3RpY2VcIikge1xyXG4gICAgICBjb25zdCBhY3RpdmVQcmFjdGljZSA9IHRoaXMucHJhY3RpY2VTZXNzaW9uO1xyXG5cclxuICAgICAgaWYgKFxyXG4gICAgICAgIGFjdGl2ZVByYWN0aWNlPy5zdGF0ZSA9PT0gXCJ3YWl0aW5nLWFuc3dlclwiICYmXHJcbiAgICAgICAgYWN0aXZlUHJhY3RpY2UuY3VycmVudFF1ZXN0aW9uXHJcbiAgICAgICkge1xyXG4gICAgICAgIGFjdGl2ZVByYWN0aWNlLnN0YXRlID0gXCJldmFsdWF0aW5nXCI7XHJcbiAgICAgICAgcHJlcGFyZWRQcm9tcHQgPSBidWlsZFByYWN0aWNlRXZhbHVhdGlvbkluc3RydWN0aW9uKHtcclxuICAgICAgICAgIHF1ZXN0aW9uOiBhY3RpdmVQcmFjdGljZS5jdXJyZW50UXVlc3Rpb24sXHJcbiAgICAgICAgICBhbnN3ZXI6IHJlcXVlc3QucHJvbXB0LFxyXG4gICAgICAgICAgY29uY2VwdDogYWN0aXZlUHJhY3RpY2UuY29uY2VwdCxcclxuICAgICAgICB9KTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICB0aGlzLnByYWN0aWNlU2Vzc2lvbiA9IHtcclxuICAgICAgICAgIGlkOiBjcnlwdG8ucmFuZG9tVVVJRCgpLFxyXG4gICAgICAgICAgc3RhdGU6IFwiZ2VuZXJhdGluZ1wiLFxyXG4gICAgICAgICAgdHVybnM6IFtdLFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIHByZXBhcmVkUHJvbXB0ID0gYnVpbGRQcmFjdGljZVF1ZXN0aW9uSW5zdHJ1Y3Rpb24oXHJcbiAgICAgICAgICByZXF1ZXN0LnByb21wdCxcclxuICAgICAgICApO1xyXG4gICAgICB9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICB0aGlzLnByYWN0aWNlU2Vzc2lvbiA9IG51bGw7XHJcbiAgICAgIGNvbnN0IGluc3RydWN0aW9uID0gYnVpbGRBY3Rpb25JbnN0cnVjdGlvbihyZXF1ZXN0LmFjdGlvbik7XHJcbiAgICAgIHByZXBhcmVkUHJvbXB0ID1cclxuICAgICAgICBgJHtpbnN0cnVjdGlvbn1cXG5cXG5Vc2VyIHJlcXVlc3Q6XFxuJHtyZXF1ZXN0LnByb21wdH1gO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHBhcnNlciA9IG5ldyBTdHJ1Y3R1cmVkU3RyZWFtUGFyc2VyKCk7XHJcblxyXG4gICAgZm9yIGF3YWl0IChjb25zdCBldmVudCBvZiB0aGlzLnNlc3Npb25zLnNlbmRUdXJuKFxyXG4gICAgICBwcmVwYXJlZFByb21wdCxcclxuICAgICAgYWdlbnRDb250ZXh0LFxyXG4gICAgICByZXF1ZXN0LnByb21wdCxcclxuICAgICkpIHtcclxuICAgICAgaWYgKGV2ZW50LnR5cGUgPT09IFwidGV4dFwiKSB7XHJcbiAgICAgICAgZm9yIGF3YWl0IChjb25zdCBtYXBwZWQgb2YgdGhpcy5tYXBTdHJ1Y3R1cmVkRXZlbnRzKFxyXG4gICAgICAgICAgcGFyc2VyLnB1c2goZXZlbnQuY29udGVudCksXHJcbiAgICAgICAgICByZXF1ZXN0LFxyXG4gICAgICAgICAgY29udGV4dCxcclxuICAgICAgICApKSB7XHJcbiAgICAgICAgICB5aWVsZCBtYXBwZWQ7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJkb25lXCIpIHtcclxuICAgICAgICBmb3IgYXdhaXQgKGNvbnN0IG1hcHBlZCBvZiB0aGlzLm1hcFN0cnVjdHVyZWRFdmVudHMoXHJcbiAgICAgICAgICBwYXJzZXIuZmluaXNoKCksXHJcbiAgICAgICAgICByZXF1ZXN0LFxyXG4gICAgICAgICAgY29udGV4dCxcclxuICAgICAgICApKSB7XHJcbiAgICAgICAgICB5aWVsZCBtYXBwZWQ7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICB5aWVsZCB7IHR5cGU6IFwiY29tcGxldGVkXCIgfTtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKGV2ZW50LnR5cGUgPT09IFwiZXJyb3JcIikge1xyXG4gICAgICAgIHlpZWxkIHtcclxuICAgICAgICAgIHR5cGU6IFwiZXJyb3JcIixcclxuICAgICAgICAgIG1lc3NhZ2U6IGV2ZW50LmVycm9yLFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIGFwcGx5UHJvcG9zYWwocHJvcG9zYWw6IEVkaXRQcm9wb3NhbCk6IFByb21pc2U8QXBwbHlSZXN1bHQ+IHtcclxuICAgIHJldHVybiB0aGlzLm11dGF0aW9ucy5hcHBseShwcm9wb3NhbCk7XHJcbiAgfVxyXG5cclxuICBjYW5jZWwoKTogdm9pZCB7XHJcbiAgICB0aGlzLnNlc3Npb25zLmNhbmNlbCgpO1xyXG4gIH1cclxuXHJcbiAgZGlzcG9zZSgpOiB2b2lkIHtcclxuICAgIHRoaXMuc2Vzc2lvbnMuZGVzdHJveSgpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyAqbWFwU3RydWN0dXJlZEV2ZW50cyhcclxuICAgIGV2ZW50czogU3RydWN0dXJlZFN0cmVhbUV2ZW50W10sXHJcbiAgICByZXF1ZXN0OiBMZWFybmluZ1JlcXVlc3QsXHJcbiAgICBjb250ZXh0OiBMZWFybmluZ0NvbnRleHQsXHJcbiAgKTogQXN5bmNJdGVyYWJsZTxMZWFybmluZ0V2ZW50PiB7XHJcbiAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGV2ZW50cykge1xyXG4gICAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJ0ZXh0XCIpIHtcclxuICAgICAgICBpZiAoZXZlbnQudGV4dCkge1xyXG4gICAgICAgICAgeWllbGQge1xyXG4gICAgICAgICAgICB0eXBlOiBcInJlc3BvbnNlLWRlbHRhXCIsXHJcbiAgICAgICAgICAgIHRleHQ6IGV2ZW50LnRleHQsXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKGV2ZW50LnR5cGUgPT09IFwicHJvcG9zYWxcIikge1xyXG4gICAgICAgIHlpZWxkIHtcclxuICAgICAgICAgIHR5cGU6IFwibXV0YXRpb24tcHJvcG9zZWRcIixcclxuICAgICAgICAgIHByb3Bvc2FsOiBldmVudC5wcm9wb3NhbCxcclxuICAgICAgICB9O1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJwcmFjdGljZS1xdWVzdGlvblwiKSB7XHJcbiAgICAgICAgdGhpcy5hY2NlcHRQcmFjdGljZVF1ZXN0aW9uKGV2ZW50LnF1ZXN0aW9uKTtcclxuICAgICAgICB5aWVsZCB7XHJcbiAgICAgICAgICB0eXBlOiBcInByYWN0aWNlLXF1ZXN0aW9uXCIsXHJcbiAgICAgICAgICBxdWVzdGlvbjogZXZlbnQucXVlc3Rpb24sXHJcbiAgICAgICAgfTtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKGV2ZW50LnR5cGUgPT09IFwicHJhY3RpY2UtZXZhbHVhdGlvblwiKSB7XHJcbiAgICAgICAgY29uc3QgZXZhbHVhdGlvbiA9IGV2ZW50LmV2YWx1YXRpb247XHJcbiAgICAgICAgdGhpcy5hY2NlcHRQcmFjdGljZUV2YWx1YXRpb24oXHJcbiAgICAgICAgICBldmFsdWF0aW9uLFxyXG4gICAgICAgICAgcmVxdWVzdC5wcm9tcHQsXHJcbiAgICAgICAgKTtcclxuXHJcbiAgICAgICAgeWllbGQge1xyXG4gICAgICAgICAgdHlwZTogXCJwcmFjdGljZS1ldmFsdWF0aW9uXCIsXHJcbiAgICAgICAgICBldmFsdWF0aW9uLFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGNvbnN0IHNvdXJjZSA9XHJcbiAgICAgICAgICBjb250ZXh0LnNlbGVjdGlvbj8uZmlsZSA/P1xyXG4gICAgICAgICAgY29udGV4dC5hY3RpdmVOb3RlPy5wYXRoID8/XHJcbiAgICAgICAgICBcImxlYXJuaW5nLXNlc3Npb25cIjtcclxuXHJcbiAgICAgICAgY29uc3Qgc3RhdGUgPVxyXG4gICAgICAgICAgYXdhaXQgdGhpcy5sZWFybmluZ1N0YXRlLnJlY29yZFByYWN0aWNlRXZhbHVhdGlvbih7XHJcbiAgICAgICAgICAgIGV2YWx1YXRpb24sXHJcbiAgICAgICAgICAgIHNvdXJjZSxcclxuICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICB5aWVsZCB7XHJcbiAgICAgICAgICB0eXBlOiBcImxlYXJuaW5nLXN0YXRlLXVwZGF0ZWRcIixcclxuICAgICAgICAgIHN0YXRlLFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGlmIChldmFsdWF0aW9uLm5leHRRdWVzdGlvbj8udHJpbSgpKSB7XHJcbiAgICAgICAgICBjb25zdCBuZXh0OiBQcmFjdGljZVF1ZXN0aW9uID0ge1xyXG4gICAgICAgICAgICBraW5kOiBcInF1ZXN0aW9uXCIsXHJcbiAgICAgICAgICAgIGNvbmNlcHQ6IGV2YWx1YXRpb24uY29uY2VwdCxcclxuICAgICAgICAgICAgcXVlc3Rpb246IGV2YWx1YXRpb24ubmV4dFF1ZXN0aW9uLnRyaW0oKSxcclxuICAgICAgICAgIH07XHJcblxyXG4gICAgICAgICAgdGhpcy5hY2NlcHRQcmFjdGljZVF1ZXN0aW9uKG5leHQpO1xyXG4gICAgICAgICAgeWllbGQge1xyXG4gICAgICAgICAgICB0eXBlOiBcInByYWN0aWNlLXF1ZXN0aW9uXCIsXHJcbiAgICAgICAgICAgIHF1ZXN0aW9uOiBuZXh0LFxyXG4gICAgICAgICAgfTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICB5aWVsZCB7XHJcbiAgICAgICAgdHlwZTogXCJlcnJvclwiLFxyXG4gICAgICAgIG1lc3NhZ2U6IGV2ZW50Lm1lc3NhZ2UsXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFjY2VwdFByYWN0aWNlUXVlc3Rpb24oXHJcbiAgICBxdWVzdGlvbjogUHJhY3RpY2VRdWVzdGlvbixcclxuICApOiB2b2lkIHtcclxuICAgIGlmICghdGhpcy5wcmFjdGljZVNlc3Npb24pIHtcclxuICAgICAgdGhpcy5wcmFjdGljZVNlc3Npb24gPSB7XHJcbiAgICAgICAgaWQ6IGNyeXB0by5yYW5kb21VVUlEKCksXHJcbiAgICAgICAgc3RhdGU6IFwiZ2VuZXJhdGluZ1wiLFxyXG4gICAgICAgIHR1cm5zOiBbXSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLnByYWN0aWNlU2Vzc2lvbi5jb25jZXB0ID0gcXVlc3Rpb24uY29uY2VwdDtcclxuICAgIHRoaXMucHJhY3RpY2VTZXNzaW9uLmN1cnJlbnRRdWVzdGlvbiA9IHF1ZXN0aW9uLnF1ZXN0aW9uO1xyXG4gICAgdGhpcy5wcmFjdGljZVNlc3Npb24uc3RhdGUgPSBcIndhaXRpbmctYW5zd2VyXCI7XHJcblxyXG4gICAgY29uc3QgY3VycmVudCA9XHJcbiAgICAgIHRoaXMucHJhY3RpY2VTZXNzaW9uLnR1cm5zW1xyXG4gICAgICAgIHRoaXMucHJhY3RpY2VTZXNzaW9uLnR1cm5zLmxlbmd0aCAtIDFcclxuICAgICAgXTtcclxuXHJcbiAgICBpZiAoXHJcbiAgICAgIGN1cnJlbnQgJiZcclxuICAgICAgIWN1cnJlbnQuYW5zd2VyICYmXHJcbiAgICAgIGN1cnJlbnQucXVlc3Rpb24gPT09IHF1ZXN0aW9uLnF1ZXN0aW9uXHJcbiAgICApIHtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMucHJhY3RpY2VTZXNzaW9uLnR1cm5zLnB1c2goe1xyXG4gICAgICBpZDogY3J5cHRvLnJhbmRvbVVVSUQoKSxcclxuICAgICAgY29uY2VwdDogcXVlc3Rpb24uY29uY2VwdCxcclxuICAgICAgcXVlc3Rpb246IHF1ZXN0aW9uLnF1ZXN0aW9uLFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFjY2VwdFByYWN0aWNlRXZhbHVhdGlvbihcclxuICAgIGV2YWx1YXRpb246IFByYWN0aWNlRXZhbHVhdGlvbixcclxuICAgIGFuc3dlcjogc3RyaW5nLFxyXG4gICk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLnByYWN0aWNlU2Vzc2lvbikgcmV0dXJuO1xyXG5cclxuICAgIGNvbnN0IGN1cnJlbnQgPVxyXG4gICAgICB0aGlzLnByYWN0aWNlU2Vzc2lvbi50dXJuc1tcclxuICAgICAgICB0aGlzLnByYWN0aWNlU2Vzc2lvbi50dXJucy5sZW5ndGggLSAxXHJcbiAgICAgIF07XHJcblxyXG4gICAgaWYgKGN1cnJlbnQpIHtcclxuICAgICAgY3VycmVudC5hbnN3ZXIgPSBhbnN3ZXI7XHJcbiAgICAgIGN1cnJlbnQuZXZhbHVhdGlvbiA9IGV2YWx1YXRpb247XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5wcmFjdGljZVNlc3Npb24uY29uY2VwdCA9IGV2YWx1YXRpb24uY29uY2VwdDtcclxuXHJcbiAgICBpZiAoZXZhbHVhdGlvbi5uZXh0UXVlc3Rpb24/LnRyaW0oKSkge1xyXG4gICAgICB0aGlzLnByYWN0aWNlU2Vzc2lvbi5zdGF0ZSA9IFwid2FpdGluZy1hbnN3ZXJcIjtcclxuICAgICAgdGhpcy5wcmFjdGljZVNlc3Npb24uY3VycmVudFF1ZXN0aW9uID1cclxuICAgICAgICBldmFsdWF0aW9uLm5leHRRdWVzdGlvbi50cmltKCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICB0aGlzLnByYWN0aWNlU2Vzc2lvbi5zdGF0ZSA9IFwiY29tcGxldGVcIjtcclxuICAgICAgdGhpcy5wcmFjdGljZVNlc3Npb24uY3VycmVudFF1ZXN0aW9uID0gdW5kZWZpbmVkO1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgQXBwLCBNYXJrZG93blZpZXcsIFRGaWxlIH0gZnJvbSBcIm9ic2lkaWFuXCI7XHJcbmltcG9ydCB7IEFwcGx5UmVzdWx0LCBFZGl0UHJvcG9zYWwgfSBmcm9tIFwiLi4vdHlwZXNcIjtcclxuXHJcbmZ1bmN0aW9uIGZpbmRPY2N1cnJlbmNlcyhjb250ZW50OiBzdHJpbmcsIG5lZWRsZTogc3RyaW5nKTogbnVtYmVyW10ge1xyXG4gIGlmICghbmVlZGxlKSByZXR1cm4gW107XHJcblxyXG4gIGNvbnN0IG1hdGNoZXM6IG51bWJlcltdID0gW107XHJcbiAgbGV0IGN1cnNvciA9IDA7XHJcblxyXG4gIHdoaWxlIChjdXJzb3IgPD0gY29udGVudC5sZW5ndGggLSBuZWVkbGUubGVuZ3RoKSB7XHJcbiAgICBjb25zdCBpbmRleCA9IGNvbnRlbnQuaW5kZXhPZihuZWVkbGUsIGN1cnNvcik7XHJcbiAgICBpZiAoaW5kZXggPT09IC0xKSBicmVhaztcclxuXHJcbiAgICBtYXRjaGVzLnB1c2goaW5kZXgpO1xyXG4gICAgY3Vyc29yID0gaW5kZXggKyBuZWVkbGUubGVuZ3RoO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIG1hdGNoZXM7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBPd25zIHVzZXItYXBwcm92ZWQgTWFya2Rvd24gbXV0YXRpb25zLlxyXG4gKlxyXG4gKiBBZ2VudCBvdXRwdXQgaXMgb25seSBhIHByb3Bvc2FsLiBUaGlzIHNlcnZpY2UgcmV2YWxpZGF0ZXMgdGhlIHRhcmdldCBhdFxyXG4gKiBhcHBseS10aW1lIGFuZCByZWZ1c2VzIHN0YWxlIG9yIGFtYmlndW91cyByZXBsYWNlbWVudHMuXHJcbiAqL1xyXG5leHBvcnQgY2xhc3MgTXV0YXRpb25TZXJ2aWNlIHtcclxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGFwcDogQXBwKSB7fVxyXG5cclxuICBhc3luYyBhcHBseShwcm9wb3NhbDogRWRpdFByb3Bvc2FsKTogUHJvbWlzZTxBcHBseVJlc3VsdD4ge1xyXG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEZpbGVCeVBhdGgocHJvcG9zYWwuZmlsZSk7XHJcblxyXG4gICAgaWYgKCFmaWxlIHx8ICEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIG9rOiBmYWxzZSxcclxuICAgICAgICByZWFzb246IFwibWlzc2luZy1maWxlXCIsXHJcbiAgICAgICAgbWVzc2FnZTogYFRhcmdldCBub3RlIG5vdCBmb3VuZDogJHtwcm9wb3NhbC5maWxlfWAsXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgYWN0aXZlRmlsZSA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XHJcbiAgICAgIGNvbnN0IGFjdGl2ZVZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xyXG5cclxuICAgICAgaWYgKGFjdGl2ZUZpbGU/LnBhdGggPT09IGZpbGUucGF0aCAmJiBhY3RpdmVWaWV3Py5lZGl0b3IpIHtcclxuICAgICAgICBjb25zdCBlZGl0b3IgPSBhY3RpdmVWaWV3LmVkaXRvcjtcclxuICAgICAgICBjb25zdCBjb250ZW50ID0gZWRpdG9yLmdldFZhbHVlKCk7XHJcbiAgICAgICAgY29uc3QgbWF0Y2hlcyA9IGZpbmRPY2N1cnJlbmNlcyhjb250ZW50LCBwcm9wb3NhbC5vcmlnaW5hbCk7XHJcblxyXG4gICAgICAgIGlmIChtYXRjaGVzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgb2s6IGZhbHNlLFxyXG4gICAgICAgICAgICByZWFzb246IFwic3RhbGVcIixcclxuICAgICAgICAgICAgbWVzc2FnZTogXCJOb3RlIGNoYW5nZWQgc2luY2UgdGhlIHByb3Bvc2FsIHdhcyBtYWRlLiBSZWdlbmVyYXRlIHRoZSBlZGl0LlwiLFxyXG4gICAgICAgICAgfTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChtYXRjaGVzLmxlbmd0aCA+IDEpIHtcclxuICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIG9rOiBmYWxzZSxcclxuICAgICAgICAgICAgcmVhc29uOiBcImFtYmlndW91c1wiLFxyXG4gICAgICAgICAgICBtZXNzYWdlOiBcIlRoZSBvcmlnaW5hbCB0ZXh0IG9jY3VycyBtb3JlIHRoYW4gb25jZS4gUmVnZW5lcmF0ZSB3aXRoIGEgbW9yZSBzcGVjaWZpYyBzZWxlY3Rpb24uXCIsXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgaW5kZXggPSBtYXRjaGVzWzBdO1xyXG4gICAgICAgIGNvbnN0IGZyb20gPSBlZGl0b3Iub2Zmc2V0VG9Qb3MoaW5kZXgpO1xyXG4gICAgICAgIGNvbnN0IHRvID0gZWRpdG9yLm9mZnNldFRvUG9zKGluZGV4ICsgcHJvcG9zYWwub3JpZ2luYWwubGVuZ3RoKTtcclxuXHJcbiAgICAgICAgZWRpdG9yLnJlcGxhY2VSYW5nZShwcm9wb3NhbC5yZXBsYWNlbWVudCwgZnJvbSwgdG8pO1xyXG4gICAgICAgIHJldHVybiB7IG9rOiB0cnVlIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xyXG4gICAgICBjb25zdCBtYXRjaGVzID0gZmluZE9jY3VycmVuY2VzKGNvbnRlbnQsIHByb3Bvc2FsLm9yaWdpbmFsKTtcclxuXHJcbiAgICAgIGlmIChtYXRjaGVzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBvazogZmFsc2UsXHJcbiAgICAgICAgICByZWFzb246IFwic3RhbGVcIixcclxuICAgICAgICAgIG1lc3NhZ2U6IFwiTm90ZSBjaGFuZ2VkIHNpbmNlIHRoZSBwcm9wb3NhbCB3YXMgbWFkZS4gUmVnZW5lcmF0ZSB0aGUgZWRpdC5cIixcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAobWF0Y2hlcy5sZW5ndGggPiAxKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIG9rOiBmYWxzZSxcclxuICAgICAgICAgIHJlYXNvbjogXCJhbWJpZ3VvdXNcIixcclxuICAgICAgICAgIG1lc3NhZ2U6IFwiVGhlIG9yaWdpbmFsIHRleHQgb2NjdXJzIG1vcmUgdGhhbiBvbmNlLiBSZWdlbmVyYXRlIHdpdGggYSBtb3JlIHNwZWNpZmljIHNlbGVjdGlvbi5cIixcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCBpbmRleCA9IG1hdGNoZXNbMF07XHJcbiAgICAgIGNvbnN0IG5leHQgPVxyXG4gICAgICAgIGNvbnRlbnQuc2xpY2UoMCwgaW5kZXgpICtcclxuICAgICAgICBwcm9wb3NhbC5yZXBsYWNlbWVudCArXHJcbiAgICAgICAgY29udGVudC5zbGljZShpbmRleCArIHByb3Bvc2FsLm9yaWdpbmFsLmxlbmd0aCk7XHJcblxyXG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgbmV4dCk7XHJcbiAgICAgIHJldHVybiB7IG9rOiB0cnVlIH07XHJcbiAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBvazogZmFsc2UsXHJcbiAgICAgICAgcmVhc29uOiBcImVycm9yXCIsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIubWVzc2FnZSA6IFN0cmluZyhlcnIpLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgQXBwLCBURmlsZSB9IGZyb20gXCJvYnNpZGlhblwiO1xyXG5pbXBvcnQge1xyXG4gIERFRkFVTFRfTEVBUk5JTkdfU1RBVEUsXHJcbiAgTGVhcm5pbmdFdmlkZW5jZSxcclxuICBMZWFybmluZ1N0YXRlLFxyXG59IGZyb20gXCIuLi9sZWFybmluZy9sZWFybmluZy1zdGF0ZVwiO1xyXG5pbXBvcnQgeyBQcmFjdGljZUV2YWx1YXRpb24gfSBmcm9tIFwiLi4vbGVhcm5pbmcvcHJhY3RpY2UtdHlwZXNcIjtcclxuXHJcbmNvbnN0IFJPT1QgPSBcIjAwLWxlYXJuaW5nLW9zXCI7XHJcbmNvbnN0IFBST0dSRVNTX1BBVEggPSBgJHtST09UfS9wcm9ncmVzcy5qc29uYDtcclxuXHJcbmZ1bmN0aW9uIGNsb25lRGVmYXVsdFN0YXRlKCk6IExlYXJuaW5nU3RhdGUge1xyXG4gIHJldHVybiB7XHJcbiAgICAuLi5ERUZBVUxUX0xFQVJOSU5HX1NUQVRFLFxyXG4gICAgZ2FwczogW10sXHJcbiAgICBldmlkZW5jZTogW10sXHJcbiAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNMZWFybmluZ1N0YXRlKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgTGVhcm5pbmdTdGF0ZSB7XHJcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZTtcclxuICBjb25zdCBvYmogPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcclxuXHJcbiAgcmV0dXJuIChcclxuICAgIG9iai52ZXJzaW9uID09PSAxICYmXHJcbiAgICB0eXBlb2Ygb2JqLnRhcmdldCA9PT0gXCJzdHJpbmdcIiAmJlxyXG4gICAgQXJyYXkuaXNBcnJheShvYmouZ2FwcykgJiZcclxuICAgIEFycmF5LmlzQXJyYXkob2JqLmV2aWRlbmNlKVxyXG4gICk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZSh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICByZXR1cm4gdmFsdWUudHJpbSgpLnRvTG93ZXJDYXNlKCk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBEdXJhYmxlIExlYXJuaW5nIE9TIHN0YXRlIHN0b3JlZCBpbnNpZGUgdGhlIHZhdWx0IHNvIHByb2dyZXNzIHRyYXZlbHMgd2l0aFxyXG4gKiB0aGUgdmF1bHQgaW5zdGVhZCBvZiBiZWluZyB0cmFwcGVkIGluIE9ic2lkaWFuIHBsdWdpbiBkYXRhLlxyXG4gKi9cclxuZXhwb3J0IGNsYXNzIFZhdWx0TGVhcm5pbmdTdG9yZSB7XHJcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBhcHA6IEFwcCkge31cclxuXHJcbiAgYXN5bmMgbG9hZCgpOiBQcm9taXNlPExlYXJuaW5nU3RhdGU+IHtcclxuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRGaWxlQnlQYXRoKFBST0dSRVNTX1BBVEgpO1xyXG4gICAgaWYgKCFmaWxlIHx8ICEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xyXG4gICAgICByZXR1cm4gY2xvbmVEZWZhdWx0U3RhdGUoKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByYXcgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xyXG5cclxuICAgIGxldCBwYXJzZWQ6IHVua25vd247XHJcbiAgICB0cnkge1xyXG4gICAgICBwYXJzZWQgPSBKU09OLnBhcnNlKHJhdyk7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICAgIGBMZWFybmluZyBzdGF0ZSBpcyBpbnZhbGlkIEpTT046ICR7UFJPR1JFU1NfUEFUSH1gLFxyXG4gICAgICApO1xyXG4gICAgfVxyXG5cclxuICAgIGlmICghaXNMZWFybmluZ1N0YXRlKHBhcnNlZCkpIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICAgIGBMZWFybmluZyBzdGF0ZSBoYXMgYW4gdW5zdXBwb3J0ZWQgc2hhcGU6ICR7UFJPR1JFU1NfUEFUSH1gLFxyXG4gICAgICApO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBwYXJzZWQ7XHJcbiAgfVxyXG5cclxuICBhc3luYyBzYXZlKHN0YXRlOiBMZWFybmluZ1N0YXRlKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBhd2FpdCB0aGlzLmVuc3VyZVJvb3QoKTtcclxuXHJcbiAgICBjb25zdCBjb250ZW50ID0gSlNPTi5zdHJpbmdpZnkoc3RhdGUsIG51bGwsIDIpICsgXCJcXG5cIjtcclxuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRGaWxlQnlQYXRoKFBST0dSRVNTX1BBVEgpO1xyXG5cclxuICAgIGlmIChmaWxlICYmIGZpbGUgaW5zdGFuY2VvZiBURmlsZSkge1xyXG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgY29udGVudCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGUoUFJPR1JFU1NfUEFUSCwgY29udGVudCk7XHJcbiAgfVxyXG5cclxuICBhc3luYyByZWNvcmRQcmFjdGljZUV2YWx1YXRpb24oaW5wdXQ6IHtcclxuICAgIGV2YWx1YXRpb246IFByYWN0aWNlRXZhbHVhdGlvbjtcclxuICAgIHNvdXJjZTogc3RyaW5nO1xyXG4gIH0pOiBQcm9taXNlPExlYXJuaW5nU3RhdGU+IHtcclxuICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgdGhpcy5sb2FkKCk7XHJcblxyXG4gICAgY29uc3QgZXZpZGVuY2U6IExlYXJuaW5nRXZpZGVuY2UgPSB7XHJcbiAgICAgIGlkOiBjcnlwdG8ucmFuZG9tVVVJRCgpLFxyXG4gICAgICB0eXBlOiBcInByYWN0aWNlXCIsXHJcbiAgICAgIGNvbmNlcHQ6IGlucHV0LmV2YWx1YXRpb24uY29uY2VwdCxcclxuICAgICAgc291cmNlOiBpbnB1dC5zb3VyY2UsXHJcbiAgICAgIG91dGNvbWU6IGlucHV0LmV2YWx1YXRpb24ub3V0Y29tZSxcclxuICAgICAgY3JlYXRlZEF0OiBEYXRlLm5vdygpLFxyXG4gICAgfTtcclxuXHJcbiAgICBzdGF0ZS5ldmlkZW5jZS5wdXNoKGV2aWRlbmNlKTtcclxuICAgIHN0YXRlLmN1cnJlbnRUb3BpYyA9IGlucHV0LmV2YWx1YXRpb24uY29uY2VwdDtcclxuXHJcbiAgICBmb3IgKGNvbnN0IG1pc2NvbmNlcHRpb24gb2YgaW5wdXQuZXZhbHVhdGlvbi5taXNjb25jZXB0aW9ucykge1xyXG4gICAgICBjb25zdCBleGlzdGluZyA9IHN0YXRlLmdhcHMuZmluZChcclxuICAgICAgICAoZ2FwKSA9PlxyXG4gICAgICAgICAgbm9ybWFsaXplKGdhcC5jb25jZXB0KSA9PT0gbm9ybWFsaXplKGlucHV0LmV2YWx1YXRpb24uY29uY2VwdCkgJiZcclxuICAgICAgICAgIG5vcm1hbGl6ZShnYXAucmVhc29uKSA9PT0gbm9ybWFsaXplKG1pc2NvbmNlcHRpb24pLFxyXG4gICAgICApO1xyXG5cclxuICAgICAgaWYgKGV4aXN0aW5nKSB7XHJcbiAgICAgICAgaWYgKCFleGlzdGluZy5ldmlkZW5jZUlkcy5pbmNsdWRlcyhldmlkZW5jZS5pZCkpIHtcclxuICAgICAgICAgIGV4aXN0aW5nLmV2aWRlbmNlSWRzLnB1c2goZXZpZGVuY2UuaWQpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBleGlzdGluZy5zdGF0dXMgPSBcIm9wZW5cIjtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBzdGF0ZS5nYXBzLnB1c2goe1xyXG4gICAgICAgICAgaWQ6IGNyeXB0by5yYW5kb21VVUlEKCksXHJcbiAgICAgICAgICBjb25jZXB0OiBpbnB1dC5ldmFsdWF0aW9uLmNvbmNlcHQsXHJcbiAgICAgICAgICByZWFzb246IG1pc2NvbmNlcHRpb24sXHJcbiAgICAgICAgICBldmlkZW5jZUlkczogW2V2aWRlbmNlLmlkXSxcclxuICAgICAgICAgIHN0YXR1czogXCJvcGVuXCIsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAoXHJcbiAgICAgIGlucHV0LmV2YWx1YXRpb24ub3V0Y29tZSA9PT0gXCJjb3JyZWN0XCIgJiZcclxuICAgICAgaW5wdXQuZXZhbHVhdGlvbi5taXNjb25jZXB0aW9ucy5sZW5ndGggPT09IDBcclxuICAgICkge1xyXG4gICAgICBmb3IgKGNvbnN0IGdhcCBvZiBzdGF0ZS5nYXBzKSB7XHJcbiAgICAgICAgaWYgKFxyXG4gICAgICAgICAgbm9ybWFsaXplKGdhcC5jb25jZXB0KSA9PT1cclxuICAgICAgICAgICAgbm9ybWFsaXplKGlucHV0LmV2YWx1YXRpb24uY29uY2VwdCkgJiZcclxuICAgICAgICAgIGdhcC5zdGF0dXMgPT09IFwib3BlblwiXHJcbiAgICAgICAgKSB7XHJcbiAgICAgICAgICAvLyBPbmUgZ29vZCBhbnN3ZXIgaXMgZXZpZGVuY2Ugb2YgaW1wcm92ZW1lbnQsIG5vdCBwcm9vZiBvZiBtYXN0ZXJ5LlxyXG4gICAgICAgICAgZ2FwLnN0YXR1cyA9IFwiaW1wcm92aW5nXCI7XHJcbiAgICAgICAgICBnYXAuZXZpZGVuY2VJZHMucHVzaChldmlkZW5jZS5pZCk7XHJcbiAgICAgICAgfVxyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgYXdhaXQgdGhpcy5zYXZlKHN0YXRlKTtcclxuICAgIHJldHVybiBzdGF0ZTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlUm9vdCgpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IGV4aXN0aW5nID0gdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKFJPT1QpO1xyXG4gICAgaWYgKGV4aXN0aW5nKSByZXR1cm47XHJcblxyXG4gICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlRm9sZGVyKFJPT1QpO1xyXG4gIH1cclxufVxyXG4iLCAiZXhwb3J0IGludGVyZmFjZSBLbm93bGVkZ2VHYXAge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgY29uY2VwdDogc3RyaW5nO1xyXG4gIHJlYXNvbjogc3RyaW5nO1xyXG4gIGV2aWRlbmNlSWRzOiBzdHJpbmdbXTtcclxuICBzdGF0dXM6IFwib3BlblwiIHwgXCJpbXByb3ZpbmdcIiB8IFwicmVzb2x2ZWRcIjtcclxufVxyXG5cclxuZXhwb3J0IGludGVyZmFjZSBMZWFybmluZ0V2aWRlbmNlIHtcclxuICBpZDogc3RyaW5nO1xyXG4gIHR5cGU6IFwicHJhY3RpY2VcIiB8IFwicmV2aWV3XCIgfCBcInByb2plY3RcIjtcclxuICBjb25jZXB0OiBzdHJpbmc7XHJcbiAgc291cmNlOiBzdHJpbmc7XHJcbiAgb3V0Y29tZT86IHN0cmluZztcclxuICBjcmVhdGVkQXQ6IG51bWJlcjtcclxufVxyXG5cclxuZXhwb3J0IGludGVyZmFjZSBMZWFybmluZ1N0YXRlIHtcclxuICB2ZXJzaW9uOiAxO1xyXG4gIHRhcmdldDogc3RyaW5nO1xyXG4gIGN1cnJlbnRUb3BpYz86IHN0cmluZztcclxuICBnYXBzOiBLbm93bGVkZ2VHYXBbXTtcclxuICBldmlkZW5jZTogTGVhcm5pbmdFdmlkZW5jZVtdO1xyXG59XHJcblxyXG5leHBvcnQgY29uc3QgREVGQVVMVF9MRUFSTklOR19TVEFURTogTGVhcm5pbmdTdGF0ZSA9IHtcclxuICB2ZXJzaW9uOiAxLFxyXG4gIHRhcmdldDogXCJCYWNrZW5kIFNvZnR3YXJlIEVuZ2luZWVyXCIsXHJcbiAgZ2FwczogW10sXHJcbiAgZXZpZGVuY2U6IFtdLFxyXG59O1xyXG4iLCAiaW1wb3J0IHsgUGx1Z2luIH0gZnJvbSBcIm9ic2lkaWFuXCI7XHJcbmltcG9ydCB7IFNlc3Npb25TdG9yZSB9IGZyb20gXCIuL1Nlc3Npb25TdG9yZVwiO1xyXG5pbXBvcnQge1xyXG4gIEFnZW50QWRhcHRlcixcclxuICBBZ2VudENvbnRleHQsXHJcbiAgQWdlbnRJbnB1dCxcclxuICBBZ2VudE1vZGVsLFxuICBBZ2VudFN0cmVhbUV2ZW50LFxuICBDaGF0U2Vzc2lvbixcclxufSBmcm9tIFwiLi4vdHlwZXNcIjtcclxuXHJcbi8qKlxyXG4gKiBPd25zIGNoYXQvYWdlbnQgY29udmVyc2F0aW9uIHBlcnNpc3RlbmNlIG9ubHkuXHJcbiAqXHJcbiAqIExlYXJuaW5nIG9yY2hlc3RyYXRpb24sIGNvbnRleHQgcmVzb2x1dGlvbiwgYW5kIE1hcmtkb3duIG11dGF0aW9uIGxpdmUgYWJvdmVcclxuICogb3IgYmVzaWRlIHRoaXMgY2xhc3MuIFRoaXMga2VlcHMgc2Vzc2lvbiBzdGF0ZSBpbmRlcGVuZGVudCBvZiBMZWFybmluZyBPU1xyXG4gKiBiZWhhdmlvci5cclxuICovXHJcbmV4cG9ydCBjbGFzcyBTZXNzaW9uQ29udHJvbGxlciB7XHJcbiAgcHJpdmF0ZSBjdXJyZW50U2Vzc2lvbjogQ2hhdFNlc3Npb24gfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIG1vZGVsczogQWdlbnRNb2RlbFtdID0gW107XG5cclxuICBjb25zdHJ1Y3RvcihcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luOiBQbHVnaW4sXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IHN0b3JlOiBTZXNzaW9uU3RvcmUsXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IGFkYXB0ZXI6IEFnZW50QWRhcHRlcixcclxuICApIHt9XHJcblxyXG4gIGFzeW5jIGluaXQoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBkYXRhID0gYXdhaXQgdGhpcy5wbHVnaW4ubG9hZERhdGEoKTtcclxuICAgIGF3YWl0IHRoaXMuc3RvcmUubG9hZChkYXRhKTtcclxuXHJcbiAgICB0aGlzLmN1cnJlbnRTZXNzaW9uID0gdGhpcy5zdG9yZS5nZXRDdXJyZW50U2Vzc2lvbigpO1xyXG4gICAgaWYgKCF0aGlzLmN1cnJlbnRTZXNzaW9uKSB7XHJcbiAgICAgIHRoaXMuY3VycmVudFNlc3Npb24gPSB0aGlzLnN0b3JlLmNyZWF0ZVNlc3Npb24odGhpcy5zdG9yZS5nZXREZWZhdWx0TW9kZWwoKSk7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5hZGFwdGVyXHJcbiAgICAgIC5saXN0TW9kZWxzKClcclxuICAgICAgLnRoZW4oKG1vZGVscykgPT4ge1xyXG4gICAgICAgIHRoaXMubW9kZWxzID0gbW9kZWxzO1xyXG4gICAgICB9KVxyXG4gICAgICAuY2F0Y2goKCkgPT4ge1xyXG4gICAgICAgIC8vIE1vZGVsIGRpc2NvdmVyeSBpcyBiZXN0LWVmZm9ydDsgdGhlIHBlcnNpc3RlZCBkZWZhdWx0IHJlbWFpbnMgdXNhYmxlLlxyXG4gICAgICB9KTtcclxuICB9XHJcblxyXG4gIHBpbmcoKTogUHJvbWlzZTxzdHJpbmc+IHtcclxuICAgIHJldHVybiB0aGlzLmFkYXB0ZXIucGluZygpO1xyXG4gIH1cclxuXHJcbiAgZ2V0U2Vzc2lvbigpOiBDaGF0U2Vzc2lvbiB7XHJcbiAgICBpZiAoIXRoaXMuY3VycmVudFNlc3Npb24pIHRocm93IG5ldyBFcnJvcihcIlNlc3Npb24gbm90IGluaXRpYWxpemVkXCIpO1xyXG4gICAgcmV0dXJuIHRoaXMuY3VycmVudFNlc3Npb247XHJcbiAgfVxyXG5cclxuICBhc3luYyBuZXdTZXNzaW9uKCk6IFByb21pc2U8Q2hhdFNlc3Npb24+IHtcclxuICAgIGNvbnN0IG1vZGVsID0gdGhpcy5jdXJyZW50U2Vzc2lvbj8ubW9kZWwgPz8gdGhpcy5zdG9yZS5nZXREZWZhdWx0TW9kZWwoKTtcclxuICAgIHRoaXMuY3VycmVudFNlc3Npb24gPSB0aGlzLnN0b3JlLmNyZWF0ZVNlc3Npb24obW9kZWwpO1xyXG4gICAgYXdhaXQgdGhpcy5zYXZlKCk7XHJcbiAgICByZXR1cm4gdGhpcy5jdXJyZW50U2Vzc2lvbjtcclxuICB9XHJcblxyXG4gIHNldE1vZGVsKG1vZGVsSWQ6IHN0cmluZyk6IHZvaWQge1xyXG4gICAgdGhpcy5zdG9yZS5zZXREZWZhdWx0TW9kZWwobW9kZWxJZCk7XHJcblxyXG4gICAgaWYgKHRoaXMuY3VycmVudFNlc3Npb24pIHtcclxuICAgICAgdGhpcy5jdXJyZW50U2Vzc2lvbi5tb2RlbCA9IG1vZGVsSWQ7XHJcbiAgICAgIHRoaXMuc3RvcmUudXBkYXRlU2Vzc2lvbih0aGlzLmN1cnJlbnRTZXNzaW9uKTtcclxuICAgICAgdm9pZCB0aGlzLnNhdmUoKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIGdldE1vZGVscygpOiBBZ2VudE1vZGVsW10ge1xuICAgIHJldHVybiB0aGlzLm1vZGVscztcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEV4ZWN1dGUgb25lIHByZXBhcmVkIGFnZW50IHR1cm4uXHJcbiAgICpcclxuICAgKiBDb250ZXh0IGlzIGFscmVhZHkgcmVzb2x2ZWQgYnkgTGVhcm5pbmdDb250cm9sbGVyLiBkaXNwbGF5UHJvbXB0IGlzIHRoZSByYXdcclxuICAgKiB1c2VyIHRleHQgc3RvcmVkIGluIGxvY2FsIGhpc3Rvcnkgc28gaW50ZXJuYWwgbGVhcm5pbmcgaW5zdHJ1Y3Rpb25zIGRvIG5vdFxyXG4gICAqIGxlYWsgaW50byB0aGUgdmlzaWJsZS9zZXNzaW9uIHRyYW5zY3JpcHQuXHJcbiAgICovXHJcbiAgYXN5bmMgKnNlbmRUdXJuKFxyXG4gICAgcHJvbXB0OiBzdHJpbmcsXHJcbiAgICBjb250ZXh0OiBBZ2VudENvbnRleHRbXSA9IFtdLFxyXG4gICAgZGlzcGxheVByb21wdDogc3RyaW5nID0gcHJvbXB0LFxyXG4gICk6IEFzeW5jSXRlcmFibGU8QWdlbnRTdHJlYW1FdmVudD4ge1xuICAgIGNvbnN0IHNlc3Npb24gPSB0aGlzLmdldFNlc3Npb24oKTtcclxuICAgIGNvbnN0IGlucHV0OiBBZ2VudElucHV0ID0geyBwcm9tcHQsIGNvbnRleHQgfTtcclxuXHJcbiAgICBzZXNzaW9uLm1lc3NhZ2VzLnB1c2goe1xyXG4gICAgICByb2xlOiBcInVzZXJcIixcclxuICAgICAgY29udGVudDogZGlzcGxheVByb21wdCxcclxuICAgIH0pO1xyXG5cclxuICAgIGxldCBmdWxsVGV4dCA9IFwiXCI7XHJcblxyXG4gICAgZm9yIGF3YWl0IChjb25zdCBldmVudCBvZiB0aGlzLmFkYXB0ZXIuc2VuZChpbnB1dCwge1xyXG4gICAgICBtb2RlbDogc2Vzc2lvbi5tb2RlbCxcclxuICAgICAgY29udmVyc2F0aW9uSWQ6IHNlc3Npb24uY29udmVyc2F0aW9uSWQsXHJcbiAgICB9KSkge1xyXG4gICAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJ0ZXh0XCIpIHtcclxuICAgICAgICBmdWxsVGV4dCArPSBldmVudC5jb250ZW50O1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJkb25lXCIgJiYgZXZlbnQuY29udmVyc2F0aW9uSWQpIHtcclxuICAgICAgICBzZXNzaW9uLmNvbnZlcnNhdGlvbklkID0gZXZlbnQuY29udmVyc2F0aW9uSWQ7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHlpZWxkIGV2ZW50O1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChmdWxsVGV4dCkge1xyXG4gICAgICBzZXNzaW9uLm1lc3NhZ2VzLnB1c2goe1xyXG4gICAgICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXHJcbiAgICAgICAgY29udGVudDogZnVsbFRleHQsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuc3RvcmUudXBkYXRlU2Vzc2lvbihzZXNzaW9uKTtcclxuICAgIGF3YWl0IHRoaXMuc2F2ZSgpO1xyXG4gIH1cclxuXHJcbiAgY2FuY2VsKCk6IHZvaWQge1xyXG4gICAgdGhpcy5hZGFwdGVyLmFib3J0KCk7XHJcbiAgfVxyXG5cclxuICBkZXN0cm95KCk6IHZvaWQge1xyXG4gICAgdGhpcy5hZGFwdGVyLmFib3J0KCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHNhdmUoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlRGF0YSh0aGlzLnN0b3JlLnNlcmlhbGl6ZSgpKTtcclxuICB9XHJcbn1cclxuIiwgImltcG9ydCB7IENoYXRTZXNzaW9uIH0gZnJvbSBcIi4uL3R5cGVzXCI7XG5cbmNvbnN0IFNUT1JFX0tFWSA9IFwiZm9yZ2Utc2Vzc2lvbnNcIjtcbmNvbnN0IExFR0FDWV9TVE9SRV9LRVkgPSBcImFneS1zZXNzaW9uc1wiO1xuY29uc3QgREVGQVVMVF9NT0RFTCA9IFwiZ2VtaW5pLTMuOC1mbGFzaC1tZWRpdW1cIjtcblxuaW50ZXJmYWNlIFN0b3JlRGF0YSB7XG4gIGN1cnJlbnRTZXNzaW9uSWQ6IHN0cmluZyB8IG51bGw7XG4gIHNlc3Npb25zOiBSZWNvcmQ8c3RyaW5nLCBDaGF0U2Vzc2lvbj47XG4gIGRlZmF1bHRNb2RlbDogc3RyaW5nO1xufVxuXG4vKipcbiAqIFNlc3Npb25TdG9yZSBcdTIwMTQgcGVyc2lzdHMgc2Vzc2lvbnMgdG8gT2JzaWRpYW4gcGx1Z2luIGRhdGEuXG4gKlxuICogU3Bpa2UgNTogc2Vzc2lvbnMgc3Vydml2ZSBPYnNpZGlhbiByZXN0YXJ0cy5cbiAqIFRoZSBzdG9yZSBpcyBhIHRoaW4gd3JhcHBlciBhcm91bmQgcGx1Z2luLmxvYWREYXRhIC8gcGx1Z2luLnNhdmVEYXRhLlxuICovXG5leHBvcnQgY2xhc3MgU2Vzc2lvblN0b3JlIHtcbiAgcHJpdmF0ZSBkYXRhOiBTdG9yZURhdGEgPSB7XG4gICAgY3VycmVudFNlc3Npb25JZDogbnVsbCxcbiAgICBzZXNzaW9uczoge30sXG4gICAgZGVmYXVsdE1vZGVsOiBERUZBVUxUX01PREVMLFxuICB9O1xuXG4gIC8qKiBDYWxsIG9uY2Ugb24gcGx1Z2luIGxvYWQuICovXG4gIGFzeW5jIGxvYWQocmF3RGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3Qgc3RvcmVkID0gcmF3RGF0YT8uW1NUT1JFX0tFWV0gPz8gcmF3RGF0YT8uW0xFR0FDWV9TVE9SRV9LRVldO1xuICAgIGlmIChzdG9yZWQpIHtcbiAgICAgIHRoaXMuZGF0YSA9IHN0b3JlZCBhcyBTdG9yZURhdGE7XG4gICAgfVxuICB9XG5cbiAgLyoqIFNlcmlhbGl6ZSB0byBwbHVnaW4gZGF0YSBvYmplY3QuICovXG4gIHNlcmlhbGl6ZSgpOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gICAgcmV0dXJuIHsgW1NUT1JFX0tFWV06IHRoaXMuZGF0YSB9O1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIFNlc3Npb24gQ1JVRCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBjcmVhdGVTZXNzaW9uKG1vZGVsOiBzdHJpbmcpOiBDaGF0U2Vzc2lvbiB7XG4gICAgY29uc3Qgc2Vzc2lvbjogQ2hhdFNlc3Npb24gPSB7XG4gICAgICBpZDogY3J5cHRvLnJhbmRvbVVVSUQoKSxcbiAgICAgIG1vZGVsLFxuICAgICAgbWVzc2FnZXM6IFtdLFxuICAgICAgY3JlYXRlZEF0OiBEYXRlLm5vdygpLFxuICAgICAgdXBkYXRlZEF0OiBEYXRlLm5vdygpLFxuICAgIH07XG4gICAgdGhpcy5kYXRhLnNlc3Npb25zW3Nlc3Npb24uaWRdID0gc2Vzc2lvbjtcbiAgICB0aGlzLmRhdGEuY3VycmVudFNlc3Npb25JZCA9IHNlc3Npb24uaWQ7XG4gICAgcmV0dXJuIHNlc3Npb247XG4gIH1cblxuICBnZXRTZXNzaW9uKGlkOiBzdHJpbmcpOiBDaGF0U2Vzc2lvbiB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLmRhdGEuc2Vzc2lvbnNbaWRdID8/IG51bGw7XG4gIH1cblxuICBnZXRDdXJyZW50U2Vzc2lvbigpOiBDaGF0U2Vzc2lvbiB8IG51bGwge1xuICAgIGlmICghdGhpcy5kYXRhLmN1cnJlbnRTZXNzaW9uSWQpIHJldHVybiBudWxsO1xuICAgIHJldHVybiB0aGlzLmdldFNlc3Npb24odGhpcy5kYXRhLmN1cnJlbnRTZXNzaW9uSWQpO1xuICB9XG5cbiAgdXBkYXRlU2Vzc2lvbihzZXNzaW9uOiBDaGF0U2Vzc2lvbik6IHZvaWQge1xuICAgIHNlc3Npb24udXBkYXRlZEF0ID0gRGF0ZS5ub3coKTtcbiAgICB0aGlzLmRhdGEuc2Vzc2lvbnNbc2Vzc2lvbi5pZF0gPSBzZXNzaW9uO1xuICB9XG5cbiAgc2V0Q3VycmVudFNlc3Npb24oaWQ6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMuZGF0YS5jdXJyZW50U2Vzc2lvbklkID0gaWQ7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgTW9kZWwgcHJlZmVyZW5jZSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBnZXREZWZhdWx0TW9kZWwoKTogc3RyaW5nIHtcbiAgICByZXR1cm4gdGhpcy5kYXRhLmRlZmF1bHRNb2RlbCA/PyBERUZBVUxUX01PREVMO1xuICB9XG5cbiAgc2V0RGVmYXVsdE1vZGVsKG1vZGVsOiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLmRhdGEuZGVmYXVsdE1vZGVsID0gbW9kZWw7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgVXRpbGl0eSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICAvKiogQWxsIHNlc3Npb25zLCBuZXdlc3QgZmlyc3QuICovXG4gIGxpc3RTZXNzaW9ucygpOiBDaGF0U2Vzc2lvbltdIHtcbiAgICByZXR1cm4gT2JqZWN0LnZhbHVlcyh0aGlzLmRhdGEuc2Vzc2lvbnMpLnNvcnQoXG4gICAgICAoYSwgYikgPT4gYi51cGRhdGVkQXQgLSBhLnVwZGF0ZWRBdFxuICAgICk7XG4gIH1cbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsSUFBQUEsbUJBQTBDOzs7QUNBMUMsMkJBQW9DO0FBQ3BDLGdCQUEyQjtBQUMzQixnQkFBd0I7QUFDeEIsa0JBQXFCO0FBVXJCLFNBQVMsZ0JBQWdCLE9BQXVCO0FBQzlDLFNBQU8sTUFDSixRQUFRLE1BQU0sT0FBTyxFQUNyQixRQUFRLE1BQU0sUUFBUSxFQUN0QixRQUFRLE1BQU0sTUFBTSxFQUNwQixRQUFRLE1BQU0sTUFBTTtBQUN6QjtBQWVPLElBQU0sYUFBTixNQUF5QztBQUFBLEVBRzlDLFlBQTZCLEtBQWM7QUFBZDtBQUY3QixTQUFRLE9BQTRCO0FBQUEsRUFFUTtBQUFBO0FBQUEsRUFJNUMsTUFBTSxPQUF3QjtBQXpDaEM7QUEwQ0ksVUFBTSxjQUFhLGFBQVEsSUFBSSxhQUFaLG1CQUFzQjtBQUN6QyxVQUFNLGFBQWE7QUFBQSxNQUNqQjtBQUFBLE1BQ0EsR0FBSSxRQUFR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QUFTLENBQUMsRUFBRSxXQUFXLENBQUMsS0FBSyxHQUFHLEtBQUssSUFBSSxDQUFDO0FBQUEsTUFDMUMsVUFBVSxZQUFZO0FBQ3BCLGNBQU0sS0FBSyxhQUFhO0FBRXhCLG1CQUFXLE1BQU07QUE3RXpCO0FBOEVVLGdCQUFNLFNBQVMsS0FBSyxJQUFJLFVBQVUsZ0JBQWdCLGVBQWU7QUFDakUsZ0JBQU0sUUFBTyxZQUFPLENBQUMsTUFBUixtQkFBVztBQUN4QixXQUFDLHdDQUFjLFVBQWQsbUJBQXFCLFVBQXJCO0FBQUEsUUFDSCxHQUFHLEdBQUc7QUFBQSxNQUNSO0FBQUEsSUFDRixDQUFDO0FBQUEsRUFDSDtBQUFBLEVBRUEsTUFBTSxXQUEwQjtBQXRGbEM7QUF1RkksU0FBSyxJQUFJLFVBQVUsbUJBQW1CLGVBQWU7QUFDckQsZUFBSyxhQUFMLG1CQUFlO0FBQUEsRUFDakI7QUFBQSxFQUVBLE1BQWMsZUFBOEI7QUFDMUMsVUFBTSxFQUFFLFVBQVUsSUFBSSxLQUFLO0FBQzNCLFVBQU0sV0FBVyxVQUFVLGdCQUFnQixlQUFlO0FBRTFELFFBQUksU0FBUyxTQUFTLEdBQUc7QUFDdkIsZ0JBQVUsV0FBVyxTQUFTLENBQUMsQ0FBQztBQUNoQztBQUFBLElBQ0Y7QUFFQSxVQUFNLE9BQU8sVUFBVSxhQUFhLEtBQUs7QUFDekMsUUFBSSxDQUFDLEtBQU07QUFFWCxVQUFNLEtBQUssYUFBYTtBQUFBLE1BQ3RCLE1BQU07QUFBQSxNQUNOLFFBQVE7QUFBQSxJQUNWLENBQUM7QUFDRCxjQUFVLFdBQVcsSUFBSTtBQUFBLEVBQzNCO0FBQ0Y7IiwKICAibmFtZXMiOiBbImltcG9ydF9vYnNpZGlhbiIsICJfYSIsICJfYSIsICJpbXBvcnRfb2JzaWRpYW4iLCAiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF9vYnNpZGlhbiIsICJjb250ZW50IiwgIm1hdGNoZXMiLCAiaW5kZXgiLCAiaW1wb3J0X29ic2lkaWFuIl0KfQo=
