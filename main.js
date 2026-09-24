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
var import_obsidian7 = require("obsidian");

// src/agent/AgyAdapter.ts
var import_child_process = require("child_process");
var import_fs = require("fs");
var import_os = require("os");
var import_path = require("path");
function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
var AgyAdapter = class {
  constructor(cwd, getConfig = () => ({})) {
    this.cwd = cwd;
    this.getConfig = getConfig;
  }
  // ── binary resolution ─────────────────────────────────────────────────────
  async check() {
    var _a;
    try {
      await this.resolveBinary();
      return { status: "ready" };
    } catch (error) {
      const configured = (_a = this.getConfig().executablePath) == null ? void 0 : _a.trim();
      return {
        status: configured ? "misconfigured" : "unavailable",
        failure: this.failureFrom(error, "runtime-unavailable")
      };
    }
  }
  async resolveBinary() {
    var _a, _b;
    const configured = ((_a = this.getConfig().executablePath) == null ? void 0 : _a.trim()) || ((_b = process.env.AGY_PATH) == null ? void 0 : _b.trim());
    if (configured && !(0, import_fs.existsSync)(configured)) {
      throw new Error(`Configured agent executable does not exist: ${configured}`);
    }
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
  async *send(input, opts, signal) {
    if (signal.aborted) {
      yield { type: "cancelled" };
      return;
    }
    let bin;
    try {
      bin = await this.resolveBinary();
    } catch (error) {
      yield {
        type: "failed",
        failure: this.failureFrom(error, "runtime-unavailable")
      };
      return;
    }
    const fullPrompt = this.buildFullPrompt(input);
    const args = this.buildArgs(fullPrompt, opts);
    const proc = (0, import_child_process.spawn)(bin, args, {
      cwd: this.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    const abort = () => {
      if (proc.exitCode === null && !proc.killed) proc.kill("SIGTERM");
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      yield* this.readEvents(proc, signal);
    } finally {
      signal.removeEventListener("abort", abort);
      abort();
    }
  }
  buildArgs(prompt, opts) {
    const args = [
      "--print",
      prompt,
      "--output-format",
      "stream-json"
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
  async *readEvents(proc, signal) {
    var _a, _b, _c, _d;
    let buffer = "";
    let stderr = "";
    let exitCode = null;
    const processState = {};
    let closed = false;
    let sawTerminalEvent = false;
    let conversationId;
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
      if (signal.aborted) {
        yield { type: "cancelled" };
        break;
      }
      if (queue.length > 0) {
        const line = queue.shift();
        conversationId = (_c = this.readConversationId(line)) != null ? _c : conversationId;
        const event = this.parseLine(line, conversationId);
        if (!event) continue;
        yield event;
        if (event.type === "completed" || event.type === "failed") {
          sawTerminalEvent = true;
          break;
        }
        continue;
      }
      if (closed) {
        if (!sawTerminalEvent) {
          if (signal.aborted) {
            yield { type: "cancelled" };
            break;
          }
          const detail = ((_d = processState.spawnError) == null ? void 0 : _d.message) || stderr.trim() || (exitCode !== 0 ? `AGY exited with code ${exitCode != null ? exitCode : "unknown"} before returning a result.` : "AGY exited without returning a result.");
          yield {
            type: "failed",
            failure: this.failureFrom(detail, "process-failed")
          };
        }
        break;
      }
      if (processState.spawnError) {
        yield {
          type: "failed",
          failure: this.failureFrom(processState.spawnError, "process-failed")
        };
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
  parseLine(line, conversationId) {
    var _a, _b, _c;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch (e) {
      return null;
    }
    const ev = obj["event"];
    if (ev === "init") {
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
      const status = String((_a = result == null ? void 0 : result["status"]) != null ? _a : "").toUpperCase();
      const convId = (result == null ? void 0 : result["conversation_id"]) || conversationId;
      if (status && status !== "SUCCESS") {
        const message = String(
          (_b = result == null ? void 0 : result["error"]) != null ? _b : `AGY finished with status ${status} without an error message.`
        );
        return {
          type: "failed",
          failure: this.failureFrom(message, this.classifyFailure(message))
        };
      }
      return { type: "completed", conversationId: convId };
    }
    if (ev === "error") {
      return {
        type: "failed",
        failure: this.failureFrom(
          String((_c = obj["error"]) != null ? _c : "Unknown agent runtime error"),
          "process-failed"
        )
      };
    }
    return null;
  }
  readConversationId(line) {
    var _a;
    try {
      const value = JSON.parse(line);
      if (value["event"] !== "init") return void 0;
      return value["conversation_id"] || ((_a = value["init"]) == null ? void 0 : _a["conversation_id"]);
    } catch (e) {
      return void 0;
    }
  }
  // ── listModels ────────────────────────────────────────────────────────────
  async listModels() {
    const bin = await this.resolveBinary();
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
  classifyFailure(message) {
    const normalized = message.toLowerCase();
    if (normalized.includes("permission") || normalized.includes("approval")) {
      return "permission-required";
    }
    if (normalized.includes("json") || normalized.includes("protocol")) {
      return "protocol-invalid";
    }
    return "process-failed";
  }
  failureFrom(error, code) {
    const diagnostic = error instanceof Error ? error.message : String(error);
    const message = code === "runtime-unavailable" ? "Agent runtime is unavailable. Configure its executable path and try again." : code === "permission-required" ? "The agent runtime requires approval before it can continue." : code === "protocol-invalid" ? "The agent runtime returned an invalid response." : "The agent runtime could not complete the request.";
    return { code, message, diagnostic };
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
  constructor(leaf, learning, openSettings, getLogoUrl) {
    super(leaf);
    this.learning = learning;
    this.openSettings = openSettings;
    this.getLogoUrl = getLogoUrl;
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
    return "forge-logo";
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
      const health = await this.learning.checkRuntime();
      if (health.status !== "ready") {
        this.showError(health.failure.message);
        return;
      }
    } catch (e) {
      this.showError("Agent runtime is unavailable. Check Forge runtime settings.");
      return;
    }
    await this.syncChips();
    await this.restoreSession();
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
  focusComposer() {
    var _a;
    (_a = this.input) == null ? void 0 : _a.focus();
  }
  buildHeader(root) {
    this.headerEl = root.createDiv({ cls: "forge-header" });
    const top = this.headerEl.createDiv({ cls: "forge-header-top" });
    const brand = top.createDiv({ cls: "forge-header-brand" });
    brand.createEl("img", {
      cls: "forge-header-logo",
      attr: {
        src: this.getLogoUrl(),
        alt: "Forge"
      }
    });
    const copy = brand.createDiv({ cls: "forge-header-copy" });
    copy.createSpan({ cls: "forge-header-title", text: "Forge" });
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
    const moreBtn = right.createEl("button", {
      cls: "forge-more-btn",
      text: "\u22EF",
      attr: {
        type: "button",
        "aria-label": "Open Forge settings"
      }
    });
    moreBtn.title = "Forge settings";
    moreBtn.addEventListener("click", () => this.openSettings());
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
    this.modelSelect.empty();
    const currentModel = this.learning.getSession().model;
    const defaultOption = this.modelSelect.createEl("option", {
      value: "",
      text: "Runtime default"
    });
    defaultOption.selected = !currentModel;
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
    this.systemChip = chips.createSpan({
      cls: "forge-chip forge-chip--hidden"
    });
    this.systemChip.createSpan({ cls: "forge-chip-dot" });
    this.systemChip.createSpan({
      cls: "forge-chip-label",
      text: "@forge-system"
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
        placeholder: "Ask anything about this note...",
        rows: "1"
      }
    });
    this.input.addEventListener("input", () => this.onInput());
    this.input.addEventListener("keydown", (event) => this.onKey(event));
    const footer = box.createDiv({ cls: "forge-composer-footer" });
    const tools = footer.createDiv({ cls: "forge-composer-tools" });
    this.contextSelect = tools.createEl("button", {
      cls: "forge-context-select",
      text: "Current note",
      attr: {
        type: "button",
        "aria-label": "Choose context"
      }
    });
    this.contextSelect.addEventListener("click", () => {
      this.promptMenu = this.promptMenu === "source" ? null : "source";
      this.promptMenuActive = 0;
      this.renderPromptMenu();
      this.input.focus();
    });
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
      this.cancelBtn.disabled = true;
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
      ask: "Ask anything about this note...",
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
    var _a, _b, _c, _d;
    const context = await this.learning.resolveContext(this.extraCtx);
    this.currentContext = context;
    this.systemChip.addClass("forge-chip--hidden");
    const hasSelection = Boolean(context.selection);
    this.selectionChip.toggleClass("forge-chip--hidden", !hasSelection);
    const activeNote = context.activeNote;
    this.noteChip.toggleClass("forge-chip--hidden", !activeNote);
    if (activeNote) {
      const name = (_a = activeNote.path.split("/").pop()) != null ? _a : activeNote.path;
      const label = this.noteChip.querySelector(".forge-chip-label");
      if (label) label.textContent = `@${name}`;
      this.noteChip.title = activeNote.path;
    }
    const sourceName = context.selection ? "Current selection" : activeNote ? "Current note" : this.extraCtx.length > 0 ? `${this.extraCtx.length} sources` : "No context";
    this.contextSelect.textContent = sourceName;
    this.contextSelect.title = (_d = (_c = (_b = context.selection) == null ? void 0 : _b.file) != null ? _c : activeNote == null ? void 0 : activeNote.path) != null ? _d : sourceName;
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
    this.agentCursorEl = null;
    this.agentContentEl = null;
    this.statusEl = null;
    this.streamedResponseText = "";
    this.streamingPendingText = "";
    this.stopThinkingSequence();
    this.stopLoadingTimer();
    this.appendUserBubble(prompt);
    this.setUIState("RUNNING");
    this.ensureAgentBubble();
    try {
      for await (const event of this.learning.run({
        prompt,
        action: this.selectedAction,
        explicitContext
      })) {
        this.handleLearningEvent(event);
      }
    } catch (err) {
      this.finishStreamingBubble("Stopped");
      const message = err instanceof Error ? err.message : String(err);
      console.warn("[Forge] Unexpected turn failure", message);
      this.appendInlineError(
        this.thread,
        "Forge hit an unexpected error. Try again."
      );
      this.setUIState("ANSWER");
    }
  }
  handleLearningEvent(event) {
    if (event.type === "context-ready") {
      this.currentContext = event.context.resolved;
      this.systemChip.toggleClass("forge-chip--hidden", event.context.system.length === 0);
      this.systemChip.title = event.context.system.map((item) => item.file).join("\n");
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
      this.appendProposalBubble(event.edit);
      return;
    }
    if (event.type === "completed") {
      if (this.uiState === "RUNNING") {
        this.setUIState("ANSWER");
      }
      this.finishStreamingBubble();
      return;
    }
    if (event.type === "cancelled") {
      this.finishStreamingBubble("Stopped");
      this.appendInlineError(this.thread, "Stopped.");
      this.setUIState("ANSWER");
      return;
    }
    if (event.type === "failed") {
      this.finishStreamingBubble("Unable to finish");
      this.appendInlineError(this.thread, event.failure.message);
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
    (_a = this.agentCursorEl) == null ? void 0 : _a.removeClass("forge-bubble--streaming");
    this.agentCursorEl = null;
    this.agentContentEl = null;
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
    this.cancelBtn.disabled = false;
    this.input.disabled = busy || state === "ERROR";
    this.sendBtn.disabled = busy || state === "ERROR" || !this.canSend();
    this.cancelBtn.toggleClass("forge-hidden", !busy);
  }
  canSend() {
    return this.input.value.trim().length > 0 || this.attachments.length > 0;
  }
  showEmpty() {
    this.stopLoadingTimer();
    this.thread.empty();
    this.agentCursorEl = null;
    this.statusEl = null;
    const slate = this.thread.createDiv({
      cls: "forge-empty-slate"
    });
    slate.createEl("img", {
      cls: "forge-empty-logo",
      attr: {
        src: this.getLogoUrl(),
        alt: "Forge"
      }
    });
    const label = "What are you learning?";
    slate.createDiv({
      cls: "forge-empty-label",
      text: label
    });
    slate.createDiv({
      cls: "forge-empty-hint",
      text: "Ask about the current note, or jump into a focused workflow when you need more than chat."
    });
    const quickActions = slate.createDiv({ cls: "forge-empty-actions" });
    const quickActionMap = [
      ["explain", "Explain this"],
      ["practice", "Practice"],
      ["edit", "Improve note"]
    ];
    for (const [action, text] of quickActionMap) {
      const button = quickActions.createEl("button", {
        cls: "forge-empty-action",
        text,
        attr: { type: "button" }
      });
      button.addEventListener("click", () => {
        this.selectedAction = action;
        this.syncActionButtons();
        this.updatePlaceholder();
        this.focusComposer();
      });
    }
    this.setUIState("EMPTY");
  }
  async restoreSession() {
    const messages = this.learning.getSession().messages;
    if (messages.length === 0) {
      this.showEmpty();
      return;
    }
    this.thread.empty();
    for (const message of messages) {
      if (message.role === "user") {
        this.appendUserBubble(message.content);
        continue;
      }
      if (message.content.trim()) {
        await this.appendRestoredAssistant(message.content);
      }
      if (message.proposal) {
        this.appendRestoredProposal(message);
      }
    }
    this.setUIState("ANSWER");
    this.scrollThread();
  }
  async appendRestoredAssistant(markdown) {
    var _a, _b, _c, _d, _e, _f;
    const bubble = this.thread.createDiv({
      cls: "forge-bubble forge-bubble--agent"
    });
    const meta = bubble.createDiv({ cls: "forge-response-meta" });
    meta.createSpan({ cls: "forge-response-label", text: "Forge" });
    meta.createSpan({ cls: "forge-response-sub", text: "Restored" });
    const content = bubble.createDiv({
      cls: "forge-bubble-content forge-markdown"
    });
    const sourcePath = (_f = (_e = (_b = (_a = this.currentContext) == null ? void 0 : _a.selection) == null ? void 0 : _b.file) != null ? _e : (_d = (_c = this.currentContext) == null ? void 0 : _c.activeNote) == null ? void 0 : _d.path) != null ? _f : "Forge.md";
    await import_obsidian.MarkdownRenderer.render(
      this.app,
      markdown,
      content,
      sourcePath,
      this
    );
  }
  appendRestoredProposal(message) {
    var _a;
    const proposal = message.proposal;
    if (!proposal) return;
    const wrap = this.renderProposal(proposal);
    const state = (_a = message.proposalState) != null ? _a : "stale";
    const labels = {
      applied: `\u2713 Applied to ${proposal.file}`,
      rejected: "\u2715 Rejected",
      stale: "\u26A0 Expired after restart",
      pending: "\u26A0 Expired after restart"
    };
    wrap.createDiv({
      cls: `forge-result-badge forge-badge--${state === "applied" ? "applied" : state === "rejected" ? "rejected" : "stale"}`,
      text: labels[state]
    });
  }
  showError(message) {
    this.stopLoadingTimer();
    this.thread.empty();
    this.agentCursorEl = null;
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
      this.openSettings();
    });
    this.setUIState("ERROR");
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
    if (this.agentCursorEl) return;
    this.statusEl = this.buildThinkingTrace();
    this.agentCursorEl = this.thread.createDiv({
      cls: "forge-bubble forge-bubble--agent forge-bubble--streaming"
    });
    const meta = this.agentCursorEl.createDiv({ cls: "forge-response-meta" });
    meta.createSpan({ cls: "forge-response-label", text: "Forge" });
    meta.createSpan({
      cls: "forge-response-sub",
      text: (_b = (_a = ACTIONS.find((action) => action.kind === this.selectedAction)) == null ? void 0 : _a.label) != null ? _b : "Response"
    });
    this.responseTimeEl = meta.createSpan({ cls: "forge-response-time", text: "for 0.0s" });
    this.agentContentEl = this.agentCursorEl.createDiv({
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
    toggle.createEl("img", {
      cls: "forge-thinking-logo",
      attr: {
        src: this.getLogoUrl(),
        alt: ""
      }
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
    if (!this.agentContentEl) return;
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
        this.agentContentEl.appendText(part);
        continue;
      }
      this.agentContentEl.createSpan({
        cls: "forge-stream-word",
        text: part
      });
    }
    this.scrollThread();
  }
  flushStreamingText() {
    if (!this.agentContentEl || !this.streamingPendingText) return;
    this.agentContentEl.createSpan({
      cls: "forge-stream-word",
      text: this.streamingPendingText
    });
    this.streamingPendingText = "";
  }
  renderMarkdownResponse() {
    var _a, _b, _c, _d, _e, _f;
    if (!this.agentContentEl || !this.streamedResponseText.trim()) return;
    const content = this.agentContentEl;
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
    if (!this.agentCursorEl || !this.streamedResponseText.trim()) return;
    const responseText = this.streamedResponseText.trim();
    const actions = this.agentCursorEl.createDiv({
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
    if (!this.agentCursorEl) return;
    const card = this.agentCursorEl.createDiv({
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
    if (!this.agentCursorEl) return;
    const card = this.agentCursorEl.createDiv({
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
  appendProposalBubble(edit) {
    const proposal = edit.proposal;
    const wrap = this.renderProposal(proposal);
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
      void this.learning.rejectProposal(edit.id);
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
      const result = await this.learning.applyProposal(edit.id);
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
  renderProposal(proposal) {
    const wrap = this.thread.createDiv({ cls: "forge-proposal" });
    wrap.createDiv({
      cls: "forge-proposal-badge",
      text: "\u{1F4C4} " + proposal.file
    });
    if (proposal.reason) {
      wrap.createDiv({ cls: "forge-proposal-reason", text: proposal.reason });
    }
    const diff = wrap.createDiv({ cls: "forge-proposal-diff" });
    proposal.original.split("\n").forEach((line) => {
      diff.createDiv({ cls: "forge-diff-removed", text: "- " + line });
    });
    proposal.replacement.split("\n").forEach((line) => {
      diff.createDiv({ cls: "forge-diff-added", text: "+ " + line });
    });
    return wrap;
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
    this.activeTurn = null;
    this.pendingProposals = /* @__PURE__ */ new Map();
  }
  checkRuntime() {
    return this.sessions.checkRuntime();
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
    if (this.activeTurn) {
      yield {
        type: "failed",
        failure: { code: "busy", message: "Another Forge turn is still running." }
      };
      return;
    }
    const context = await this.contexts.resolve(request.explicitContext);
    const [policy, state] = await Promise.all([
      this.policies.load(),
      this.learningState.load()
    ]);
    const visible = this.contexts.toAgentContext(context);
    const system = [];
    if (policy.rawInstructions) {
      const alreadyIncluded = visible.some(
        (item) => item.type === "note" && item.file === policy.path
      );
      if (!alreadyIncluded) {
        system.push({
          type: "note",
          file: policy.path,
          content: policy.rawInstructions
        });
      }
    }
    system.push({
      type: "note",
      file: "00-learning-os/progress.json",
      content: JSON.stringify(state, null, 2)
    });
    const snapshot = {
      resolved: context,
      visible,
      system,
      allowedMutationFiles: Array.from(
        new Set(
          visible.filter((item) => !item.file.startsWith("attachment/")).map((item) => item.file)
        )
      )
    };
    yield { type: "context-ready", context: snapshot };
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
    const controller = new AbortController();
    const activeTurn = { controller };
    this.activeTurn = activeTurn;
    const timeout = setTimeout(() => {
      activeTurn.cancelReason = "timeout";
      controller.abort();
    }, 6e4);
    let visibleText = "";
    try {
      for await (const event of this.sessions.sendTurn(
        preparedPrompt,
        [...snapshot.visible, ...snapshot.system],
        request.prompt,
        controller.signal
      )) {
        if (event.type === "text") {
          for await (const mapped of this.mapStructuredEvents(
            parser.push(event.content),
            request,
            snapshot
          )) {
            if (mapped.type === "response-delta") visibleText += mapped.text;
            if (mapped.type === "mutation-proposed") {
              await this.sessions.recordAssistantMessage(visibleText);
              visibleText = "";
              await this.sessions.recordProposal(
                mapped.edit.id,
                mapped.edit.proposal
              );
            }
            yield mapped;
          }
          continue;
        }
        if (event.type === "completed") {
          for await (const mapped of this.mapStructuredEvents(
            parser.finish(),
            request,
            snapshot
          )) {
            if (mapped.type === "response-delta") visibleText += mapped.text;
            if (mapped.type === "mutation-proposed") {
              await this.sessions.recordAssistantMessage(visibleText);
              visibleText = "";
              await this.sessions.recordProposal(
                mapped.edit.id,
                mapped.edit.proposal
              );
            }
            yield mapped;
          }
          await this.sessions.recordAssistantMessage(visibleText);
          yield { type: "completed" };
          return;
        }
        if (event.type === "failed") {
          yield { type: "failed", failure: event.failure };
          return;
        }
        if (activeTurn.cancelReason === "timeout") {
          yield {
            type: "failed",
            failure: {
              code: "timeout",
              message: "No response after 60 seconds. The agent runtime may be busy."
            }
          };
        } else {
          yield { type: "cancelled" };
        }
        return;
      }
    } catch (error) {
      const failure = {
        code: "protocol-invalid",
        message: "Forge could not interpret the agent response.",
        diagnostic: error instanceof Error ? error.message : String(error)
      };
      yield { type: "failed", failure };
    } finally {
      clearTimeout(timeout);
      if (this.activeTurn === activeTurn) this.activeTurn = null;
    }
  }
  async applyProposal(proposalId) {
    const pending = this.pendingProposals.get(proposalId);
    if (!pending) {
      return {
        ok: false,
        reason: "stale",
        message: "This proposal is no longer active. Regenerate the edit."
      };
    }
    const result = await this.mutations.apply(
      pending.proposal,
      pending.allowedFiles
    );
    this.pendingProposals.delete(proposalId);
    await this.sessions.updateProposalState(
      proposalId,
      result.ok ? "applied" : "stale"
    );
    return result;
  }
  async rejectProposal(proposalId) {
    this.pendingProposals.delete(proposalId);
    await this.sessions.updateProposalState(proposalId, "rejected");
  }
  cancel() {
    if (!this.activeTurn) return;
    this.activeTurn.cancelReason = "user";
    this.activeTurn.controller.abort();
  }
  dispose() {
    if (!this.activeTurn) return;
    this.activeTurn.cancelReason = "dispose";
    this.activeTurn.controller.abort();
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
        if (!context.allowedMutationFiles.includes(event.proposal.file)) {
          throw new Error(
            `Edit target is outside the approved context: ${event.proposal.file}`
          );
        }
        const edit = {
          id: crypto.randomUUID(),
          proposal: event.proposal
        };
        this.pendingProposals.set(edit.id, {
          proposal: edit.proposal,
          allowedFiles: context.allowedMutationFiles
        });
        yield {
          type: "mutation-proposed",
          edit
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
        const source = (_d = (_c = (_a = context.resolved.selection) == null ? void 0 : _a.file) != null ? _c : (_b = context.resolved.activeNote) == null ? void 0 : _b.path) != null ? _d : "learning-session";
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
      throw new Error(event.message);
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
  async apply(proposal, allowedFiles) {
    if (!allowedFiles.includes(proposal.file)) {
      return {
        ok: false,
        reason: "unauthorized",
        message: "This edit targets a note outside the approved turn context."
      };
    }
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
    try {
      this.models = await this.adapter.listModels();
    } catch (e) {
      this.models = [];
    }
  }
  checkRuntime() {
    return this.adapter.check();
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
    const normalized = modelId || void 0;
    this.store.setDefaultModel(normalized);
    if (this.currentSession) {
      this.currentSession.model = normalized;
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
  async *sendTurn(prompt, context, displayPrompt, signal) {
    const session = this.getSession();
    const input = { prompt, context };
    session.messages.push({
      role: "user",
      content: displayPrompt
    });
    this.store.updateSession(session);
    await this.save();
    for await (const event of this.adapter.send(input, {
      model: session.model,
      conversationId: session.conversationId
    }, signal)) {
      if (event.type === "completed" && event.conversationId) {
        session.conversationId = event.conversationId;
      }
      yield event;
    }
    this.store.updateSession(session);
    await this.save();
  }
  async recordAssistantMessage(content) {
    if (!content.trim()) return;
    const session = this.getSession();
    session.messages.push({ role: "assistant", content });
    this.store.updateSession(session);
    await this.save();
  }
  async recordProposal(proposalId, proposal) {
    const session = this.getSession();
    session.messages.push({
      role: "assistant",
      content: "",
      proposalId,
      proposal,
      proposalState: "pending"
    });
    this.store.updateSession(session);
    await this.save();
  }
  async updateProposalState(proposalId, state) {
    const message = this.getSession().messages.find(
      (item) => item.proposalId === proposalId
    );
    if (!message) return;
    message.proposalState = state;
    this.store.updateSession(this.getSession());
    await this.save();
  }
  async save() {
    var _a;
    const current = (_a = await this.plugin.loadData()) != null ? _a : {};
    await this.plugin.saveData({ ...current, ...this.store.serialize() });
  }
};

// src/session/SessionStore.ts
var STORE_KEY = "forge-sessions";
var LEGACY_STORE_KEY = "agy-sessions";
var SessionStore = class {
  constructor() {
    this.data = {
      currentSessionId: null,
      sessions: {}
    };
  }
  /** Call once on plugin load. */
  async load(rawData) {
    var _a;
    const stored = (_a = rawData == null ? void 0 : rawData[STORE_KEY]) != null ? _a : rawData == null ? void 0 : rawData[LEGACY_STORE_KEY];
    if (!stored || typeof stored !== "object") return;
    const candidate = stored;
    const sessions = {};
    if (candidate.sessions && typeof candidate.sessions === "object") {
      for (const [id, value] of Object.entries(candidate.sessions)) {
        const session = this.decodeSession(value);
        if (session) sessions[id] = session;
      }
    }
    this.data = {
      currentSessionId: typeof candidate.currentSessionId === "string" ? candidate.currentSessionId : null,
      sessions,
      defaultModel: typeof candidate.defaultModel === "string" ? candidate.defaultModel : void 0
    };
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
    return this.data.defaultModel;
  }
  setDefaultModel(model) {
    this.data.defaultModel = model || void 0;
  }
  // ── Utility ──────────────────────────────────────────────────────────────
  /** All sessions, newest first. */
  listSessions() {
    return Object.values(this.data.sessions).sort(
      (a, b) => b.updatedAt - a.updatedAt
    );
  }
  decodeSession(value) {
    if (!value || typeof value !== "object") return null;
    const session = value;
    if (typeof session.id !== "string" || !Array.isArray(session.messages) || typeof session.createdAt !== "number" || typeof session.updatedAt !== "number") {
      return null;
    }
    return {
      id: session.id,
      conversationId: typeof session.conversationId === "string" ? session.conversationId : void 0,
      model: typeof session.model === "string" ? session.model : void 0,
      messages: session.messages.filter((message) => {
        if (!message || typeof message !== "object") return false;
        const candidate = message;
        return (candidate.role === "user" || candidate.role === "assistant") && typeof candidate.content === "string";
      }).map((message) => ({
        ...message,
        proposalState: message.proposalState === "pending" ? "stale" : message.proposalState
      })),
      createdAt: session.createdAt,
      updatedAt: session.updatedAt
    };
  }
};

// src/settings/ForgeSettings.ts
var FORGE_SETTINGS_KEY = "forge-settings";
var DEFAULT_FORGE_SETTINGS = {
  executablePath: "",
  preferredModel: ""
};
function decodeForgeSettings(rawData) {
  const value = rawData == null ? void 0 : rawData[FORGE_SETTINGS_KEY];
  if (!value || typeof value !== "object") return { ...DEFAULT_FORGE_SETTINGS };
  const candidate = value;
  return {
    executablePath: typeof candidate.executablePath === "string" ? candidate.executablePath : "",
    preferredModel: typeof candidate.preferredModel === "string" ? candidate.preferredModel : ""
  };
}
async function saveForgeSettings(plugin, settings) {
  var _a;
  const current = (_a = await plugin.loadData()) != null ? _a : {};
  await plugin.saveData({
    ...current,
    [FORGE_SETTINGS_KEY]: settings
  });
}

// src/settings/SettingsTab.ts
var import_obsidian6 = require("obsidian");
var ForgeSettingsTab = class extends import_obsidian6.PluginSettingTab {
  constructor(app, forge) {
    super(app, forge);
    this.forge = forge;
  }
  display() {
    const { containerEl } = this;
    const settings = this.forge.getSettings();
    containerEl.empty();
    containerEl.createEl("h2", { text: "Forge" });
    new import_obsidian6.Setting(containerEl).setName("Agent executable").setDesc("Optional absolute path to the configured agent runtime.").addText(
      (text) => text.setPlaceholder("Use PATH discovery").setValue(settings.executablePath).onChange(async (value) => {
        await this.forge.updateSettings({ executablePath: value.trim() });
      })
    );
    new import_obsidian6.Setting(containerEl).setName("Preferred model").setDesc("Leave blank to use the runtime default model.").addText(
      (text) => text.setPlaceholder("Runtime default").setValue(settings.preferredModel).onChange(async (value) => {
        await this.forge.updateSettings({ preferredModel: value.trim() });
      })
    );
  }
};

// src/main.ts
var ForgePlugin = class extends import_obsidian7.Plugin {
  async onload() {
    const vaultAdapter = this.app.vault.adapter;
    const vaultPath = vaultAdapter instanceof import_obsidian7.FileSystemAdapter ? vaultAdapter.getBasePath() : void 0;
    this.forgeSettings = decodeForgeSettings(await this.loadData());
    const adapter = new AgyAdapter(vaultPath, () => ({
      executablePath: this.forgeSettings.executablePath
    }));
    const sessionStore = new SessionStore();
    const sessions = new SessionController(
      this,
      sessionStore,
      adapter
    );
    await sessions.init();
    if (!sessions.getSession().model && this.forgeSettings.preferredModel) {
      sessions.setModel(this.forgeSettings.preferredModel);
    }
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
    const logoUrl = this.getLogoUrl().replace(/&/g, "&amp;");
    (0, import_obsidian7.addIcon)(
      "forge-logo",
      `<image href="${logoUrl}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" />`
    );
    this.registerView(
      FORGE_VIEW_TYPE,
      (leaf) => new ChatView(
        leaf,
        this.learning,
        () => this.openSettings(),
        () => this.getLogoUrl()
      )
    );
    this.addSettingTab(new ForgeSettingsTab(this.app, this));
    this.addRibbonIcon(
      "forge-logo",
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
          var _a;
          const leaves = this.app.workspace.getLeavesOfType(FORGE_VIEW_TYPE);
          const view = (_a = leaves[0]) == null ? void 0 : _a.view;
          view == null ? void 0 : view.focusComposer();
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
  getSettings() {
    return { ...this.forgeSettings };
  }
  getLogoUrl() {
    const pluginPath = `${this.manifest.dir}/forge.png`;
    return this.app.vault.adapter.getResourcePath(pluginPath);
  }
  async updateSettings(update) {
    this.forgeSettings = { ...this.forgeSettings, ...update };
    await saveForgeSettings(this, this.forgeSettings);
    if (update.preferredModel !== void 0) {
      this.learning.setModel(update.preferredModel || void 0);
    }
  }
  openSettings() {
    const app = this.app;
    app.setting.open();
    app.setting.openTabById(this.manifest.id);
  }
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2FnZW50L0FneUFkYXB0ZXIudHMiLCAic3JjL2NoYXQvQ2hhdFZpZXcudHMiLCAic3JjL2NvbnRleHQvQ29udGV4dFJlc29sdmVyLnRzIiwgInNyYy9jb250ZXh0L09ic2lkaWFuQ29udGV4dC50cyIsICJzcmMvY29udGV4dC9Qb2xpY3lMb2FkZXIudHMiLCAic3JjL2xlYXJuaW5nL2FjdGlvbi1idWlsZGVycy50cyIsICJzcmMvbGVhcm5pbmcvU3RydWN0dXJlZFN0cmVhbVBhcnNlci50cyIsICJzcmMvbGVhcm5pbmcvTGVhcm5pbmdDb250cm9sbGVyLnRzIiwgInNyYy9tdXRhdGlvbi9NdXRhdGlvblNlcnZpY2UudHMiLCAic3JjL3BlcnNpc3RlbmNlL1ZhdWx0TGVhcm5pbmdTdG9yZS50cyIsICJzcmMvbGVhcm5pbmcvbGVhcm5pbmctc3RhdGUudHMiLCAic3JjL3Nlc3Npb24vU2Vzc2lvbkNvbnRyb2xsZXIudHMiLCAic3JjL3Nlc3Npb24vU2Vzc2lvblN0b3JlLnRzIiwgInNyYy9zZXR0aW5ncy9Gb3JnZVNldHRpbmdzLnRzIiwgInNyYy9zZXR0aW5ncy9TZXR0aW5nc1RhYi50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgYWRkSWNvbiwgRmlsZVN5c3RlbUFkYXB0ZXIsIFBsdWdpbiB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHsgQWd5QWRhcHRlciB9IGZyb20gXCIuL2FnZW50L0FneUFkYXB0ZXJcIjtcclxuaW1wb3J0IHsgQ2hhdFZpZXcsIEZPUkdFX1ZJRVdfVFlQRSB9IGZyb20gXCIuL2NoYXQvQ2hhdFZpZXdcIjtcbmltcG9ydCB7IENvbnRleHRSZXNvbHZlciB9IGZyb20gXCIuL2NvbnRleHQvQ29udGV4dFJlc29sdmVyXCI7XHJcbmltcG9ydCB7IE9ic2lkaWFuQ29udGV4dCB9IGZyb20gXCIuL2NvbnRleHQvT2JzaWRpYW5Db250ZXh0XCI7XHJcbmltcG9ydCB7IFBvbGljeUxvYWRlciB9IGZyb20gXCIuL2NvbnRleHQvUG9saWN5TG9hZGVyXCI7XHJcbmltcG9ydCB7IExlYXJuaW5nQ29udHJvbGxlciB9IGZyb20gXCIuL2xlYXJuaW5nL0xlYXJuaW5nQ29udHJvbGxlclwiO1xyXG5pbXBvcnQgeyBNdXRhdGlvblNlcnZpY2UgfSBmcm9tIFwiLi9tdXRhdGlvbi9NdXRhdGlvblNlcnZpY2VcIjtcclxuaW1wb3J0IHsgVmF1bHRMZWFybmluZ1N0b3JlIH0gZnJvbSBcIi4vcGVyc2lzdGVuY2UvVmF1bHRMZWFybmluZ1N0b3JlXCI7XHJcbmltcG9ydCB7IFNlc3Npb25Db250cm9sbGVyIH0gZnJvbSBcIi4vc2Vzc2lvbi9TZXNzaW9uQ29udHJvbGxlclwiO1xyXG5pbXBvcnQgeyBTZXNzaW9uU3RvcmUgfSBmcm9tIFwiLi9zZXNzaW9uL1Nlc3Npb25TdG9yZVwiO1xuaW1wb3J0IHtcbiAgZGVjb2RlRm9yZ2VTZXR0aW5ncyxcbiAgRm9yZ2VTZXR0aW5ncyxcbiAgc2F2ZUZvcmdlU2V0dGluZ3MsXG59IGZyb20gXCIuL3NldHRpbmdzL0ZvcmdlU2V0dGluZ3NcIjtcbmltcG9ydCB7IEZvcmdlU2V0dGluZ3NUYWIgfSBmcm9tIFwiLi9zZXR0aW5ncy9TZXR0aW5nc1RhYlwiO1xuXHJcbi8qKlxyXG4gKiBDb21wb3NpdGlvbiByb290LlxyXG4gKlxyXG4gKiBCdXNpbmVzcyBiZWhhdmlvciBiZWxvbmdzIGluIExlYXJuaW5nQ29udHJvbGxlci9zZXJ2aWNlczsgdGhpcyBmaWxlIG9ubHlcclxuICogY29uc3RydWN0cyBkZXBlbmRlbmNpZXMsIHJlZ2lzdGVycyBPYnNpZGlhbiBzdXJmYWNlcywgYW5kIGRpc3Bvc2VzIHJ1bnRpbWVcclxuICogcmVzb3VyY2VzLlxyXG4gKi9cclxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRm9yZ2VQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBwcml2YXRlIGxlYXJuaW5nITogTGVhcm5pbmdDb250cm9sbGVyO1xuICBwcml2YXRlIGZvcmdlU2V0dGluZ3MhOiBGb3JnZVNldHRpbmdzO1xuXHJcbiAgYXN5bmMgb25sb2FkKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgdmF1bHRBZGFwdGVyID0gdGhpcy5hcHAudmF1bHQuYWRhcHRlcjtcclxuICAgIGNvbnN0IHZhdWx0UGF0aCA9XHJcbiAgICAgIHZhdWx0QWRhcHRlciBpbnN0YW5jZW9mIEZpbGVTeXN0ZW1BZGFwdGVyXHJcbiAgICAgICAgPyB2YXVsdEFkYXB0ZXIuZ2V0QmFzZVBhdGgoKVxyXG4gICAgICAgIDogdW5kZWZpbmVkO1xyXG5cclxuICAgIHRoaXMuZm9yZ2VTZXR0aW5ncyA9IGRlY29kZUZvcmdlU2V0dGluZ3MoYXdhaXQgdGhpcy5sb2FkRGF0YSgpKTtcbiAgICBjb25zdCBhZGFwdGVyID0gbmV3IEFneUFkYXB0ZXIodmF1bHRQYXRoLCAoKSA9PiAoe1xuICAgICAgZXhlY3V0YWJsZVBhdGg6IHRoaXMuZm9yZ2VTZXR0aW5ncy5leGVjdXRhYmxlUGF0aCxcbiAgICB9KSk7XG4gICAgY29uc3Qgc2Vzc2lvblN0b3JlID0gbmV3IFNlc3Npb25TdG9yZSgpO1xyXG4gICAgY29uc3Qgc2Vzc2lvbnMgPSBuZXcgU2Vzc2lvbkNvbnRyb2xsZXIoXHJcbiAgICAgIHRoaXMsXHJcbiAgICAgIHNlc3Npb25TdG9yZSxcclxuICAgICAgYWRhcHRlcixcclxuICAgICk7XHJcblxyXG4gICAgYXdhaXQgc2Vzc2lvbnMuaW5pdCgpO1xuICAgIGlmICghc2Vzc2lvbnMuZ2V0U2Vzc2lvbigpLm1vZGVsICYmIHRoaXMuZm9yZ2VTZXR0aW5ncy5wcmVmZXJyZWRNb2RlbCkge1xuICAgICAgc2Vzc2lvbnMuc2V0TW9kZWwodGhpcy5mb3JnZVNldHRpbmdzLnByZWZlcnJlZE1vZGVsKTtcbiAgICB9XG5cclxuICAgIGNvbnN0IG9ic2lkaWFuQ29udGV4dCA9IG5ldyBPYnNpZGlhbkNvbnRleHQodGhpcy5hcHApO1xyXG4gICAgY29uc3QgY29udGV4dHMgPSBuZXcgQ29udGV4dFJlc29sdmVyKG9ic2lkaWFuQ29udGV4dCk7XHJcbiAgICBjb25zdCBwb2xpY2llcyA9IG5ldyBQb2xpY3lMb2FkZXIodGhpcy5hcHApO1xyXG4gICAgY29uc3QgbXV0YXRpb25zID0gbmV3IE11dGF0aW9uU2VydmljZSh0aGlzLmFwcCk7XHJcbiAgICBjb25zdCBsZWFybmluZ1N0YXRlID0gbmV3IFZhdWx0TGVhcm5pbmdTdG9yZSh0aGlzLmFwcCk7XHJcblxyXG4gICAgdGhpcy5sZWFybmluZyA9IG5ldyBMZWFybmluZ0NvbnRyb2xsZXIoXG4gICAgICBzZXNzaW9ucyxcclxuICAgICAgY29udGV4dHMsXHJcbiAgICAgIHBvbGljaWVzLFxyXG4gICAgICBtdXRhdGlvbnMsXHJcbiAgICAgIGxlYXJuaW5nU3RhdGUsXG4gICAgKTtcblxuICAgIGNvbnN0IGxvZ29VcmwgPSB0aGlzLmdldExvZ29VcmwoKS5yZXBsYWNlKC8mL2csIFwiJmFtcDtcIik7XG4gICAgYWRkSWNvbihcbiAgICAgIFwiZm9yZ2UtbG9nb1wiLFxuICAgICAgYDxpbWFnZSBocmVmPVwiJHtsb2dvVXJsfVwiIHg9XCIwXCIgeT1cIjBcIiB3aWR0aD1cIjEwMCVcIiBoZWlnaHQ9XCIxMDAlXCIgcHJlc2VydmVBc3BlY3RSYXRpbz1cInhNaWRZTWlkIHNsaWNlXCIgLz5gLFxuICAgICk7XG5cclxuICAgIHRoaXMucmVnaXN0ZXJWaWV3KFxyXG4gICAgICBGT1JHRV9WSUVXX1RZUEUsXG4gICAgICAobGVhZikgPT4gbmV3IENoYXRWaWV3KFxuICAgICAgICBsZWFmLFxuICAgICAgICB0aGlzLmxlYXJuaW5nLFxuICAgICAgICAoKSA9PiB0aGlzLm9wZW5TZXR0aW5ncygpLFxuICAgICAgICAoKSA9PiB0aGlzLmdldExvZ29VcmwoKSxcbiAgICAgICksXG4gICAgKTtcblxuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgRm9yZ2VTZXR0aW5nc1RhYih0aGlzLmFwcCwgdGhpcykpO1xuXHJcbiAgICB0aGlzLmFkZFJpYmJvbkljb24oXG4gICAgICBcImZvcmdlLWxvZ29cIixcbiAgICAgIFwiT3BlbiBGb3JnZVwiLFxuICAgICAgKCkgPT4gdGhpcy5hY3RpdmF0ZVZpZXcoKSxcbiAgICApO1xyXG5cclxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XHJcbiAgICAgIGlkOiBcIm9wZW4tZm9yZ2Utc2lkZWJhclwiLFxuICAgICAgbmFtZTogXCJPcGVuIEZvcmdlIHNpZGViYXJcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLmFjdGl2YXRlVmlldygpLFxyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcclxuICAgICAgaWQ6IFwiZm9jdXMtZm9yZ2UtY29tcG9zZXJcIixcbiAgICAgIG5hbWU6IFwiRm9jdXMgRm9yZ2UgY29tcG9zZXJcIixcbiAgICAgIGhvdGtleXM6IFt7IG1vZGlmaWVyczogW1wiTW9kXCJdLCBrZXk6IFwibFwiIH1dLFxyXG4gICAgICBjYWxsYmFjazogYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIGF3YWl0IHRoaXMuYWN0aXZhdGVWaWV3KCk7XHJcblxyXG4gICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgY29uc3QgbGVhdmVzID0gdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShGT1JHRV9WSUVXX1RZUEUpO1xuICAgICAgICAgIGNvbnN0IHZpZXcgPSBsZWF2ZXNbMF0/LnZpZXcgYXMgQ2hhdFZpZXcgfCB1bmRlZmluZWQ7XHJcbiAgICAgICAgICB2aWV3Py5mb2N1c0NvbXBvc2VyKCk7XG4gICAgICAgIH0sIDEwMCk7XHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIGFzeW5jIG9udW5sb2FkKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdGhpcy5hcHAud29ya3NwYWNlLmRldGFjaExlYXZlc09mVHlwZShGT1JHRV9WSUVXX1RZUEUpO1xuICAgIHRoaXMubGVhcm5pbmc/LmRpc3Bvc2UoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgYWN0aXZhdGVWaWV3KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHsgd29ya3NwYWNlIH0gPSB0aGlzLmFwcDtcclxuICAgIGNvbnN0IGV4aXN0aW5nID0gd29ya3NwYWNlLmdldExlYXZlc09mVHlwZShGT1JHRV9WSUVXX1RZUEUpO1xuXHJcbiAgICBpZiAoZXhpc3RpbmcubGVuZ3RoID4gMCkge1xyXG4gICAgICB3b3Jrc3BhY2UucmV2ZWFsTGVhZihleGlzdGluZ1swXSk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBsZWFmID0gd29ya3NwYWNlLmdldFJpZ2h0TGVhZihmYWxzZSk7XHJcbiAgICBpZiAoIWxlYWYpIHJldHVybjtcclxuXHJcbiAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7XHJcbiAgICAgIHR5cGU6IEZPUkdFX1ZJRVdfVFlQRSxcbiAgICAgIGFjdGl2ZTogdHJ1ZSxcclxuICAgIH0pO1xyXG4gICAgd29ya3NwYWNlLnJldmVhbExlYWYobGVhZik7XHJcbiAgfVxuXG4gIGdldFNldHRpbmdzKCk6IEZvcmdlU2V0dGluZ3Mge1xuICAgIHJldHVybiB7IC4uLnRoaXMuZm9yZ2VTZXR0aW5ncyB9O1xuICB9XG5cbiAgZ2V0TG9nb1VybCgpOiBzdHJpbmcge1xuICAgIGNvbnN0IHBsdWdpblBhdGggPSBgJHt0aGlzLm1hbmlmZXN0LmRpcn0vZm9yZ2UucG5nYDtcbiAgICByZXR1cm4gdGhpcy5hcHAudmF1bHQuYWRhcHRlci5nZXRSZXNvdXJjZVBhdGgocGx1Z2luUGF0aCk7XG4gIH1cblxuICBhc3luYyB1cGRhdGVTZXR0aW5ncyh1cGRhdGU6IFBhcnRpYWw8Rm9yZ2VTZXR0aW5ncz4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmZvcmdlU2V0dGluZ3MgPSB7IC4uLnRoaXMuZm9yZ2VTZXR0aW5ncywgLi4udXBkYXRlIH07XG4gICAgYXdhaXQgc2F2ZUZvcmdlU2V0dGluZ3ModGhpcywgdGhpcy5mb3JnZVNldHRpbmdzKTtcbiAgICBpZiAodXBkYXRlLnByZWZlcnJlZE1vZGVsICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMubGVhcm5pbmcuc2V0TW9kZWwodXBkYXRlLnByZWZlcnJlZE1vZGVsIHx8IHVuZGVmaW5lZCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBvcGVuU2V0dGluZ3MoKTogdm9pZCB7XG4gICAgY29uc3QgYXBwID0gdGhpcy5hcHAgYXMgdHlwZW9mIHRoaXMuYXBwICYge1xuICAgICAgc2V0dGluZzoge1xuICAgICAgICBvcGVuKCk6IHZvaWQ7XG4gICAgICAgIG9wZW5UYWJCeUlkKGlkOiBzdHJpbmcpOiB2b2lkO1xuICAgICAgfTtcbiAgICB9O1xuICAgIGFwcC5zZXR0aW5nLm9wZW4oKTtcbiAgICBhcHAuc2V0dGluZy5vcGVuVGFiQnlJZCh0aGlzLm1hbmlmZXN0LmlkKTtcbiAgfVxufVxuIiwgImltcG9ydCB7IENoaWxkUHJvY2Vzcywgc3Bhd24gfSBmcm9tIFwiY2hpbGRfcHJvY2Vzc1wiO1xyXG5pbXBvcnQgeyBleGlzdHNTeW5jIH0gZnJvbSBcImZzXCI7XHJcbmltcG9ydCB7IGhvbWVkaXIgfSBmcm9tIFwib3NcIjtcclxuaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XHJcbmltcG9ydCB7XHJcbiAgQWdlbnRBZGFwdGVyLFxyXG4gIEFnZW50SW5wdXQsXHJcbiAgQWdlbnRDb250ZXh0LFxyXG4gIEFnZW50U3RyZWFtRXZlbnQsXG4gIEFnZW50TW9kZWwsXG4gIEFnZW50RmFpbHVyZSxcbiAgQWdlbnRIZWFsdGgsXG4gIEFnZW50UnVudGltZUNvbmZpZyxcbiAgU2VuZE9wdGlvbnMsXHJcbn0gZnJvbSBcIi4uL3R5cGVzXCI7XHJcblxyXG5mdW5jdGlvbiBlc2NhcGVBdHRyaWJ1dGUodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgcmV0dXJuIHZhbHVlXHJcbiAgICAucmVwbGFjZSgvJi9nLCBcIiZhbXA7XCIpXHJcbiAgICAucmVwbGFjZSgvXCIvZywgXCImcXVvdDtcIilcclxuICAgIC5yZXBsYWNlKC88L2csIFwiJmx0O1wiKVxyXG4gICAgLnJlcGxhY2UoLz4vZywgXCImZ3Q7XCIpO1xyXG59XHJcblxyXG4vLyBBR1kgcHJpbnQtbW9kZSBwcm90b2NvbCB1c2VkIGJ5IHRoaXMgYWRhcHRlcjpcclxuLy9cclxuLy8gICBhZ3kgLS1wcmludCA8cHJvbXB0PiAtLW91dHB1dC1mb3JtYXQgc3RyZWFtLWpzb24gWy0tbW9kZWwgPGlkPl1cclxuLy8gICAgICAgWy0tY29udmVyc2F0aW9uIDxpZD5dXHJcbi8vXHJcbi8vIHN0ZG91dCBpcyBOREpTT046XHJcbi8vICAge1wiZXZlbnRcIjpcImluaXRcIiwgLi4ufVxyXG4vLyAgIHtcImV2ZW50XCI6XCJzdGVwX3VwZGF0ZVwiLFwic3RlcF91cGRhdGVcIjp7XCJzdGVwX3R5cGVcIjpcImFnZW50X3Jlc3BvbnNlXCIsXCJ0ZXh0X2RlbHRhXCI6XCIuLi5cIn19XHJcbi8vICAge1wiZXZlbnRcIjpcInJlc3VsdFwiLFwicmVzdWx0XCI6e1wic3RhdHVzXCI6XCJTVUNDRVNTfEVSUk9SfC4uLlwiLFwicmVzcG9uc2VcIjpcIi4uLlwiLFwiZXJyb3JcIjpcIi4uLlwifX1cclxuLy9cclxuLy8gRWFjaCBzZW5kKCkgc3RhcnRzIG9uZSBwcmludC1tb2RlIHByb2Nlc3MuIENvbnZlcnNhdGlvbiBjb250aW51aXR5IGlzIHJlc3RvcmVkXHJcbi8vIHdpdGggLS1jb252ZXJzYXRpb24gPGlkPi4gVGhlIFVJIG9ubHkgc2VlcyBub3JtYWxpemVkIEFnZW50U3RyZWFtRXZlbnQgdmFsdWVzLlxuXHJcbmV4cG9ydCBjbGFzcyBBZ3lBZGFwdGVyIGltcGxlbWVudHMgQWdlbnRBZGFwdGVyIHtcbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBjd2Q/OiBzdHJpbmcsXG4gICAgcHJpdmF0ZSByZWFkb25seSBnZXRDb25maWc6ICgpID0+IEFnZW50UnVudGltZUNvbmZpZyA9ICgpID0+ICh7fSksXG4gICkge31cblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBiaW5hcnkgcmVzb2x1dGlvbiBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbiAgYXN5bmMgY2hlY2soKTogUHJvbWlzZTxBZ2VudEhlYWx0aD4ge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnJlc29sdmVCaW5hcnkoKTtcbiAgICAgIHJldHVybiB7IHN0YXR1czogXCJyZWFkeVwiIH07XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSB0aGlzLmdldENvbmZpZygpLmV4ZWN1dGFibGVQYXRoPy50cmltKCk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXM6IGNvbmZpZ3VyZWQgPyBcIm1pc2NvbmZpZ3VyZWRcIiA6IFwidW5hdmFpbGFibGVcIixcbiAgICAgICAgZmFpbHVyZTogdGhpcy5mYWlsdXJlRnJvbShlcnJvciwgXCJydW50aW1lLXVuYXZhaWxhYmxlXCIpLFxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlc29sdmVCaW5hcnkoKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBjb25zdCBjb25maWd1cmVkID1cbiAgICAgIHRoaXMuZ2V0Q29uZmlnKCkuZXhlY3V0YWJsZVBhdGg/LnRyaW0oKSB8fFxuICAgICAgcHJvY2Vzcy5lbnYuQUdZX1BBVEg/LnRyaW0oKTtcbiAgICBpZiAoY29uZmlndXJlZCAmJiAhZXhpc3RzU3luYyhjb25maWd1cmVkKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb25maWd1cmVkIGFnZW50IGV4ZWN1dGFibGUgZG9lcyBub3QgZXhpc3Q6ICR7Y29uZmlndXJlZH1gKTtcbiAgICB9XG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IFtcclxuICAgICAgY29uZmlndXJlZCxcclxuICAgICAgLi4uKHByb2Nlc3MucGxhdGZvcm0gPT09IFwid2luMzJcIlxyXG4gICAgICAgID8gW1xyXG4gICAgICAgICAgICBwcm9jZXNzLmVudi5MT0NBTEFQUERBVEFcclxuICAgICAgICAgICAgICA/IGpvaW4ocHJvY2Vzcy5lbnYuTE9DQUxBUFBEQVRBLCBcImFneVwiLCBcImJpblwiLCBcImFneS5leGVcIilcclxuICAgICAgICAgICAgICA6IHVuZGVmaW5lZCxcclxuICAgICAgICAgICAgcHJvY2Vzcy5lbnYuUHJvZ3JhbUZpbGVzXHJcbiAgICAgICAgICAgICAgPyBqb2luKHByb2Nlc3MuZW52LlByb2dyYW1GaWxlcywgXCJHb29nbGVcIiwgXCJhbnRpZ3Jhdml0eS1jbGlcIiwgXCJhZ3kuZXhlXCIpXHJcbiAgICAgICAgICAgICAgOiB1bmRlZmluZWQsXHJcbiAgICAgICAgICBdXHJcbiAgICAgICAgOiBbam9pbihob21lZGlyKCksIFwiLmxvY2FsXCIsIFwiYmluXCIsIFwiYWd5XCIpXSksXHJcbiAgICBdLmZpbHRlcigodmFsdWUpOiB2YWx1ZSBpcyBzdHJpbmcgPT4gQm9vbGVhbih2YWx1ZSkpO1xyXG5cclxuICAgIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIGNhbmRpZGF0ZXMpIHtcclxuICAgICAgaWYgKGV4aXN0c1N5bmMoY2FuZGlkYXRlKSkgcmV0dXJuIGNhbmRpZGF0ZTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICBjb25zdCBsb2NhdG9yID0gcHJvY2Vzcy5wbGF0Zm9ybSA9PT0gXCJ3aW4zMlwiID8gXCJ3aGVyZVwiIDogXCJ3aGljaFwiO1xyXG4gICAgICBjb25zdCBwID0gc3Bhd24obG9jYXRvciwgW1wiYWd5XCJdKTtcclxuICAgICAgbGV0IG91dCA9IFwiXCI7XHJcbiAgICAgIGxldCBzZXR0bGVkID0gZmFsc2U7XHJcblxyXG4gICAgICBjb25zdCBmYWlsID0gKCkgPT4ge1xyXG4gICAgICAgIGlmIChzZXR0bGVkKSByZXR1cm47XHJcbiAgICAgICAgc2V0dGxlZCA9IHRydWU7XHJcbiAgICAgICAgcmVqZWN0KFxyXG4gICAgICAgICAgbmV3IEVycm9yKFxyXG4gICAgICAgICAgICBcIkFHWSBDTEkgbm90IGZvdW5kLiBJbnN0YWxsIGl0LCByZXN0YXJ0IE9ic2lkaWFuIGFmdGVyIGNoYW5naW5nIFBBVEgsIG9yIHNldCBBR1lfUEFUSCB0byB0aGUgQUdZIGV4ZWN1dGFibGUuXCIsXHJcbiAgICAgICAgICApLFxyXG4gICAgICAgICk7XHJcbiAgICAgIH07XHJcblxyXG4gICAgICBwLnN0ZG91dD8ub24oXCJkYXRhXCIsIChkOiBCdWZmZXIpID0+IChvdXQgKz0gZC50b1N0cmluZygpKSk7XHJcbiAgICAgIHAub24oXCJlcnJvclwiLCBmYWlsKTtcclxuICAgICAgcC5vbihcImNsb3NlXCIsIChjb2RlKSA9PiB7XHJcbiAgICAgICAgaWYgKHNldHRsZWQpIHJldHVybjtcclxuICAgICAgICBpZiAoY29kZSA9PT0gMCAmJiBvdXQudHJpbSgpKSB7XHJcbiAgICAgICAgICBzZXR0bGVkID0gdHJ1ZTtcclxuICAgICAgICAgIHJlc29sdmUob3V0LnRyaW0oKS5zcGxpdCgvXFxyP1xcbi8pWzBdKTtcclxuICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgZmFpbCgpO1xyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLy8gXHUyNTAwXHUyNTAwIHNlbmQgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4gIGFzeW5jICpzZW5kKFxuICAgIGlucHV0OiBBZ2VudElucHV0LFxuICAgIG9wdHM6IFNlbmRPcHRpb25zLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICk6IEFzeW5jSXRlcmFibGU8QWdlbnRTdHJlYW1FdmVudD4ge1xuICAgIGlmIChzaWduYWwuYWJvcnRlZCkge1xuICAgICAgeWllbGQgeyB0eXBlOiBcImNhbmNlbGxlZFwiIH07XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbGV0IGJpbjogc3RyaW5nO1xuICAgIHRyeSB7XG4gICAgICBiaW4gPSBhd2FpdCB0aGlzLnJlc29sdmVCaW5hcnkoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgeWllbGQge1xuICAgICAgICB0eXBlOiBcImZhaWxlZFwiLFxuICAgICAgICBmYWlsdXJlOiB0aGlzLmZhaWx1cmVGcm9tKGVycm9yLCBcInJ1bnRpbWUtdW5hdmFpbGFibGVcIiksXG4gICAgICB9O1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBmdWxsUHJvbXB0ID0gdGhpcy5idWlsZEZ1bGxQcm9tcHQoaW5wdXQpO1xyXG4gICAgY29uc3QgYXJncyA9IHRoaXMuYnVpbGRBcmdzKGZ1bGxQcm9tcHQsIG9wdHMpO1xyXG5cclxuICAgIGNvbnN0IHByb2MgPSBzcGF3bihiaW4sIGFyZ3MsIHtcclxuICAgICAgY3dkOiB0aGlzLmN3ZCxcclxuICAgICAgc3RkaW86IFtcImlnbm9yZVwiLCBcInBpcGVcIiwgXCJwaXBlXCJdLFxyXG4gICAgICB3aW5kb3dzSGlkZTogdHJ1ZSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGFib3J0ID0gKCkgPT4ge1xuICAgICAgaWYgKHByb2MuZXhpdENvZGUgPT09IG51bGwgJiYgIXByb2Mua2lsbGVkKSBwcm9jLmtpbGwoXCJTSUdURVJNXCIpO1xuICAgIH07XG4gICAgc2lnbmFsLmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydCwgeyBvbmNlOiB0cnVlIH0pO1xuXG4gICAgdHJ5IHtcbiAgICAgIHlpZWxkKiB0aGlzLnJlYWRFdmVudHMocHJvYywgc2lnbmFsKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgc2lnbmFsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydCk7XG4gICAgICBhYm9ydCgpO1xuICAgIH1cbiAgfVxyXG5cclxuICBwcml2YXRlIGJ1aWxkQXJncyhwcm9tcHQ6IHN0cmluZywgb3B0czogU2VuZE9wdGlvbnMpOiBzdHJpbmdbXSB7XHJcbiAgICBjb25zdCBhcmdzID0gW1xyXG4gICAgICBcIi0tcHJpbnRcIixcclxuICAgICAgcHJvbXB0LFxyXG4gICAgICBcIi0tb3V0cHV0LWZvcm1hdFwiLFxyXG4gICAgICBcInN0cmVhbS1qc29uXCIsXHJcbiAgICBdO1xuXHJcbiAgICBpZiAob3B0cy5tb2RlbCkge1xyXG4gICAgICBhcmdzLnB1c2goXCItLW1vZGVsXCIsIG9wdHMubW9kZWwpO1xyXG4gICAgfVxyXG4gICAgaWYgKG9wdHMuY29udmVyc2F0aW9uSWQpIHtcclxuICAgICAgYXJncy5wdXNoKFwiLS1jb252ZXJzYXRpb25cIiwgb3B0cy5jb252ZXJzYXRpb25JZCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gYXJncztcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEZvcm1hdCBBZ2VudElucHV0IHdpdGggY29udGV4dCBhcyBhIHN0cnVjdHVyZWQgcHJlYW1ibGUgYmVmb3JlIHByb21wdC5cclxuICAgKi9cclxuICBwcml2YXRlIGJ1aWxkRnVsbFByb21wdChpbnB1dDogQWdlbnRJbnB1dCk6IHN0cmluZyB7XHJcbiAgICBjb25zdCBjb250ZXh0UHJlYW1ibGUgPSB0aGlzLmZvcm1hdENvbnRleHQoaW5wdXQuY29udGV4dCk7XHJcbiAgICByZXR1cm4gY29udGV4dFByZWFtYmxlXHJcbiAgICAgID8gYCR7Y29udGV4dFByZWFtYmxlfVxcblxcbi0tLVxcblxcbiR7aW5wdXQucHJvbXB0fWBcclxuICAgICAgOiBpbnB1dC5wcm9tcHQ7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGZvcm1hdENvbnRleHQoY3R4OiBBZ2VudENvbnRleHRbXSk6IHN0cmluZyB7XHJcbiAgICBpZiAoY3R4Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIFwiXCI7XHJcblxyXG4gICAgcmV0dXJuIGN0eFxyXG4gICAgICAubWFwKChjLCBpbmRleCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHR5cGUgPSBjLnR5cGUgPT09IFwic2VsZWN0aW9uXCIgPyBcInNlbGVjdGlvblwiIDogXCJub3RlXCI7XHJcbiAgICAgICAgY29uc3QgaGVhZGVyID0gYDxvYnNpZGlhbi1jb250ZXh0IGluZGV4PVwiJHtpbmRleCArIDF9XCIgdHlwZT1cIiR7dHlwZX1cIiBmaWxlPVwiJHtlc2NhcGVBdHRyaWJ1dGUoYy5maWxlKX1cIj5gO1xyXG5cclxuICAgICAgICByZXR1cm4gYCR7aGVhZGVyfVxcbiR7Yy5jb250ZW50fVxcbjwvb2JzaWRpYW4tY29udGV4dD5gO1xyXG4gICAgICB9KVxyXG4gICAgICAuam9pbihcIlxcblxcblwiKTtcclxuICB9XHJcblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBzdGRvdXQgcmVhZGVyIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuICBwcml2YXRlIGFzeW5jICpyZWFkRXZlbnRzKFxuICAgIHByb2M6IENoaWxkUHJvY2VzcyxcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICApOiBBc3luY0l0ZXJhYmxlPEFnZW50U3RyZWFtRXZlbnQ+IHtcbiAgICBsZXQgYnVmZmVyID0gXCJcIjtcclxuICAgIGxldCBzdGRlcnIgPSBcIlwiO1xyXG4gICAgbGV0IGV4aXRDb2RlOiBudW1iZXIgfCBudWxsID0gbnVsbDtcclxuICAgIGNvbnN0IHByb2Nlc3NTdGF0ZTogeyBzcGF3bkVycm9yPzogRXJyb3IgfSA9IHt9O1xyXG4gICAgbGV0IGNsb3NlZCA9IGZhbHNlO1xyXG4gICAgbGV0IHNhd1Rlcm1pbmFsRXZlbnQgPSBmYWxzZTtcbiAgICBsZXQgY29udmVyc2F0aW9uSWQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcblxyXG4gICAgY29uc3QgcXVldWU6IHN0cmluZ1tdID0gW107XHJcbiAgICBsZXQgbm90aWZ5OiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcclxuXHJcbiAgICBjb25zdCB3YWtlID0gKCkgPT4ge1xyXG4gICAgICBub3RpZnk/LigpO1xyXG4gICAgICBub3RpZnkgPSBudWxsO1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBwdXNoID0gKGxpbmU6IHN0cmluZykgPT4ge1xyXG4gICAgICBxdWV1ZS5wdXNoKGxpbmUpO1xyXG4gICAgICB3YWtlKCk7XHJcbiAgICB9O1xyXG5cclxuICAgIHByb2Muc3Rkb3V0Py5vbihcImRhdGFcIiwgKGNodW5rOiBCdWZmZXIpID0+IHtcclxuICAgICAgYnVmZmVyICs9IGNodW5rLnRvU3RyaW5nKCk7XHJcbiAgICAgIGNvbnN0IHBhcnRzID0gYnVmZmVyLnNwbGl0KC9cXHI/XFxuLyk7XHJcbiAgICAgIGJ1ZmZlciA9IHBhcnRzLnBvcCgpID8/IFwiXCI7XHJcblxyXG4gICAgICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcclxuICAgICAgICBjb25zdCBsaW5lID0gcGFydC50cmltKCk7XHJcbiAgICAgICAgaWYgKGxpbmUpIHB1c2gobGluZSk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIHByb2Muc3RkZXJyPy5vbihcImRhdGFcIiwgKGNodW5rOiBCdWZmZXIpID0+IHtcclxuICAgICAgY29uc3QgbXNnID0gY2h1bmsudG9TdHJpbmcoKTtcclxuICAgICAgc3RkZXJyICs9IG1zZztcclxuICAgICAgY29uc3QgdHJpbW1lZCA9IG1zZy50cmltKCk7XHJcbiAgICAgIGlmICh0cmltbWVkKSBjb25zb2xlLndhcm4oXCJbRm9yZ2UgYWdlbnQgcHJvdmlkZXJdXCIsIHRyaW1tZWQpO1xuICAgIH0pO1xyXG5cclxuICAgIHByb2Mub24oXCJlcnJvclwiLCAoZXJyKSA9PiB7XHJcbiAgICAgIHByb2Nlc3NTdGF0ZS5zcGF3bkVycm9yID0gZXJyO1xyXG4gICAgICB3YWtlKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBwcm9jLm9uKFwiY2xvc2VcIiwgKGNvZGUpID0+IHtcclxuICAgICAgZXhpdENvZGUgPSBjb2RlO1xyXG4gICAgICBjb25zdCBmaW5hbExpbmUgPSBidWZmZXIudHJpbSgpO1xyXG4gICAgICBidWZmZXIgPSBcIlwiO1xyXG4gICAgICBpZiAoZmluYWxMaW5lKSBxdWV1ZS5wdXNoKGZpbmFsTGluZSk7XHJcbiAgICAgIGNsb3NlZCA9IHRydWU7XHJcbiAgICAgIHdha2UoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBpZiAoc2lnbmFsLmFib3J0ZWQpIHtcbiAgICAgICAgeWllbGQgeyB0eXBlOiBcImNhbmNlbGxlZFwiIH07XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBpZiAocXVldWUubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGNvbnN0IGxpbmUgPSBxdWV1ZS5zaGlmdCgpITtcbiAgICAgICAgY29udmVyc2F0aW9uSWQgPSB0aGlzLnJlYWRDb252ZXJzYXRpb25JZChsaW5lKSA/PyBjb252ZXJzYXRpb25JZDtcbiAgICAgICAgY29uc3QgZXZlbnQgPSB0aGlzLnBhcnNlTGluZShsaW5lLCBjb252ZXJzYXRpb25JZCk7XG5cclxuICAgICAgICBpZiAoIWV2ZW50KSBjb250aW51ZTtcclxuXHJcbiAgICAgICAgeWllbGQgZXZlbnQ7XHJcblxyXG4gICAgICAgIGlmIChldmVudC50eXBlID09PSBcImNvbXBsZXRlZFwiIHx8IGV2ZW50LnR5cGUgPT09IFwiZmFpbGVkXCIpIHtcbiAgICAgICAgICBzYXdUZXJtaW5hbEV2ZW50ID0gdHJ1ZTtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChjbG9zZWQpIHtcbiAgICAgICAgaWYgKCFzYXdUZXJtaW5hbEV2ZW50KSB7XG4gICAgICAgICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICAgICAgICB5aWVsZCB7IHR5cGU6IFwiY2FuY2VsbGVkXCIgfTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCBkZXRhaWwgPVxyXG4gICAgICAgICAgICBwcm9jZXNzU3RhdGUuc3Bhd25FcnJvcj8ubWVzc2FnZSB8fFxyXG4gICAgICAgICAgICBzdGRlcnIudHJpbSgpIHx8XHJcbiAgICAgICAgICAgIChleGl0Q29kZSAhPT0gMFxyXG4gICAgICAgICAgICAgID8gYEFHWSBleGl0ZWQgd2l0aCBjb2RlICR7ZXhpdENvZGUgPz8gXCJ1bmtub3duXCJ9IGJlZm9yZSByZXR1cm5pbmcgYSByZXN1bHQuYFxyXG4gICAgICAgICAgICAgIDogXCJBR1kgZXhpdGVkIHdpdGhvdXQgcmV0dXJuaW5nIGEgcmVzdWx0LlwiKTtcclxuXHJcbiAgICAgICAgICB5aWVsZCB7XG4gICAgICAgICAgICB0eXBlOiBcImZhaWxlZFwiLFxuICAgICAgICAgICAgZmFpbHVyZTogdGhpcy5mYWlsdXJlRnJvbShkZXRhaWwsIFwicHJvY2Vzcy1mYWlsZWRcIiksXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxyXG4gICAgICAgIGJyZWFrO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAocHJvY2Vzc1N0YXRlLnNwYXduRXJyb3IpIHtcbiAgICAgICAgeWllbGQge1xuICAgICAgICAgIHR5cGU6IFwiZmFpbGVkXCIsXG4gICAgICAgICAgZmFpbHVyZTogdGhpcy5mYWlsdXJlRnJvbShwcm9jZXNzU3RhdGUuc3Bhd25FcnJvciwgXCJwcm9jZXNzLWZhaWxlZFwiKSxcbiAgICAgICAgfTtcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlKSA9PiB7XHJcbiAgICAgICAgbm90aWZ5ID0gcmVzb2x2ZTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBQYXJzZSBvbmUgQUdZIE5ESlNPTiBsaW5lIGludG8gYSBub3JtYWxpemVkIGV2ZW50LlxyXG4gICAqL1xyXG4gIHByaXZhdGUgcGFyc2VMaW5lKFxuICAgIGxpbmU6IHN0cmluZyxcbiAgICBjb252ZXJzYXRpb25JZD86IHN0cmluZyxcbiAgKTogQWdlbnRTdHJlYW1FdmVudCB8IG51bGwge1xuICAgIGxldCBvYmo6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIG9iaiA9IEpTT04ucGFyc2UobGluZSk7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgLy8gc3Rkb3V0IHNob3VsZCBiZSBtYWNoaW5lLXJlYWRhYmxlIGluIHN0cmVhbS1qc29uIG1vZGUuIElnbm9yZSBhblxyXG4gICAgICAvLyB1bmV4cGVjdGVkIGRpYWdub3N0aWMgbGluZSBoZXJlOyBzdGRlcnIvZXhpdCBoYW5kbGluZyB3aWxsIHN0aWxsXHJcbiAgICAgIC8vIHN1cmZhY2UgYSBmYWlsZWQgcnVuIHRvIHRoZSBVSS5cclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgZXYgPSBvYmpbXCJldmVudFwiXSBhcyBzdHJpbmcgfCB1bmRlZmluZWQ7XHJcblxyXG4gICAgaWYgKGV2ID09PSBcImluaXRcIikge1xyXG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XHJcblxyXG4gICAgaWYgKGV2ID09PSBcInN0ZXBfdXBkYXRlXCIpIHtcclxuICAgICAgY29uc3Qgc3UgPSBvYmpbXCJzdGVwX3VwZGF0ZVwiXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcclxuICAgICAgY29uc3QgZGVsdGEgPSBzdT8uW1widGV4dF9kZWx0YVwiXSBhcyBzdHJpbmcgfCB1bmRlZmluZWQ7XHJcblxyXG4gICAgICBpZiAoZGVsdGEpIHJldHVybiB7IHR5cGU6IFwidGV4dFwiLCBjb250ZW50OiBkZWx0YSB9O1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDb21wYXRpYmlsaXR5IHdpdGggb2xkZXIgbW9ja3MvcHJvdG9jb2wgZXhwZXJpbWVudHMuXHJcbiAgICBpZiAoZXYgPT09IFwidGV4dFwiKSB7XHJcbiAgICAgIGNvbnN0IHRleHQgPSBvYmpbXCJ0ZXh0XCJdIGFzIHN0cmluZyB8IHVuZGVmaW5lZDtcclxuICAgICAgaWYgKHRleHQpIHJldHVybiB7IHR5cGU6IFwidGV4dFwiLCBjb250ZW50OiB0ZXh0IH07XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChldiA9PT0gXCJyZXN1bHRcIikge1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBvYmpbXCJyZXN1bHRcIl0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XHJcbiAgICAgIGNvbnN0IHN0YXR1cyA9IFN0cmluZyhyZXN1bHQ/LltcInN0YXR1c1wiXSA/PyBcIlwiKS50b1VwcGVyQ2FzZSgpO1xyXG4gICAgICBjb25zdCBjb252SWQgPVxuICAgICAgICAocmVzdWx0Py5bXCJjb252ZXJzYXRpb25faWRcIl0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkKSB8fCBjb252ZXJzYXRpb25JZDtcblxyXG4gICAgICAvLyBBR1kgcmVwb3J0cyBwcmludC1tb2RlIGZhaWx1cmVzIGluc2lkZSB0aGUgdGVybWluYWwgcmVzdWx0IGVudmVsb3BlLlxyXG4gICAgICAvLyBUcmVhdCBldmVyeSBleHBsaWNpdCBub24tU1VDQ0VTUyB0ZXJtaW5hbCBzdGF0ZSBhcyBhbiBlcnJvciBpbnN0ZWFkXHJcbiAgICAgIC8vIG9mIHNpbGVudGx5IGNvbnZlcnRpbmcgaXQgdG8gXCJkb25lXCIuXHJcbiAgICAgIGlmIChzdGF0dXMgJiYgc3RhdHVzICE9PSBcIlNVQ0NFU1NcIikge1xyXG4gICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBTdHJpbmcoXHJcbiAgICAgICAgICByZXN1bHQ/LltcImVycm9yXCJdID8/XHJcbiAgICAgICAgICAgIGBBR1kgZmluaXNoZWQgd2l0aCBzdGF0dXMgJHtzdGF0dXN9IHdpdGhvdXQgYW4gZXJyb3IgbWVzc2FnZS5gLFxyXG4gICAgICAgICk7XHJcblxyXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgdHlwZTogXCJmYWlsZWRcIixcbiAgICAgICAgICBmYWlsdXJlOiB0aGlzLmZhaWx1cmVGcm9tKG1lc3NhZ2UsIHRoaXMuY2xhc3NpZnlGYWlsdXJlKG1lc3NhZ2UpKSxcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHsgdHlwZTogXCJjb21wbGV0ZWRcIiwgY29udmVyc2F0aW9uSWQ6IGNvbnZJZCB9O1xuICAgIH1cclxuXHJcbiAgICBpZiAoZXYgPT09IFwiZXJyb3JcIikge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHR5cGU6IFwiZmFpbGVkXCIsXG4gICAgICAgIGZhaWx1cmU6IHRoaXMuZmFpbHVyZUZyb20oXG4gICAgICAgICAgU3RyaW5nKG9ialtcImVycm9yXCJdID8/IFwiVW5rbm93biBhZ2VudCBydW50aW1lIGVycm9yXCIpLFxuICAgICAgICAgIFwicHJvY2Vzcy1mYWlsZWRcIixcbiAgICAgICAgKSxcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBwcml2YXRlIHJlYWRDb252ZXJzYXRpb25JZChsaW5lOiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCB2YWx1ZSA9IEpTT04ucGFyc2UobGluZSkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICBpZiAodmFsdWVbXCJldmVudFwiXSAhPT0gXCJpbml0XCIpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICByZXR1cm4gKFxuICAgICAgICAodmFsdWVbXCJjb252ZXJzYXRpb25faWRcIl0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkKSB8fFxuICAgICAgICAoKHZhbHVlW1wiaW5pdFwiXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZCk/LltcbiAgICAgICAgICBcImNvbnZlcnNhdGlvbl9pZFwiXG4gICAgICAgIF0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkKVxuICAgICAgKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICB9XG5cclxuICAvLyBcdTI1MDBcdTI1MDAgbGlzdE1vZGVscyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbiAgYXN5bmMgbGlzdE1vZGVscygpOiBQcm9taXNlPEFnZW50TW9kZWxbXT4ge1xuICAgIGNvbnN0IGJpbiA9IGF3YWl0IHRoaXMucmVzb2x2ZUJpbmFyeSgpO1xuXHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICBjb25zdCBwID0gc3Bhd24oYmluLCBbXCJtb2RlbHNcIl0sIHtcclxuICAgICAgICBjd2Q6IHRoaXMuY3dkLFxyXG4gICAgICAgIHdpbmRvd3NIaWRlOiB0cnVlLFxyXG4gICAgICB9KTtcclxuICAgICAgbGV0IG91dCA9IFwiXCI7XHJcbiAgICAgIGxldCBlcnIgPSBcIlwiO1xyXG5cclxuICAgICAgcC5zdGRvdXQ/Lm9uKFwiZGF0YVwiLCAoZDogQnVmZmVyKSA9PiAob3V0ICs9IGQudG9TdHJpbmcoKSkpO1xyXG4gICAgICBwLnN0ZGVycj8ub24oXCJkYXRhXCIsIChkOiBCdWZmZXIpID0+IChlcnIgKz0gZC50b1N0cmluZygpKSk7XHJcbiAgICAgIHAub24oXCJlcnJvclwiLCByZWplY3QpO1xyXG4gICAgICBwLm9uKFwiY2xvc2VcIiwgKGNvZGUpID0+IHtcclxuICAgICAgICBpZiAoY29kZSAhPT0gMCkge1xyXG4gICAgICAgICAgcmVqZWN0KFxyXG4gICAgICAgICAgICBuZXcgRXJyb3IoXHJcbiAgICAgICAgICAgICAgZXJyLnRyaW0oKSB8fCBgRmFpbGVkIHRvIGxpc3QgQUdZIG1vZGVscyAoZXhpdCAke2NvZGUgPz8gXCJ1bmtub3duXCJ9KS5gLFxyXG4gICAgICAgICAgICApLFxyXG4gICAgICAgICAgKTtcclxuICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IG1vZGVsczogQWdlbnRNb2RlbFtdID0gb3V0XG4gICAgICAgICAgLnNwbGl0KC9cXHI/XFxuLylcclxuICAgICAgICAgIC5tYXAoKGxpbmUpID0+IGxpbmUudHJpbSgpKVxyXG4gICAgICAgICAgLmZpbHRlcihCb29sZWFuKVxyXG4gICAgICAgICAgLm1hcCgobGluZSkgPT4ge1xyXG4gICAgICAgICAgICAvLyBDdXJyZW50IGh1bWFuLXJlYWRhYmxlIG91dHB1dCBpcyBjb2x1bW4tb3JpZW50ZWQuIEFjY2VwdCB0YWJzXHJcbiAgICAgICAgICAgIC8vIGFuZCAyKyBzcGFjZXMgc28gdGhlIHNlbGVjdG9yIHN0aWxsIHdvcmtzIGFjcm9zcyBDTEkgdmVyc2lvbnMuXHJcbiAgICAgICAgICAgIGNvbnN0IGNvbHVtbnMgPSBsaW5lLnNwbGl0KC9cXHQrfFxcc3syLH0vKS5maWx0ZXIoQm9vbGVhbik7XHJcbiAgICAgICAgICAgIGlmIChjb2x1bW5zLmxlbmd0aCA8IDIpIHJldHVybiBudWxsO1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgIGlkOiBjb2x1bW5zWzBdLnRyaW0oKSxcclxuICAgICAgICAgICAgICBuYW1lOiBjb2x1bW5zLnNsaWNlKDEpLmpvaW4oXCIgXCIpLnRyaW0oKSxcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgIH0pXHJcbiAgICAgICAgICAuZmlsdGVyKChtb2RlbCk6IG1vZGVsIGlzIEFnZW50TW9kZWwgPT4gbW9kZWwgIT09IG51bGwpO1xuXHJcbiAgICAgICAgcmVzb2x2ZShtb2RlbHMpO1xyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjbGFzc2lmeUZhaWx1cmUobWVzc2FnZTogc3RyaW5nKTogQWdlbnRGYWlsdXJlW1wiY29kZVwiXSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IG1lc3NhZ2UudG9Mb3dlckNhc2UoKTtcbiAgICBpZiAobm9ybWFsaXplZC5pbmNsdWRlcyhcInBlcm1pc3Npb25cIikgfHwgbm9ybWFsaXplZC5pbmNsdWRlcyhcImFwcHJvdmFsXCIpKSB7XG4gICAgICByZXR1cm4gXCJwZXJtaXNzaW9uLXJlcXVpcmVkXCI7XG4gICAgfVxuICAgIGlmIChub3JtYWxpemVkLmluY2x1ZGVzKFwianNvblwiKSB8fCBub3JtYWxpemVkLmluY2x1ZGVzKFwicHJvdG9jb2xcIikpIHtcbiAgICAgIHJldHVybiBcInByb3RvY29sLWludmFsaWRcIjtcbiAgICB9XG4gICAgcmV0dXJuIFwicHJvY2Vzcy1mYWlsZWRcIjtcbiAgfVxuXG4gIHByaXZhdGUgZmFpbHVyZUZyb20oXG4gICAgZXJyb3I6IHVua25vd24sXG4gICAgY29kZTogQWdlbnRGYWlsdXJlW1wiY29kZVwiXSxcbiAgKTogQWdlbnRGYWlsdXJlIHtcbiAgICBjb25zdCBkaWFnbm9zdGljID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgIGNvbnN0IG1lc3NhZ2UgPVxuICAgICAgY29kZSA9PT0gXCJydW50aW1lLXVuYXZhaWxhYmxlXCJcbiAgICAgICAgPyBcIkFnZW50IHJ1bnRpbWUgaXMgdW5hdmFpbGFibGUuIENvbmZpZ3VyZSBpdHMgZXhlY3V0YWJsZSBwYXRoIGFuZCB0cnkgYWdhaW4uXCJcbiAgICAgICAgOiBjb2RlID09PSBcInBlcm1pc3Npb24tcmVxdWlyZWRcIlxuICAgICAgICAgID8gXCJUaGUgYWdlbnQgcnVudGltZSByZXF1aXJlcyBhcHByb3ZhbCBiZWZvcmUgaXQgY2FuIGNvbnRpbnVlLlwiXG4gICAgICAgICAgOiBjb2RlID09PSBcInByb3RvY29sLWludmFsaWRcIlxuICAgICAgICAgICAgPyBcIlRoZSBhZ2VudCBydW50aW1lIHJldHVybmVkIGFuIGludmFsaWQgcmVzcG9uc2UuXCJcbiAgICAgICAgICAgIDogXCJUaGUgYWdlbnQgcnVudGltZSBjb3VsZCBub3QgY29tcGxldGUgdGhlIHJlcXVlc3QuXCI7XG5cbiAgICByZXR1cm4geyBjb2RlLCBtZXNzYWdlLCBkaWFnbm9zdGljIH07XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBJdGVtVmlldywgTWFya2Rvd25SZW5kZXJlciwgV29ya3NwYWNlTGVhZiB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHsgTGVhcm5pbmdDb250cm9sbGVyIH0gZnJvbSBcIi4uL2xlYXJuaW5nL0xlYXJuaW5nQ29udHJvbGxlclwiO1xyXG5pbXBvcnQge1xyXG4gIExlYXJuaW5nQWN0aW9uS2luZCxcclxuICBMZWFybmluZ0V2ZW50LFxyXG59IGZyb20gXCIuLi9sZWFybmluZy9sZWFybmluZy10eXBlc1wiO1xyXG5pbXBvcnQgeyBMZWFybmluZ0NvbnRleHQgfSBmcm9tIFwiLi4vY29udGV4dC9jb250ZXh0LXR5cGVzXCI7XHJcbmltcG9ydCB7XHJcbiAgUHJhY3RpY2VFdmFsdWF0aW9uLFxyXG4gIFByYWN0aWNlUXVlc3Rpb24sXHJcbn0gZnJvbSBcIi4uL2xlYXJuaW5nL3ByYWN0aWNlLXR5cGVzXCI7XHJcbmltcG9ydCB7IEFnZW50Q29udGV4dCwgQ2hhdE1lc3NhZ2UsIEVkaXRQcm9wb3NhbCB9IGZyb20gXCIuLi90eXBlc1wiO1xuaW1wb3J0IHsgUHJvcG9zZWRFZGl0IH0gZnJvbSBcIi4uL2xlYXJuaW5nL2xlYXJuaW5nLXR5cGVzXCI7XG5cclxuZXhwb3J0IGNvbnN0IEZPUkdFX1ZJRVdfVFlQRSA9IFwiZm9yZ2Utc2lkZWJhclwiO1xuXHJcbnR5cGUgVUlTdGF0ZSA9XHJcbiAgfCBcIkVNUFRZXCJcclxuICB8IFwiUlVOTklOR1wiXHJcbiAgfCBcIkFOU1dFUlwiXHJcbiAgfCBcIlBST1BPU0FMXCJcclxuICB8IFwiQVBQTElFRFwiXHJcbiAgfCBcIkVSUk9SXCI7XHJcblxyXG5jb25zdCBBQ1RJT05TOiBBcnJheTx7XG4gIGtpbmQ6IExlYXJuaW5nQWN0aW9uS2luZDtcbiAgbGFiZWw6IHN0cmluZztcbn0+ID0gW1xuICB7IGtpbmQ6IFwiYXNrXCIsIGxhYmVsOiBcIkFza1wiIH0sXHJcbiAgeyBraW5kOiBcImV4cGxhaW5cIiwgbGFiZWw6IFwiRXhwbGFpblwiIH0sXHJcbiAgeyBraW5kOiBcInByYWN0aWNlXCIsIGxhYmVsOiBcIlByYWN0aWNlXCIgfSxcclxuICB7IGtpbmQ6IFwicmV2aWV3XCIsIGxhYmVsOiBcIlJldmlld1wiIH0sXHJcbiAgeyBraW5kOiBcImVkaXRcIiwgbGFiZWw6IFwiRWRpdFwiIH0sXG5dO1xuXG5jb25zdCBQUk9NUFRfQ09NTUFORFM6IEFycmF5PHtcbiAga2luZDogTGVhcm5pbmdBY3Rpb25LaW5kO1xuICBuYW1lOiBzdHJpbmc7XG4gIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG59PiA9IFtcbiAgeyBraW5kOiBcImFza1wiLCBuYW1lOiBcIi9hc2tcIiwgZGVzY3JpcHRpb246IFwiQXNrIGFib3V0IHRoZSBjdXJyZW50IGNvbnRleHRcIiB9LFxuICB7IGtpbmQ6IFwiZXhwbGFpblwiLCBuYW1lOiBcIi9leHBsYWluXCIsIGRlc2NyaXB0aW9uOiBcIkJyZWFrIGRvd24gYSBjb25jZXB0XCIgfSxcbiAgeyBraW5kOiBcInByYWN0aWNlXCIsIG5hbWU6IFwiL3ByYWN0aWNlXCIsIGRlc2NyaXB0aW9uOiBcIkdlbmVyYXRlIGEgcHJhY3RpY2UgcXVlc3Rpb25cIiB9LFxuICB7IGtpbmQ6IFwicmV2aWV3XCIsIG5hbWU6IFwiL3Jldmlld1wiLCBkZXNjcmlwdGlvbjogXCJSZXZpZXcgdW5kZXJzdGFuZGluZyBhbmQgZ2Fwc1wiIH0sXG4gIHsga2luZDogXCJlZGl0XCIsIG5hbWU6IFwiL2VkaXRcIiwgZGVzY3JpcHRpb246IFwiSW1wcm92ZSB0aGUgY3VycmVudCBub3RlXCIgfSxcbl07XG5cbnR5cGUgUHJvbXB0TWVudUtpbmQgPSBcInNvdXJjZVwiIHwgXCJjb21tYW5kXCI7XG5cbmZ1bmN0aW9uIHBhcnNlUHJvbXB0VG9rZW4odmFsdWU6IHN0cmluZyk6IHtcbiAga2luZDogUHJvbXB0TWVudUtpbmQ7XG4gIHF1ZXJ5OiBzdHJpbmc7XG4gIHN0YXJ0OiBudW1iZXI7XG59IHwgbnVsbCB7XG4gIGNvbnN0IG1hdGNoID0gLyhefFxccykoW0AvXSkoW1xcdy1dKikkLy5leGVjKHZhbHVlKTtcbiAgaWYgKCFtYXRjaCkgcmV0dXJuIG51bGw7XG5cbiAgcmV0dXJuIHtcbiAgICBraW5kOiBtYXRjaFsyXSA9PT0gXCJAXCIgPyBcInNvdXJjZVwiIDogXCJjb21tYW5kXCIsXG4gICAgcXVlcnk6IG1hdGNoWzNdLnRvTG93ZXJDYXNlKCksXG4gICAgc3RhcnQ6IG1hdGNoLmluZGV4ICsgbWF0Y2hbMV0ubGVuZ3RoLFxuICB9O1xufVxuXHJcbmV4cG9ydCBjbGFzcyBDaGF0VmlldyBleHRlbmRzIEl0ZW1WaWV3IHtcclxuICBwcml2YXRlIHRocmVhZCE6IEhUTUxFbGVtZW50O1xyXG4gIHByaXZhdGUgY29tcG9zZXIhOiBIVE1MRWxlbWVudDtcclxuICBwcml2YXRlIGhlYWRlckVsITogSFRNTEVsZW1lbnQ7XHJcblxyXG4gIHByaXZhdGUgaW5wdXQhOiBIVE1MVGV4dEFyZWFFbGVtZW50O1xyXG4gIHByaXZhdGUgc2VuZEJ0biE6IEhUTUxCdXR0b25FbGVtZW50O1xyXG4gIHByaXZhdGUgc2VsZWN0aW9uQ2hpcCE6IEhUTUxFbGVtZW50O1xyXG4gIHByaXZhdGUgbm90ZUNoaXAhOiBIVE1MRWxlbWVudDtcbiAgcHJpdmF0ZSBzeXN0ZW1DaGlwITogSFRNTEVsZW1lbnQ7XG4gIHByaXZhdGUgY2FuY2VsQnRuITogSFRNTEJ1dHRvbkVsZW1lbnQ7XG4gIHByaXZhdGUgY29udGV4dFNlbGVjdCE6IEhUTUxCdXR0b25FbGVtZW50O1xuICBwcml2YXRlIG1vZGVsU2VsZWN0ITogSFRNTFNlbGVjdEVsZW1lbnQ7XG4gIHByaXZhdGUgZGljdGF0aW9uQnRuITogSFRNTEJ1dHRvbkVsZW1lbnQ7XG4gIHByaXZhdGUgZmlsZUlucHV0ITogSFRNTElucHV0RWxlbWVudDtcbiAgcHJpdmF0ZSBwcm9tcHRQbHVzQnRuITogSFRNTEJ1dHRvbkVsZW1lbnQ7XG4gIHByaXZhdGUgYXR0YWNobWVudHNFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBwcm9tcHRNZW51RWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgcHJvbXB0TWVudTogUHJvbXB0TWVudUtpbmQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBwcm9tcHRNZW51QWN0aXZlID0gMDtcbiAgcHJpdmF0ZSBwcm9tcHRNZW51Um93czogSFRNTEJ1dHRvbkVsZW1lbnRbXSA9IFtdO1xuICBwcml2YXRlIGRpY3RhdGlvblJlY29nbml0aW9uOiBhbnkgPSBudWxsO1xuICBwcml2YXRlIGRpY3RhdGlvbkxpc3RlbmluZyA9IGZhbHNlO1xuICBwcml2YXRlIGF0dGFjaG1lbnRzOiBBcnJheTx7IG5hbWU6IHN0cmluZzsgY29udGV4dDogQWdlbnRDb250ZXh0IH0+ID0gW107XG5cclxuICBwcml2YXRlIGFnZW50Q3Vyc29yRWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgYWdlbnRDb250ZW50RWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgc3RhdHVzRWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgbG9hZGluZ0VsYXBzZWRFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBsb2FkaW5nU3RhcnRlZEF0ID0gMDtcbiAgcHJpdmF0ZSBsb2FkaW5nVGltZXI6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHRoaW5raW5nVG9nZ2xlRWw6IEhUTUxCdXR0b25FbGVtZW50IHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgdGhpbmtpbmdMYWJlbEVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHRoaW5raW5nQ2hldnJvbkVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHRoaW5raW5nUGFuZWxFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSB0aGlua2luZ1Jvd3M6IEhUTUxFbGVtZW50W10gPSBbXTtcbiAgcHJpdmF0ZSB0aGlua2luZ1N0YWdlVGltZXI6IG51bWJlciB8IG51bGwgPSBudWxsO1xuICBwcml2YXRlIHRoaW5raW5nU3RhZ2UgPSAwO1xuICBwcml2YXRlIHRoaW5raW5nTWFudWFsRXhwYW5kZWQ6IGJvb2xlYW4gfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSBzdHJlYW1lZFJlc3BvbnNlVGV4dCA9IFwiXCI7XG4gIHByaXZhdGUgc3RyZWFtaW5nUGVuZGluZ1RleHQgPSBcIlwiO1xuICBwcml2YXRlIHJlc3BvbnNlVGltZUVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xuXHJcbiAgcHJpdmF0ZSB1aVN0YXRlOiBVSVN0YXRlID0gXCJFTVBUWVwiO1xyXG4gIHByaXZhdGUgc2VsZWN0ZWRBY3Rpb246IExlYXJuaW5nQWN0aW9uS2luZCA9IFwiYXNrXCI7XHJcbiAgcHJpdmF0ZSBhY3Rpb25CdXR0b25zID0gbmV3IE1hcDxMZWFybmluZ0FjdGlvbktpbmQsIEhUTUxCdXR0b25FbGVtZW50PigpO1xyXG5cclxuICBwcml2YXRlIGV4dHJhQ3R4OiBBZ2VudENvbnRleHRbXSA9IFtdO1xyXG4gIHByaXZhdGUgY3VycmVudENvbnRleHQ6IExlYXJuaW5nQ29udGV4dCB8IG51bGwgPSBudWxsO1xyXG5cclxuICBjb25zdHJ1Y3RvcihcbiAgICBsZWFmOiBXb3Jrc3BhY2VMZWFmLFxuICAgIHByaXZhdGUgcmVhZG9ubHkgbGVhcm5pbmc6IExlYXJuaW5nQ29udHJvbGxlcixcbiAgICBwcml2YXRlIHJlYWRvbmx5IG9wZW5TZXR0aW5nczogKCkgPT4gdm9pZCxcbiAgICBwcml2YXRlIHJlYWRvbmx5IGdldExvZ29Vcmw6ICgpID0+IHN0cmluZyxcbiAgKSB7XG4gICAgc3VwZXIobGVhZik7XHJcbiAgfVxyXG5cclxuICBnZXRWaWV3VHlwZSgpIHtcclxuICAgIHJldHVybiBGT1JHRV9WSUVXX1RZUEU7XG4gIH1cclxuXHJcbiAgZ2V0RGlzcGxheVRleHQoKSB7XG4gICAgcmV0dXJuIFwiRm9yZ2VcIjtcbiAgfVxyXG5cclxuICBnZXRJY29uKCkge1xuICAgIHJldHVybiBcImZvcmdlLWxvZ29cIjtcbiAgfVxuXHJcbiAgYXN5bmMgb25PcGVuKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3Qgcm9vdCA9IHRoaXMuY29udGVudEVsO1xyXG4gICAgcm9vdC5lbXB0eSgpO1xyXG4gICAgcm9vdC5hZGRDbGFzcyhcImZvcmdlLXJvb3RcIik7XG5cclxuICAgIHRoaXMuYnVpbGRIZWFkZXIocm9vdCk7XHJcbiAgICB0aGlzLnRocmVhZCA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLXRocmVhZFwiIH0pO1xuICAgIHRoaXMuY29tcG9zZXIgPSByb290LmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1jb21wb3NlclwiIH0pO1xuICAgIHRoaXMuYnVpbGRDb21wb3Nlcih0aGlzLmNvbXBvc2VyKTtcclxuXHJcbiAgICB0cnkge1xuICAgICAgY29uc3QgaGVhbHRoID0gYXdhaXQgdGhpcy5sZWFybmluZy5jaGVja1J1bnRpbWUoKTtcbiAgICAgIGlmIChoZWFsdGguc3RhdHVzICE9PSBcInJlYWR5XCIpIHtcbiAgICAgICAgdGhpcy5zaG93RXJyb3IoaGVhbHRoLmZhaWx1cmUubWVzc2FnZSk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9IGNhdGNoIHtcbiAgICAgIHRoaXMuc2hvd0Vycm9yKFwiQWdlbnQgcnVudGltZSBpcyB1bmF2YWlsYWJsZS4gQ2hlY2sgRm9yZ2UgcnVudGltZSBzZXR0aW5ncy5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgYXdhaXQgdGhpcy5zeW5jQ2hpcHMoKTtcbiAgICBhd2FpdCB0aGlzLnJlc3RvcmVTZXNzaW9uKCk7XG5cclxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcclxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsICgpID0+IHtcclxuICAgICAgICB2b2lkIHRoaXMuc3luY0NoaXBzKCk7XHJcbiAgICAgIH0pLFxyXG4gICAgKTtcclxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcclxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiZWRpdG9yLXNlbGVjdGlvbi1jaGFuZ2VcIiBhcyBhbnksICgpID0+IHtcclxuICAgICAgICB2b2lkIHRoaXMuc3luY0NoaXBzKCk7XHJcbiAgICAgIH0pLFxyXG4gICAgKTtcclxuXHJcbiAgICB2b2lkIHRoaXMucmVmcmVzaE1vZGVsTGlzdCgpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgb25DbG9zZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmxlYXJuaW5nLmNhbmNlbCgpO1xuICAgIHRoaXMuZGljdGF0aW9uUmVjb2duaXRpb24/LnN0b3A/LigpO1xuICAgIHRoaXMuZGljdGF0aW9uUmVjb2duaXRpb24gPSBudWxsO1xuICAgIHRoaXMuZGljdGF0aW9uTGlzdGVuaW5nID0gZmFsc2U7XG4gICAgdGhpcy5zdG9wVGhpbmtpbmdTZXF1ZW5jZSgpO1xuICAgIHRoaXMuc3RvcExvYWRpbmdUaW1lcigpO1xuICB9XG5cbiAgZm9jdXNDb21wb3NlcigpOiB2b2lkIHtcbiAgICB0aGlzLmlucHV0Py5mb2N1cygpO1xuICB9XG5cbiAgcHJpdmF0ZSBidWlsZEhlYWRlcihyb290OiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIHRoaXMuaGVhZGVyRWwgPSByb290LmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1oZWFkZXJcIiB9KTtcbiAgICBjb25zdCB0b3AgPSB0aGlzLmhlYWRlckVsLmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1oZWFkZXItdG9wXCIgfSk7XG4gICAgY29uc3QgYnJhbmQgPSB0b3AuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLWhlYWRlci1icmFuZFwiIH0pO1xuICAgIGJyYW5kLmNyZWF0ZUVsKFwiaW1nXCIsIHtcbiAgICAgIGNsczogXCJmb3JnZS1oZWFkZXItbG9nb1wiLFxuICAgICAgYXR0cjoge1xuICAgICAgICBzcmM6IHRoaXMuZ2V0TG9nb1VybCgpLFxuICAgICAgICBhbHQ6IFwiRm9yZ2VcIixcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICBjb25zdCBjb3B5ID0gYnJhbmQuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLWhlYWRlci1jb3B5XCIgfSk7XG4gICAgY29weS5jcmVhdGVTcGFuKHsgY2xzOiBcImZvcmdlLWhlYWRlci10aXRsZVwiLCB0ZXh0OiBcIkZvcmdlXCIgfSk7XG5cbiAgICBjb25zdCByaWdodCA9IHRvcC5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtaGVhZGVyLXJpZ2h0XCIgfSk7XG5cbiAgICBjb25zdCBuZXdCdG4gPSByaWdodC5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICBjbHM6IFwiZm9yZ2UtbmV3LWJ0blwiLFxuICAgICAgdGV4dDogXCJcdUZGMEJcIixcbiAgICB9KTtcbiAgICBuZXdCdG4udGl0bGUgPSBcIk5ldyBsZWFybmluZyBzZXNzaW9uXCI7XG4gICAgbmV3QnRuLnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgXCJOZXcgbGVhcm5pbmcgc2Vzc2lvblwiKTtcbiAgICBuZXdCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMubGVhcm5pbmcubmV3U2Vzc2lvbigpO1xuICAgICAgdGhpcy5leHRyYUN0eCA9IFtdO1xuICAgICAgdGhpcy5hdHRhY2htZW50cyA9IFtdO1xuICAgICAgdGhpcy5yZW5kZXJBdHRhY2htZW50cygpO1xuICAgICAgdGhpcy5jbG9zZVByb21wdE1lbnUoKTtcbiAgICAgIHRoaXMuc2VsZWN0ZWRBY3Rpb24gPSBcImFza1wiO1xuICAgICAgdGhpcy5zeW5jQWN0aW9uQnV0dG9ucygpO1xyXG4gICAgICBhd2FpdCB0aGlzLnN5bmNDaGlwcygpO1xyXG4gICAgICB0aGlzLnNob3dFbXB0eSgpO1xuICAgIH0pO1xuXG4gICAgY29uc3QgbW9yZUJ0biA9IHJpZ2h0LmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcbiAgICAgIGNsczogXCJmb3JnZS1tb3JlLWJ0blwiLFxuICAgICAgdGV4dDogXCJcdTIyRUZcIixcbiAgICAgIGF0dHI6IHtcbiAgICAgICAgdHlwZTogXCJidXR0b25cIixcbiAgICAgICAgXCJhcmlhLWxhYmVsXCI6IFwiT3BlbiBGb3JnZSBzZXR0aW5nc1wiLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBtb3JlQnRuLnRpdGxlID0gXCJGb3JnZSBzZXR0aW5nc1wiO1xuICAgIG1vcmVCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMub3BlblNldHRpbmdzKCkpO1xuICB9XG5cbiAgcHJpdmF0ZSBidWlsZEFjdGlvbkJ1dHRvbnMocGFyZW50OiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgYWN0aW9uIG9mIEFDVElPTlMpIHtcbiAgICAgIGNvbnN0IGJ1dHRvbiA9IHBhcmVudC5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICAgIGNsczogXCJmb3JnZS1hY3Rpb24tYnRuXCIsXG4gICAgICAgIHRleHQ6IGFjdGlvbi5sYWJlbCxcbiAgICAgIH0pO1xuICAgICAgYnV0dG9uLnR5cGUgPSBcImJ1dHRvblwiO1xuICAgICAgYnV0dG9uLnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgYFVzZSAke2FjdGlvbi5sYWJlbH0gbW9kZWApO1xuICAgICAgYnV0dG9uLnRpdGxlID0gYCR7YWN0aW9uLmxhYmVsfSBtb2RlYDtcbiAgICAgIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgICB0aGlzLnNlbGVjdGVkQWN0aW9uID0gYWN0aW9uLmtpbmQ7XG4gICAgICAgIHRoaXMuc3luY0FjdGlvbkJ1dHRvbnMoKTtcbiAgICAgICAgdGhpcy51cGRhdGVQbGFjZWhvbGRlcigpO1xuICAgICAgfSk7XG4gICAgICB0aGlzLmFjdGlvbkJ1dHRvbnMuc2V0KGFjdGlvbi5raW5kLCBidXR0b24pO1xuICAgIH1cblxuICAgIHRoaXMuc3luY0FjdGlvbkJ1dHRvbnMoKTtcbiAgfVxuXHJcbiAgcHJpdmF0ZSBhc3luYyByZWZyZXNoTW9kZWxMaXN0KCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgbGV0IG1vZGVscyA9IHRoaXMubGVhcm5pbmcuZ2V0TW9kZWxzKCk7XHJcblxyXG4gICAgdGhpcy5tb2RlbFNlbGVjdC5lbXB0eSgpO1xuICAgIGNvbnN0IGN1cnJlbnRNb2RlbCA9IHRoaXMubGVhcm5pbmcuZ2V0U2Vzc2lvbigpLm1vZGVsO1xuXG4gICAgY29uc3QgZGVmYXVsdE9wdGlvbiA9IHRoaXMubW9kZWxTZWxlY3QuY3JlYXRlRWwoXCJvcHRpb25cIiwge1xuICAgICAgdmFsdWU6IFwiXCIsXG4gICAgICB0ZXh0OiBcIlJ1bnRpbWUgZGVmYXVsdFwiLFxuICAgIH0pO1xuICAgIGRlZmF1bHRPcHRpb24uc2VsZWN0ZWQgPSAhY3VycmVudE1vZGVsO1xuXHJcbiAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIG1vZGVscykge1xyXG4gICAgICBjb25zdCBvcHRpb24gPSB0aGlzLm1vZGVsU2VsZWN0LmNyZWF0ZUVsKFwib3B0aW9uXCIsIHtcbiAgICAgICAgdmFsdWU6IG1vZGVsLmlkLFxuICAgICAgICB0ZXh0OiBtb2RlbC5uYW1lLFxuICAgICAgfSk7XHJcblxyXG4gICAgICBpZiAobW9kZWwuaWQgPT09IGN1cnJlbnRNb2RlbCkgb3B0aW9uLnNlbGVjdGVkID0gdHJ1ZTtcclxuICAgIH1cclxuICB9XHJcblxuICBwcml2YXRlIGJ1aWxkQ29tcG9zZXIocGFyZW50OiBIVE1MRWxlbWVudCk6IHZvaWQge1xuICAgIGNvbnN0IGNvbnRleHRSb3cgPSBwYXJlbnQuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLWNvbnRleHQtcm93XCIgfSk7XG4gICAgY29udGV4dFJvdy5jcmVhdGVTcGFuKHtcbiAgICAgIGNsczogXCJmb3JnZS1jb250ZXh0LWxhYmVsXCIsXG4gICAgICB0ZXh0OiBcIlVzaW5nXCIsXG4gICAgfSk7XG5cbiAgICBjb25zdCBjaGlwcyA9IGNvbnRleHRSb3cuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLWNoaXBzXCIgfSk7XG5cbiAgICB0aGlzLnNlbGVjdGlvbkNoaXAgPSBjaGlwcy5jcmVhdGVTcGFuKHtcbiAgICAgIGNsczogXCJmb3JnZS1jaGlwIGZvcmdlLWNoaXAtLWhpZGRlblwiLFxuICAgIH0pO1xuICAgIHRoaXMuc2VsZWN0aW9uQ2hpcC5jcmVhdGVTcGFuKHsgY2xzOiBcImZvcmdlLWNoaXAtZG90XCIgfSk7XG4gICAgdGhpcy5zZWxlY3Rpb25DaGlwLmNyZWF0ZVNwYW4oe1xuICAgICAgY2xzOiBcImZvcmdlLWNoaXAtbGFiZWxcIixcbiAgICAgIHRleHQ6IFwiQHNlbGVjdGlvblwiLFxuICAgIH0pO1xuXG4gICAgdGhpcy5ub3RlQ2hpcCA9IGNoaXBzLmNyZWF0ZVNwYW4oe1xuICAgICAgY2xzOiBcImZvcmdlLWNoaXAgZm9yZ2UtY2hpcC0taGlkZGVuXCIsXG4gICAgfSk7XG4gICAgdGhpcy5ub3RlQ2hpcC5jcmVhdGVTcGFuKHsgY2xzOiBcImZvcmdlLWNoaXAtZG90XCIgfSk7XG4gICAgdGhpcy5ub3RlQ2hpcC5jcmVhdGVTcGFuKHtcbiAgICAgIGNsczogXCJmb3JnZS1jaGlwLWxhYmVsXCIsXG4gICAgICB0ZXh0OiBcIkBub3RlXCIsXG4gICAgfSk7XG5cbiAgICB0aGlzLnN5c3RlbUNoaXAgPSBjaGlwcy5jcmVhdGVTcGFuKHtcbiAgICAgIGNsczogXCJmb3JnZS1jaGlwIGZvcmdlLWNoaXAtLWhpZGRlblwiLFxuICAgIH0pO1xuICAgIHRoaXMuc3lzdGVtQ2hpcC5jcmVhdGVTcGFuKHsgY2xzOiBcImZvcmdlLWNoaXAtZG90XCIgfSk7XG4gICAgdGhpcy5zeXN0ZW1DaGlwLmNyZWF0ZVNwYW4oe1xuICAgICAgY2xzOiBcImZvcmdlLWNoaXAtbGFiZWxcIixcbiAgICAgIHRleHQ6IFwiQGZvcmdlLXN5c3RlbVwiLFxuICAgIH0pO1xuXG4gICAgY29uc3QgYW5jaG9yID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1wcm9tcHQtYW5jaG9yXCIgfSk7XG4gICAgdGhpcy5wcm9tcHRNZW51RWwgPSBhbmNob3IuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS1wcm9tcHQtbWVudSBmb3JnZS1oaWRkZW5cIixcbiAgICB9KTtcblxuICAgIGNvbnN0IGJveCA9IGFuY2hvci5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtY29tcG9zZXItYm94XCIgfSk7XG4gICAgYm94LmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoZXZlbnQpID0+IHtcbiAgICAgIGlmICghKGV2ZW50LnRhcmdldCBpbnN0YW5jZW9mIEhUTUxCdXR0b25FbGVtZW50KSAmJlxuICAgICAgICAgICEoZXZlbnQudGFyZ2V0IGluc3RhbmNlb2YgSFRNTFNlbGVjdEVsZW1lbnQpKSB7XG4gICAgICAgIHRoaXMuaW5wdXQuZm9jdXMoKTtcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIHRoaXMuYXR0YWNobWVudHNFbCA9IGJveC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLWF0dGFjaG1lbnRzIGZvcmdlLWhpZGRlblwiLFxuICAgIH0pO1xuXG4gICAgdGhpcy5maWxlSW5wdXQgPSBib3guY3JlYXRlRWwoXCJpbnB1dFwiLCB7XG4gICAgICBjbHM6IFwiZm9yZ2UtZmlsZS1pbnB1dFwiLFxuICAgICAgYXR0cjoge1xuICAgICAgICB0eXBlOiBcImZpbGVcIixcbiAgICAgICAgbXVsdGlwbGU6IFwiXCIsXG4gICAgICAgIGFjY2VwdDogXCIubWQsLnR4dCwuY3N2LC5qc29uLC55YW1sLC55bWxcIixcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgdGhpcy5maWxlSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCAoKSA9PiB7XG4gICAgICB2b2lkIHRoaXMuaGFuZGxlRmlsZXModGhpcy5maWxlSW5wdXQuZmlsZXMpO1xuICAgIH0pO1xuXG4gICAgY29uc3QgY29udHJvbHMgPSBib3guY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLWNvbXBvc2VyLWNvbnRyb2xzXCIgfSk7XG4gICAgdGhpcy5wcm9tcHRQbHVzQnRuID0gY29udHJvbHMuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgY2xzOiBcImZvcmdlLXByb21wdC1wbHVzXCIsXG4gICAgICB0ZXh0OiBcIlx1RkYwQlwiLFxuICAgICAgYXR0cjoge1xuICAgICAgICB0eXBlOiBcImJ1dHRvblwiLFxuICAgICAgICBcImFyaWEtbGFiZWxcIjogXCJBZGQgY29udGV4dCBvciBmaWxlXCIsXG4gICAgICAgIFwiYXJpYS1leHBhbmRlZFwiOiBcImZhbHNlXCIsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHRoaXMucHJvbXB0UGx1c0J0bi50aXRsZSA9IFwiQWRkIGNvbnRleHQgb3IgZmlsZVwiO1xuICAgIHRoaXMucHJvbXB0UGx1c0J0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5wcm9tcHRNZW51ID0gdGhpcy5wcm9tcHRNZW51ID09PSBcInNvdXJjZVwiID8gbnVsbCA6IFwic291cmNlXCI7XG4gICAgICB0aGlzLnByb21wdE1lbnVBY3RpdmUgPSAwO1xuICAgICAgdGhpcy5yZW5kZXJQcm9tcHRNZW51KCk7XG4gICAgICB0aGlzLmlucHV0LmZvY3VzKCk7XG4gICAgfSk7XG5cbiAgICB0aGlzLmlucHV0ID0gY29udHJvbHMuY3JlYXRlRWwoXCJ0ZXh0YXJlYVwiLCB7XG4gICAgICBjbHM6IFwiZm9yZ2UtaW5wdXRcIixcbiAgICAgIGF0dHI6IHtcbiAgICAgICAgcGxhY2Vob2xkZXI6IFwiQXNrIGFueXRoaW5nIGFib3V0IHRoaXMgbm90ZS4uLlwiLFxuICAgICAgICByb3dzOiBcIjFcIixcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgdGhpcy5pbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiaW5wdXRcIiwgKCkgPT4gdGhpcy5vbklucHV0KCkpO1xuICAgIHRoaXMuaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB0aGlzLm9uS2V5KGV2ZW50KSk7XG5cbiAgICBjb25zdCBmb290ZXIgPSBib3guY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLWNvbXBvc2VyLWZvb3RlclwiIH0pO1xuICAgIGNvbnN0IHRvb2xzID0gZm9vdGVyLmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1jb21wb3Nlci10b29sc1wiIH0pO1xuXG4gICAgdGhpcy5jb250ZXh0U2VsZWN0ID0gdG9vbHMuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgY2xzOiBcImZvcmdlLWNvbnRleHQtc2VsZWN0XCIsXG4gICAgICB0ZXh0OiBcIkN1cnJlbnQgbm90ZVwiLFxuICAgICAgYXR0cjoge1xuICAgICAgICB0eXBlOiBcImJ1dHRvblwiLFxuICAgICAgICBcImFyaWEtbGFiZWxcIjogXCJDaG9vc2UgY29udGV4dFwiLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICB0aGlzLmNvbnRleHRTZWxlY3QuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIHRoaXMucHJvbXB0TWVudSA9IHRoaXMucHJvbXB0TWVudSA9PT0gXCJzb3VyY2VcIiA/IG51bGwgOiBcInNvdXJjZVwiO1xuICAgICAgdGhpcy5wcm9tcHRNZW51QWN0aXZlID0gMDtcbiAgICAgIHRoaXMucmVuZGVyUHJvbXB0TWVudSgpO1xuICAgICAgdGhpcy5pbnB1dC5mb2N1cygpO1xuICAgIH0pO1xuXG4gICAgdGhpcy5tb2RlbFNlbGVjdCA9IHRvb2xzLmNyZWF0ZUVsKFwic2VsZWN0XCIsIHtcbiAgICAgIGNsczogXCJmb3JnZS1tb2RlbC1zZWxlY3RcIixcbiAgICB9KTtcbiAgICB0aGlzLm1vZGVsU2VsZWN0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKCkgPT4ge1xuICAgICAgdGhpcy5sZWFybmluZy5zZXRNb2RlbCh0aGlzLm1vZGVsU2VsZWN0LnZhbHVlKTtcbiAgICB9KTtcbiAgICB0aGlzLm1vZGVsU2VsZWN0LnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgXCJMZWFybmluZyBtb2RlbFwiKTtcbiAgICB0aGlzLm1vZGVsU2VsZWN0LnRpdGxlID0gXCJMZWFybmluZyBtb2RlbFwiO1xuICAgIHRoaXMubW9kZWxTZWxlY3QuY3JlYXRlRWwoXCJvcHRpb25cIiwge1xuICAgICAgdGV4dDogXCJMb2FkaW5nIG1vZGVsc1x1MjAyNlwiLFxuICAgICAgYXR0cjoge1xuICAgICAgICBkaXNhYmxlZDogXCJcIixcbiAgICAgICAgc2VsZWN0ZWQ6IFwiXCIsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5kaWN0YXRpb25CdG4gPSB0b29scy5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICBjbHM6IFwiZm9yZ2UtY29tcG9zZXItaWNvbi1idG5cIixcbiAgICAgIHRleHQ6IFwiXHUyNUM5XCIsXG4gICAgICBhdHRyOiB7XG4gICAgICAgIHR5cGU6IFwiYnV0dG9uXCIsXG4gICAgICAgIFwiYXJpYS1sYWJlbFwiOiBcIlN0YXJ0IGRpY3RhdGlvblwiLFxuICAgICAgICBcImFyaWEtcHJlc3NlZFwiOiBcImZhbHNlXCIsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHRoaXMuZGljdGF0aW9uQnRuLnRpdGxlID0gXCJTdGFydCBkaWN0YXRpb25cIjtcbiAgICB0aGlzLmRpY3RhdGlvbkJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy50b2dnbGVEaWN0YXRpb24oKSk7XG5cbiAgICBjb25zdCBidG5Hcm91cCA9IGZvb3Rlci5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtYnRuLWdyb3VwXCIgfSk7XG5cbiAgICB0aGlzLmNhbmNlbEJ0biA9IGJ0bkdyb3VwLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcbiAgICAgIGNsczogXCJmb3JnZS1jYW5jZWwtYnRuIGZvcmdlLWhpZGRlblwiLFxuICAgICAgdGV4dDogXCJcdTAwRDdcIixcbiAgICB9KTtcbiAgICB0aGlzLmNhbmNlbEJ0bi50aXRsZSA9IFwiU3RvcFwiO1xuICAgIHRoaXMuY2FuY2VsQnRuLnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgXCJTdG9wIGdlbmVyYXRpbmdcIik7XG4gICAgdGhpcy5jYW5jZWxCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIHRoaXMubGVhcm5pbmcuY2FuY2VsKCk7XG4gICAgICB0aGlzLmNhbmNlbEJ0bi5kaXNhYmxlZCA9IHRydWU7XG4gICAgfSk7XHJcblxuICAgIHRoaXMuc2VuZEJ0biA9IGJ0bkdyb3VwLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcbiAgICAgIGNsczogXCJmb3JnZS1zZW5kLWJ0blwiLFxuICAgICAgdGV4dDogXCJcdTIxOTFcIixcbiAgICB9KTtcbiAgICB0aGlzLnNlbmRCdG4udGl0bGUgPSBcIlNlbmQgbWVzc2FnZVwiO1xuICAgIHRoaXMuc2VuZEJ0bi5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIFwiU2VuZCBtZXNzYWdlXCIpO1xuICAgIHRoaXMuc2VuZEJ0bi5kaXNhYmxlZCA9IHRydWU7XG4gICAgdGhpcy5zZW5kQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICB2b2lkIHRoaXMuZG9TZW5kKCk7XG4gICAgfSk7XG5cbiAgICB0aGlzLnNldHVwRGljdGF0aW9uKCk7XG5cbiAgICBwYXJlbnQuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS1jb21wb3Nlci1oaW50XCIsXG4gICAgICB0ZXh0OiBcIkVudGVyIHRvIHNlbmQgXHUwMEI3IFNoaWZ0ICsgRW50ZXIgZm9yIGEgbmV3IGxpbmVcIixcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyQXR0YWNobWVudHMoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmF0dGFjaG1lbnRzRWwpIHJldHVybjtcblxuICAgIHRoaXMuYXR0YWNobWVudHNFbC5lbXB0eSgpO1xuICAgIHRoaXMuYXR0YWNobWVudHNFbC50b2dnbGVDbGFzcyhcImZvcmdlLWhpZGRlblwiLCB0aGlzLmF0dGFjaG1lbnRzLmxlbmd0aCA9PT0gMCk7XG5cbiAgICBmb3IgKGNvbnN0IFtpbmRleCwgYXR0YWNobWVudF0gb2YgdGhpcy5hdHRhY2htZW50cy5lbnRyaWVzKCkpIHtcbiAgICAgIGNvbnN0IGNoaXAgPSB0aGlzLmF0dGFjaG1lbnRzRWwuY3JlYXRlRGl2KHtcbiAgICAgICAgY2xzOiBcImZvcmdlLWF0dGFjaG1lbnQtY2hpcFwiLFxuICAgICAgfSk7XG4gICAgICBjaGlwLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9yZ2UtYXR0YWNobWVudC1pY29uXCIsIHRleHQ6IFwiXHUyNUE3XCIgfSk7XG4gICAgICBjaGlwLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9yZ2UtYXR0YWNobWVudC1uYW1lXCIsIHRleHQ6IGF0dGFjaG1lbnQubmFtZSB9KTtcblxuICAgICAgY29uc3QgcmVtb3ZlID0gY2hpcC5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICAgIGNsczogXCJmb3JnZS1hdHRhY2htZW50LXJlbW92ZVwiLFxuICAgICAgICB0ZXh0OiBcIlx1MDBEN1wiLFxuICAgICAgICBhdHRyOiB7XG4gICAgICAgICAgdHlwZTogXCJidXR0b25cIixcbiAgICAgICAgICBcImFyaWEtbGFiZWxcIjogYFJlbW92ZSAke2F0dGFjaG1lbnQubmFtZX1gLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgICByZW1vdmUuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgICAgdGhpcy5hdHRhY2htZW50cy5zcGxpY2UoaW5kZXgsIDEpO1xuICAgICAgICB0aGlzLmV4dHJhQ3R4ID0gdGhpcy5hdHRhY2htZW50cy5tYXAoKGl0ZW0pID0+IGl0ZW0uY29udGV4dCk7XG4gICAgICAgIHRoaXMucmVuZGVyQXR0YWNobWVudHMoKTtcbiAgICAgICAgdm9pZCB0aGlzLnN5bmNDaGlwcygpO1xuICAgICAgfSk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBoYW5kbGVGaWxlcyhmaWxlczogRmlsZUxpc3QgfCBudWxsKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFmaWxlcyB8fCBmaWxlcy5sZW5ndGggPT09IDApIHJldHVybjtcblxuICAgIHRoaXMuY2xvc2VQcm9tcHRNZW51KCk7XG5cbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgQXJyYXkuZnJvbShmaWxlcykpIHtcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCBmaWxlLnRleHQoKTtcbiAgICAgIHRoaXMuYXR0YWNobWVudHMucHVzaCh7XG4gICAgICAgIG5hbWU6IGZpbGUubmFtZSxcbiAgICAgICAgY29udGV4dDoge1xuICAgICAgICAgIHR5cGU6IFwibm90ZVwiLFxuICAgICAgICAgIGZpbGU6IGBhdHRhY2htZW50LyR7ZmlsZS5uYW1lfWAsXG4gICAgICAgICAgY29udGVudCxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHRoaXMuZXh0cmFDdHggPSB0aGlzLmF0dGFjaG1lbnRzLm1hcCgoaXRlbSkgPT4gaXRlbS5jb250ZXh0KTtcbiAgICB0aGlzLnJlbmRlckF0dGFjaG1lbnRzKCk7XG4gICAgdGhpcy5maWxlSW5wdXQudmFsdWUgPSBcIlwiO1xuICAgIGF3YWl0IHRoaXMuc3luY0NoaXBzKCk7XG4gICAgdGhpcy5pbnB1dC5mb2N1cygpO1xuICB9XG5cbiAgcHJpdmF0ZSBnZXRQcm9tcHRNZW51SXRlbXMoKTogQXJyYXk8e1xuICAgIGtleTogc3RyaW5nO1xuICAgIG5hbWU6IHN0cmluZztcbiAgICBkZXNjcmlwdGlvbjogc3RyaW5nO1xuICAgIGFjdGlvbjogXCJhdHRhY2hcIiB8IFwic2VsZWN0aW9uXCIgfCBcIm5vdGVcIiB8IExlYXJuaW5nQWN0aW9uS2luZDtcbiAgfT4ge1xuICAgIGlmICh0aGlzLnByb21wdE1lbnUgPT09IFwiY29tbWFuZFwiKSB7XG4gICAgICByZXR1cm4gUFJPTVBUX0NPTU1BTkRTLm1hcCgoY29tbWFuZCkgPT4gKHtcbiAgICAgICAga2V5OiBjb21tYW5kLmtpbmQsXG4gICAgICAgIG5hbWU6IGNvbW1hbmQubmFtZSxcbiAgICAgICAgZGVzY3JpcHRpb246IGNvbW1hbmQuZGVzY3JpcHRpb24sXG4gICAgICAgIGFjdGlvbjogY29tbWFuZC5raW5kLFxuICAgICAgfSkpO1xuICAgIH1cblxuICAgIGNvbnN0IGl0ZW1zOiBBcnJheTx7XG4gICAgICBrZXk6IHN0cmluZztcbiAgICAgIG5hbWU6IHN0cmluZztcbiAgICAgIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG4gICAgICBhY3Rpb246IFwiYXR0YWNoXCIgfCBcInNlbGVjdGlvblwiIHwgXCJub3RlXCI7XG4gICAgfT4gPSBbXG4gICAgICB7XG4gICAgICAgIGtleTogXCJhdHRhY2hcIixcbiAgICAgICAgbmFtZTogXCJBZGQgdGV4dCBmaWxlc1wiLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJBdHRhY2ggTWFya2Rvd24gb3IgZGF0YSBjb250ZXh0XCIsXG4gICAgICAgIGFjdGlvbjogXCJhdHRhY2hcIixcbiAgICAgIH0sXG4gICAgXTtcblxuICAgIGlmICh0aGlzLmN1cnJlbnRDb250ZXh0Py5zZWxlY3Rpb24pIHtcbiAgICAgIGl0ZW1zLnB1c2goe1xuICAgICAgICBrZXk6IFwic2VsZWN0aW9uXCIsXG4gICAgICAgIG5hbWU6IFwiQ3VycmVudCBzZWxlY3Rpb25cIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiVXNlIHRoZSBzZWxlY3RlZCB0ZXh0XCIsXG4gICAgICAgIGFjdGlvbjogXCJzZWxlY3Rpb25cIixcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIGlmICh0aGlzLmN1cnJlbnRDb250ZXh0Py5hY3RpdmVOb3RlKSB7XG4gICAgICBpdGVtcy5wdXNoKHtcbiAgICAgICAga2V5OiBcIm5vdGVcIixcbiAgICAgICAgbmFtZTogXCJDdXJyZW50IG5vdGVcIixcbiAgICAgICAgZGVzY3JpcHRpb246IFwiVXNlIHRoZSBhY3RpdmUgbm90ZVwiLFxuICAgICAgICBhY3Rpb246IFwibm90ZVwiLFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgcmV0dXJuIGl0ZW1zO1xuICB9XG5cbiAgcHJpdmF0ZSByZW5kZXJQcm9tcHRNZW51KCk6IHZvaWQge1xuICAgIGlmICghdGhpcy5wcm9tcHRNZW51RWwpIHJldHVybjtcblxuICAgIHRoaXMucHJvbXB0TWVudUVsLmVtcHR5KCk7XG4gICAgdGhpcy5wcm9tcHRNZW51Um93cyA9IFtdO1xuICAgIHRoaXMucHJvbXB0TWVudUVsLnRvZ2dsZUNsYXNzKFwiZm9yZ2UtaGlkZGVuXCIsIHRoaXMucHJvbXB0TWVudSA9PT0gbnVsbCk7XG4gICAgdGhpcy5wcm9tcHRQbHVzQnRuPy5zZXRBdHRyaWJ1dGUoXG4gICAgICBcImFyaWEtZXhwYW5kZWRcIixcbiAgICAgIFN0cmluZyh0aGlzLnByb21wdE1lbnUgIT09IG51bGwpLFxuICAgICk7XG5cbiAgICBpZiAoIXRoaXMucHJvbXB0TWVudSkgcmV0dXJuO1xuXG4gICAgY29uc3QgdG9rZW4gPSBwYXJzZVByb21wdFRva2VuKHRoaXMuaW5wdXQudmFsdWUpO1xuICAgIGNvbnN0IHF1ZXJ5ID0gdG9rZW4/LmtpbmQgPT09IHRoaXMucHJvbXB0TWVudSA/IHRva2VuLnF1ZXJ5IDogXCJcIjtcbiAgICBjb25zdCByb3dzID0gdGhpcy5nZXRQcm9tcHRNZW51SXRlbXMoKS5maWx0ZXIoKGl0ZW0pID0+XG4gICAgICBgJHtpdGVtLm5hbWV9ICR7aXRlbS5kZXNjcmlwdGlvbn1gLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMocXVlcnkpLFxuICAgICk7XG5cbiAgICByb3dzLmZvckVhY2goKGl0ZW0sIGluZGV4KSA9PiB7XG4gICAgICBjb25zdCBidXR0b24gPSB0aGlzLnByb21wdE1lbnVFbCEuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgICBjbHM6IGBmb3JnZS1wcm9tcHQtbWVudS1yb3cke2luZGV4ID09PSB0aGlzLnByb21wdE1lbnVBY3RpdmUgPyBcIiBpcy1hY3RpdmVcIiA6IFwiXCJ9YCxcbiAgICAgICAgYXR0cjogeyB0eXBlOiBcImJ1dHRvblwiIH0sXG4gICAgICB9KTtcbiAgICAgIGJ1dHRvbi5jcmVhdGVTcGFuKHsgY2xzOiBcImZvcmdlLXByb21wdC1tZW51LWljb25cIiwgdGV4dDogaXRlbS5hY3Rpb24gPT09IFwiYXR0YWNoXCIgPyBcIlx1RkYwQlwiIDogXCJAXCIgfSk7XG4gICAgICBidXR0b24uY3JlYXRlU3Bhbih7IGNsczogXCJmb3JnZS1wcm9tcHQtbWVudS1uYW1lXCIsIHRleHQ6IGl0ZW0ubmFtZSB9KTtcbiAgICAgIGJ1dHRvbi5jcmVhdGVTcGFuKHsgY2xzOiBcImZvcmdlLXByb21wdC1tZW51LWRlc2NyaXB0aW9uXCIsIHRleHQ6IGl0ZW0uZGVzY3JpcHRpb24gfSk7XG4gICAgICBidXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcIm1vdXNlZW50ZXJcIiwgKCkgPT4ge1xuICAgICAgICB0aGlzLnByb21wdE1lbnVBY3RpdmUgPSBpbmRleDtcbiAgICAgICAgdGhpcy5wcm9tcHRNZW51Um93cy5mb3JFYWNoKChyb3csIHJvd0luZGV4KSA9PiB7XG4gICAgICAgICAgcm93LnRvZ2dsZUNsYXNzKFwiaXMtYWN0aXZlXCIsIHJvd0luZGV4ID09PSB0aGlzLnByb21wdE1lbnVBY3RpdmUpO1xuICAgICAgICB9KTtcbiAgICAgIH0pO1xuICAgICAgYnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB0aGlzLnBpY2tQcm9tcHRNZW51SXRlbShpdGVtKSk7XG4gICAgICB0aGlzLnByb21wdE1lbnVSb3dzLnB1c2goYnV0dG9uKTtcbiAgICB9KTtcblxuICAgIGlmIChyb3dzLmxlbmd0aCA9PT0gMCkge1xuICAgICAgdGhpcy5wcm9tcHRNZW51RWwuY3JlYXRlRGl2KHtcbiAgICAgICAgY2xzOiBcImZvcmdlLXByb21wdC1tZW51LWVtcHR5XCIsXG4gICAgICAgIHRleHQ6IGBObyBtYXRjaGVzIGZvciBcdTIwMUMke3F1ZXJ5fVx1MjAxRGAsXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICB0aGlzLnByb21wdE1lbnVFbC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLXByb21wdC1tZW51LWhpbnRcIixcbiAgICAgIHRleHQ6IHRoaXMucHJvbXB0TWVudSA9PT0gXCJzb3VyY2VcIlxuICAgICAgICA/IFwiU2VsZWN0IGEgc291cmNlIG9yIGF0dGFjaCBhIHRleHQgZmlsZVwiXG4gICAgICAgIDogXCJDaG9vc2UgYSBsZWFybmluZyBhY3Rpb25cIixcbiAgICB9KTtcbiAgfVxuXG4gIHByaXZhdGUgcGlja1Byb21wdE1lbnVJdGVtKGl0ZW06IHtcbiAgICBuYW1lOiBzdHJpbmc7XG4gICAgYWN0aW9uOiBcImF0dGFjaFwiIHwgXCJzZWxlY3Rpb25cIiB8IFwibm90ZVwiIHwgTGVhcm5pbmdBY3Rpb25LaW5kO1xuICB9KTogdm9pZCB7XG4gICAgaWYgKGl0ZW0uYWN0aW9uID09PSBcImF0dGFjaFwiKSB7XG4gICAgICB0aGlzLmNsb3NlUHJvbXB0TWVudSgpO1xuICAgICAgdGhpcy5maWxlSW5wdXQuY2xpY2soKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCB0b2tlbiA9IHBhcnNlUHJvbXB0VG9rZW4odGhpcy5pbnB1dC52YWx1ZSk7XG4gICAgY29uc3QgcHJlZml4ID0gdG9rZW4gPyB0aGlzLmlucHV0LnZhbHVlLnNsaWNlKDAsIHRva2VuLnN0YXJ0KSA6IHRoaXMuaW5wdXQudmFsdWU7XG5cbiAgICBpZiAoaXRlbS5hY3Rpb24gPT09IFwic2VsZWN0aW9uXCIgfHwgaXRlbS5hY3Rpb24gPT09IFwibm90ZVwiKSB7XG4gICAgICB0aGlzLmlucHV0LnZhbHVlID0gYCR7cHJlZml4fUAke2l0ZW0uYWN0aW9uID09PSBcInNlbGVjdGlvblwiID8gXCJzZWxlY3Rpb25cIiA6IFwiY3VycmVudC1ub3RlXCJ9IGA7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuc2VsZWN0ZWRBY3Rpb24gPSBpdGVtLmFjdGlvbjtcbiAgICAgIHRoaXMuc3luY0FjdGlvbkJ1dHRvbnMoKTtcbiAgICAgIHRoaXMudXBkYXRlUGxhY2Vob2xkZXIoKTtcbiAgICAgIHRoaXMuaW5wdXQudmFsdWUgPSBgJHtwcmVmaXh9JHtpdGVtLm5hbWV9IGA7XG4gICAgfVxuXG4gICAgdGhpcy5jbG9zZVByb21wdE1lbnUoKTtcbiAgICB0aGlzLm9uSW5wdXQoKTtcbiAgICB0aGlzLmlucHV0LmZvY3VzKCk7XG4gIH1cblxuICBwcml2YXRlIGNsb3NlUHJvbXB0TWVudSgpOiB2b2lkIHtcbiAgICB0aGlzLnByb21wdE1lbnUgPSBudWxsO1xuICAgIHRoaXMucHJvbXB0TWVudUFjdGl2ZSA9IDA7XG4gICAgdGhpcy5yZW5kZXJQcm9tcHRNZW51KCk7XG4gIH1cblxuICBwcml2YXRlIHNldHVwRGljdGF0aW9uKCk6IHZvaWQge1xuICAgIGNvbnN0IFNwZWVjaFJlY29nbml0aW9uID0gKHdpbmRvdyBhcyBhbnkpLlNwZWVjaFJlY29nbml0aW9uID8/XG4gICAgICAod2luZG93IGFzIGFueSkud2Via2l0U3BlZWNoUmVjb2duaXRpb247XG5cbiAgICBpZiAoIVNwZWVjaFJlY29nbml0aW9uKSB7XG4gICAgICB0aGlzLmRpY3RhdGlvbkJ0bi5kaXNhYmxlZCA9IHRydWU7XG4gICAgICB0aGlzLmRpY3RhdGlvbkJ0bi50aXRsZSA9IFwiRGljdGF0aW9uIGlzIHVuYXZhaWxhYmxlIGluIHRoaXMgZW52aXJvbm1lbnRcIjtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICBjb25zdCByZWNvZ25pdGlvbiA9IG5ldyBTcGVlY2hSZWNvZ25pdGlvbigpO1xuICAgIHJlY29nbml0aW9uLmNvbnRpbnVvdXMgPSBmYWxzZTtcbiAgICByZWNvZ25pdGlvbi5pbnRlcmltUmVzdWx0cyA9IGZhbHNlO1xuICAgIHJlY29nbml0aW9uLmxhbmcgPSBcImlkLUlEXCI7XG4gICAgcmVjb2duaXRpb24ub25yZXN1bHQgPSAoZXZlbnQ6IGFueSkgPT4ge1xuICAgICAgY29uc3QgdHJhbnNjcmlwdCA9IGV2ZW50LnJlc3VsdHM/LlswXT8uWzBdPy50cmFuc2NyaXB0Py50cmltKCk7XG4gICAgICBpZiAodHJhbnNjcmlwdCkge1xuICAgICAgICB0aGlzLmlucHV0LnZhbHVlID0gYCR7dGhpcy5pbnB1dC52YWx1ZS50cmltRW5kKCl9JHt0aGlzLmlucHV0LnZhbHVlID8gXCIgXCIgOiBcIlwifSR7dHJhbnNjcmlwdH1gO1xuICAgICAgICB0aGlzLm9uSW5wdXQoKTtcbiAgICAgIH1cbiAgICB9O1xuICAgIHJlY29nbml0aW9uLm9uZXJyb3IgPSAoKSA9PiB7XG4gICAgICB0aGlzLmRpY3RhdGlvbkxpc3RlbmluZyA9IGZhbHNlO1xuICAgICAgdGhpcy5zeW5jRGljdGF0aW9uQnV0dG9uKCk7XG4gICAgfTtcbiAgICByZWNvZ25pdGlvbi5vbmVuZCA9ICgpID0+IHtcbiAgICAgIHRoaXMuZGljdGF0aW9uTGlzdGVuaW5nID0gZmFsc2U7XG4gICAgICB0aGlzLnN5bmNEaWN0YXRpb25CdXR0b24oKTtcbiAgICB9O1xuICAgIHRoaXMuZGljdGF0aW9uUmVjb2duaXRpb24gPSByZWNvZ25pdGlvbjtcbiAgfVxuXG4gIHByaXZhdGUgdG9nZ2xlRGljdGF0aW9uKCk6IHZvaWQge1xuICAgIGlmICghdGhpcy5kaWN0YXRpb25SZWNvZ25pdGlvbikgcmV0dXJuO1xuXG4gICAgaWYgKHRoaXMuZGljdGF0aW9uTGlzdGVuaW5nKSB7XG4gICAgICB0aGlzLmRpY3RhdGlvblJlY29nbml0aW9uLnN0b3AoKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB0aGlzLmRpY3RhdGlvbkxpc3RlbmluZyA9IHRydWU7XG4gICAgdGhpcy5zeW5jRGljdGF0aW9uQnV0dG9uKCk7XG4gICAgdGhpcy5pbnB1dC5mb2N1cygpO1xuICAgIHRyeSB7XG4gICAgICB0aGlzLmRpY3RhdGlvblJlY29nbml0aW9uLnN0YXJ0KCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICB0aGlzLmRpY3RhdGlvbkxpc3RlbmluZyA9IGZhbHNlO1xuICAgICAgdGhpcy5zeW5jRGljdGF0aW9uQnV0dG9uKCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBzeW5jRGljdGF0aW9uQnV0dG9uKCk6IHZvaWQge1xuICAgIGlmICghdGhpcy5kaWN0YXRpb25CdG4pIHJldHVybjtcblxuICAgIHRoaXMuZGljdGF0aW9uQnRuLnRvZ2dsZUNsYXNzKFwiaXMtYWN0aXZlXCIsIHRoaXMuZGljdGF0aW9uTGlzdGVuaW5nKTtcbiAgICB0aGlzLmRpY3RhdGlvbkJ0bi5zZXRBdHRyaWJ1dGUoXCJhcmlhLXByZXNzZWRcIiwgU3RyaW5nKHRoaXMuZGljdGF0aW9uTGlzdGVuaW5nKSk7XG4gICAgdGhpcy5kaWN0YXRpb25CdG4uc2V0QXR0cmlidXRlKFxuICAgICAgXCJhcmlhLWxhYmVsXCIsXG4gICAgICB0aGlzLmRpY3RhdGlvbkxpc3RlbmluZyA/IFwiU3RvcCBkaWN0YXRpb25cIiA6IFwiU3RhcnQgZGljdGF0aW9uXCIsXG4gICAgKTtcbiAgICB0aGlzLmRpY3RhdGlvbkJ0bi50aXRsZSA9IHRoaXMuZGljdGF0aW9uTGlzdGVuaW5nID8gXCJTdG9wIGRpY3RhdGlvblwiIDogXCJTdGFydCBkaWN0YXRpb25cIjtcbiAgICB0aGlzLmRpY3RhdGlvbkJ0bi50ZXh0Q29udGVudCA9IHRoaXMuZGljdGF0aW9uTGlzdGVuaW5nID8gXCJcdTI1Q0NcIiA6IFwiXHUyNUM5XCI7XG4gIH1cblxuICBwcml2YXRlIHN5bmNBY3Rpb25CdXR0b25zKCk6IHZvaWQge1xuICAgIGZvciAoY29uc3QgW2tpbmQsIGJ1dHRvbl0gb2YgdGhpcy5hY3Rpb25CdXR0b25zKSB7XHJcbiAgICAgIGNvbnN0IGFjdGl2ZSA9IGtpbmQgPT09IHRoaXMuc2VsZWN0ZWRBY3Rpb247XHJcbiAgICAgIGJ1dHRvbi50b2dnbGVDbGFzcyhcImlzLWFjdGl2ZVwiLCBhY3RpdmUpO1xyXG4gICAgICBidXR0b24uc2V0QXR0cmlidXRlKFwiYXJpYS1wcmVzc2VkXCIsIFN0cmluZyhhY3RpdmUpKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgdXBkYXRlUGxhY2Vob2xkZXIoKTogdm9pZCB7XHJcbiAgICBjb25zdCBwbGFjZWhvbGRlcnM6IFJlY29yZDxMZWFybmluZ0FjdGlvbktpbmQsIHN0cmluZz4gPSB7XG4gICAgICBhc2s6IFwiQXNrIGFueXRoaW5nIGFib3V0IHRoaXMgbm90ZS4uLlwiLFxuICAgICAgZXhwbGFpbjogXCJXaGF0IHNob3VsZCBJIGV4cGxhaW4/XCIsXHJcbiAgICAgIHByYWN0aWNlOiBcIldoYXQgc2hvdWxkIHdlIHByYWN0aWNlP1wiLFxyXG4gICAgICByZXZpZXc6IFwiV2hhdCBzaG91bGQgSSByZXZpZXc/XCIsXHJcbiAgICAgIGVkaXQ6IFwiSG93IHNob3VsZCBJIGltcHJvdmUgdGhpcyBub3RlP1wiLFxyXG4gICAgfTtcclxuXHJcbiAgICBpZiAodGhpcy5pbnB1dCkge1xyXG4gICAgICB0aGlzLmlucHV0LnBsYWNlaG9sZGVyID0gcGxhY2Vob2xkZXJzW3RoaXMuc2VsZWN0ZWRBY3Rpb25dO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBzeW5jQ2hpcHMoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY29udGV4dCA9IGF3YWl0IHRoaXMubGVhcm5pbmcucmVzb2x2ZUNvbnRleHQodGhpcy5leHRyYUN0eCk7XG4gICAgdGhpcy5jdXJyZW50Q29udGV4dCA9IGNvbnRleHQ7XG4gICAgdGhpcy5zeXN0ZW1DaGlwLmFkZENsYXNzKFwiZm9yZ2UtY2hpcC0taGlkZGVuXCIpO1xuXHJcbiAgICBjb25zdCBoYXNTZWxlY3Rpb24gPSBCb29sZWFuKGNvbnRleHQuc2VsZWN0aW9uKTtcbiAgICB0aGlzLnNlbGVjdGlvbkNoaXAudG9nZ2xlQ2xhc3MoXCJmb3JnZS1jaGlwLS1oaWRkZW5cIiwgIWhhc1NlbGVjdGlvbik7XG5cbiAgICBjb25zdCBhY3RpdmVOb3RlID0gY29udGV4dC5hY3RpdmVOb3RlO1xuICAgIHRoaXMubm90ZUNoaXAudG9nZ2xlQ2xhc3MoXCJmb3JnZS1jaGlwLS1oaWRkZW5cIiwgIWFjdGl2ZU5vdGUpO1xuXG4gICAgaWYgKGFjdGl2ZU5vdGUpIHtcbiAgICAgIGNvbnN0IG5hbWUgPSBhY3RpdmVOb3RlLnBhdGguc3BsaXQoXCIvXCIpLnBvcCgpID8/IGFjdGl2ZU5vdGUucGF0aDtcbiAgICAgIGNvbnN0IGxhYmVsID0gdGhpcy5ub3RlQ2hpcC5xdWVyeVNlbGVjdG9yPEhUTUxFbGVtZW50PihcIi5mb3JnZS1jaGlwLWxhYmVsXCIpO1xuICAgICAgaWYgKGxhYmVsKSBsYWJlbC50ZXh0Q29udGVudCA9IGBAJHtuYW1lfWA7XG4gICAgICB0aGlzLm5vdGVDaGlwLnRpdGxlID0gYWN0aXZlTm90ZS5wYXRoO1xuICAgIH1cblxuICAgIGNvbnN0IHNvdXJjZU5hbWUgPSBjb250ZXh0LnNlbGVjdGlvblxuICAgICAgPyBcIkN1cnJlbnQgc2VsZWN0aW9uXCJcbiAgICAgIDogYWN0aXZlTm90ZVxuICAgICAgICA/IFwiQ3VycmVudCBub3RlXCJcbiAgICAgICAgOiB0aGlzLmV4dHJhQ3R4Lmxlbmd0aCA+IDBcbiAgICAgICAgICA/IGAke3RoaXMuZXh0cmFDdHgubGVuZ3RofSBzb3VyY2VzYFxuICAgICAgICAgIDogXCJObyBjb250ZXh0XCI7XG4gICAgdGhpcy5jb250ZXh0U2VsZWN0LnRleHRDb250ZW50ID0gc291cmNlTmFtZTtcbiAgICB0aGlzLmNvbnRleHRTZWxlY3QudGl0bGUgPSBjb250ZXh0LnNlbGVjdGlvbj8uZmlsZSA/PyBhY3RpdmVOb3RlPy5wYXRoID8/IHNvdXJjZU5hbWU7XG4gIH1cblxyXG4gIHByaXZhdGUgb25JbnB1dCgpOiB2b2lkIHtcbiAgICB0aGlzLnNlbmRCdG4uZGlzYWJsZWQgPVxuICAgICAgIXRoaXMuY2FuU2VuZCgpIHx8IHRoaXMudWlTdGF0ZSA9PT0gXCJSVU5OSU5HXCI7XG5cbiAgICBjb25zdCB0b2tlbiA9IHBhcnNlUHJvbXB0VG9rZW4odGhpcy5pbnB1dC52YWx1ZSk7XG4gICAgaWYgKHRva2VuICYmIHRoaXMucHJvbXB0TWVudSAhPT0gdG9rZW4ua2luZCkge1xuICAgICAgdGhpcy5wcm9tcHRNZW51ID0gdG9rZW4ua2luZDtcbiAgICAgIHRoaXMucHJvbXB0TWVudUFjdGl2ZSA9IDA7XG4gICAgfSBlbHNlIGlmICghdG9rZW4pIHtcbiAgICAgIHRoaXMuY2xvc2VQcm9tcHRNZW51KCk7XG4gICAgfVxuXG4gICAgdGhpcy5yZW5kZXJQcm9tcHRNZW51KCk7XG5cbiAgICB0aGlzLmlucHV0LnN0eWxlLmhlaWdodCA9IFwiYXV0b1wiO1xuICAgIHRoaXMuaW5wdXQuc3R5bGUuaGVpZ2h0ID1cclxuICAgICAgTWF0aC5taW4odGhpcy5pbnB1dC5zY3JvbGxIZWlnaHQsIDgwKSArIFwicHhcIjtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgb25LZXkoZXZlbnQ6IEtleWJvYXJkRXZlbnQpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5wcm9tcHRNZW51ICYmIHRoaXMucHJvbXB0TWVudVJvd3MubGVuZ3RoID4gMCkge1xuICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJBcnJvd0Rvd25cIiB8fCBldmVudC5rZXkgPT09IFwiQXJyb3dVcFwiKSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGNvbnN0IGRpcmVjdGlvbiA9IGV2ZW50LmtleSA9PT0gXCJBcnJvd0Rvd25cIiA/IDEgOiAtMTtcbiAgICAgICAgdGhpcy5wcm9tcHRNZW51QWN0aXZlID1cbiAgICAgICAgICAodGhpcy5wcm9tcHRNZW51QWN0aXZlICsgZGlyZWN0aW9uICsgdGhpcy5wcm9tcHRNZW51Um93cy5sZW5ndGgpICVcbiAgICAgICAgICB0aGlzLnByb21wdE1lbnVSb3dzLmxlbmd0aDtcbiAgICAgICAgdGhpcy5wcm9tcHRNZW51Um93cy5mb3JFYWNoKChyb3csIGluZGV4KSA9PiB7XG4gICAgICAgICAgcm93LnRvZ2dsZUNsYXNzKFwiaXMtYWN0aXZlXCIsIGluZGV4ID09PSB0aGlzLnByb21wdE1lbnVBY3RpdmUpO1xuICAgICAgICB9KTtcbiAgICAgICAgcmV0dXJuO1xuICAgICAgfVxuXG4gICAgICBpZiAoKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiICYmICFldmVudC5zaGlmdEtleSkgfHwgZXZlbnQua2V5ID09PSBcIlRhYlwiKSB7XG4gICAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XG4gICAgICAgIGNvbnN0IHJvdyA9IHRoaXMucHJvbXB0TWVudVJvd3NbdGhpcy5wcm9tcHRNZW51QWN0aXZlXTtcbiAgICAgICAgaWYgKHJvdykgcm93LmNsaWNrKCk7XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIgJiYgIWV2ZW50LnNoaWZ0S2V5KSB7XG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xuICAgICAgaWYgKCF0aGlzLnNlbmRCdG4uZGlzYWJsZWQpIHZvaWQgdGhpcy5kb1NlbmQoKTtcbiAgICB9XG5cbiAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVzY2FwZVwiKSB7XG4gICAgICBpZiAodGhpcy5wcm9tcHRNZW51KSB7XG4gICAgICAgIHRoaXMuY2xvc2VQcm9tcHRNZW51KCk7XG4gICAgICB9IGVsc2UgaWYgKHRoaXMudWlTdGF0ZSA9PT0gXCJSVU5OSU5HXCIpIHtcbiAgICAgICAgdGhpcy5jYW5jZWxCdG4uY2xpY2soKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cblxyXG4gIHByaXZhdGUgYXN5bmMgZG9TZW5kKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHByb21wdCA9IHRoaXMuaW5wdXQudmFsdWUudHJpbSgpIHx8IFwiUmV2aWV3IHRoZSBhdHRhY2hlZCBjb250ZXh0LlwiO1xuICAgIGlmICghdGhpcy5jYW5TZW5kKCkgfHwgdGhpcy51aVN0YXRlID09PSBcIlJVTk5JTkdcIikgcmV0dXJuO1xuXG4gICAgY29uc3QgZXhwbGljaXRDb250ZXh0ID0gdGhpcy5leHRyYUN0eDtcbiAgICB0aGlzLmNsb3NlUHJvbXB0TWVudSgpO1xuICAgIGlmICh0aGlzLmRpY3RhdGlvbkxpc3RlbmluZykgdGhpcy5kaWN0YXRpb25SZWNvZ25pdGlvbj8uc3RvcD8uKCk7XG5cbiAgICB0aGlzLmlucHV0LnZhbHVlID0gXCJcIjtcbiAgICB0aGlzLmlucHV0LnN0eWxlLmhlaWdodCA9IFwiXCI7XG4gICAgdGhpcy5hdHRhY2htZW50cyA9IFtdO1xuICAgIHRoaXMuZXh0cmFDdHggPSBbXTtcbiAgICB0aGlzLnJlbmRlckF0dGFjaG1lbnRzKCk7XG4gICAgdGhpcy5zZW5kQnRuLmRpc2FibGVkID0gdHJ1ZTtcblxyXG4gICAgdGhpcy5hZ2VudEN1cnNvckVsID0gbnVsbDtcbiAgICB0aGlzLmFnZW50Q29udGVudEVsID0gbnVsbDtcbiAgICB0aGlzLnN0YXR1c0VsID0gbnVsbDtcbiAgICB0aGlzLnN0cmVhbWVkUmVzcG9uc2VUZXh0ID0gXCJcIjtcbiAgICB0aGlzLnN0cmVhbWluZ1BlbmRpbmdUZXh0ID0gXCJcIjtcbiAgICB0aGlzLnN0b3BUaGlua2luZ1NlcXVlbmNlKCk7XG4gICAgdGhpcy5zdG9wTG9hZGluZ1RpbWVyKCk7XG5cclxuICAgIHRoaXMuYXBwZW5kVXNlckJ1YmJsZShwcm9tcHQpO1xyXG4gICAgdGhpcy5zZXRVSVN0YXRlKFwiUlVOTklOR1wiKTtcclxuICAgIHRoaXMuZW5zdXJlQWdlbnRCdWJibGUoKTtcblxyXG4gICAgdHJ5IHtcbiAgICAgIGZvciBhd2FpdCAoY29uc3QgZXZlbnQgb2YgdGhpcy5sZWFybmluZy5ydW4oe1xuICAgICAgICBwcm9tcHQsXG4gICAgICAgIGFjdGlvbjogdGhpcy5zZWxlY3RlZEFjdGlvbixcbiAgICAgICAgZXhwbGljaXRDb250ZXh0LFxuICAgICAgfSkpIHtcbiAgICAgICAgdGhpcy5oYW5kbGVMZWFybmluZ0V2ZW50KGV2ZW50KTtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnIpIHtcbiAgICAgIHRoaXMuZmluaXNoU3RyZWFtaW5nQnViYmxlKFwiU3RvcHBlZFwiKTtcblxyXG4gICAgICBjb25zdCBtZXNzYWdlID1cclxuICAgICAgICBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogU3RyaW5nKGVycik7XHJcblxyXG4gICAgICBjb25zb2xlLndhcm4oXCJbRm9yZ2VdIFVuZXhwZWN0ZWQgdHVybiBmYWlsdXJlXCIsIG1lc3NhZ2UpO1xuICAgICAgdGhpcy5hcHBlbmRJbmxpbmVFcnJvcihcbiAgICAgICAgdGhpcy50aHJlYWQsXG4gICAgICAgIFwiRm9yZ2UgaGl0IGFuIHVuZXhwZWN0ZWQgZXJyb3IuIFRyeSBhZ2Fpbi5cIixcbiAgICAgICk7XG4gICAgICB0aGlzLnNldFVJU3RhdGUoXCJBTlNXRVJcIik7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBoYW5kbGVMZWFybmluZ0V2ZW50KGV2ZW50OiBMZWFybmluZ0V2ZW50KTogdm9pZCB7XG4gICAgaWYgKGV2ZW50LnR5cGUgPT09IFwiY29udGV4dC1yZWFkeVwiKSB7XG4gICAgICB0aGlzLmN1cnJlbnRDb250ZXh0ID0gZXZlbnQuY29udGV4dC5yZXNvbHZlZDtcbiAgICAgIHRoaXMuc3lzdGVtQ2hpcC50b2dnbGVDbGFzcyhcImZvcmdlLWNoaXAtLWhpZGRlblwiLCBldmVudC5jb250ZXh0LnN5c3RlbS5sZW5ndGggPT09IDApO1xuICAgICAgdGhpcy5zeXN0ZW1DaGlwLnRpdGxlID0gZXZlbnQuY29udGV4dC5zeXN0ZW0ubWFwKChpdGVtKSA9PiBpdGVtLmZpbGUpLmpvaW4oXCJcXG5cIik7XG4gICAgICByZXR1cm47XG4gICAgfVxyXG5cclxuICAgIGlmIChldmVudC50eXBlID09PSBcInJlc3BvbnNlLWRlbHRhXCIpIHtcclxuICAgICAgdGhpcy5hcHBlbmRUb0FnZW50QnViYmxlKGV2ZW50LnRleHQpO1xuICAgICAgdGhpcy5zY3JvbGxUaHJlYWQoKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChldmVudC50eXBlID09PSBcInByYWN0aWNlLXF1ZXN0aW9uXCIpIHtcclxuICAgICAgdGhpcy5hcHBlbmRQcmFjdGljZVF1ZXN0aW9uKGV2ZW50LnF1ZXN0aW9uKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChldmVudC50eXBlID09PSBcInByYWN0aWNlLWV2YWx1YXRpb25cIikge1xyXG4gICAgICB0aGlzLmFwcGVuZFByYWN0aWNlRXZhbHVhdGlvbihldmVudC5ldmFsdWF0aW9uKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChldmVudC50eXBlID09PSBcImxlYXJuaW5nLXN0YXRlLXVwZGF0ZWRcIikge1xyXG4gICAgICAvLyBEdXJhYmxlIHByb2dyZXNzIGlzIGludGVudGlvbmFsbHkgcXVpZXQuIFRoZSBpbnRlcmFjdGlvbiBpdHNlbGYgaXMgdGhlXHJcbiAgICAgIC8vIHByaW1hcnkgVUk7IHByb2dyZXNzIHN0YXRlIGlzIHN1cHBvcnRpbmcgY29udGV4dCBmb3IgZnV0dXJlIHR1cm5zLlxyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGV2ZW50LnR5cGUgPT09IFwibXV0YXRpb24tcHJvcG9zZWRcIikge1xuICAgICAgdGhpcy5zZXRVSVN0YXRlKFwiUFJPUE9TQUxcIik7XG4gICAgICB0aGlzLmFwcGVuZFByb3Bvc2FsQnViYmxlKGV2ZW50LmVkaXQpO1xuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChldmVudC50eXBlID09PSBcImNvbXBsZXRlZFwiKSB7XHJcbiAgICAgIGlmICh0aGlzLnVpU3RhdGUgPT09IFwiUlVOTklOR1wiKSB7XG4gICAgICAgIHRoaXMuc2V0VUlTdGF0ZShcIkFOU1dFUlwiKTtcclxuICAgICAgfVxyXG4gICAgICB0aGlzLmZpbmlzaFN0cmVhbWluZ0J1YmJsZSgpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGV2ZW50LnR5cGUgPT09IFwiY2FuY2VsbGVkXCIpIHtcbiAgICAgIHRoaXMuZmluaXNoU3RyZWFtaW5nQnViYmxlKFwiU3RvcHBlZFwiKTtcbiAgICAgIHRoaXMuYXBwZW5kSW5saW5lRXJyb3IodGhpcy50aHJlYWQsIFwiU3RvcHBlZC5cIik7XG4gICAgICB0aGlzLnNldFVJU3RhdGUoXCJBTlNXRVJcIik7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKGV2ZW50LnR5cGUgPT09IFwiZmFpbGVkXCIpIHtcbiAgICAgIHRoaXMuZmluaXNoU3RyZWFtaW5nQnViYmxlKFwiVW5hYmxlIHRvIGZpbmlzaFwiKTtcbiAgICAgIHRoaXMuYXBwZW5kSW5saW5lRXJyb3IodGhpcy50aHJlYWQsIGV2ZW50LmZhaWx1cmUubWVzc2FnZSk7XG4gICAgICB0aGlzLnNldFVJU3RhdGUoXCJBTlNXRVJcIik7XG4gICAgfVxuICB9XHJcblxyXG4gIHByaXZhdGUgZmluaXNoU3RyZWFtaW5nQnViYmxlKGRvbmVMYWJlbD86IHN0cmluZyk6IHZvaWQge1xuICAgIGNvbnN0IGVsYXBzZWQgPSB0aGlzLmZvcm1hdEVsYXBzZWQoRGF0ZS5ub3coKSAtIHRoaXMubG9hZGluZ1N0YXJ0ZWRBdCk7XG4gICAgdGhpcy5zdG9wVGhpbmtpbmdTZXF1ZW5jZSgpO1xuICAgIHRoaXMuZmx1c2hTdHJlYW1pbmdUZXh0KCk7XG4gICAgdGhpcy5yZW5kZXJNYXJrZG93blJlc3BvbnNlKCk7XG4gICAgaWYgKGRvbmVMYWJlbCA9PT0gdW5kZWZpbmVkKSB0aGlzLmFwcGVuZFN0cmVhbUFjdGlvbnMoKTtcbiAgICB0aGlzLnNldHRsZVRoaW5raW5nKGRvbmVMYWJlbCA/PyBgVGhvdWdodCBmb3IgJHtlbGFwc2VkfWApO1xuICAgIGlmICh0aGlzLnJlc3BvbnNlVGltZUVsKSB0aGlzLnJlc3BvbnNlVGltZUVsLnRleHRDb250ZW50ID0gYGZvciAke2VsYXBzZWR9YDtcbiAgICB0aGlzLnN0b3BMb2FkaW5nVGltZXIoKTtcbiAgICB0aGlzLmFnZW50Q3Vyc29yRWw/LnJlbW92ZUNsYXNzKFwiZm9yZ2UtYnViYmxlLS1zdHJlYW1pbmdcIik7XG4gICAgdGhpcy5hZ2VudEN1cnNvckVsID0gbnVsbDtcbiAgICB0aGlzLmFnZW50Q29udGVudEVsID0gbnVsbDtcbiAgICB0aGlzLnN0YXR1c0VsID0gbnVsbDtcbiAgICB0aGlzLnRoaW5raW5nVG9nZ2xlRWwgPSBudWxsO1xuICAgIHRoaXMudGhpbmtpbmdMYWJlbEVsID0gbnVsbDtcbiAgICB0aGlzLnRoaW5raW5nQ2hldnJvbkVsID0gbnVsbDtcbiAgICB0aGlzLnRoaW5raW5nUGFuZWxFbCA9IG51bGw7XG4gICAgdGhpcy50aGlua2luZ1Jvd3MgPSBbXTtcbiAgICB0aGlzLnRoaW5raW5nTWFudWFsRXhwYW5kZWQgPSBudWxsO1xuICAgIHRoaXMucmVzcG9uc2VUaW1lRWwgPSBudWxsO1xuICB9XG5cbiAgcHJpdmF0ZSBzZXR0bGVUaGlua2luZyhkb25lTGFiZWw6IHN0cmluZyk6IHZvaWQge1xuICAgIGlmICghdGhpcy50aGlua2luZ0xhYmVsRWwpIHJldHVybjtcblxuICAgIHRoaXMudGhpbmtpbmdMYWJlbEVsLnRleHRDb250ZW50ID0gZG9uZUxhYmVsO1xuICAgIHRoaXMudGhpbmtpbmdMYWJlbEVsLnJlbW92ZUNsYXNzKFwiZm9yZ2UtdGhpbmtpbmctbGFiZWwtLWFjdGl2ZVwiKTtcbiAgICB0aGlzLnRoaW5raW5nTGFiZWxFbC5hZGRDbGFzcyhcImZvcmdlLXRoaW5raW5nLWxhYmVsLS1kb25lXCIpO1xuXG4gICAgZm9yIChjb25zdCByb3cgb2YgdGhpcy50aGlua2luZ1Jvd3MpIHtcbiAgICAgIHJvdy5yZW1vdmVDbGFzcyhcImZvcmdlLWhpZGRlblwiKTtcbiAgICAgIHJvdy5yZW1vdmVDbGFzcyhcImlzLWFjdGl2ZVwiKTtcbiAgICAgIHJvdy5hZGRDbGFzcyhcImlzLWRvbmVcIik7XG5cbiAgICAgIGNvbnN0IG1hcmtlciA9IHJvdy5maXJzdEVsZW1lbnRDaGlsZCBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG4gICAgICBpZiAobWFya2VyKSB7XG4gICAgICAgIG1hcmtlci50ZXh0Q29udGVudCA9IFwiXHUyNzEzXCI7XG4gICAgICAgIG1hcmtlci5yZW1vdmVDbGFzcyhcImZvcmdlLXRoaW5raW5nLW1hcmtlci0tc3Bpbm5lclwiKTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICBjb25zdCBleHBhbmRlZCA9IHRoaXMudGhpbmtpbmdNYW51YWxFeHBhbmRlZCA/PyBmYWxzZTtcbiAgICB0aGlzLnRoaW5raW5nUGFuZWxFbD8udG9nZ2xlQ2xhc3MoXCJpcy1leHBhbmRlZFwiLCBleHBhbmRlZCk7XG4gICAgdGhpcy50aGlua2luZ1RvZ2dsZUVsPy5zZXRBdHRyaWJ1dGUoXCJhcmlhLWV4cGFuZGVkXCIsIFN0cmluZyhleHBhbmRlZCkpO1xuICAgIHRoaXMudGhpbmtpbmdDaGV2cm9uRWw/LnRvZ2dsZUNsYXNzKFwiaXMtZXhwYW5kZWRcIiwgZXhwYW5kZWQpO1xuICB9XG5cbiAgcHJpdmF0ZSBzdG9wVGhpbmtpbmdTZXF1ZW5jZSgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy50aGlua2luZ1N0YWdlVGltZXIgIT09IG51bGwpIHtcbiAgICAgIHdpbmRvdy5jbGVhclRpbWVvdXQodGhpcy50aGlua2luZ1N0YWdlVGltZXIpO1xuICAgICAgdGhpcy50aGlua2luZ1N0YWdlVGltZXIgPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIHByaXZhdGUgc3RhcnRUaGlua2luZ1NlcXVlbmNlKCk6IHZvaWQge1xuICAgIHRoaXMudGhpbmtpbmdTdGFnZSA9IDA7XG4gICAgdGhpcy5yZW5kZXJUaGlua2luZ1N0YWdlKCk7XG4gICAgdGhpcy5zY2hlZHVsZVRoaW5raW5nU3RhZ2UoKTtcbiAgfVxuXG4gIHByaXZhdGUgc2NoZWR1bGVUaGlua2luZ1N0YWdlKCk6IHZvaWQge1xuICAgIGlmICh0aGlzLnRoaW5raW5nU3RhZ2UgPj0gdGhpcy50aGlua2luZ1Jvd3MubGVuZ3RoIC0gMSkgcmV0dXJuO1xuXG4gICAgY29uc3QgZGVsYXlzID0gWzgwMCwgNjAwLCAxODAwLCAyNjAwXTtcbiAgICBjb25zdCBkZWxheSA9IGRlbGF5c1t0aGlzLnRoaW5raW5nU3RhZ2VdID8/IDEyMDA7XG5cbiAgICB0aGlzLnRoaW5raW5nU3RhZ2VUaW1lciA9IHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHtcbiAgICAgIHRoaXMudGhpbmtpbmdTdGFnZSArPSAxO1xuICAgICAgdGhpcy5yZW5kZXJUaGlua2luZ1N0YWdlKCk7XG4gICAgICB0aGlzLnNjaGVkdWxlVGhpbmtpbmdTdGFnZSgpO1xuICAgIH0sIGRlbGF5KTtcbiAgfVxuXG4gIHByaXZhdGUgcmVuZGVyVGhpbmtpbmdTdGFnZSgpOiB2b2lkIHtcbiAgICBjb25zdCB2aXNpYmxlID0gTWF0aC5taW4oXG4gICAgICB0aGlzLnRoaW5raW5nU3RhZ2UgKyAxLFxuICAgICAgdGhpcy50aGlua2luZ1Jvd3MubGVuZ3RoLFxuICAgICk7XG5cbiAgICB0aGlzLnRoaW5raW5nUm93cy5mb3JFYWNoKChyb3csIGluZGV4KSA9PiB7XG4gICAgICBjb25zdCBhY3RpdmUgPSBpbmRleCA9PT0gdmlzaWJsZSAtIDE7XG4gICAgICBjb25zdCBkb25lID0gaW5kZXggPCB2aXNpYmxlIC0gMTtcbiAgICAgIGNvbnN0IG1hcmtlciA9IHJvdy5maXJzdEVsZW1lbnRDaGlsZCBhcyBIVE1MRWxlbWVudCB8IG51bGw7XG5cbiAgICAgIHJvdy50b2dnbGVDbGFzcyhcImZvcmdlLWhpZGRlblwiLCBpbmRleCA+PSB2aXNpYmxlKTtcbiAgICAgIHJvdy50b2dnbGVDbGFzcyhcImlzLWFjdGl2ZVwiLCBhY3RpdmUpO1xuICAgICAgcm93LnRvZ2dsZUNsYXNzKFwiaXMtZG9uZVwiLCBkb25lKTtcblxuICAgICAgaWYgKG1hcmtlcikge1xuICAgICAgICBtYXJrZXIudGV4dENvbnRlbnQgPSBkb25lID8gXCJcdTI3MTNcIiA6IFwiXCI7XG4gICAgICAgIG1hcmtlci50b2dnbGVDbGFzcyhcImZvcmdlLXRoaW5raW5nLW1hcmtlci0tc3Bpbm5lclwiLCBhY3RpdmUpO1xuICAgICAgfVxuICAgIH0pO1xuICB9XG5cbiAgcHJpdmF0ZSBzdGFydExvYWRpbmdUaW1lcigpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5sb2FkaW5nVGltZXIgIT09IG51bGwpIHtcbiAgICAgIHdpbmRvdy5jbGVhckludGVydmFsKHRoaXMubG9hZGluZ1RpbWVyKTtcbiAgICAgIHRoaXMubG9hZGluZ1RpbWVyID0gbnVsbDtcbiAgICB9XG5cbiAgICBjb25zdCB1cGRhdGUgPSAoKSA9PiB7XG4gICAgICBjb25zdCBlbGFwc2VkID0gdGhpcy5mb3JtYXRFbGFwc2VkKERhdGUubm93KCkgLSB0aGlzLmxvYWRpbmdTdGFydGVkQXQpO1xuICAgICAgaWYgKHRoaXMubG9hZGluZ0VsYXBzZWRFbCkgdGhpcy5sb2FkaW5nRWxhcHNlZEVsLnRleHRDb250ZW50ID0gZWxhcHNlZDtcbiAgICAgIGlmICh0aGlzLnJlc3BvbnNlVGltZUVsKSB0aGlzLnJlc3BvbnNlVGltZUVsLnRleHRDb250ZW50ID0gYGZvciAke2VsYXBzZWR9YDtcbiAgICB9O1xuXG4gICAgdGhpcy5sb2FkaW5nU3RhcnRlZEF0ID0gRGF0ZS5ub3coKTtcbiAgICB1cGRhdGUoKTtcbiAgICB0aGlzLmxvYWRpbmdUaW1lciA9IHdpbmRvdy5zZXRJbnRlcnZhbCh1cGRhdGUsIDEwMCk7XG4gIH1cblxuICBwcml2YXRlIHN0b3BMb2FkaW5nVGltZXIoKTogdm9pZCB7XG4gICAgaWYgKHRoaXMubG9hZGluZ1RpbWVyICE9PSBudWxsKSB7XG4gICAgICB3aW5kb3cuY2xlYXJJbnRlcnZhbCh0aGlzLmxvYWRpbmdUaW1lcik7XG4gICAgICB0aGlzLmxvYWRpbmdUaW1lciA9IG51bGw7XG4gICAgfVxuXG4gICAgdGhpcy5sb2FkaW5nRWxhcHNlZEVsID0gbnVsbDtcbiAgfVxuXG4gIHByaXZhdGUgZm9ybWF0RWxhcHNlZChtaWxsaXNlY29uZHM6IG51bWJlcik6IHN0cmluZyB7XG4gICAgY29uc3Qgc2Vjb25kcyA9IG1pbGxpc2Vjb25kcyAvIDEwMDA7XG5cbiAgICBpZiAoc2Vjb25kcyA8IDYwKSByZXR1cm4gYCR7c2Vjb25kcy50b0ZpeGVkKDEpfXNgO1xuXG4gICAgcmV0dXJuIGAke01hdGguZmxvb3Ioc2Vjb25kcyAvIDYwKX1tICR7KHNlY29uZHMgJSA2MCkudG9GaXhlZCgxKX1zYDtcbiAgfVxuXHJcbiAgcHJpdmF0ZSBzZXRVSVN0YXRlKHN0YXRlOiBVSVN0YXRlKTogdm9pZCB7XG4gICAgdGhpcy51aVN0YXRlID0gc3RhdGU7XG5cbiAgICBjb25zdCBidXN5ID0gc3RhdGUgPT09IFwiUlVOTklOR1wiO1xuICAgIHRoaXMuY2FuY2VsQnRuLmRpc2FibGVkID0gZmFsc2U7XG4gICAgdGhpcy5pbnB1dC5kaXNhYmxlZCA9IGJ1c3kgfHwgc3RhdGUgPT09IFwiRVJST1JcIjtcbiAgICB0aGlzLnNlbmRCdG4uZGlzYWJsZWQgPVxuICAgICAgYnVzeSB8fCBzdGF0ZSA9PT0gXCJFUlJPUlwiIHx8ICF0aGlzLmNhblNlbmQoKTtcbiAgICB0aGlzLmNhbmNlbEJ0bi50b2dnbGVDbGFzcyhcImZvcmdlLWhpZGRlblwiLCAhYnVzeSk7XG4gIH1cblxuICBwcml2YXRlIGNhblNlbmQoKTogYm9vbGVhbiB7XG4gICAgcmV0dXJuIHRoaXMuaW5wdXQudmFsdWUudHJpbSgpLmxlbmd0aCA+IDAgfHwgdGhpcy5hdHRhY2htZW50cy5sZW5ndGggPiAwO1xuICB9XG5cclxuICBwcml2YXRlIHNob3dFbXB0eSgpOiB2b2lkIHtcbiAgICB0aGlzLnN0b3BMb2FkaW5nVGltZXIoKTtcbiAgICB0aGlzLnRocmVhZC5lbXB0eSgpO1xuICAgIHRoaXMuYWdlbnRDdXJzb3JFbCA9IG51bGw7XG4gICAgdGhpcy5zdGF0dXNFbCA9IG51bGw7XHJcblxuICAgIGNvbnN0IHNsYXRlID0gdGhpcy50aHJlYWQuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS1lbXB0eS1zbGF0ZVwiLFxuICAgIH0pO1xuICAgIHNsYXRlLmNyZWF0ZUVsKFwiaW1nXCIsIHtcbiAgICAgIGNsczogXCJmb3JnZS1lbXB0eS1sb2dvXCIsXG4gICAgICBhdHRyOiB7XG4gICAgICAgIHNyYzogdGhpcy5nZXRMb2dvVXJsKCksXG4gICAgICAgIGFsdDogXCJGb3JnZVwiLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBjb25zdCBsYWJlbCA9IFwiV2hhdCBhcmUgeW91IGxlYXJuaW5nP1wiO1xuXG4gICAgc2xhdGUuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS1lbXB0eS1sYWJlbFwiLFxuICAgICAgdGV4dDogbGFiZWwsXG4gICAgfSk7XG4gICAgc2xhdGUuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS1lbXB0eS1oaW50XCIsXG4gICAgICB0ZXh0OiBcIkFzayBhYm91dCB0aGUgY3VycmVudCBub3RlLCBvciBqdW1wIGludG8gYSBmb2N1c2VkIHdvcmtmbG93IHdoZW4geW91IG5lZWQgbW9yZSB0aGFuIGNoYXQuXCIsXG4gICAgfSk7XG5cbiAgICBjb25zdCBxdWlja0FjdGlvbnMgPSBzbGF0ZS5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtZW1wdHktYWN0aW9uc1wiIH0pO1xuICAgIGNvbnN0IHF1aWNrQWN0aW9uTWFwOiBBcnJheTxbTGVhcm5pbmdBY3Rpb25LaW5kLCBzdHJpbmddPiA9IFtcbiAgICAgIFtcImV4cGxhaW5cIiwgXCJFeHBsYWluIHRoaXNcIl0sXG4gICAgICBbXCJwcmFjdGljZVwiLCBcIlByYWN0aWNlXCJdLFxuICAgICAgW1wiZWRpdFwiLCBcIkltcHJvdmUgbm90ZVwiXSxcbiAgICBdO1xuICAgIGZvciAoY29uc3QgW2FjdGlvbiwgdGV4dF0gb2YgcXVpY2tBY3Rpb25NYXApIHtcbiAgICAgIGNvbnN0IGJ1dHRvbiA9IHF1aWNrQWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICAgIGNsczogXCJmb3JnZS1lbXB0eS1hY3Rpb25cIixcbiAgICAgICAgdGV4dCxcbiAgICAgICAgYXR0cjogeyB0eXBlOiBcImJ1dHRvblwiIH0sXG4gICAgICB9KTtcbiAgICAgIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xuICAgICAgICB0aGlzLnNlbGVjdGVkQWN0aW9uID0gYWN0aW9uO1xuICAgICAgICB0aGlzLnN5bmNBY3Rpb25CdXR0b25zKCk7XG4gICAgICAgIHRoaXMudXBkYXRlUGxhY2Vob2xkZXIoKTtcbiAgICAgICAgdGhpcy5mb2N1c0NvbXBvc2VyKCk7XG4gICAgICB9KTtcbiAgICB9XG5cclxuICAgIHRoaXMuc2V0VUlTdGF0ZShcIkVNUFRZXCIpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyByZXN0b3JlU2Vzc2lvbigpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtZXNzYWdlcyA9IHRoaXMubGVhcm5pbmcuZ2V0U2Vzc2lvbigpLm1lc3NhZ2VzO1xuICAgIGlmIChtZXNzYWdlcy5sZW5ndGggPT09IDApIHtcbiAgICAgIHRoaXMuc2hvd0VtcHR5KCk7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgdGhpcy50aHJlYWQuZW1wdHkoKTtcbiAgICBmb3IgKGNvbnN0IG1lc3NhZ2Ugb2YgbWVzc2FnZXMpIHtcbiAgICAgIGlmIChtZXNzYWdlLnJvbGUgPT09IFwidXNlclwiKSB7XG4gICAgICAgIHRoaXMuYXBwZW5kVXNlckJ1YmJsZShtZXNzYWdlLmNvbnRlbnQpO1xuICAgICAgICBjb250aW51ZTtcbiAgICAgIH1cbiAgICAgIGlmIChtZXNzYWdlLmNvbnRlbnQudHJpbSgpKSB7XG4gICAgICAgIGF3YWl0IHRoaXMuYXBwZW5kUmVzdG9yZWRBc3Npc3RhbnQobWVzc2FnZS5jb250ZW50KTtcbiAgICAgIH1cbiAgICAgIGlmIChtZXNzYWdlLnByb3Bvc2FsKSB7XG4gICAgICAgIHRoaXMuYXBwZW5kUmVzdG9yZWRQcm9wb3NhbChtZXNzYWdlKTtcbiAgICAgIH1cbiAgICB9XG4gICAgdGhpcy5zZXRVSVN0YXRlKFwiQU5TV0VSXCIpO1xuICAgIHRoaXMuc2Nyb2xsVGhyZWFkKCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIGFwcGVuZFJlc3RvcmVkQXNzaXN0YW50KG1hcmtkb3duOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBidWJibGUgPSB0aGlzLnRocmVhZC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLWJ1YmJsZSBmb3JnZS1idWJibGUtLWFnZW50XCIsXG4gICAgfSk7XG4gICAgY29uc3QgbWV0YSA9IGJ1YmJsZS5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtcmVzcG9uc2UtbWV0YVwiIH0pO1xuICAgIG1ldGEuY3JlYXRlU3Bhbih7IGNsczogXCJmb3JnZS1yZXNwb25zZS1sYWJlbFwiLCB0ZXh0OiBcIkZvcmdlXCIgfSk7XG4gICAgbWV0YS5jcmVhdGVTcGFuKHsgY2xzOiBcImZvcmdlLXJlc3BvbnNlLXN1YlwiLCB0ZXh0OiBcIlJlc3RvcmVkXCIgfSk7XG4gICAgY29uc3QgY29udGVudCA9IGJ1YmJsZS5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLWJ1YmJsZS1jb250ZW50IGZvcmdlLW1hcmtkb3duXCIsXG4gICAgfSk7XG4gICAgY29uc3Qgc291cmNlUGF0aCA9XG4gICAgICB0aGlzLmN1cnJlbnRDb250ZXh0Py5zZWxlY3Rpb24/LmZpbGUgPz9cbiAgICAgIHRoaXMuY3VycmVudENvbnRleHQ/LmFjdGl2ZU5vdGU/LnBhdGggPz9cbiAgICAgIFwiRm9yZ2UubWRcIjtcbiAgICBhd2FpdCBNYXJrZG93blJlbmRlcmVyLnJlbmRlcihcbiAgICAgIHRoaXMuYXBwLFxuICAgICAgbWFya2Rvd24sXG4gICAgICBjb250ZW50LFxuICAgICAgc291cmNlUGF0aCxcbiAgICAgIHRoaXMsXG4gICAgKTtcbiAgfVxuXG4gIHByaXZhdGUgYXBwZW5kUmVzdG9yZWRQcm9wb3NhbChtZXNzYWdlOiBDaGF0TWVzc2FnZSk6IHZvaWQge1xuICAgIGNvbnN0IHByb3Bvc2FsID0gbWVzc2FnZS5wcm9wb3NhbDtcbiAgICBpZiAoIXByb3Bvc2FsKSByZXR1cm47XG4gICAgY29uc3Qgd3JhcCA9IHRoaXMucmVuZGVyUHJvcG9zYWwocHJvcG9zYWwpO1xuICAgIGNvbnN0IHN0YXRlID0gbWVzc2FnZS5wcm9wb3NhbFN0YXRlID8/IFwic3RhbGVcIjtcbiAgICBjb25zdCBsYWJlbHM6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gICAgICBhcHBsaWVkOiBgXHUyNzEzIEFwcGxpZWQgdG8gJHtwcm9wb3NhbC5maWxlfWAsXG4gICAgICByZWplY3RlZDogXCJcdTI3MTUgUmVqZWN0ZWRcIixcbiAgICAgIHN0YWxlOiBcIlx1MjZBMCBFeHBpcmVkIGFmdGVyIHJlc3RhcnRcIixcbiAgICAgIHBlbmRpbmc6IFwiXHUyNkEwIEV4cGlyZWQgYWZ0ZXIgcmVzdGFydFwiLFxuICAgIH07XG4gICAgd3JhcC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBgZm9yZ2UtcmVzdWx0LWJhZGdlIGZvcmdlLWJhZGdlLS0ke3N0YXRlID09PSBcImFwcGxpZWRcIiA/IFwiYXBwbGllZFwiIDogc3RhdGUgPT09IFwicmVqZWN0ZWRcIiA/IFwicmVqZWN0ZWRcIiA6IFwic3RhbGVcIn1gLFxuICAgICAgdGV4dDogbGFiZWxzW3N0YXRlXSxcbiAgICB9KTtcbiAgfVxuXHJcbiAgcHJpdmF0ZSBzaG93RXJyb3IobWVzc2FnZTogc3RyaW5nKTogdm9pZCB7XG4gICAgdGhpcy5zdG9wTG9hZGluZ1RpbWVyKCk7XG4gICAgdGhpcy50aHJlYWQuZW1wdHkoKTtcbiAgICB0aGlzLmFnZW50Q3Vyc29yRWwgPSBudWxsO1xuICAgIHRoaXMuc3RhdHVzRWwgPSBudWxsO1xyXG5cbiAgICBjb25zdCBzbGF0ZSA9IHRoaXMudGhyZWFkLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiZm9yZ2UtZXJyb3Itc2xhdGVcIixcbiAgICB9KTtcbiAgICBzbGF0ZS5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLWVycm9yLWljb25cIixcbiAgICAgIHRleHQ6IFwiXHUyNkEwXCIsXG4gICAgfSk7XG4gICAgc2xhdGUuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS1lcnJvci10aXRsZVwiLFxuICAgICAgdGV4dDogXCJGb3JnZSB1bmF2YWlsYWJsZVwiLFxuICAgIH0pO1xuICAgIHNsYXRlLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiZm9yZ2UtZXJyb3ItYm9keVwiLFxuICAgICAgdGV4dDogbWVzc2FnZSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGJ1dHRvbiA9IHNsYXRlLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcbiAgICAgIGNsczogXCJmb3JnZS1jb25maWd1cmUtYnRuXCIsXG4gICAgICB0ZXh0OiBcIkNvbmZpZ3VyZSBGb3JnZSBcdTIxOTJcIixcbiAgICB9KTtcbiAgICBidXR0b24uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIHRoaXMub3BlblNldHRpbmdzKCk7XG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5zZXRVSVN0YXRlKFwiRVJST1JcIik7XG4gIH1cblxuICBwcml2YXRlIGFwcGVuZFVzZXJCdWJibGUodGV4dDogc3RyaW5nKTogdm9pZCB7XG4gICAgdGhpcy50aHJlYWQucXVlcnlTZWxlY3RvcihcIi5mb3JnZS1lbXB0eS1zbGF0ZVwiKT8ucmVtb3ZlKCk7XG4gICAgY29uc3QgYnViYmxlID0gdGhpcy50aHJlYWQuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS1idWJibGUgZm9yZ2UtYnViYmxlLS11c2VyXCIsXG4gICAgfSk7XG4gICAgYnViYmxlLnNldFRleHQodGV4dCk7XG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBlbnN1cmVBZ2VudEJ1YmJsZSgpOiB2b2lkIHtcbiAgICBpZiAodGhpcy5hZ2VudEN1cnNvckVsKSByZXR1cm47XG5cbiAgICB0aGlzLnN0YXR1c0VsID0gdGhpcy5idWlsZFRoaW5raW5nVHJhY2UoKTtcblxuICAgIHRoaXMuYWdlbnRDdXJzb3JFbCA9IHRoaXMudGhyZWFkLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiZm9yZ2UtYnViYmxlIGZvcmdlLWJ1YmJsZS0tYWdlbnQgZm9yZ2UtYnViYmxlLS1zdHJlYW1pbmdcIixcbiAgICB9KTtcbiAgICBjb25zdCBtZXRhID0gdGhpcy5hZ2VudEN1cnNvckVsLmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1yZXNwb25zZS1tZXRhXCIgfSk7XG4gICAgbWV0YS5jcmVhdGVTcGFuKHsgY2xzOiBcImZvcmdlLXJlc3BvbnNlLWxhYmVsXCIsIHRleHQ6IFwiRm9yZ2VcIiB9KTtcbiAgICBtZXRhLmNyZWF0ZVNwYW4oe1xuICAgICAgY2xzOiBcImZvcmdlLXJlc3BvbnNlLXN1YlwiLFxuICAgICAgdGV4dDogQUNUSU9OUy5maW5kKChhY3Rpb24pID0+IGFjdGlvbi5raW5kID09PSB0aGlzLnNlbGVjdGVkQWN0aW9uKT8ubGFiZWwgPz8gXCJSZXNwb25zZVwiLFxuICAgIH0pO1xuICAgIHRoaXMucmVzcG9uc2VUaW1lRWwgPSBtZXRhLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9yZ2UtcmVzcG9uc2UtdGltZVwiLCB0ZXh0OiBcImZvciAwLjBzXCIgfSk7XG4gICAgdGhpcy5hZ2VudENvbnRlbnRFbCA9IHRoaXMuYWdlbnRDdXJzb3JFbC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLWJ1YmJsZS1jb250ZW50XCIsXG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGJ1aWxkVGhpbmtpbmdUcmFjZSgpOiBIVE1MRWxlbWVudCB7XG4gICAgY29uc3QgdHJhY2UgPSB0aGlzLnRocmVhZC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLXRoaW5raW5nXCIsXG4gICAgfSk7XG4gICAgdHJhY2Uuc2V0QXR0cmlidXRlKFwicm9sZVwiLCBcInN0YXR1c1wiKTtcbiAgICB0cmFjZS5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxpdmVcIiwgXCJwb2xpdGVcIik7XG5cbiAgICBjb25zdCB0b2dnbGUgPSB0cmFjZS5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICBjbHM6IFwiZm9yZ2UtdGhpbmtpbmctdG9nZ2xlXCIsXG4gICAgICBhdHRyOiB7XG4gICAgICAgIHR5cGU6IFwiYnV0dG9uXCIsXG4gICAgICAgIFwiYXJpYS1leHBhbmRlZFwiOiBcInRydWVcIixcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgdGhpcy50aGlua2luZ1RvZ2dsZUVsID0gdG9nZ2xlO1xuXG4gICAgdG9nZ2xlLmNyZWF0ZUVsKFwiaW1nXCIsIHtcbiAgICAgIGNsczogXCJmb3JnZS10aGlua2luZy1sb2dvXCIsXG4gICAgICBhdHRyOiB7XG4gICAgICAgIHNyYzogdGhpcy5nZXRMb2dvVXJsKCksXG4gICAgICAgIGFsdDogXCJcIixcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLnRoaW5raW5nTGFiZWxFbCA9IHRvZ2dsZS5jcmVhdGVTcGFuKHtcbiAgICAgIGNsczogXCJmb3JnZS10aGlua2luZy1sYWJlbCBmb3JnZS10aGlua2luZy1sYWJlbC0tYWN0aXZlXCIsXG4gICAgICB0ZXh0OiBcIlRoaW5raW5nXCIsXG4gICAgfSk7XG5cbiAgICB0aGlzLmxvYWRpbmdFbGFwc2VkRWwgPSB0b2dnbGUuY3JlYXRlU3Bhbih7XG4gICAgICBjbHM6IFwiZm9yZ2UtdGhpbmtpbmctZWxhcHNlZFwiLFxuICAgIH0pO1xuICAgIHRoaXMubG9hZGluZ0VsYXBzZWRFbC5zZXRBdHRyaWJ1dGUoXCJhcmlhLWhpZGRlblwiLCBcInRydWVcIik7XG5cbiAgICBjb25zdCBjaGV2cm9uID0gdG9nZ2xlLmNyZWF0ZVNwYW4oe1xuICAgICAgY2xzOiBcImZvcmdlLXRoaW5raW5nLWNoZXZyb25cIixcbiAgICAgIHRleHQ6IFwiXHUyMzA0XCIsXG4gICAgfSk7XG4gICAgdGhpcy50aGlua2luZ0NoZXZyb25FbCA9IGNoZXZyb247XG5cbiAgICBjb25zdCBwYW5lbCA9IHRyYWNlLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiZm9yZ2UtdGhpbmtpbmctcGFuZWwgaXMtZXhwYW5kZWRcIixcbiAgICB9KTtcbiAgICB0aGlzLnRoaW5raW5nUGFuZWxFbCA9IHBhbmVsO1xuXG4gICAgY29uc3QgdHJhY2VMaXN0ID0gcGFuZWwuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS10aGlua2luZy10cmFjZVwiLFxuICAgIH0pO1xuICAgIGNvbnN0IHNvdXJjZSA9IHRoaXMuY3VycmVudENvbnRleHQ/LnNlbGVjdGlvblxuICAgICAgPyB0aGlzLmN1cnJlbnRDb250ZXh0LnNlbGVjdGlvbi5maWxlXG4gICAgICA6IHRoaXMuY3VycmVudENvbnRleHQ/LmFjdGl2ZU5vdGU/LnBhdGg7XG4gICAgY29uc3Qgc291cmNlTmFtZSA9IHNvdXJjZT8uc3BsaXQoXCIvXCIpLnBvcCgpO1xuICAgIGNvbnN0IHJlYWRpbmdMYWJlbCA9IHRoaXMuY3VycmVudENvbnRleHQ/LnNlbGVjdGlvblxuICAgICAgPyBcIlJlYWRpbmcgc2VsZWN0ZWQgdGV4dFwiXG4gICAgICA6IHRoaXMuY3VycmVudENvbnRleHQ/LmFjdGl2ZU5vdGVcbiAgICAgICAgPyBcIlJlYWRpbmcgY3VycmVudCBub3RlXCJcbiAgICAgICAgOiBcIlJlc29sdmluZyB3b3Jrc3BhY2UgY29udGV4dFwiO1xuXG4gICAgY29uc3Qgcm93cyA9IFtcbiAgICAgIHsgcHJpbWFyeTogXCJSZXNvbHZpbmcgY3VycmVudCBjb250ZXh0XCIgfSxcbiAgICAgIHsgcHJpbWFyeTogcmVhZGluZ0xhYmVsLCBzZWNvbmRhcnk6IHNvdXJjZU5hbWUgfSxcbiAgICAgIHsgcHJpbWFyeTogXCJMb2FkaW5nIExlYXJuaW5nIE9TIHBvbGljeVwiIH0sXG4gICAgICB7IHByaW1hcnk6IFwiUHJlcGFyaW5nIHJlc3BvbnNlXCIgfSxcbiAgICBdO1xuXG4gICAgdGhpcy50aGlua2luZ1Jvd3MgPSByb3dzLm1hcCgocm93KSA9PiB7XG4gICAgICBjb25zdCByb3dFbCA9IHRyYWNlTGlzdC5jcmVhdGVEaXYoe1xuICAgICAgICBjbHM6IFwiZm9yZ2UtdGhpbmtpbmctcm93XCIsXG4gICAgICB9KTtcbiAgICAgIHJvd0VsLmNyZWF0ZVNwYW4oe1xuICAgICAgICBjbHM6IFwiZm9yZ2UtdGhpbmtpbmctbWFya2VyIGZvcmdlLXRoaW5raW5nLW1hcmtlci0tc3Bpbm5lclwiLFxuICAgICAgfSk7XG4gICAgICByb3dFbC5jcmVhdGVTcGFuKHtcbiAgICAgICAgY2xzOiBcImZvcmdlLXRoaW5raW5nLXByaW1hcnlcIixcbiAgICAgICAgdGV4dDogcm93LnByaW1hcnksXG4gICAgICB9KTtcblxuICAgICAgaWYgKHJvdy5zZWNvbmRhcnkpIHtcbiAgICAgICAgcm93RWwuY3JlYXRlU3Bhbih7XG4gICAgICAgICAgY2xzOiBcImZvcmdlLXRoaW5raW5nLXNlY29uZGFyeVwiLFxuICAgICAgICAgIHRleHQ6IHJvdy5zZWNvbmRhcnksXG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcm93RWw7XG4gICAgfSk7XG5cbiAgICB0b2dnbGUuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIGNvbnN0IGV4cGFuZGVkID0gIXBhbmVsLmhhc0NsYXNzKFwiaXMtZXhwYW5kZWRcIik7XG4gICAgICBwYW5lbC50b2dnbGVDbGFzcyhcImlzLWV4cGFuZGVkXCIsIGV4cGFuZGVkKTtcbiAgICAgIHRvZ2dsZS5zZXRBdHRyaWJ1dGUoXCJhcmlhLWV4cGFuZGVkXCIsIFN0cmluZyhleHBhbmRlZCkpO1xuICAgICAgY2hldnJvbi50b2dnbGVDbGFzcyhcImlzLWV4cGFuZGVkXCIsIGV4cGFuZGVkKTtcbiAgICAgIHRoaXMudGhpbmtpbmdNYW51YWxFeHBhbmRlZCA9IGV4cGFuZGVkO1xuICAgIH0pO1xuXG4gICAgdGhpcy5zdGFydExvYWRpbmdUaW1lcigpO1xuICAgIHRoaXMuc3RhcnRUaGlua2luZ1NlcXVlbmNlKCk7XG4gICAgcmV0dXJuIHRyYWNlO1xuICB9XG5cclxuICBwcml2YXRlIGFwcGVuZFRvQWdlbnRCdWJibGUodGV4dDogc3RyaW5nKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmFnZW50Q29udGVudEVsKSByZXR1cm47XG5cbiAgICB0aGlzLnN0cmVhbWVkUmVzcG9uc2VUZXh0ICs9IHRleHQ7XG4gICAgdGhpcy5zdHJlYW1pbmdQZW5kaW5nVGV4dCArPSB0ZXh0O1xuXG4gICAgY29uc3QgcGFydHMgPSB0aGlzLnN0cmVhbWluZ1BlbmRpbmdUZXh0LnNwbGl0KC8oXFxzKykvKTtcbiAgICBjb25zdCBsYXN0UGFydCA9IHBhcnRzW3BhcnRzLmxlbmd0aCAtIDFdID8/IFwiXCI7XG4gICAgY29uc3QgaGFzVHJhaWxpbmdXaGl0ZXNwYWNlID0gL1xccyQvLnRlc3QodGhpcy5zdHJlYW1pbmdQZW5kaW5nVGV4dCk7XG5cbiAgICBpZiAoIWhhc1RyYWlsaW5nV2hpdGVzcGFjZSkge1xuICAgICAgdGhpcy5zdHJlYW1pbmdQZW5kaW5nVGV4dCA9IHBhcnRzLnBvcCgpID8/IGxhc3RQYXJ0O1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLnN0cmVhbWluZ1BlbmRpbmdUZXh0ID0gXCJcIjtcbiAgICB9XG5cbiAgICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcbiAgICAgIGlmICghcGFydCkgY29udGludWU7XG5cbiAgICAgIGlmICgvXFxzKy8udGVzdChwYXJ0KSkge1xuICAgICAgICB0aGlzLmFnZW50Q29udGVudEVsLmFwcGVuZFRleHQocGFydCk7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuXG4gICAgICB0aGlzLmFnZW50Q29udGVudEVsLmNyZWF0ZVNwYW4oe1xuICAgICAgICBjbHM6IFwiZm9yZ2Utc3RyZWFtLXdvcmRcIixcbiAgICAgICAgdGV4dDogcGFydCxcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIHRoaXMuc2Nyb2xsVGhyZWFkKCk7XG4gIH1cblxuICBwcml2YXRlIGZsdXNoU3RyZWFtaW5nVGV4dCgpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuYWdlbnRDb250ZW50RWwgfHwgIXRoaXMuc3RyZWFtaW5nUGVuZGluZ1RleHQpIHJldHVybjtcblxuICAgIHRoaXMuYWdlbnRDb250ZW50RWwuY3JlYXRlU3Bhbih7XG4gICAgICBjbHM6IFwiZm9yZ2Utc3RyZWFtLXdvcmRcIixcbiAgICAgIHRleHQ6IHRoaXMuc3RyZWFtaW5nUGVuZGluZ1RleHQsXG4gICAgfSk7XG4gICAgdGhpcy5zdHJlYW1pbmdQZW5kaW5nVGV4dCA9IFwiXCI7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlck1hcmtkb3duUmVzcG9uc2UoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmFnZW50Q29udGVudEVsIHx8ICF0aGlzLnN0cmVhbWVkUmVzcG9uc2VUZXh0LnRyaW0oKSkgcmV0dXJuO1xuXG4gICAgY29uc3QgY29udGVudCA9IHRoaXMuYWdlbnRDb250ZW50RWw7XG4gICAgY29uc3QgbWFya2Rvd24gPSB0aGlzLnN0cmVhbWVkUmVzcG9uc2VUZXh0O1xuICAgIGNvbnN0IHNvdXJjZVBhdGggPVxuICAgICAgdGhpcy5jdXJyZW50Q29udGV4dD8uc2VsZWN0aW9uPy5maWxlID8/XG4gICAgICB0aGlzLmN1cnJlbnRDb250ZXh0Py5hY3RpdmVOb3RlPy5wYXRoID8/XG4gICAgICBcIkZvcmdlLm1kXCI7XG5cbiAgICBjb250ZW50LmVtcHR5KCk7XG4gICAgY29udGVudC5hZGRDbGFzcyhcImZvcmdlLW1hcmtkb3duXCIpO1xuXG4gICAgdm9pZCBNYXJrZG93blJlbmRlcmVyLnJlbmRlcih0aGlzLmFwcCwgbWFya2Rvd24sIGNvbnRlbnQsIHNvdXJjZVBhdGgsIHRoaXMpLmNhdGNoKCgpID0+IHtcbiAgICAgIGNvbnRlbnQuZW1wdHkoKTtcbiAgICAgIGNvbnRlbnQucmVtb3ZlQ2xhc3MoXCJmb3JnZS1tYXJrZG93blwiKTtcbiAgICAgIGNvbnRlbnQuYWRkQ2xhc3MoXCJmb3JnZS1tYXJrZG93bi1lcnJvclwiKTtcbiAgICAgIGNvbnRlbnQuc2V0VGV4dChcIk1hcmtkb3duIHJlc3BvbnNlIGNvdWxkIG5vdCBiZSByZW5kZXJlZC5cIik7XG4gICAgfSk7XG4gIH1cblxuICBwcml2YXRlIGFwcGVuZFN0cmVhbUFjdGlvbnMoKTogdm9pZCB7XG4gICAgaWYgKCF0aGlzLmFnZW50Q3Vyc29yRWwgfHwgIXRoaXMuc3RyZWFtZWRSZXNwb25zZVRleHQudHJpbSgpKSByZXR1cm47XG5cbiAgICBjb25zdCByZXNwb25zZVRleHQgPSB0aGlzLnN0cmVhbWVkUmVzcG9uc2VUZXh0LnRyaW0oKTtcbiAgICBjb25zdCBhY3Rpb25zID0gdGhpcy5hZ2VudEN1cnNvckVsLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiZm9yZ2Utc3RyZWFtLWFjdGlvbnNcIixcbiAgICB9KTtcbiAgICBjb25zdCBjb3B5QnV0dG9uID0gYWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICBjbHM6IFwiZm9yZ2Utc3RyZWFtLWFjdGlvblwiLFxuICAgICAgdGV4dDogXCJDb3B5XCIsXG4gICAgICBhdHRyOiB7XG4gICAgICAgIHR5cGU6IFwiYnV0dG9uXCIsXG4gICAgICAgIFwiYXJpYS1sYWJlbFwiOiBcIkNvcHkgcmVzcG9uc2VcIixcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICBjb3B5QnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XG4gICAgICB0cnkge1xuICAgICAgICBhd2FpdCBuYXZpZ2F0b3IuY2xpcGJvYXJkLndyaXRlVGV4dChyZXNwb25zZVRleHQpO1xuICAgICAgICBjb3B5QnV0dG9uLnRleHRDb250ZW50ID0gXCJDb3BpZWRcIjtcbiAgICAgIH0gY2F0Y2gge1xuICAgICAgICBjb3B5QnV0dG9uLnRleHRDb250ZW50ID0gXCJDb3B5IGZhaWxlZFwiO1xuICAgICAgfVxuXG4gICAgICB3aW5kb3cuc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICAgIGNvcHlCdXR0b24udGV4dENvbnRlbnQgPSBcIkNvcHlcIjtcbiAgICAgIH0sIDE0MDApO1xuICAgIH0pO1xuICB9XG5cclxuICBwcml2YXRlIGFwcGVuZFByYWN0aWNlUXVlc3Rpb24oXHJcbiAgICBxdWVzdGlvbjogUHJhY3RpY2VRdWVzdGlvbixcclxuICApOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuYWdlbnRDdXJzb3JFbCkgcmV0dXJuO1xuXG4gICAgY29uc3QgY2FyZCA9IHRoaXMuYWdlbnRDdXJzb3JFbC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLXByYWN0aWNlLWNhcmRcIixcbiAgICB9KTtcbiAgICBjYXJkLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiZm9yZ2UtcHJhY3RpY2UtbGFiZWxcIixcbiAgICAgIHRleHQ6IGBQcmFjdGljZSBcdTAwQjcgJHtxdWVzdGlvbi5jb25jZXB0fWAsXG4gICAgfSk7XG4gICAgY2FyZC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLXByYWN0aWNlLXF1ZXN0aW9uXCIsXG4gICAgICB0ZXh0OiBxdWVzdGlvbi5xdWVzdGlvbixcbiAgICB9KTtcblxyXG4gICAgaWYgKHF1ZXN0aW9uLmhpbnQpIHtcbiAgICAgIGNhcmQuY3JlYXRlRGl2KHtcbiAgICAgICAgY2xzOiBcImZvcmdlLXByYWN0aWNlLWhpbnRcIixcbiAgICAgICAgdGV4dDogYEhpbnQ6ICR7cXVlc3Rpb24uaGludH1gLFxuICAgICAgfSk7XG4gICAgfVxyXG5cclxuICAgIHRoaXMuc2Nyb2xsVGhyZWFkKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFwcGVuZFByYWN0aWNlRXZhbHVhdGlvbihcclxuICAgIGV2YWx1YXRpb246IFByYWN0aWNlRXZhbHVhdGlvbixcclxuICApOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuYWdlbnRDdXJzb3JFbCkgcmV0dXJuO1xuXG4gICAgY29uc3QgY2FyZCA9IHRoaXMuYWdlbnRDdXJzb3JFbC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLXByYWN0aWNlLWV2YWx1YXRpb25cIixcbiAgICB9KTtcblxuICAgIGNvbnN0IG91dGNvbWVMYWJlbCA9XHJcbiAgICAgIGV2YWx1YXRpb24ub3V0Y29tZSA9PT0gXCJjb3JyZWN0XCJcclxuICAgICAgICA/IFwiQ29ycmVjdFwiXHJcbiAgICAgICAgOiBldmFsdWF0aW9uLm91dGNvbWUgPT09IFwicGFydGlhbFwiXHJcbiAgICAgICAgICA/IFwiUGFydGlhbFwiXHJcbiAgICAgICAgICA6IFwiTmVlZHMgd29ya1wiO1xyXG5cbiAgICBjYXJkLmNyZWF0ZURpdih7XG4gICAgICBjbHM6IFwiZm9yZ2UtcHJhY3RpY2UtbGFiZWxcIixcbiAgICAgIHRleHQ6IGAke291dGNvbWVMYWJlbH0gXHUwMEI3ICR7ZXZhbHVhdGlvbi5jb25jZXB0fWAsXG4gICAgfSk7XG4gICAgY2FyZC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLXByYWN0aWNlLWZlZWRiYWNrXCIsXG4gICAgICB0ZXh0OiBldmFsdWF0aW9uLmZlZWRiYWNrLFxuICAgIH0pO1xuXHJcbiAgICBpZiAoZXZhbHVhdGlvbi5taXNjb25jZXB0aW9ucy5sZW5ndGggPiAwKSB7XG4gICAgICBjb25zdCBnYXBzID0gY2FyZC5jcmVhdGVEaXYoe1xuICAgICAgICBjbHM6IFwiZm9yZ2UtcHJhY3RpY2UtZ2Fwc1wiLFxuICAgICAgfSk7XG4gICAgICBnYXBzLmNyZWF0ZURpdih7XG4gICAgICAgIGNsczogXCJmb3JnZS1wcmFjdGljZS1nYXBzLWxhYmVsXCIsXG4gICAgICAgIHRleHQ6IFwiR2FwXCIsXG4gICAgICB9KTtcblxyXG4gICAgICBmb3IgKGNvbnN0IG1pc2NvbmNlcHRpb24gb2YgZXZhbHVhdGlvbi5taXNjb25jZXB0aW9ucykge1xuICAgICAgICBnYXBzLmNyZWF0ZURpdih7XG4gICAgICAgICAgY2xzOiBcImZvcmdlLXByYWN0aWNlLWdhcFwiLFxuICAgICAgICAgIHRleHQ6IG1pc2NvbmNlcHRpb24sXG4gICAgICAgIH0pO1xuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuc2Nyb2xsVGhyZWFkKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFwcGVuZFByb3Bvc2FsQnViYmxlKGVkaXQ6IFByb3Bvc2VkRWRpdCk6IHZvaWQge1xuICAgIGNvbnN0IHByb3Bvc2FsID0gZWRpdC5wcm9wb3NhbDtcbiAgICBjb25zdCB3cmFwID0gdGhpcy5yZW5kZXJQcm9wb3NhbChwcm9wb3NhbCk7XG5cbiAgICBjb25zdCBhY3Rpb25zID0gd3JhcC5jcmVhdGVEaXYoe1xuICAgICAgY2xzOiBcImZvcmdlLXByb3Bvc2FsLWFjdGlvbnNcIixcbiAgICB9KTtcblxuICAgIGNvbnN0IHJlamVjdEJ0biA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgY2xzOiBcImZvcmdlLWJ0bi1yZWplY3RcIixcbiAgICAgIHRleHQ6IFwiUmVqZWN0XCIsXG4gICAgfSk7XG5cbiAgICBjb25zdCBhcHBseUJ0biA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgY2xzOiBcImZvcmdlLWJ0bi1hcHBseVwiLFxuICAgICAgdGV4dDogXCJBcHBseSBcdTI3MTNcIixcbiAgICB9KTtcblxyXG4gICAgcmVqZWN0QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XG4gICAgICB2b2lkIHRoaXMubGVhcm5pbmcucmVqZWN0UHJvcG9zYWwoZWRpdC5pZCk7XG4gICAgICBhY3Rpb25zLnJlbW92ZSgpO1xuICAgICAgd3JhcC5jcmVhdGVEaXYoe1xuICAgICAgICBjbHM6IFwiZm9yZ2UtcmVzdWx0LWJhZGdlIGZvcmdlLWJhZGdlLS1yZWplY3RlZFwiLFxuICAgICAgICB0ZXh0OiBcIlx1MjcxNSBSZWplY3RlZFwiLFxuICAgICAgfSk7XG4gICAgICB0aGlzLnNldFVJU3RhdGUoXCJBTlNXRVJcIik7XHJcbiAgICB9KTtcclxuXHJcbiAgICBhcHBseUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBhcHBseUJ0bi5kaXNhYmxlZCA9IHRydWU7XHJcbiAgICAgIGFwcGx5QnRuLnRleHRDb250ZW50ID0gXCJBcHBseWluZ1x1MjAyNlwiO1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5sZWFybmluZy5hcHBseVByb3Bvc2FsKGVkaXQuaWQpO1xuICAgICAgYWN0aW9ucy5yZW1vdmUoKTtcclxuXHJcbiAgICAgIGlmIChyZXN1bHQub2spIHtcbiAgICAgICAgd3JhcC5jcmVhdGVEaXYoe1xuICAgICAgICAgIGNsczogXCJmb3JnZS1yZXN1bHQtYmFkZ2UgZm9yZ2UtYmFkZ2UtLWFwcGxpZWRcIixcbiAgICAgICAgICB0ZXh0OiBcIlx1MjcxMyBBcHBsaWVkIHRvIFwiICsgcHJvcG9zYWwuZmlsZSxcbiAgICAgICAgfSk7XG4gICAgICAgIHRoaXMuc2V0VUlTdGF0ZShcIkFQUExJRURcIik7XHJcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHdyYXAuY3JlYXRlRGl2KHtcbiAgICAgICAgICBjbHM6IFwiZm9yZ2UtcmVzdWx0LWJhZGdlIGZvcmdlLWJhZGdlLS1zdGFsZVwiLFxuICAgICAgICAgIHRleHQ6IFwiXHUyNkEwIFwiICsgcmVzdWx0Lm1lc3NhZ2UsXG4gICAgICAgIH0pO1xuICAgICAgICB0aGlzLnNldFVJU3RhdGUoXCJBTlNXRVJcIik7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuc2Nyb2xsVGhyZWFkKCk7XG4gIH1cblxuICBwcml2YXRlIHJlbmRlclByb3Bvc2FsKHByb3Bvc2FsOiBFZGl0UHJvcG9zYWwpOiBIVE1MRWxlbWVudCB7XG4gICAgY29uc3Qgd3JhcCA9IHRoaXMudGhyZWFkLmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1wcm9wb3NhbFwiIH0pO1xuICAgIHdyYXAuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS1wcm9wb3NhbC1iYWRnZVwiLFxuICAgICAgdGV4dDogXCJcdUQ4M0RcdURDQzQgXCIgKyBwcm9wb3NhbC5maWxlLFxuICAgIH0pO1xuICAgIGlmIChwcm9wb3NhbC5yZWFzb24pIHtcbiAgICAgIHdyYXAuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLXByb3Bvc2FsLXJlYXNvblwiLCB0ZXh0OiBwcm9wb3NhbC5yZWFzb24gfSk7XG4gICAgfVxuICAgIGNvbnN0IGRpZmYgPSB3cmFwLmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1wcm9wb3NhbC1kaWZmXCIgfSk7XG4gICAgcHJvcG9zYWwub3JpZ2luYWwuc3BsaXQoXCJcXG5cIikuZm9yRWFjaCgobGluZSkgPT4ge1xuICAgICAgZGlmZi5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtZGlmZi1yZW1vdmVkXCIsIHRleHQ6IFwiLSBcIiArIGxpbmUgfSk7XG4gICAgfSk7XG4gICAgcHJvcG9zYWwucmVwbGFjZW1lbnQuc3BsaXQoXCJcXG5cIikuZm9yRWFjaCgobGluZSkgPT4ge1xuICAgICAgZGlmZi5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtZGlmZi1hZGRlZFwiLCB0ZXh0OiBcIisgXCIgKyBsaW5lIH0pO1xuICAgIH0pO1xuICAgIHJldHVybiB3cmFwO1xuICB9XG5cclxuICBwcml2YXRlIGFwcGVuZElubGluZUVycm9yKFxyXG4gICAgcGFyZW50OiBIVE1MRWxlbWVudCxcclxuICAgIG1lc3NhZ2U6IHN0cmluZyxcclxuICApOiB2b2lkIHtcbiAgICBwYXJlbnQuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS1pbmxpbmUtZXJyb3JcIixcbiAgICAgIHRleHQ6IFwiXHUyNkEwIFwiICsgbWVzc2FnZSxcbiAgICB9KTtcbiAgICB0aGlzLnNjcm9sbFRocmVhZCgpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzY3JvbGxUaHJlYWQoKTogdm9pZCB7XHJcbiAgICB0aGlzLnRocmVhZC5zY3JvbGxUbyh7XHJcbiAgICAgIHRvcDogdGhpcy50aHJlYWQuc2Nyb2xsSGVpZ2h0LFxyXG4gICAgICBiZWhhdmlvcjogXCJzbW9vdGhcIixcclxuICAgIH0pO1xyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgQWdlbnRDb250ZXh0IH0gZnJvbSBcIi4uL3R5cGVzXCI7XHJcbmltcG9ydCB7IE9ic2lkaWFuQ29udGV4dCB9IGZyb20gXCIuL09ic2lkaWFuQ29udGV4dFwiO1xyXG5pbXBvcnQgeyBDb250ZXh0RG9jdW1lbnQsIExlYXJuaW5nQ29udGV4dCB9IGZyb20gXCIuL2NvbnRleHQtdHlwZXNcIjtcclxuXHJcbi8qKlxyXG4gKiBTaW5nbGUgc291cmNlIG9mIHRydXRoIGZvciB0aGUgY29udGV4dCBzaG93biBpbiB0aGUgVUkgYW5kIHNlbnQgdG8gdGhlIGFnZW50LlxyXG4gKlxyXG4gKiBQcmVjZWRlbmNlOlxyXG4gKiAgIHNlbGVjdGlvbiAtPiBjdXJyZW50IG5vdGUgLT4gbm8gYXV0b21hdGljIG1hdGVyaWFsXHJcbiAqIEV4cGxpY2l0IHJlZnMgYXJlIGFkZGl0aXZlIHN1cHBvcnRpbmcgY29udGV4dC5cclxuICovXHJcbmV4cG9ydCBjbGFzcyBDb250ZXh0UmVzb2x2ZXIge1xyXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgb2JzaWRpYW46IE9ic2lkaWFuQ29udGV4dCkge31cclxuXHJcbiAgYXN5bmMgcmVzb2x2ZShleHBsaWNpdDogQWdlbnRDb250ZXh0W10gPSBbXSk6IFByb21pc2U8TGVhcm5pbmdDb250ZXh0PiB7XHJcbiAgICBjb25zdCBzZWxlY3Rpb24gPSB0aGlzLm9ic2lkaWFuLmdldFNlbGVjdGlvbigpO1xyXG4gICAgY29uc3QgYWN0aXZlTm90ZSA9IGF3YWl0IHRoaXMub2JzaWRpYW4uZ2V0Q3VycmVudE5vdGUoKTtcclxuXHJcbiAgICBjb25zdCBleHBsaWNpdERvY3M6IENvbnRleHREb2N1bWVudFtdID0gZXhwbGljaXQubWFwKChpdGVtKSA9PiAoe1xyXG4gICAgICB0eXBlOiBpdGVtLnR5cGUsXHJcbiAgICAgIHBhdGg6IGl0ZW0uZmlsZSxcclxuICAgICAgY29udGVudDogaXRlbS5jb250ZW50LFxyXG4gICAgICBzb3VyY2U6IFwiZXhwbGljaXRcIixcclxuICAgIH0pKTtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBzZWxlY3Rpb246IHNlbGVjdGlvbiA/PyB1bmRlZmluZWQsXHJcbiAgICAgIGFjdGl2ZU5vdGU6IGFjdGl2ZU5vdGVcclxuICAgICAgICA/IHsgcGF0aDogYWN0aXZlTm90ZS5maWxlLCBjb250ZW50OiBhY3RpdmVOb3RlLmNvbnRlbnQgfVxyXG4gICAgICAgIDogdW5kZWZpbmVkLFxyXG4gICAgICBleHBsaWNpdDogZXhwbGljaXREb2NzLFxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENvbnZlcnQgcmVzb2x2ZWQgbGVhcm5pbmcgY29udGV4dCB0byB0aGUgZXhpc3RpbmcgYWdlbnQgdHJhbnNwb3J0IHNoYXBlLlxyXG4gICAqIE9ubHkgb25lIGF1dG9tYXRpYyBwcmltYXJ5IG1hdGVyaWFsIGlzIGluY2x1ZGVkOlxyXG4gICAqIHNlbGVjdGlvbiB3aGVuIHByZXNlbnQsIG90aGVyd2lzZSB0aGUgY3VycmVudCBub3RlLlxyXG4gICAqL1xyXG4gIHRvQWdlbnRDb250ZXh0KGNvbnRleHQ6IExlYXJuaW5nQ29udGV4dCk6IEFnZW50Q29udGV4dFtdIHtcclxuICAgIGNvbnN0IHJlc3VsdDogQWdlbnRDb250ZXh0W10gPSBbXTtcclxuXHJcbiAgICBpZiAoY29udGV4dC5zZWxlY3Rpb24pIHtcclxuICAgICAgcmVzdWx0LnB1c2goe1xyXG4gICAgICAgIHR5cGU6IFwic2VsZWN0aW9uXCIsXHJcbiAgICAgICAgZmlsZTogY29udGV4dC5zZWxlY3Rpb24uZmlsZSxcclxuICAgICAgICBjb250ZW50OiBjb250ZXh0LnNlbGVjdGlvbi5jb250ZW50LFxyXG4gICAgICB9KTtcclxuICAgIH0gZWxzZSBpZiAoY29udGV4dC5hY3RpdmVOb3RlKSB7XHJcbiAgICAgIHJlc3VsdC5wdXNoKHtcclxuICAgICAgICB0eXBlOiBcIm5vdGVcIixcclxuICAgICAgICBmaWxlOiBjb250ZXh0LmFjdGl2ZU5vdGUucGF0aCxcclxuICAgICAgICBjb250ZW50OiBjb250ZXh0LmFjdGl2ZU5vdGUuY29udGVudCxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgZm9yIChjb25zdCBpdGVtIG9mIGNvbnRleHQuZXhwbGljaXQpIHtcclxuICAgICAgY29uc3QgZHVwbGljYXRlID0gcmVzdWx0LnNvbWUoXHJcbiAgICAgICAgKGV4aXN0aW5nKSA9PlxyXG4gICAgICAgICAgZXhpc3RpbmcudHlwZSA9PT0gaXRlbS50eXBlICYmXHJcbiAgICAgICAgICBleGlzdGluZy5maWxlID09PSBpdGVtLnBhdGggJiZcclxuICAgICAgICAgIGV4aXN0aW5nLmNvbnRlbnQgPT09IGl0ZW0uY29udGVudCxcclxuICAgICAgKTtcclxuICAgICAgaWYgKGR1cGxpY2F0ZSkgY29udGludWU7XHJcblxyXG4gICAgICByZXN1bHQucHVzaCh7XHJcbiAgICAgICAgdHlwZTogaXRlbS50eXBlLFxyXG4gICAgICAgIGZpbGU6IGl0ZW0ucGF0aCxcclxuICAgICAgICBjb250ZW50OiBpdGVtLmNvbnRlbnQsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBBcHAsIFRGaWxlIH0gZnJvbSBcIm9ic2lkaWFuXCI7XG5cbi8qKlxuICogT2JzaWRpYW5Db250ZXh0IFx1MjAxNCByZXNvbHZlcyBjb250ZXh0IGZyb20gdGhlIGFjdGl2ZSBPYnNpZGlhbiB3b3Jrc3BhY2UuXG4gKlxuICogUmVzb2x1dGlvbiBydWxlcyAoU3Bpa2UgMik6XG4gKiAgIDEuIFNlbGVjdGlvbiBwcmVzZW50IFx1MjE5MiBjb250ZXh0ID0gW3NlbGVjdGlvbl1cbiAqICAgMi4gTm8gc2VsZWN0aW9uICAgICAgXHUyMTkyIGNvbnRleHQgPSBbY3VycmVudC1ub3RlXVxuICogICAzLiBVc2VyIGFkZHMgQGZpbGUgICBcdTIxOTIgY29udGV4dCA9IFthdXRvXSArIFtleHBsaWNpdC4uLl1cbiAqXG4gKiBFdmVyeSBjb250ZXh0IGl0ZW0gaXMgdmlzaWJsZSBhcyBhIGNoaXAgaW4gdGhlIENvbXBvc2VyLlxuICogTm90aGluZyBpcyByZWFkIHNpbGVudGx5LlxuICovXG5leHBvcnQgY2xhc3MgT2JzaWRpYW5Db250ZXh0IHtcbiAgY29uc3RydWN0b3IocHJpdmF0ZSBhcHA6IEFwcCkge31cblxuICAvKiogQ3VycmVudCBlZGl0b3Igc2VsZWN0aW9uLCBvciBudWxsLiAqL1xuICBnZXRTZWxlY3Rpb24oKTogeyBmaWxlOiBzdHJpbmc7IGNvbnRlbnQ6IHN0cmluZyB9IHwgbnVsbCB7XG4gICAgLy8gQHRzLWlnbm9yZSBcdTIwMTQgTWFya2Rvd25WaWV3IGV4cG9zZXMgLmVkaXRvclxuICAgIGNvbnN0IGVkaXRvciA9IHRoaXMuYXBwLndvcmtzcGFjZS5hY3RpdmVMZWFmPy52aWV3Py5lZGl0b3I7XG4gICAgaWYgKCFlZGl0b3IpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IHNlbCA9IGVkaXRvci5nZXRTZWxlY3Rpb24/LigpID8/IFwiXCI7XG4gICAgaWYgKCFzZWwpIHJldHVybiBudWxsO1xuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xuICAgIHJldHVybiB7IGZpbGU6IGZpbGU/LnBhdGggPz8gXCJ1bnRpdGxlZFwiLCBjb250ZW50OiBzZWwgfTtcbiAgfVxuXG4gIC8qKiBGdWxsIGNvbnRlbnQgb2YgdGhlIGFjdGl2ZSBub3RlLCBvciBudWxsLiAqL1xuICBhc3luYyBnZXRDdXJyZW50Tm90ZSgpOiBQcm9taXNlPHsgZmlsZTogc3RyaW5nOyBjb250ZW50OiBzdHJpbmcgfSB8IG51bGw+IHtcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcbiAgICBpZiAoIWZpbGUgfHwgIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBjb250ZW50ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcbiAgICByZXR1cm4geyBmaWxlOiBmaWxlLnBhdGgsIGNvbnRlbnQgfTtcbiAgfVxuXG59XG4iLCAiaW1wb3J0IHsgQXBwLCBURmlsZSB9IGZyb20gXCJvYnNpZGlhblwiO1xyXG5pbXBvcnQgeyBMZWFybmluZ1BvbGljeSB9IGZyb20gXCIuL2NvbnRleHQtdHlwZXNcIjtcclxuXHJcbi8qKlxyXG4gKiBMb2FkcyB2YXVsdC1sZXZlbCBsZWFybmluZyBwb2xpY3kgZnJvbSBBR0VOVFMubWQuXHJcbiAqXHJcbiAqIFRoZSByYXcgZmlsZSBpcyBpbnRlbnRpb25hbGx5IHByZXNlcnZlZCBhcyBwb2xpY3kgdGV4dC4gV2Ugb25seSBwYXJzZSBwb2xpY3lcclxuICogaW50byBzdHJ1Y3R1cmVkIGZpZWxkcyB3aGVuIGFwcGxpY2F0aW9uIGJlaGF2aW9yIHRydWx5IG5lZWRzIHRob3NlIGZpZWxkcy5cclxuICovXHJcbmV4cG9ydCBjbGFzcyBQb2xpY3lMb2FkZXIge1xyXG4gIHByaXZhdGUgY2FjaGVkOlxyXG4gICAgfCB7XHJcbiAgICAgICAgbXRpbWU6IG51bWJlcjtcclxuICAgICAgICBwb2xpY3k6IExlYXJuaW5nUG9saWN5O1xyXG4gICAgICB9XHJcbiAgICB8IHVuZGVmaW5lZDtcclxuXHJcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBhcHA6IEFwcCkge31cclxuXHJcbiAgYXN5bmMgbG9hZCgpOiBQcm9taXNlPExlYXJuaW5nUG9saWN5PiB7XHJcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0RmlsZUJ5UGF0aChcIkFHRU5UUy5tZFwiKTtcclxuXHJcbiAgICBpZiAoIWZpbGUgfHwgIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XHJcbiAgICAgIHRoaXMuY2FjaGVkID0gdW5kZWZpbmVkO1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHBhdGg6IFwiQUdFTlRTLm1kXCIsXHJcbiAgICAgICAgcmF3SW5zdHJ1Y3Rpb25zOiBcIlwiLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGlmICh0aGlzLmNhY2hlZD8ubXRpbWUgPT09IGZpbGUuc3RhdC5tdGltZSkge1xyXG4gICAgICByZXR1cm4gdGhpcy5jYWNoZWQucG9saWN5O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHBvbGljeTogTGVhcm5pbmdQb2xpY3kgPSB7XHJcbiAgICAgIHBhdGg6IGZpbGUucGF0aCxcclxuICAgICAgcmF3SW5zdHJ1Y3Rpb25zOiBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpLFxyXG4gICAgfTtcclxuXHJcbiAgICB0aGlzLmNhY2hlZCA9IHtcclxuICAgICAgbXRpbWU6IGZpbGUuc3RhdC5tdGltZSxcclxuICAgICAgcG9saWN5LFxyXG4gICAgfTtcclxuXHJcbiAgICByZXR1cm4gcG9saWN5O1xyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgTGVhcm5pbmdBY3Rpb25LaW5kIH0gZnJvbSBcIi4vbGVhcm5pbmctdHlwZXNcIjtcclxuXHJcbmNvbnN0IEJBU0VfSU5TVFJVQ1RJT04gPSBgXHJcbllvdSBhcmUgdGhlIGxlYXJuaW5nIGFnZW50IGluc2lkZSBhbiBPYnNpZGlhbiB2YXVsdC5cclxuXHJcbkltcG9ydGFudCBlbnZpcm9ubWVudCBydWxlczpcclxuLSBDb250ZXh0IGJsb2NrcyBhbHJlYWR5IGlkZW50aWZ5IHRoZSBhY3RpdmUgbm90ZSwgc2VsZWN0aW9uLCBwb2xpY3ksIGFuZCBsZWFybmluZy1zdGF0ZSBmaWxlcy5cclxuLSBEbyBub3QgYXNrIHRoZSB1c2VyIGZvciBhIHBhdGggdGhhdCBpcyBhbHJlYWR5IHByZXNlbnQgaW4gY29udGV4dC5cclxuLSBUcmVhdCBBR0VOVFMubWQgY29udGV4dCBhcyB0aGUgdmF1bHQtbGV2ZWwgbGVhcm5pbmcgcG9saWN5LlxyXG4tIFRyZWF0IExlYXJuaW5nIE9TIHByb2dyZXNzIGNvbnRleHQgYXMgZXZpZGVuY2UtYmFja2VkIHN0YXRlLCBub3QgYXMgaW5mYWxsaWJsZSB0cnV0aC5cclxuLSBTdGF5IGZvY3VzZWQgb24gdGhlIHVzZXIncyBjdXJyZW50IGxlYXJuaW5nIGdvYWwgYW5kIG1hdGVyaWFsLlxyXG5gLnRyaW0oKTtcclxuXHJcbmNvbnN0IEFDVElPTl9JTlNUUlVDVElPTlM6IFJlY29yZDxFeGNsdWRlPExlYXJuaW5nQWN0aW9uS2luZCwgXCJwcmFjdGljZVwiPiwgc3RyaW5nPiA9IHtcclxuICBhc2s6IGBcclxuQW5zd2VyIHRoZSByZXF1ZXN0IGRpcmVjdGx5IHVzaW5nIHRoZSBzdXBwbGllZCBsZWFybmluZyBjb250ZXh0LlxyXG5QcmVmZXIgdGhlIHNtYWxsZXN0IHVzZWZ1bCBtZW50YWwgbW9kZWwgYW5kIGltcG9ydGFudCByZWxhdGlvbnNoaXBzLlxyXG5gLnRyaW0oKSxcclxuXHJcbiAgZXhwbGFpbjogYFxyXG5FeHBsYWluIHRoZSBzZWxlY3RlZCBvciBjdXJyZW50IGNvbmNlcHQgZm9yIGxlYXJuaW5nLlxyXG5Qcmlvcml0aXplOlxyXG4tIHRoZSBjb3JyZWN0IG1lbnRhbCBtb2RlbCxcclxuLSBpbXBvcnRhbnQgY2F1c2UvZWZmZWN0IG9yIGRlcGVuZGVuY3kgcmVsYXRpb25zaGlwcyxcclxuLSBvbmUgY29uY3JldGUgZXhhbXBsZSxcclxuLSBubyB1bm5lY2Vzc2FyeSBicmVhZHRoLlxyXG5FbmQgb25seSB3aGVuIHRoZSB1c2VyIGhhcyBlbm91Z2ggdW5kZXJzdGFuZGluZyB0byBjb250aW51ZS5cclxuYC50cmltKCksXHJcblxyXG4gIHJldmlldzogYFxyXG5SZXZpZXcgdGhlIHN1cHBsaWVkIGxlYXJuaW5nIG1hdGVyaWFsLlxyXG5Mb29rIG9ubHkgZm9yIGlzc3VlcyB0aGF0IG1hdGVyaWFsbHkgYWZmZWN0IHVuZGVyc3RhbmRpbmc6XHJcbi0gZmFjdHVhbCBlcnJvcnMsXHJcbi0gbWlzY29uY2VwdGlvbnMsXHJcbi0gbWlzc2luZyBwcmVyZXF1aXNpdGUgcmVsYXRpb25zaGlwcyxcclxuLSB3ZWFrIG9yIG1pc2xlYWRpbmcgZXhwbGFuYXRpb25zLlxyXG5FeHBsYWluIGVhY2ggY29uY3JldGUgZ2FwIGFuZCBhdm9pZCBjb3NtZXRpYyByZXdyaXRpbmcuXHJcbmAudHJpbSgpLFxyXG5cclxuICBlZGl0OiBgXHJcbkhlbHAgaW1wcm92ZSB0aGUgY3VycmVudCBNYXJrZG93biBtYXRlcmlhbC5cclxuRmlyc3QgZXhwbGFpbiB0aGUgaW1wb3J0YW50IGNoYW5nZSBicmllZmx5LlxyXG5XaGVuIGEgY29uY3JldGUgZmlsZSBlZGl0IGlzIGFwcHJvcHJpYXRlLCBlbWl0IGV4YWN0bHkgb25lIGZlbmNlZCBibG9jazpcclxuXHJcblxcYFxcYFxcYGVkaXQtcHJvcG9zYWxcclxue1wiZmlsZVwiOlwiZXhhY3QvcGF0aC9mcm9tL2NvbnRleHQubWRcIixcIm9yaWdpbmFsXCI6XCJ2ZXJiYXRpbSBleGlzdGluZyB0ZXh0XCIsXCJyZXBsYWNlbWVudFwiOlwibmV3IHRleHRcIixcInJlYXNvblwiOlwid2h5XCJ9XHJcblxcYFxcYFxcYFxyXG5cclxuUnVsZXM6XHJcbi0gXCJmaWxlXCIgbXVzdCBleGFjdGx5IG1hdGNoIGEgcGF0aCBzaG93biBpbiBzdXBwbGllZCBjb250ZXh0LlxyXG4tIFwib3JpZ2luYWxcIiBtdXN0IGJlIGNvcGllZCB2ZXJiYXRpbSBmcm9tIHN1cHBsaWVkIGNvbnRleHQuXHJcbi0gTmV2ZXIgY2xhaW0gYSBmaWxlIHdhcyBjaGFuZ2VkOyB0aGUgcGx1Z2luIGFwcGxpZXMgcHJvcG9zYWxzIG9ubHkgYWZ0ZXIgYXBwcm92YWwuXHJcbmAudHJpbSgpLFxyXG59O1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQWN0aW9uSW5zdHJ1Y3Rpb24oXHJcbiAgYWN0aW9uOiBFeGNsdWRlPExlYXJuaW5nQWN0aW9uS2luZCwgXCJwcmFjdGljZVwiPixcclxuKTogc3RyaW5nIHtcclxuICByZXR1cm4gYCR7QkFTRV9JTlNUUlVDVElPTn1cXG5cXG5MZWFybmluZyBtb2RlOiAke2FjdGlvbn1cXG5cXG4ke0FDVElPTl9JTlNUUlVDVElPTlNbYWN0aW9uXX1gO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRQcmFjdGljZVF1ZXN0aW9uSW5zdHJ1Y3Rpb24oXHJcbiAgdXNlclJlcXVlc3Q6IHN0cmluZyxcclxuKTogc3RyaW5nIHtcclxuICByZXR1cm4gYFxyXG4ke0JBU0VfSU5TVFJVQ1RJT059XHJcblxyXG5MZWFybmluZyBtb2RlOiBwcmFjdGljZVxyXG5cclxuR2VuZXJhdGUgZXhhY3RseSBvbmUgYWN0aXZlLXJlY2FsbCBxdWVzdGlvbiBncm91bmRlZCBpbiB0aGUgc3VwcGxpZWQgY29udGV4dC5cclxuRG8gbm90IHJldmVhbCB0aGUgYW5zd2VyLiBDaG9vc2UgYSBxdWVzdGlvbiB0aGF0IHRlc3RzIGFuIGltcG9ydGFudCByZWxhdGlvbnNoaXAsXHJcbm1lY2hhbmlzbSwgZGVwZW5kZW5jeSwgb3IgYXBwbGljYXRpb24gcmF0aGVyIHRoYW4gdHJpdmlhLlxyXG5cclxuRW1pdCB0aGUgcXVlc3Rpb24gYXMgZXhhY3RseSBvbmUgZmVuY2VkIGJsb2NrOlxyXG5cclxuXFxgXFxgXFxgbGVhcm5pbmctcHJhY3RpY2Vcclxue1wia2luZFwiOlwicXVlc3Rpb25cIixcImNvbmNlcHRcIjpcInNwZWNpZmljIGNvbmNlcHRcIixcInF1ZXN0aW9uXCI6XCJvbmUgcXVlc3Rpb25cIixcImhpbnRcIjpcIm9wdGlvbmFsIHNob3J0IGhpbnRcIn1cclxuXFxgXFxgXFxgXHJcblxyXG5Vc2VyIHJlcXVlc3Q6XHJcbiR7dXNlclJlcXVlc3R9XHJcbmAudHJpbSgpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRQcmFjdGljZUV2YWx1YXRpb25JbnN0cnVjdGlvbihpbnB1dDoge1xyXG4gIHF1ZXN0aW9uOiBzdHJpbmc7XHJcbiAgYW5zd2VyOiBzdHJpbmc7XHJcbiAgY29uY2VwdD86IHN0cmluZztcclxufSk6IHN0cmluZyB7XHJcbiAgcmV0dXJuIGBcclxuJHtCQVNFX0lOU1RSVUNUSU9OfVxyXG5cclxuTGVhcm5pbmcgbW9kZTogcHJhY3RpY2UgZXZhbHVhdGlvblxyXG5cclxuRXZhbHVhdGUgdGhlIHVzZXIncyBhbnN3ZXIgdG8gdGhlIGFjdGl2ZSBwcmFjdGljZSBxdWVzdGlvbi5cclxuXHJcblF1ZXN0aW9uOlxyXG4ke2lucHV0LnF1ZXN0aW9ufVxyXG5cclxuQ29uY2VwdDpcclxuJHtpbnB1dC5jb25jZXB0ID8/IFwiaW5mZXIgZnJvbSB0aGUgcXVlc3Rpb24gYW5kIHN1cHBsaWVkIGNvbnRleHRcIn1cclxuXHJcblVzZXIgYW5zd2VyOlxyXG4ke2lucHV0LmFuc3dlcn1cclxuXHJcbkV2YWx1YXRlIHVuZGVyc3RhbmRpbmcsIG5vdCB3cml0aW5nIHN0eWxlLlxyXG5Vc2UgXCJjb3JyZWN0XCIgb25seSB3aGVuIHRoZSBjb3JlIG1lbnRhbCBtb2RlbCBpcyBjb3JyZWN0LlxyXG5Vc2UgXCJwYXJ0aWFsXCIgd2hlbiB0aGUgaW1wb3J0YW50IGRpcmVjdGlvbiBpcyByaWdodCBidXQgYSBtYXRlcmlhbCByZWxhdGlvbnNoaXBcclxub3IgbWVjaGFuaXNtIGlzIG1pc3NpbmcuXHJcblVzZSBcImluY29ycmVjdFwiIHdoZW4gdGhlIGNvcmUgbW9kZWwgaXMgd3JvbmcuXHJcblxyXG5SZXR1cm4gZXhhY3RseSBvbmUgZmVuY2VkIGJsb2NrOlxyXG5cclxuXFxgXFxgXFxgbGVhcm5pbmctcHJhY3RpY2Vcclxue1wia2luZFwiOlwiZXZhbHVhdGlvblwiLFwiY29uY2VwdFwiOlwic3BlY2lmaWMgY29uY2VwdFwiLFwib3V0Y29tZVwiOlwiY29ycmVjdHxwYXJ0aWFsfGluY29ycmVjdFwiLFwiZmVlZGJhY2tcIjpcImNvbmNpc2UgZmVlZGJhY2tcIixcIm1pc2NvbmNlcHRpb25zXCI6W1wic3BlY2lmaWMgbWlzY29uY2VwdGlvbiBpZiBhbnlcIl0sXCJuZXh0UXVlc3Rpb25cIjpcIm9wdGlvbmFsIG5leHQgcXVlc3Rpb25cIn1cclxuXFxgXFxgXFxgXHJcblxyXG5JZiBhbm90aGVyIHF1ZXN0aW9uIHdvdWxkIGFkZCB1c2VmdWwgZXZpZGVuY2UsIGluY2x1ZGUgbmV4dFF1ZXN0aW9uLlxyXG5PdGhlcndpc2Ugb21pdCBpdC5cclxuYC50cmltKCk7XHJcbn1cclxuIiwgImltcG9ydCB7IEVkaXRQcm9wb3NhbCB9IGZyb20gXCIuLi90eXBlc1wiO1xyXG5pbXBvcnQge1xyXG4gIFByYWN0aWNlRXZhbHVhdGlvbixcclxuICBQcmFjdGljZVBheWxvYWQsXHJcbiAgUHJhY3RpY2VRdWVzdGlvbixcclxufSBmcm9tIFwiLi9wcmFjdGljZS10eXBlc1wiO1xyXG5cclxuZXhwb3J0IHR5cGUgU3RydWN0dXJlZFN0cmVhbUV2ZW50ID1cclxuICB8IHsgdHlwZTogXCJ0ZXh0XCI7IHRleHQ6IHN0cmluZyB9XHJcbiAgfCB7IHR5cGU6IFwicHJvcG9zYWxcIjsgcHJvcG9zYWw6IEVkaXRQcm9wb3NhbCB9XHJcbiAgfCB7IHR5cGU6IFwicHJhY3RpY2UtcXVlc3Rpb25cIjsgcXVlc3Rpb246IFByYWN0aWNlUXVlc3Rpb24gfVxyXG4gIHwgeyB0eXBlOiBcInByYWN0aWNlLWV2YWx1YXRpb25cIjsgZXZhbHVhdGlvbjogUHJhY3RpY2VFdmFsdWF0aW9uIH1cclxuICB8IHsgdHlwZTogXCJlcnJvclwiOyBtZXNzYWdlOiBzdHJpbmcgfTtcclxuXHJcbnR5cGUgQmxvY2tLaW5kID0gXCJlZGl0LXByb3Bvc2FsXCIgfCBcImxlYXJuaW5nLXByYWN0aWNlXCI7XHJcblxyXG5jb25zdCBTVEFSVF9UQUdTOiBBcnJheTx7XHJcbiAga2luZDogQmxvY2tLaW5kO1xyXG4gIG1hcmtlcjogc3RyaW5nO1xyXG59PiA9IFtcclxuICB7IGtpbmQ6IFwiZWRpdC1wcm9wb3NhbFwiLCBtYXJrZXI6IFwiYGBgZWRpdC1wcm9wb3NhbFwiIH0sXHJcbiAgeyBraW5kOiBcImxlYXJuaW5nLXByYWN0aWNlXCIsIG1hcmtlcjogXCJgYGBsZWFybmluZy1wcmFjdGljZVwiIH0sXHJcbl07XHJcblxyXG5jb25zdCBFTkRfVEFHID0gXCJcXG5gYGBcIjtcclxuY29uc3QgTUFYX01BUktFUl9MRU5HVEggPSBNYXRoLm1heChcclxuICAuLi5TVEFSVF9UQUdTLm1hcCgoaXRlbSkgPT4gaXRlbS5tYXJrZXIubGVuZ3RoKSxcclxuKTtcclxuXHJcbmZ1bmN0aW9uIGlzRWRpdFByb3Bvc2FsKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgRWRpdFByb3Bvc2FsIHtcclxuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlO1xyXG4gIGNvbnN0IG9iaiA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xyXG5cclxuICByZXR1cm4gKFxyXG4gICAgdHlwZW9mIG9iai5maWxlID09PSBcInN0cmluZ1wiICYmXHJcbiAgICB0eXBlb2Ygb2JqLm9yaWdpbmFsID09PSBcInN0cmluZ1wiICYmXHJcbiAgICB0eXBlb2Ygb2JqLnJlcGxhY2VtZW50ID09PSBcInN0cmluZ1wiICYmXHJcbiAgICAob2JqLnJlYXNvbiA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiBvYmoucmVhc29uID09PSBcInN0cmluZ1wiKVxyXG4gICk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzUHJhY3RpY2VQYXlsb2FkKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgUHJhY3RpY2VQYXlsb2FkIHtcclxuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlO1xyXG4gIGNvbnN0IG9iaiA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xyXG5cclxuICBpZiAob2JqLmtpbmQgPT09IFwicXVlc3Rpb25cIikge1xyXG4gICAgcmV0dXJuIChcclxuICAgICAgdHlwZW9mIG9iai5jb25jZXB0ID09PSBcInN0cmluZ1wiICYmXHJcbiAgICAgIHR5cGVvZiBvYmoucXVlc3Rpb24gPT09IFwic3RyaW5nXCIgJiZcclxuICAgICAgKG9iai5oaW50ID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIG9iai5oaW50ID09PSBcInN0cmluZ1wiKVxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIGlmIChvYmoua2luZCA9PT0gXCJldmFsdWF0aW9uXCIpIHtcclxuICAgIHJldHVybiAoXHJcbiAgICAgIHR5cGVvZiBvYmouY29uY2VwdCA9PT0gXCJzdHJpbmdcIiAmJlxyXG4gICAgICAob2JqLm91dGNvbWUgPT09IFwiY29ycmVjdFwiIHx8XHJcbiAgICAgICAgb2JqLm91dGNvbWUgPT09IFwicGFydGlhbFwiIHx8XHJcbiAgICAgICAgb2JqLm91dGNvbWUgPT09IFwiaW5jb3JyZWN0XCIpICYmXHJcbiAgICAgIHR5cGVvZiBvYmouZmVlZGJhY2sgPT09IFwic3RyaW5nXCIgJiZcclxuICAgICAgQXJyYXkuaXNBcnJheShvYmoubWlzY29uY2VwdGlvbnMpICYmXHJcbiAgICAgIG9iai5taXNjb25jZXB0aW9ucy5ldmVyeSgoaXRlbSkgPT4gdHlwZW9mIGl0ZW0gPT09IFwic3RyaW5nXCIpICYmXHJcbiAgICAgIChvYmoubmV4dFF1ZXN0aW9uID09PSB1bmRlZmluZWQgfHxcclxuICAgICAgICB0eXBlb2Ygb2JqLm5leHRRdWVzdGlvbiA9PT0gXCJzdHJpbmdcIilcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gZmFsc2U7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGZpbmRTdGFydChidWZmZXI6IHN0cmluZyk6XHJcbiAgfCB7IGtpbmQ6IEJsb2NrS2luZDsgbWFya2VyOiBzdHJpbmc7IGluZGV4OiBudW1iZXIgfVxyXG4gIHwgdW5kZWZpbmVkIHtcclxuICBsZXQgYmVzdDpcclxuICAgIHwgeyBraW5kOiBCbG9ja0tpbmQ7IG1hcmtlcjogc3RyaW5nOyBpbmRleDogbnVtYmVyIH1cclxuICAgIHwgdW5kZWZpbmVkO1xyXG5cclxuICBmb3IgKGNvbnN0IGNhbmRpZGF0ZSBvZiBTVEFSVF9UQUdTKSB7XHJcbiAgICBjb25zdCBpbmRleCA9IGJ1ZmZlci5pbmRleE9mKGNhbmRpZGF0ZS5tYXJrZXIpO1xyXG4gICAgaWYgKGluZGV4IDwgMCkgY29udGludWU7XHJcblxyXG4gICAgaWYgKCFiZXN0IHx8IGluZGV4IDwgYmVzdC5pbmRleCkge1xyXG4gICAgICBiZXN0ID0ge1xyXG4gICAgICAgIC4uLmNhbmRpZGF0ZSxcclxuICAgICAgICBpbmRleCxcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHJldHVybiBiZXN0O1xyXG59XHJcblxyXG4vKipcclxuICogSW5jcmVtZW50YWwgcGFyc2VyIGZvciB0aGUgc21hbGwgc3RydWN0dXJlZCBwcm90b2NvbCBlbWJlZGRlZCBpbiBzdHJlYW1lZFxyXG4gKiBtb2RlbCB0ZXh0LiBVSSBjb2RlIG9ubHkgcmVjZWl2ZXMgbm9ybWFsaXplZCBldmVudHMuXHJcbiAqL1xyXG5leHBvcnQgY2xhc3MgU3RydWN0dXJlZFN0cmVhbVBhcnNlciB7XHJcbiAgcHJpdmF0ZSBidWZmZXIgPSBcIlwiO1xyXG4gIHByaXZhdGUgbW9kZTogXCJ0ZXh0XCIgfCBCbG9ja0tpbmQgPSBcInRleHRcIjtcclxuXHJcbiAgcHVzaChjaHVuazogc3RyaW5nKTogU3RydWN0dXJlZFN0cmVhbUV2ZW50W10ge1xyXG4gICAgdGhpcy5idWZmZXIgKz0gY2h1bms7XHJcbiAgICByZXR1cm4gdGhpcy5kcmFpbihmYWxzZSk7XHJcbiAgfVxyXG5cclxuICBmaW5pc2goKTogU3RydWN0dXJlZFN0cmVhbUV2ZW50W10ge1xyXG4gICAgcmV0dXJuIHRoaXMuZHJhaW4odHJ1ZSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGRyYWluKGZpbmFsOiBib29sZWFuKTogU3RydWN0dXJlZFN0cmVhbUV2ZW50W10ge1xyXG4gICAgY29uc3QgZXZlbnRzOiBTdHJ1Y3R1cmVkU3RyZWFtRXZlbnRbXSA9IFtdO1xyXG5cclxuICAgIHdoaWxlICh0aGlzLmJ1ZmZlci5sZW5ndGggPiAwKSB7XHJcbiAgICAgIGlmICh0aGlzLm1vZGUgPT09IFwidGV4dFwiKSB7XHJcbiAgICAgICAgY29uc3Qgc3RhcnQgPSBmaW5kU3RhcnQodGhpcy5idWZmZXIpO1xyXG5cclxuICAgICAgICBpZiAoc3RhcnQpIHtcclxuICAgICAgICAgIGNvbnN0IHZpc2libGUgPSB0aGlzLmJ1ZmZlci5zbGljZSgwLCBzdGFydC5pbmRleCk7XHJcbiAgICAgICAgICBpZiAodmlzaWJsZSkge1xyXG4gICAgICAgICAgICBldmVudHMucHVzaCh7XHJcbiAgICAgICAgICAgICAgdHlwZTogXCJ0ZXh0XCIsXHJcbiAgICAgICAgICAgICAgdGV4dDogdmlzaWJsZSxcclxuICAgICAgICAgICAgfSk7XHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgdGhpcy5idWZmZXIgPSB0aGlzLmJ1ZmZlci5zbGljZShcclxuICAgICAgICAgICAgc3RhcnQuaW5kZXggKyBzdGFydC5tYXJrZXIubGVuZ3RoLFxyXG4gICAgICAgICAgKTtcclxuICAgICAgICAgIHRoaXMubW9kZSA9IHN0YXJ0LmtpbmQ7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChmaW5hbCkge1xyXG4gICAgICAgICAgZXZlbnRzLnB1c2goe1xyXG4gICAgICAgICAgICB0eXBlOiBcInRleHRcIixcclxuICAgICAgICAgICAgdGV4dDogdGhpcy5idWZmZXIsXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIHRoaXMuYnVmZmVyID0gXCJcIjtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3Qga2VlcCA9IE1hdGgubWluKFxyXG4gICAgICAgICAgTUFYX01BUktFUl9MRU5HVEggLSAxLFxyXG4gICAgICAgICAgdGhpcy5idWZmZXIubGVuZ3RoLFxyXG4gICAgICAgICk7XHJcbiAgICAgICAgY29uc3QgZW1pdExlbmd0aCA9IHRoaXMuYnVmZmVyLmxlbmd0aCAtIGtlZXA7XHJcblxyXG4gICAgICAgIGlmIChlbWl0TGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgZXZlbnRzLnB1c2goe1xyXG4gICAgICAgICAgICB0eXBlOiBcInRleHRcIixcclxuICAgICAgICAgICAgdGV4dDogdGhpcy5idWZmZXIuc2xpY2UoMCwgZW1pdExlbmd0aCksXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIHRoaXMuYnVmZmVyID0gdGhpcy5idWZmZXIuc2xpY2UoZW1pdExlbmd0aCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGJyZWFrO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCBlbmQgPSB0aGlzLmJ1ZmZlci5pbmRleE9mKEVORF9UQUcpO1xyXG5cclxuICAgICAgaWYgKGVuZCA8IDApIHtcclxuICAgICAgICBpZiAoZmluYWwpIHtcclxuICAgICAgICAgIGV2ZW50cy5wdXNoKHtcclxuICAgICAgICAgICAgdHlwZTogXCJlcnJvclwiLFxyXG4gICAgICAgICAgICBtZXNzYWdlOiBgSW5jb21wbGV0ZSAke3RoaXMubW9kZX0gYmxvY2sgcmV0dXJuZWQgYnkgdGhlIGFnZW50LmAsXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIHRoaXMuYnVmZmVyID0gXCJcIjtcclxuICAgICAgICAgIHRoaXMubW9kZSA9IFwidGV4dFwiO1xyXG4gICAgICAgIH1cclxuICAgICAgICBicmVhaztcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgcmF3ID0gdGhpcy5idWZmZXIuc2xpY2UoMCwgZW5kKS50cmltKCk7XHJcbiAgICAgIGNvbnN0IGJsb2NrS2luZCA9IHRoaXMubW9kZTtcclxuXHJcbiAgICAgIHRoaXMuYnVmZmVyID0gdGhpcy5idWZmZXIuc2xpY2UoZW5kICsgRU5EX1RBRy5sZW5ndGgpO1xyXG4gICAgICB0aGlzLm1vZGUgPSBcInRleHRcIjtcclxuXHJcbiAgICAgIGxldCBwYXJzZWQ6IHVua25vd247XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpO1xyXG4gICAgICB9IGNhdGNoIHtcclxuICAgICAgICBldmVudHMucHVzaCh7XHJcbiAgICAgICAgICB0eXBlOiBcImVycm9yXCIsXHJcbiAgICAgICAgICBtZXNzYWdlOiBgQ291bGQgbm90IHBhcnNlICR7YmxvY2tLaW5kfSByZXR1cm5lZCBieSB0aGUgYWdlbnQuYCxcclxuICAgICAgICB9KTtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKGJsb2NrS2luZCA9PT0gXCJlZGl0LXByb3Bvc2FsXCIpIHtcclxuICAgICAgICBpZiAoIWlzRWRpdFByb3Bvc2FsKHBhcnNlZCkpIHtcclxuICAgICAgICAgIGV2ZW50cy5wdXNoKHtcclxuICAgICAgICAgICAgdHlwZTogXCJlcnJvclwiLFxyXG4gICAgICAgICAgICBtZXNzYWdlOiBcIkFnZW50IHJldHVybmVkIGFuIGludmFsaWQgZWRpdCBwcm9wb3NhbC5cIixcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBldmVudHMucHVzaCh7XHJcbiAgICAgICAgICB0eXBlOiBcInByb3Bvc2FsXCIsXHJcbiAgICAgICAgICBwcm9wb3NhbDogcGFyc2VkLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAoIWlzUHJhY3RpY2VQYXlsb2FkKHBhcnNlZCkpIHtcclxuICAgICAgICBldmVudHMucHVzaCh7XHJcbiAgICAgICAgICB0eXBlOiBcImVycm9yXCIsXHJcbiAgICAgICAgICBtZXNzYWdlOiBcIkFnZW50IHJldHVybmVkIGFuIGludmFsaWQgcHJhY3RpY2UgcGF5bG9hZC5cIixcclxuICAgICAgICB9KTtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKHBhcnNlZC5raW5kID09PSBcInF1ZXN0aW9uXCIpIHtcclxuICAgICAgICBldmVudHMucHVzaCh7XHJcbiAgICAgICAgICB0eXBlOiBcInByYWN0aWNlLXF1ZXN0aW9uXCIsXHJcbiAgICAgICAgICBxdWVzdGlvbjogcGFyc2VkLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGV2ZW50cy5wdXNoKHtcclxuICAgICAgICAgIHR5cGU6IFwicHJhY3RpY2UtZXZhbHVhdGlvblwiLFxyXG4gICAgICAgICAgZXZhbHVhdGlvbjogcGFyc2VkLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGV2ZW50cztcclxuICB9XHJcbn1cclxuIiwgImltcG9ydCB7XHJcbiAgQWdlbnRDb250ZXh0LFxuICBBZ2VudEZhaWx1cmUsXG4gIEFnZW50SGVhbHRoLFxuICBBcHBseVJlc3VsdCxcclxuICBBZ2VudE1vZGVsLFxuICBDaGF0U2Vzc2lvbixcclxuICBFZGl0UHJvcG9zYWwsXHJcbn0gZnJvbSBcIi4uL3R5cGVzXCI7XHJcbmltcG9ydCB7IENvbnRleHRSZXNvbHZlciB9IGZyb20gXCIuLi9jb250ZXh0L0NvbnRleHRSZXNvbHZlclwiO1xyXG5pbXBvcnQge1xuICBMZWFybmluZ0NvbnRleHQsXG4gIFR1cm5Db250ZXh0U25hcHNob3QsXG59IGZyb20gXCIuLi9jb250ZXh0L2NvbnRleHQtdHlwZXNcIjtcbmltcG9ydCB7IFBvbGljeUxvYWRlciB9IGZyb20gXCIuLi9jb250ZXh0L1BvbGljeUxvYWRlclwiO1xyXG5pbXBvcnQgeyBNdXRhdGlvblNlcnZpY2UgfSBmcm9tIFwiLi4vbXV0YXRpb24vTXV0YXRpb25TZXJ2aWNlXCI7XHJcbmltcG9ydCB7IFZhdWx0TGVhcm5pbmdTdG9yZSB9IGZyb20gXCIuLi9wZXJzaXN0ZW5jZS9WYXVsdExlYXJuaW5nU3RvcmVcIjtcclxuaW1wb3J0IHsgU2Vzc2lvbkNvbnRyb2xsZXIgfSBmcm9tIFwiLi4vc2Vzc2lvbi9TZXNzaW9uQ29udHJvbGxlclwiO1xyXG5pbXBvcnQge1xyXG4gIGJ1aWxkQWN0aW9uSW5zdHJ1Y3Rpb24sXHJcbiAgYnVpbGRQcmFjdGljZUV2YWx1YXRpb25JbnN0cnVjdGlvbixcclxuICBidWlsZFByYWN0aWNlUXVlc3Rpb25JbnN0cnVjdGlvbixcclxufSBmcm9tIFwiLi9hY3Rpb24tYnVpbGRlcnNcIjtcclxuaW1wb3J0IHtcbiAgTGVhcm5pbmdFdmVudCxcbiAgTGVhcm5pbmdSZXF1ZXN0LFxuICBQcm9wb3NlZEVkaXQsXG59IGZyb20gXCIuL2xlYXJuaW5nLXR5cGVzXCI7XG5pbXBvcnQge1xyXG4gIFByYWN0aWNlRXZhbHVhdGlvbixcclxuICBQcmFjdGljZVF1ZXN0aW9uLFxyXG4gIFByYWN0aWNlU2Vzc2lvbixcclxufSBmcm9tIFwiLi9wcmFjdGljZS10eXBlc1wiO1xyXG5pbXBvcnQge1xyXG4gIFN0cnVjdHVyZWRTdHJlYW1FdmVudCxcclxuICBTdHJ1Y3R1cmVkU3RyZWFtUGFyc2VyLFxyXG59IGZyb20gXCIuL1N0cnVjdHVyZWRTdHJlYW1QYXJzZXJcIjtcclxuXHJcbi8qKlxyXG4gKiBBcHBsaWNhdGlvbiBib3VuZGFyeSBmb3IgdGhlIExlYXJuaW5nIE9TLlxyXG4gKlxyXG4gKiBUaGUgdmlldyBzZW5kcyB1c2VyIGludGVudCBoZXJlLiBUaGlzIGNvbnRyb2xsZXIgb3ducyBvcmNoZXN0cmF0aW9uOlxyXG4gKiBjb250ZXh0IC0+IHBvbGljeSAtPiBsZWFybmluZyBzdGF0ZSAtPiBhY3Rpb24gLT4gYWdlbnQgc2Vzc2lvbiAtPiBub3JtYWxpemVkXHJcbiAqIFVJIGV2ZW50cy4gSXQgZGVsaWJlcmF0ZWx5IGhpZGVzIHByb3ZpZGVyIHRyYW5zcG9ydCBkZXRhaWxzIGZyb20gdGhlIFVJLlxuICovXHJcbmV4cG9ydCBjbGFzcyBMZWFybmluZ0NvbnRyb2xsZXIge1xuICBwcml2YXRlIHByYWN0aWNlU2Vzc2lvbjogUHJhY3RpY2VTZXNzaW9uIHwgbnVsbCA9IG51bGw7XG4gIHByaXZhdGUgYWN0aXZlVHVybjoge1xuICAgIGNvbnRyb2xsZXI6IEFib3J0Q29udHJvbGxlcjtcbiAgICBjYW5jZWxSZWFzb24/OiBcInVzZXJcIiB8IFwidGltZW91dFwiIHwgXCJkaXNwb3NlXCI7XG4gIH0gfCBudWxsID0gbnVsbDtcbiAgcHJpdmF0ZSByZWFkb25seSBwZW5kaW5nUHJvcG9zYWxzID0gbmV3IE1hcDxcbiAgICBzdHJpbmcsXG4gICAgeyBwcm9wb3NhbDogRWRpdFByb3Bvc2FsOyBhbGxvd2VkRmlsZXM6IHJlYWRvbmx5IHN0cmluZ1tdIH1cbiAgPigpO1xuXHJcbiAgY29uc3RydWN0b3IoXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IHNlc3Npb25zOiBTZXNzaW9uQ29udHJvbGxlcixcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgY29udGV4dHM6IENvbnRleHRSZXNvbHZlcixcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgcG9saWNpZXM6IFBvbGljeUxvYWRlcixcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgbXV0YXRpb25zOiBNdXRhdGlvblNlcnZpY2UsXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IGxlYXJuaW5nU3RhdGU6IFZhdWx0TGVhcm5pbmdTdG9yZSxcclxuICApIHt9XHJcblxyXG4gIGNoZWNrUnVudGltZSgpOiBQcm9taXNlPEFnZW50SGVhbHRoPiB7XG4gICAgcmV0dXJuIHRoaXMuc2Vzc2lvbnMuY2hlY2tSdW50aW1lKCk7XG4gIH1cclxuXHJcbiAgZ2V0U2Vzc2lvbigpOiBDaGF0U2Vzc2lvbiB7XHJcbiAgICByZXR1cm4gdGhpcy5zZXNzaW9ucy5nZXRTZXNzaW9uKCk7XHJcbiAgfVxyXG5cclxuICBnZXRNb2RlbHMoKTogQWdlbnRNb2RlbFtdIHtcbiAgICByZXR1cm4gdGhpcy5zZXNzaW9ucy5nZXRNb2RlbHMoKTtcclxuICB9XHJcblxyXG4gIHNldE1vZGVsKG1vZGVsSWQ/OiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLnNlc3Npb25zLnNldE1vZGVsKG1vZGVsSWQpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgbmV3U2Vzc2lvbigpOiBQcm9taXNlPENoYXRTZXNzaW9uPiB7XHJcbiAgICB0aGlzLnByYWN0aWNlU2Vzc2lvbiA9IG51bGw7XHJcbiAgICByZXR1cm4gdGhpcy5zZXNzaW9ucy5uZXdTZXNzaW9uKCk7XHJcbiAgfVxyXG5cclxuICBhc3luYyByZXNvbHZlQ29udGV4dChcclxuICAgIGV4cGxpY2l0Q29udGV4dDogQWdlbnRDb250ZXh0W10gPSBbXSxcclxuICApOiBQcm9taXNlPExlYXJuaW5nQ29udGV4dD4ge1xyXG4gICAgcmV0dXJuIHRoaXMuY29udGV4dHMucmVzb2x2ZShleHBsaWNpdENvbnRleHQpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgKnJ1bihyZXF1ZXN0OiBMZWFybmluZ1JlcXVlc3QpOiBBc3luY0l0ZXJhYmxlPExlYXJuaW5nRXZlbnQ+IHtcbiAgICBpZiAodGhpcy5hY3RpdmVUdXJuKSB7XG4gICAgICB5aWVsZCB7XG4gICAgICAgIHR5cGU6IFwiZmFpbGVkXCIsXG4gICAgICAgIGZhaWx1cmU6IHsgY29kZTogXCJidXN5XCIsIG1lc3NhZ2U6IFwiQW5vdGhlciBGb3JnZSB0dXJuIGlzIHN0aWxsIHJ1bm5pbmcuXCIgfSxcbiAgICAgIH07XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgY29uc3QgY29udGV4dCA9IGF3YWl0IHRoaXMuY29udGV4dHMucmVzb2x2ZShyZXF1ZXN0LmV4cGxpY2l0Q29udGV4dCk7XG4gICAgY29uc3QgW3BvbGljeSwgc3RhdGVdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xuICAgICAgdGhpcy5wb2xpY2llcy5sb2FkKCksXHJcbiAgICAgIHRoaXMubGVhcm5pbmdTdGF0ZS5sb2FkKCksXHJcbiAgICBdKTtcclxuXHJcbiAgICBjb25zdCB2aXNpYmxlID0gdGhpcy5jb250ZXh0cy50b0FnZW50Q29udGV4dChjb250ZXh0KTtcbiAgICBjb25zdCBzeXN0ZW06IEFnZW50Q29udGV4dFtdID0gW107XG5cclxuICAgIGlmIChwb2xpY3kucmF3SW5zdHJ1Y3Rpb25zKSB7XHJcbiAgICAgIGNvbnN0IGFscmVhZHlJbmNsdWRlZCA9IHZpc2libGUuc29tZShcbiAgICAgICAgKGl0ZW0pID0+IGl0ZW0udHlwZSA9PT0gXCJub3RlXCIgJiYgaXRlbS5maWxlID09PSBwb2xpY3kucGF0aCxcclxuICAgICAgKTtcclxuXHJcbiAgICAgIGlmICghYWxyZWFkeUluY2x1ZGVkKSB7XHJcbiAgICAgICAgc3lzdGVtLnB1c2goe1xuICAgICAgICAgIHR5cGU6IFwibm90ZVwiLFxyXG4gICAgICAgICAgZmlsZTogcG9saWN5LnBhdGgsXHJcbiAgICAgICAgICBjb250ZW50OiBwb2xpY3kucmF3SW5zdHJ1Y3Rpb25zLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgc3lzdGVtLnB1c2goe1xuICAgICAgdHlwZTogXCJub3RlXCIsXHJcbiAgICAgIGZpbGU6IFwiMDAtbGVhcm5pbmctb3MvcHJvZ3Jlc3MuanNvblwiLFxyXG4gICAgICBjb250ZW50OiBKU09OLnN0cmluZ2lmeShzdGF0ZSwgbnVsbCwgMiksXG4gICAgfSk7XG5cbiAgICBjb25zdCBzbmFwc2hvdDogVHVybkNvbnRleHRTbmFwc2hvdCA9IHtcbiAgICAgIHJlc29sdmVkOiBjb250ZXh0LFxuICAgICAgdmlzaWJsZSxcbiAgICAgIHN5c3RlbSxcbiAgICAgIGFsbG93ZWRNdXRhdGlvbkZpbGVzOiBBcnJheS5mcm9tKFxuICAgICAgICBuZXcgU2V0KFxuICAgICAgICAgIHZpc2libGVcbiAgICAgICAgICAgIC5maWx0ZXIoKGl0ZW0pID0+ICFpdGVtLmZpbGUuc3RhcnRzV2l0aChcImF0dGFjaG1lbnQvXCIpKVxuICAgICAgICAgICAgLm1hcCgoaXRlbSkgPT4gaXRlbS5maWxlKSxcbiAgICAgICAgKSxcbiAgICAgICksXG4gICAgfTtcbiAgICB5aWVsZCB7IHR5cGU6IFwiY29udGV4dC1yZWFkeVwiLCBjb250ZXh0OiBzbmFwc2hvdCB9O1xuXHJcbiAgICBsZXQgcHJlcGFyZWRQcm9tcHQ6IHN0cmluZztcclxuXHJcbiAgICBpZiAocmVxdWVzdC5hY3Rpb24gPT09IFwicHJhY3RpY2VcIikge1xyXG4gICAgICBjb25zdCBhY3RpdmVQcmFjdGljZSA9IHRoaXMucHJhY3RpY2VTZXNzaW9uO1xyXG5cclxuICAgICAgaWYgKFxyXG4gICAgICAgIGFjdGl2ZVByYWN0aWNlPy5zdGF0ZSA9PT0gXCJ3YWl0aW5nLWFuc3dlclwiICYmXHJcbiAgICAgICAgYWN0aXZlUHJhY3RpY2UuY3VycmVudFF1ZXN0aW9uXHJcbiAgICAgICkge1xyXG4gICAgICAgIGFjdGl2ZVByYWN0aWNlLnN0YXRlID0gXCJldmFsdWF0aW5nXCI7XHJcbiAgICAgICAgcHJlcGFyZWRQcm9tcHQgPSBidWlsZFByYWN0aWNlRXZhbHVhdGlvbkluc3RydWN0aW9uKHtcclxuICAgICAgICAgIHF1ZXN0aW9uOiBhY3RpdmVQcmFjdGljZS5jdXJyZW50UXVlc3Rpb24sXHJcbiAgICAgICAgICBhbnN3ZXI6IHJlcXVlc3QucHJvbXB0LFxyXG4gICAgICAgICAgY29uY2VwdDogYWN0aXZlUHJhY3RpY2UuY29uY2VwdCxcclxuICAgICAgICB9KTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICB0aGlzLnByYWN0aWNlU2Vzc2lvbiA9IHtcclxuICAgICAgICAgIGlkOiBjcnlwdG8ucmFuZG9tVVVJRCgpLFxyXG4gICAgICAgICAgc3RhdGU6IFwiZ2VuZXJhdGluZ1wiLFxyXG4gICAgICAgICAgdHVybnM6IFtdLFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIHByZXBhcmVkUHJvbXB0ID0gYnVpbGRQcmFjdGljZVF1ZXN0aW9uSW5zdHJ1Y3Rpb24oXHJcbiAgICAgICAgICByZXF1ZXN0LnByb21wdCxcclxuICAgICAgICApO1xyXG4gICAgICB9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICB0aGlzLnByYWN0aWNlU2Vzc2lvbiA9IG51bGw7XHJcbiAgICAgIGNvbnN0IGluc3RydWN0aW9uID0gYnVpbGRBY3Rpb25JbnN0cnVjdGlvbihyZXF1ZXN0LmFjdGlvbik7XHJcbiAgICAgIHByZXBhcmVkUHJvbXB0ID1cclxuICAgICAgICBgJHtpbnN0cnVjdGlvbn1cXG5cXG5Vc2VyIHJlcXVlc3Q6XFxuJHtyZXF1ZXN0LnByb21wdH1gO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHBhcnNlciA9IG5ldyBTdHJ1Y3R1cmVkU3RyZWFtUGFyc2VyKCk7XG4gICAgY29uc3QgY29udHJvbGxlciA9IG5ldyBBYm9ydENvbnRyb2xsZXIoKTtcbiAgICBjb25zdCBhY3RpdmVUdXJuID0geyBjb250cm9sbGVyIH0gYXMge1xuICAgICAgY29udHJvbGxlcjogQWJvcnRDb250cm9sbGVyO1xuICAgICAgY2FuY2VsUmVhc29uPzogXCJ1c2VyXCIgfCBcInRpbWVvdXRcIiB8IFwiZGlzcG9zZVwiO1xuICAgIH07XG4gICAgdGhpcy5hY3RpdmVUdXJuID0gYWN0aXZlVHVybjtcbiAgICBjb25zdCB0aW1lb3V0ID0gc2V0VGltZW91dCgoKSA9PiB7XG4gICAgICBhY3RpdmVUdXJuLmNhbmNlbFJlYXNvbiA9IFwidGltZW91dFwiO1xuICAgICAgY29udHJvbGxlci5hYm9ydCgpO1xuICAgIH0sIDYwXzAwMCk7XG4gICAgbGV0IHZpc2libGVUZXh0ID0gXCJcIjtcblxuICAgIHRyeSB7XG4gICAgICBmb3IgYXdhaXQgKGNvbnN0IGV2ZW50IG9mIHRoaXMuc2Vzc2lvbnMuc2VuZFR1cm4oXG4gICAgICAgIHByZXBhcmVkUHJvbXB0LFxuICAgICAgICBbLi4uc25hcHNob3QudmlzaWJsZSwgLi4uc25hcHNob3Quc3lzdGVtXSxcbiAgICAgICAgcmVxdWVzdC5wcm9tcHQsXG4gICAgICAgIGNvbnRyb2xsZXIuc2lnbmFsLFxuICAgICAgKSkge1xuICAgICAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJ0ZXh0XCIpIHtcbiAgICAgICAgICBmb3IgYXdhaXQgKGNvbnN0IG1hcHBlZCBvZiB0aGlzLm1hcFN0cnVjdHVyZWRFdmVudHMoXG4gICAgICAgICAgICBwYXJzZXIucHVzaChldmVudC5jb250ZW50KSxcbiAgICAgICAgICAgIHJlcXVlc3QsXG4gICAgICAgICAgICBzbmFwc2hvdCxcbiAgICAgICAgICApKSB7XG4gICAgICAgICAgICBpZiAobWFwcGVkLnR5cGUgPT09IFwicmVzcG9uc2UtZGVsdGFcIikgdmlzaWJsZVRleHQgKz0gbWFwcGVkLnRleHQ7XG4gICAgICAgICAgICBpZiAobWFwcGVkLnR5cGUgPT09IFwibXV0YXRpb24tcHJvcG9zZWRcIikge1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnNlc3Npb25zLnJlY29yZEFzc2lzdGFudE1lc3NhZ2UodmlzaWJsZVRleHQpO1xuICAgICAgICAgICAgICB2aXNpYmxlVGV4dCA9IFwiXCI7XG4gICAgICAgICAgICAgIGF3YWl0IHRoaXMuc2Vzc2lvbnMucmVjb3JkUHJvcG9zYWwoXG4gICAgICAgICAgICAgICAgbWFwcGVkLmVkaXQuaWQsXG4gICAgICAgICAgICAgICAgbWFwcGVkLmVkaXQucHJvcG9zYWwsXG4gICAgICAgICAgICAgICk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB5aWVsZCBtYXBwZWQ7XG4gICAgICAgICAgfVxuICAgICAgICAgIGNvbnRpbnVlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGV2ZW50LnR5cGUgPT09IFwiY29tcGxldGVkXCIpIHtcbiAgICAgICAgICBmb3IgYXdhaXQgKGNvbnN0IG1hcHBlZCBvZiB0aGlzLm1hcFN0cnVjdHVyZWRFdmVudHMoXG4gICAgICAgICAgICBwYXJzZXIuZmluaXNoKCksXG4gICAgICAgICAgICByZXF1ZXN0LFxuICAgICAgICAgICAgc25hcHNob3QsXG4gICAgICAgICAgKSkge1xuICAgICAgICAgICAgaWYgKG1hcHBlZC50eXBlID09PSBcInJlc3BvbnNlLWRlbHRhXCIpIHZpc2libGVUZXh0ICs9IG1hcHBlZC50ZXh0O1xuICAgICAgICAgICAgaWYgKG1hcHBlZC50eXBlID09PSBcIm11dGF0aW9uLXByb3Bvc2VkXCIpIHtcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5zZXNzaW9ucy5yZWNvcmRBc3Npc3RhbnRNZXNzYWdlKHZpc2libGVUZXh0KTtcbiAgICAgICAgICAgICAgdmlzaWJsZVRleHQgPSBcIlwiO1xuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnNlc3Npb25zLnJlY29yZFByb3Bvc2FsKFxuICAgICAgICAgICAgICAgIG1hcHBlZC5lZGl0LmlkLFxuICAgICAgICAgICAgICAgIG1hcHBlZC5lZGl0LnByb3Bvc2FsLFxuICAgICAgICAgICAgICApO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgeWllbGQgbWFwcGVkO1xuICAgICAgICAgIH1cbiAgICAgICAgICBhd2FpdCB0aGlzLnNlc3Npb25zLnJlY29yZEFzc2lzdGFudE1lc3NhZ2UodmlzaWJsZVRleHQpO1xuICAgICAgICAgIHlpZWxkIHsgdHlwZTogXCJjb21wbGV0ZWRcIiB9O1xuICAgICAgICAgIHJldHVybjtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmIChldmVudC50eXBlID09PSBcImZhaWxlZFwiKSB7XG4gICAgICAgICAgeWllbGQgeyB0eXBlOiBcImZhaWxlZFwiLCBmYWlsdXJlOiBldmVudC5mYWlsdXJlIH07XG4gICAgICAgICAgcmV0dXJuO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKGFjdGl2ZVR1cm4uY2FuY2VsUmVhc29uID09PSBcInRpbWVvdXRcIikge1xuICAgICAgICAgIHlpZWxkIHtcbiAgICAgICAgICAgIHR5cGU6IFwiZmFpbGVkXCIsXG4gICAgICAgICAgICBmYWlsdXJlOiB7XG4gICAgICAgICAgICAgIGNvZGU6IFwidGltZW91dFwiLFxuICAgICAgICAgICAgICBtZXNzYWdlOiBcIk5vIHJlc3BvbnNlIGFmdGVyIDYwIHNlY29uZHMuIFRoZSBhZ2VudCBydW50aW1lIG1heSBiZSBidXN5LlwiLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICB9O1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIHlpZWxkIHsgdHlwZTogXCJjYW5jZWxsZWRcIiB9O1xuICAgICAgICB9XG4gICAgICAgIHJldHVybjtcbiAgICAgIH1cbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgY29uc3QgZmFpbHVyZTogQWdlbnRGYWlsdXJlID0ge1xuICAgICAgICBjb2RlOiBcInByb3RvY29sLWludmFsaWRcIixcbiAgICAgICAgbWVzc2FnZTogXCJGb3JnZSBjb3VsZCBub3QgaW50ZXJwcmV0IHRoZSBhZ2VudCByZXNwb25zZS5cIixcbiAgICAgICAgZGlhZ25vc3RpYzogZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpLFxuICAgICAgfTtcbiAgICAgIHlpZWxkIHsgdHlwZTogXCJmYWlsZWRcIiwgZmFpbHVyZSB9O1xuICAgIH0gZmluYWxseSB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG4gICAgICBpZiAodGhpcy5hY3RpdmVUdXJuID09PSBhY3RpdmVUdXJuKSB0aGlzLmFjdGl2ZVR1cm4gPSBudWxsO1xuICAgIH1cbiAgfVxuXG4gIGFzeW5jIGFwcGx5UHJvcG9zYWwocHJvcG9zYWxJZDogc3RyaW5nKTogUHJvbWlzZTxBcHBseVJlc3VsdD4ge1xuICAgIGNvbnN0IHBlbmRpbmcgPSB0aGlzLnBlbmRpbmdQcm9wb3NhbHMuZ2V0KHByb3Bvc2FsSWQpO1xuICAgIGlmICghcGVuZGluZykge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgb2s6IGZhbHNlLFxuICAgICAgICByZWFzb246IFwic3RhbGVcIixcbiAgICAgICAgbWVzc2FnZTogXCJUaGlzIHByb3Bvc2FsIGlzIG5vIGxvbmdlciBhY3RpdmUuIFJlZ2VuZXJhdGUgdGhlIGVkaXQuXCIsXG4gICAgICB9O1xuICAgIH1cblxuICAgIGNvbnN0IHJlc3VsdCA9IGF3YWl0IHRoaXMubXV0YXRpb25zLmFwcGx5KFxuICAgICAgcGVuZGluZy5wcm9wb3NhbCxcbiAgICAgIHBlbmRpbmcuYWxsb3dlZEZpbGVzLFxuICAgICk7XG4gICAgdGhpcy5wZW5kaW5nUHJvcG9zYWxzLmRlbGV0ZShwcm9wb3NhbElkKTtcbiAgICBhd2FpdCB0aGlzLnNlc3Npb25zLnVwZGF0ZVByb3Bvc2FsU3RhdGUoXG4gICAgICBwcm9wb3NhbElkLFxuICAgICAgcmVzdWx0Lm9rID8gXCJhcHBsaWVkXCIgOiBcInN0YWxlXCIsXG4gICAgKTtcbiAgICByZXR1cm4gcmVzdWx0O1xuICB9XG5cbiAgYXN5bmMgcmVqZWN0UHJvcG9zYWwocHJvcG9zYWxJZDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgdGhpcy5wZW5kaW5nUHJvcG9zYWxzLmRlbGV0ZShwcm9wb3NhbElkKTtcbiAgICBhd2FpdCB0aGlzLnNlc3Npb25zLnVwZGF0ZVByb3Bvc2FsU3RhdGUocHJvcG9zYWxJZCwgXCJyZWplY3RlZFwiKTtcbiAgfVxuXG4gIGNhbmNlbCgpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuYWN0aXZlVHVybikgcmV0dXJuO1xuICAgIHRoaXMuYWN0aXZlVHVybi5jYW5jZWxSZWFzb24gPSBcInVzZXJcIjtcbiAgICB0aGlzLmFjdGl2ZVR1cm4uY29udHJvbGxlci5hYm9ydCgpO1xuICB9XG5cbiAgZGlzcG9zZSgpOiB2b2lkIHtcbiAgICBpZiAoIXRoaXMuYWN0aXZlVHVybikgcmV0dXJuO1xuICAgIHRoaXMuYWN0aXZlVHVybi5jYW5jZWxSZWFzb24gPSBcImRpc3Bvc2VcIjtcbiAgICB0aGlzLmFjdGl2ZVR1cm4uY29udHJvbGxlci5hYm9ydCgpO1xuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgKm1hcFN0cnVjdHVyZWRFdmVudHMoXHJcbiAgICBldmVudHM6IFN0cnVjdHVyZWRTdHJlYW1FdmVudFtdLFxyXG4gICAgcmVxdWVzdDogTGVhcm5pbmdSZXF1ZXN0LFxyXG4gICAgY29udGV4dDogVHVybkNvbnRleHRTbmFwc2hvdCxcbiAgKTogQXN5bmNJdGVyYWJsZTxMZWFybmluZ0V2ZW50PiB7XHJcbiAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGV2ZW50cykge1xyXG4gICAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJ0ZXh0XCIpIHtcclxuICAgICAgICBpZiAoZXZlbnQudGV4dCkge1xyXG4gICAgICAgICAgeWllbGQge1xyXG4gICAgICAgICAgICB0eXBlOiBcInJlc3BvbnNlLWRlbHRhXCIsXHJcbiAgICAgICAgICAgIHRleHQ6IGV2ZW50LnRleHQsXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKGV2ZW50LnR5cGUgPT09IFwicHJvcG9zYWxcIikge1xuICAgICAgICBpZiAoIWNvbnRleHQuYWxsb3dlZE11dGF0aW9uRmlsZXMuaW5jbHVkZXMoZXZlbnQucHJvcG9zYWwuZmlsZSkpIHtcbiAgICAgICAgICB0aHJvdyBuZXcgRXJyb3IoXG4gICAgICAgICAgICBgRWRpdCB0YXJnZXQgaXMgb3V0c2lkZSB0aGUgYXBwcm92ZWQgY29udGV4dDogJHtldmVudC5wcm9wb3NhbC5maWxlfWAsXG4gICAgICAgICAgKTtcbiAgICAgICAgfVxuICAgICAgICBjb25zdCBlZGl0OiBQcm9wb3NlZEVkaXQgPSB7XG4gICAgICAgICAgaWQ6IGNyeXB0by5yYW5kb21VVUlEKCksXG4gICAgICAgICAgcHJvcG9zYWw6IGV2ZW50LnByb3Bvc2FsLFxuICAgICAgICB9O1xuICAgICAgICB0aGlzLnBlbmRpbmdQcm9wb3NhbHMuc2V0KGVkaXQuaWQsIHtcbiAgICAgICAgICBwcm9wb3NhbDogZWRpdC5wcm9wb3NhbCxcbiAgICAgICAgICBhbGxvd2VkRmlsZXM6IGNvbnRleHQuYWxsb3dlZE11dGF0aW9uRmlsZXMsXG4gICAgICAgIH0pO1xuICAgICAgICB5aWVsZCB7XG4gICAgICAgICAgdHlwZTogXCJtdXRhdGlvbi1wcm9wb3NlZFwiLFxuICAgICAgICAgIGVkaXQsXG4gICAgICAgIH07XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChldmVudC50eXBlID09PSBcInByYWN0aWNlLXF1ZXN0aW9uXCIpIHtcclxuICAgICAgICB0aGlzLmFjY2VwdFByYWN0aWNlUXVlc3Rpb24oZXZlbnQucXVlc3Rpb24pO1xyXG4gICAgICAgIHlpZWxkIHtcclxuICAgICAgICAgIHR5cGU6IFwicHJhY3RpY2UtcXVlc3Rpb25cIixcclxuICAgICAgICAgIHF1ZXN0aW9uOiBldmVudC5xdWVzdGlvbixcclxuICAgICAgICB9O1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJwcmFjdGljZS1ldmFsdWF0aW9uXCIpIHtcclxuICAgICAgICBjb25zdCBldmFsdWF0aW9uID0gZXZlbnQuZXZhbHVhdGlvbjtcclxuICAgICAgICB0aGlzLmFjY2VwdFByYWN0aWNlRXZhbHVhdGlvbihcclxuICAgICAgICAgIGV2YWx1YXRpb24sXHJcbiAgICAgICAgICByZXF1ZXN0LnByb21wdCxcclxuICAgICAgICApO1xyXG5cclxuICAgICAgICB5aWVsZCB7XHJcbiAgICAgICAgICB0eXBlOiBcInByYWN0aWNlLWV2YWx1YXRpb25cIixcclxuICAgICAgICAgIGV2YWx1YXRpb24sXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgY29uc3Qgc291cmNlID1cclxuICAgICAgICAgIGNvbnRleHQucmVzb2x2ZWQuc2VsZWN0aW9uPy5maWxlID8/XG4gICAgICAgICAgY29udGV4dC5yZXNvbHZlZC5hY3RpdmVOb3RlPy5wYXRoID8/XG4gICAgICAgICAgXCJsZWFybmluZy1zZXNzaW9uXCI7XHJcblxyXG4gICAgICAgIGNvbnN0IHN0YXRlID1cclxuICAgICAgICAgIGF3YWl0IHRoaXMubGVhcm5pbmdTdGF0ZS5yZWNvcmRQcmFjdGljZUV2YWx1YXRpb24oe1xyXG4gICAgICAgICAgICBldmFsdWF0aW9uLFxyXG4gICAgICAgICAgICBzb3VyY2UsXHJcbiAgICAgICAgICB9KTtcclxuXHJcbiAgICAgICAgeWllbGQge1xyXG4gICAgICAgICAgdHlwZTogXCJsZWFybmluZy1zdGF0ZS11cGRhdGVkXCIsXHJcbiAgICAgICAgICBzdGF0ZSxcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBpZiAoZXZhbHVhdGlvbi5uZXh0UXVlc3Rpb24/LnRyaW0oKSkge1xyXG4gICAgICAgICAgY29uc3QgbmV4dDogUHJhY3RpY2VRdWVzdGlvbiA9IHtcclxuICAgICAgICAgICAga2luZDogXCJxdWVzdGlvblwiLFxyXG4gICAgICAgICAgICBjb25jZXB0OiBldmFsdWF0aW9uLmNvbmNlcHQsXHJcbiAgICAgICAgICAgIHF1ZXN0aW9uOiBldmFsdWF0aW9uLm5leHRRdWVzdGlvbi50cmltKCksXHJcbiAgICAgICAgICB9O1xyXG5cclxuICAgICAgICAgIHRoaXMuYWNjZXB0UHJhY3RpY2VRdWVzdGlvbihuZXh0KTtcclxuICAgICAgICAgIHlpZWxkIHtcclxuICAgICAgICAgICAgdHlwZTogXCJwcmFjdGljZS1xdWVzdGlvblwiLFxyXG4gICAgICAgICAgICBxdWVzdGlvbjogbmV4dCxcclxuICAgICAgICAgIH07XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGV2ZW50Lm1lc3NhZ2UpO1xuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYWNjZXB0UHJhY3RpY2VRdWVzdGlvbihcclxuICAgIHF1ZXN0aW9uOiBQcmFjdGljZVF1ZXN0aW9uLFxyXG4gICk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLnByYWN0aWNlU2Vzc2lvbikge1xyXG4gICAgICB0aGlzLnByYWN0aWNlU2Vzc2lvbiA9IHtcclxuICAgICAgICBpZDogY3J5cHRvLnJhbmRvbVVVSUQoKSxcclxuICAgICAgICBzdGF0ZTogXCJnZW5lcmF0aW5nXCIsXHJcbiAgICAgICAgdHVybnM6IFtdLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMucHJhY3RpY2VTZXNzaW9uLmNvbmNlcHQgPSBxdWVzdGlvbi5jb25jZXB0O1xyXG4gICAgdGhpcy5wcmFjdGljZVNlc3Npb24uY3VycmVudFF1ZXN0aW9uID0gcXVlc3Rpb24ucXVlc3Rpb247XHJcbiAgICB0aGlzLnByYWN0aWNlU2Vzc2lvbi5zdGF0ZSA9IFwid2FpdGluZy1hbnN3ZXJcIjtcclxuXHJcbiAgICBjb25zdCBjdXJyZW50ID1cclxuICAgICAgdGhpcy5wcmFjdGljZVNlc3Npb24udHVybnNbXHJcbiAgICAgICAgdGhpcy5wcmFjdGljZVNlc3Npb24udHVybnMubGVuZ3RoIC0gMVxyXG4gICAgICBdO1xyXG5cclxuICAgIGlmIChcclxuICAgICAgY3VycmVudCAmJlxyXG4gICAgICAhY3VycmVudC5hbnN3ZXIgJiZcclxuICAgICAgY3VycmVudC5xdWVzdGlvbiA9PT0gcXVlc3Rpb24ucXVlc3Rpb25cclxuICAgICkge1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5wcmFjdGljZVNlc3Npb24udHVybnMucHVzaCh7XHJcbiAgICAgIGlkOiBjcnlwdG8ucmFuZG9tVVVJRCgpLFxyXG4gICAgICBjb25jZXB0OiBxdWVzdGlvbi5jb25jZXB0LFxyXG4gICAgICBxdWVzdGlvbjogcXVlc3Rpb24ucXVlc3Rpb24sXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYWNjZXB0UHJhY3RpY2VFdmFsdWF0aW9uKFxyXG4gICAgZXZhbHVhdGlvbjogUHJhY3RpY2VFdmFsdWF0aW9uLFxyXG4gICAgYW5zd2VyOiBzdHJpbmcsXHJcbiAgKTogdm9pZCB7XHJcbiAgICBpZiAoIXRoaXMucHJhY3RpY2VTZXNzaW9uKSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgY3VycmVudCA9XHJcbiAgICAgIHRoaXMucHJhY3RpY2VTZXNzaW9uLnR1cm5zW1xyXG4gICAgICAgIHRoaXMucHJhY3RpY2VTZXNzaW9uLnR1cm5zLmxlbmd0aCAtIDFcclxuICAgICAgXTtcclxuXHJcbiAgICBpZiAoY3VycmVudCkge1xyXG4gICAgICBjdXJyZW50LmFuc3dlciA9IGFuc3dlcjtcclxuICAgICAgY3VycmVudC5ldmFsdWF0aW9uID0gZXZhbHVhdGlvbjtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLnByYWN0aWNlU2Vzc2lvbi5jb25jZXB0ID0gZXZhbHVhdGlvbi5jb25jZXB0O1xyXG5cclxuICAgIGlmIChldmFsdWF0aW9uLm5leHRRdWVzdGlvbj8udHJpbSgpKSB7XHJcbiAgICAgIHRoaXMucHJhY3RpY2VTZXNzaW9uLnN0YXRlID0gXCJ3YWl0aW5nLWFuc3dlclwiO1xyXG4gICAgICB0aGlzLnByYWN0aWNlU2Vzc2lvbi5jdXJyZW50UXVlc3Rpb24gPVxyXG4gICAgICAgIGV2YWx1YXRpb24ubmV4dFF1ZXN0aW9uLnRyaW0oKTtcclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHRoaXMucHJhY3RpY2VTZXNzaW9uLnN0YXRlID0gXCJjb21wbGV0ZVwiO1xyXG4gICAgICB0aGlzLnByYWN0aWNlU2Vzc2lvbi5jdXJyZW50UXVlc3Rpb24gPSB1bmRlZmluZWQ7XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBBcHAsIE1hcmtkb3duVmlldywgVEZpbGUgfSBmcm9tIFwib2JzaWRpYW5cIjtcclxuaW1wb3J0IHsgQXBwbHlSZXN1bHQsIEVkaXRQcm9wb3NhbCB9IGZyb20gXCIuLi90eXBlc1wiO1xyXG5cclxuZnVuY3Rpb24gZmluZE9jY3VycmVuY2VzKGNvbnRlbnQ6IHN0cmluZywgbmVlZGxlOiBzdHJpbmcpOiBudW1iZXJbXSB7XHJcbiAgaWYgKCFuZWVkbGUpIHJldHVybiBbXTtcclxuXHJcbiAgY29uc3QgbWF0Y2hlczogbnVtYmVyW10gPSBbXTtcclxuICBsZXQgY3Vyc29yID0gMDtcclxuXHJcbiAgd2hpbGUgKGN1cnNvciA8PSBjb250ZW50Lmxlbmd0aCAtIG5lZWRsZS5sZW5ndGgpIHtcclxuICAgIGNvbnN0IGluZGV4ID0gY29udGVudC5pbmRleE9mKG5lZWRsZSwgY3Vyc29yKTtcclxuICAgIGlmIChpbmRleCA9PT0gLTEpIGJyZWFrO1xyXG5cclxuICAgIG1hdGNoZXMucHVzaChpbmRleCk7XHJcbiAgICBjdXJzb3IgPSBpbmRleCArIG5lZWRsZS5sZW5ndGg7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gbWF0Y2hlcztcclxufVxyXG5cclxuLyoqXHJcbiAqIE93bnMgdXNlci1hcHByb3ZlZCBNYXJrZG93biBtdXRhdGlvbnMuXHJcbiAqXHJcbiAqIEFnZW50IG91dHB1dCBpcyBvbmx5IGEgcHJvcG9zYWwuIFRoaXMgc2VydmljZSByZXZhbGlkYXRlcyB0aGUgdGFyZ2V0IGF0XHJcbiAqIGFwcGx5LXRpbWUgYW5kIHJlZnVzZXMgc3RhbGUgb3IgYW1iaWd1b3VzIHJlcGxhY2VtZW50cy5cclxuICovXHJcbmV4cG9ydCBjbGFzcyBNdXRhdGlvblNlcnZpY2Uge1xyXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgYXBwOiBBcHApIHt9XHJcblxyXG4gIGFzeW5jIGFwcGx5KFxuICAgIHByb3Bvc2FsOiBFZGl0UHJvcG9zYWwsXG4gICAgYWxsb3dlZEZpbGVzOiByZWFkb25seSBzdHJpbmdbXSxcbiAgKTogUHJvbWlzZTxBcHBseVJlc3VsdD4ge1xuICAgIGlmICghYWxsb3dlZEZpbGVzLmluY2x1ZGVzKHByb3Bvc2FsLmZpbGUpKSB7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBvazogZmFsc2UsXG4gICAgICAgIHJlYXNvbjogXCJ1bmF1dGhvcml6ZWRcIixcbiAgICAgICAgbWVzc2FnZTogXCJUaGlzIGVkaXQgdGFyZ2V0cyBhIG5vdGUgb3V0c2lkZSB0aGUgYXBwcm92ZWQgdHVybiBjb250ZXh0LlwiLFxuICAgICAgfTtcbiAgICB9XG5cbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0RmlsZUJ5UGF0aChwcm9wb3NhbC5maWxlKTtcclxuXHJcbiAgICBpZiAoIWZpbGUgfHwgIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgb2s6IGZhbHNlLFxyXG4gICAgICAgIHJlYXNvbjogXCJtaXNzaW5nLWZpbGVcIixcclxuICAgICAgICBtZXNzYWdlOiBgVGFyZ2V0IG5vdGUgbm90IGZvdW5kOiAke3Byb3Bvc2FsLmZpbGV9YCxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBjb25zdCBhY3RpdmVGaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcclxuICAgICAgY29uc3QgYWN0aXZlVmlldyA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XHJcblxyXG4gICAgICBpZiAoYWN0aXZlRmlsZT8ucGF0aCA9PT0gZmlsZS5wYXRoICYmIGFjdGl2ZVZpZXc/LmVkaXRvcikge1xyXG4gICAgICAgIGNvbnN0IGVkaXRvciA9IGFjdGl2ZVZpZXcuZWRpdG9yO1xyXG4gICAgICAgIGNvbnN0IGNvbnRlbnQgPSBlZGl0b3IuZ2V0VmFsdWUoKTtcclxuICAgICAgICBjb25zdCBtYXRjaGVzID0gZmluZE9jY3VycmVuY2VzKGNvbnRlbnQsIHByb3Bvc2FsLm9yaWdpbmFsKTtcclxuXHJcbiAgICAgICAgaWYgKG1hdGNoZXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICBvazogZmFsc2UsXHJcbiAgICAgICAgICAgIHJlYXNvbjogXCJzdGFsZVwiLFxyXG4gICAgICAgICAgICBtZXNzYWdlOiBcIk5vdGUgY2hhbmdlZCBzaW5jZSB0aGUgcHJvcG9zYWwgd2FzIG1hZGUuIFJlZ2VuZXJhdGUgdGhlIGVkaXQuXCIsXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKG1hdGNoZXMubGVuZ3RoID4gMSkge1xyXG4gICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgb2s6IGZhbHNlLFxyXG4gICAgICAgICAgICByZWFzb246IFwiYW1iaWd1b3VzXCIsXHJcbiAgICAgICAgICAgIG1lc3NhZ2U6IFwiVGhlIG9yaWdpbmFsIHRleHQgb2NjdXJzIG1vcmUgdGhhbiBvbmNlLiBSZWdlbmVyYXRlIHdpdGggYSBtb3JlIHNwZWNpZmljIHNlbGVjdGlvbi5cIixcclxuICAgICAgICAgIH07XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBpbmRleCA9IG1hdGNoZXNbMF07XHJcbiAgICAgICAgY29uc3QgZnJvbSA9IGVkaXRvci5vZmZzZXRUb1BvcyhpbmRleCk7XHJcbiAgICAgICAgY29uc3QgdG8gPSBlZGl0b3Iub2Zmc2V0VG9Qb3MoaW5kZXggKyBwcm9wb3NhbC5vcmlnaW5hbC5sZW5ndGgpO1xyXG5cclxuICAgICAgICBlZGl0b3IucmVwbGFjZVJhbmdlKHByb3Bvc2FsLnJlcGxhY2VtZW50LCBmcm9tLCB0byk7XHJcbiAgICAgICAgcmV0dXJuIHsgb2s6IHRydWUgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSk7XHJcbiAgICAgIGNvbnN0IG1hdGNoZXMgPSBmaW5kT2NjdXJyZW5jZXMoY29udGVudCwgcHJvcG9zYWwub3JpZ2luYWwpO1xyXG5cclxuICAgICAgaWYgKG1hdGNoZXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIG9rOiBmYWxzZSxcclxuICAgICAgICAgIHJlYXNvbjogXCJzdGFsZVwiLFxyXG4gICAgICAgICAgbWVzc2FnZTogXCJOb3RlIGNoYW5nZWQgc2luY2UgdGhlIHByb3Bvc2FsIHdhcyBtYWRlLiBSZWdlbmVyYXRlIHRoZSBlZGl0LlwiLFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChtYXRjaGVzLmxlbmd0aCA+IDEpIHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgb2s6IGZhbHNlLFxyXG4gICAgICAgICAgcmVhc29uOiBcImFtYmlndW91c1wiLFxyXG4gICAgICAgICAgbWVzc2FnZTogXCJUaGUgb3JpZ2luYWwgdGV4dCBvY2N1cnMgbW9yZSB0aGFuIG9uY2UuIFJlZ2VuZXJhdGUgd2l0aCBhIG1vcmUgc3BlY2lmaWMgc2VsZWN0aW9uLlwiLFxyXG4gICAgICAgIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IGluZGV4ID0gbWF0Y2hlc1swXTtcclxuICAgICAgY29uc3QgbmV4dCA9XHJcbiAgICAgICAgY29udGVudC5zbGljZSgwLCBpbmRleCkgK1xyXG4gICAgICAgIHByb3Bvc2FsLnJlcGxhY2VtZW50ICtcclxuICAgICAgICBjb250ZW50LnNsaWNlKGluZGV4ICsgcHJvcG9zYWwub3JpZ2luYWwubGVuZ3RoKTtcclxuXHJcbiAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCBuZXh0KTtcclxuICAgICAgcmV0dXJuIHsgb2s6IHRydWUgfTtcclxuICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIG9rOiBmYWxzZSxcclxuICAgICAgICByZWFzb246IFwiZXJyb3JcIixcclxuICAgICAgICBtZXNzYWdlOiBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogU3RyaW5nKGVyciksXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBBcHAsIFRGaWxlIH0gZnJvbSBcIm9ic2lkaWFuXCI7XHJcbmltcG9ydCB7XHJcbiAgREVGQVVMVF9MRUFSTklOR19TVEFURSxcclxuICBMZWFybmluZ0V2aWRlbmNlLFxyXG4gIExlYXJuaW5nU3RhdGUsXHJcbn0gZnJvbSBcIi4uL2xlYXJuaW5nL2xlYXJuaW5nLXN0YXRlXCI7XHJcbmltcG9ydCB7IFByYWN0aWNlRXZhbHVhdGlvbiB9IGZyb20gXCIuLi9sZWFybmluZy9wcmFjdGljZS10eXBlc1wiO1xyXG5cclxuY29uc3QgUk9PVCA9IFwiMDAtbGVhcm5pbmctb3NcIjtcclxuY29uc3QgUFJPR1JFU1NfUEFUSCA9IGAke1JPT1R9L3Byb2dyZXNzLmpzb25gO1xyXG5cclxuZnVuY3Rpb24gY2xvbmVEZWZhdWx0U3RhdGUoKTogTGVhcm5pbmdTdGF0ZSB7XHJcbiAgcmV0dXJuIHtcclxuICAgIC4uLkRFRkFVTFRfTEVBUk5JTkdfU1RBVEUsXHJcbiAgICBnYXBzOiBbXSxcclxuICAgIGV2aWRlbmNlOiBbXSxcclxuICB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc0xlYXJuaW5nU3RhdGUodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBMZWFybmluZ1N0YXRlIHtcclxuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlO1xyXG4gIGNvbnN0IG9iaiA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xyXG5cclxuICByZXR1cm4gKFxyXG4gICAgb2JqLnZlcnNpb24gPT09IDEgJiZcclxuICAgIHR5cGVvZiBvYmoudGFyZ2V0ID09PSBcInN0cmluZ1wiICYmXHJcbiAgICBBcnJheS5pc0FycmF5KG9iai5nYXBzKSAmJlxyXG4gICAgQXJyYXkuaXNBcnJheShvYmouZXZpZGVuY2UpXHJcbiAgKTtcclxufVxyXG5cclxuZnVuY3Rpb24gbm9ybWFsaXplKHZhbHVlOiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gIHJldHVybiB2YWx1ZS50cmltKCkudG9Mb3dlckNhc2UoKTtcclxufVxyXG5cclxuLyoqXHJcbiAqIER1cmFibGUgTGVhcm5pbmcgT1Mgc3RhdGUgc3RvcmVkIGluc2lkZSB0aGUgdmF1bHQgc28gcHJvZ3Jlc3MgdHJhdmVscyB3aXRoXHJcbiAqIHRoZSB2YXVsdCBpbnN0ZWFkIG9mIGJlaW5nIHRyYXBwZWQgaW4gT2JzaWRpYW4gcGx1Z2luIGRhdGEuXHJcbiAqL1xyXG5leHBvcnQgY2xhc3MgVmF1bHRMZWFybmluZ1N0b3JlIHtcclxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGFwcDogQXBwKSB7fVxyXG5cclxuICBhc3luYyBsb2FkKCk6IFByb21pc2U8TGVhcm5pbmdTdGF0ZT4ge1xyXG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEZpbGVCeVBhdGgoUFJPR1JFU1NfUEFUSCk7XHJcbiAgICBpZiAoIWZpbGUgfHwgIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSB7XHJcbiAgICAgIHJldHVybiBjbG9uZURlZmF1bHRTdGF0ZSgpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHJhdyA9IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSk7XHJcblxyXG4gICAgbGV0IHBhcnNlZDogdW5rbm93bjtcclxuICAgIHRyeSB7XHJcbiAgICAgIHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KTtcclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXHJcbiAgICAgICAgYExlYXJuaW5nIHN0YXRlIGlzIGludmFsaWQgSlNPTjogJHtQUk9HUkVTU19QQVRIfWAsXHJcbiAgICAgICk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKCFpc0xlYXJuaW5nU3RhdGUocGFyc2VkKSkge1xyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoXHJcbiAgICAgICAgYExlYXJuaW5nIHN0YXRlIGhhcyBhbiB1bnN1cHBvcnRlZCBzaGFwZTogJHtQUk9HUkVTU19QQVRIfWAsXHJcbiAgICAgICk7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHBhcnNlZDtcclxuICB9XHJcblxyXG4gIGFzeW5jIHNhdmUoc3RhdGU6IExlYXJuaW5nU3RhdGUpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGF3YWl0IHRoaXMuZW5zdXJlUm9vdCgpO1xyXG5cclxuICAgIGNvbnN0IGNvbnRlbnQgPSBKU09OLnN0cmluZ2lmeShzdGF0ZSwgbnVsbCwgMikgKyBcIlxcblwiO1xyXG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEZpbGVCeVBhdGgoUFJPR1JFU1NfUEFUSCk7XHJcblxyXG4gICAgaWYgKGZpbGUgJiYgZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSB7XHJcbiAgICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0Lm1vZGlmeShmaWxlLCBjb250ZW50KTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNyZWF0ZShQUk9HUkVTU19QQVRILCBjb250ZW50KTtcclxuICB9XHJcblxyXG4gIGFzeW5jIHJlY29yZFByYWN0aWNlRXZhbHVhdGlvbihpbnB1dDoge1xyXG4gICAgZXZhbHVhdGlvbjogUHJhY3RpY2VFdmFsdWF0aW9uO1xyXG4gICAgc291cmNlOiBzdHJpbmc7XHJcbiAgfSk6IFByb21pc2U8TGVhcm5pbmdTdGF0ZT4ge1xyXG4gICAgY29uc3Qgc3RhdGUgPSBhd2FpdCB0aGlzLmxvYWQoKTtcclxuXHJcbiAgICBjb25zdCBldmlkZW5jZTogTGVhcm5pbmdFdmlkZW5jZSA9IHtcclxuICAgICAgaWQ6IGNyeXB0by5yYW5kb21VVUlEKCksXHJcbiAgICAgIHR5cGU6IFwicHJhY3RpY2VcIixcclxuICAgICAgY29uY2VwdDogaW5wdXQuZXZhbHVhdGlvbi5jb25jZXB0LFxyXG4gICAgICBzb3VyY2U6IGlucHV0LnNvdXJjZSxcclxuICAgICAgb3V0Y29tZTogaW5wdXQuZXZhbHVhdGlvbi5vdXRjb21lLFxyXG4gICAgICBjcmVhdGVkQXQ6IERhdGUubm93KCksXHJcbiAgICB9O1xyXG5cclxuICAgIHN0YXRlLmV2aWRlbmNlLnB1c2goZXZpZGVuY2UpO1xyXG4gICAgc3RhdGUuY3VycmVudFRvcGljID0gaW5wdXQuZXZhbHVhdGlvbi5jb25jZXB0O1xyXG5cclxuICAgIGZvciAoY29uc3QgbWlzY29uY2VwdGlvbiBvZiBpbnB1dC5ldmFsdWF0aW9uLm1pc2NvbmNlcHRpb25zKSB7XHJcbiAgICAgIGNvbnN0IGV4aXN0aW5nID0gc3RhdGUuZ2Fwcy5maW5kKFxyXG4gICAgICAgIChnYXApID0+XHJcbiAgICAgICAgICBub3JtYWxpemUoZ2FwLmNvbmNlcHQpID09PSBub3JtYWxpemUoaW5wdXQuZXZhbHVhdGlvbi5jb25jZXB0KSAmJlxyXG4gICAgICAgICAgbm9ybWFsaXplKGdhcC5yZWFzb24pID09PSBub3JtYWxpemUobWlzY29uY2VwdGlvbiksXHJcbiAgICAgICk7XHJcblxyXG4gICAgICBpZiAoZXhpc3RpbmcpIHtcclxuICAgICAgICBpZiAoIWV4aXN0aW5nLmV2aWRlbmNlSWRzLmluY2x1ZGVzKGV2aWRlbmNlLmlkKSkge1xyXG4gICAgICAgICAgZXhpc3RpbmcuZXZpZGVuY2VJZHMucHVzaChldmlkZW5jZS5pZCk7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGV4aXN0aW5nLnN0YXR1cyA9IFwib3BlblwiO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHN0YXRlLmdhcHMucHVzaCh7XHJcbiAgICAgICAgICBpZDogY3J5cHRvLnJhbmRvbVVVSUQoKSxcclxuICAgICAgICAgIGNvbmNlcHQ6IGlucHV0LmV2YWx1YXRpb24uY29uY2VwdCxcclxuICAgICAgICAgIHJlYXNvbjogbWlzY29uY2VwdGlvbixcclxuICAgICAgICAgIGV2aWRlbmNlSWRzOiBbZXZpZGVuY2UuaWRdLFxyXG4gICAgICAgICAgc3RhdHVzOiBcIm9wZW5cIixcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGlmIChcclxuICAgICAgaW5wdXQuZXZhbHVhdGlvbi5vdXRjb21lID09PSBcImNvcnJlY3RcIiAmJlxyXG4gICAgICBpbnB1dC5ldmFsdWF0aW9uLm1pc2NvbmNlcHRpb25zLmxlbmd0aCA9PT0gMFxyXG4gICAgKSB7XHJcbiAgICAgIGZvciAoY29uc3QgZ2FwIG9mIHN0YXRlLmdhcHMpIHtcclxuICAgICAgICBpZiAoXHJcbiAgICAgICAgICBub3JtYWxpemUoZ2FwLmNvbmNlcHQpID09PVxyXG4gICAgICAgICAgICBub3JtYWxpemUoaW5wdXQuZXZhbHVhdGlvbi5jb25jZXB0KSAmJlxyXG4gICAgICAgICAgZ2FwLnN0YXR1cyA9PT0gXCJvcGVuXCJcclxuICAgICAgICApIHtcclxuICAgICAgICAgIC8vIE9uZSBnb29kIGFuc3dlciBpcyBldmlkZW5jZSBvZiBpbXByb3ZlbWVudCwgbm90IHByb29mIG9mIG1hc3RlcnkuXHJcbiAgICAgICAgICBnYXAuc3RhdHVzID0gXCJpbXByb3ZpbmdcIjtcclxuICAgICAgICAgIGdhcC5ldmlkZW5jZUlkcy5wdXNoKGV2aWRlbmNlLmlkKTtcclxuICAgICAgICB9XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBhd2FpdCB0aGlzLnNhdmUoc3RhdGUpO1xyXG4gICAgcmV0dXJuIHN0YXRlO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBlbnN1cmVSb290KCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgZXhpc3RpbmcgPSB0aGlzLmFwcC52YXVsdC5nZXRBYnN0cmFjdEZpbGVCeVBhdGgoUk9PVCk7XHJcbiAgICBpZiAoZXhpc3RpbmcpIHJldHVybjtcclxuXHJcbiAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5jcmVhdGVGb2xkZXIoUk9PVCk7XHJcbiAgfVxyXG59XHJcbiIsICJleHBvcnQgaW50ZXJmYWNlIEtub3dsZWRnZUdhcCB7XHJcbiAgaWQ6IHN0cmluZztcclxuICBjb25jZXB0OiBzdHJpbmc7XHJcbiAgcmVhc29uOiBzdHJpbmc7XHJcbiAgZXZpZGVuY2VJZHM6IHN0cmluZ1tdO1xyXG4gIHN0YXR1czogXCJvcGVuXCIgfCBcImltcHJvdmluZ1wiIHwgXCJyZXNvbHZlZFwiO1xyXG59XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIExlYXJuaW5nRXZpZGVuY2Uge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgdHlwZTogXCJwcmFjdGljZVwiIHwgXCJyZXZpZXdcIiB8IFwicHJvamVjdFwiO1xyXG4gIGNvbmNlcHQ6IHN0cmluZztcclxuICBzb3VyY2U6IHN0cmluZztcclxuICBvdXRjb21lPzogc3RyaW5nO1xyXG4gIGNyZWF0ZWRBdDogbnVtYmVyO1xyXG59XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIExlYXJuaW5nU3RhdGUge1xyXG4gIHZlcnNpb246IDE7XHJcbiAgdGFyZ2V0OiBzdHJpbmc7XHJcbiAgY3VycmVudFRvcGljPzogc3RyaW5nO1xyXG4gIGdhcHM6IEtub3dsZWRnZUdhcFtdO1xyXG4gIGV2aWRlbmNlOiBMZWFybmluZ0V2aWRlbmNlW107XHJcbn1cclxuXHJcbmV4cG9ydCBjb25zdCBERUZBVUxUX0xFQVJOSU5HX1NUQVRFOiBMZWFybmluZ1N0YXRlID0ge1xyXG4gIHZlcnNpb246IDEsXHJcbiAgdGFyZ2V0OiBcIkJhY2tlbmQgU29mdHdhcmUgRW5naW5lZXJcIixcclxuICBnYXBzOiBbXSxcclxuICBldmlkZW5jZTogW10sXHJcbn07XHJcbiIsICJpbXBvcnQgeyBQbHVnaW4gfSBmcm9tIFwib2JzaWRpYW5cIjtcclxuaW1wb3J0IHsgU2Vzc2lvblN0b3JlIH0gZnJvbSBcIi4vU2Vzc2lvblN0b3JlXCI7XHJcbmltcG9ydCB7XHJcbiAgQWdlbnRBZGFwdGVyLFxuICBBZ2VudEhlYWx0aCxcbiAgQWdlbnRDb250ZXh0LFxyXG4gIEFnZW50SW5wdXQsXHJcbiAgQWdlbnRNb2RlbCxcbiAgQWdlbnRTdHJlYW1FdmVudCxcbiAgQ2hhdFNlc3Npb24sXHJcbn0gZnJvbSBcIi4uL3R5cGVzXCI7XHJcblxyXG4vKipcclxuICogT3ducyBjaGF0L2FnZW50IGNvbnZlcnNhdGlvbiBwZXJzaXN0ZW5jZSBvbmx5LlxyXG4gKlxyXG4gKiBMZWFybmluZyBvcmNoZXN0cmF0aW9uLCBjb250ZXh0IHJlc29sdXRpb24sIGFuZCBNYXJrZG93biBtdXRhdGlvbiBsaXZlIGFib3ZlXHJcbiAqIG9yIGJlc2lkZSB0aGlzIGNsYXNzLiBUaGlzIGtlZXBzIHNlc3Npb24gc3RhdGUgaW5kZXBlbmRlbnQgb2YgTGVhcm5pbmcgT1NcclxuICogYmVoYXZpb3IuXHJcbiAqL1xyXG5leHBvcnQgY2xhc3MgU2Vzc2lvbkNvbnRyb2xsZXIge1xyXG4gIHByaXZhdGUgY3VycmVudFNlc3Npb246IENoYXRTZXNzaW9uIHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBtb2RlbHM6IEFnZW50TW9kZWxbXSA9IFtdO1xuXHJcbiAgY29uc3RydWN0b3IoXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IHBsdWdpbjogUGx1Z2luLFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBzdG9yZTogU2Vzc2lvblN0b3JlLFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBhZGFwdGVyOiBBZ2VudEFkYXB0ZXIsXHJcbiAgKSB7fVxyXG5cclxuICBhc3luYyBpbml0KCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgZGF0YSA9IGF3YWl0IHRoaXMucGx1Z2luLmxvYWREYXRhKCk7XHJcbiAgICBhd2FpdCB0aGlzLnN0b3JlLmxvYWQoZGF0YSk7XHJcblxyXG4gICAgdGhpcy5jdXJyZW50U2Vzc2lvbiA9IHRoaXMuc3RvcmUuZ2V0Q3VycmVudFNlc3Npb24oKTtcclxuICAgIGlmICghdGhpcy5jdXJyZW50U2Vzc2lvbikge1xyXG4gICAgICB0aGlzLmN1cnJlbnRTZXNzaW9uID0gdGhpcy5zdG9yZS5jcmVhdGVTZXNzaW9uKHRoaXMuc3RvcmUuZ2V0RGVmYXVsdE1vZGVsKCkpO1xyXG4gICAgfVxyXG5cclxuICAgIHRyeSB7XG4gICAgICB0aGlzLm1vZGVscyA9IGF3YWl0IHRoaXMuYWRhcHRlci5saXN0TW9kZWxzKCk7XG4gICAgfSBjYXRjaCB7XG4gICAgICB0aGlzLm1vZGVscyA9IFtdO1xuICAgIH1cbiAgfVxuXG4gIGNoZWNrUnVudGltZSgpOiBQcm9taXNlPEFnZW50SGVhbHRoPiB7XG4gICAgcmV0dXJuIHRoaXMuYWRhcHRlci5jaGVjaygpO1xuICB9XHJcblxyXG4gIGdldFNlc3Npb24oKTogQ2hhdFNlc3Npb24ge1xyXG4gICAgaWYgKCF0aGlzLmN1cnJlbnRTZXNzaW9uKSB0aHJvdyBuZXcgRXJyb3IoXCJTZXNzaW9uIG5vdCBpbml0aWFsaXplZFwiKTtcclxuICAgIHJldHVybiB0aGlzLmN1cnJlbnRTZXNzaW9uO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgbmV3U2Vzc2lvbigpOiBQcm9taXNlPENoYXRTZXNzaW9uPiB7XHJcbiAgICBjb25zdCBtb2RlbCA9IHRoaXMuY3VycmVudFNlc3Npb24/Lm1vZGVsID8/IHRoaXMuc3RvcmUuZ2V0RGVmYXVsdE1vZGVsKCk7XHJcbiAgICB0aGlzLmN1cnJlbnRTZXNzaW9uID0gdGhpcy5zdG9yZS5jcmVhdGVTZXNzaW9uKG1vZGVsKTtcclxuICAgIGF3YWl0IHRoaXMuc2F2ZSgpO1xyXG4gICAgcmV0dXJuIHRoaXMuY3VycmVudFNlc3Npb247XHJcbiAgfVxyXG5cclxuICBzZXRNb2RlbChtb2RlbElkPzogc3RyaW5nKTogdm9pZCB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IG1vZGVsSWQgfHwgdW5kZWZpbmVkO1xuICAgIHRoaXMuc3RvcmUuc2V0RGVmYXVsdE1vZGVsKG5vcm1hbGl6ZWQpO1xuXG4gICAgaWYgKHRoaXMuY3VycmVudFNlc3Npb24pIHtcbiAgICAgIHRoaXMuY3VycmVudFNlc3Npb24ubW9kZWwgPSBub3JtYWxpemVkO1xuICAgICAgdGhpcy5zdG9yZS51cGRhdGVTZXNzaW9uKHRoaXMuY3VycmVudFNlc3Npb24pO1xyXG4gICAgICB2b2lkIHRoaXMuc2F2ZSgpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgZ2V0TW9kZWxzKCk6IEFnZW50TW9kZWxbXSB7XG4gICAgcmV0dXJuIHRoaXMubW9kZWxzO1xyXG4gIH1cclxuXHJcbiAgLyoqXHJcbiAgICogRXhlY3V0ZSBvbmUgcHJlcGFyZWQgYWdlbnQgdHVybi5cclxuICAgKlxyXG4gICAqIENvbnRleHQgaXMgYWxyZWFkeSByZXNvbHZlZCBieSBMZWFybmluZ0NvbnRyb2xsZXIuIGRpc3BsYXlQcm9tcHQgaXMgdGhlIHJhd1xyXG4gICAqIHVzZXIgdGV4dCBzdG9yZWQgaW4gbG9jYWwgaGlzdG9yeSBzbyBpbnRlcm5hbCBsZWFybmluZyBpbnN0cnVjdGlvbnMgZG8gbm90XHJcbiAgICogbGVhayBpbnRvIHRoZSB2aXNpYmxlL3Nlc3Npb24gdHJhbnNjcmlwdC5cclxuICAgKi9cclxuICBhc3luYyAqc2VuZFR1cm4oXG4gICAgcHJvbXB0OiBzdHJpbmcsXG4gICAgY29udGV4dDogQWdlbnRDb250ZXh0W10sXG4gICAgZGlzcGxheVByb21wdDogc3RyaW5nLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICk6IEFzeW5jSXRlcmFibGU8QWdlbnRTdHJlYW1FdmVudD4ge1xuICAgIGNvbnN0IHNlc3Npb24gPSB0aGlzLmdldFNlc3Npb24oKTtcclxuICAgIGNvbnN0IGlucHV0OiBBZ2VudElucHV0ID0geyBwcm9tcHQsIGNvbnRleHQgfTtcclxuXHJcbiAgICBzZXNzaW9uLm1lc3NhZ2VzLnB1c2goe1xyXG4gICAgICByb2xlOiBcInVzZXJcIixcclxuICAgICAgY29udGVudDogZGlzcGxheVByb21wdCxcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuc3RvcmUudXBkYXRlU2Vzc2lvbihzZXNzaW9uKTtcbiAgICBhd2FpdCB0aGlzLnNhdmUoKTtcblxuICAgIGZvciBhd2FpdCAoY29uc3QgZXZlbnQgb2YgdGhpcy5hZGFwdGVyLnNlbmQoaW5wdXQsIHtcbiAgICAgIG1vZGVsOiBzZXNzaW9uLm1vZGVsLFxuICAgICAgY29udmVyc2F0aW9uSWQ6IHNlc3Npb24uY29udmVyc2F0aW9uSWQsXG4gICAgfSwgc2lnbmFsKSkge1xuICAgICAgaWYgKGV2ZW50LnR5cGUgPT09IFwiY29tcGxldGVkXCIgJiYgZXZlbnQuY29udmVyc2F0aW9uSWQpIHtcbiAgICAgICAgc2Vzc2lvbi5jb252ZXJzYXRpb25JZCA9IGV2ZW50LmNvbnZlcnNhdGlvbklkO1xuICAgICAgfVxuXHJcbiAgICAgIHlpZWxkIGV2ZW50O1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuc3RvcmUudXBkYXRlU2Vzc2lvbihzZXNzaW9uKTtcbiAgICBhd2FpdCB0aGlzLnNhdmUoKTtcbiAgfVxuXG4gIGFzeW5jIHJlY29yZEFzc2lzdGFudE1lc3NhZ2UoY29udGVudDogc3RyaW5nKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgaWYgKCFjb250ZW50LnRyaW0oKSkgcmV0dXJuO1xuICAgIGNvbnN0IHNlc3Npb24gPSB0aGlzLmdldFNlc3Npb24oKTtcbiAgICBzZXNzaW9uLm1lc3NhZ2VzLnB1c2goeyByb2xlOiBcImFzc2lzdGFudFwiLCBjb250ZW50IH0pO1xuICAgIHRoaXMuc3RvcmUudXBkYXRlU2Vzc2lvbihzZXNzaW9uKTtcbiAgICBhd2FpdCB0aGlzLnNhdmUoKTtcbiAgfVxuXG4gIGFzeW5jIHJlY29yZFByb3Bvc2FsKFxuICAgIHByb3Bvc2FsSWQ6IHN0cmluZyxcbiAgICBwcm9wb3NhbDogaW1wb3J0KFwiLi4vdHlwZXNcIikuRWRpdFByb3Bvc2FsLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzZXNzaW9uID0gdGhpcy5nZXRTZXNzaW9uKCk7XG4gICAgc2Vzc2lvbi5tZXNzYWdlcy5wdXNoKHtcbiAgICAgIHJvbGU6IFwiYXNzaXN0YW50XCIsXG4gICAgICBjb250ZW50OiBcIlwiLFxuICAgICAgcHJvcG9zYWxJZCxcbiAgICAgIHByb3Bvc2FsLFxuICAgICAgcHJvcG9zYWxTdGF0ZTogXCJwZW5kaW5nXCIsXG4gICAgfSk7XG4gICAgdGhpcy5zdG9yZS51cGRhdGVTZXNzaW9uKHNlc3Npb24pO1xuICAgIGF3YWl0IHRoaXMuc2F2ZSgpO1xuICB9XG5cbiAgYXN5bmMgdXBkYXRlUHJvcG9zYWxTdGF0ZShcbiAgICBwcm9wb3NhbElkOiBzdHJpbmcsXG4gICAgc3RhdGU6IFwiYXBwbGllZFwiIHwgXCJyZWplY3RlZFwiIHwgXCJzdGFsZVwiLFxuICApOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBtZXNzYWdlID0gdGhpcy5nZXRTZXNzaW9uKCkubWVzc2FnZXMuZmluZChcbiAgICAgIChpdGVtKSA9PiBpdGVtLnByb3Bvc2FsSWQgPT09IHByb3Bvc2FsSWQsXG4gICAgKTtcbiAgICBpZiAoIW1lc3NhZ2UpIHJldHVybjtcbiAgICBtZXNzYWdlLnByb3Bvc2FsU3RhdGUgPSBzdGF0ZTtcbiAgICB0aGlzLnN0b3JlLnVwZGF0ZVNlc3Npb24odGhpcy5nZXRTZXNzaW9uKCkpO1xuICAgIGF3YWl0IHRoaXMuc2F2ZSgpO1xuICB9XG5cbiAgcHJpdmF0ZSBhc3luYyBzYXZlKCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IGN1cnJlbnQgPSAoYXdhaXQgdGhpcy5wbHVnaW4ubG9hZERhdGEoKSkgPz8ge307XG4gICAgYXdhaXQgdGhpcy5wbHVnaW4uc2F2ZURhdGEoeyAuLi5jdXJyZW50LCAuLi50aGlzLnN0b3JlLnNlcmlhbGl6ZSgpIH0pO1xuICB9XG59XG4iLCAiaW1wb3J0IHsgQ2hhdFNlc3Npb24gfSBmcm9tIFwiLi4vdHlwZXNcIjtcblxuY29uc3QgU1RPUkVfS0VZID0gXCJmb3JnZS1zZXNzaW9uc1wiO1xuY29uc3QgTEVHQUNZX1NUT1JFX0tFWSA9IFwiYWd5LXNlc3Npb25zXCI7XG5pbnRlcmZhY2UgU3RvcmVEYXRhIHtcbiAgY3VycmVudFNlc3Npb25JZDogc3RyaW5nIHwgbnVsbDtcbiAgc2Vzc2lvbnM6IFJlY29yZDxzdHJpbmcsIENoYXRTZXNzaW9uPjtcbiAgZGVmYXVsdE1vZGVsPzogc3RyaW5nO1xufVxuXG4vKipcbiAqIFNlc3Npb25TdG9yZSBcdTIwMTQgcGVyc2lzdHMgc2Vzc2lvbnMgdG8gT2JzaWRpYW4gcGx1Z2luIGRhdGEuXG4gKlxuICogU3Bpa2UgNTogc2Vzc2lvbnMgc3Vydml2ZSBPYnNpZGlhbiByZXN0YXJ0cy5cbiAqIFRoZSBzdG9yZSBpcyBhIHRoaW4gd3JhcHBlciBhcm91bmQgcGx1Z2luLmxvYWREYXRhIC8gcGx1Z2luLnNhdmVEYXRhLlxuICovXG5leHBvcnQgY2xhc3MgU2Vzc2lvblN0b3JlIHtcbiAgcHJpdmF0ZSBkYXRhOiBTdG9yZURhdGEgPSB7XG4gICAgY3VycmVudFNlc3Npb25JZDogbnVsbCxcbiAgICBzZXNzaW9uczoge30sXG4gIH07XG5cbiAgLyoqIENhbGwgb25jZSBvbiBwbHVnaW4gbG9hZC4gKi9cbiAgYXN5bmMgbG9hZChyYXdEYXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGwpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBjb25zdCBzdG9yZWQgPSByYXdEYXRhPy5bU1RPUkVfS0VZXSA/PyByYXdEYXRhPy5bTEVHQUNZX1NUT1JFX0tFWV07XG4gICAgaWYgKCFzdG9yZWQgfHwgdHlwZW9mIHN0b3JlZCAhPT0gXCJvYmplY3RcIikgcmV0dXJuO1xuXG4gICAgY29uc3QgY2FuZGlkYXRlID0gc3RvcmVkIGFzIFBhcnRpYWw8U3RvcmVEYXRhPjtcbiAgICBjb25zdCBzZXNzaW9uczogUmVjb3JkPHN0cmluZywgQ2hhdFNlc3Npb24+ID0ge307XG4gICAgaWYgKGNhbmRpZGF0ZS5zZXNzaW9ucyAmJiB0eXBlb2YgY2FuZGlkYXRlLnNlc3Npb25zID09PSBcIm9iamVjdFwiKSB7XG4gICAgICBmb3IgKGNvbnN0IFtpZCwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGNhbmRpZGF0ZS5zZXNzaW9ucykpIHtcbiAgICAgICAgY29uc3Qgc2Vzc2lvbiA9IHRoaXMuZGVjb2RlU2Vzc2lvbih2YWx1ZSk7XG4gICAgICAgIGlmIChzZXNzaW9uKSBzZXNzaW9uc1tpZF0gPSBzZXNzaW9uO1xuICAgICAgfVxuICAgIH1cblxuICAgIHRoaXMuZGF0YSA9IHtcbiAgICAgIGN1cnJlbnRTZXNzaW9uSWQ6XG4gICAgICAgIHR5cGVvZiBjYW5kaWRhdGUuY3VycmVudFNlc3Npb25JZCA9PT0gXCJzdHJpbmdcIlxuICAgICAgICAgID8gY2FuZGlkYXRlLmN1cnJlbnRTZXNzaW9uSWRcbiAgICAgICAgICA6IG51bGwsXG4gICAgICBzZXNzaW9ucyxcbiAgICAgIGRlZmF1bHRNb2RlbDpcbiAgICAgICAgdHlwZW9mIGNhbmRpZGF0ZS5kZWZhdWx0TW9kZWwgPT09IFwic3RyaW5nXCJcbiAgICAgICAgICA/IGNhbmRpZGF0ZS5kZWZhdWx0TW9kZWxcbiAgICAgICAgICA6IHVuZGVmaW5lZCxcbiAgICB9O1xuICB9XG5cbiAgLyoqIFNlcmlhbGl6ZSB0byBwbHVnaW4gZGF0YSBvYmplY3QuICovXG4gIHNlcmlhbGl6ZSgpOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB7XG4gICAgcmV0dXJuIHsgW1NUT1JFX0tFWV06IHRoaXMuZGF0YSB9O1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIFNlc3Npb24gQ1JVRCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBjcmVhdGVTZXNzaW9uKG1vZGVsPzogc3RyaW5nKTogQ2hhdFNlc3Npb24ge1xuICAgIGNvbnN0IHNlc3Npb246IENoYXRTZXNzaW9uID0ge1xuICAgICAgaWQ6IGNyeXB0by5yYW5kb21VVUlEKCksXG4gICAgICBtb2RlbCxcbiAgICAgIG1lc3NhZ2VzOiBbXSxcbiAgICAgIGNyZWF0ZWRBdDogRGF0ZS5ub3coKSxcbiAgICAgIHVwZGF0ZWRBdDogRGF0ZS5ub3coKSxcbiAgICB9O1xuICAgIHRoaXMuZGF0YS5zZXNzaW9uc1tzZXNzaW9uLmlkXSA9IHNlc3Npb247XG4gICAgdGhpcy5kYXRhLmN1cnJlbnRTZXNzaW9uSWQgPSBzZXNzaW9uLmlkO1xuICAgIHJldHVybiBzZXNzaW9uO1xuICB9XG5cbiAgZ2V0U2Vzc2lvbihpZDogc3RyaW5nKTogQ2hhdFNlc3Npb24gfCBudWxsIHtcbiAgICByZXR1cm4gdGhpcy5kYXRhLnNlc3Npb25zW2lkXSA/PyBudWxsO1xuICB9XG5cbiAgZ2V0Q3VycmVudFNlc3Npb24oKTogQ2hhdFNlc3Npb24gfCBudWxsIHtcbiAgICBpZiAoIXRoaXMuZGF0YS5jdXJyZW50U2Vzc2lvbklkKSByZXR1cm4gbnVsbDtcbiAgICByZXR1cm4gdGhpcy5nZXRTZXNzaW9uKHRoaXMuZGF0YS5jdXJyZW50U2Vzc2lvbklkKTtcbiAgfVxuXG4gIHVwZGF0ZVNlc3Npb24oc2Vzc2lvbjogQ2hhdFNlc3Npb24pOiB2b2lkIHtcbiAgICBzZXNzaW9uLnVwZGF0ZWRBdCA9IERhdGUubm93KCk7XG4gICAgdGhpcy5kYXRhLnNlc3Npb25zW3Nlc3Npb24uaWRdID0gc2Vzc2lvbjtcbiAgfVxuXG4gIHNldEN1cnJlbnRTZXNzaW9uKGlkOiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLmRhdGEuY3VycmVudFNlc3Npb25JZCA9IGlkO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIE1vZGVsIHByZWZlcmVuY2UgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgZ2V0RGVmYXVsdE1vZGVsKCk6IHN0cmluZyB8IHVuZGVmaW5lZCB7XG4gICAgcmV0dXJuIHRoaXMuZGF0YS5kZWZhdWx0TW9kZWw7XG4gIH1cblxuICBzZXREZWZhdWx0TW9kZWwobW9kZWw/OiBzdHJpbmcpOiB2b2lkIHtcbiAgICB0aGlzLmRhdGEuZGVmYXVsdE1vZGVsID0gbW9kZWwgfHwgdW5kZWZpbmVkO1xuICB9XG5cbiAgLy8gXHUyNTAwXHUyNTAwIFV0aWxpdHkgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXG5cbiAgLyoqIEFsbCBzZXNzaW9ucywgbmV3ZXN0IGZpcnN0LiAqL1xuICBsaXN0U2Vzc2lvbnMoKTogQ2hhdFNlc3Npb25bXSB7XG4gICAgcmV0dXJuIE9iamVjdC52YWx1ZXModGhpcy5kYXRhLnNlc3Npb25zKS5zb3J0KFxuICAgICAgKGEsIGIpID0+IGIudXBkYXRlZEF0IC0gYS51cGRhdGVkQXRcbiAgICApO1xuICB9XG5cbiAgcHJpdmF0ZSBkZWNvZGVTZXNzaW9uKHZhbHVlOiB1bmtub3duKTogQ2hhdFNlc3Npb24gfCBudWxsIHtcbiAgICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIG51bGw7XG4gICAgY29uc3Qgc2Vzc2lvbiA9IHZhbHVlIGFzIFBhcnRpYWw8Q2hhdFNlc3Npb24+O1xuICAgIGlmIChcbiAgICAgIHR5cGVvZiBzZXNzaW9uLmlkICE9PSBcInN0cmluZ1wiIHx8XG4gICAgICAhQXJyYXkuaXNBcnJheShzZXNzaW9uLm1lc3NhZ2VzKSB8fFxuICAgICAgdHlwZW9mIHNlc3Npb24uY3JlYXRlZEF0ICE9PSBcIm51bWJlclwiIHx8XG4gICAgICB0eXBlb2Ygc2Vzc2lvbi51cGRhdGVkQXQgIT09IFwibnVtYmVyXCJcbiAgICApIHtcbiAgICAgIHJldHVybiBudWxsO1xuICAgIH1cblxuICAgIHJldHVybiB7XG4gICAgICBpZDogc2Vzc2lvbi5pZCxcbiAgICAgIGNvbnZlcnNhdGlvbklkOlxuICAgICAgICB0eXBlb2Ygc2Vzc2lvbi5jb252ZXJzYXRpb25JZCA9PT0gXCJzdHJpbmdcIlxuICAgICAgICAgID8gc2Vzc2lvbi5jb252ZXJzYXRpb25JZFxuICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgICAgbW9kZWw6IHR5cGVvZiBzZXNzaW9uLm1vZGVsID09PSBcInN0cmluZ1wiID8gc2Vzc2lvbi5tb2RlbCA6IHVuZGVmaW5lZCxcbiAgICAgIG1lc3NhZ2VzOiBzZXNzaW9uLm1lc3NhZ2VzXG4gICAgICAgIC5maWx0ZXIoKG1lc3NhZ2UpID0+IHtcbiAgICAgICAgICBpZiAoIW1lc3NhZ2UgfHwgdHlwZW9mIG1lc3NhZ2UgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZTtcbiAgICAgICAgICBjb25zdCBjYW5kaWRhdGUgPSBtZXNzYWdlIGFzIHsgcm9sZT86IHVua25vd247IGNvbnRlbnQ/OiB1bmtub3duIH07XG4gICAgICAgICAgcmV0dXJuIChcbiAgICAgICAgICAgIChjYW5kaWRhdGUucm9sZSA9PT0gXCJ1c2VyXCIgfHwgY2FuZGlkYXRlLnJvbGUgPT09IFwiYXNzaXN0YW50XCIpICYmXG4gICAgICAgICAgICB0eXBlb2YgY2FuZGlkYXRlLmNvbnRlbnQgPT09IFwic3RyaW5nXCJcbiAgICAgICAgICApO1xuICAgICAgICB9KVxuICAgICAgICAubWFwKChtZXNzYWdlKSA9PiAoe1xuICAgICAgICAgIC4uLm1lc3NhZ2UsXG4gICAgICAgICAgcHJvcG9zYWxTdGF0ZTpcbiAgICAgICAgICAgIG1lc3NhZ2UucHJvcG9zYWxTdGF0ZSA9PT0gXCJwZW5kaW5nXCJcbiAgICAgICAgICAgICAgPyBcInN0YWxlXCJcbiAgICAgICAgICAgICAgOiBtZXNzYWdlLnByb3Bvc2FsU3RhdGUsXG4gICAgICAgIH0pKSxcbiAgICAgIGNyZWF0ZWRBdDogc2Vzc2lvbi5jcmVhdGVkQXQsXG4gICAgICB1cGRhdGVkQXQ6IHNlc3Npb24udXBkYXRlZEF0LFxuICAgIH07XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBQbHVnaW4gfSBmcm9tIFwib2JzaWRpYW5cIjtcblxuZXhwb3J0IGNvbnN0IEZPUkdFX1NFVFRJTkdTX0tFWSA9IFwiZm9yZ2Utc2V0dGluZ3NcIjtcblxuZXhwb3J0IGludGVyZmFjZSBGb3JnZVNldHRpbmdzIHtcbiAgZXhlY3V0YWJsZVBhdGg6IHN0cmluZztcbiAgcHJlZmVycmVkTW9kZWw6IHN0cmluZztcbn1cblxuZXhwb3J0IGNvbnN0IERFRkFVTFRfRk9SR0VfU0VUVElOR1M6IEZvcmdlU2V0dGluZ3MgPSB7XG4gIGV4ZWN1dGFibGVQYXRoOiBcIlwiLFxuICBwcmVmZXJyZWRNb2RlbDogXCJcIixcbn07XG5cbmV4cG9ydCBmdW5jdGlvbiBkZWNvZGVGb3JnZVNldHRpbmdzKFxuICByYXdEYXRhOiBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IG51bGwsXG4pOiBGb3JnZVNldHRpbmdzIHtcbiAgY29uc3QgdmFsdWUgPSByYXdEYXRhPy5bRk9SR0VfU0VUVElOR1NfS0VZXTtcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIpIHJldHVybiB7IC4uLkRFRkFVTFRfRk9SR0VfU0VUVElOR1MgfTtcbiAgY29uc3QgY2FuZGlkYXRlID0gdmFsdWUgYXMgUGFydGlhbDxGb3JnZVNldHRpbmdzPjtcbiAgcmV0dXJuIHtcbiAgICBleGVjdXRhYmxlUGF0aDpcbiAgICAgIHR5cGVvZiBjYW5kaWRhdGUuZXhlY3V0YWJsZVBhdGggPT09IFwic3RyaW5nXCJcbiAgICAgICAgPyBjYW5kaWRhdGUuZXhlY3V0YWJsZVBhdGhcbiAgICAgICAgOiBcIlwiLFxuICAgIHByZWZlcnJlZE1vZGVsOlxuICAgICAgdHlwZW9mIGNhbmRpZGF0ZS5wcmVmZXJyZWRNb2RlbCA9PT0gXCJzdHJpbmdcIlxuICAgICAgICA/IGNhbmRpZGF0ZS5wcmVmZXJyZWRNb2RlbFxuICAgICAgICA6IFwiXCIsXG4gIH07XG59XG5cbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzYXZlRm9yZ2VTZXR0aW5ncyhcbiAgcGx1Z2luOiBQbHVnaW4sXG4gIHNldHRpbmdzOiBGb3JnZVNldHRpbmdzLFxuKTogUHJvbWlzZTx2b2lkPiB7XG4gIGNvbnN0IGN1cnJlbnQgPSAoYXdhaXQgcGx1Z2luLmxvYWREYXRhKCkpID8/IHt9O1xuICBhd2FpdCBwbHVnaW4uc2F2ZURhdGEoe1xuICAgIC4uLmN1cnJlbnQsXG4gICAgW0ZPUkdFX1NFVFRJTkdTX0tFWV06IHNldHRpbmdzLFxuICB9KTtcbn1cbiIsICJpbXBvcnQgeyBBcHAsIFBsdWdpblNldHRpbmdUYWIsIFNldHRpbmcgfSBmcm9tIFwib2JzaWRpYW5cIjtcbmltcG9ydCB0eXBlIEZvcmdlUGx1Z2luIGZyb20gXCIuLi9tYWluXCI7XG5cbmV4cG9ydCBjbGFzcyBGb3JnZVNldHRpbmdzVGFiIGV4dGVuZHMgUGx1Z2luU2V0dGluZ1RhYiB7XG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBwcml2YXRlIHJlYWRvbmx5IGZvcmdlOiBGb3JnZVBsdWdpbikge1xuICAgIHN1cGVyKGFwcCwgZm9yZ2UpO1xuICB9XG5cbiAgZGlzcGxheSgpOiB2b2lkIHtcbiAgICBjb25zdCB7IGNvbnRhaW5lckVsIH0gPSB0aGlzO1xuICAgIGNvbnN0IHNldHRpbmdzID0gdGhpcy5mb3JnZS5nZXRTZXR0aW5ncygpO1xuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XG4gICAgY29udGFpbmVyRWwuY3JlYXRlRWwoXCJoMlwiLCB7IHRleHQ6IFwiRm9yZ2VcIiB9KTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJBZ2VudCBleGVjdXRhYmxlXCIpXG4gICAgICAuc2V0RGVzYyhcIk9wdGlvbmFsIGFic29sdXRlIHBhdGggdG8gdGhlIGNvbmZpZ3VyZWQgYWdlbnQgcnVudGltZS5cIilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKFwiVXNlIFBBVEggZGlzY292ZXJ5XCIpXG4gICAgICAgICAgLnNldFZhbHVlKHNldHRpbmdzLmV4ZWN1dGFibGVQYXRoKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuZm9yZ2UudXBkYXRlU2V0dGluZ3MoeyBleGVjdXRhYmxlUGF0aDogdmFsdWUudHJpbSgpIH0pO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcblxuICAgIG5ldyBTZXR0aW5nKGNvbnRhaW5lckVsKVxuICAgICAgLnNldE5hbWUoXCJQcmVmZXJyZWQgbW9kZWxcIilcbiAgICAgIC5zZXREZXNjKFwiTGVhdmUgYmxhbmsgdG8gdXNlIHRoZSBydW50aW1lIGRlZmF1bHQgbW9kZWwuXCIpXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cbiAgICAgICAgdGV4dFxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihcIlJ1bnRpbWUgZGVmYXVsdFwiKVxuICAgICAgICAgIC5zZXRWYWx1ZShzZXR0aW5ncy5wcmVmZXJyZWRNb2RlbClcbiAgICAgICAgICAub25DaGFuZ2UoYXN5bmMgKHZhbHVlKSA9PiB7XG4gICAgICAgICAgICBhd2FpdCB0aGlzLmZvcmdlLnVwZGF0ZVNldHRpbmdzKHsgcHJlZmVycmVkTW9kZWw6IHZhbHVlLnRyaW0oKSB9KTtcbiAgICAgICAgICB9KSxcbiAgICAgICk7XG4gIH1cbn1cbiJdLAogICJtYXBwaW5ncyI6ICI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUEsSUFBQUEsbUJBQW1EOzs7QUNBbkQsMkJBQW9DO0FBQ3BDLGdCQUEyQjtBQUMzQixnQkFBd0I7QUFDeEIsa0JBQXFCO0FBYXJCLFNBQVMsZ0JBQWdCLE9BQXVCO0FBQzlDLFNBQU8sTUFDSixRQUFRLE1BQU0sT0FBTyxFQUNyQixRQUFRLE1BQU0sUUFBUSxFQUN0QixRQUFRLE1BQU0sTUFBTSxFQUNwQixRQUFRLE1BQU0sTUFBTTtBQUN6QjtBQWVPLElBQU0sYUFBTixNQUF5QztBQUFBLEVBQzlDLFlBQ21CLEtBQ0EsWUFBc0MsT0FBTyxDQUFDLElBQy9EO0FBRmlCO0FBQ0E7QUFBQSxFQUNoQjtBQUFBO0FBQUEsRUFJSCxNQUFNLFFBQThCO0FBN0N0QztBQThDSSxRQUFJO0FBQ0YsWUFBTSxLQUFLLGNBQWM7QUFDekIsYUFBTyxFQUFFLFFB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Q2QsSUFBSTtBQUFBLE1BQ0osTUFBTTtBQUFBLE1BQ04sU0FBUyxDQUFDLEVBQUUsV0FBVyxDQUFDLEtBQUssR0FBRyxLQUFLLElBQUksQ0FBQztBQUFBLE1BQzFDLFVBQVUsWUFBWTtBQUNwQixjQUFNLEtBQUssYUFBYTtBQUV4QixtQkFBVyxNQUFNO0FBdkd6QjtBQXdHVSxnQkFBTSxTQUFTLEtBQUssSUFBSSxVQUFVLGdCQUFnQixlQUFlO0FBQ2pFLGdCQUFNLFFBQU8sWUFBTyxDQUFDLE1BQVIsbUJBQVc7QUFDeEIsdUNBQU07QUFBQSxRQUNSLEdBQUcsR0FBRztBQUFBLE1BQ1I7QUFBQSxJQUNGLENBQUM7QUFBQSxFQUNIO0FBQUEsRUFFQSxNQUFNLFdBQTBCO0FBaEhsQztBQWlISSxTQUFLLElBQUksVUFBVSxtQkFBbUIsZUFBZTtBQUNyRCxlQUFLLGFBQUwsbUJBQWU7QUFBQSxFQUNqQjtBQUFBLEVBRUEsTUFBYyxlQUE4QjtBQUMxQyxVQUFNLEVBQUUsVUFBVSxJQUFJLEtBQUs7QUFDM0IsVUFBTSxXQUFXLFVBQVUsZ0JBQWdCLGVBQWU7QUFFMUQsUUFBSSxTQUFTLFNBQVMsR0FBRztBQUN2QixnQkFBVSxXQUFXLFNBQVMsQ0FBQyxDQUFDO0FBQ2hDO0FBQUEsSUFDRjtBQUVBLFVBQU0sT0FBTyxVQUFVLGFBQWEsS0FBSztBQUN6QyxRQUFJLENBQUMsS0FBTTtBQUVYLFVBQU0sS0FBSyxhQUFhO0FBQUEsTUFDdEIsTUFBTTtBQUFBLE1BQ04sUUFBUTtBQUFBLElBQ1YsQ0FBQztBQUNELGNBQVUsV0FBVyxJQUFJO0FBQUEsRUFDM0I7QUFBQSxFQUVBLGNBQTZCO0FBQzNCLFdBQU8sRUFBRSxHQUFHLEtBQUssY0FBYztBQUFBLEVBQ2pDO0FBQUEsRUFFQSxhQUFxQjtBQUNuQixVQUFNLGFBQWEsR0FBRyxLQUFLLFNBQVMsR0FBRztBQUN2QyxXQUFPLEtBQUssSUFBSSxNQUFNLFFBQVEsZ0JBQWdCLFVBQVU7QUFBQSxFQUMxRDtBQUFBLEVBRUEsTUFBTSxlQUFlLFFBQStDO0FBQ2xFLFNBQUssZ0JBQWdCLEVBQUUsR0FBRyxLQUFLLGVBQWUsR0FBRyxPQUFPO0FBQ3hELFVBQU0sa0JBQWtCLE1BQU0sS0FBSyxhQUFhO0FBQ2hELFFBQUksT0FBTyxtQkFBbUIsUUFBVztBQUN2QyxXQUFLLFNBQVMsU0FBUyxPQUFPLGtCQUFrQixNQUFTO0FBQUEsSUFDM0Q7QUFBQSxFQUNGO0FBQUEsRUFFUSxlQUFxQjtBQUMzQixVQUFNLE1BQU0sS0FBSztBQU1qQixRQUFJLFFBQVEsS0FBSztBQUNqQixRQUFJLFFBQVEsWUFBWSxLQUFLLFNBQVMsRUFBRTtBQUFBLEVBQzFDO0FBQ0Y7IiwKICAibmFtZXMiOiBbImltcG9ydF9vYnNpZGlhbiIsICJfYSIsICJfYSIsICJpbXBvcnRfb2JzaWRpYW4iLCAiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF9vYnNpZGlhbiIsICJjb250ZW50IiwgIm1hdGNoZXMiLCAiaW5kZXgiLCAiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF9vYnNpZGlhbiJdCn0K
