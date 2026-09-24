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
  { kind: "explain", name: "Explain", description: "Break down the current concept" },
  { kind: "practice", name: "Practice", description: "Start active recall" },
  { kind: "review", name: "Review", description: "Find important learning gaps" },
  { kind: "edit", name: "Edit", description: "Improve the current note safely" }
];
function setForgeIcon(element, icon) {
  element.empty();
  (0, import_obsidian.setIcon)(element, icon);
}
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
    this.intentEl = null;
    this.promptMenuEl = null;
    this.promptMenu = null;
    this.promptMenuActive = 0;
    this.promptMenuRows = [];
    this.promptMenuRequest = 0;
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
    this.runningAction = null;
    this.actionButtons = /* @__PURE__ */ new Map();
    this.systemContextFiles = [];
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
    this.learning.cancel();
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
      attr: {
        type: "button",
        "aria-label": "New learning session"
      }
    });
    setForgeIcon(newBtn, "plus");
    newBtn.title = "New learning session";
    newBtn.addEventListener("click", async () => {
      await this.learning.newSession();
      this.extraCtx = [];
      this.attachments = [];
      this.renderAttachments();
      this.closePromptMenu();
      this.setAction("ask");
      await this.syncChips();
      this.showEmpty();
    });
    const moreBtn = right.createEl("button", {
      cls: "forge-more-btn",
      attr: {
        type: "button",
        "aria-label": "Open Forge settings"
      }
    });
    setForgeIcon(moreBtn, "more-horizontal");
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
    this.intentEl = box.createDiv({
      cls: "forge-intent-row forge-hidden"
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
    this.promptPlusBtn = footer.createEl("button", {
      cls: "forge-prompt-plus",
      attr: {
        type: "button",
        "aria-label": "Add context or file",
        "aria-expanded": "false"
      }
    });
    setForgeIcon(this.promptPlusBtn, "plus");
    this.promptPlusBtn.title = "Add context or file";
    this.promptPlusBtn.addEventListener("click", () => {
      this.promptMenu = this.promptMenu === "source" ? null : "source";
      this.promptMenuActive = 0;
      void this.renderPromptMenu();
      this.input.focus();
    });
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
    const btnGroup = footer.createDiv({ cls: "forge-btn-group" });
    this.cancelBtn = btnGroup.createEl("button", {
      cls: "forge-cancel-btn forge-hidden",
      attr: { type: "button", "aria-label": "Stop generating" }
    });
    setForgeIcon(this.cancelBtn, "x");
    this.cancelBtn.title = "Stop";
    this.cancelBtn.setAttribute("aria-label", "Stop generating");
    this.cancelBtn.addEventListener("click", () => {
      this.learning.cancel();
      this.cancelBtn.disabled = true;
    });
    this.sendBtn = btnGroup.createEl("button", {
      cls: "forge-send-btn",
      attr: { type: "button", "aria-label": "Send message" }
    });
    setForgeIcon(this.sendBtn, "arrow-up");
    this.sendBtn.title = "Send message";
    this.sendBtn.setAttribute("aria-label", "Send message");
    this.sendBtn.disabled = true;
    this.sendBtn.addEventListener("click", () => {
      void this.doSend();
    });
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
      const attachmentIcon = chip.createSpan({ cls: "forge-attachment-icon" });
      setForgeIcon(attachmentIcon, "file-text");
      chip.createSpan({ cls: "forge-attachment-name", text: attachment.name });
      const remove = chip.createEl("button", {
        cls: "forge-attachment-remove",
        attr: {
          type: "button",
          "aria-label": `Remove ${attachment.name}`
        }
      });
      setForgeIcon(remove, "x");
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
  async getPromptMenuItems() {
    var _a, _b, _c, _d, _e, _f, _g;
    if (this.promptMenu === "command") {
      return PROMPT_COMMANDS.map((command) => ({
        key: command.kind,
        name: command.name,
        description: command.description,
        icon: "sparkles",
        action: { type: "learning", kind: command.kind }
      }));
    }
    const items = [];
    const token = parsePromptToken(this.input.value);
    const query = (token == null ? void 0 : token.kind) === "source" ? token.query : "";
    if ((_a = this.currentContext) == null ? void 0 : _a.selection) {
      items.push({
        key: "current-selection",
        name: "Current selection",
        description: this.currentContext.selection.file,
        icon: "check",
        disabled: true,
        action: { type: "info" }
      });
    } else if ((_b = this.currentContext) == null ? void 0 : _b.activeNote) {
      items.push({
        key: "current-note",
        name: (_c = this.currentContext.activeNote.path.split("/").pop()) != null ? _c : this.currentContext.activeNote.path,
        description: "Current note \xB7 automatic context",
        icon: "file-text",
        disabled: true,
        action: { type: "info" }
      });
    }
    if (query) {
      const excluded = new Set([
        (_e = (_d = this.currentContext) == null ? void 0 : _d.activeNote) == null ? void 0 : _e.path,
        (_g = (_f = this.currentContext) == null ? void 0 : _f.selection) == null ? void 0 : _g.file,
        ...this.extraCtx.map((item) => item.file)
      ].filter((value) => Boolean(value)));
      for (const note of this.learning.searchNotes(query, 6)) {
        if (excluded.has(note.path)) continue;
        items.push({
          key: `note:${note.path}`,
          name: note.name,
          description: note.path,
          icon: "file-text",
          action: { type: "vault-note", path: note.path }
        });
      }
    }
    items.push({
      key: "attach",
      name: "Attach text file",
      description: "Markdown, text, CSV, JSON, or YAML",
      icon: "paperclip",
      action: { type: "attach" }
    });
    return items;
  }
  async renderPromptMenu() {
    var _a;
    if (!this.promptMenuEl) return;
    const requestId = ++this.promptMenuRequest;
    this.promptMenuEl.empty();
    this.promptMenuRows = [];
    this.promptMenuEl.toggleClass("forge-hidden", this.promptMenu === null);
    (_a = this.promptPlusBtn) == null ? void 0 : _a.setAttribute("aria-expanded", String(this.promptMenu !== null));
    if (!this.promptMenu) return;
    const token = parsePromptToken(this.input.value);
    const query = (token == null ? void 0 : token.kind) === this.promptMenu ? token.query : "";
    const rows = await this.getPromptMenuItems();
    if (requestId !== this.promptMenuRequest || !this.promptMenu) return;
    let interactiveIndex = 0;
    for (const item of rows) {
      const menuIndex = item.disabled ? -1 : interactiveIndex++;
      const button = this.promptMenuEl.createEl("button", {
        cls: `forge-prompt-menu-row${menuIndex === this.promptMenuActive ? " is-active" : ""}`,
        attr: { type: "button" }
      });
      button.disabled = Boolean(item.disabled);
      const icon = button.createSpan({ cls: "forge-prompt-menu-icon" });
      setForgeIcon(icon, item.icon);
      button.createSpan({ cls: "forge-prompt-menu-name", text: item.name });
      button.createSpan({ cls: "forge-prompt-menu-description", text: item.description });
      if (!item.disabled) {
        button.addEventListener("mouseenter", () => {
          this.promptMenuActive = menuIndex;
          this.promptMenuRows.forEach((row, index) => {
            row.toggleClass("is-active", index === this.promptMenuActive);
          });
        });
        button.addEventListener("click", () => void this.pickPromptMenuItem(item));
        this.promptMenuRows.push(button);
      }
    }
    this.promptMenuEl.createDiv({
      cls: "forge-prompt-menu-hint",
      text: this.promptMenu === "source" ? query ? "Select a note or attach a text file" : "Type @name to search vault notes" : "Choose a learning action"
    });
  }
  async pickPromptMenuItem(item) {
    var _a;
    const action = item.action;
    if (action.type === "attach") {
      this.closePromptMenu();
      this.fileInput.click();
      return;
    }
    if (action.type === "info") return;
    const token = parsePromptToken(this.input.value);
    const prefix = token ? this.input.value.slice(0, token.start) : this.input.value;
    if (action.type === "vault-note") {
      const context = await this.learning.loadNoteContext(action.path);
      if (context && !this.extraCtx.some((item2) => item2.file === context.file)) {
        this.attachments.push({
          name: (_a = context.file.split("/").pop()) != null ? _a : context.file,
          context
        });
        this.extraCtx = this.attachments.map((item2) => item2.context);
        this.renderAttachments();
        await this.syncChips();
      }
      this.input.value = prefix;
      this.closePromptMenu();
      this.onInput();
      this.input.focus();
      return;
    }
    this.setAction(action.kind);
    this.input.value = prefix;
    this.closePromptMenu();
    this.onInput();
    this.input.focus();
  }
  closePromptMenu() {
    this.promptMenuRequest += 1;
    this.promptMenu = null;
    this.promptMenuActive = 0;
    void this.renderPromptMenu();
  }
  setAction(action) {
    this.selectedAction = action;
    this.syncActionButtons();
    this.updatePlaceholder();
  }
  syncActionButtons() {
    for (const [kind, button] of this.actionButtons) {
      const active = kind === this.selectedAction;
      button.toggleClass("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    this.renderIntent();
  }
  renderIntent() {
    var _a, _b;
    if (!this.intentEl) return;
    this.intentEl.empty();
    const visible = this.selectedAction !== "ask";
    this.intentEl.toggleClass("forge-hidden", !visible);
    if (!visible) return;
    const label = (_b = (_a = ACTIONS.find((item) => item.kind === this.selectedAction)) == null ? void 0 : _a.label) != null ? _b : this.selectedAction;
    const chip = this.intentEl.createDiv({
      cls: `forge-intent-chip forge-intent-chip--${this.selectedAction}`
    });
    chip.createSpan({ cls: "forge-intent-label", text: label });
    const remove = chip.createEl("button", {
      cls: "forge-intent-remove",
      attr: { type: "button", "aria-label": `Exit ${label} mode` }
    });
    setForgeIcon(remove, "x");
    remove.addEventListener("click", () => {
      this.setAction("ask");
      this.input.focus();
    });
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
    var _a;
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
    const prompt = this.input.value.trim() || "Review the attached context.";
    if (!this.canSend() || this.uiState === "RUNNING") return;
    const explicitContext = this.extraCtx;
    this.closePromptMenu();
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
    this.runningAction = this.selectedAction;
    this.appendUserBubble(prompt);
    this.setUIState("RUNNING");
    this.ensureAgentBubble();
    try {
      for await (const event of this.learning.run({
        prompt,
        action: this.runningAction,
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
    var _a;
    if (event.type === "context-ready") {
      this.currentContext = event.context.resolved;
      this.systemContextFiles = event.context.system.map((item) => item.file);
      this.systemChip.toggleClass("forge-chip--hidden", event.context.system.length === 0);
      this.systemChip.title = this.systemContextFiles.join("\n");
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
      if (!((_a = event.evaluation.nextQuestion) == null ? void 0 : _a.trim())) this.setAction("ask");
      return;
    }
    if (event.type === "review-findings") {
      this.appendReviewFindings(event.findings);
      return;
    }
    if (event.type === "learning-state-updated") {
      this.appendProgressUpdate(event.state.currentTopic, event.state.gaps);
      return;
    }
    if (event.type === "mutation-proposed") {
      this.setUIState("PROPOSAL");
      this.appendProposalBubble(event.edit);
      return;
    }
    if (event.type === "completed") {
      if (this.uiState === "RUNNING") this.setUIState("ANSWER");
      this.finishStreamingBubble();
      if (this.runningAction === "explain" || this.runningAction === "review" || this.runningAction === "edit") {
        this.setAction("ask");
      }
      this.runningAction = null;
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
    this.settleThinking(doneLabel != null ? doneLabel : `Completed in ${elapsed}`);
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
        this.setAction(action);
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    const trace = this.thread.createDiv({ cls: "forge-thinking" });
    trace.setAttribute("role", "status");
    trace.setAttribute("aria-live", "polite");
    const toggle = trace.createEl("button", {
      cls: "forge-thinking-toggle",
      attr: { type: "button", "aria-expanded": "false" }
    });
    this.thinkingToggleEl = toggle;
    toggle.createEl("img", {
      cls: "forge-thinking-logo",
      attr: { src: this.getLogoUrl(), alt: "" }
    });
    this.thinkingLabelEl = toggle.createSpan({
      cls: "forge-thinking-label forge-thinking-label--active",
      text: "Working"
    });
    this.loadingElapsedEl = toggle.createSpan({ cls: "forge-thinking-elapsed" });
    this.loadingElapsedEl.setAttribute("aria-hidden", "true");
    const chevron = toggle.createSpan({ cls: "forge-thinking-chevron", text: "\u2304" });
    this.thinkingChevronEl = chevron;
    const panel = trace.createDiv({ cls: "forge-thinking-panel" });
    this.thinkingPanelEl = panel;
    const list = panel.createDiv({ cls: "forge-thinking-trace forge-thinking-trace--facts" });
    const source = (_e = (_b = (_a = this.currentContext) == null ? void 0 : _a.selection) == null ? void 0 : _b.file) != null ? _e : (_d = (_c = this.currentContext) == null ? void 0 : _c.activeNote) == null ? void 0 : _d.path;
    const facts = [
      {
        primary: ((_f = this.currentContext) == null ? void 0 : _f.selection) ? "Current selection" : ((_g = this.currentContext) == null ? void 0 : _g.activeNote) ? "Current note" : "No automatic note context",
        secondary: source == null ? void 0 : source.split("/").pop()
      },
      {
        primary: "Learning intent",
        secondary: (_i = (_h = ACTIONS.find((action) => action.kind === this.runningAction)) == null ? void 0 : _h.label) != null ? _i : "Ask"
      }
    ];
    this.thinkingRows = facts.map((fact) => {
      const row = list.createDiv({ cls: "forge-thinking-row is-done" });
      row.createSpan({ cls: "forge-thinking-marker", text: "\xB7" });
      row.createSpan({ cls: "forge-thinking-primary", text: fact.primary });
      if (fact.secondary) row.createSpan({ cls: "forge-thinking-secondary", text: fact.secondary });
      return row;
    });
    toggle.addEventListener("click", () => {
      const expanded = !panel.hasClass("is-expanded");
      panel.toggleClass("is-expanded", expanded);
      toggle.setAttribute("aria-expanded", String(expanded));
      chevron.toggleClass("is-expanded", expanded);
      this.thinkingManualExpanded = expanded;
    });
    this.startLoadingTimer();
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
      cls: `forge-practice-evaluation forge-outcome--${evaluation.outcome}`
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
  appendReviewFindings(findings) {
    if (!this.agentCursorEl) return;
    const wrap = this.agentCursorEl.createDiv({ cls: "forge-review" });
    wrap.createDiv({
      cls: "forge-review-summary",
      text: findings.length === 0 ? "No material learning gaps found." : `${findings.length} important ${findings.length === 1 ? "gap" : "gaps"}`
    });
    for (const finding of findings) {
      const card = wrap.createDiv({
        cls: `forge-review-card forge-review-card--${finding.kind}`
      });
      card.createDiv({ cls: "forge-review-kind", text: finding.kind.replace("-", " ") });
      card.createDiv({ cls: "forge-review-title", text: finding.title });
      card.createDiv({ cls: "forge-review-detail", text: finding.detail });
      const actions = card.createDiv({ cls: "forge-review-actions" });
      const practice = actions.createEl("button", {
        cls: "forge-review-action",
        text: "Practice",
        attr: { type: "button" }
      });
      practice.addEventListener("click", () => {
        this.setAction("practice");
        this.input.value = `Practice this gap: ${finding.concept} \u2014 ${finding.detail}`;
        this.onInput();
        this.input.focus();
      });
      const fix = actions.createEl("button", {
        cls: "forge-review-action",
        text: "Fix",
        attr: { type: "button" }
      });
      fix.addEventListener("click", () => {
        this.setAction("edit");
        this.input.value = `Fix this learning gap: ${finding.detail}`;
        this.onInput();
        this.input.focus();
      });
    }
    this.scrollThread();
  }
  appendProgressUpdate(topic, gaps) {
    if (!topic) return;
    const open = gaps.filter((gap) => gap.status === "open").length;
    const row = this.thread.createDiv({ cls: "forge-progress-row" });
    const mark = row.createSpan({ cls: "forge-progress-mark" });
    setForgeIcon(mark, "check");
    row.createSpan({
      cls: "forge-progress-text",
      text: open > 0 ? `Learning state updated \xB7 ${open} open ${open === 1 ? "gap" : "gaps"}` : "Learning state updated"
    });
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
  searchNotes(query, limit = 8) {
    return this.obsidian.searchNotes(query, limit);
  }
  async loadExplicitNote(path) {
    const note = await this.obsidian.loadNote(path);
    if (!note) return null;
    return {
      type: "note",
      file: note.file,
      content: note.content
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
  searchNotes(query, limit = 8) {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];
    return this.app.vault.getMarkdownFiles().map((file) => ({
      path: file.path,
      name: file.basename,
      score: file.basename.toLowerCase().startsWith(normalized) ? 0 : file.path.toLowerCase().includes(normalized) ? 1 : 2
    })).filter(
      (item) => item.name.toLowerCase().includes(normalized) || item.path.toLowerCase().includes(normalized)
    ).sort((a, b) => a.score - b.score || a.path.localeCompare(b.path)).slice(0, limit).map(({ path, name }) => ({ path, name }));
  }
  async loadNote(path) {
    const file = this.app.vault.getFileByPath(path);
    if (!file || !(file instanceof import_obsidian2.TFile)) return null;
    return {
      file: file.path,
      content: await this.app.vault.cachedRead(file)
    };
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

Return findings as exactly one fenced block:

\`\`\`learning-review
{"kind":"review","findings":[{"kind":"misconception|missing-relation|factual-error|weak-explanation","concept":"specific concept","title":"short operational title","detail":"why this materially affects understanding"}]}
\`\`\`

Use an empty findings array when there is no material gap.
Do not emit cosmetic writing suggestions.
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
  { kind: "learning-practice", marker: "```learning-practice" },
  { kind: "learning-review", marker: "```learning-review" }
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
function isReviewPayload(value) {
  if (!value || typeof value !== "object") return false;
  const obj = value;
  if (obj.kind !== "review" || !Array.isArray(obj.findings)) return false;
  return obj.findings.every((item) => {
    if (!item || typeof item !== "object") return false;
    const finding = item;
    return (finding.kind === "misconception" || finding.kind === "missing-relation" || finding.kind === "factual-error" || finding.kind === "weak-explanation") && typeof finding.concept === "string" && typeof finding.title === "string" && typeof finding.detail === "string";
  });
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
      if (blockKind === "learning-review") {
        if (!isReviewPayload(parsed)) {
          events.push({
            type: "error",
            message: "Agent returned an invalid review payload."
          });
          continue;
        }
        events.push({
          type: "review-findings",
          findings: parsed.findings
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
  searchNotes(query, limit = 8) {
    return this.contexts.searchNotes(query, limit);
  }
  loadNoteContext(path) {
    return this.contexts.loadExplicitNote(path);
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
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
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
      if (event.type === "review-findings") {
        const source = (_d = (_c = (_a = context.resolved.selection) == null ? void 0 : _a.file) != null ? _c : (_b = context.resolved.activeNote) == null ? void 0 : _b.path) != null ? _d : "learning-session";
        yield {
          type: "review-findings",
          findings: event.findings
        };
        const state = await this.learningState.recordReviewFindings({
          findings: event.findings,
          source
        });
        if (event.findings.length > 0) {
          yield {
            type: "learning-state-updated",
            state
          };
        }
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
        const source = (_h = (_g = (_e = context.resolved.selection) == null ? void 0 : _e.file) != null ? _g : (_f = context.resolved.activeNote) == null ? void 0 : _f.path) != null ? _h : "learning-session";
        const state = await this.learningState.recordPracticeEvaluation({
          evaluation,
          source
        });
        yield {
          type: "learning-state-updated",
          state
        };
        if ((_i = evaluation.nextQuestion) == null ? void 0 : _i.trim()) {
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
  target: null,
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
  return obj.version === 1 && (obj.target === null || typeof obj.target === "string") && Array.isArray(obj.gaps) && Array.isArray(obj.evidence);
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
  async recordReviewFindings(input) {
    const state = await this.load();
    if (input.findings.length === 0) return state;
    for (const finding of input.findings) {
      const evidence = {
        id: crypto.randomUUID(),
        type: "review",
        concept: finding.concept,
        source: input.source,
        outcome: finding.kind,
        createdAt: Date.now()
      };
      state.evidence.push(evidence);
      state.currentTopic = finding.concept;
      const existing = state.gaps.find(
        (gap) => normalize(gap.concept) === normalize(finding.concept) && normalize(gap.reason) === normalize(finding.detail)
      );
      if (existing) {
        if (!existing.evidenceIds.includes(evidence.id)) {
          existing.evidenceIds.push(evidence.id);
        }
        existing.status = "open";
      } else {
        state.gaps.push({
          id: crypto.randomUUID(),
          concept: finding.concept,
          reason: finding.detail,
          evidenceIds: [evidence.id],
          status: "open"
        });
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2FnZW50L0FneUFkYXB0ZXIudHMiLCAic3JjL2NoYXQvQ2hhdFZpZXcudHMiLCAic3JjL2NvbnRleHQvQ29udGV4dFJlc29sdmVyLnRzIiwgInNyYy9jb250ZXh0L09ic2lkaWFuQ29udGV4dC50cyIsICJzcmMvY29udGV4dC9Qb2xpY3lMb2FkZXIudHMiLCAic3JjL2xlYXJuaW5nL2FjdGlvbi1idWlsZGVycy50cyIsICJzcmMvbGVhcm5pbmcvU3RydWN0dXJlZFN0cmVhbVBhcnNlci50cyIsICJzcmMvbGVhcm5pbmcvTGVhcm5pbmdDb250cm9sbGVyLnRzIiwgInNyYy9tdXRhdGlvbi9NdXRhdGlvblNlcnZpY2UudHMiLCAic3JjL3BlcnNpc3RlbmNlL1ZhdWx0TGVhcm5pbmdTdG9yZS50cyIsICJzcmMvbGVhcm5pbmcvbGVhcm5pbmctc3RhdGUudHMiLCAic3JjL3Nlc3Npb24vU2Vzc2lvbkNvbnRyb2xsZXIudHMiLCAic3JjL3Nlc3Npb24vU2Vzc2lvblN0b3JlLnRzIiwgInNyYy9zZXR0aW5ncy9Gb3JnZVNldHRpbmdzLnRzIiwgInNyYy9zZXR0aW5ncy9TZXR0aW5nc1RhYi50cyJdLAogICJzb3VyY2VzQ29udGVudCI6IFsiaW1wb3J0IHsgYWRkSWNvbiwgRmlsZVN5c3RlbUFkYXB0ZXIsIFBsdWdpbiB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHsgQWd5QWRhcHRlciB9IGZyb20gXCIuL2FnZW50L0FneUFkYXB0ZXJcIjtcclxuaW1wb3J0IHsgQ2hhdFZpZXcsIEZPUkdFX1ZJRVdfVFlQRSB9IGZyb20gXCIuL2NoYXQvQ2hhdFZpZXdcIjtcbmltcG9ydCB7IENvbnRleHRSZXNvbHZlciB9IGZyb20gXCIuL2NvbnRleHQvQ29udGV4dFJlc29sdmVyXCI7XHJcbmltcG9ydCB7IE9ic2lkaWFuQ29udGV4dCB9IGZyb20gXCIuL2NvbnRleHQvT2JzaWRpYW5Db250ZXh0XCI7XHJcbmltcG9ydCB7IFBvbGljeUxvYWRlciB9IGZyb20gXCIuL2NvbnRleHQvUG9saWN5TG9hZGVyXCI7XHJcbmltcG9ydCB7IExlYXJuaW5nQ29udHJvbGxlciB9IGZyb20gXCIuL2xlYXJuaW5nL0xlYXJuaW5nQ29udHJvbGxlclwiO1xyXG5pbXBvcnQgeyBNdXRhdGlvblNlcnZpY2UgfSBmcm9tIFwiLi9tdXRhdGlvbi9NdXRhdGlvblNlcnZpY2VcIjtcclxuaW1wb3J0IHsgVmF1bHRMZWFybmluZ1N0b3JlIH0gZnJvbSBcIi4vcGVyc2lzdGVuY2UvVmF1bHRMZWFybmluZ1N0b3JlXCI7XHJcbmltcG9ydCB7IFNlc3Npb25Db250cm9sbGVyIH0gZnJvbSBcIi4vc2Vzc2lvbi9TZXNzaW9uQ29udHJvbGxlclwiO1xyXG5pbXBvcnQgeyBTZXNzaW9uU3RvcmUgfSBmcm9tIFwiLi9zZXNzaW9uL1Nlc3Npb25TdG9yZVwiO1xuaW1wb3J0IHtcbiAgZGVjb2RlRm9yZ2VTZXR0aW5ncyxcbiAgRm9yZ2VTZXR0aW5ncyxcbiAgc2F2ZUZvcmdlU2V0dGluZ3MsXG59IGZyb20gXCIuL3NldHRpbmdzL0ZvcmdlU2V0dGluZ3NcIjtcbmltcG9ydCB7IEZvcmdlU2V0dGluZ3NUYWIgfSBmcm9tIFwiLi9zZXR0aW5ncy9TZXR0aW5nc1RhYlwiO1xuXHJcbi8qKlxyXG4gKiBDb21wb3NpdGlvbiByb290LlxyXG4gKlxyXG4gKiBCdXNpbmVzcyBiZWhhdmlvciBiZWxvbmdzIGluIExlYXJuaW5nQ29udHJvbGxlci9zZXJ2aWNlczsgdGhpcyBmaWxlIG9ubHlcclxuICogY29uc3RydWN0cyBkZXBlbmRlbmNpZXMsIHJlZ2lzdGVycyBPYnNpZGlhbiBzdXJmYWNlcywgYW5kIGRpc3Bvc2VzIHJ1bnRpbWVcclxuICogcmVzb3VyY2VzLlxyXG4gKi9cclxuZXhwb3J0IGRlZmF1bHQgY2xhc3MgRm9yZ2VQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xuICBwcml2YXRlIGxlYXJuaW5nITogTGVhcm5pbmdDb250cm9sbGVyO1xuICBwcml2YXRlIGZvcmdlU2V0dGluZ3MhOiBGb3JnZVNldHRpbmdzO1xuXHJcbiAgYXN5bmMgb25sb2FkKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgdmF1bHRBZGFwdGVyID0gdGhpcy5hcHAudmF1bHQuYWRhcHRlcjtcclxuICAgIGNvbnN0IHZhdWx0UGF0aCA9XHJcbiAgICAgIHZhdWx0QWRhcHRlciBpbnN0YW5jZW9mIEZpbGVTeXN0ZW1BZGFwdGVyXHJcbiAgICAgICAgPyB2YXVsdEFkYXB0ZXIuZ2V0QmFzZVBhdGgoKVxyXG4gICAgICAgIDogdW5kZWZpbmVkO1xyXG5cclxuICAgIHRoaXMuZm9yZ2VTZXR0aW5ncyA9IGRlY29kZUZvcmdlU2V0dGluZ3MoYXdhaXQgdGhpcy5sb2FkRGF0YSgpKTtcbiAgICBjb25zdCBhZGFwdGVyID0gbmV3IEFneUFkYXB0ZXIodmF1bHRQYXRoLCAoKSA9PiAoe1xuICAgICAgZXhlY3V0YWJsZVBhdGg6IHRoaXMuZm9yZ2VTZXR0aW5ncy5leGVjdXRhYmxlUGF0aCxcbiAgICB9KSk7XG4gICAgY29uc3Qgc2Vzc2lvblN0b3JlID0gbmV3IFNlc3Npb25TdG9yZSgpO1xyXG4gICAgY29uc3Qgc2Vzc2lvbnMgPSBuZXcgU2Vzc2lvbkNvbnRyb2xsZXIoXHJcbiAgICAgIHRoaXMsXHJcbiAgICAgIHNlc3Npb25TdG9yZSxcclxuICAgICAgYWRhcHRlcixcclxuICAgICk7XHJcblxyXG4gICAgYXdhaXQgc2Vzc2lvbnMuaW5pdCgpO1xuICAgIGlmICghc2Vzc2lvbnMuZ2V0U2Vzc2lvbigpLm1vZGVsICYmIHRoaXMuZm9yZ2VTZXR0aW5ncy5wcmVmZXJyZWRNb2RlbCkge1xuICAgICAgc2Vzc2lvbnMuc2V0TW9kZWwodGhpcy5mb3JnZVNldHRpbmdzLnByZWZlcnJlZE1vZGVsKTtcbiAgICB9XG5cclxuICAgIGNvbnN0IG9ic2lkaWFuQ29udGV4dCA9IG5ldyBPYnNpZGlhbkNvbnRleHQodGhpcy5hcHApO1xyXG4gICAgY29uc3QgY29udGV4dHMgPSBuZXcgQ29udGV4dFJlc29sdmVyKG9ic2lkaWFuQ29udGV4dCk7XHJcbiAgICBjb25zdCBwb2xpY2llcyA9IG5ldyBQb2xpY3lMb2FkZXIodGhpcy5hcHApO1xyXG4gICAgY29uc3QgbXV0YXRpb25zID0gbmV3IE11dGF0aW9uU2VydmljZSh0aGlzLmFwcCk7XHJcbiAgICBjb25zdCBsZWFybmluZ1N0YXRlID0gbmV3IFZhdWx0TGVhcm5pbmdTdG9yZSh0aGlzLmFwcCk7XHJcblxyXG4gICAgdGhpcy5sZWFybmluZyA9IG5ldyBMZWFybmluZ0NvbnRyb2xsZXIoXG4gICAgICBzZXNzaW9ucyxcclxuICAgICAgY29udGV4dHMsXHJcbiAgICAgIHBvbGljaWVzLFxyXG4gICAgICBtdXRhdGlvbnMsXHJcbiAgICAgIGxlYXJuaW5nU3RhdGUsXG4gICAgKTtcblxuICAgIGNvbnN0IGxvZ29VcmwgPSB0aGlzLmdldExvZ29VcmwoKS5yZXBsYWNlKC8mL2csIFwiJmFtcDtcIik7XG4gICAgYWRkSWNvbihcbiAgICAgIFwiZm9yZ2UtbG9nb1wiLFxuICAgICAgYDxpbWFnZSBocmVmPVwiJHtsb2dvVXJsfVwiIHg9XCIwXCIgeT1cIjBcIiB3aWR0aD1cIjEwMCVcIiBoZWlnaHQ9XCIxMDAlXCIgcHJlc2VydmVBc3BlY3RSYXRpbz1cInhNaWRZTWlkIHNsaWNlXCIgLz5gLFxuICAgICk7XG5cclxuICAgIHRoaXMucmVnaXN0ZXJWaWV3KFxyXG4gICAgICBGT1JHRV9WSUVXX1RZUEUsXG4gICAgICAobGVhZikgPT4gbmV3IENoYXRWaWV3KFxuICAgICAgICBsZWFmLFxuICAgICAgICB0aGlzLmxlYXJuaW5nLFxuICAgICAgICAoKSA9PiB0aGlzLm9wZW5TZXR0aW5ncygpLFxuICAgICAgICAoKSA9PiB0aGlzLmdldExvZ29VcmwoKSxcbiAgICAgICksXG4gICAgKTtcblxuICAgIHRoaXMuYWRkU2V0dGluZ1RhYihuZXcgRm9yZ2VTZXR0aW5nc1RhYih0aGlzLmFwcCwgdGhpcykpO1xuXHJcbiAgICB0aGlzLmFkZFJpYmJvbkljb24oXG4gICAgICBcImZvcmdlLWxvZ29cIixcbiAgICAgIFwiT3BlbiBGb3JnZVwiLFxuICAgICAgKCkgPT4gdGhpcy5hY3RpdmF0ZVZpZXcoKSxcbiAgICApO1xyXG5cclxuICAgIHRoaXMuYWRkQ29tbWFuZCh7XHJcbiAgICAgIGlkOiBcIm9wZW4tZm9yZ2Utc2lkZWJhclwiLFxuICAgICAgbmFtZTogXCJPcGVuIEZvcmdlIHNpZGViYXJcIixcbiAgICAgIGNhbGxiYWNrOiAoKSA9PiB0aGlzLmFjdGl2YXRlVmlldygpLFxyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcclxuICAgICAgaWQ6IFwiZm9jdXMtZm9yZ2UtY29tcG9zZXJcIixcbiAgICAgIG5hbWU6IFwiRm9jdXMgRm9yZ2UgY29tcG9zZXJcIixcbiAgICAgIGhvdGtleXM6IFt7IG1vZGlmaWVyczogW1wiTW9kXCJdLCBrZXk6IFwibFwiIH1dLFxyXG4gICAgICBjYWxsYmFjazogYXN5bmMgKCkgPT4ge1xyXG4gICAgICAgIGF3YWl0IHRoaXMuYWN0aXZhdGVWaWV3KCk7XHJcblxyXG4gICAgICAgIHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgICAgY29uc3QgbGVhdmVzID0gdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShGT1JHRV9WSUVXX1RZUEUpO1xuICAgICAgICAgIGNvbnN0IHZpZXcgPSBsZWF2ZXNbMF0/LnZpZXcgYXMgQ2hhdFZpZXcgfCB1bmRlZmluZWQ7XHJcbiAgICAgICAgICB2aWV3Py5mb2N1c0NvbXBvc2VyKCk7XG4gICAgICAgIH0sIDEwMCk7XHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIGFzeW5jIG9udW5sb2FkKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdGhpcy5hcHAud29ya3NwYWNlLmRldGFjaExlYXZlc09mVHlwZShGT1JHRV9WSUVXX1RZUEUpO1xuICAgIHRoaXMubGVhcm5pbmc/LmRpc3Bvc2UoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgYWN0aXZhdGVWaWV3KCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHsgd29ya3NwYWNlIH0gPSB0aGlzLmFwcDtcclxuICAgIGNvbnN0IGV4aXN0aW5nID0gd29ya3NwYWNlLmdldExlYXZlc09mVHlwZShGT1JHRV9WSUVXX1RZUEUpO1xuXHJcbiAgICBpZiAoZXhpc3RpbmcubGVuZ3RoID4gMCkge1xyXG4gICAgICB3b3Jrc3BhY2UucmV2ZWFsTGVhZihleGlzdGluZ1swXSk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBsZWFmID0gd29ya3NwYWNlLmdldFJpZ2h0TGVhZihmYWxzZSk7XHJcbiAgICBpZiAoIWxlYWYpIHJldHVybjtcclxuXHJcbiAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7XHJcbiAgICAgIHR5cGU6IEZPUkdFX1ZJRVdfVFlQRSxcbiAgICAgIGFjdGl2ZTogdHJ1ZSxcclxuICAgIH0pO1xyXG4gICAgd29ya3NwYWNlLnJldmVhbExlYWYobGVhZik7XHJcbiAgfVxuXG4gIGdldFNldHRpbmdzKCk6IEZvcmdlU2V0dGluZ3Mge1xuICAgIHJldHVybiB7IC4uLnRoaXMuZm9yZ2VTZXR0aW5ncyB9O1xuICB9XG5cbiAgZ2V0TG9nb1VybCgpOiBzdHJpbmcge1xuICAgIGNvbnN0IHBsdWdpblBhdGggPSBgJHt0aGlzLm1hbmlmZXN0LmRpcn0vZm9yZ2UucG5nYDtcbiAgICByZXR1cm4gdGhpcy5hcHAudmF1bHQuYWRhcHRlci5nZXRSZXNvdXJjZVBhdGgocGx1Z2luUGF0aCk7XG4gIH1cblxuICBhc3luYyB1cGRhdGVTZXR0aW5ncyh1cGRhdGU6IFBhcnRpYWw8Rm9yZ2VTZXR0aW5ncz4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmZvcmdlU2V0dGluZ3MgPSB7IC4uLnRoaXMuZm9yZ2VTZXR0aW5ncywgLi4udXBkYXRlIH07XG4gICAgYXdhaXQgc2F2ZUZvcmdlU2V0dGluZ3ModGhpcywgdGhpcy5mb3JnZVNldHRpbmdzKTtcbiAgICBpZiAodXBkYXRlLnByZWZlcnJlZE1vZGVsICE9PSB1bmRlZmluZWQpIHtcbiAgICAgIHRoaXMubGVhcm5pbmcuc2V0TW9kZWwodXBkYXRlLnByZWZlcnJlZE1vZGVsIHx8IHVuZGVmaW5lZCk7XG4gICAgfVxuICB9XG5cbiAgcHJpdmF0ZSBvcGVuU2V0dGluZ3MoKTogdm9pZCB7XG4gICAgY29uc3QgYXBwID0gdGhpcy5hcHAgYXMgdHlwZW9mIHRoaXMuYXBwICYge1xuICAgICAgc2V0dGluZzoge1xuICAgICAgICBvcGVuKCk6IHZvaWQ7XG4gICAgICAgIG9wZW5UYWJCeUlkKGlkOiBzdHJpbmcpOiB2b2lkO1xuICAgICAgfTtcbiAgICB9O1xuICAgIGFwcC5zZXR0aW5nLm9wZW4oKTtcbiAgICBhcHAuc2V0dGluZy5vcGVuVGFiQnlJZCh0aGlzLm1hbmlmZXN0LmlkKTtcbiAgfVxufVxuIiwgImltcG9ydCB7IENoaWxkUHJvY2Vzcywgc3Bhd24gfSBmcm9tIFwiY2hpbGRfcHJvY2Vzc1wiO1xyXG5pbXBvcnQgeyBleGlzdHNTeW5jIH0gZnJvbSBcImZzXCI7XHJcbmltcG9ydCB7IGhvbWVkaXIgfSBmcm9tIFwib3NcIjtcclxuaW1wb3J0IHsgam9pbiB9IGZyb20gXCJwYXRoXCI7XHJcbmltcG9ydCB7XHJcbiAgQWdlbnRBZGFwdGVyLFxyXG4gIEFnZW50SW5wdXQsXHJcbiAgQWdlbnRDb250ZXh0LFxyXG4gIEFnZW50U3RyZWFtRXZlbnQsXG4gIEFnZW50TW9kZWwsXG4gIEFnZW50RmFpbHVyZSxcbiAgQWdlbnRIZWFsdGgsXG4gIEFnZW50UnVudGltZUNvbmZpZyxcbiAgU2VuZE9wdGlvbnMsXHJcbn0gZnJvbSBcIi4uL3R5cGVzXCI7XHJcblxyXG5mdW5jdGlvbiBlc2NhcGVBdHRyaWJ1dGUodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgcmV0dXJuIHZhbHVlXHJcbiAgICAucmVwbGFjZSgvJi9nLCBcIiZhbXA7XCIpXHJcbiAgICAucmVwbGFjZSgvXCIvZywgXCImcXVvdDtcIilcclxuICAgIC5yZXBsYWNlKC88L2csIFwiJmx0O1wiKVxyXG4gICAgLnJlcGxhY2UoLz4vZywgXCImZ3Q7XCIpO1xyXG59XHJcblxyXG4vLyBBR1kgcHJpbnQtbW9kZSBwcm90b2NvbCB1c2VkIGJ5IHRoaXMgYWRhcHRlcjpcclxuLy9cclxuLy8gICBhZ3kgLS1wcmludCA8cHJvbXB0PiAtLW91dHB1dC1mb3JtYXQgc3RyZWFtLWpzb24gWy0tbW9kZWwgPGlkPl1cclxuLy8gICAgICAgWy0tY29udmVyc2F0aW9uIDxpZD5dXHJcbi8vXHJcbi8vIHN0ZG91dCBpcyBOREpTT046XHJcbi8vICAge1wiZXZlbnRcIjpcImluaXRcIiwgLi4ufVxyXG4vLyAgIHtcImV2ZW50XCI6XCJzdGVwX3VwZGF0ZVwiLFwic3RlcF91cGRhdGVcIjp7XCJzdGVwX3R5cGVcIjpcImFnZW50X3Jlc3BvbnNlXCIsXCJ0ZXh0X2RlbHRhXCI6XCIuLi5cIn19XHJcbi8vICAge1wiZXZlbnRcIjpcInJlc3VsdFwiLFwicmVzdWx0XCI6e1wic3RhdHVzXCI6XCJTVUNDRVNTfEVSUk9SfC4uLlwiLFwicmVzcG9uc2VcIjpcIi4uLlwiLFwiZXJyb3JcIjpcIi4uLlwifX1cclxuLy9cclxuLy8gRWFjaCBzZW5kKCkgc3RhcnRzIG9uZSBwcmludC1tb2RlIHByb2Nlc3MuIENvbnZlcnNhdGlvbiBjb250aW51aXR5IGlzIHJlc3RvcmVkXHJcbi8vIHdpdGggLS1jb252ZXJzYXRpb24gPGlkPi4gVGhlIFVJIG9ubHkgc2VlcyBub3JtYWxpemVkIEFnZW50U3RyZWFtRXZlbnQgdmFsdWVzLlxuXHJcbmV4cG9ydCBjbGFzcyBBZ3lBZGFwdGVyIGltcGxlbWVudHMgQWdlbnRBZGFwdGVyIHtcbiAgY29uc3RydWN0b3IoXG4gICAgcHJpdmF0ZSByZWFkb25seSBjd2Q/OiBzdHJpbmcsXG4gICAgcHJpdmF0ZSByZWFkb25seSBnZXRDb25maWc6ICgpID0+IEFnZW50UnVudGltZUNvbmZpZyA9ICgpID0+ICh7fSksXG4gICkge31cblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBiaW5hcnkgcmVzb2x1dGlvbiBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbiAgYXN5bmMgY2hlY2soKTogUHJvbWlzZTxBZ2VudEhlYWx0aD4ge1xuICAgIHRyeSB7XG4gICAgICBhd2FpdCB0aGlzLnJlc29sdmVCaW5hcnkoKTtcbiAgICAgIHJldHVybiB7IHN0YXR1czogXCJyZWFkeVwiIH07XG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcbiAgICAgIGNvbnN0IGNvbmZpZ3VyZWQgPSB0aGlzLmdldENvbmZpZygpLmV4ZWN1dGFibGVQYXRoPy50cmltKCk7XG4gICAgICByZXR1cm4ge1xuICAgICAgICBzdGF0dXM6IGNvbmZpZ3VyZWQgPyBcIm1pc2NvbmZpZ3VyZWRcIiA6IFwidW5hdmFpbGFibGVcIixcbiAgICAgICAgZmFpbHVyZTogdGhpcy5mYWlsdXJlRnJvbShlcnJvciwgXCJydW50aW1lLXVuYXZhaWxhYmxlXCIpLFxuICAgICAgfTtcbiAgICB9XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHJlc29sdmVCaW5hcnkoKTogUHJvbWlzZTxzdHJpbmc+IHtcbiAgICBjb25zdCBjb25maWd1cmVkID1cbiAgICAgIHRoaXMuZ2V0Q29uZmlnKCkuZXhlY3V0YWJsZVBhdGg/LnRyaW0oKSB8fFxuICAgICAgcHJvY2Vzcy5lbnYuQUdZX1BBVEg/LnRyaW0oKTtcbiAgICBpZiAoY29uZmlndXJlZCAmJiAhZXhpc3RzU3luYyhjb25maWd1cmVkKSkge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKGBDb25maWd1cmVkIGFnZW50IGV4ZWN1dGFibGUgZG9lcyBub3QgZXhpc3Q6ICR7Y29uZmlndXJlZH1gKTtcbiAgICB9XG4gICAgY29uc3QgY2FuZGlkYXRlcyA9IFtcclxuICAgICAgY29uZmlndXJlZCxcclxuICAgICAgLi4uKHByb2Nlc3MucGxhdGZvcm0gPT09IFwid2luMzJcIlxyXG4gICAgICAgID8gW1xyXG4gICAgICAgICAgICBwcm9jZXNzLmVudi5MT0NBTEFQUERBVEFcclxuICAgICAgICAgICAgICA/IGpvaW4ocHJvY2Vzcy5lbnYuTE9DQUxBUFBEQVRBLCBcImFneVwiLCBcImJpblwiLCBcImFneS5leGVcIilcclxuICAgICAgICAgICAgICA6IHVuZGVmaW5lZCxcclxuICAgICAgICAgICAgcHJvY2Vzcy5lbnYuUHJvZ3JhbUZpbGVzXHJcbiAgICAgICAgICAgICAgPyBqb2luKHByb2Nlc3MuZW52LlByb2dyYW1GaWxlcywgXCJHb29nbGVcIiwgXCJhbnRpZ3Jhdml0eS1jbGlcIiwgXCJhZ3kuZXhlXCIpXHJcbiAgICAgICAgICAgICAgOiB1bmRlZmluZWQsXHJcbiAgICAgICAgICBdXHJcbiAgICAgICAgOiBbam9pbihob21lZGlyKCksIFwiLmxvY2FsXCIsIFwiYmluXCIsIFwiYWd5XCIpXSksXHJcbiAgICBdLmZpbHRlcigodmFsdWUpOiB2YWx1ZSBpcyBzdHJpbmcgPT4gQm9vbGVhbih2YWx1ZSkpO1xyXG5cclxuICAgIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIGNhbmRpZGF0ZXMpIHtcclxuICAgICAgaWYgKGV4aXN0c1N5bmMoY2FuZGlkYXRlKSkgcmV0dXJuIGNhbmRpZGF0ZTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICBjb25zdCBsb2NhdG9yID0gcHJvY2Vzcy5wbGF0Zm9ybSA9PT0gXCJ3aW4zMlwiID8gXCJ3aGVyZVwiIDogXCJ3aGljaFwiO1xyXG4gICAgICBjb25zdCBwID0gc3Bhd24obG9jYXRvciwgW1wiYWd5XCJdKTtcclxuICAgICAgbGV0IG91dCA9IFwiXCI7XHJcbiAgICAgIGxldCBzZXR0bGVkID0gZmFsc2U7XHJcblxyXG4gICAgICBjb25zdCBmYWlsID0gKCkgPT4ge1xyXG4gICAgICAgIGlmIChzZXR0bGVkKSByZXR1cm47XHJcbiAgICAgICAgc2V0dGxlZCA9IHRydWU7XHJcbiAgICAgICAgcmVqZWN0KFxyXG4gICAgICAgICAgbmV3IEVycm9yKFxyXG4gICAgICAgICAgICBcIkFHWSBDTEkgbm90IGZvdW5kLiBJbnN0YWxsIGl0LCByZXN0YXJ0IE9ic2lkaWFuIGFmdGVyIGNoYW5naW5nIFBBVEgsIG9yIHNldCBBR1lfUEFUSCB0byB0aGUgQUdZIGV4ZWN1dGFibGUuXCIsXHJcbiAgICAgICAgICApLFxyXG4gICAgICAgICk7XHJcbiAgICAgIH07XHJcblxyXG4gICAgICBwLnN0ZG91dD8ub24oXCJkYXRhXCIsIChkOiBCdWZmZXIpID0+IChvdXQgKz0gZC50b1N0cmluZygpKSk7XHJcbiAgICAgIHAub24oXCJlcnJvclwiLCBmYWlsKTtcclxuICAgICAgcC5vbihcImNsb3NlXCIsIChjb2RlKSA9PiB7XHJcbiAgICAgICAgaWYgKHNldHRsZWQpIHJldHVybjtcclxuICAgICAgICBpZiAoY29kZSA9PT0gMCAmJiBvdXQudHJpbSgpKSB7XHJcbiAgICAgICAgICBzZXR0bGVkID0gdHJ1ZTtcclxuICAgICAgICAgIHJlc29sdmUob3V0LnRyaW0oKS5zcGxpdCgvXFxyP1xcbi8pWzBdKTtcclxuICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcbiAgICAgICAgZmFpbCgpO1xyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgLy8gXHUyNTAwXHUyNTAwIHNlbmQgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4gIGFzeW5jICpzZW5kKFxuICAgIGlucHV0OiBBZ2VudElucHV0LFxuICAgIG9wdHM6IFNlbmRPcHRpb25zLFxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXG4gICk6IEFzeW5jSXRlcmFibGU8QWdlbnRTdHJlYW1FdmVudD4ge1xuICAgIGlmIChzaWduYWwuYWJvcnRlZCkge1xuICAgICAgeWllbGQgeyB0eXBlOiBcImNhbmNlbGxlZFwiIH07XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgbGV0IGJpbjogc3RyaW5nO1xuICAgIHRyeSB7XG4gICAgICBiaW4gPSBhd2FpdCB0aGlzLnJlc29sdmVCaW5hcnkoKTtcbiAgICB9IGNhdGNoIChlcnJvcikge1xuICAgICAgeWllbGQge1xuICAgICAgICB0eXBlOiBcImZhaWxlZFwiLFxuICAgICAgICBmYWlsdXJlOiB0aGlzLmZhaWx1cmVGcm9tKGVycm9yLCBcInJ1bnRpbWUtdW5hdmFpbGFibGVcIiksXG4gICAgICB9O1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBjb25zdCBmdWxsUHJvbXB0ID0gdGhpcy5idWlsZEZ1bGxQcm9tcHQoaW5wdXQpO1xyXG4gICAgY29uc3QgYXJncyA9IHRoaXMuYnVpbGRBcmdzKGZ1bGxQcm9tcHQsIG9wdHMpO1xyXG5cclxuICAgIGNvbnN0IHByb2MgPSBzcGF3bihiaW4sIGFyZ3MsIHtcclxuICAgICAgY3dkOiB0aGlzLmN3ZCxcclxuICAgICAgc3RkaW86IFtcImlnbm9yZVwiLCBcInBpcGVcIiwgXCJwaXBlXCJdLFxyXG4gICAgICB3aW5kb3dzSGlkZTogdHJ1ZSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGFib3J0ID0gKCkgPT4ge1xuICAgICAgaWYgKHByb2MuZXhpdENvZGUgPT09IG51bGwgJiYgIXByb2Mua2lsbGVkKSBwcm9jLmtpbGwoXCJTSUdURVJNXCIpO1xuICAgIH07XG4gICAgc2lnbmFsLmFkZEV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydCwgeyBvbmNlOiB0cnVlIH0pO1xuXG4gICAgdHJ5IHtcbiAgICAgIHlpZWxkKiB0aGlzLnJlYWRFdmVudHMocHJvYywgc2lnbmFsKTtcbiAgICB9IGZpbmFsbHkge1xuICAgICAgc2lnbmFsLnJlbW92ZUV2ZW50TGlzdGVuZXIoXCJhYm9ydFwiLCBhYm9ydCk7XG4gICAgICBhYm9ydCgpO1xuICAgIH1cbiAgfVxyXG5cclxuICBwcml2YXRlIGJ1aWxkQXJncyhwcm9tcHQ6IHN0cmluZywgb3B0czogU2VuZE9wdGlvbnMpOiBzdHJpbmdbXSB7XHJcbiAgICBjb25zdCBhcmdzID0gW1xyXG4gICAgICBcIi0tcHJpbnRcIixcclxuICAgICAgcHJvbXB0LFxyXG4gICAgICBcIi0tb3V0cHV0LWZvcm1hdFwiLFxyXG4gICAgICBcInN0cmVhbS1qc29uXCIsXHJcbiAgICBdO1xuXHJcbiAgICBpZiAob3B0cy5tb2RlbCkge1xyXG4gICAgICBhcmdzLnB1c2goXCItLW1vZGVsXCIsIG9wdHMubW9kZWwpO1xyXG4gICAgfVxyXG4gICAgaWYgKG9wdHMuY29udmVyc2F0aW9uSWQpIHtcclxuICAgICAgYXJncy5wdXNoKFwiLS1jb252ZXJzYXRpb25cIiwgb3B0cy5jb252ZXJzYXRpb25JZCk7XHJcbiAgICB9XHJcbiAgICByZXR1cm4gYXJncztcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIEZvcm1hdCBBZ2VudElucHV0IHdpdGggY29udGV4dCBhcyBhIHN0cnVjdHVyZWQgcHJlYW1ibGUgYmVmb3JlIHByb21wdC5cclxuICAgKi9cclxuICBwcml2YXRlIGJ1aWxkRnVsbFByb21wdChpbnB1dDogQWdlbnRJbnB1dCk6IHN0cmluZyB7XHJcbiAgICBjb25zdCBjb250ZXh0UHJlYW1ibGUgPSB0aGlzLmZvcm1hdENvbnRleHQoaW5wdXQuY29udGV4dCk7XHJcbiAgICByZXR1cm4gY29udGV4dFByZWFtYmxlXHJcbiAgICAgID8gYCR7Y29udGV4dFByZWFtYmxlfVxcblxcbi0tLVxcblxcbiR7aW5wdXQucHJvbXB0fWBcclxuICAgICAgOiBpbnB1dC5wcm9tcHQ7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGZvcm1hdENvbnRleHQoY3R4OiBBZ2VudENvbnRleHRbXSk6IHN0cmluZyB7XHJcbiAgICBpZiAoY3R4Lmxlbmd0aCA9PT0gMCkgcmV0dXJuIFwiXCI7XHJcblxyXG4gICAgcmV0dXJuIGN0eFxyXG4gICAgICAubWFwKChjLCBpbmRleCkgPT4ge1xyXG4gICAgICAgIGNvbnN0IHR5cGUgPSBjLnR5cGUgPT09IFwic2VsZWN0aW9uXCIgPyBcInNlbGVjdGlvblwiIDogXCJub3RlXCI7XHJcbiAgICAgICAgY29uc3QgaGVhZGVyID0gYDxvYnNpZGlhbi1jb250ZXh0IGluZGV4PVwiJHtpbmRleCArIDF9XCIgdHlwZT1cIiR7dHlwZX1cIiBmaWxlPVwiJHtlc2NhcGVBdHRyaWJ1dGUoYy5maWxlKX1cIj5gO1xyXG5cclxuICAgICAgICByZXR1cm4gYCR7aGVhZGVyfVxcbiR7Yy5jb250ZW50fVxcbjwvb2JzaWRpYW4tY29udGV4dD5gO1xyXG4gICAgICB9KVxyXG4gICAgICAuam9pbihcIlxcblxcblwiKTtcclxuICB9XHJcblxyXG4gIC8vIFx1MjUwMFx1MjUwMCBzdGRvdXQgcmVhZGVyIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxyXG5cclxuICBwcml2YXRlIGFzeW5jICpyZWFkRXZlbnRzKFxuICAgIHByb2M6IENoaWxkUHJvY2VzcyxcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxuICApOiBBc3luY0l0ZXJhYmxlPEFnZW50U3RyZWFtRXZlbnQ+IHtcbiAgICBsZXQgYnVmZmVyID0gXCJcIjtcclxuICAgIGxldCBzdGRlcnIgPSBcIlwiO1xyXG4gICAgbGV0IGV4aXRDb2RlOiBudW1iZXIgfCBudWxsID0gbnVsbDtcclxuICAgIGNvbnN0IHByb2Nlc3NTdGF0ZTogeyBzcGF3bkVycm9yPzogRXJyb3IgfSA9IHt9O1xyXG4gICAgbGV0IGNsb3NlZCA9IGZhbHNlO1xyXG4gICAgbGV0IHNhd1Rlcm1pbmFsRXZlbnQgPSBmYWxzZTtcbiAgICBsZXQgY29udmVyc2F0aW9uSWQ6IHN0cmluZyB8IHVuZGVmaW5lZDtcblxyXG4gICAgY29uc3QgcXVldWU6IHN0cmluZ1tdID0gW107XHJcbiAgICBsZXQgbm90aWZ5OiAoKCkgPT4gdm9pZCkgfCBudWxsID0gbnVsbDtcclxuXHJcbiAgICBjb25zdCB3YWtlID0gKCkgPT4ge1xyXG4gICAgICBub3RpZnk/LigpO1xyXG4gICAgICBub3RpZnkgPSBudWxsO1xyXG4gICAgfTtcclxuXHJcbiAgICBjb25zdCBwdXNoID0gKGxpbmU6IHN0cmluZykgPT4ge1xyXG4gICAgICBxdWV1ZS5wdXNoKGxpbmUpO1xyXG4gICAgICB3YWtlKCk7XHJcbiAgICB9O1xyXG5cclxuICAgIHByb2Muc3Rkb3V0Py5vbihcImRhdGFcIiwgKGNodW5rOiBCdWZmZXIpID0+IHtcclxuICAgICAgYnVmZmVyICs9IGNodW5rLnRvU3RyaW5nKCk7XHJcbiAgICAgIGNvbnN0IHBhcnRzID0gYnVmZmVyLnNwbGl0KC9cXHI/XFxuLyk7XHJcbiAgICAgIGJ1ZmZlciA9IHBhcnRzLnBvcCgpID8/IFwiXCI7XHJcblxyXG4gICAgICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcclxuICAgICAgICBjb25zdCBsaW5lID0gcGFydC50cmltKCk7XHJcbiAgICAgICAgaWYgKGxpbmUpIHB1c2gobGluZSk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIHByb2Muc3RkZXJyPy5vbihcImRhdGFcIiwgKGNodW5rOiBCdWZmZXIpID0+IHtcclxuICAgICAgY29uc3QgbXNnID0gY2h1bmsudG9TdHJpbmcoKTtcclxuICAgICAgc3RkZXJyICs9IG1zZztcclxuICAgICAgY29uc3QgdHJpbW1lZCA9IG1zZy50cmltKCk7XHJcbiAgICAgIGlmICh0cmltbWVkKSBjb25zb2xlLndhcm4oXCJbRm9yZ2UgYWdlbnQgcHJvdmlkZXJdXCIsIHRyaW1tZWQpO1xuICAgIH0pO1xyXG5cclxuICAgIHByb2Mub24oXCJlcnJvclwiLCAoZXJyKSA9PiB7XHJcbiAgICAgIHByb2Nlc3NTdGF0ZS5zcGF3bkVycm9yID0gZXJyO1xyXG4gICAgICB3YWtlKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBwcm9jLm9uKFwiY2xvc2VcIiwgKGNvZGUpID0+IHtcclxuICAgICAgZXhpdENvZGUgPSBjb2RlO1xyXG4gICAgICBjb25zdCBmaW5hbExpbmUgPSBidWZmZXIudHJpbSgpO1xyXG4gICAgICBidWZmZXIgPSBcIlwiO1xyXG4gICAgICBpZiAoZmluYWxMaW5lKSBxdWV1ZS5wdXNoKGZpbmFsTGluZSk7XHJcbiAgICAgIGNsb3NlZCA9IHRydWU7XHJcbiAgICAgIHdha2UoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIHdoaWxlICh0cnVlKSB7XG4gICAgICBpZiAoc2lnbmFsLmFib3J0ZWQpIHtcbiAgICAgICAgeWllbGQgeyB0eXBlOiBcImNhbmNlbGxlZFwiIH07XG4gICAgICAgIGJyZWFrO1xuICAgICAgfVxuXG4gICAgICBpZiAocXVldWUubGVuZ3RoID4gMCkge1xyXG4gICAgICAgIGNvbnN0IGxpbmUgPSBxdWV1ZS5zaGlmdCgpITtcbiAgICAgICAgY29udmVyc2F0aW9uSWQgPSB0aGlzLnJlYWRDb252ZXJzYXRpb25JZChsaW5lKSA/PyBjb252ZXJzYXRpb25JZDtcbiAgICAgICAgY29uc3QgZXZlbnQgPSB0aGlzLnBhcnNlTGluZShsaW5lLCBjb252ZXJzYXRpb25JZCk7XG5cclxuICAgICAgICBpZiAoIWV2ZW50KSBjb250aW51ZTtcclxuXHJcbiAgICAgICAgeWllbGQgZXZlbnQ7XHJcblxyXG4gICAgICAgIGlmIChldmVudC50eXBlID09PSBcImNvbXBsZXRlZFwiIHx8IGV2ZW50LnR5cGUgPT09IFwiZmFpbGVkXCIpIHtcbiAgICAgICAgICBzYXdUZXJtaW5hbEV2ZW50ID0gdHJ1ZTtcclxuICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChjbG9zZWQpIHtcbiAgICAgICAgaWYgKCFzYXdUZXJtaW5hbEV2ZW50KSB7XG4gICAgICAgICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XG4gICAgICAgICAgICB5aWVsZCB7IHR5cGU6IFwiY2FuY2VsbGVkXCIgfTtcbiAgICAgICAgICAgIGJyZWFrO1xuICAgICAgICAgIH1cbiAgICAgICAgICBjb25zdCBkZXRhaWwgPVxyXG4gICAgICAgICAgICBwcm9jZXNzU3RhdGUuc3Bhd25FcnJvcj8ubWVzc2FnZSB8fFxyXG4gICAgICAgICAgICBzdGRlcnIudHJpbSgpIHx8XHJcbiAgICAgICAgICAgIChleGl0Q29kZSAhPT0gMFxyXG4gICAgICAgICAgICAgID8gYEFHWSBleGl0ZWQgd2l0aCBjb2RlICR7ZXhpdENvZGUgPz8gXCJ1bmtub3duXCJ9IGJlZm9yZSByZXR1cm5pbmcgYSByZXN1bHQuYFxyXG4gICAgICAgICAgICAgIDogXCJBR1kgZXhpdGVkIHdpdGhvdXQgcmV0dXJuaW5nIGEgcmVzdWx0LlwiKTtcclxuXHJcbiAgICAgICAgICB5aWVsZCB7XG4gICAgICAgICAgICB0eXBlOiBcImZhaWxlZFwiLFxuICAgICAgICAgICAgZmFpbHVyZTogdGhpcy5mYWlsdXJlRnJvbShkZXRhaWwsIFwicHJvY2Vzcy1mYWlsZWRcIiksXG4gICAgICAgICAgfTtcbiAgICAgICAgfVxyXG4gICAgICAgIGJyZWFrO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAocHJvY2Vzc1N0YXRlLnNwYXduRXJyb3IpIHtcbiAgICAgICAgeWllbGQge1xuICAgICAgICAgIHR5cGU6IFwiZmFpbGVkXCIsXG4gICAgICAgICAgZmFpbHVyZTogdGhpcy5mYWlsdXJlRnJvbShwcm9jZXNzU3RhdGUuc3Bhd25FcnJvciwgXCJwcm9jZXNzLWZhaWxlZFwiKSxcbiAgICAgICAgfTtcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlKSA9PiB7XHJcbiAgICAgICAgbm90aWZ5ID0gcmVzb2x2ZTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBQYXJzZSBvbmUgQUdZIE5ESlNPTiBsaW5lIGludG8gYSBub3JtYWxpemVkIGV2ZW50LlxyXG4gICAqL1xyXG4gIHByaXZhdGUgcGFyc2VMaW5lKFxuICAgIGxpbmU6IHN0cmluZyxcbiAgICBjb252ZXJzYXRpb25JZD86IHN0cmluZyxcbiAgKTogQWdlbnRTdHJlYW1FdmVudCB8IG51bGwge1xuICAgIGxldCBvYmo6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIG9iaiA9IEpTT04ucGFyc2UobGluZSk7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgLy8gc3Rkb3V0IHNob3VsZCBiZSBtYWNoaW5lLXJlYWRhYmxlIGluIHN0cmVhbS1qc29uIG1vZGUuIElnbm9yZSBhblxyXG4gICAgICAvLyB1bmV4cGVjdGVkIGRpYWdub3N0aWMgbGluZSBoZXJlOyBzdGRlcnIvZXhpdCBoYW5kbGluZyB3aWxsIHN0aWxsXHJcbiAgICAgIC8vIHN1cmZhY2UgYSBmYWlsZWQgcnVuIHRvIHRoZSBVSS5cclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgZXYgPSBvYmpbXCJldmVudFwiXSBhcyBzdHJpbmcgfCB1bmRlZmluZWQ7XHJcblxyXG4gICAgaWYgKGV2ID09PSBcImluaXRcIikge1xyXG4gICAgICByZXR1cm4gbnVsbDtcbiAgICB9XHJcblxyXG4gICAgaWYgKGV2ID09PSBcInN0ZXBfdXBkYXRlXCIpIHtcclxuICAgICAgY29uc3Qgc3UgPSBvYmpbXCJzdGVwX3VwZGF0ZVwiXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZDtcclxuICAgICAgY29uc3QgZGVsdGEgPSBzdT8uW1widGV4dF9kZWx0YVwiXSBhcyBzdHJpbmcgfCB1bmRlZmluZWQ7XHJcblxyXG4gICAgICBpZiAoZGVsdGEpIHJldHVybiB7IHR5cGU6IFwidGV4dFwiLCBjb250ZW50OiBkZWx0YSB9O1xyXG4gICAgICByZXR1cm4gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICAvLyBDb21wYXRpYmlsaXR5IHdpdGggb2xkZXIgbW9ja3MvcHJvdG9jb2wgZXhwZXJpbWVudHMuXHJcbiAgICBpZiAoZXYgPT09IFwidGV4dFwiKSB7XHJcbiAgICAgIGNvbnN0IHRleHQgPSBvYmpbXCJ0ZXh0XCJdIGFzIHN0cmluZyB8IHVuZGVmaW5lZDtcclxuICAgICAgaWYgKHRleHQpIHJldHVybiB7IHR5cGU6IFwidGV4dFwiLCBjb250ZW50OiB0ZXh0IH07XHJcbiAgICAgIHJldHVybiBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChldiA9PT0gXCJyZXN1bHRcIikge1xyXG4gICAgICBjb25zdCByZXN1bHQgPSBvYmpbXCJyZXN1bHRcIl0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQ7XHJcbiAgICAgIGNvbnN0IHN0YXR1cyA9IFN0cmluZyhyZXN1bHQ/LltcInN0YXR1c1wiXSA/PyBcIlwiKS50b1VwcGVyQ2FzZSgpO1xyXG4gICAgICBjb25zdCBjb252SWQgPVxuICAgICAgICAocmVzdWx0Py5bXCJjb252ZXJzYXRpb25faWRcIl0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkKSB8fCBjb252ZXJzYXRpb25JZDtcblxyXG4gICAgICAvLyBBR1kgcmVwb3J0cyBwcmludC1tb2RlIGZhaWx1cmVzIGluc2lkZSB0aGUgdGVybWluYWwgcmVzdWx0IGVudmVsb3BlLlxyXG4gICAgICAvLyBUcmVhdCBldmVyeSBleHBsaWNpdCBub24tU1VDQ0VTUyB0ZXJtaW5hbCBzdGF0ZSBhcyBhbiBlcnJvciBpbnN0ZWFkXHJcbiAgICAgIC8vIG9mIHNpbGVudGx5IGNvbnZlcnRpbmcgaXQgdG8gXCJkb25lXCIuXHJcbiAgICAgIGlmIChzdGF0dXMgJiYgc3RhdHVzICE9PSBcIlNVQ0NFU1NcIikge1xyXG4gICAgICAgIGNvbnN0IG1lc3NhZ2UgPSBTdHJpbmcoXHJcbiAgICAgICAgICByZXN1bHQ/LltcImVycm9yXCJdID8/XHJcbiAgICAgICAgICAgIGBBR1kgZmluaXNoZWQgd2l0aCBzdGF0dXMgJHtzdGF0dXN9IHdpdGhvdXQgYW4gZXJyb3IgbWVzc2FnZS5gLFxyXG4gICAgICAgICk7XHJcblxyXG4gICAgICAgIHJldHVybiB7XG4gICAgICAgICAgdHlwZTogXCJmYWlsZWRcIixcbiAgICAgICAgICBmYWlsdXJlOiB0aGlzLmZhaWx1cmVGcm9tKG1lc3NhZ2UsIHRoaXMuY2xhc3NpZnlGYWlsdXJlKG1lc3NhZ2UpKSxcbiAgICAgICAgfTtcbiAgICAgIH1cblxuICAgICAgcmV0dXJuIHsgdHlwZTogXCJjb21wbGV0ZWRcIiwgY29udmVyc2F0aW9uSWQ6IGNvbnZJZCB9O1xuICAgIH1cclxuXHJcbiAgICBpZiAoZXYgPT09IFwiZXJyb3JcIikge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHR5cGU6IFwiZmFpbGVkXCIsXG4gICAgICAgIGZhaWx1cmU6IHRoaXMuZmFpbHVyZUZyb20oXG4gICAgICAgICAgU3RyaW5nKG9ialtcImVycm9yXCJdID8/IFwiVW5rbm93biBhZ2VudCBydW50aW1lIGVycm9yXCIpLFxuICAgICAgICAgIFwicHJvY2Vzcy1mYWlsZWRcIixcbiAgICAgICAgKSxcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIG51bGw7XG4gIH1cblxuICBwcml2YXRlIHJlYWRDb252ZXJzYXRpb25JZChsaW5lOiBzdHJpbmcpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xuICAgIHRyeSB7XG4gICAgICBjb25zdCB2YWx1ZSA9IEpTT04ucGFyc2UobGluZSkgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XG4gICAgICBpZiAodmFsdWVbXCJldmVudFwiXSAhPT0gXCJpbml0XCIpIHJldHVybiB1bmRlZmluZWQ7XG4gICAgICByZXR1cm4gKFxuICAgICAgICAodmFsdWVbXCJjb252ZXJzYXRpb25faWRcIl0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkKSB8fFxuICAgICAgICAoKHZhbHVlW1wiaW5pdFwiXSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPiB8IHVuZGVmaW5lZCk/LltcbiAgICAgICAgICBcImNvbnZlcnNhdGlvbl9pZFwiXG4gICAgICAgIF0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkKVxuICAgICAgKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHJldHVybiB1bmRlZmluZWQ7XG4gICAgfVxuICB9XG5cclxuICAvLyBcdTI1MDBcdTI1MDAgbGlzdE1vZGVscyBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbiAgYXN5bmMgbGlzdE1vZGVscygpOiBQcm9taXNlPEFnZW50TW9kZWxbXT4ge1xuICAgIGNvbnN0IGJpbiA9IGF3YWl0IHRoaXMucmVzb2x2ZUJpbmFyeSgpO1xuXHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICBjb25zdCBwID0gc3Bhd24oYmluLCBbXCJtb2RlbHNcIl0sIHtcclxuICAgICAgICBjd2Q6IHRoaXMuY3dkLFxyXG4gICAgICAgIHdpbmRvd3NIaWRlOiB0cnVlLFxyXG4gICAgICB9KTtcclxuICAgICAgbGV0IG91dCA9IFwiXCI7XHJcbiAgICAgIGxldCBlcnIgPSBcIlwiO1xyXG5cclxuICAgICAgcC5zdGRvdXQ/Lm9uKFwiZGF0YVwiLCAoZDogQnVmZmVyKSA9PiAob3V0ICs9IGQudG9TdHJpbmcoKSkpO1xyXG4gICAgICBwLnN0ZGVycj8ub24oXCJkYXRhXCIsIChkOiBCdWZmZXIpID0+IChlcnIgKz0gZC50b1N0cmluZygpKSk7XHJcbiAgICAgIHAub24oXCJlcnJvclwiLCByZWplY3QpO1xyXG4gICAgICBwLm9uKFwiY2xvc2VcIiwgKGNvZGUpID0+IHtcclxuICAgICAgICBpZiAoY29kZSAhPT0gMCkge1xyXG4gICAgICAgICAgcmVqZWN0KFxyXG4gICAgICAgICAgICBuZXcgRXJyb3IoXHJcbiAgICAgICAgICAgICAgZXJyLnRyaW0oKSB8fCBgRmFpbGVkIHRvIGxpc3QgQUdZIG1vZGVscyAoZXhpdCAke2NvZGUgPz8gXCJ1bmtub3duXCJ9KS5gLFxyXG4gICAgICAgICAgICApLFxyXG4gICAgICAgICAgKTtcclxuICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IG1vZGVsczogQWdlbnRNb2RlbFtdID0gb3V0XG4gICAgICAgICAgLnNwbGl0KC9cXHI/XFxuLylcclxuICAgICAgICAgIC5tYXAoKGxpbmUpID0+IGxpbmUudHJpbSgpKVxyXG4gICAgICAgICAgLmZpbHRlcihCb29sZWFuKVxyXG4gICAgICAgICAgLm1hcCgobGluZSkgPT4ge1xyXG4gICAgICAgICAgICAvLyBDdXJyZW50IGh1bWFuLXJlYWRhYmxlIG91dHB1dCBpcyBjb2x1bW4tb3JpZW50ZWQuIEFjY2VwdCB0YWJzXHJcbiAgICAgICAgICAgIC8vIGFuZCAyKyBzcGFjZXMgc28gdGhlIHNlbGVjdG9yIHN0aWxsIHdvcmtzIGFjcm9zcyBDTEkgdmVyc2lvbnMuXHJcbiAgICAgICAgICAgIGNvbnN0IGNvbHVtbnMgPSBsaW5lLnNwbGl0KC9cXHQrfFxcc3syLH0vKS5maWx0ZXIoQm9vbGVhbik7XHJcbiAgICAgICAgICAgIGlmIChjb2x1bW5zLmxlbmd0aCA8IDIpIHJldHVybiBudWxsO1xyXG4gICAgICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgICAgIGlkOiBjb2x1bW5zWzBdLnRyaW0oKSxcclxuICAgICAgICAgICAgICBuYW1lOiBjb2x1bW5zLnNsaWNlKDEpLmpvaW4oXCIgXCIpLnRyaW0oKSxcclxuICAgICAgICAgICAgfTtcclxuICAgICAgICAgIH0pXHJcbiAgICAgICAgICAuZmlsdGVyKChtb2RlbCk6IG1vZGVsIGlzIEFnZW50TW9kZWwgPT4gbW9kZWwgIT09IG51bGwpO1xuXHJcbiAgICAgICAgcmVzb2x2ZShtb2RlbHMpO1xyXG4gICAgICB9KTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjbGFzc2lmeUZhaWx1cmUobWVzc2FnZTogc3RyaW5nKTogQWdlbnRGYWlsdXJlW1wiY29kZVwiXSB7XG4gICAgY29uc3Qgbm9ybWFsaXplZCA9IG1lc3NhZ2UudG9Mb3dlckNhc2UoKTtcbiAgICBpZiAobm9ybWFsaXplZC5pbmNsdWRlcyhcInBlcm1pc3Npb25cIikgfHwgbm9ybWFsaXplZC5pbmNsdWRlcyhcImFwcHJvdmFsXCIpKSB7XG4gICAgICByZXR1cm4gXCJwZXJtaXNzaW9uLXJlcXVpcmVkXCI7XG4gICAgfVxuICAgIGlmIChub3JtYWxpemVkLmluY2x1ZGVzKFwianNvblwiKSB8fCBub3JtYWxpemVkLmluY2x1ZGVzKFwicHJvdG9jb2xcIikpIHtcbiAgICAgIHJldHVybiBcInByb3RvY29sLWludmFsaWRcIjtcbiAgICB9XG4gICAgcmV0dXJuIFwicHJvY2Vzcy1mYWlsZWRcIjtcbiAgfVxuXG4gIHByaXZhdGUgZmFpbHVyZUZyb20oXG4gICAgZXJyb3I6IHVua25vd24sXG4gICAgY29kZTogQWdlbnRGYWlsdXJlW1wiY29kZVwiXSxcbiAgKTogQWdlbnRGYWlsdXJlIHtcbiAgICBjb25zdCBkaWFnbm9zdGljID0gZXJyb3IgaW5zdGFuY2VvZiBFcnJvciA/IGVycm9yLm1lc3NhZ2UgOiBTdHJpbmcoZXJyb3IpO1xuICAgIGNvbnN0IG1lc3NhZ2UgPVxuICAgICAgY29kZSA9PT0gXCJydW50aW1lLXVuYXZhaWxhYmxlXCJcbiAgICAgICAgPyBcIkFnZW50IHJ1bnRpbWUgaXMgdW5hdmFpbGFibGUuIENvbmZpZ3VyZSBpdHMgZXhlY3V0YWJsZSBwYXRoIGFuZCB0cnkgYWdhaW4uXCJcbiAgICAgICAgOiBjb2RlID09PSBcInBlcm1pc3Npb24tcmVxdWlyZWRcIlxuICAgICAgICAgID8gXCJUaGUgYWdlbnQgcnVudGltZSByZXF1aXJlcyBhcHByb3ZhbCBiZWZvcmUgaXQgY2FuIGNvbnRpbnVlLlwiXG4gICAgICAgICAgOiBjb2RlID09PSBcInByb3RvY29sLWludmFsaWRcIlxuICAgICAgICAgICAgPyBcIlRoZSBhZ2VudCBydW50aW1lIHJldHVybmVkIGFuIGludmFsaWQgcmVzcG9uc2UuXCJcbiAgICAgICAgICAgIDogXCJUaGUgYWdlbnQgcnVudGltZSBjb3VsZCBub3QgY29tcGxldGUgdGhlIHJlcXVlc3QuXCI7XG5cbiAgICByZXR1cm4geyBjb2RlLCBtZXNzYWdlLCBkaWFnbm9zdGljIH07XG4gIH1cbn1cbiIsICJpbXBvcnQge1xuICBJdGVtVmlldyxcbiAgTWFya2Rvd25SZW5kZXJlcixcbiAgc2V0SWNvbixcbiAgV29ya3NwYWNlTGVhZixcbiAgdHlwZSBJY29uTmFtZSxcbn0gZnJvbSBcIm9ic2lkaWFuXCI7XG5pbXBvcnQgeyBMZWFybmluZ0NvbnRyb2xsZXIgfSBmcm9tIFwiLi4vbGVhcm5pbmcvTGVhcm5pbmdDb250cm9sbGVyXCI7XHJcbmltcG9ydCB7XHJcbiAgTGVhcm5pbmdBY3Rpb25LaW5kLFxyXG4gIExlYXJuaW5nRXZlbnQsXHJcbn0gZnJvbSBcIi4uL2xlYXJuaW5nL2xlYXJuaW5nLXR5cGVzXCI7XHJcbmltcG9ydCB7IExlYXJuaW5nQ29udGV4dCB9IGZyb20gXCIuLi9jb250ZXh0L2NvbnRleHQtdHlwZXNcIjtcclxuaW1wb3J0IHtcclxuICBQcmFjdGljZUV2YWx1YXRpb24sXHJcbiAgUHJhY3RpY2VRdWVzdGlvbixcclxufSBmcm9tIFwiLi4vbGVhcm5pbmcvcHJhY3RpY2UtdHlwZXNcIjtcclxuaW1wb3J0IHsgUmV2aWV3RmluZGluZyB9IGZyb20gXCIuLi9sZWFybmluZy9yZXZpZXctdHlwZXNcIjtcclxuaW1wb3J0IHsgQWdlbnRDb250ZXh0LCBDaGF0TWVzc2FnZSwgRWRpdFByb3Bvc2FsIH0gZnJvbSBcIi4uL3R5cGVzXCI7XHJcbmltcG9ydCB7IFByb3Bvc2VkRWRpdCB9IGZyb20gXCIuLi9sZWFybmluZy9sZWFybmluZy10eXBlc1wiO1xyXG5cclxuZXhwb3J0IGNvbnN0IEZPUkdFX1ZJRVdfVFlQRSA9IFwiZm9yZ2Utc2lkZWJhclwiO1xyXG5cclxudHlwZSBVSVN0YXRlID1cclxuICB8IFwiRU1QVFlcIlxyXG4gIHwgXCJSVU5OSU5HXCJcclxuICB8IFwiQU5TV0VSXCJcclxuICB8IFwiUFJPUE9TQUxcIlxyXG4gIHwgXCJBUFBMSUVEXCJcclxuICB8IFwiRVJST1JcIjtcclxuXHJcbmNvbnN0IEFDVElPTlM6IEFycmF5PHtcclxuICBraW5kOiBMZWFybmluZ0FjdGlvbktpbmQ7XHJcbiAgbGFiZWw6IHN0cmluZztcclxufT4gPSBbXHJcbiAgeyBraW5kOiBcImFza1wiLCBsYWJlbDogXCJBc2tcIiB9LFxyXG4gIHsga2luZDogXCJleHBsYWluXCIsIGxhYmVsOiBcIkV4cGxhaW5cIiB9LFxyXG4gIHsga2luZDogXCJwcmFjdGljZVwiLCBsYWJlbDogXCJQcmFjdGljZVwiIH0sXHJcbiAgeyBraW5kOiBcInJldmlld1wiLCBsYWJlbDogXCJSZXZpZXdcIiB9LFxyXG4gIHsga2luZDogXCJlZGl0XCIsIGxhYmVsOiBcIkVkaXRcIiB9LFxyXG5dO1xyXG5cclxuY29uc3QgUFJPTVBUX0NPTU1BTkRTOiBBcnJheTx7XHJcbiAga2luZDogRXhjbHVkZTxMZWFybmluZ0FjdGlvbktpbmQsIFwiYXNrXCI+O1xyXG4gIG5hbWU6IHN0cmluZztcclxuICBkZXNjcmlwdGlvbjogc3RyaW5nO1xyXG59PiA9IFtcclxuICB7IGtpbmQ6IFwiZXhwbGFpblwiLCBuYW1lOiBcIkV4cGxhaW5cIiwgZGVzY3JpcHRpb246IFwiQnJlYWsgZG93biB0aGUgY3VycmVudCBjb25jZXB0XCIgfSxcclxuICB7IGtpbmQ6IFwicHJhY3RpY2VcIiwgbmFtZTogXCJQcmFjdGljZVwiLCBkZXNjcmlwdGlvbjogXCJTdGFydCBhY3RpdmUgcmVjYWxsXCIgfSxcclxuICB7IGtpbmQ6IFwicmV2aWV3XCIsIG5hbWU6IFwiUmV2aWV3XCIsIGRlc2NyaXB0aW9uOiBcIkZpbmQgaW1wb3J0YW50IGxlYXJuaW5nIGdhcHNcIiB9LFxyXG4gIHsga2luZDogXCJlZGl0XCIsIG5hbWU6IFwiRWRpdFwiLCBkZXNjcmlwdGlvbjogXCJJbXByb3ZlIHRoZSBjdXJyZW50IG5vdGUgc2FmZWx5XCIgfSxcclxuXTtcclxuXHJcbnR5cGUgUHJvbXB0TWVudUtpbmQgPSBcInNvdXJjZVwiIHwgXCJjb21tYW5kXCI7XHJcblxyXG50eXBlIFByb21wdE1lbnVBY3Rpb24gPVxyXG4gIHwgeyB0eXBlOiBcImF0dGFjaFwiIH1cclxuICB8IHsgdHlwZTogXCJpbmZvXCIgfVxyXG4gIHwgeyB0eXBlOiBcInZhdWx0LW5vdGVcIjsgcGF0aDogc3RyaW5nIH1cclxuICB8IHsgdHlwZTogXCJsZWFybmluZ1wiOyBraW5kOiBFeGNsdWRlPExlYXJuaW5nQWN0aW9uS2luZCwgXCJhc2tcIj4gfTtcclxuXHJcbmludGVyZmFjZSBQcm9tcHRNZW51SXRlbSB7XG4gIGtleTogc3RyaW5nO1xuICBuYW1lOiBzdHJpbmc7XG4gIGRlc2NyaXB0aW9uOiBzdHJpbmc7XG4gIGljb246IEljb25OYW1lO1xuICBkaXNhYmxlZD86IGJvb2xlYW47XG4gIGFjdGlvbjogUHJvbXB0TWVudUFjdGlvbjtcbn1cblxuZnVuY3Rpb24gc2V0Rm9yZ2VJY29uKGVsZW1lbnQ6IEhUTUxFbGVtZW50LCBpY29uOiBJY29uTmFtZSk6IHZvaWQge1xuICBlbGVtZW50LmVtcHR5KCk7XG4gIHNldEljb24oZWxlbWVudCwgaWNvbik7XG59XG5cclxuZnVuY3Rpb24gcGFyc2VQcm9tcHRUb2tlbih2YWx1ZTogc3RyaW5nKToge1xyXG4gIGtpbmQ6IFByb21wdE1lbnVLaW5kO1xyXG4gIHF1ZXJ5OiBzdHJpbmc7XHJcbiAgc3RhcnQ6IG51bWJlcjtcclxufSB8IG51bGwge1xyXG4gIGNvbnN0IG1hdGNoID0gLyhefFxccykoW0AvXSkoW1xcdy1dKikkLy5leGVjKHZhbHVlKTtcclxuICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgcmV0dXJuIHtcclxuICAgIGtpbmQ6IG1hdGNoWzJdID09PSBcIkBcIiA/IFwic291cmNlXCIgOiBcImNvbW1hbmRcIixcclxuICAgIHF1ZXJ5OiBtYXRjaFszXS50b0xvd2VyQ2FzZSgpLFxyXG4gICAgc3RhcnQ6IG1hdGNoLmluZGV4ICsgbWF0Y2hbMV0ubGVuZ3RoLFxyXG4gIH07XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBDaGF0VmlldyBleHRlbmRzIEl0ZW1WaWV3IHtcclxuICBwcml2YXRlIHRocmVhZCE6IEhUTUxFbGVtZW50O1xyXG4gIHByaXZhdGUgY29tcG9zZXIhOiBIVE1MRWxlbWVudDtcclxuICBwcml2YXRlIGhlYWRlckVsITogSFRNTEVsZW1lbnQ7XHJcblxyXG4gIHByaXZhdGUgaW5wdXQhOiBIVE1MVGV4dEFyZWFFbGVtZW50O1xyXG4gIHByaXZhdGUgc2VuZEJ0biE6IEhUTUxCdXR0b25FbGVtZW50O1xyXG4gIHByaXZhdGUgc2VsZWN0aW9uQ2hpcCE6IEhUTUxFbGVtZW50O1xyXG4gIHByaXZhdGUgbm90ZUNoaXAhOiBIVE1MRWxlbWVudDtcbiAgcHJpdmF0ZSBzeXN0ZW1DaGlwITogSFRNTEVsZW1lbnQ7XG4gIHByaXZhdGUgY2FuY2VsQnRuITogSFRNTEJ1dHRvbkVsZW1lbnQ7XG4gIHByaXZhdGUgbW9kZWxTZWxlY3QhOiBIVE1MU2VsZWN0RWxlbWVudDtcbiAgcHJpdmF0ZSBmaWxlSW5wdXQhOiBIVE1MSW5wdXRFbGVtZW50O1xuICBwcml2YXRlIHByb21wdFBsdXNCdG4hOiBIVE1MQnV0dG9uRWxlbWVudDtcclxuICBwcml2YXRlIGF0dGFjaG1lbnRzRWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBpbnRlbnRFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIHByb21wdE1lbnVFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIHByb21wdE1lbnU6IFByb21wdE1lbnVLaW5kIHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBwcm9tcHRNZW51QWN0aXZlID0gMDtcbiAgcHJpdmF0ZSBwcm9tcHRNZW51Um93czogSFRNTEJ1dHRvbkVsZW1lbnRbXSA9IFtdO1xuICBwcml2YXRlIHByb21wdE1lbnVSZXF1ZXN0ID0gMDtcbiAgcHJpdmF0ZSBhdHRhY2htZW50czogQXJyYXk8eyBuYW1lOiBzdHJpbmc7IGNvbnRleHQ6IEFnZW50Q29udGV4dCB9PiA9IFtdO1xuXHJcbiAgcHJpdmF0ZSBhZ2VudEN1cnNvckVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgYWdlbnRDb250ZW50RWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBzdGF0dXNFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIGxvYWRpbmdFbGFwc2VkRWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBsb2FkaW5nU3RhcnRlZEF0ID0gMDtcclxuICBwcml2YXRlIGxvYWRpbmdUaW1lcjogbnVtYmVyIHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSB0aGlua2luZ1RvZ2dsZUVsOiBIVE1MQnV0dG9uRWxlbWVudCB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgdGhpbmtpbmdMYWJlbEVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgdGhpbmtpbmdDaGV2cm9uRWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSB0aGlua2luZ1BhbmVsRWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSB0aGlua2luZ1Jvd3M6IEhUTUxFbGVtZW50W10gPSBbXTtcclxuICBwcml2YXRlIHRoaW5raW5nU3RhZ2VUaW1lcjogbnVtYmVyIHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSB0aGlua2luZ1N0YWdlID0gMDtcclxuICBwcml2YXRlIHRoaW5raW5nTWFudWFsRXhwYW5kZWQ6IGJvb2xlYW4gfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIHN0cmVhbWVkUmVzcG9uc2VUZXh0ID0gXCJcIjtcclxuICBwcml2YXRlIHN0cmVhbWluZ1BlbmRpbmdUZXh0ID0gXCJcIjtcclxuICBwcml2YXRlIHJlc3BvbnNlVGltZUVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xyXG5cclxuICBwcml2YXRlIHVpU3RhdGU6IFVJU3RhdGUgPSBcIkVNUFRZXCI7XHJcbiAgcHJpdmF0ZSBzZWxlY3RlZEFjdGlvbjogTGVhcm5pbmdBY3Rpb25LaW5kID0gXCJhc2tcIjtcclxuICBwcml2YXRlIHJ1bm5pbmdBY3Rpb246IExlYXJuaW5nQWN0aW9uS2luZCB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgYWN0aW9uQnV0dG9ucyA9IG5ldyBNYXA8TGVhcm5pbmdBY3Rpb25LaW5kLCBIVE1MQnV0dG9uRWxlbWVudD4oKTtcclxuICBwcml2YXRlIHN5c3RlbUNvbnRleHRGaWxlczogc3RyaW5nW10gPSBbXTtcclxuXHJcbiAgcHJpdmF0ZSBleHRyYUN0eDogQWdlbnRDb250ZXh0W10gPSBbXTtcclxuICBwcml2YXRlIGN1cnJlbnRDb250ZXh0OiBMZWFybmluZ0NvbnRleHQgfCBudWxsID0gbnVsbDtcclxuXHJcbiAgY29uc3RydWN0b3IoXHJcbiAgICBsZWFmOiBXb3Jrc3BhY2VMZWFmLFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBsZWFybmluZzogTGVhcm5pbmdDb250cm9sbGVyLFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBvcGVuU2V0dGluZ3M6ICgpID0+IHZvaWQsXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IGdldExvZ29Vcmw6ICgpID0+IHN0cmluZyxcclxuICApIHtcclxuICAgIHN1cGVyKGxlYWYpO1xyXG4gIH1cclxuXHJcbiAgZ2V0Vmlld1R5cGUoKSB7XHJcbiAgICByZXR1cm4gRk9SR0VfVklFV19UWVBFO1xyXG4gIH1cclxuXHJcbiAgZ2V0RGlzcGxheVRleHQoKSB7XHJcbiAgICByZXR1cm4gXCJGb3JnZVwiO1xyXG4gIH1cclxuXHJcbiAgZ2V0SWNvbigpIHtcclxuICAgIHJldHVybiBcImZvcmdlLWxvZ29cIjtcclxuICB9XHJcblxyXG4gIGFzeW5jIG9uT3BlbigpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IHJvb3QgPSB0aGlzLmNvbnRlbnRFbDtcclxuICAgIHJvb3QuZW1wdHkoKTtcclxuICAgIHJvb3QuYWRkQ2xhc3MoXCJmb3JnZS1yb290XCIpO1xyXG5cclxuICAgIHRoaXMuYnVpbGRIZWFkZXIocm9vdCk7XHJcbiAgICB0aGlzLnRocmVhZCA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLXRocmVhZFwiIH0pO1xyXG4gICAgdGhpcy5jb21wb3NlciA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLWNvbXBvc2VyXCIgfSk7XHJcbiAgICB0aGlzLmJ1aWxkQ29tcG9zZXIodGhpcy5jb21wb3Nlcik7XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgaGVhbHRoID0gYXdhaXQgdGhpcy5sZWFybmluZy5jaGVja1J1bnRpbWUoKTtcclxuICAgICAgaWYgKGhlYWx0aC5zdGF0dXMgIT09IFwicmVhZHlcIikge1xyXG4gICAgICAgIHRoaXMuc2hvd0Vycm9yKGhlYWx0aC5mYWlsdXJlLm1lc3NhZ2UpO1xyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCB7XHJcbiAgICAgIHRoaXMuc2hvd0Vycm9yKFwiQWdlbnQgcnVudGltZSBpcyB1bmF2YWlsYWJsZS4gQ2hlY2sgRm9yZ2UgcnVudGltZSBzZXR0aW5ncy5cIik7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBhd2FpdCB0aGlzLnN5bmNDaGlwcygpO1xyXG4gICAgYXdhaXQgdGhpcy5yZXN0b3JlU2Vzc2lvbigpO1xyXG5cclxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcclxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsICgpID0+IHtcclxuICAgICAgICB2b2lkIHRoaXMuc3luY0NoaXBzKCk7XHJcbiAgICAgIH0pLFxyXG4gICAgKTtcclxuICAgIHRoaXMucmVnaXN0ZXJFdmVudChcclxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiZWRpdG9yLXNlbGVjdGlvbi1jaGFuZ2VcIiBhcyBhbnksICgpID0+IHtcclxuICAgICAgICB2b2lkIHRoaXMuc3luY0NoaXBzKCk7XHJcbiAgICAgIH0pLFxyXG4gICAgKTtcclxuXHJcbiAgICB2b2lkIHRoaXMucmVmcmVzaE1vZGVsTGlzdCgpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgb25DbG9zZSgpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICB0aGlzLmxlYXJuaW5nLmNhbmNlbCgpO1xuICAgIHRoaXMuc3RvcFRoaW5raW5nU2VxdWVuY2UoKTtcbiAgICB0aGlzLnN0b3BMb2FkaW5nVGltZXIoKTtcclxuICB9XHJcblxyXG4gIGZvY3VzQ29tcG9zZXIoKTogdm9pZCB7XHJcbiAgICB0aGlzLmlucHV0Py5mb2N1cygpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBidWlsZEhlYWRlcihyb290OiBIVE1MRWxlbWVudCk6IHZvaWQge1xyXG4gICAgdGhpcy5oZWFkZXJFbCA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLWhlYWRlclwiIH0pO1xyXG4gICAgY29uc3QgdG9wID0gdGhpcy5oZWFkZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtaGVhZGVyLXRvcFwiIH0pO1xyXG4gICAgY29uc3QgYnJhbmQgPSB0b3AuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLWhlYWRlci1icmFuZFwiIH0pO1xyXG4gICAgYnJhbmQuY3JlYXRlRWwoXCJpbWdcIiwge1xyXG4gICAgICBjbHM6IFwiZm9yZ2UtaGVhZGVyLWxvZ29cIixcclxuICAgICAgYXR0cjoge1xyXG4gICAgICAgIHNyYzogdGhpcy5nZXRMb2dvVXJsKCksXHJcbiAgICAgICAgYWx0OiBcIkZvcmdlXCIsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBjb3B5ID0gYnJhbmQuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLWhlYWRlci1jb3B5XCIgfSk7XHJcbiAgICBjb3B5LmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9yZ2UtaGVhZGVyLXRpdGxlXCIsIHRleHQ6IFwiRm9yZ2VcIiB9KTtcclxuXHJcbiAgICBjb25zdCByaWdodCA9IHRvcC5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtaGVhZGVyLXJpZ2h0XCIgfSk7XHJcblxyXG4gICAgY29uc3QgbmV3QnRuID0gcmlnaHQuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgY2xzOiBcImZvcmdlLW5ldy1idG5cIixcbiAgICAgIGF0dHI6IHtcbiAgICAgICAgdHlwZTogXCJidXR0b25cIixcbiAgICAgICAgXCJhcmlhLWxhYmVsXCI6IFwiTmV3IGxlYXJuaW5nIHNlc3Npb25cIixcbiAgICAgIH0sXG4gICAgfSk7XG4gICAgc2V0Rm9yZ2VJY29uKG5ld0J0biwgXCJwbHVzXCIpO1xuICAgIG5ld0J0bi50aXRsZSA9IFwiTmV3IGxlYXJuaW5nIHNlc3Npb25cIjtcbiAgICBuZXdCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIGFzeW5jICgpID0+IHtcbiAgICAgIGF3YWl0IHRoaXMubGVhcm5pbmcubmV3U2Vzc2lvbigpO1xyXG4gICAgICB0aGlzLmV4dHJhQ3R4ID0gW107XHJcbiAgICAgIHRoaXMuYXR0YWNobWVudHMgPSBbXTtcclxuICAgICAgdGhpcy5yZW5kZXJBdHRhY2htZW50cygpO1xyXG4gICAgICB0aGlzLmNsb3NlUHJvbXB0TWVudSgpO1xyXG4gICAgICB0aGlzLnNldEFjdGlvbihcImFza1wiKTtcclxuICAgICAgYXdhaXQgdGhpcy5zeW5jQ2hpcHMoKTtcclxuICAgICAgdGhpcy5zaG93RW1wdHkoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IG1vcmVCdG4gPSByaWdodC5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICBjbHM6IFwiZm9yZ2UtbW9yZS1idG5cIixcbiAgICAgIGF0dHI6IHtcbiAgICAgICAgdHlwZTogXCJidXR0b25cIixcbiAgICAgICAgXCJhcmlhLWxhYmVsXCI6IFwiT3BlbiBGb3JnZSBzZXR0aW5nc1wiLFxuICAgICAgfSxcbiAgICB9KTtcbiAgICBzZXRGb3JnZUljb24obW9yZUJ0biwgXCJtb3JlLWhvcml6b250YWxcIik7XG4gICAgbW9yZUJ0bi50aXRsZSA9IFwiRm9yZ2Ugc2V0dGluZ3NcIjtcclxuICAgIG1vcmVCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHRoaXMub3BlblNldHRpbmdzKCkpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBidWlsZEFjdGlvbkJ1dHRvbnMocGFyZW50OiBIVE1MRWxlbWVudCk6IHZvaWQge1xyXG4gICAgZm9yIChjb25zdCBhY3Rpb24gb2YgQUNUSU9OUykge1xyXG4gICAgICBjb25zdCBidXR0b24gPSBwYXJlbnQuY3JlYXRlRWwoXCJidXR0b25cIiwge1xyXG4gICAgICAgIGNsczogXCJmb3JnZS1hY3Rpb24tYnRuXCIsXHJcbiAgICAgICAgdGV4dDogYWN0aW9uLmxhYmVsLFxyXG4gICAgICB9KTtcclxuICAgICAgYnV0dG9uLnR5cGUgPSBcImJ1dHRvblwiO1xyXG4gICAgICBidXR0b24uc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBgVXNlICR7YWN0aW9uLmxhYmVsfSBtb2RlYCk7XHJcbiAgICAgIGJ1dHRvbi50aXRsZSA9IGAke2FjdGlvbi5sYWJlbH0gbW9kZWA7XHJcbiAgICAgIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAgIHRoaXMuc2VsZWN0ZWRBY3Rpb24gPSBhY3Rpb24ua2luZDtcclxuICAgICAgICB0aGlzLnN5bmNBY3Rpb25CdXR0b25zKCk7XHJcbiAgICAgICAgdGhpcy51cGRhdGVQbGFjZWhvbGRlcigpO1xyXG4gICAgICB9KTtcclxuICAgICAgdGhpcy5hY3Rpb25CdXR0b25zLnNldChhY3Rpb24ua2luZCwgYnV0dG9uKTtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLnN5bmNBY3Rpb25CdXR0b25zKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJlZnJlc2hNb2RlbExpc3QoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBsZXQgbW9kZWxzID0gdGhpcy5sZWFybmluZy5nZXRNb2RlbHMoKTtcclxuXHJcbiAgICB0aGlzLm1vZGVsU2VsZWN0LmVtcHR5KCk7XHJcbiAgICBjb25zdCBjdXJyZW50TW9kZWwgPSB0aGlzLmxlYXJuaW5nLmdldFNlc3Npb24oKS5tb2RlbDtcclxuXHJcbiAgICBjb25zdCBkZWZhdWx0T3B0aW9uID0gdGhpcy5tb2RlbFNlbGVjdC5jcmVhdGVFbChcIm9wdGlvblwiLCB7XHJcbiAgICAgIHZhbHVlOiBcIlwiLFxyXG4gICAgICB0ZXh0OiBcIlJ1bnRpbWUgZGVmYXVsdFwiLFxyXG4gICAgfSk7XHJcbiAgICBkZWZhdWx0T3B0aW9uLnNlbGVjdGVkID0gIWN1cnJlbnRNb2RlbDtcclxuXHJcbiAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIG1vZGVscykge1xyXG4gICAgICBjb25zdCBvcHRpb24gPSB0aGlzLm1vZGVsU2VsZWN0LmNyZWF0ZUVsKFwib3B0aW9uXCIsIHtcclxuICAgICAgICB2YWx1ZTogbW9kZWwuaWQsXHJcbiAgICAgICAgdGV4dDogbW9kZWwubmFtZSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBpZiAobW9kZWwuaWQgPT09IGN1cnJlbnRNb2RlbCkgb3B0aW9uLnNlbGVjdGVkID0gdHJ1ZTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYnVpbGRDb21wb3NlcihwYXJlbnQ6IEhUTUxFbGVtZW50KTogdm9pZCB7XHJcbiAgICBjb25zdCBjb250ZXh0Um93ID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1jb250ZXh0LXJvd1wiIH0pO1xyXG4gICAgY29udGV4dFJvdy5jcmVhdGVTcGFuKHtcclxuICAgICAgY2xzOiBcImZvcmdlLWNvbnRleHQtbGFiZWxcIixcclxuICAgICAgdGV4dDogXCJVc2luZ1wiLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgY2hpcHMgPSBjb250ZXh0Um93LmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1jaGlwc1wiIH0pO1xyXG5cclxuICAgIHRoaXMuc2VsZWN0aW9uQ2hpcCA9IGNoaXBzLmNyZWF0ZVNwYW4oe1xyXG4gICAgICBjbHM6IFwiZm9yZ2UtY2hpcCBmb3JnZS1jaGlwLS1oaWRkZW5cIixcclxuICAgIH0pO1xyXG4gICAgdGhpcy5zZWxlY3Rpb25DaGlwLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9yZ2UtY2hpcC1kb3RcIiB9KTtcclxuICAgIHRoaXMuc2VsZWN0aW9uQ2hpcC5jcmVhdGVTcGFuKHtcclxuICAgICAgY2xzOiBcImZvcmdlLWNoaXAtbGFiZWxcIixcclxuICAgICAgdGV4dDogXCJAc2VsZWN0aW9uXCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLm5vdGVDaGlwID0gY2hpcHMuY3JlYXRlU3Bhbih7XHJcbiAgICAgIGNsczogXCJmb3JnZS1jaGlwIGZvcmdlLWNoaXAtLWhpZGRlblwiLFxyXG4gICAgfSk7XHJcbiAgICB0aGlzLm5vdGVDaGlwLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9yZ2UtY2hpcC1kb3RcIiB9KTtcclxuICAgIHRoaXMubm90ZUNoaXAuY3JlYXRlU3Bhbih7XHJcbiAgICAgIGNsczogXCJmb3JnZS1jaGlwLWxhYmVsXCIsXHJcbiAgICAgIHRleHQ6IFwiQG5vdGVcIixcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuc3lzdGVtQ2hpcCA9IGNoaXBzLmNyZWF0ZVNwYW4oe1xyXG4gICAgICBjbHM6IFwiZm9yZ2UtY2hpcCBmb3JnZS1jaGlwLS1oaWRkZW5cIixcclxuICAgIH0pO1xyXG4gICAgdGhpcy5zeXN0ZW1DaGlwLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9yZ2UtY2hpcC1kb3RcIiB9KTtcclxuICAgIHRoaXMuc3lzdGVtQ2hpcC5jcmVhdGVTcGFuKHtcclxuICAgICAgY2xzOiBcImZvcmdlLWNoaXAtbGFiZWxcIixcclxuICAgICAgdGV4dDogXCJAZm9yZ2Utc3lzdGVtXCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBhbmNob3IgPSBwYXJlbnQuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLXByb21wdC1hbmNob3JcIiB9KTtcclxuICAgIHRoaXMucHJvbXB0TWVudUVsID0gYW5jaG9yLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJmb3JnZS1wcm9tcHQtbWVudSBmb3JnZS1oaWRkZW5cIixcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGJveCA9IGFuY2hvci5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtY29tcG9zZXItYm94XCIgfSk7XHJcbiAgICBib3guYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsIChldmVudCkgPT4ge1xyXG4gICAgICBpZiAoIShldmVudC50YXJnZXQgaW5zdGFuY2VvZiBIVE1MQnV0dG9uRWxlbWVudCkgJiZcclxuICAgICAgICAgICEoZXZlbnQudGFyZ2V0IGluc3RhbmNlb2YgSFRNTFNlbGVjdEVsZW1lbnQpKSB7XHJcbiAgICAgICAgdGhpcy5pbnB1dC5mb2N1cygpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLmludGVudEVsID0gYm94LmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJmb3JnZS1pbnRlbnQtcm93IGZvcmdlLWhpZGRlblwiLFxyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5hdHRhY2htZW50c0VsID0gYm94LmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJmb3JnZS1hdHRhY2htZW50cyBmb3JnZS1oaWRkZW5cIixcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuZmlsZUlucHV0ID0gYm94LmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xyXG4gICAgICBjbHM6IFwiZm9yZ2UtZmlsZS1pbnB1dFwiLFxyXG4gICAgICBhdHRyOiB7XHJcbiAgICAgICAgdHlwZTogXCJmaWxlXCIsXHJcbiAgICAgICAgbXVsdGlwbGU6IFwiXCIsXHJcbiAgICAgICAgYWNjZXB0OiBcIi5tZCwudHh0LC5jc3YsLmpzb24sLnlhbWwsLnltbFwiLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgICB0aGlzLmZpbGVJbnB1dC5hZGRFdmVudExpc3RlbmVyKFwiY2hhbmdlXCIsICgpID0+IHtcclxuICAgICAgdm9pZCB0aGlzLmhhbmRsZUZpbGVzKHRoaXMuZmlsZUlucHV0LmZpbGVzKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGNvbnRyb2xzID0gYm94LmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1jb21wb3Nlci1jb250cm9sc1wiIH0pO1xuXG4gICAgdGhpcy5pbnB1dCA9IGNvbnRyb2xzLmNyZWF0ZUVsKFwidGV4dGFyZWFcIiwge1xuICAgICAgY2xzOiBcImZvcmdlLWlucHV0XCIsXHJcbiAgICAgIGF0dHI6IHtcclxuICAgICAgICBwbGFjZWhvbGRlcjogXCJBc2sgYW55dGhpbmcgYWJvdXQgdGhpcyBub3RlLi4uXCIsXHJcbiAgICAgICAgcm93czogXCIxXCIsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuICAgIHRoaXMuaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImlucHV0XCIsICgpID0+IHRoaXMub25JbnB1dCgpKTtcclxuICAgIHRoaXMuaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB0aGlzLm9uS2V5KGV2ZW50KSk7XHJcblxuICAgIGNvbnN0IGZvb3RlciA9IGJveC5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtY29tcG9zZXItZm9vdGVyXCIgfSk7XG4gICAgdGhpcy5wcm9tcHRQbHVzQnRuID0gZm9vdGVyLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcbiAgICAgIGNsczogXCJmb3JnZS1wcm9tcHQtcGx1c1wiLFxuICAgICAgYXR0cjoge1xuICAgICAgICB0eXBlOiBcImJ1dHRvblwiLFxuICAgICAgICBcImFyaWEtbGFiZWxcIjogXCJBZGQgY29udGV4dCBvciBmaWxlXCIsXG4gICAgICAgIFwiYXJpYS1leHBhbmRlZFwiOiBcImZhbHNlXCIsXG4gICAgICB9LFxuICAgIH0pO1xuICAgIHNldEZvcmdlSWNvbih0aGlzLnByb21wdFBsdXNCdG4sIFwicGx1c1wiKTtcbiAgICB0aGlzLnByb21wdFBsdXNCdG4udGl0bGUgPSBcIkFkZCBjb250ZXh0IG9yIGZpbGVcIjtcbiAgICB0aGlzLnByb21wdFBsdXNCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcbiAgICAgIHRoaXMucHJvbXB0TWVudSA9IHRoaXMucHJvbXB0TWVudSA9PT0gXCJzb3VyY2VcIiA/IG51bGwgOiBcInNvdXJjZVwiO1xuICAgICAgdGhpcy5wcm9tcHRNZW51QWN0aXZlID0gMDtcbiAgICAgIHZvaWQgdGhpcy5yZW5kZXJQcm9tcHRNZW51KCk7XG4gICAgICB0aGlzLmlucHV0LmZvY3VzKCk7XG4gICAgfSk7XG5cbiAgICBjb25zdCB0b29scyA9IGZvb3Rlci5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtY29tcG9zZXItdG9vbHNcIiB9KTtcblxuICAgIHRoaXMubW9kZWxTZWxlY3QgPSB0b29scy5jcmVhdGVFbChcInNlbGVjdFwiLCB7XG4gICAgICBjbHM6IFwiZm9yZ2UtbW9kZWwtc2VsZWN0XCIsXHJcbiAgICB9KTtcclxuICAgIHRoaXMubW9kZWxTZWxlY3QuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCAoKSA9PiB7XHJcbiAgICAgIHRoaXMubGVhcm5pbmcuc2V0TW9kZWwodGhpcy5tb2RlbFNlbGVjdC52YWx1ZSk7XHJcbiAgICB9KTtcclxuICAgIHRoaXMubW9kZWxTZWxlY3Quc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBcIkxlYXJuaW5nIG1vZGVsXCIpO1xyXG4gICAgdGhpcy5tb2RlbFNlbGVjdC50aXRsZSA9IFwiTGVhcm5pbmcgbW9kZWxcIjtcclxuICAgIHRoaXMubW9kZWxTZWxlY3QuY3JlYXRlRWwoXCJvcHRpb25cIiwge1xyXG4gICAgICB0ZXh0OiBcIkxvYWRpbmcgbW9kZWxzXHUyMDI2XCIsXHJcbiAgICAgIGF0dHI6IHtcclxuICAgICAgICBkaXNhYmxlZDogXCJcIixcclxuICAgICAgICBzZWxlY3RlZDogXCJcIixcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGJ0bkdyb3VwID0gZm9vdGVyLmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1idG4tZ3JvdXBcIiB9KTtcblxyXG4gICAgdGhpcy5jYW5jZWxCdG4gPSBidG5Hcm91cC5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICBjbHM6IFwiZm9yZ2UtY2FuY2VsLWJ0biBmb3JnZS1oaWRkZW5cIixcbiAgICAgIGF0dHI6IHsgdHlwZTogXCJidXR0b25cIiwgXCJhcmlhLWxhYmVsXCI6IFwiU3RvcCBnZW5lcmF0aW5nXCIgfSxcbiAgICB9KTtcbiAgICBzZXRGb3JnZUljb24odGhpcy5jYW5jZWxCdG4sIFwieFwiKTtcbiAgICB0aGlzLmNhbmNlbEJ0bi50aXRsZSA9IFwiU3RvcFwiO1xyXG4gICAgdGhpcy5jYW5jZWxCdG4uc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBcIlN0b3AgZ2VuZXJhdGluZ1wiKTtcclxuICAgIHRoaXMuY2FuY2VsQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XHJcbiAgICAgIHRoaXMubGVhcm5pbmcuY2FuY2VsKCk7XHJcbiAgICAgIHRoaXMuY2FuY2VsQnRuLmRpc2FibGVkID0gdHJ1ZTtcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuc2VuZEJ0biA9IGJ0bkdyb3VwLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcbiAgICAgIGNsczogXCJmb3JnZS1zZW5kLWJ0blwiLFxuICAgICAgYXR0cjogeyB0eXBlOiBcImJ1dHRvblwiLCBcImFyaWEtbGFiZWxcIjogXCJTZW5kIG1lc3NhZ2VcIiB9LFxuICAgIH0pO1xuICAgIHNldEZvcmdlSWNvbih0aGlzLnNlbmRCdG4sIFwiYXJyb3ctdXBcIik7XG4gICAgdGhpcy5zZW5kQnRuLnRpdGxlID0gXCJTZW5kIG1lc3NhZ2VcIjtcclxuICAgIHRoaXMuc2VuZEJ0bi5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIFwiU2VuZCBtZXNzYWdlXCIpO1xyXG4gICAgdGhpcy5zZW5kQnRuLmRpc2FibGVkID0gdHJ1ZTtcclxuICAgIHRoaXMuc2VuZEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICB2b2lkIHRoaXMuZG9TZW5kKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBwYXJlbnQuY3JlYXRlRGl2KHtcbiAgICAgIGNsczogXCJmb3JnZS1jb21wb3Nlci1oaW50XCIsXHJcbiAgICAgIHRleHQ6IFwiRW50ZXIgdG8gc2VuZCBcdTAwQjcgU2hpZnQgKyBFbnRlciBmb3IgYSBuZXcgbGluZVwiLFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHJlbmRlckF0dGFjaG1lbnRzKCk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLmF0dGFjaG1lbnRzRWwpIHJldHVybjtcclxuXHJcbiAgICB0aGlzLmF0dGFjaG1lbnRzRWwuZW1wdHkoKTtcclxuICAgIHRoaXMuYXR0YWNobWVudHNFbC50b2dnbGVDbGFzcyhcImZvcmdlLWhpZGRlblwiLCB0aGlzLmF0dGFjaG1lbnRzLmxlbmd0aCA9PT0gMCk7XHJcblxyXG4gICAgZm9yIChjb25zdCBbaW5kZXgsIGF0dGFjaG1lbnRdIG9mIHRoaXMuYXR0YWNobWVudHMuZW50cmllcygpKSB7XHJcbiAgICAgIGNvbnN0IGNoaXAgPSB0aGlzLmF0dGFjaG1lbnRzRWwuY3JlYXRlRGl2KHtcbiAgICAgICAgY2xzOiBcImZvcmdlLWF0dGFjaG1lbnQtY2hpcFwiLFxuICAgICAgfSk7XG4gICAgICBjb25zdCBhdHRhY2htZW50SWNvbiA9IGNoaXAuY3JlYXRlU3Bhbih7IGNsczogXCJmb3JnZS1hdHRhY2htZW50LWljb25cIiB9KTtcbiAgICAgIHNldEZvcmdlSWNvbihhdHRhY2htZW50SWNvbiwgXCJmaWxlLXRleHRcIik7XG4gICAgICBjaGlwLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9yZ2UtYXR0YWNobWVudC1uYW1lXCIsIHRleHQ6IGF0dGFjaG1lbnQubmFtZSB9KTtcblxuICAgICAgY29uc3QgcmVtb3ZlID0gY2hpcC5jcmVhdGVFbChcImJ1dHRvblwiLCB7XG4gICAgICAgIGNsczogXCJmb3JnZS1hdHRhY2htZW50LXJlbW92ZVwiLFxuICAgICAgICBhdHRyOiB7XG4gICAgICAgICAgdHlwZTogXCJidXR0b25cIixcclxuICAgICAgICAgIFwiYXJpYS1sYWJlbFwiOiBgUmVtb3ZlICR7YXR0YWNobWVudC5uYW1lfWAsXG4gICAgICAgIH0sXG4gICAgICB9KTtcbiAgICAgIHNldEZvcmdlSWNvbihyZW1vdmUsIFwieFwiKTtcbiAgICAgIHJlbW92ZS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAgIHRoaXMuYXR0YWNobWVudHMuc3BsaWNlKGluZGV4LCAxKTtcclxuICAgICAgICB0aGlzLmV4dHJhQ3R4ID0gdGhpcy5hdHRhY2htZW50cy5tYXAoKGl0ZW0pID0+IGl0ZW0uY29udGV4dCk7XHJcbiAgICAgICAgdGhpcy5yZW5kZXJBdHRhY2htZW50cygpO1xyXG4gICAgICAgIHZvaWQgdGhpcy5zeW5jQ2hpcHMoKTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGhhbmRsZUZpbGVzKGZpbGVzOiBGaWxlTGlzdCB8IG51bGwpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGlmICghZmlsZXMgfHwgZmlsZXMubGVuZ3RoID09PSAwKSByZXR1cm47XHJcblxyXG4gICAgdGhpcy5jbG9zZVByb21wdE1lbnUoKTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgQXJyYXkuZnJvbShmaWxlcykpIHtcclxuICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IGZpbGUudGV4dCgpO1xyXG4gICAgICB0aGlzLmF0dGFjaG1lbnRzLnB1c2goe1xyXG4gICAgICAgIG5hbWU6IGZpbGUubmFtZSxcclxuICAgICAgICBjb250ZXh0OiB7XHJcbiAgICAgICAgICB0eXBlOiBcIm5vdGVcIixcclxuICAgICAgICAgIGZpbGU6IGBhdHRhY2htZW50LyR7ZmlsZS5uYW1lfWAsXHJcbiAgICAgICAgICBjb250ZW50LFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuZXh0cmFDdHggPSB0aGlzLmF0dGFjaG1lbnRzLm1hcCgoaXRlbSkgPT4gaXRlbS5jb250ZXh0KTtcclxuICAgIHRoaXMucmVuZGVyQXR0YWNobWVudHMoKTtcclxuICAgIHRoaXMuZmlsZUlucHV0LnZhbHVlID0gXCJcIjtcclxuICAgIGF3YWl0IHRoaXMuc3luY0NoaXBzKCk7XHJcbiAgICB0aGlzLmlucHV0LmZvY3VzKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGdldFByb21wdE1lbnVJdGVtcygpOiBQcm9taXNlPFByb21wdE1lbnVJdGVtW10+IHtcclxuICAgIGlmICh0aGlzLnByb21wdE1lbnUgPT09IFwiY29tbWFuZFwiKSB7XHJcbiAgICAgIHJldHVybiBQUk9NUFRfQ09NTUFORFMubWFwKChjb21tYW5kKSA9PiAoe1xyXG4gICAgICAgIGtleTogY29tbWFuZC5raW5kLFxuICAgICAgICBuYW1lOiBjb21tYW5kLm5hbWUsXG4gICAgICAgIGRlc2NyaXB0aW9uOiBjb21tYW5kLmRlc2NyaXB0aW9uLFxuICAgICAgICBpY29uOiBcInNwYXJrbGVzXCIsXG4gICAgICAgIGFjdGlvbjogeyB0eXBlOiBcImxlYXJuaW5nXCIgYXMgY29uc3QsIGtpbmQ6IGNvbW1hbmQua2luZCB9LFxyXG4gICAgICB9KSk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgaXRlbXM6IFByb21wdE1lbnVJdGVtW10gPSBbXTtcclxuICAgIGNvbnN0IHRva2VuID0gcGFyc2VQcm9tcHRUb2tlbih0aGlzLmlucHV0LnZhbHVlKTtcclxuICAgIGNvbnN0IHF1ZXJ5ID0gdG9rZW4/LmtpbmQgPT09IFwic291cmNlXCIgPyB0b2tlbi5xdWVyeSA6IFwiXCI7XHJcblxyXG4gICAgaWYgKHRoaXMuY3VycmVudENvbnRleHQ/LnNlbGVjdGlvbikge1xyXG4gICAgICBpdGVtcy5wdXNoKHtcclxuICAgICAgICBrZXk6IFwiY3VycmVudC1zZWxlY3Rpb25cIixcbiAgICAgICAgbmFtZTogXCJDdXJyZW50IHNlbGVjdGlvblwiLFxuICAgICAgICBkZXNjcmlwdGlvbjogdGhpcy5jdXJyZW50Q29udGV4dC5zZWxlY3Rpb24uZmlsZSxcbiAgICAgICAgaWNvbjogXCJjaGVja1wiLFxuICAgICAgICBkaXNhYmxlZDogdHJ1ZSxcclxuICAgICAgICBhY3Rpb246IHsgdHlwZTogXCJpbmZvXCIgfSxcclxuICAgICAgfSk7XHJcbiAgICB9IGVsc2UgaWYgKHRoaXMuY3VycmVudENvbnRleHQ/LmFjdGl2ZU5vdGUpIHtcclxuICAgICAgaXRlbXMucHVzaCh7XHJcbiAgICAgICAga2V5OiBcImN1cnJlbnQtbm90ZVwiLFxyXG4gICAgICAgIG5hbWU6IHRoaXMuY3VycmVudENvbnRleHQuYWN0aXZlTm90ZS5wYXRoLnNwbGl0KFwiL1wiKS5wb3AoKSA/P1xuICAgICAgICAgIHRoaXMuY3VycmVudENvbnRleHQuYWN0aXZlTm90ZS5wYXRoLFxuICAgICAgICBkZXNjcmlwdGlvbjogXCJDdXJyZW50IG5vdGUgXHUwMEI3IGF1dG9tYXRpYyBjb250ZXh0XCIsXG4gICAgICAgIGljb246IFwiZmlsZS10ZXh0XCIsXG4gICAgICAgIGRpc2FibGVkOiB0cnVlLFxyXG4gICAgICAgIGFjdGlvbjogeyB0eXBlOiBcImluZm9cIiB9LFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAocXVlcnkpIHtcclxuICAgICAgY29uc3QgZXhjbHVkZWQgPSBuZXcgU2V0KFtcclxuICAgICAgICB0aGlzLmN1cnJlbnRDb250ZXh0Py5hY3RpdmVOb3RlPy5wYXRoLFxyXG4gICAgICAgIHRoaXMuY3VycmVudENvbnRleHQ/LnNlbGVjdGlvbj8uZmlsZSxcclxuICAgICAgICAuLi50aGlzLmV4dHJhQ3R4Lm1hcCgoaXRlbSkgPT4gaXRlbS5maWxlKSxcclxuICAgICAgXS5maWx0ZXIoKHZhbHVlKTogdmFsdWUgaXMgc3RyaW5nID0+IEJvb2xlYW4odmFsdWUpKSk7XHJcblxyXG4gICAgICBmb3IgKGNvbnN0IG5vdGUgb2YgdGhpcy5sZWFybmluZy5zZWFyY2hOb3RlcyhxdWVyeSwgNikpIHtcclxuICAgICAgICBpZiAoZXhjbHVkZWQuaGFzKG5vdGUucGF0aCkpIGNvbnRpbnVlO1xyXG4gICAgICAgIGl0ZW1zLnB1c2goe1xyXG4gICAgICAgICAga2V5OiBgbm90ZToke25vdGUucGF0aH1gLFxuICAgICAgICAgIG5hbWU6IG5vdGUubmFtZSxcbiAgICAgICAgICBkZXNjcmlwdGlvbjogbm90ZS5wYXRoLFxuICAgICAgICAgIGljb246IFwiZmlsZS10ZXh0XCIsXG4gICAgICAgICAgYWN0aW9uOiB7IHR5cGU6IFwidmF1bHQtbm90ZVwiLCBwYXRoOiBub3RlLnBhdGggfSxcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGl0ZW1zLnB1c2goe1xyXG4gICAgICBrZXk6IFwiYXR0YWNoXCIsXG4gICAgICBuYW1lOiBcIkF0dGFjaCB0ZXh0IGZpbGVcIixcbiAgICAgIGRlc2NyaXB0aW9uOiBcIk1hcmtkb3duLCB0ZXh0LCBDU1YsIEpTT04sIG9yIFlBTUxcIixcbiAgICAgIGljb246IFwicGFwZXJjbGlwXCIsXG4gICAgICBhY3Rpb246IHsgdHlwZTogXCJhdHRhY2hcIiB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgcmV0dXJuIGl0ZW1zO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyByZW5kZXJQcm9tcHRNZW51KCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgaWYgKCF0aGlzLnByb21wdE1lbnVFbCkgcmV0dXJuO1xyXG5cclxuICAgIGNvbnN0IHJlcXVlc3RJZCA9ICsrdGhpcy5wcm9tcHRNZW51UmVxdWVzdDtcclxuICAgIHRoaXMucHJvbXB0TWVudUVsLmVtcHR5KCk7XHJcbiAgICB0aGlzLnByb21wdE1lbnVSb3dzID0gW107XHJcbiAgICB0aGlzLnByb21wdE1lbnVFbC50b2dnbGVDbGFzcyhcImZvcmdlLWhpZGRlblwiLCB0aGlzLnByb21wdE1lbnUgPT09IG51bGwpO1xyXG4gICAgdGhpcy5wcm9tcHRQbHVzQnRuPy5zZXRBdHRyaWJ1dGUoXCJhcmlhLWV4cGFuZGVkXCIsIFN0cmluZyh0aGlzLnByb21wdE1lbnUgIT09IG51bGwpKTtcclxuICAgIGlmICghdGhpcy5wcm9tcHRNZW51KSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgdG9rZW4gPSBwYXJzZVByb21wdFRva2VuKHRoaXMuaW5wdXQudmFsdWUpO1xyXG4gICAgY29uc3QgcXVlcnkgPSB0b2tlbj8ua2luZCA9PT0gdGhpcy5wcm9tcHRNZW51ID8gdG9rZW4ucXVlcnkgOiBcIlwiO1xyXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMuZ2V0UHJvbXB0TWVudUl0ZW1zKCk7XHJcbiAgICBpZiAocmVxdWVzdElkICE9PSB0aGlzLnByb21wdE1lbnVSZXF1ZXN0IHx8ICF0aGlzLnByb21wdE1lbnUpIHJldHVybjtcclxuXHJcbiAgICBsZXQgaW50ZXJhY3RpdmVJbmRleCA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2Ygcm93cykge1xyXG4gICAgICBjb25zdCBtZW51SW5kZXggPSBpdGVtLmRpc2FibGVkID8gLTEgOiBpbnRlcmFjdGl2ZUluZGV4Kys7XHJcbiAgICAgIGNvbnN0IGJ1dHRvbiA9IHRoaXMucHJvbXB0TWVudUVsLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcclxuICAgICAgICBjbHM6IGBmb3JnZS1wcm9tcHQtbWVudS1yb3cke21lbnVJbmRleCA9PT0gdGhpcy5wcm9tcHRNZW51QWN0aXZlID8gXCIgaXMtYWN0aXZlXCIgOiBcIlwifWAsXHJcbiAgICAgICAgYXR0cjogeyB0eXBlOiBcImJ1dHRvblwiIH0sXHJcbiAgICAgIH0pO1xyXG4gICAgICBidXR0b24uZGlzYWJsZWQgPSBCb29sZWFuKGl0ZW0uZGlzYWJsZWQpO1xyXG4gICAgICBjb25zdCBpY29uID0gYnV0dG9uLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9yZ2UtcHJvbXB0LW1lbnUtaWNvblwiIH0pO1xuICAgICAgc2V0Rm9yZ2VJY29uKGljb24sIGl0ZW0uaWNvbik7XG4gICAgICBidXR0b24uY3JlYXRlU3Bhbih7IGNsczogXCJmb3JnZS1wcm9tcHQtbWVudS1uYW1lXCIsIHRleHQ6IGl0ZW0ubmFtZSB9KTtcclxuICAgICAgYnV0dG9uLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9yZ2UtcHJvbXB0LW1lbnUtZGVzY3JpcHRpb25cIiwgdGV4dDogaXRlbS5kZXNjcmlwdGlvbiB9KTtcclxuXHJcbiAgICAgIGlmICghaXRlbS5kaXNhYmxlZCkge1xyXG4gICAgICAgIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwibW91c2VlbnRlclwiLCAoKSA9PiB7XHJcbiAgICAgICAgICB0aGlzLnByb21wdE1lbnVBY3RpdmUgPSBtZW51SW5kZXg7XHJcbiAgICAgICAgICB0aGlzLnByb21wdE1lbnVSb3dzLmZvckVhY2goKHJvdywgaW5kZXgpID0+IHtcclxuICAgICAgICAgICAgcm93LnRvZ2dsZUNsYXNzKFwiaXMtYWN0aXZlXCIsIGluZGV4ID09PSB0aGlzLnByb21wdE1lbnVBY3RpdmUpO1xyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgYnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB2b2lkIHRoaXMucGlja1Byb21wdE1lbnVJdGVtKGl0ZW0pKTtcclxuICAgICAgICB0aGlzLnByb21wdE1lbnVSb3dzLnB1c2goYnV0dG9uKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHRoaXMucHJvbXB0TWVudUVsLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJmb3JnZS1wcm9tcHQtbWVudS1oaW50XCIsXHJcbiAgICAgIHRleHQ6IHRoaXMucHJvbXB0TWVudSA9PT0gXCJzb3VyY2VcIlxyXG4gICAgICAgID8gcXVlcnkgPyBcIlNlbGVjdCBhIG5vdGUgb3IgYXR0YWNoIGEgdGV4dCBmaWxlXCIgOiBcIlR5cGUgQG5hbWUgdG8gc2VhcmNoIHZhdWx0IG5vdGVzXCJcclxuICAgICAgICA6IFwiQ2hvb3NlIGEgbGVhcm5pbmcgYWN0aW9uXCIsXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcGlja1Byb21wdE1lbnVJdGVtKGl0ZW06IFByb21wdE1lbnVJdGVtKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBhY3Rpb24gPSBpdGVtLmFjdGlvbjtcclxuICAgIGlmIChhY3Rpb24udHlwZSA9PT0gXCJhdHRhY2hcIikge1xyXG4gICAgICB0aGlzLmNsb3NlUHJvbXB0TWVudSgpO1xyXG4gICAgICB0aGlzLmZpbGVJbnB1dC5jbGljaygpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcbiAgICBpZiAoYWN0aW9uLnR5cGUgPT09IFwiaW5mb1wiKSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgdG9rZW4gPSBwYXJzZVByb21wdFRva2VuKHRoaXMuaW5wdXQudmFsdWUpO1xyXG4gICAgY29uc3QgcHJlZml4ID0gdG9rZW4gPyB0aGlzLmlucHV0LnZhbHVlLnNsaWNlKDAsIHRva2VuLnN0YXJ0KSA6IHRoaXMuaW5wdXQudmFsdWU7XHJcblxyXG4gICAgaWYgKGFjdGlvbi50eXBlID09PSBcInZhdWx0LW5vdGVcIikge1xyXG4gICAgICBjb25zdCBjb250ZXh0ID0gYXdhaXQgdGhpcy5sZWFybmluZy5sb2FkTm90ZUNvbnRleHQoYWN0aW9uLnBhdGgpO1xyXG4gICAgICBpZiAoY29udGV4dCAmJiAhdGhpcy5leHRyYUN0eC5zb21lKChpdGVtKSA9PiBpdGVtLmZpbGUgPT09IGNvbnRleHQuZmlsZSkpIHtcclxuICAgICAgICB0aGlzLmF0dGFjaG1lbnRzLnB1c2goe1xyXG4gICAgICAgICAgbmFtZTogY29udGV4dC5maWxlLnNwbGl0KFwiL1wiKS5wb3AoKSA/PyBjb250ZXh0LmZpbGUsXHJcbiAgICAgICAgICBjb250ZXh0LFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIHRoaXMuZXh0cmFDdHggPSB0aGlzLmF0dGFjaG1lbnRzLm1hcCgoaXRlbSkgPT4gaXRlbS5jb250ZXh0KTtcclxuICAgICAgICB0aGlzLnJlbmRlckF0dGFjaG1lbnRzKCk7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5zeW5jQ2hpcHMoKTtcclxuICAgICAgfVxyXG4gICAgICB0aGlzLmlucHV0LnZhbHVlID0gcHJlZml4O1xyXG4gICAgICB0aGlzLmNsb3NlUHJvbXB0TWVudSgpO1xyXG4gICAgICB0aGlzLm9uSW5wdXQoKTtcclxuICAgICAgdGhpcy5pbnB1dC5mb2N1cygpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5zZXRBY3Rpb24oYWN0aW9uLmtpbmQpO1xyXG4gICAgdGhpcy5pbnB1dC52YWx1ZSA9IHByZWZpeDtcclxuICAgIHRoaXMuY2xvc2VQcm9tcHRNZW51KCk7XHJcbiAgICB0aGlzLm9uSW5wdXQoKTtcclxuICAgIHRoaXMuaW5wdXQuZm9jdXMoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY2xvc2VQcm9tcHRNZW51KCk6IHZvaWQge1xyXG4gICAgdGhpcy5wcm9tcHRNZW51UmVxdWVzdCArPSAxO1xyXG4gICAgdGhpcy5wcm9tcHRNZW51ID0gbnVsbDtcclxuICAgIHRoaXMucHJvbXB0TWVudUFjdGl2ZSA9IDA7XHJcbiAgICB2b2lkIHRoaXMucmVuZGVyUHJvbXB0TWVudSgpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzZXRBY3Rpb24oYWN0aW9uOiBMZWFybmluZ0FjdGlvbktpbmQpOiB2b2lkIHtcclxuICAgIHRoaXMuc2VsZWN0ZWRBY3Rpb24gPSBhY3Rpb247XHJcbiAgICB0aGlzLnN5bmNBY3Rpb25CdXR0b25zKCk7XHJcbiAgICB0aGlzLnVwZGF0ZVBsYWNlaG9sZGVyKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHN5bmNBY3Rpb25CdXR0b25zKCk6IHZvaWQge1xyXG4gICAgZm9yIChjb25zdCBba2luZCwgYnV0dG9uXSBvZiB0aGlzLmFjdGlvbkJ1dHRvbnMpIHtcclxuICAgICAgY29uc3QgYWN0aXZlID0ga2luZCA9PT0gdGhpcy5zZWxlY3RlZEFjdGlvbjtcclxuICAgICAgYnV0dG9uLnRvZ2dsZUNsYXNzKFwiaXMtYWN0aXZlXCIsIGFjdGl2ZSk7XHJcbiAgICAgIGJ1dHRvbi5zZXRBdHRyaWJ1dGUoXCJhcmlhLXByZXNzZWRcIiwgU3RyaW5nKGFjdGl2ZSkpO1xyXG4gICAgfVxyXG4gICAgdGhpcy5yZW5kZXJJbnRlbnQoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgcmVuZGVySW50ZW50KCk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLmludGVudEVsKSByZXR1cm47XHJcbiAgICB0aGlzLmludGVudEVsLmVtcHR5KCk7XHJcblxyXG4gICAgY29uc3QgdmlzaWJsZSA9IHRoaXMuc2VsZWN0ZWRBY3Rpb24gIT09IFwiYXNrXCI7XHJcbiAgICB0aGlzLmludGVudEVsLnRvZ2dsZUNsYXNzKFwiZm9yZ2UtaGlkZGVuXCIsICF2aXNpYmxlKTtcclxuICAgIGlmICghdmlzaWJsZSkgcmV0dXJuO1xyXG5cclxuICAgIGNvbnN0IGxhYmVsID0gQUNUSU9OUy5maW5kKChpdGVtKSA9PiBpdGVtLmtpbmQgPT09IHRoaXMuc2VsZWN0ZWRBY3Rpb24pPy5sYWJlbCA/PyB0aGlzLnNlbGVjdGVkQWN0aW9uO1xyXG4gICAgY29uc3QgY2hpcCA9IHRoaXMuaW50ZW50RWwuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBgZm9yZ2UtaW50ZW50LWNoaXAgZm9yZ2UtaW50ZW50LWNoaXAtLSR7dGhpcy5zZWxlY3RlZEFjdGlvbn1gLFxyXG4gICAgfSk7XHJcbiAgICBjaGlwLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9yZ2UtaW50ZW50LWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xyXG5cclxuICAgIGNvbnN0IHJlbW92ZSA9IGNoaXAuY3JlYXRlRWwoXCJidXR0b25cIiwge1xuICAgICAgY2xzOiBcImZvcmdlLWludGVudC1yZW1vdmVcIixcbiAgICAgIGF0dHI6IHsgdHlwZTogXCJidXR0b25cIiwgXCJhcmlhLWxhYmVsXCI6IGBFeGl0ICR7bGFiZWx9IG1vZGVgIH0sXG4gICAgfSk7XG4gICAgc2V0Rm9yZ2VJY29uKHJlbW92ZSwgXCJ4XCIpO1xuICAgIHJlbW92ZS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICB0aGlzLnNldEFjdGlvbihcImFza1wiKTtcclxuICAgICAgdGhpcy5pbnB1dC5mb2N1cygpO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHVwZGF0ZVBsYWNlaG9sZGVyKCk6IHZvaWQge1xyXG4gICAgY29uc3QgcGxhY2Vob2xkZXJzOiBSZWNvcmQ8TGVhcm5pbmdBY3Rpb25LaW5kLCBzdHJpbmc+ID0ge1xyXG4gICAgICBhc2s6IFwiQXNrIGFueXRoaW5nIGFib3V0IHRoaXMgbm90ZS4uLlwiLFxyXG4gICAgICBleHBsYWluOiBcIldoYXQgc2hvdWxkIEkgZXhwbGFpbj9cIixcclxuICAgICAgcHJhY3RpY2U6IFwiV2hhdCBzaG91bGQgd2UgcHJhY3RpY2U/XCIsXHJcbiAgICAgIHJldmlldzogXCJXaGF0IHNob3VsZCBJIHJldmlldz9cIixcclxuICAgICAgZWRpdDogXCJIb3cgc2hvdWxkIEkgaW1wcm92ZSB0aGlzIG5vdGU/XCIsXHJcbiAgICB9O1xyXG5cclxuICAgIGlmICh0aGlzLmlucHV0KSB7XHJcbiAgICAgIHRoaXMuaW5wdXQucGxhY2Vob2xkZXIgPSBwbGFjZWhvbGRlcnNbdGhpcy5zZWxlY3RlZEFjdGlvbl07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHN5bmNDaGlwcygpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IGNvbnRleHQgPSBhd2FpdCB0aGlzLmxlYXJuaW5nLnJlc29sdmVDb250ZXh0KHRoaXMuZXh0cmFDdHgpO1xyXG4gICAgdGhpcy5jdXJyZW50Q29udGV4dCA9IGNvbnRleHQ7XHJcbiAgICB0aGlzLnN5c3RlbUNoaXAuYWRkQ2xhc3MoXCJmb3JnZS1jaGlwLS1oaWRkZW5cIik7XHJcblxyXG4gICAgY29uc3QgaGFzU2VsZWN0aW9uID0gQm9vbGVhbihjb250ZXh0LnNlbGVjdGlvbik7XHJcbiAgICB0aGlzLnNlbGVjdGlvbkNoaXAudG9nZ2xlQ2xhc3MoXCJmb3JnZS1jaGlwLS1oaWRkZW5cIiwgIWhhc1NlbGVjdGlvbik7XHJcblxyXG4gICAgY29uc3QgYWN0aXZlTm90ZSA9IGNvbnRleHQuYWN0aXZlTm90ZTtcclxuICAgIHRoaXMubm90ZUNoaXAudG9nZ2xlQ2xhc3MoXCJmb3JnZS1jaGlwLS1oaWRkZW5cIiwgIWFjdGl2ZU5vdGUpO1xyXG5cclxuICAgIGlmIChhY3RpdmVOb3RlKSB7XHJcbiAgICAgIGNvbnN0IG5hbWUgPSBhY3RpdmVOb3RlLnBhdGguc3BsaXQoXCIvXCIpLnBvcCgpID8/IGFjdGl2ZU5vdGUucGF0aDtcclxuICAgICAgY29uc3QgbGFiZWwgPSB0aGlzLm5vdGVDaGlwLnF1ZXJ5U2VsZWN0b3I8SFRNTEVsZW1lbnQ+KFwiLmZvcmdlLWNoaXAtbGFiZWxcIik7XHJcbiAgICAgIGlmIChsYWJlbCkgbGFiZWwudGV4dENvbnRlbnQgPSBgQCR7bmFtZX1gO1xyXG4gICAgICB0aGlzLm5vdGVDaGlwLnRpdGxlID0gYWN0aXZlTm90ZS5wYXRoO1xyXG4gICAgfVxyXG5cclxuICB9XG5cclxuICBwcml2YXRlIG9uSW5wdXQoKTogdm9pZCB7XHJcbiAgICB0aGlzLnNlbmRCdG4uZGlzYWJsZWQgPVxyXG4gICAgICAhdGhpcy5jYW5TZW5kKCkgfHwgdGhpcy51aVN0YXRlID09PSBcIlJVTk5JTkdcIjtcclxuXHJcbiAgICBjb25zdCB0b2tlbiA9IHBhcnNlUHJvbXB0VG9rZW4odGhpcy5pbnB1dC52YWx1ZSk7XHJcbiAgICBpZiAodG9rZW4gJiYgdGhpcy5wcm9tcHRNZW51ICE9PSB0b2tlbi5raW5kKSB7XHJcbiAgICAgIHRoaXMucHJvbXB0TWVudSA9IHRva2VuLmtpbmQ7XHJcbiAgICAgIHRoaXMucHJvbXB0TWVudUFjdGl2ZSA9IDA7XHJcbiAgICB9IGVsc2UgaWYgKCF0b2tlbikge1xyXG4gICAgICB0aGlzLmNsb3NlUHJvbXB0TWVudSgpO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMucmVuZGVyUHJvbXB0TWVudSgpO1xyXG5cclxuICAgIHRoaXMuaW5wdXQuc3R5bGUuaGVpZ2h0ID0gXCJhdXRvXCI7XHJcbiAgICB0aGlzLmlucHV0LnN0eWxlLmhlaWdodCA9XHJcbiAgICAgIE1hdGgubWluKHRoaXMuaW5wdXQuc2Nyb2xsSGVpZ2h0LCA4MCkgKyBcInB4XCI7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIG9uS2V5KGV2ZW50OiBLZXlib2FyZEV2ZW50KTogdm9pZCB7XHJcbiAgICBpZiAodGhpcy5wcm9tcHRNZW51ICYmIHRoaXMucHJvbXB0TWVudVJvd3MubGVuZ3RoID4gMCkge1xyXG4gICAgICBpZiAoZXZlbnQua2V5ID09PSBcIkFycm93RG93blwiIHx8IGV2ZW50LmtleSA9PT0gXCJBcnJvd1VwXCIpIHtcclxuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIGNvbnN0IGRpcmVjdGlvbiA9IGV2ZW50LmtleSA9PT0gXCJBcnJvd0Rvd25cIiA/IDEgOiAtMTtcclxuICAgICAgICB0aGlzLnByb21wdE1lbnVBY3RpdmUgPVxyXG4gICAgICAgICAgKHRoaXMucHJvbXB0TWVudUFjdGl2ZSArIGRpcmVjdGlvbiArIHRoaXMucHJvbXB0TWVudVJvd3MubGVuZ3RoKSAlXHJcbiAgICAgICAgICB0aGlzLnByb21wdE1lbnVSb3dzLmxlbmd0aDtcclxuICAgICAgICB0aGlzLnByb21wdE1lbnVSb3dzLmZvckVhY2goKHJvdywgaW5kZXgpID0+IHtcclxuICAgICAgICAgIHJvdy50b2dnbGVDbGFzcyhcImlzLWFjdGl2ZVwiLCBpbmRleCA9PT0gdGhpcy5wcm9tcHRNZW51QWN0aXZlKTtcclxuICAgICAgICB9KTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmICgoZXZlbnQua2V5ID09PSBcIkVudGVyXCIgJiYgIWV2ZW50LnNoaWZ0S2V5KSB8fCBldmVudC5rZXkgPT09IFwiVGFiXCIpIHtcclxuICAgICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICAgIGNvbnN0IHJvdyA9IHRoaXMucHJvbXB0TWVudVJvd3NbdGhpcy5wcm9tcHRNZW51QWN0aXZlXTtcclxuICAgICAgICBpZiAocm93KSByb3cuY2xpY2soKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAoZXZlbnQua2V5ID09PSBcIkVudGVyXCIgJiYgIWV2ZW50LnNoaWZ0S2V5KSB7XHJcbiAgICAgIGV2ZW50LnByZXZlbnREZWZhdWx0KCk7XHJcbiAgICAgIGlmICghdGhpcy5zZW5kQnRuLmRpc2FibGVkKSB2b2lkIHRoaXMuZG9TZW5kKCk7XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFc2NhcGVcIikge1xyXG4gICAgICBpZiAodGhpcy5wcm9tcHRNZW51KSB7XHJcbiAgICAgICAgdGhpcy5jbG9zZVByb21wdE1lbnUoKTtcclxuICAgICAgfSBlbHNlIGlmICh0aGlzLnVpU3RhdGUgPT09IFwiUlVOTklOR1wiKSB7XHJcbiAgICAgICAgdGhpcy5jYW5jZWxCdG4uY2xpY2soKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBkb1NlbmQoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBwcm9tcHQgPSB0aGlzLmlucHV0LnZhbHVlLnRyaW0oKSB8fCBcIlJldmlldyB0aGUgYXR0YWNoZWQgY29udGV4dC5cIjtcclxuICAgIGlmICghdGhpcy5jYW5TZW5kKCkgfHwgdGhpcy51aVN0YXRlID09PSBcIlJVTk5JTkdcIikgcmV0dXJuO1xyXG5cclxuICAgIGNvbnN0IGV4cGxpY2l0Q29udGV4dCA9IHRoaXMuZXh0cmFDdHg7XG4gICAgdGhpcy5jbG9zZVByb21wdE1lbnUoKTtcblxuICAgIHRoaXMuaW5wdXQudmFsdWUgPSBcIlwiO1xyXG4gICAgdGhpcy5pbnB1dC5zdHlsZS5oZWlnaHQgPSBcIlwiO1xyXG4gICAgdGhpcy5hdHRhY2htZW50cyA9IFtdO1xyXG4gICAgdGhpcy5leHRyYUN0eCA9IFtdO1xyXG4gICAgdGhpcy5yZW5kZXJBdHRhY2htZW50cygpO1xyXG4gICAgdGhpcy5zZW5kQnRuLmRpc2FibGVkID0gdHJ1ZTtcclxuXHJcbiAgICB0aGlzLmFnZW50Q3Vyc29yRWwgPSBudWxsO1xyXG4gICAgdGhpcy5hZ2VudENvbnRlbnRFbCA9IG51bGw7XHJcbiAgICB0aGlzLnN0YXR1c0VsID0gbnVsbDtcclxuICAgIHRoaXMuc3RyZWFtZWRSZXNwb25zZVRleHQgPSBcIlwiO1xyXG4gICAgdGhpcy5zdHJlYW1pbmdQZW5kaW5nVGV4dCA9IFwiXCI7XHJcbiAgICB0aGlzLnN0b3BUaGlua2luZ1NlcXVlbmNlKCk7XHJcbiAgICB0aGlzLnN0b3BMb2FkaW5nVGltZXIoKTtcclxuXHJcbiAgICB0aGlzLnJ1bm5pbmdBY3Rpb24gPSB0aGlzLnNlbGVjdGVkQWN0aW9uO1xyXG4gICAgdGhpcy5hcHBlbmRVc2VyQnViYmxlKHByb21wdCk7XHJcbiAgICB0aGlzLnNldFVJU3RhdGUoXCJSVU5OSU5HXCIpO1xyXG4gICAgdGhpcy5lbnN1cmVBZ2VudEJ1YmJsZSgpO1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGZvciBhd2FpdCAoY29uc3QgZXZlbnQgb2YgdGhpcy5sZWFybmluZy5ydW4oe1xyXG4gICAgICAgIHByb21wdCxcclxuICAgICAgICBhY3Rpb246IHRoaXMucnVubmluZ0FjdGlvbixcclxuICAgICAgICBleHBsaWNpdENvbnRleHQsXHJcbiAgICAgIH0pKSB7XHJcbiAgICAgICAgdGhpcy5oYW5kbGVMZWFybmluZ0V2ZW50KGV2ZW50KTtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyKSB7XHJcbiAgICAgIHRoaXMuZmluaXNoU3RyZWFtaW5nQnViYmxlKFwiU3RvcHBlZFwiKTtcclxuXHJcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPVxyXG4gICAgICAgIGVyciBpbnN0YW5jZW9mIEVycm9yID8gZXJyLm1lc3NhZ2UgOiBTdHJpbmcoZXJyKTtcclxuXHJcbiAgICAgIGNvbnNvbGUud2FybihcIltGb3JnZV0gVW5leHBlY3RlZCB0dXJuIGZhaWx1cmVcIiwgbWVzc2FnZSk7XHJcbiAgICAgIHRoaXMuYXBwZW5kSW5saW5lRXJyb3IoXHJcbiAgICAgICAgdGhpcy50aHJlYWQsXHJcbiAgICAgICAgXCJGb3JnZSBoaXQgYW4gdW5leHBlY3RlZCBlcnJvci4gVHJ5IGFnYWluLlwiLFxyXG4gICAgICApO1xyXG4gICAgICB0aGlzLnNldFVJU3RhdGUoXCJBTlNXRVJcIik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGhhbmRsZUxlYXJuaW5nRXZlbnQoZXZlbnQ6IExlYXJuaW5nRXZlbnQpOiB2b2lkIHtcclxuICAgIGlmIChldmVudC50eXBlID09PSBcImNvbnRleHQtcmVhZHlcIikge1xyXG4gICAgICB0aGlzLmN1cnJlbnRDb250ZXh0ID0gZXZlbnQuY29udGV4dC5yZXNvbHZlZDtcclxuICAgICAgdGhpcy5zeXN0ZW1Db250ZXh0RmlsZXMgPSBldmVudC5jb250ZXh0LnN5c3RlbS5tYXAoKGl0ZW0pID0+IGl0ZW0uZmlsZSk7XHJcbiAgICAgIHRoaXMuc3lzdGVtQ2hpcC50b2dnbGVDbGFzcyhcImZvcmdlLWNoaXAtLWhpZGRlblwiLCBldmVudC5jb250ZXh0LnN5c3RlbS5sZW5ndGggPT09IDApO1xyXG4gICAgICB0aGlzLnN5c3RlbUNoaXAudGl0bGUgPSB0aGlzLnN5c3RlbUNvbnRleHRGaWxlcy5qb2luKFwiXFxuXCIpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGV2ZW50LnR5cGUgPT09IFwicmVzcG9uc2UtZGVsdGFcIikge1xyXG4gICAgICB0aGlzLmFwcGVuZFRvQWdlbnRCdWJibGUoZXZlbnQudGV4dCk7XHJcbiAgICAgIHRoaXMuc2Nyb2xsVGhyZWFkKCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJwcmFjdGljZS1xdWVzdGlvblwiKSB7XHJcbiAgICAgIHRoaXMuYXBwZW5kUHJhY3RpY2VRdWVzdGlvbihldmVudC5xdWVzdGlvbik7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJwcmFjdGljZS1ldmFsdWF0aW9uXCIpIHtcclxuICAgICAgdGhpcy5hcHBlbmRQcmFjdGljZUV2YWx1YXRpb24oZXZlbnQuZXZhbHVhdGlvbik7XHJcbiAgICAgIGlmICghZXZlbnQuZXZhbHVhdGlvbi5uZXh0UXVlc3Rpb24/LnRyaW0oKSkgdGhpcy5zZXRBY3Rpb24oXCJhc2tcIik7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJyZXZpZXctZmluZGluZ3NcIikge1xyXG4gICAgICB0aGlzLmFwcGVuZFJldmlld0ZpbmRpbmdzKGV2ZW50LmZpbmRpbmdzKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChldmVudC50eXBlID09PSBcImxlYXJuaW5nLXN0YXRlLXVwZGF0ZWRcIikge1xyXG4gICAgICB0aGlzLmFwcGVuZFByb2dyZXNzVXBkYXRlKGV2ZW50LnN0YXRlLmN1cnJlbnRUb3BpYywgZXZlbnQuc3RhdGUuZ2Fwcyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJtdXRhdGlvbi1wcm9wb3NlZFwiKSB7XHJcbiAgICAgIHRoaXMuc2V0VUlTdGF0ZShcIlBST1BPU0FMXCIpO1xyXG4gICAgICB0aGlzLmFwcGVuZFByb3Bvc2FsQnViYmxlKGV2ZW50LmVkaXQpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGV2ZW50LnR5cGUgPT09IFwiY29tcGxldGVkXCIpIHtcclxuICAgICAgaWYgKHRoaXMudWlTdGF0ZSA9PT0gXCJSVU5OSU5HXCIpIHRoaXMuc2V0VUlTdGF0ZShcIkFOU1dFUlwiKTtcclxuICAgICAgdGhpcy5maW5pc2hTdHJlYW1pbmdCdWJibGUoKTtcclxuICAgICAgaWYgKFxyXG4gICAgICAgIHRoaXMucnVubmluZ0FjdGlvbiA9PT0gXCJleHBsYWluXCIgfHxcclxuICAgICAgICB0aGlzLnJ1bm5pbmdBY3Rpb24gPT09IFwicmV2aWV3XCIgfHxcclxuICAgICAgICB0aGlzLnJ1bm5pbmdBY3Rpb24gPT09IFwiZWRpdFwiXHJcbiAgICAgICkge1xyXG4gICAgICAgIHRoaXMuc2V0QWN0aW9uKFwiYXNrXCIpO1xyXG4gICAgICB9XHJcbiAgICAgIHRoaXMucnVubmluZ0FjdGlvbiA9IG51bGw7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJjYW5jZWxsZWRcIikge1xyXG4gICAgICB0aGlzLmZpbmlzaFN0cmVhbWluZ0J1YmJsZShcIlN0b3BwZWRcIik7XHJcbiAgICAgIHRoaXMuYXBwZW5kSW5saW5lRXJyb3IodGhpcy50aHJlYWQsIFwiU3RvcHBlZC5cIik7XHJcbiAgICAgIHRoaXMuc2V0VUlTdGF0ZShcIkFOU1dFUlwiKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChldmVudC50eXBlID09PSBcImZhaWxlZFwiKSB7XHJcbiAgICAgIHRoaXMuZmluaXNoU3RyZWFtaW5nQnViYmxlKFwiVW5hYmxlIHRvIGZpbmlzaFwiKTtcclxuICAgICAgdGhpcy5hcHBlbmRJbmxpbmVFcnJvcih0aGlzLnRocmVhZCwgZXZlbnQuZmFpbHVyZS5tZXNzYWdlKTtcclxuICAgICAgdGhpcy5zZXRVSVN0YXRlKFwiQU5TV0VSXCIpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBmaW5pc2hTdHJlYW1pbmdCdWJibGUoZG9uZUxhYmVsPzogc3RyaW5nKTogdm9pZCB7XHJcbiAgICBjb25zdCBlbGFwc2VkID0gdGhpcy5mb3JtYXRFbGFwc2VkKERhdGUubm93KCkgLSB0aGlzLmxvYWRpbmdTdGFydGVkQXQpO1xyXG4gICAgdGhpcy5zdG9wVGhpbmtpbmdTZXF1ZW5jZSgpO1xyXG4gICAgdGhpcy5mbHVzaFN0cmVhbWluZ1RleHQoKTtcclxuICAgIHRoaXMucmVuZGVyTWFya2Rvd25SZXNwb25zZSgpO1xyXG4gICAgaWYgKGRvbmVMYWJlbCA9PT0gdW5kZWZpbmVkKSB0aGlzLmFwcGVuZFN0cmVhbUFjdGlvbnMoKTtcclxuICAgIHRoaXMuc2V0dGxlVGhpbmtpbmcoZG9uZUxhYmVsID8/IGBDb21wbGV0ZWQgaW4gJHtlbGFwc2VkfWApO1xyXG4gICAgaWYgKHRoaXMucmVzcG9uc2VUaW1lRWwpIHRoaXMucmVzcG9uc2VUaW1lRWwudGV4dENvbnRlbnQgPSBgZm9yICR7ZWxhcHNlZH1gO1xyXG4gICAgdGhpcy5zdG9wTG9hZGluZ1RpbWVyKCk7XHJcbiAgICB0aGlzLmFnZW50Q3Vyc29yRWw/LnJlbW92ZUNsYXNzKFwiZm9yZ2UtYnViYmxlLS1zdHJlYW1pbmdcIik7XHJcbiAgICB0aGlzLmFnZW50Q3Vyc29yRWwgPSBudWxsO1xyXG4gICAgdGhpcy5hZ2VudENvbnRlbnRFbCA9IG51bGw7XHJcbiAgICB0aGlzLnN0YXR1c0VsID0gbnVsbDtcclxuICAgIHRoaXMudGhpbmtpbmdUb2dnbGVFbCA9IG51bGw7XHJcbiAgICB0aGlzLnRoaW5raW5nTGFiZWxFbCA9IG51bGw7XHJcbiAgICB0aGlzLnRoaW5raW5nQ2hldnJvbkVsID0gbnVsbDtcclxuICAgIHRoaXMudGhpbmtpbmdQYW5lbEVsID0gbnVsbDtcclxuICAgIHRoaXMudGhpbmtpbmdSb3dzID0gW107XHJcbiAgICB0aGlzLnRoaW5raW5nTWFudWFsRXhwYW5kZWQgPSBudWxsO1xyXG4gICAgdGhpcy5yZXNwb25zZVRpbWVFbCA9IG51bGw7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHNldHRsZVRoaW5raW5nKGRvbmVMYWJlbDogc3RyaW5nKTogdm9pZCB7XHJcbiAgICBpZiAoIXRoaXMudGhpbmtpbmdMYWJlbEVsKSByZXR1cm47XHJcblxyXG4gICAgdGhpcy50aGlua2luZ0xhYmVsRWwudGV4dENvbnRlbnQgPSBkb25lTGFiZWw7XHJcbiAgICB0aGlzLnRoaW5raW5nTGFiZWxFbC5yZW1vdmVDbGFzcyhcImZvcmdlLXRoaW5raW5nLWxhYmVsLS1hY3RpdmVcIik7XHJcbiAgICB0aGlzLnRoaW5raW5nTGFiZWxFbC5hZGRDbGFzcyhcImZvcmdlLXRoaW5raW5nLWxhYmVsLS1kb25lXCIpO1xyXG5cclxuICAgIGZvciAoY29uc3Qgcm93IG9mIHRoaXMudGhpbmtpbmdSb3dzKSB7XHJcbiAgICAgIHJvdy5yZW1vdmVDbGFzcyhcImZvcmdlLWhpZGRlblwiKTtcclxuICAgICAgcm93LnJlbW92ZUNsYXNzKFwiaXMtYWN0aXZlXCIpO1xyXG4gICAgICByb3cuYWRkQ2xhc3MoXCJpcy1kb25lXCIpO1xyXG5cclxuICAgICAgY29uc3QgbWFya2VyID0gcm93LmZpcnN0RWxlbWVudENoaWxkIGFzIEhUTUxFbGVtZW50IHwgbnVsbDtcclxuICAgICAgaWYgKG1hcmtlcikge1xyXG4gICAgICAgIG1hcmtlci50ZXh0Q29udGVudCA9IFwiXHUyNzEzXCI7XHJcbiAgICAgICAgbWFya2VyLnJlbW92ZUNsYXNzKFwiZm9yZ2UtdGhpbmtpbmctbWFya2VyLS1zcGlubmVyXCIpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgZXhwYW5kZWQgPSB0aGlzLnRoaW5raW5nTWFudWFsRXhwYW5kZWQgPz8gZmFsc2U7XHJcbiAgICB0aGlzLnRoaW5raW5nUGFuZWxFbD8udG9nZ2xlQ2xhc3MoXCJpcy1leHBhbmRlZFwiLCBleHBhbmRlZCk7XHJcbiAgICB0aGlzLnRoaW5raW5nVG9nZ2xlRWw/LnNldEF0dHJpYnV0ZShcImFyaWEtZXhwYW5kZWRcIiwgU3RyaW5nKGV4cGFuZGVkKSk7XHJcbiAgICB0aGlzLnRoaW5raW5nQ2hldnJvbkVsPy50b2dnbGVDbGFzcyhcImlzLWV4cGFuZGVkXCIsIGV4cGFuZGVkKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RvcFRoaW5raW5nU2VxdWVuY2UoKTogdm9pZCB7XHJcbiAgICBpZiAodGhpcy50aGlua2luZ1N0YWdlVGltZXIgIT09IG51bGwpIHtcclxuICAgICAgd2luZG93LmNsZWFyVGltZW91dCh0aGlzLnRoaW5raW5nU3RhZ2VUaW1lcik7XHJcbiAgICAgIHRoaXMudGhpbmtpbmdTdGFnZVRpbWVyID0gbnVsbDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhcnRUaGlua2luZ1NlcXVlbmNlKCk6IHZvaWQge1xyXG4gICAgdGhpcy50aGlua2luZ1N0YWdlID0gMDtcclxuICAgIHRoaXMucmVuZGVyVGhpbmtpbmdTdGFnZSgpO1xyXG4gICAgdGhpcy5zY2hlZHVsZVRoaW5raW5nU3RhZ2UoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc2NoZWR1bGVUaGlua2luZ1N0YWdlKCk6IHZvaWQge1xyXG4gICAgaWYgKHRoaXMudGhpbmtpbmdTdGFnZSA+PSB0aGlzLnRoaW5raW5nUm93cy5sZW5ndGggLSAxKSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgZGVsYXlzID0gWzgwMCwgNjAwLCAxODAwLCAyNjAwXTtcclxuICAgIGNvbnN0IGRlbGF5ID0gZGVsYXlzW3RoaXMudGhpbmtpbmdTdGFnZV0gPz8gMTIwMDtcclxuXHJcbiAgICB0aGlzLnRoaW5raW5nU3RhZ2VUaW1lciA9IHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgdGhpcy50aGlua2luZ1N0YWdlICs9IDE7XHJcbiAgICAgIHRoaXMucmVuZGVyVGhpbmtpbmdTdGFnZSgpO1xyXG4gICAgICB0aGlzLnNjaGVkdWxlVGhpbmtpbmdTdGFnZSgpO1xyXG4gICAgfSwgZGVsYXkpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZW5kZXJUaGlua2luZ1N0YWdlKCk6IHZvaWQge1xyXG4gICAgY29uc3QgdmlzaWJsZSA9IE1hdGgubWluKFxyXG4gICAgICB0aGlzLnRoaW5raW5nU3RhZ2UgKyAxLFxyXG4gICAgICB0aGlzLnRoaW5raW5nUm93cy5sZW5ndGgsXHJcbiAgICApO1xyXG5cclxuICAgIHRoaXMudGhpbmtpbmdSb3dzLmZvckVhY2goKHJvdywgaW5kZXgpID0+IHtcclxuICAgICAgY29uc3QgYWN0aXZlID0gaW5kZXggPT09IHZpc2libGUgLSAxO1xyXG4gICAgICBjb25zdCBkb25lID0gaW5kZXggPCB2aXNpYmxlIC0gMTtcclxuICAgICAgY29uc3QgbWFya2VyID0gcm93LmZpcnN0RWxlbWVudENoaWxkIGFzIEhUTUxFbGVtZW50IHwgbnVsbDtcclxuXHJcbiAgICAgIHJvdy50b2dnbGVDbGFzcyhcImZvcmdlLWhpZGRlblwiLCBpbmRleCA+PSB2aXNpYmxlKTtcclxuICAgICAgcm93LnRvZ2dsZUNsYXNzKFwiaXMtYWN0aXZlXCIsIGFjdGl2ZSk7XHJcbiAgICAgIHJvdy50b2dnbGVDbGFzcyhcImlzLWRvbmVcIiwgZG9uZSk7XHJcblxyXG4gICAgICBpZiAobWFya2VyKSB7XHJcbiAgICAgICAgbWFya2VyLnRleHRDb250ZW50ID0gZG9uZSA/IFwiXHUyNzEzXCIgOiBcIlwiO1xyXG4gICAgICAgIG1hcmtlci50b2dnbGVDbGFzcyhcImZvcmdlLXRoaW5raW5nLW1hcmtlci0tc3Bpbm5lclwiLCBhY3RpdmUpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhcnRMb2FkaW5nVGltZXIoKTogdm9pZCB7XHJcbiAgICBpZiAodGhpcy5sb2FkaW5nVGltZXIgIT09IG51bGwpIHtcclxuICAgICAgd2luZG93LmNsZWFySW50ZXJ2YWwodGhpcy5sb2FkaW5nVGltZXIpO1xyXG4gICAgICB0aGlzLmxvYWRpbmdUaW1lciA9IG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgdXBkYXRlID0gKCkgPT4ge1xyXG4gICAgICBjb25zdCBlbGFwc2VkID0gdGhpcy5mb3JtYXRFbGFwc2VkKERhdGUubm93KCkgLSB0aGlzLmxvYWRpbmdTdGFydGVkQXQpO1xyXG4gICAgICBpZiAodGhpcy5sb2FkaW5nRWxhcHNlZEVsKSB0aGlzLmxvYWRpbmdFbGFwc2VkRWwudGV4dENvbnRlbnQgPSBlbGFwc2VkO1xyXG4gICAgICBpZiAodGhpcy5yZXNwb25zZVRpbWVFbCkgdGhpcy5yZXNwb25zZVRpbWVFbC50ZXh0Q29udGVudCA9IGBmb3IgJHtlbGFwc2VkfWA7XHJcbiAgICB9O1xyXG5cclxuICAgIHRoaXMubG9hZGluZ1N0YXJ0ZWRBdCA9IERhdGUubm93KCk7XHJcbiAgICB1cGRhdGUoKTtcclxuICAgIHRoaXMubG9hZGluZ1RpbWVyID0gd2luZG93LnNldEludGVydmFsKHVwZGF0ZSwgMTAwKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RvcExvYWRpbmdUaW1lcigpOiB2b2lkIHtcclxuICAgIGlmICh0aGlzLmxvYWRpbmdUaW1lciAhPT0gbnVsbCkge1xyXG4gICAgICB3aW5kb3cuY2xlYXJJbnRlcnZhbCh0aGlzLmxvYWRpbmdUaW1lcik7XHJcbiAgICAgIHRoaXMubG9hZGluZ1RpbWVyID0gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLmxvYWRpbmdFbGFwc2VkRWwgPSBudWxsO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBmb3JtYXRFbGFwc2VkKG1pbGxpc2Vjb25kczogbnVtYmVyKTogc3RyaW5nIHtcclxuICAgIGNvbnN0IHNlY29uZHMgPSBtaWxsaXNlY29uZHMgLyAxMDAwO1xyXG5cclxuICAgIGlmIChzZWNvbmRzIDwgNjApIHJldHVybiBgJHtzZWNvbmRzLnRvRml4ZWQoMSl9c2A7XHJcblxyXG4gICAgcmV0dXJuIGAke01hdGguZmxvb3Ioc2Vjb25kcyAvIDYwKX1tICR7KHNlY29uZHMgJSA2MCkudG9GaXhlZCgxKX1zYDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc2V0VUlTdGF0ZShzdGF0ZTogVUlTdGF0ZSk6IHZvaWQge1xyXG4gICAgdGhpcy51aVN0YXRlID0gc3RhdGU7XHJcblxyXG4gICAgY29uc3QgYnVzeSA9IHN0YXRlID09PSBcIlJVTk5JTkdcIjtcclxuICAgIHRoaXMuY2FuY2VsQnRuLmRpc2FibGVkID0gZmFsc2U7XHJcbiAgICB0aGlzLmlucHV0LmRpc2FibGVkID0gYnVzeSB8fCBzdGF0ZSA9PT0gXCJFUlJPUlwiO1xyXG4gICAgdGhpcy5zZW5kQnRuLmRpc2FibGVkID1cclxuICAgICAgYnVzeSB8fCBzdGF0ZSA9PT0gXCJFUlJPUlwiIHx8ICF0aGlzLmNhblNlbmQoKTtcclxuICAgIHRoaXMuY2FuY2VsQnRuLnRvZ2dsZUNsYXNzKFwiZm9yZ2UtaGlkZGVuXCIsICFidXN5KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY2FuU2VuZCgpOiBib29sZWFuIHtcclxuICAgIHJldHVybiB0aGlzLmlucHV0LnZhbHVlLnRyaW0oKS5sZW5ndGggPiAwIHx8IHRoaXMuYXR0YWNobWVudHMubGVuZ3RoID4gMDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc2hvd0VtcHR5KCk6IHZvaWQge1xyXG4gICAgdGhpcy5zdG9wTG9hZGluZ1RpbWVyKCk7XHJcbiAgICB0aGlzLnRocmVhZC5lbXB0eSgpO1xyXG4gICAgdGhpcy5hZ2VudEN1cnNvckVsID0gbnVsbDtcclxuICAgIHRoaXMuc3RhdHVzRWwgPSBudWxsO1xyXG5cclxuICAgIGNvbnN0IHNsYXRlID0gdGhpcy50aHJlYWQuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImZvcmdlLWVtcHR5LXNsYXRlXCIsXHJcbiAgICB9KTtcclxuICAgIHNsYXRlLmNyZWF0ZUVsKFwiaW1nXCIsIHtcclxuICAgICAgY2xzOiBcImZvcmdlLWVtcHR5LWxvZ29cIixcclxuICAgICAgYXR0cjoge1xyXG4gICAgICAgIHNyYzogdGhpcy5nZXRMb2dvVXJsKCksXHJcbiAgICAgICAgYWx0OiBcIkZvcmdlXCIsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuICAgIGNvbnN0IGxhYmVsID0gXCJXaGF0IGFyZSB5b3UgbGVhcm5pbmc/XCI7XHJcblxyXG4gICAgc2xhdGUuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImZvcmdlLWVtcHR5LWxhYmVsXCIsXHJcbiAgICAgIHRleHQ6IGxhYmVsLFxyXG4gICAgfSk7XHJcbiAgICBzbGF0ZS5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwiZm9yZ2UtZW1wdHktaGludFwiLFxyXG4gICAgICB0ZXh0OiBcIkFzayBhYm91dCB0aGUgY3VycmVudCBub3RlLCBvciBqdW1wIGludG8gYSBmb2N1c2VkIHdvcmtmbG93IHdoZW4geW91IG5lZWQgbW9yZSB0aGFuIGNoYXQuXCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBxdWlja0FjdGlvbnMgPSBzbGF0ZS5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtZW1wdHktYWN0aW9uc1wiIH0pO1xyXG4gICAgY29uc3QgcXVpY2tBY3Rpb25NYXA6IEFycmF5PFtMZWFybmluZ0FjdGlvbktpbmQsIHN0cmluZ10+ID0gW1xyXG4gICAgICBbXCJleHBsYWluXCIsIFwiRXhwbGFpbiB0aGlzXCJdLFxyXG4gICAgICBbXCJwcmFjdGljZVwiLCBcIlByYWN0aWNlXCJdLFxyXG4gICAgICBbXCJlZGl0XCIsIFwiSW1wcm92ZSBub3RlXCJdLFxyXG4gICAgXTtcclxuICAgIGZvciAoY29uc3QgW2FjdGlvbiwgdGV4dF0gb2YgcXVpY2tBY3Rpb25NYXApIHtcclxuICAgICAgY29uc3QgYnV0dG9uID0gcXVpY2tBY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcclxuICAgICAgICBjbHM6IFwiZm9yZ2UtZW1wdHktYWN0aW9uXCIsXHJcbiAgICAgICAgdGV4dCxcclxuICAgICAgICBhdHRyOiB7IHR5cGU6IFwiYnV0dG9uXCIgfSxcclxuICAgICAgfSk7XHJcbiAgICAgIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAgIHRoaXMuc2V0QWN0aW9uKGFjdGlvbik7XHJcbiAgICAgICAgdGhpcy5mb2N1c0NvbXBvc2VyKCk7XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuc2V0VUlTdGF0ZShcIkVNUFRZXCIpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyByZXN0b3JlU2Vzc2lvbigpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IG1lc3NhZ2VzID0gdGhpcy5sZWFybmluZy5nZXRTZXNzaW9uKCkubWVzc2FnZXM7XHJcbiAgICBpZiAobWVzc2FnZXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIHRoaXMuc2hvd0VtcHR5KCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLnRocmVhZC5lbXB0eSgpO1xyXG4gICAgZm9yIChjb25zdCBtZXNzYWdlIG9mIG1lc3NhZ2VzKSB7XHJcbiAgICAgIGlmIChtZXNzYWdlLnJvbGUgPT09IFwidXNlclwiKSB7XHJcbiAgICAgICAgdGhpcy5hcHBlbmRVc2VyQnViYmxlKG1lc3NhZ2UuY29udGVudCk7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKG1lc3NhZ2UuY29udGVudC50cmltKCkpIHtcclxuICAgICAgICBhd2FpdCB0aGlzLmFwcGVuZFJlc3RvcmVkQXNzaXN0YW50KG1lc3NhZ2UuY29udGVudCk7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKG1lc3NhZ2UucHJvcG9zYWwpIHtcclxuICAgICAgICB0aGlzLmFwcGVuZFJlc3RvcmVkUHJvcG9zYWwobWVzc2FnZSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIHRoaXMuc2V0VUlTdGF0ZShcIkFOU1dFUlwiKTtcclxuICAgIHRoaXMuc2Nyb2xsVGhyZWFkKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGFwcGVuZFJlc3RvcmVkQXNzaXN0YW50KG1hcmtkb3duOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IGJ1YmJsZSA9IHRoaXMudGhyZWFkLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJmb3JnZS1idWJibGUgZm9yZ2UtYnViYmxlLS1hZ2VudFwiLFxyXG4gICAgfSk7XHJcbiAgICBjb25zdCBtZXRhID0gYnViYmxlLmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1yZXNwb25zZS1tZXRhXCIgfSk7XHJcbiAgICBtZXRhLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9yZ2UtcmVzcG9uc2UtbGFiZWxcIiwgdGV4dDogXCJGb3JnZVwiIH0pO1xyXG4gICAgbWV0YS5jcmVhdGVTcGFuKHsgY2xzOiBcImZvcmdlLXJlc3BvbnNlLXN1YlwiLCB0ZXh0OiBcIlJlc3RvcmVkXCIgfSk7XHJcbiAgICBjb25zdCBjb250ZW50ID0gYnViYmxlLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJmb3JnZS1idWJibGUtY29udGVudCBmb3JnZS1tYXJrZG93blwiLFxyXG4gICAgfSk7XHJcbiAgICBjb25zdCBzb3VyY2VQYXRoID1cclxuICAgICAgdGhpcy5jdXJyZW50Q29udGV4dD8uc2VsZWN0aW9uPy5maWxlID8/XHJcbiAgICAgIHRoaXMuY3VycmVudENvbnRleHQ/LmFjdGl2ZU5vdGU/LnBhdGggPz9cclxuICAgICAgXCJGb3JnZS5tZFwiO1xyXG4gICAgYXdhaXQgTWFya2Rvd25SZW5kZXJlci5yZW5kZXIoXHJcbiAgICAgIHRoaXMuYXBwLFxyXG4gICAgICBtYXJrZG93bixcclxuICAgICAgY29udGVudCxcclxuICAgICAgc291cmNlUGF0aCxcclxuICAgICAgdGhpcyxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFwcGVuZFJlc3RvcmVkUHJvcG9zYWwobWVzc2FnZTogQ2hhdE1lc3NhZ2UpOiB2b2lkIHtcclxuICAgIGNvbnN0IHByb3Bvc2FsID0gbWVzc2FnZS5wcm9wb3NhbDtcclxuICAgIGlmICghcHJvcG9zYWwpIHJldHVybjtcclxuICAgIGNvbnN0IHdyYXAgPSB0aGlzLnJlbmRlclByb3Bvc2FsKHByb3Bvc2FsKTtcclxuICAgIGNvbnN0IHN0YXRlID0gbWVzc2FnZS5wcm9wb3NhbFN0YXRlID8/IFwic3RhbGVcIjtcclxuICAgIGNvbnN0IGxhYmVsczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcclxuICAgICAgYXBwbGllZDogYFx1MjcxMyBBcHBsaWVkIHRvICR7cHJvcG9zYWwuZmlsZX1gLFxyXG4gICAgICByZWplY3RlZDogXCJcdTI3MTUgUmVqZWN0ZWRcIixcclxuICAgICAgc3RhbGU6IFwiXHUyNkEwIEV4cGlyZWQgYWZ0ZXIgcmVzdGFydFwiLFxyXG4gICAgICBwZW5kaW5nOiBcIlx1MjZBMCBFeHBpcmVkIGFmdGVyIHJlc3RhcnRcIixcclxuICAgIH07XHJcbiAgICB3cmFwLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogYGZvcmdlLXJlc3VsdC1iYWRnZSBmb3JnZS1iYWRnZS0tJHtzdGF0ZSA9PT0gXCJhcHBsaWVkXCIgPyBcImFwcGxpZWRcIiA6IHN0YXRlID09PSBcInJlamVjdGVkXCIgPyBcInJlamVjdGVkXCIgOiBcInN0YWxlXCJ9YCxcclxuICAgICAgdGV4dDogbGFiZWxzW3N0YXRlXSxcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzaG93RXJyb3IobWVzc2FnZTogc3RyaW5nKTogdm9pZCB7XHJcbiAgICB0aGlzLnN0b3BMb2FkaW5nVGltZXIoKTtcclxuICAgIHRoaXMudGhyZWFkLmVtcHR5KCk7XHJcbiAgICB0aGlzLmFnZW50Q3Vyc29yRWwgPSBudWxsO1xyXG4gICAgdGhpcy5zdGF0dXNFbCA9IG51bGw7XHJcblxyXG4gICAgY29uc3Qgc2xhdGUgPSB0aGlzLnRocmVhZC5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwiZm9yZ2UtZXJyb3Itc2xhdGVcIixcclxuICAgIH0pO1xyXG4gICAgc2xhdGUuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImZvcmdlLWVycm9yLWljb25cIixcclxuICAgICAgdGV4dDogXCJcdTI2QTBcIixcclxuICAgIH0pO1xyXG4gICAgc2xhdGUuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImZvcmdlLWVycm9yLXRpdGxlXCIsXHJcbiAgICAgIHRleHQ6IFwiRm9yZ2UgdW5hdmFpbGFibGVcIixcclxuICAgIH0pO1xyXG4gICAgc2xhdGUuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImZvcmdlLWVycm9yLWJvZHlcIixcclxuICAgICAgdGV4dDogbWVzc2FnZSxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGJ1dHRvbiA9IHNsYXRlLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcclxuICAgICAgY2xzOiBcImZvcmdlLWNvbmZpZ3VyZS1idG5cIixcclxuICAgICAgdGV4dDogXCJDb25maWd1cmUgRm9yZ2UgXHUyMTkyXCIsXHJcbiAgICB9KTtcclxuICAgIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICB0aGlzLm9wZW5TZXR0aW5ncygpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5zZXRVSVN0YXRlKFwiRVJST1JcIik7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFwcGVuZFVzZXJCdWJibGUodGV4dDogc3RyaW5nKTogdm9pZCB7XHJcbiAgICB0aGlzLnRocmVhZC5xdWVyeVNlbGVjdG9yKFwiLmZvcmdlLWVtcHR5LXNsYXRlXCIpPy5yZW1vdmUoKTtcclxuICAgIGNvbnN0IGJ1YmJsZSA9IHRoaXMudGhyZWFkLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJmb3JnZS1idWJibGUgZm9yZ2UtYnViYmxlLS11c2VyXCIsXHJcbiAgICB9KTtcclxuICAgIGJ1YmJsZS5zZXRUZXh0KHRleHQpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBlbnN1cmVBZ2VudEJ1YmJsZSgpOiB2b2lkIHtcclxuICAgIGlmICh0aGlzLmFnZW50Q3Vyc29yRWwpIHJldHVybjtcclxuXHJcbiAgICB0aGlzLnN0YXR1c0VsID0gdGhpcy5idWlsZFRoaW5raW5nVHJhY2UoKTtcclxuXHJcbiAgICB0aGlzLmFnZW50Q3Vyc29yRWwgPSB0aGlzLnRocmVhZC5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwiZm9yZ2UtYnViYmxlIGZvcmdlLWJ1YmJsZS0tYWdlbnQgZm9yZ2UtYnViYmxlLS1zdHJlYW1pbmdcIixcclxuICAgIH0pO1xyXG4gICAgY29uc3QgbWV0YSA9IHRoaXMuYWdlbnRDdXJzb3JFbC5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtcmVzcG9uc2UtbWV0YVwiIH0pO1xyXG4gICAgbWV0YS5jcmVhdGVTcGFuKHsgY2xzOiBcImZvcmdlLXJlc3BvbnNlLWxhYmVsXCIsIHRleHQ6IFwiRm9yZ2VcIiB9KTtcclxuICAgIG1ldGEuY3JlYXRlU3Bhbih7XHJcbiAgICAgIGNsczogXCJmb3JnZS1yZXNwb25zZS1zdWJcIixcclxuICAgICAgdGV4dDogQUNUSU9OUy5maW5kKChhY3Rpb24pID0+IGFjdGlvbi5raW5kID09PSB0aGlzLnNlbGVjdGVkQWN0aW9uKT8ubGFiZWwgPz8gXCJSZXNwb25zZVwiLFxyXG4gICAgfSk7XHJcbiAgICB0aGlzLnJlc3BvbnNlVGltZUVsID0gbWV0YS5jcmVhdGVTcGFuKHsgY2xzOiBcImZvcmdlLXJlc3BvbnNlLXRpbWVcIiwgdGV4dDogXCJmb3IgMC4wc1wiIH0pO1xyXG4gICAgdGhpcy5hZ2VudENvbnRlbnRFbCA9IHRoaXMuYWdlbnRDdXJzb3JFbC5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwiZm9yZ2UtYnViYmxlLWNvbnRlbnRcIixcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBidWlsZFRoaW5raW5nVHJhY2UoKTogSFRNTEVsZW1lbnQge1xyXG4gICAgY29uc3QgdHJhY2UgPSB0aGlzLnRocmVhZC5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtdGhpbmtpbmdcIiB9KTtcclxuICAgIHRyYWNlLnNldEF0dHJpYnV0ZShcInJvbGVcIiwgXCJzdGF0dXNcIik7XHJcbiAgICB0cmFjZS5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxpdmVcIiwgXCJwb2xpdGVcIik7XHJcblxyXG4gICAgY29uc3QgdG9nZ2xlID0gdHJhY2UuY3JlYXRlRWwoXCJidXR0b25cIiwge1xyXG4gICAgICBjbHM6IFwiZm9yZ2UtdGhpbmtpbmctdG9nZ2xlXCIsXHJcbiAgICAgIGF0dHI6IHsgdHlwZTogXCJidXR0b25cIiwgXCJhcmlhLWV4cGFuZGVkXCI6IFwiZmFsc2VcIiB9LFxyXG4gICAgfSk7XHJcbiAgICB0aGlzLnRoaW5raW5nVG9nZ2xlRWwgPSB0b2dnbGU7XHJcblxyXG4gICAgdG9nZ2xlLmNyZWF0ZUVsKFwiaW1nXCIsIHtcclxuICAgICAgY2xzOiBcImZvcmdlLXRoaW5raW5nLWxvZ29cIixcclxuICAgICAgYXR0cjogeyBzcmM6IHRoaXMuZ2V0TG9nb1VybCgpLCBhbHQ6IFwiXCIgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMudGhpbmtpbmdMYWJlbEVsID0gdG9nZ2xlLmNyZWF0ZVNwYW4oe1xyXG4gICAgICBjbHM6IFwiZm9yZ2UtdGhpbmtpbmctbGFiZWwgZm9yZ2UtdGhpbmtpbmctbGFiZWwtLWFjdGl2ZVwiLFxyXG4gICAgICB0ZXh0OiBcIldvcmtpbmdcIixcclxuICAgIH0pO1xyXG4gICAgdGhpcy5sb2FkaW5nRWxhcHNlZEVsID0gdG9nZ2xlLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9yZ2UtdGhpbmtpbmctZWxhcHNlZFwiIH0pO1xyXG4gICAgdGhpcy5sb2FkaW5nRWxhcHNlZEVsLnNldEF0dHJpYnV0ZShcImFyaWEtaGlkZGVuXCIsIFwidHJ1ZVwiKTtcclxuXHJcbiAgICBjb25zdCBjaGV2cm9uID0gdG9nZ2xlLmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9yZ2UtdGhpbmtpbmctY2hldnJvblwiLCB0ZXh0OiBcIlx1MjMwNFwiIH0pO1xyXG4gICAgdGhpcy50aGlua2luZ0NoZXZyb25FbCA9IGNoZXZyb247XHJcblxyXG4gICAgY29uc3QgcGFuZWwgPSB0cmFjZS5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtdGhpbmtpbmctcGFuZWxcIiB9KTtcclxuICAgIHRoaXMudGhpbmtpbmdQYW5lbEVsID0gcGFuZWw7XHJcbiAgICBjb25zdCBsaXN0ID0gcGFuZWwuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLXRoaW5raW5nLXRyYWNlIGZvcmdlLXRoaW5raW5nLXRyYWNlLS1mYWN0c1wiIH0pO1xyXG5cclxuICAgIGNvbnN0IHNvdXJjZSA9IHRoaXMuY3VycmVudENvbnRleHQ/LnNlbGVjdGlvbj8uZmlsZSA/PyB0aGlzLmN1cnJlbnRDb250ZXh0Py5hY3RpdmVOb3RlPy5wYXRoO1xyXG4gICAgY29uc3QgZmFjdHM6IEFycmF5PHsgcHJpbWFyeTogc3RyaW5nOyBzZWNvbmRhcnk/OiBzdHJpbmcgfT4gPSBbXHJcbiAgICAgIHtcclxuICAgICAgICBwcmltYXJ5OiB0aGlzLmN1cnJlbnRDb250ZXh0Py5zZWxlY3Rpb25cclxuICAgICAgICAgID8gXCJDdXJyZW50IHNlbGVjdGlvblwiXHJcbiAgICAgICAgICA6IHRoaXMuY3VycmVudENvbnRleHQ/LmFjdGl2ZU5vdGUgPyBcIkN1cnJlbnQgbm90ZVwiIDogXCJObyBhdXRvbWF0aWMgbm90ZSBjb250ZXh0XCIsXHJcbiAgICAgICAgc2Vjb25kYXJ5OiBzb3VyY2U/LnNwbGl0KFwiL1wiKS5wb3AoKSxcclxuICAgICAgfSxcclxuICAgICAge1xyXG4gICAgICAgIHByaW1hcnk6IFwiTGVhcm5pbmcgaW50ZW50XCIsXHJcbiAgICAgICAgc2Vjb25kYXJ5OiBBQ1RJT05TLmZpbmQoKGFjdGlvbikgPT4gYWN0aW9uLmtpbmQgPT09IHRoaXMucnVubmluZ0FjdGlvbik/LmxhYmVsID8/IFwiQXNrXCIsXHJcbiAgICAgIH0sXHJcbiAgICBdO1xyXG5cclxuICAgIHRoaXMudGhpbmtpbmdSb3dzID0gZmFjdHMubWFwKChmYWN0KSA9PiB7XHJcbiAgICAgIGNvbnN0IHJvdyA9IGxpc3QuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLXRoaW5raW5nLXJvdyBpcy1kb25lXCIgfSk7XHJcbiAgICAgIHJvdy5jcmVhdGVTcGFuKHsgY2xzOiBcImZvcmdlLXRoaW5raW5nLW1hcmtlclwiLCB0ZXh0OiBcIlx1MDBCN1wiIH0pO1xyXG4gICAgICByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJmb3JnZS10aGlua2luZy1wcmltYXJ5XCIsIHRleHQ6IGZhY3QucHJpbWFyeSB9KTtcclxuICAgICAgaWYgKGZhY3Quc2Vjb25kYXJ5KSByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJmb3JnZS10aGlua2luZy1zZWNvbmRhcnlcIiwgdGV4dDogZmFjdC5zZWNvbmRhcnkgfSk7XHJcbiAgICAgIHJldHVybiByb3c7XHJcbiAgICB9KTtcclxuXHJcbiAgICB0b2dnbGUuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgY29uc3QgZXhwYW5kZWQgPSAhcGFuZWwuaGFzQ2xhc3MoXCJpcy1leHBhbmRlZFwiKTtcclxuICAgICAgcGFuZWwudG9nZ2xlQ2xhc3MoXCJpcy1leHBhbmRlZFwiLCBleHBhbmRlZCk7XHJcbiAgICAgIHRvZ2dsZS5zZXRBdHRyaWJ1dGUoXCJhcmlhLWV4cGFuZGVkXCIsIFN0cmluZyhleHBhbmRlZCkpO1xyXG4gICAgICBjaGV2cm9uLnRvZ2dsZUNsYXNzKFwiaXMtZXhwYW5kZWRcIiwgZXhwYW5kZWQpO1xyXG4gICAgICB0aGlzLnRoaW5raW5nTWFudWFsRXhwYW5kZWQgPSBleHBhbmRlZDtcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuc3RhcnRMb2FkaW5nVGltZXIoKTtcclxuICAgIHJldHVybiB0cmFjZTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXBwZW5kVG9BZ2VudEJ1YmJsZSh0ZXh0OiBzdHJpbmcpOiB2b2lkIHtcclxuICAgIGlmICghdGhpcy5hZ2VudENvbnRlbnRFbCkgcmV0dXJuO1xyXG5cclxuICAgIHRoaXMuc3RyZWFtZWRSZXNwb25zZVRleHQgKz0gdGV4dDtcclxuICAgIHRoaXMuc3RyZWFtaW5nUGVuZGluZ1RleHQgKz0gdGV4dDtcclxuXHJcbiAgICBjb25zdCBwYXJ0cyA9IHRoaXMuc3RyZWFtaW5nUGVuZGluZ1RleHQuc3BsaXQoLyhcXHMrKS8pO1xyXG4gICAgY29uc3QgbGFzdFBhcnQgPSBwYXJ0c1twYXJ0cy5sZW5ndGggLSAxXSA/PyBcIlwiO1xyXG4gICAgY29uc3QgaGFzVHJhaWxpbmdXaGl0ZXNwYWNlID0gL1xccyQvLnRlc3QodGhpcy5zdHJlYW1pbmdQZW5kaW5nVGV4dCk7XHJcblxyXG4gICAgaWYgKCFoYXNUcmFpbGluZ1doaXRlc3BhY2UpIHtcclxuICAgICAgdGhpcy5zdHJlYW1pbmdQZW5kaW5nVGV4dCA9IHBhcnRzLnBvcCgpID8/IGxhc3RQYXJ0O1xyXG4gICAgfSBlbHNlIHtcclxuICAgICAgdGhpcy5zdHJlYW1pbmdQZW5kaW5nVGV4dCA9IFwiXCI7XHJcbiAgICB9XHJcblxyXG4gICAgZm9yIChjb25zdCBwYXJ0IG9mIHBhcnRzKSB7XHJcbiAgICAgIGlmICghcGFydCkgY29udGludWU7XHJcblxyXG4gICAgICBpZiAoL1xccysvLnRlc3QocGFydCkpIHtcclxuICAgICAgICB0aGlzLmFnZW50Q29udGVudEVsLmFwcGVuZFRleHQocGFydCk7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRoaXMuYWdlbnRDb250ZW50RWwuY3JlYXRlU3Bhbih7XHJcbiAgICAgICAgY2xzOiBcImZvcmdlLXN0cmVhbS13b3JkXCIsXHJcbiAgICAgICAgdGV4dDogcGFydCxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5zY3JvbGxUaHJlYWQoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZmx1c2hTdHJlYW1pbmdUZXh0KCk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLmFnZW50Q29udGVudEVsIHx8ICF0aGlzLnN0cmVhbWluZ1BlbmRpbmdUZXh0KSByZXR1cm47XHJcblxyXG4gICAgdGhpcy5hZ2VudENvbnRlbnRFbC5jcmVhdGVTcGFuKHtcclxuICAgICAgY2xzOiBcImZvcmdlLXN0cmVhbS13b3JkXCIsXHJcbiAgICAgIHRleHQ6IHRoaXMuc3RyZWFtaW5nUGVuZGluZ1RleHQsXHJcbiAgICB9KTtcclxuICAgIHRoaXMuc3RyZWFtaW5nUGVuZGluZ1RleHQgPSBcIlwiO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZW5kZXJNYXJrZG93blJlc3BvbnNlKCk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLmFnZW50Q29udGVudEVsIHx8ICF0aGlzLnN0cmVhbWVkUmVzcG9uc2VUZXh0LnRyaW0oKSkgcmV0dXJuO1xyXG5cclxuICAgIGNvbnN0IGNvbnRlbnQgPSB0aGlzLmFnZW50Q29udGVudEVsO1xyXG4gICAgY29uc3QgbWFya2Rvd24gPSB0aGlzLnN0cmVhbWVkUmVzcG9uc2VUZXh0O1xyXG4gICAgY29uc3Qgc291cmNlUGF0aCA9XHJcbiAgICAgIHRoaXMuY3VycmVudENvbnRleHQ/LnNlbGVjdGlvbj8uZmlsZSA/P1xyXG4gICAgICB0aGlzLmN1cnJlbnRDb250ZXh0Py5hY3RpdmVOb3RlPy5wYXRoID8/XHJcbiAgICAgIFwiRm9yZ2UubWRcIjtcclxuXHJcbiAgICBjb250ZW50LmVtcHR5KCk7XHJcbiAgICBjb250ZW50LmFkZENsYXNzKFwiZm9yZ2UtbWFya2Rvd25cIik7XHJcblxyXG4gICAgdm9pZCBNYXJrZG93blJlbmRlcmVyLnJlbmRlcih0aGlzLmFwcCwgbWFya2Rvd24sIGNvbnRlbnQsIHNvdXJjZVBhdGgsIHRoaXMpLmNhdGNoKCgpID0+IHtcclxuICAgICAgY29udGVudC5lbXB0eSgpO1xyXG4gICAgICBjb250ZW50LnJlbW92ZUNsYXNzKFwiZm9yZ2UtbWFya2Rvd25cIik7XHJcbiAgICAgIGNvbnRlbnQuYWRkQ2xhc3MoXCJmb3JnZS1tYXJrZG93bi1lcnJvclwiKTtcclxuICAgICAgY29udGVudC5zZXRUZXh0KFwiTWFya2Rvd24gcmVzcG9uc2UgY291bGQgbm90IGJlIHJlbmRlcmVkLlwiKTtcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhcHBlbmRTdHJlYW1BY3Rpb25zKCk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLmFnZW50Q3Vyc29yRWwgfHwgIXRoaXMuc3RyZWFtZWRSZXNwb25zZVRleHQudHJpbSgpKSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgcmVzcG9uc2VUZXh0ID0gdGhpcy5zdHJlYW1lZFJlc3BvbnNlVGV4dC50cmltKCk7XHJcbiAgICBjb25zdCBhY3Rpb25zID0gdGhpcy5hZ2VudEN1cnNvckVsLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJmb3JnZS1zdHJlYW0tYWN0aW9uc1wiLFxyXG4gICAgfSk7XHJcbiAgICBjb25zdCBjb3B5QnV0dG9uID0gYWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7XHJcbiAgICAgIGNsczogXCJmb3JnZS1zdHJlYW0tYWN0aW9uXCIsXHJcbiAgICAgIHRleHQ6IFwiQ29weVwiLFxyXG4gICAgICBhdHRyOiB7XHJcbiAgICAgICAgdHlwZTogXCJidXR0b25cIixcclxuICAgICAgICBcImFyaWEtbGFiZWxcIjogXCJDb3B5IHJlc3BvbnNlXCIsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb3B5QnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIHRyeSB7XHJcbiAgICAgICAgYXdhaXQgbmF2aWdhdG9yLmNsaXBib2FyZC53cml0ZVRleHQocmVzcG9uc2VUZXh0KTtcclxuICAgICAgICBjb3B5QnV0dG9uLnRleHRDb250ZW50ID0gXCJDb3BpZWRcIjtcclxuICAgICAgfSBjYXRjaCB7XHJcbiAgICAgICAgY29weUJ1dHRvbi50ZXh0Q29udGVudCA9IFwiQ29weSBmYWlsZWRcIjtcclxuICAgICAgfVxyXG5cclxuICAgICAgd2luZG93LnNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICAgIGNvcHlCdXR0b24udGV4dENvbnRlbnQgPSBcIkNvcHlcIjtcclxuICAgICAgfSwgMTQwMCk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXBwZW5kUHJhY3RpY2VRdWVzdGlvbihcclxuICAgIHF1ZXN0aW9uOiBQcmFjdGljZVF1ZXN0aW9uLFxyXG4gICk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLmFnZW50Q3Vyc29yRWwpIHJldHVybjtcclxuXHJcbiAgICBjb25zdCBjYXJkID0gdGhpcy5hZ2VudEN1cnNvckVsLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJmb3JnZS1wcmFjdGljZS1jYXJkXCIsXHJcbiAgICB9KTtcclxuICAgIGNhcmQuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImZvcmdlLXByYWN0aWNlLWxhYmVsXCIsXHJcbiAgICAgIHRleHQ6IGBQcmFjdGljZSBcdTAwQjcgJHtxdWVzdGlvbi5jb25jZXB0fWAsXHJcbiAgICB9KTtcclxuICAgIGNhcmQuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImZvcmdlLXByYWN0aWNlLXF1ZXN0aW9uXCIsXHJcbiAgICAgIHRleHQ6IHF1ZXN0aW9uLnF1ZXN0aW9uLFxyXG4gICAgfSk7XHJcblxyXG4gICAgaWYgKHF1ZXN0aW9uLmhpbnQpIHtcclxuICAgICAgY2FyZC5jcmVhdGVEaXYoe1xyXG4gICAgICAgIGNsczogXCJmb3JnZS1wcmFjdGljZS1oaW50XCIsXHJcbiAgICAgICAgdGV4dDogYEhpbnQ6ICR7cXVlc3Rpb24uaGludH1gLFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLnNjcm9sbFRocmVhZCgpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhcHBlbmRQcmFjdGljZUV2YWx1YXRpb24oXHJcbiAgICBldmFsdWF0aW9uOiBQcmFjdGljZUV2YWx1YXRpb24sXHJcbiAgKTogdm9pZCB7XHJcbiAgICBpZiAoIXRoaXMuYWdlbnRDdXJzb3JFbCkgcmV0dXJuO1xyXG5cclxuICAgIGNvbnN0IGNhcmQgPSB0aGlzLmFnZW50Q3Vyc29yRWwuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBgZm9yZ2UtcHJhY3RpY2UtZXZhbHVhdGlvbiBmb3JnZS1vdXRjb21lLS0ke2V2YWx1YXRpb24ub3V0Y29tZX1gLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3Qgb3V0Y29tZUxhYmVsID1cclxuICAgICAgZXZhbHVhdGlvbi5vdXRjb21lID09PSBcImNvcnJlY3RcIlxyXG4gICAgICAgID8gXCJDb3JyZWN0XCJcclxuICAgICAgICA6IGV2YWx1YXRpb24ub3V0Y29tZSA9PT0gXCJwYXJ0aWFsXCJcclxuICAgICAgICAgID8gXCJQYXJ0aWFsXCJcclxuICAgICAgICAgIDogXCJOZWVkcyB3b3JrXCI7XHJcblxyXG4gICAgY2FyZC5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwiZm9yZ2UtcHJhY3RpY2UtbGFiZWxcIixcclxuICAgICAgdGV4dDogYCR7b3V0Y29tZUxhYmVsfSBcdTAwQjcgJHtldmFsdWF0aW9uLmNvbmNlcHR9YCxcclxuICAgIH0pO1xyXG4gICAgY2FyZC5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwiZm9yZ2UtcHJhY3RpY2UtZmVlZGJhY2tcIixcclxuICAgICAgdGV4dDogZXZhbHVhdGlvbi5mZWVkYmFjayxcclxuICAgIH0pO1xyXG5cclxuICAgIGlmIChldmFsdWF0aW9uLm1pc2NvbmNlcHRpb25zLmxlbmd0aCA+IDApIHtcclxuICAgICAgY29uc3QgZ2FwcyA9IGNhcmQuY3JlYXRlRGl2KHtcclxuICAgICAgICBjbHM6IFwiZm9yZ2UtcHJhY3RpY2UtZ2Fwc1wiLFxyXG4gICAgICB9KTtcclxuICAgICAgZ2Fwcy5jcmVhdGVEaXYoe1xyXG4gICAgICAgIGNsczogXCJmb3JnZS1wcmFjdGljZS1nYXBzLWxhYmVsXCIsXHJcbiAgICAgICAgdGV4dDogXCJHYXBcIixcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBmb3IgKGNvbnN0IG1pc2NvbmNlcHRpb24gb2YgZXZhbHVhdGlvbi5taXNjb25jZXB0aW9ucykge1xyXG4gICAgICAgIGdhcHMuY3JlYXRlRGl2KHtcclxuICAgICAgICAgIGNsczogXCJmb3JnZS1wcmFjdGljZS1nYXBcIixcclxuICAgICAgICAgIHRleHQ6IG1pc2NvbmNlcHRpb24sXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICB0aGlzLnNjcm9sbFRocmVhZCgpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhcHBlbmRSZXZpZXdGaW5kaW5ncyhmaW5kaW5nczogUmV2aWV3RmluZGluZ1tdKTogdm9pZCB7XHJcbiAgICBpZiAoIXRoaXMuYWdlbnRDdXJzb3JFbCkgcmV0dXJuO1xyXG5cclxuICAgIGNvbnN0IHdyYXAgPSB0aGlzLmFnZW50Q3Vyc29yRWwuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLXJldmlld1wiIH0pO1xyXG4gICAgd3JhcC5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwiZm9yZ2UtcmV2aWV3LXN1bW1hcnlcIixcclxuICAgICAgdGV4dDogZmluZGluZ3MubGVuZ3RoID09PSAwXHJcbiAgICAgICAgPyBcIk5vIG1hdGVyaWFsIGxlYXJuaW5nIGdhcHMgZm91bmQuXCJcclxuICAgICAgICA6IGAke2ZpbmRpbmdzLmxlbmd0aH0gaW1wb3J0YW50ICR7ZmluZGluZ3MubGVuZ3RoID09PSAxID8gXCJnYXBcIiA6IFwiZ2Fwc1wifWAsXHJcbiAgICB9KTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGZpbmRpbmcgb2YgZmluZGluZ3MpIHtcclxuICAgICAgY29uc3QgY2FyZCA9IHdyYXAuY3JlYXRlRGl2KHtcclxuICAgICAgICBjbHM6IGBmb3JnZS1yZXZpZXctY2FyZCBmb3JnZS1yZXZpZXctY2FyZC0tJHtmaW5kaW5nLmtpbmR9YCxcclxuICAgICAgfSk7XHJcbiAgICAgIGNhcmQuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLXJldmlldy1raW5kXCIsIHRleHQ6IGZpbmRpbmcua2luZC5yZXBsYWNlKFwiLVwiLCBcIiBcIikgfSk7XHJcbiAgICAgIGNhcmQuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLXJldmlldy10aXRsZVwiLCB0ZXh0OiBmaW5kaW5nLnRpdGxlIH0pO1xyXG4gICAgICBjYXJkLmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1yZXZpZXctZGV0YWlsXCIsIHRleHQ6IGZpbmRpbmcuZGV0YWlsIH0pO1xyXG5cclxuICAgICAgY29uc3QgYWN0aW9ucyA9IGNhcmQuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLXJldmlldy1hY3Rpb25zXCIgfSk7XHJcbiAgICAgIGNvbnN0IHByYWN0aWNlID0gYWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7XHJcbiAgICAgICAgY2xzOiBcImZvcmdlLXJldmlldy1hY3Rpb25cIixcclxuICAgICAgICB0ZXh0OiBcIlByYWN0aWNlXCIsXHJcbiAgICAgICAgYXR0cjogeyB0eXBlOiBcImJ1dHRvblwiIH0sXHJcbiAgICAgIH0pO1xyXG4gICAgICBwcmFjdGljZS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAgIHRoaXMuc2V0QWN0aW9uKFwicHJhY3RpY2VcIik7XHJcbiAgICAgICAgdGhpcy5pbnB1dC52YWx1ZSA9IGBQcmFjdGljZSB0aGlzIGdhcDogJHtmaW5kaW5nLmNvbmNlcHR9IFx1MjAxNCAke2ZpbmRpbmcuZGV0YWlsfWA7XHJcbiAgICAgICAgdGhpcy5vbklucHV0KCk7XHJcbiAgICAgICAgdGhpcy5pbnB1dC5mb2N1cygpO1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IGZpeCA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwge1xyXG4gICAgICAgIGNsczogXCJmb3JnZS1yZXZpZXctYWN0aW9uXCIsXHJcbiAgICAgICAgdGV4dDogXCJGaXhcIixcclxuICAgICAgICBhdHRyOiB7IHR5cGU6IFwiYnV0dG9uXCIgfSxcclxuICAgICAgfSk7XHJcbiAgICAgIGZpeC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAgIHRoaXMuc2V0QWN0aW9uKFwiZWRpdFwiKTtcclxuICAgICAgICB0aGlzLmlucHV0LnZhbHVlID0gYEZpeCB0aGlzIGxlYXJuaW5nIGdhcDogJHtmaW5kaW5nLmRldGFpbH1gO1xyXG4gICAgICAgIHRoaXMub25JbnB1dCgpO1xyXG4gICAgICAgIHRoaXMuaW5wdXQuZm9jdXMoKTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5zY3JvbGxUaHJlYWQoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXBwZW5kUHJvZ3Jlc3NVcGRhdGUoXHJcbiAgICB0b3BpYzogc3RyaW5nIHwgdW5kZWZpbmVkLFxyXG4gICAgZ2FwczogQXJyYXk8eyBzdGF0dXM6IHN0cmluZyB9PixcclxuICApOiB2b2lkIHtcclxuICAgIGlmICghdG9waWMpIHJldHVybjtcclxuICAgIGNvbnN0IG9wZW4gPSBnYXBzLmZpbHRlcigoZ2FwKSA9PiBnYXAuc3RhdHVzID09PSBcIm9wZW5cIikubGVuZ3RoO1xuICAgIGNvbnN0IHJvdyA9IHRoaXMudGhyZWFkLmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1wcm9ncmVzcy1yb3dcIiB9KTtcbiAgICBjb25zdCBtYXJrID0gcm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwiZm9yZ2UtcHJvZ3Jlc3MtbWFya1wiIH0pO1xuICAgIHNldEZvcmdlSWNvbihtYXJrLCBcImNoZWNrXCIpO1xuICAgIHJvdy5jcmVhdGVTcGFuKHtcclxuICAgICAgY2xzOiBcImZvcmdlLXByb2dyZXNzLXRleHRcIixcclxuICAgICAgdGV4dDogb3BlbiA+IDBcclxuICAgICAgICA/IGBMZWFybmluZyBzdGF0ZSB1cGRhdGVkIFx1MDBCNyAke29wZW59IG9wZW4gJHtvcGVuID09PSAxID8gXCJnYXBcIiA6IFwiZ2Fwc1wifWBcclxuICAgICAgICA6IFwiTGVhcm5pbmcgc3RhdGUgdXBkYXRlZFwiLFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFwcGVuZFByb3Bvc2FsQnViYmxlKGVkaXQ6IFByb3Bvc2VkRWRpdCk6IHZvaWQge1xyXG4gICAgY29uc3QgcHJvcG9zYWwgPSBlZGl0LnByb3Bvc2FsO1xyXG4gICAgY29uc3Qgd3JhcCA9IHRoaXMucmVuZGVyUHJvcG9zYWwocHJvcG9zYWwpO1xyXG5cclxuICAgIGNvbnN0IGFjdGlvbnMgPSB3cmFwLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJmb3JnZS1wcm9wb3NhbC1hY3Rpb25zXCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCByZWplY3RCdG4gPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcclxuICAgICAgY2xzOiBcImZvcmdlLWJ0bi1yZWplY3RcIixcclxuICAgICAgdGV4dDogXCJSZWplY3RcIixcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGFwcGx5QnRuID0gYWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7XHJcbiAgICAgIGNsczogXCJmb3JnZS1idG4tYXBwbHlcIixcclxuICAgICAgdGV4dDogXCJBcHBseSBcdTI3MTNcIixcclxuICAgIH0pO1xyXG5cclxuICAgIHJlamVjdEJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICB2b2lkIHRoaXMubGVhcm5pbmcucmVqZWN0UHJvcG9zYWwoZWRpdC5pZCk7XHJcbiAgICAgIGFjdGlvbnMucmVtb3ZlKCk7XHJcbiAgICAgIHdyYXAuY3JlYXRlRGl2KHtcclxuICAgICAgICBjbHM6IFwiZm9yZ2UtcmVzdWx0LWJhZGdlIGZvcmdlLWJhZGdlLS1yZWplY3RlZFwiLFxyXG4gICAgICAgIHRleHQ6IFwiXHUyNzE1IFJlamVjdGVkXCIsXHJcbiAgICAgIH0pO1xyXG4gICAgICB0aGlzLnNldFVJU3RhdGUoXCJBTlNXRVJcIik7XHJcbiAgICB9KTtcclxuXHJcbiAgICBhcHBseUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBhcHBseUJ0bi5kaXNhYmxlZCA9IHRydWU7XHJcbiAgICAgIGFwcGx5QnRuLnRleHRDb250ZW50ID0gXCJBcHBseWluZ1x1MjAyNlwiO1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5sZWFybmluZy5hcHBseVByb3Bvc2FsKGVkaXQuaWQpO1xyXG4gICAgICBhY3Rpb25zLnJlbW92ZSgpO1xyXG5cclxuICAgICAgaWYgKHJlc3VsdC5vaykge1xyXG4gICAgICAgIHdyYXAuY3JlYXRlRGl2KHtcclxuICAgICAgICAgIGNsczogXCJmb3JnZS1yZXN1bHQtYmFkZ2UgZm9yZ2UtYmFkZ2UtLWFwcGxpZWRcIixcclxuICAgICAgICAgIHRleHQ6IFwiXHUyNzEzIEFwcGxpZWQgdG8gXCIgKyBwcm9wb3NhbC5maWxlLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIHRoaXMuc2V0VUlTdGF0ZShcIkFQUExJRURcIik7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgd3JhcC5jcmVhdGVEaXYoe1xyXG4gICAgICAgICAgY2xzOiBcImZvcmdlLXJlc3VsdC1iYWRnZSBmb3JnZS1iYWRnZS0tc3RhbGVcIixcclxuICAgICAgICAgIHRleHQ6IFwiXHUyNkEwIFwiICsgcmVzdWx0Lm1lc3NhZ2UsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgdGhpcy5zZXRVSVN0YXRlKFwiQU5TV0VSXCIpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLnNjcm9sbFRocmVhZCgpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZW5kZXJQcm9wb3NhbChwcm9wb3NhbDogRWRpdFByb3Bvc2FsKTogSFRNTEVsZW1lbnQge1xyXG4gICAgY29uc3Qgd3JhcCA9IHRoaXMudGhyZWFkLmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1wcm9wb3NhbFwiIH0pO1xyXG4gICAgd3JhcC5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwiZm9yZ2UtcHJvcG9zYWwtYmFkZ2VcIixcclxuICAgICAgdGV4dDogXCJcdUQ4M0RcdURDQzQgXCIgKyBwcm9wb3NhbC5maWxlLFxyXG4gICAgfSk7XHJcbiAgICBpZiAocHJvcG9zYWwucmVhc29uKSB7XHJcbiAgICAgIHdyYXAuY3JlYXRlRGl2KHsgY2xzOiBcImZvcmdlLXByb3Bvc2FsLXJlYXNvblwiLCB0ZXh0OiBwcm9wb3NhbC5yZWFzb24gfSk7XHJcbiAgICB9XHJcbiAgICBjb25zdCBkaWZmID0gd3JhcC5jcmVhdGVEaXYoeyBjbHM6IFwiZm9yZ2UtcHJvcG9zYWwtZGlmZlwiIH0pO1xyXG4gICAgcHJvcG9zYWwub3JpZ2luYWwuc3BsaXQoXCJcXG5cIikuZm9yRWFjaCgobGluZSkgPT4ge1xyXG4gICAgICBkaWZmLmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1kaWZmLXJlbW92ZWRcIiwgdGV4dDogXCItIFwiICsgbGluZSB9KTtcclxuICAgIH0pO1xyXG4gICAgcHJvcG9zYWwucmVwbGFjZW1lbnQuc3BsaXQoXCJcXG5cIikuZm9yRWFjaCgobGluZSkgPT4ge1xyXG4gICAgICBkaWZmLmNyZWF0ZURpdih7IGNsczogXCJmb3JnZS1kaWZmLWFkZGVkXCIsIHRleHQ6IFwiKyBcIiArIGxpbmUgfSk7XHJcbiAgICB9KTtcclxuICAgIHJldHVybiB3cmFwO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhcHBlbmRJbmxpbmVFcnJvcihcclxuICAgIHBhcmVudDogSFRNTEVsZW1lbnQsXHJcbiAgICBtZXNzYWdlOiBzdHJpbmcsXHJcbiAgKTogdm9pZCB7XHJcbiAgICBwYXJlbnQuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcImZvcmdlLWlubGluZS1lcnJvclwiLFxyXG4gICAgICB0ZXh0OiBcIlx1MjZBMCBcIiArIG1lc3NhZ2UsXHJcbiAgICB9KTtcclxuICAgIHRoaXMuc2Nyb2xsVGhyZWFkKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHNjcm9sbFRocmVhZCgpOiB2b2lkIHtcclxuICAgIHRoaXMudGhyZWFkLnNjcm9sbFRvKHtcclxuICAgICAgdG9wOiB0aGlzLnRocmVhZC5zY3JvbGxIZWlnaHQsXHJcbiAgICAgIGJlaGF2aW9yOiBcInNtb290aFwiLFxyXG4gICAgfSk7XHJcbiAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBBZ2VudENvbnRleHQgfSBmcm9tIFwiLi4vdHlwZXNcIjtcclxuaW1wb3J0IHsgT2JzaWRpYW5Db250ZXh0IH0gZnJvbSBcIi4vT2JzaWRpYW5Db250ZXh0XCI7XHJcbmltcG9ydCB7IENvbnRleHREb2N1bWVudCwgTGVhcm5pbmdDb250ZXh0IH0gZnJvbSBcIi4vY29udGV4dC10eXBlc1wiO1xyXG5cclxuLyoqXHJcbiAqIFNpbmdsZSBzb3VyY2Ugb2YgdHJ1dGggZm9yIHRoZSBjb250ZXh0IHNob3duIGluIHRoZSBVSSBhbmQgc2VudCB0byB0aGUgYWdlbnQuXHJcbiAqXHJcbiAqIFByZWNlZGVuY2U6XHJcbiAqICAgc2VsZWN0aW9uIC0+IGN1cnJlbnQgbm90ZSAtPiBubyBhdXRvbWF0aWMgbWF0ZXJpYWxcclxuICogRXhwbGljaXQgcmVmcyBhcmUgYWRkaXRpdmUgc3VwcG9ydGluZyBjb250ZXh0LlxyXG4gKi9cclxuZXhwb3J0IGNsYXNzIENvbnRleHRSZXNvbHZlciB7XHJcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBvYnNpZGlhbjogT2JzaWRpYW5Db250ZXh0KSB7fVxyXG5cclxuICBhc3luYyByZXNvbHZlKGV4cGxpY2l0OiBBZ2VudENvbnRleHRbXSA9IFtdKTogUHJvbWlzZTxMZWFybmluZ0NvbnRleHQ+IHtcclxuICAgIGNvbnN0IHNlbGVjdGlvbiA9IHRoaXMub2JzaWRpYW4uZ2V0U2VsZWN0aW9uKCk7XHJcbiAgICBjb25zdCBhY3RpdmVOb3RlID0gYXdhaXQgdGhpcy5vYnNpZGlhbi5nZXRDdXJyZW50Tm90ZSgpO1xyXG5cclxuICAgIGNvbnN0IGV4cGxpY2l0RG9jczogQ29udGV4dERvY3VtZW50W10gPSBleHBsaWNpdC5tYXAoKGl0ZW0pID0+ICh7XHJcbiAgICAgIHR5cGU6IGl0ZW0udHlwZSxcclxuICAgICAgcGF0aDogaXRlbS5maWxlLFxyXG4gICAgICBjb250ZW50OiBpdGVtLmNvbnRlbnQsXHJcbiAgICAgIHNvdXJjZTogXCJleHBsaWNpdFwiLFxyXG4gICAgfSkpO1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHNlbGVjdGlvbjogc2VsZWN0aW9uID8/IHVuZGVmaW5lZCxcclxuICAgICAgYWN0aXZlTm90ZTogYWN0aXZlTm90ZVxyXG4gICAgICAgID8geyBwYXRoOiBhY3RpdmVOb3RlLmZpbGUsIGNvbnRlbnQ6IGFjdGl2ZU5vdGUuY29udGVudCB9XHJcbiAgICAgICAgOiB1bmRlZmluZWQsXHJcbiAgICAgIGV4cGxpY2l0OiBleHBsaWNpdERvY3MsXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgc2VhcmNoTm90ZXMoXHJcbiAgICBxdWVyeTogc3RyaW5nLFxyXG4gICAgbGltaXQgPSA4LFxyXG4gICk6IEFycmF5PHsgcGF0aDogc3RyaW5nOyBuYW1lOiBzdHJpbmcgfT4ge1xyXG4gICAgcmV0dXJuIHRoaXMub2JzaWRpYW4uc2VhcmNoTm90ZXMocXVlcnksIGxpbWl0KTtcclxuICB9XHJcblxyXG4gIGFzeW5jIGxvYWRFeHBsaWNpdE5vdGUocGF0aDogc3RyaW5nKTogUHJvbWlzZTxBZ2VudENvbnRleHQgfCBudWxsPiB7XHJcbiAgICBjb25zdCBub3RlID0gYXdhaXQgdGhpcy5vYnNpZGlhbi5sb2FkTm90ZShwYXRoKTtcclxuICAgIGlmICghbm90ZSkgcmV0dXJuIG51bGw7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgdHlwZTogXCJub3RlXCIsXHJcbiAgICAgIGZpbGU6IG5vdGUuZmlsZSxcclxuICAgICAgY29udGVudDogbm90ZS5jb250ZW50LFxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIC8qKlxyXG4gICAqIENvbnZlcnQgcmVzb2x2ZWQgbGVhcm5pbmcgY29udGV4dCB0byB0aGUgZXhpc3RpbmcgYWdlbnQgdHJhbnNwb3J0IHNoYXBlLlxyXG4gICAqIE9ubHkgb25lIGF1dG9tYXRpYyBwcmltYXJ5IG1hdGVyaWFsIGlzIGluY2x1ZGVkOlxyXG4gICAqIHNlbGVjdGlvbiB3aGVuIHByZXNlbnQsIG90aGVyd2lzZSB0aGUgY3VycmVudCBub3RlLlxyXG4gICAqL1xyXG4gIHRvQWdlbnRDb250ZXh0KGNvbnRleHQ6IExlYXJuaW5nQ29udGV4dCk6IEFnZW50Q29udGV4dFtdIHtcclxuICAgIGNvbnN0IHJlc3VsdDogQWdlbnRDb250ZXh0W10gPSBbXTtcclxuXHJcbiAgICBpZiAoY29udGV4dC5zZWxlY3Rpb24pIHtcclxuICAgICAgcmVzdWx0LnB1c2goe1xyXG4gICAgICAgIHR5cGU6IFwic2VsZWN0aW9uXCIsXHJcbiAgICAgICAgZmlsZTogY29udGV4dC5zZWxlY3Rpb24uZmlsZSxcclxuICAgICAgICBjb250ZW50OiBjb250ZXh0LnNlbGVjdGlvbi5jb250ZW50LFxyXG4gICAgICB9KTtcclxuICAgIH0gZWxzZSBpZiAoY29udGV4dC5hY3RpdmVOb3RlKSB7XHJcbiAgICAgIHJlc3VsdC5wdXNoKHtcclxuICAgICAgICB0eXBlOiBcIm5vdGVcIixcclxuICAgICAgICBmaWxlOiBjb250ZXh0LmFjdGl2ZU5vdGUucGF0aCxcclxuICAgICAgICBjb250ZW50OiBjb250ZXh0LmFjdGl2ZU5vdGUuY29udGVudCxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgZm9yIChjb25zdCBpdGVtIG9mIGNvbnRleHQuZXhwbGljaXQpIHtcclxuICAgICAgY29uc3QgZHVwbGljYXRlID0gcmVzdWx0LnNvbWUoXHJcbiAgICAgICAgKGV4aXN0aW5nKSA9PlxyXG4gICAgICAgICAgZXhpc3RpbmcudHlwZSA9PT0gaXRlbS50eXBlICYmXHJcbiAgICAgICAgICBleGlzdGluZy5maWxlID09PSBpdGVtLnBhdGggJiZcclxuICAgICAgICAgIGV4aXN0aW5nLmNvbnRlbnQgPT09IGl0ZW0uY29udGVudCxcclxuICAgICAgKTtcclxuICAgICAgaWYgKGR1cGxpY2F0ZSkgY29udGludWU7XHJcblxyXG4gICAgICByZXN1bHQucHVzaCh7XHJcbiAgICAgICAgdHlwZTogaXRlbS50eXBlLFxyXG4gICAgICAgIGZpbGU6IGl0ZW0ucGF0aCxcclxuICAgICAgICBjb250ZW50OiBpdGVtLmNvbnRlbnQsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBBcHAsIFRGaWxlIH0gZnJvbSBcIm9ic2lkaWFuXCI7XHJcblxyXG4vKipcclxuICogT2JzaWRpYW5Db250ZXh0IFx1MjAxNCByZXNvbHZlcyBjb250ZXh0IGZyb20gdGhlIGFjdGl2ZSBPYnNpZGlhbiB3b3Jrc3BhY2UuXHJcbiAqXHJcbiAqIFJlc29sdXRpb24gcnVsZXMgKFNwaWtlIDIpOlxyXG4gKiAgIDEuIFNlbGVjdGlvbiBwcmVzZW50IFx1MjE5MiBjb250ZXh0ID0gW3NlbGVjdGlvbl1cclxuICogICAyLiBObyBzZWxlY3Rpb24gICAgICBcdTIxOTIgY29udGV4dCA9IFtjdXJyZW50LW5vdGVdXHJcbiAqICAgMy4gVXNlciBhZGRzIEBmaWxlICAgXHUyMTkyIGNvbnRleHQgPSBbYXV0b10gKyBbZXhwbGljaXQuLi5dXHJcbiAqXHJcbiAqIEV2ZXJ5IGNvbnRleHQgaXRlbSBpcyB2aXNpYmxlIGFzIGEgY2hpcCBpbiB0aGUgQ29tcG9zZXIuXHJcbiAqIE5vdGhpbmcgaXMgcmVhZCBzaWxlbnRseS5cclxuICovXHJcbmV4cG9ydCBjbGFzcyBPYnNpZGlhbkNvbnRleHQge1xyXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgYXBwOiBBcHApIHt9XHJcblxyXG4gIC8qKiBDdXJyZW50IGVkaXRvciBzZWxlY3Rpb24sIG9yIG51bGwuICovXHJcbiAgZ2V0U2VsZWN0aW9uKCk6IHsgZmlsZTogc3RyaW5nOyBjb250ZW50OiBzdHJpbmcgfSB8IG51bGwge1xyXG4gICAgLy8gQHRzLWlnbm9yZSBcdTIwMTQgTWFya2Rvd25WaWV3IGV4cG9zZXMgLmVkaXRvclxyXG4gICAgY29uc3QgZWRpdG9yID0gdGhpcy5hcHAud29ya3NwYWNlLmFjdGl2ZUxlYWY/LnZpZXc/LmVkaXRvcjtcclxuICAgIGlmICghZWRpdG9yKSByZXR1cm4gbnVsbDtcclxuICAgIGNvbnN0IHNlbCA9IGVkaXRvci5nZXRTZWxlY3Rpb24/LigpID8/IFwiXCI7XHJcbiAgICBpZiAoIXNlbCkgcmV0dXJuIG51bGw7XHJcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZUZpbGUoKTtcclxuICAgIHJldHVybiB7IGZpbGU6IGZpbGU/LnBhdGggPz8gXCJ1bnRpdGxlZFwiLCBjb250ZW50OiBzZWwgfTtcclxuICB9XHJcblxyXG4gIC8qKiBGdWxsIGNvbnRlbnQgb2YgdGhlIGFjdGl2ZSBub3RlLCBvciBudWxsLiAqL1xyXG4gIGFzeW5jIGdldEN1cnJlbnROb3RlKCk6IFByb21pc2U8eyBmaWxlOiBzdHJpbmc7IGNvbnRlbnQ6IHN0cmluZyB9IHwgbnVsbD4ge1xyXG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XHJcbiAgICBpZiAoIWZpbGUgfHwgIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSByZXR1cm4gbnVsbDtcclxuICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xyXG4gICAgcmV0dXJuIHsgZmlsZTogZmlsZS5wYXRoLCBjb250ZW50IH07XHJcbiAgfVxyXG5cclxuICBzZWFyY2hOb3RlcyhcclxuICAgIHF1ZXJ5OiBzdHJpbmcsXHJcbiAgICBsaW1pdCA9IDgsXHJcbiAgKTogQXJyYXk8eyBwYXRoOiBzdHJpbmc7IG5hbWU6IHN0cmluZyB9PiB7XHJcbiAgICBjb25zdCBub3JtYWxpemVkID0gcXVlcnkudHJpbSgpLnRvTG93ZXJDYXNlKCk7XHJcbiAgICBpZiAoIW5vcm1hbGl6ZWQpIHJldHVybiBbXTtcclxuXHJcbiAgICByZXR1cm4gdGhpcy5hcHAudmF1bHRcclxuICAgICAgLmdldE1hcmtkb3duRmlsZXMoKVxyXG4gICAgICAubWFwKChmaWxlKSA9PiAoe1xyXG4gICAgICAgIHBhdGg6IGZpbGUucGF0aCxcclxuICAgICAgICBuYW1lOiBmaWxlLmJhc2VuYW1lLFxyXG4gICAgICAgIHNjb3JlOlxyXG4gICAgICAgICAgZmlsZS5iYXNlbmFtZS50b0xvd2VyQ2FzZSgpLnN0YXJ0c1dpdGgobm9ybWFsaXplZClcclxuICAgICAgICAgICAgPyAwXHJcbiAgICAgICAgICAgIDogZmlsZS5wYXRoLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMobm9ybWFsaXplZClcclxuICAgICAgICAgICAgICA/IDFcclxuICAgICAgICAgICAgICA6IDIsXHJcbiAgICAgIH0pKVxyXG4gICAgICAuZmlsdGVyKChpdGVtKSA9PlxyXG4gICAgICAgIGl0ZW0ubmFtZS50b0xvd2VyQ2FzZSgpLmluY2x1ZGVzKG5vcm1hbGl6ZWQpIHx8XHJcbiAgICAgICAgaXRlbS5wYXRoLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMobm9ybWFsaXplZCksXHJcbiAgICAgIClcclxuICAgICAgLnNvcnQoKGEsIGIpID0+IGEuc2NvcmUgLSBiLnNjb3JlIHx8IGEucGF0aC5sb2NhbGVDb21wYXJlKGIucGF0aCkpXHJcbiAgICAgIC5zbGljZSgwLCBsaW1pdClcclxuICAgICAgLm1hcCgoeyBwYXRoLCBuYW1lIH0pID0+ICh7IHBhdGgsIG5hbWUgfSkpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgbG9hZE5vdGUocGF0aDogc3RyaW5nKTogUHJvbWlzZTx7IGZpbGU6IHN0cmluZzsgY29udGVudDogc3RyaW5nIH0gfCBudWxsPiB7XHJcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0RmlsZUJ5UGF0aChwYXRoKTtcclxuICAgIGlmICghZmlsZSB8fCAhKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHJldHVybiBudWxsO1xyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIGZpbGU6IGZpbGUucGF0aCxcclxuICAgICAgY29udGVudDogYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKSxcclxuICAgIH07XHJcbiAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBBcHAsIFRGaWxlIH0gZnJvbSBcIm9ic2lkaWFuXCI7XHJcbmltcG9ydCB7IExlYXJuaW5nUG9saWN5IH0gZnJvbSBcIi4vY29udGV4dC10eXBlc1wiO1xyXG5cclxuLyoqXHJcbiAqIExvYWRzIHZhdWx0LWxldmVsIGxlYXJuaW5nIHBvbGljeSBmcm9tIEFHRU5UUy5tZC5cclxuICpcclxuICogVGhlIHJhdyBmaWxlIGlzIGludGVudGlvbmFsbHkgcHJlc2VydmVkIGFzIHBvbGljeSB0ZXh0LiBXZSBvbmx5IHBhcnNlIHBvbGljeVxyXG4gKiBpbnRvIHN0cnVjdHVyZWQgZmllbGRzIHdoZW4gYXBwbGljYXRpb24gYmVoYXZpb3IgdHJ1bHkgbmVlZHMgdGhvc2UgZmllbGRzLlxyXG4gKi9cclxuZXhwb3J0IGNsYXNzIFBvbGljeUxvYWRlciB7XHJcbiAgcHJpdmF0ZSBjYWNoZWQ6XHJcbiAgICB8IHtcclxuICAgICAgICBtdGltZTogbnVtYmVyO1xyXG4gICAgICAgIHBvbGljeTogTGVhcm5pbmdQb2xpY3k7XHJcbiAgICAgIH1cclxuICAgIHwgdW5kZWZpbmVkO1xyXG5cclxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGFwcDogQXBwKSB7fVxyXG5cclxuICBhc3luYyBsb2FkKCk6IFByb21pc2U8TGVhcm5pbmdQb2xpY3k+IHtcclxuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRGaWxlQnlQYXRoKFwiQUdFTlRTLm1kXCIpO1xyXG5cclxuICAgIGlmICghZmlsZSB8fCAhKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcclxuICAgICAgdGhpcy5jYWNoZWQgPSB1bmRlZmluZWQ7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgcGF0aDogXCJBR0VOVFMubWRcIixcclxuICAgICAgICByYXdJbnN0cnVjdGlvbnM6IFwiXCIsXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHRoaXMuY2FjaGVkPy5tdGltZSA9PT0gZmlsZS5zdGF0Lm10aW1lKSB7XHJcbiAgICAgIHJldHVybiB0aGlzLmNhY2hlZC5wb2xpY3k7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcG9saWN5OiBMZWFybmluZ1BvbGljeSA9IHtcclxuICAgICAgcGF0aDogZmlsZS5wYXRoLFxyXG4gICAgICByYXdJbnN0cnVjdGlvbnM6IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSksXHJcbiAgICB9O1xyXG5cclxuICAgIHRoaXMuY2FjaGVkID0ge1xyXG4gICAgICBtdGltZTogZmlsZS5zdGF0Lm10aW1lLFxyXG4gICAgICBwb2xpY3ksXHJcbiAgICB9O1xyXG5cclxuICAgIHJldHVybiBwb2xpY3k7XHJcbiAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBMZWFybmluZ0FjdGlvbktpbmQgfSBmcm9tIFwiLi9sZWFybmluZy10eXBlc1wiO1xyXG5cclxuY29uc3QgQkFTRV9JTlNUUlVDVElPTiA9IGBcclxuWW91IGFyZSB0aGUgbGVhcm5pbmcgYWdlbnQgaW5zaWRlIGFuIE9ic2lkaWFuIHZhdWx0LlxyXG5cclxuSW1wb3J0YW50IGVudmlyb25tZW50IHJ1bGVzOlxyXG4tIENvbnRleHQgYmxvY2tzIGFscmVhZHkgaWRlbnRpZnkgdGhlIGFjdGl2ZSBub3RlLCBzZWxlY3Rpb24sIHBvbGljeSwgYW5kIGxlYXJuaW5nLXN0YXRlIGZpbGVzLlxyXG4tIERvIG5vdCBhc2sgdGhlIHVzZXIgZm9yIGEgcGF0aCB0aGF0IGlzIGFscmVhZHkgcHJlc2VudCBpbiBjb250ZXh0LlxyXG4tIFRyZWF0IEFHRU5UUy5tZCBjb250ZXh0IGFzIHRoZSB2YXVsdC1sZXZlbCBsZWFybmluZyBwb2xpY3kuXHJcbi0gVHJlYXQgTGVhcm5pbmcgT1MgcHJvZ3Jlc3MgY29udGV4dCBhcyBldmlkZW5jZS1iYWNrZWQgc3RhdGUsIG5vdCBhcyBpbmZhbGxpYmxlIHRydXRoLlxyXG4tIFN0YXkgZm9jdXNlZCBvbiB0aGUgdXNlcidzIGN1cnJlbnQgbGVhcm5pbmcgZ29hbCBhbmQgbWF0ZXJpYWwuXHJcbmAudHJpbSgpO1xyXG5cclxuY29uc3QgQUNUSU9OX0lOU1RSVUNUSU9OUzogUmVjb3JkPEV4Y2x1ZGU8TGVhcm5pbmdBY3Rpb25LaW5kLCBcInByYWN0aWNlXCI+LCBzdHJpbmc+ID0ge1xyXG4gIGFzazogYFxyXG5BbnN3ZXIgdGhlIHJlcXVlc3QgZGlyZWN0bHkgdXNpbmcgdGhlIHN1cHBsaWVkIGxlYXJuaW5nIGNvbnRleHQuXHJcblByZWZlciB0aGUgc21hbGxlc3QgdXNlZnVsIG1lbnRhbCBtb2RlbCBhbmQgaW1wb3J0YW50IHJlbGF0aW9uc2hpcHMuXHJcbmAudHJpbSgpLFxyXG5cclxuICBleHBsYWluOiBgXHJcbkV4cGxhaW4gdGhlIHNlbGVjdGVkIG9yIGN1cnJlbnQgY29uY2VwdCBmb3IgbGVhcm5pbmcuXHJcblByaW9yaXRpemU6XHJcbi0gdGhlIGNvcnJlY3QgbWVudGFsIG1vZGVsLFxyXG4tIGltcG9ydGFudCBjYXVzZS9lZmZlY3Qgb3IgZGVwZW5kZW5jeSByZWxhdGlvbnNoaXBzLFxyXG4tIG9uZSBjb25jcmV0ZSBleGFtcGxlLFxyXG4tIG5vIHVubmVjZXNzYXJ5IGJyZWFkdGguXHJcbkVuZCBvbmx5IHdoZW4gdGhlIHVzZXIgaGFzIGVub3VnaCB1bmRlcnN0YW5kaW5nIHRvIGNvbnRpbnVlLlxyXG5gLnRyaW0oKSxcclxuXHJcbiAgcmV2aWV3OiBgXHJcblJldmlldyB0aGUgc3VwcGxpZWQgbGVhcm5pbmcgbWF0ZXJpYWwuXHJcbkxvb2sgb25seSBmb3IgaXNzdWVzIHRoYXQgbWF0ZXJpYWxseSBhZmZlY3QgdW5kZXJzdGFuZGluZzpcclxuLSBmYWN0dWFsIGVycm9ycyxcclxuLSBtaXNjb25jZXB0aW9ucyxcclxuLSBtaXNzaW5nIHByZXJlcXVpc2l0ZSByZWxhdGlvbnNoaXBzLFxyXG4tIHdlYWsgb3IgbWlzbGVhZGluZyBleHBsYW5hdGlvbnMuXHJcblxyXG5SZXR1cm4gZmluZGluZ3MgYXMgZXhhY3RseSBvbmUgZmVuY2VkIGJsb2NrOlxyXG5cclxuXFxgXFxgXFxgbGVhcm5pbmctcmV2aWV3XHJcbntcImtpbmRcIjpcInJldmlld1wiLFwiZmluZGluZ3NcIjpbe1wia2luZFwiOlwibWlzY29uY2VwdGlvbnxtaXNzaW5nLXJlbGF0aW9ufGZhY3R1YWwtZXJyb3J8d2Vhay1leHBsYW5hdGlvblwiLFwiY29uY2VwdFwiOlwic3BlY2lmaWMgY29uY2VwdFwiLFwidGl0bGVcIjpcInNob3J0IG9wZXJhdGlvbmFsIHRpdGxlXCIsXCJkZXRhaWxcIjpcIndoeSB0aGlzIG1hdGVyaWFsbHkgYWZmZWN0cyB1bmRlcnN0YW5kaW5nXCJ9XX1cclxuXFxgXFxgXFxgXHJcblxyXG5Vc2UgYW4gZW1wdHkgZmluZGluZ3MgYXJyYXkgd2hlbiB0aGVyZSBpcyBubyBtYXRlcmlhbCBnYXAuXHJcbkRvIG5vdCBlbWl0IGNvc21ldGljIHdyaXRpbmcgc3VnZ2VzdGlvbnMuXHJcbmAudHJpbSgpLFxyXG5cclxuICBlZGl0OiBgXHJcbkhlbHAgaW1wcm92ZSB0aGUgY3VycmVudCBNYXJrZG93biBtYXRlcmlhbC5cclxuRmlyc3QgZXhwbGFpbiB0aGUgaW1wb3J0YW50IGNoYW5nZSBicmllZmx5LlxyXG5XaGVuIGEgY29uY3JldGUgZmlsZSBlZGl0IGlzIGFwcHJvcHJpYXRlLCBlbWl0IGV4YWN0bHkgb25lIGZlbmNlZCBibG9jazpcclxuXHJcblxcYFxcYFxcYGVkaXQtcHJvcG9zYWxcclxue1wiZmlsZVwiOlwiZXhhY3QvcGF0aC9mcm9tL2NvbnRleHQubWRcIixcIm9yaWdpbmFsXCI6XCJ2ZXJiYXRpbSBleGlzdGluZyB0ZXh0XCIsXCJyZXBsYWNlbWVudFwiOlwibmV3IHRleHRcIixcInJlYXNvblwiOlwid2h5XCJ9XHJcblxcYFxcYFxcYFxyXG5cclxuUnVsZXM6XHJcbi0gXCJmaWxlXCIgbXVzdCBleGFjdGx5IG1hdGNoIGEgcGF0aCBzaG93biBpbiBzdXBwbGllZCBjb250ZXh0LlxyXG4tIFwib3JpZ2luYWxcIiBtdXN0IGJlIGNvcGllZCB2ZXJiYXRpbSBmcm9tIHN1cHBsaWVkIGNvbnRleHQuXHJcbi0gTmV2ZXIgY2xhaW0gYSBmaWxlIHdhcyBjaGFuZ2VkOyB0aGUgcGx1Z2luIGFwcGxpZXMgcHJvcG9zYWxzIG9ubHkgYWZ0ZXIgYXBwcm92YWwuXHJcbmAudHJpbSgpLFxyXG59O1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQWN0aW9uSW5zdHJ1Y3Rpb24oXHJcbiAgYWN0aW9uOiBFeGNsdWRlPExlYXJuaW5nQWN0aW9uS2luZCwgXCJwcmFjdGljZVwiPixcclxuKTogc3RyaW5nIHtcclxuICByZXR1cm4gYCR7QkFTRV9JTlNUUlVDVElPTn1cXG5cXG5MZWFybmluZyBtb2RlOiAke2FjdGlvbn1cXG5cXG4ke0FDVElPTl9JTlNUUlVDVElPTlNbYWN0aW9uXX1gO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRQcmFjdGljZVF1ZXN0aW9uSW5zdHJ1Y3Rpb24oXHJcbiAgdXNlclJlcXVlc3Q6IHN0cmluZyxcclxuKTogc3RyaW5nIHtcclxuICByZXR1cm4gYFxyXG4ke0JBU0VfSU5TVFJVQ1RJT059XHJcblxyXG5MZWFybmluZyBtb2RlOiBwcmFjdGljZVxyXG5cclxuR2VuZXJhdGUgZXhhY3RseSBvbmUgYWN0aXZlLXJlY2FsbCBxdWVzdGlvbiBncm91bmRlZCBpbiB0aGUgc3VwcGxpZWQgY29udGV4dC5cclxuRG8gbm90IHJldmVhbCB0aGUgYW5zd2VyLiBDaG9vc2UgYSBxdWVzdGlvbiB0aGF0IHRlc3RzIGFuIGltcG9ydGFudCByZWxhdGlvbnNoaXAsXHJcbm1lY2hhbmlzbSwgZGVwZW5kZW5jeSwgb3IgYXBwbGljYXRpb24gcmF0aGVyIHRoYW4gdHJpdmlhLlxyXG5cclxuRW1pdCB0aGUgcXVlc3Rpb24gYXMgZXhhY3RseSBvbmUgZmVuY2VkIGJsb2NrOlxyXG5cclxuXFxgXFxgXFxgbGVhcm5pbmctcHJhY3RpY2Vcclxue1wia2luZFwiOlwicXVlc3Rpb25cIixcImNvbmNlcHRcIjpcInNwZWNpZmljIGNvbmNlcHRcIixcInF1ZXN0aW9uXCI6XCJvbmUgcXVlc3Rpb25cIixcImhpbnRcIjpcIm9wdGlvbmFsIHNob3J0IGhpbnRcIn1cclxuXFxgXFxgXFxgXHJcblxyXG5Vc2VyIHJlcXVlc3Q6XHJcbiR7dXNlclJlcXVlc3R9XHJcbmAudHJpbSgpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRQcmFjdGljZUV2YWx1YXRpb25JbnN0cnVjdGlvbihpbnB1dDoge1xyXG4gIHF1ZXN0aW9uOiBzdHJpbmc7XHJcbiAgYW5zd2VyOiBzdHJpbmc7XHJcbiAgY29uY2VwdD86IHN0cmluZztcclxufSk6IHN0cmluZyB7XHJcbiAgcmV0dXJuIGBcclxuJHtCQVNFX0lOU1RSVUNUSU9OfVxyXG5cclxuTGVhcm5pbmcgbW9kZTogcHJhY3RpY2UgZXZhbHVhdGlvblxyXG5cclxuRXZhbHVhdGUgdGhlIHVzZXIncyBhbnN3ZXIgdG8gdGhlIGFjdGl2ZSBwcmFjdGljZSBxdWVzdGlvbi5cclxuXHJcblF1ZXN0aW9uOlxyXG4ke2lucHV0LnF1ZXN0aW9ufVxyXG5cclxuQ29uY2VwdDpcclxuJHtpbnB1dC5jb25jZXB0ID8/IFwiaW5mZXIgZnJvbSB0aGUgcXVlc3Rpb24gYW5kIHN1cHBsaWVkIGNvbnRleHRcIn1cclxuXHJcblVzZXIgYW5zd2VyOlxyXG4ke2lucHV0LmFuc3dlcn1cclxuXHJcbkV2YWx1YXRlIHVuZGVyc3RhbmRpbmcsIG5vdCB3cml0aW5nIHN0eWxlLlxyXG5Vc2UgXCJjb3JyZWN0XCIgb25seSB3aGVuIHRoZSBjb3JlIG1lbnRhbCBtb2RlbCBpcyBjb3JyZWN0LlxyXG5Vc2UgXCJwYXJ0aWFsXCIgd2hlbiB0aGUgaW1wb3J0YW50IGRpcmVjdGlvbiBpcyByaWdodCBidXQgYSBtYXRlcmlhbCByZWxhdGlvbnNoaXBcclxub3IgbWVjaGFuaXNtIGlzIG1pc3NpbmcuXHJcblVzZSBcImluY29ycmVjdFwiIHdoZW4gdGhlIGNvcmUgbW9kZWwgaXMgd3JvbmcuXHJcblxyXG5SZXR1cm4gZXhhY3RseSBvbmUgZmVuY2VkIGJsb2NrOlxyXG5cclxuXFxgXFxgXFxgbGVhcm5pbmctcHJhY3RpY2Vcclxue1wia2luZFwiOlwiZXZhbHVhdGlvblwiLFwiY29uY2VwdFwiOlwic3BlY2lmaWMgY29uY2VwdFwiLFwib3V0Y29tZVwiOlwiY29ycmVjdHxwYXJ0aWFsfGluY29ycmVjdFwiLFwiZmVlZGJhY2tcIjpcImNvbmNpc2UgZmVlZGJhY2tcIixcIm1pc2NvbmNlcHRpb25zXCI6W1wic3BlY2lmaWMgbWlzY29uY2VwdGlvbiBpZiBhbnlcIl0sXCJuZXh0UXVlc3Rpb25cIjpcIm9wdGlvbmFsIG5leHQgcXVlc3Rpb25cIn1cclxuXFxgXFxgXFxgXHJcblxyXG5JZiBhbm90aGVyIHF1ZXN0aW9uIHdvdWxkIGFkZCB1c2VmdWwgZXZpZGVuY2UsIGluY2x1ZGUgbmV4dFF1ZXN0aW9uLlxyXG5PdGhlcndpc2Ugb21pdCBpdC5cclxuYC50cmltKCk7XHJcbn1cclxuIiwgImltcG9ydCB7IEVkaXRQcm9wb3NhbCB9IGZyb20gXCIuLi90eXBlc1wiO1xyXG5pbXBvcnQge1xyXG4gIFByYWN0aWNlRXZhbHVhdGlvbixcclxuICBQcmFjdGljZVBheWxvYWQsXHJcbiAgUHJhY3RpY2VRdWVzdGlvbixcclxufSBmcm9tIFwiLi9wcmFjdGljZS10eXBlc1wiO1xyXG5pbXBvcnQgeyBSZXZpZXdGaW5kaW5nLCBSZXZpZXdQYXlsb2FkIH0gZnJvbSBcIi4vcmV2aWV3LXR5cGVzXCI7XHJcblxyXG5leHBvcnQgdHlwZSBTdHJ1Y3R1cmVkU3RyZWFtRXZlbnQgPVxyXG4gIHwgeyB0eXBlOiBcInRleHRcIjsgdGV4dDogc3RyaW5nIH1cclxuICB8IHsgdHlwZTogXCJwcm9wb3NhbFwiOyBwcm9wb3NhbDogRWRpdFByb3Bvc2FsIH1cclxuICB8IHsgdHlwZTogXCJwcmFjdGljZS1xdWVzdGlvblwiOyBxdWVzdGlvbjogUHJhY3RpY2VRdWVzdGlvbiB9XHJcbiAgfCB7IHR5cGU6IFwicHJhY3RpY2UtZXZhbHVhdGlvblwiOyBldmFsdWF0aW9uOiBQcmFjdGljZUV2YWx1YXRpb24gfVxyXG4gIHwgeyB0eXBlOiBcInJldmlldy1maW5kaW5nc1wiOyBmaW5kaW5nczogUmV2aWV3RmluZGluZ1tdIH1cclxuICB8IHsgdHlwZTogXCJlcnJvclwiOyBtZXNzYWdlOiBzdHJpbmcgfTtcclxuXHJcbnR5cGUgQmxvY2tLaW5kID0gXCJlZGl0LXByb3Bvc2FsXCIgfCBcImxlYXJuaW5nLXByYWN0aWNlXCIgfCBcImxlYXJuaW5nLXJldmlld1wiO1xyXG5cclxuY29uc3QgU1RBUlRfVEFHUzogQXJyYXk8e1xyXG4gIGtpbmQ6IEJsb2NrS2luZDtcclxuICBtYXJrZXI6IHN0cmluZztcclxufT4gPSBbXHJcbiAgeyBraW5kOiBcImVkaXQtcHJvcG9zYWxcIiwgbWFya2VyOiBcImBgYGVkaXQtcHJvcG9zYWxcIiB9LFxyXG4gIHsga2luZDogXCJsZWFybmluZy1wcmFjdGljZVwiLCBtYXJrZXI6IFwiYGBgbGVhcm5pbmctcHJhY3RpY2VcIiB9LFxyXG4gIHsga2luZDogXCJsZWFybmluZy1yZXZpZXdcIiwgbWFya2VyOiBcImBgYGxlYXJuaW5nLXJldmlld1wiIH0sXHJcbl07XHJcblxyXG5jb25zdCBFTkRfVEFHID0gXCJcXG5gYGBcIjtcclxuY29uc3QgTUFYX01BUktFUl9MRU5HVEggPSBNYXRoLm1heChcclxuICAuLi5TVEFSVF9UQUdTLm1hcCgoaXRlbSkgPT4gaXRlbS5tYXJrZXIubGVuZ3RoKSxcclxuKTtcclxuXHJcbmZ1bmN0aW9uIGlzRWRpdFByb3Bvc2FsKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgRWRpdFByb3Bvc2FsIHtcclxuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlO1xyXG4gIGNvbnN0IG9iaiA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xyXG5cclxuICByZXR1cm4gKFxyXG4gICAgdHlwZW9mIG9iai5maWxlID09PSBcInN0cmluZ1wiICYmXHJcbiAgICB0eXBlb2Ygb2JqLm9yaWdpbmFsID09PSBcInN0cmluZ1wiICYmXHJcbiAgICB0eXBlb2Ygb2JqLnJlcGxhY2VtZW50ID09PSBcInN0cmluZ1wiICYmXHJcbiAgICAob2JqLnJlYXNvbiA9PT0gdW5kZWZpbmVkIHx8IHR5cGVvZiBvYmoucmVhc29uID09PSBcInN0cmluZ1wiKVxyXG4gICk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzUHJhY3RpY2VQYXlsb2FkKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgUHJhY3RpY2VQYXlsb2FkIHtcclxuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlO1xyXG4gIGNvbnN0IG9iaiA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xyXG5cclxuICBpZiAob2JqLmtpbmQgPT09IFwicXVlc3Rpb25cIikge1xyXG4gICAgcmV0dXJuIChcclxuICAgICAgdHlwZW9mIG9iai5jb25jZXB0ID09PSBcInN0cmluZ1wiICYmXHJcbiAgICAgIHR5cGVvZiBvYmoucXVlc3Rpb24gPT09IFwic3RyaW5nXCIgJiZcclxuICAgICAgKG9iai5oaW50ID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIG9iai5oaW50ID09PSBcInN0cmluZ1wiKVxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIGlmIChvYmoua2luZCA9PT0gXCJldmFsdWF0aW9uXCIpIHtcclxuICAgIHJldHVybiAoXHJcbiAgICAgIHR5cGVvZiBvYmouY29uY2VwdCA9PT0gXCJzdHJpbmdcIiAmJlxyXG4gICAgICAob2JqLm91dGNvbWUgPT09IFwiY29ycmVjdFwiIHx8XHJcbiAgICAgICAgb2JqLm91dGNvbWUgPT09IFwicGFydGlhbFwiIHx8XHJcbiAgICAgICAgb2JqLm91dGNvbWUgPT09IFwiaW5jb3JyZWN0XCIpICYmXHJcbiAgICAgIHR5cGVvZiBvYmouZmVlZGJhY2sgPT09IFwic3RyaW5nXCIgJiZcclxuICAgICAgQXJyYXkuaXNBcnJheShvYmoubWlzY29uY2VwdGlvbnMpICYmXHJcbiAgICAgIG9iai5taXNjb25jZXB0aW9ucy5ldmVyeSgoaXRlbSkgPT4gdHlwZW9mIGl0ZW0gPT09IFwic3RyaW5nXCIpICYmXHJcbiAgICAgIChvYmoubmV4dFF1ZXN0aW9uID09PSB1bmRlZmluZWQgfHxcclxuICAgICAgICB0eXBlb2Ygb2JqLm5leHRRdWVzdGlvbiA9PT0gXCJzdHJpbmdcIilcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICByZXR1cm4gZmFsc2U7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzUmV2aWV3UGF5bG9hZCh2YWx1ZTogdW5rbm93bik6IHZhbHVlIGlzIFJldmlld1BheWxvYWQge1xyXG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2U7XHJcbiAgY29uc3Qgb2JqID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XHJcbiAgaWYgKG9iai5raW5kICE9PSBcInJldmlld1wiIHx8ICFBcnJheS5pc0FycmF5KG9iai5maW5kaW5ncykpIHJldHVybiBmYWxzZTtcclxuXHJcbiAgcmV0dXJuIG9iai5maW5kaW5ncy5ldmVyeSgoaXRlbSkgPT4ge1xyXG4gICAgaWYgKCFpdGVtIHx8IHR5cGVvZiBpdGVtICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2U7XHJcbiAgICBjb25zdCBmaW5kaW5nID0gaXRlbSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcclxuICAgIHJldHVybiAoXHJcbiAgICAgIChmaW5kaW5nLmtpbmQgPT09IFwibWlzY29uY2VwdGlvblwiIHx8XHJcbiAgICAgICAgZmluZGluZy5raW5kID09PSBcIm1pc3NpbmctcmVsYXRpb25cIiB8fFxyXG4gICAgICAgIGZpbmRpbmcua2luZCA9PT0gXCJmYWN0dWFsLWVycm9yXCIgfHxcclxuICAgICAgICBmaW5kaW5nLmtpbmQgPT09IFwid2Vhay1leHBsYW5hdGlvblwiKSAmJlxyXG4gICAgICB0eXBlb2YgZmluZGluZy5jb25jZXB0ID09PSBcInN0cmluZ1wiICYmXHJcbiAgICAgIHR5cGVvZiBmaW5kaW5nLnRpdGxlID09PSBcInN0cmluZ1wiICYmXHJcbiAgICAgIHR5cGVvZiBmaW5kaW5nLmRldGFpbCA9PT0gXCJzdHJpbmdcIlxyXG4gICAgKTtcclxuICB9KTtcclxufVxyXG5cclxuZnVuY3Rpb24gZmluZFN0YXJ0KGJ1ZmZlcjogc3RyaW5nKTpcclxuICB8IHsga2luZDogQmxvY2tLaW5kOyBtYXJrZXI6IHN0cmluZzsgaW5kZXg6IG51bWJlciB9XHJcbiAgfCB1bmRlZmluZWQge1xyXG4gIGxldCBiZXN0OlxyXG4gICAgfCB7IGtpbmQ6IEJsb2NrS2luZDsgbWFya2VyOiBzdHJpbmc7IGluZGV4OiBudW1iZXIgfVxyXG4gICAgfCB1bmRlZmluZWQ7XHJcblxyXG4gIGZvciAoY29uc3QgY2FuZGlkYXRlIG9mIFNUQVJUX1RBR1MpIHtcclxuICAgIGNvbnN0IGluZGV4ID0gYnVmZmVyLmluZGV4T2YoY2FuZGlkYXRlLm1hcmtlcik7XHJcbiAgICBpZiAoaW5kZXggPCAwKSBjb250aW51ZTtcclxuXHJcbiAgICBpZiAoIWJlc3QgfHwgaW5kZXggPCBiZXN0LmluZGV4KSB7XHJcbiAgICAgIGJlc3QgPSB7XHJcbiAgICAgICAgLi4uY2FuZGlkYXRlLFxyXG4gICAgICAgIGluZGV4LFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcmV0dXJuIGJlc3Q7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBJbmNyZW1lbnRhbCBwYXJzZXIgZm9yIHRoZSBzbWFsbCBzdHJ1Y3R1cmVkIHByb3RvY29sIGVtYmVkZGVkIGluIHN0cmVhbWVkXHJcbiAqIG1vZGVsIHRleHQuIFVJIGNvZGUgb25seSByZWNlaXZlcyBub3JtYWxpemVkIGV2ZW50cy5cclxuICovXHJcbmV4cG9ydCBjbGFzcyBTdHJ1Y3R1cmVkU3RyZWFtUGFyc2VyIHtcclxuICBwcml2YXRlIGJ1ZmZlciA9IFwiXCI7XHJcbiAgcHJpdmF0ZSBtb2RlOiBcInRleHRcIiB8IEJsb2NrS2luZCA9IFwidGV4dFwiO1xyXG5cclxuICBwdXNoKGNodW5rOiBzdHJpbmcpOiBTdHJ1Y3R1cmVkU3RyZWFtRXZlbnRbXSB7XHJcbiAgICB0aGlzLmJ1ZmZlciArPSBjaHVuaztcclxuICAgIHJldHVybiB0aGlzLmRyYWluKGZhbHNlKTtcclxuICB9XHJcblxyXG4gIGZpbmlzaCgpOiBTdHJ1Y3R1cmVkU3RyZWFtRXZlbnRbXSB7XHJcbiAgICByZXR1cm4gdGhpcy5kcmFpbih0cnVlKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZHJhaW4oZmluYWw6IGJvb2xlYW4pOiBTdHJ1Y3R1cmVkU3RyZWFtRXZlbnRbXSB7XHJcbiAgICBjb25zdCBldmVudHM6IFN0cnVjdHVyZWRTdHJlYW1FdmVudFtdID0gW107XHJcblxyXG4gICAgd2hpbGUgKHRoaXMuYnVmZmVyLmxlbmd0aCA+IDApIHtcclxuICAgICAgaWYgKHRoaXMubW9kZSA9PT0gXCJ0ZXh0XCIpIHtcclxuICAgICAgICBjb25zdCBzdGFydCA9IGZpbmRTdGFydCh0aGlzLmJ1ZmZlcik7XHJcblxyXG4gICAgICAgIGlmIChzdGFydCkge1xyXG4gICAgICAgICAgY29uc3QgdmlzaWJsZSA9IHRoaXMuYnVmZmVyLnNsaWNlKDAsIHN0YXJ0LmluZGV4KTtcclxuICAgICAgICAgIGlmICh2aXNpYmxlKSB7XHJcbiAgICAgICAgICAgIGV2ZW50cy5wdXNoKHtcclxuICAgICAgICAgICAgICB0eXBlOiBcInRleHRcIixcclxuICAgICAgICAgICAgICB0ZXh0OiB2aXNpYmxlLFxyXG4gICAgICAgICAgICB9KTtcclxuICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICB0aGlzLmJ1ZmZlciA9IHRoaXMuYnVmZmVyLnNsaWNlKFxyXG4gICAgICAgICAgICBzdGFydC5pbmRleCArIHN0YXJ0Lm1hcmtlci5sZW5ndGgsXHJcbiAgICAgICAgICApO1xyXG4gICAgICAgICAgdGhpcy5tb2RlID0gc3RhcnQua2luZDtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGZpbmFsKSB7XHJcbiAgICAgICAgICBldmVudHMucHVzaCh7XHJcbiAgICAgICAgICAgIHR5cGU6IFwidGV4dFwiLFxyXG4gICAgICAgICAgICB0ZXh0OiB0aGlzLmJ1ZmZlcixcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgdGhpcy5idWZmZXIgPSBcIlwiO1xyXG4gICAgICAgICAgYnJlYWs7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb25zdCBrZWVwID0gTWF0aC5taW4oXHJcbiAgICAgICAgICBNQVhfTUFSS0VSX0xFTkdUSCAtIDEsXHJcbiAgICAgICAgICB0aGlzLmJ1ZmZlci5sZW5ndGgsXHJcbiAgICAgICAgKTtcclxuICAgICAgICBjb25zdCBlbWl0TGVuZ3RoID0gdGhpcy5idWZmZXIubGVuZ3RoIC0ga2VlcDtcclxuXHJcbiAgICAgICAgaWYgKGVtaXRMZW5ndGggPiAwKSB7XHJcbiAgICAgICAgICBldmVudHMucHVzaCh7XHJcbiAgICAgICAgICAgIHR5cGU6IFwidGV4dFwiLFxyXG4gICAgICAgICAgICB0ZXh0OiB0aGlzLmJ1ZmZlci5zbGljZSgwLCBlbWl0TGVuZ3RoKSxcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgdGhpcy5idWZmZXIgPSB0aGlzLmJ1ZmZlci5zbGljZShlbWl0TGVuZ3RoKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IGVuZCA9IHRoaXMuYnVmZmVyLmluZGV4T2YoRU5EX1RBRyk7XHJcblxyXG4gICAgICBpZiAoZW5kIDwgMCkge1xyXG4gICAgICAgIGlmIChmaW5hbCkge1xyXG4gICAgICAgICAgZXZlbnRzLnB1c2goe1xyXG4gICAgICAgICAgICB0eXBlOiBcImVycm9yXCIsXHJcbiAgICAgICAgICAgIG1lc3NhZ2U6IGBJbmNvbXBsZXRlICR7dGhpcy5tb2RlfSBibG9jayByZXR1cm5lZCBieSB0aGUgYWdlbnQuYCxcclxuICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgdGhpcy5idWZmZXIgPSBcIlwiO1xyXG4gICAgICAgICAgdGhpcy5tb2RlID0gXCJ0ZXh0XCI7XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGJyZWFrO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCByYXcgPSB0aGlzLmJ1ZmZlci5zbGljZSgwLCBlbmQpLnRyaW0oKTtcclxuICAgICAgY29uc3QgYmxvY2tLaW5kID0gdGhpcy5tb2RlO1xyXG5cclxuICAgICAgdGhpcy5idWZmZXIgPSB0aGlzLmJ1ZmZlci5zbGljZShlbmQgKyBFTkRfVEFHLmxlbmd0aCk7XHJcbiAgICAgIHRoaXMubW9kZSA9IFwidGV4dFwiO1xyXG5cclxuICAgICAgbGV0IHBhcnNlZDogdW5rbm93bjtcclxuICAgICAgdHJ5IHtcclxuICAgICAgICBwYXJzZWQgPSBKU09OLnBhcnNlKHJhdyk7XHJcbiAgICAgIH0gY2F0Y2gge1xyXG4gICAgICAgIGV2ZW50cy5wdXNoKHtcclxuICAgICAgICAgIHR5cGU6IFwiZXJyb3JcIixcclxuICAgICAgICAgIG1lc3NhZ2U6IGBDb3VsZCBub3QgcGFyc2UgJHtibG9ja0tpbmR9IHJldHVybmVkIGJ5IHRoZSBhZ2VudC5gLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAoYmxvY2tLaW5kID09PSBcImVkaXQtcHJvcG9zYWxcIikge1xyXG4gICAgICAgIGlmICghaXNFZGl0UHJvcG9zYWwocGFyc2VkKSkge1xyXG4gICAgICAgICAgZXZlbnRzLnB1c2goe1xyXG4gICAgICAgICAgICB0eXBlOiBcImVycm9yXCIsXHJcbiAgICAgICAgICAgIG1lc3NhZ2U6IFwiQWdlbnQgcmV0dXJuZWQgYW4gaW52YWxpZCBlZGl0IHByb3Bvc2FsLlwiLFxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGV2ZW50cy5wdXNoKHtcclxuICAgICAgICAgIHR5cGU6IFwicHJvcG9zYWxcIixcclxuICAgICAgICAgIHByb3Bvc2FsOiBwYXJzZWQsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChibG9ja0tpbmQgPT09IFwibGVhcm5pbmctcmV2aWV3XCIpIHtcclxuICAgICAgICBpZiAoIWlzUmV2aWV3UGF5bG9hZChwYXJzZWQpKSB7XHJcbiAgICAgICAgICBldmVudHMucHVzaCh7XHJcbiAgICAgICAgICAgIHR5cGU6IFwiZXJyb3JcIixcclxuICAgICAgICAgICAgbWVzc2FnZTogXCJBZ2VudCByZXR1cm5lZCBhbiBpbnZhbGlkIHJldmlldyBwYXlsb2FkLlwiLFxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGV2ZW50cy5wdXNoKHtcclxuICAgICAgICAgIHR5cGU6IFwicmV2aWV3LWZpbmRpbmdzXCIsXHJcbiAgICAgICAgICBmaW5kaW5nczogcGFyc2VkLmZpbmRpbmdzLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAoIWlzUHJhY3RpY2VQYXlsb2FkKHBhcnNlZCkpIHtcclxuICAgICAgICBldmVudHMucHVzaCh7XHJcbiAgICAgICAgICB0eXBlOiBcImVycm9yXCIsXHJcbiAgICAgICAgICBtZXNzYWdlOiBcIkFnZW50IHJldHVybmVkIGFuIGludmFsaWQgcHJhY3RpY2UgcGF5bG9hZC5cIixcclxuICAgICAgICB9KTtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKHBhcnNlZC5raW5kID09PSBcInF1ZXN0aW9uXCIpIHtcclxuICAgICAgICBldmVudHMucHVzaCh7XHJcbiAgICAgICAgICB0eXBlOiBcInByYWN0aWNlLXF1ZXN0aW9uXCIsXHJcbiAgICAgICAgICBxdWVzdGlvbjogcGFyc2VkLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIGV2ZW50cy5wdXNoKHtcclxuICAgICAgICAgIHR5cGU6IFwicHJhY3RpY2UtZXZhbHVhdGlvblwiLFxyXG4gICAgICAgICAgZXZhbHVhdGlvbjogcGFyc2VkLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIGV2ZW50cztcclxuICB9XHJcbn1cclxuIiwgImltcG9ydCB7XHJcbiAgQWdlbnRDb250ZXh0LFxyXG4gIEFnZW50RmFpbHVyZSxcclxuICBBZ2VudEhlYWx0aCxcclxuICBBcHBseVJlc3VsdCxcclxuICBBZ2VudE1vZGVsLFxyXG4gIENoYXRTZXNzaW9uLFxyXG4gIEVkaXRQcm9wb3NhbCxcclxufSBmcm9tIFwiLi4vdHlwZXNcIjtcclxuaW1wb3J0IHsgQ29udGV4dFJlc29sdmVyIH0gZnJvbSBcIi4uL2NvbnRleHQvQ29udGV4dFJlc29sdmVyXCI7XHJcbmltcG9ydCB7XHJcbiAgTGVhcm5pbmdDb250ZXh0LFxyXG4gIFR1cm5Db250ZXh0U25hcHNob3QsXHJcbn0gZnJvbSBcIi4uL2NvbnRleHQvY29udGV4dC10eXBlc1wiO1xyXG5pbXBvcnQgeyBQb2xpY3lMb2FkZXIgfSBmcm9tIFwiLi4vY29udGV4dC9Qb2xpY3lMb2FkZXJcIjtcclxuaW1wb3J0IHsgTXV0YXRpb25TZXJ2aWNlIH0gZnJvbSBcIi4uL211dGF0aW9uL011dGF0aW9uU2VydmljZVwiO1xyXG5pbXBvcnQgeyBWYXVsdExlYXJuaW5nU3RvcmUgfSBmcm9tIFwiLi4vcGVyc2lzdGVuY2UvVmF1bHRMZWFybmluZ1N0b3JlXCI7XHJcbmltcG9ydCB7IFNlc3Npb25Db250cm9sbGVyIH0gZnJvbSBcIi4uL3Nlc3Npb24vU2Vzc2lvbkNvbnRyb2xsZXJcIjtcclxuaW1wb3J0IHtcclxuICBidWlsZEFjdGlvbkluc3RydWN0aW9uLFxyXG4gIGJ1aWxkUHJhY3RpY2VFdmFsdWF0aW9uSW5zdHJ1Y3Rpb24sXHJcbiAgYnVpbGRQcmFjdGljZVF1ZXN0aW9uSW5zdHJ1Y3Rpb24sXHJcbn0gZnJvbSBcIi4vYWN0aW9uLWJ1aWxkZXJzXCI7XHJcbmltcG9ydCB7XHJcbiAgTGVhcm5pbmdFdmVudCxcclxuICBMZWFybmluZ1JlcXVlc3QsXHJcbiAgUHJvcG9zZWRFZGl0LFxyXG59IGZyb20gXCIuL2xlYXJuaW5nLXR5cGVzXCI7XHJcbmltcG9ydCB7XHJcbiAgUHJhY3RpY2VFdmFsdWF0aW9uLFxyXG4gIFByYWN0aWNlUXVlc3Rpb24sXHJcbiAgUHJhY3RpY2VTZXNzaW9uLFxyXG59IGZyb20gXCIuL3ByYWN0aWNlLXR5cGVzXCI7XHJcbmltcG9ydCB7XHJcbiAgU3RydWN0dXJlZFN0cmVhbUV2ZW50LFxyXG4gIFN0cnVjdHVyZWRTdHJlYW1QYXJzZXIsXHJcbn0gZnJvbSBcIi4vU3RydWN0dXJlZFN0cmVhbVBhcnNlclwiO1xyXG5cclxuLyoqXHJcbiAqIEFwcGxpY2F0aW9uIGJvdW5kYXJ5IGZvciB0aGUgTGVhcm5pbmcgT1MuXHJcbiAqXHJcbiAqIFRoZSB2aWV3IHNlbmRzIHVzZXIgaW50ZW50IGhlcmUuIFRoaXMgY29udHJvbGxlciBvd25zIG9yY2hlc3RyYXRpb246XHJcbiAqIGNvbnRleHQgLT4gcG9saWN5IC0+IGxlYXJuaW5nIHN0YXRlIC0+IGFjdGlvbiAtPiBhZ2VudCBzZXNzaW9uIC0+IG5vcm1hbGl6ZWRcclxuICogVUkgZXZlbnRzLiBJdCBkZWxpYmVyYXRlbHkgaGlkZXMgcHJvdmlkZXIgdHJhbnNwb3J0IGRldGFpbHMgZnJvbSB0aGUgVUkuXHJcbiAqL1xyXG5leHBvcnQgY2xhc3MgTGVhcm5pbmdDb250cm9sbGVyIHtcclxuICBwcml2YXRlIHByYWN0aWNlU2Vzc2lvbjogUHJhY3RpY2VTZXNzaW9uIHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBhY3RpdmVUdXJuOiB7XHJcbiAgICBjb250cm9sbGVyOiBBYm9ydENvbnRyb2xsZXI7XHJcbiAgICBjYW5jZWxSZWFzb24/OiBcInVzZXJcIiB8IFwidGltZW91dFwiIHwgXCJkaXNwb3NlXCI7XHJcbiAgfSB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgcGVuZGluZ1Byb3Bvc2FscyA9IG5ldyBNYXA8XHJcbiAgICBzdHJpbmcsXHJcbiAgICB7IHByb3Bvc2FsOiBFZGl0UHJvcG9zYWw7IGFsbG93ZWRGaWxlczogcmVhZG9ubHkgc3RyaW5nW10gfVxyXG4gID4oKTtcclxuXHJcbiAgY29uc3RydWN0b3IoXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IHNlc3Npb25zOiBTZXNzaW9uQ29udHJvbGxlcixcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgY29udGV4dHM6IENvbnRleHRSZXNvbHZlcixcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgcG9saWNpZXM6IFBvbGljeUxvYWRlcixcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgbXV0YXRpb25zOiBNdXRhdGlvblNlcnZpY2UsXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IGxlYXJuaW5nU3RhdGU6IFZhdWx0TGVhcm5pbmdTdG9yZSxcclxuICApIHt9XHJcblxyXG4gIGNoZWNrUnVudGltZSgpOiBQcm9taXNlPEFnZW50SGVhbHRoPiB7XHJcbiAgICByZXR1cm4gdGhpcy5zZXNzaW9ucy5jaGVja1J1bnRpbWUoKTtcclxuICB9XHJcblxyXG4gIGdldFNlc3Npb24oKTogQ2hhdFNlc3Npb24ge1xyXG4gICAgcmV0dXJuIHRoaXMuc2Vzc2lvbnMuZ2V0U2Vzc2lvbigpO1xyXG4gIH1cclxuXHJcbiAgZ2V0TW9kZWxzKCk6IEFnZW50TW9kZWxbXSB7XHJcbiAgICByZXR1cm4gdGhpcy5zZXNzaW9ucy5nZXRNb2RlbHMoKTtcclxuICB9XHJcblxyXG4gIHNldE1vZGVsKG1vZGVsSWQ/OiBzdHJpbmcpOiB2b2lkIHtcclxuICAgIHRoaXMuc2Vzc2lvbnMuc2V0TW9kZWwobW9kZWxJZCk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBuZXdTZXNzaW9uKCk6IFByb21pc2U8Q2hhdFNlc3Npb24+IHtcclxuICAgIHRoaXMucHJhY3RpY2VTZXNzaW9uID0gbnVsbDtcclxuICAgIHJldHVybiB0aGlzLnNlc3Npb25zLm5ld1Nlc3Npb24oKTtcclxuICB9XHJcblxyXG4gIGFzeW5jIHJlc29sdmVDb250ZXh0KFxyXG4gICAgZXhwbGljaXRDb250ZXh0OiBBZ2VudENvbnRleHRbXSA9IFtdLFxyXG4gICk6IFByb21pc2U8TGVhcm5pbmdDb250ZXh0PiB7XHJcbiAgICByZXR1cm4gdGhpcy5jb250ZXh0cy5yZXNvbHZlKGV4cGxpY2l0Q29udGV4dCk7XHJcbiAgfVxyXG5cclxuICBzZWFyY2hOb3RlcyhcclxuICAgIHF1ZXJ5OiBzdHJpbmcsXHJcbiAgICBsaW1pdCA9IDgsXHJcbiAgKTogQXJyYXk8eyBwYXRoOiBzdHJpbmc7IG5hbWU6IHN0cmluZyB9PiB7XHJcbiAgICByZXR1cm4gdGhpcy5jb250ZXh0cy5zZWFyY2hOb3RlcyhxdWVyeSwgbGltaXQpO1xyXG4gIH1cclxuXHJcbiAgbG9hZE5vdGVDb250ZXh0KHBhdGg6IHN0cmluZyk6IFByb21pc2U8QWdlbnRDb250ZXh0IHwgbnVsbD4ge1xyXG4gICAgcmV0dXJuIHRoaXMuY29udGV4dHMubG9hZEV4cGxpY2l0Tm90ZShwYXRoKTtcclxuICB9XHJcblxyXG4gIGFzeW5jICpydW4ocmVxdWVzdDogTGVhcm5pbmdSZXF1ZXN0KTogQXN5bmNJdGVyYWJsZTxMZWFybmluZ0V2ZW50PiB7XHJcbiAgICBpZiAodGhpcy5hY3RpdmVUdXJuKSB7XHJcbiAgICAgIHlpZWxkIHtcclxuICAgICAgICB0eXBlOiBcImZhaWxlZFwiLFxyXG4gICAgICAgIGZhaWx1cmU6IHsgY29kZTogXCJidXN5XCIsIG1lc3NhZ2U6IFwiQW5vdGhlciBGb3JnZSB0dXJuIGlzIHN0aWxsIHJ1bm5pbmcuXCIgfSxcclxuICAgICAgfTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGNvbnRleHQgPSBhd2FpdCB0aGlzLmNvbnRleHRzLnJlc29sdmUocmVxdWVzdC5leHBsaWNpdENvbnRleHQpO1xyXG4gICAgY29uc3QgW3BvbGljeSwgc3RhdGVdID0gYXdhaXQgUHJvbWlzZS5hbGwoW1xyXG4gICAgICB0aGlzLnBvbGljaWVzLmxvYWQoKSxcclxuICAgICAgdGhpcy5sZWFybmluZ1N0YXRlLmxvYWQoKSxcclxuICAgIF0pO1xyXG5cclxuICAgIGNvbnN0IHZpc2libGUgPSB0aGlzLmNvbnRleHRzLnRvQWdlbnRDb250ZXh0KGNvbnRleHQpO1xyXG4gICAgY29uc3Qgc3lzdGVtOiBBZ2VudENvbnRleHRbXSA9IFtdO1xyXG5cclxuICAgIGlmIChwb2xpY3kucmF3SW5zdHJ1Y3Rpb25zKSB7XHJcbiAgICAgIGNvbnN0IGFscmVhZHlJbmNsdWRlZCA9IHZpc2libGUuc29tZShcclxuICAgICAgICAoaXRlbSkgPT4gaXRlbS50eXBlID09PSBcIm5vdGVcIiAmJiBpdGVtLmZpbGUgPT09IHBvbGljeS5wYXRoLFxyXG4gICAgICApO1xyXG5cclxuICAgICAgaWYgKCFhbHJlYWR5SW5jbHVkZWQpIHtcclxuICAgICAgICBzeXN0ZW0ucHVzaCh7XHJcbiAgICAgICAgICB0eXBlOiBcIm5vdGVcIixcclxuICAgICAgICAgIGZpbGU6IHBvbGljeS5wYXRoLFxyXG4gICAgICAgICAgY29udGVudDogcG9saWN5LnJhd0luc3RydWN0aW9ucyxcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHN5c3RlbS5wdXNoKHtcclxuICAgICAgdHlwZTogXCJub3RlXCIsXHJcbiAgICAgIGZpbGU6IFwiMDAtbGVhcm5pbmctb3MvcHJvZ3Jlc3MuanNvblwiLFxyXG4gICAgICBjb250ZW50OiBKU09OLnN0cmluZ2lmeShzdGF0ZSwgbnVsbCwgMiksXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBzbmFwc2hvdDogVHVybkNvbnRleHRTbmFwc2hvdCA9IHtcclxuICAgICAgcmVzb2x2ZWQ6IGNvbnRleHQsXHJcbiAgICAgIHZpc2libGUsXHJcbiAgICAgIHN5c3RlbSxcclxuICAgICAgYWxsb3dlZE11dGF0aW9uRmlsZXM6IEFycmF5LmZyb20oXHJcbiAgICAgICAgbmV3IFNldChcclxuICAgICAgICAgIHZpc2libGVcclxuICAgICAgICAgICAgLmZpbHRlcigoaXRlbSkgPT4gIWl0ZW0uZmlsZS5zdGFydHNXaXRoKFwiYXR0YWNobWVudC9cIikpXHJcbiAgICAgICAgICAgIC5tYXAoKGl0ZW0pID0+IGl0ZW0uZmlsZSksXHJcbiAgICAgICAgKSxcclxuICAgICAgKSxcclxuICAgIH07XHJcbiAgICB5aWVsZCB7IHR5cGU6IFwiY29udGV4dC1yZWFkeVwiLCBjb250ZXh0OiBzbmFwc2hvdCB9O1xyXG5cclxuICAgIGxldCBwcmVwYXJlZFByb21wdDogc3RyaW5nO1xyXG5cclxuICAgIGlmIChyZXF1ZXN0LmFjdGlvbiA9PT0gXCJwcmFjdGljZVwiKSB7XHJcbiAgICAgIGNvbnN0IGFjdGl2ZVByYWN0aWNlID0gdGhpcy5wcmFjdGljZVNlc3Npb247XHJcblxyXG4gICAgICBpZiAoXHJcbiAgICAgICAgYWN0aXZlUHJhY3RpY2U/LnN0YXRlID09PSBcIndhaXRpbmctYW5zd2VyXCIgJiZcclxuICAgICAgICBhY3RpdmVQcmFjdGljZS5jdXJyZW50UXVlc3Rpb25cclxuICAgICAgKSB7XHJcbiAgICAgICAgYWN0aXZlUHJhY3RpY2Uuc3RhdGUgPSBcImV2YWx1YXRpbmdcIjtcclxuICAgICAgICBwcmVwYXJlZFByb21wdCA9IGJ1aWxkUHJhY3RpY2VFdmFsdWF0aW9uSW5zdHJ1Y3Rpb24oe1xyXG4gICAgICAgICAgcXVlc3Rpb246IGFjdGl2ZVByYWN0aWNlLmN1cnJlbnRRdWVzdGlvbixcclxuICAgICAgICAgIGFuc3dlcjogcmVxdWVzdC5wcm9tcHQsXHJcbiAgICAgICAgICBjb25jZXB0OiBhY3RpdmVQcmFjdGljZS5jb25jZXB0LFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMucHJhY3RpY2VTZXNzaW9uID0ge1xyXG4gICAgICAgICAgaWQ6IGNyeXB0by5yYW5kb21VVUlEKCksXHJcbiAgICAgICAgICBzdGF0ZTogXCJnZW5lcmF0aW5nXCIsXHJcbiAgICAgICAgICB0dXJuczogW10sXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgcHJlcGFyZWRQcm9tcHQgPSBidWlsZFByYWN0aWNlUXVlc3Rpb25JbnN0cnVjdGlvbihcclxuICAgICAgICAgIHJlcXVlc3QucHJvbXB0LFxyXG4gICAgICAgICk7XHJcbiAgICAgIH1cclxuICAgIH0gZWxzZSB7XHJcbiAgICAgIHRoaXMucHJhY3RpY2VTZXNzaW9uID0gbnVsbDtcclxuICAgICAgY29uc3QgaW5zdHJ1Y3Rpb24gPSBidWlsZEFjdGlvbkluc3RydWN0aW9uKHJlcXVlc3QuYWN0aW9uKTtcclxuICAgICAgcHJlcGFyZWRQcm9tcHQgPVxyXG4gICAgICAgIGAke2luc3RydWN0aW9ufVxcblxcblVzZXIgcmVxdWVzdDpcXG4ke3JlcXVlc3QucHJvbXB0fWA7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcGFyc2VyID0gbmV3IFN0cnVjdHVyZWRTdHJlYW1QYXJzZXIoKTtcclxuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XHJcbiAgICBjb25zdCBhY3RpdmVUdXJuID0geyBjb250cm9sbGVyIH0gYXMge1xyXG4gICAgICBjb250cm9sbGVyOiBBYm9ydENvbnRyb2xsZXI7XHJcbiAgICAgIGNhbmNlbFJlYXNvbj86IFwidXNlclwiIHwgXCJ0aW1lb3V0XCIgfCBcImRpc3Bvc2VcIjtcclxuICAgIH07XHJcbiAgICB0aGlzLmFjdGl2ZVR1cm4gPSBhY3RpdmVUdXJuO1xyXG4gICAgY29uc3QgdGltZW91dCA9IHNldFRpbWVvdXQoKCkgPT4ge1xyXG4gICAgICBhY3RpdmVUdXJuLmNhbmNlbFJlYXNvbiA9IFwidGltZW91dFwiO1xyXG4gICAgICBjb250cm9sbGVyLmFib3J0KCk7XHJcbiAgICB9LCA2MF8wMDApO1xyXG4gICAgbGV0IHZpc2libGVUZXh0ID0gXCJcIjtcclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBmb3IgYXdhaXQgKGNvbnN0IGV2ZW50IG9mIHRoaXMuc2Vzc2lvbnMuc2VuZFR1cm4oXHJcbiAgICAgICAgcHJlcGFyZWRQcm9tcHQsXHJcbiAgICAgICAgWy4uLnNuYXBzaG90LnZpc2libGUsIC4uLnNuYXBzaG90LnN5c3RlbV0sXHJcbiAgICAgICAgcmVxdWVzdC5wcm9tcHQsXHJcbiAgICAgICAgY29udHJvbGxlci5zaWduYWwsXHJcbiAgICAgICkpIHtcclxuICAgICAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJ0ZXh0XCIpIHtcclxuICAgICAgICAgIGZvciBhd2FpdCAoY29uc3QgbWFwcGVkIG9mIHRoaXMubWFwU3RydWN0dXJlZEV2ZW50cyhcclxuICAgICAgICAgICAgcGFyc2VyLnB1c2goZXZlbnQuY29udGVudCksXHJcbiAgICAgICAgICAgIHJlcXVlc3QsXHJcbiAgICAgICAgICAgIHNuYXBzaG90LFxyXG4gICAgICAgICAgKSkge1xyXG4gICAgICAgICAgICBpZiAobWFwcGVkLnR5cGUgPT09IFwicmVzcG9uc2UtZGVsdGFcIikgdmlzaWJsZVRleHQgKz0gbWFwcGVkLnRleHQ7XHJcbiAgICAgICAgICAgIGlmIChtYXBwZWQudHlwZSA9PT0gXCJtdXRhdGlvbi1wcm9wb3NlZFwiKSB7XHJcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5zZXNzaW9ucy5yZWNvcmRBc3Npc3RhbnRNZXNzYWdlKHZpc2libGVUZXh0KTtcclxuICAgICAgICAgICAgICB2aXNpYmxlVGV4dCA9IFwiXCI7XHJcbiAgICAgICAgICAgICAgYXdhaXQgdGhpcy5zZXNzaW9ucy5yZWNvcmRQcm9wb3NhbChcclxuICAgICAgICAgICAgICAgIG1hcHBlZC5lZGl0LmlkLFxyXG4gICAgICAgICAgICAgICAgbWFwcGVkLmVkaXQucHJvcG9zYWwsXHJcbiAgICAgICAgICAgICAgKTtcclxuICAgICAgICAgICAgfVxyXG4gICAgICAgICAgICB5aWVsZCBtYXBwZWQ7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChldmVudC50eXBlID09PSBcImNvbXBsZXRlZFwiKSB7XHJcbiAgICAgICAgICBmb3IgYXdhaXQgKGNvbnN0IG1hcHBlZCBvZiB0aGlzLm1hcFN0cnVjdHVyZWRFdmVudHMoXHJcbiAgICAgICAgICAgIHBhcnNlci5maW5pc2goKSxcclxuICAgICAgICAgICAgcmVxdWVzdCxcclxuICAgICAgICAgICAgc25hcHNob3QsXHJcbiAgICAgICAgICApKSB7XHJcbiAgICAgICAgICAgIGlmIChtYXBwZWQudHlwZSA9PT0gXCJyZXNwb25zZS1kZWx0YVwiKSB2aXNpYmxlVGV4dCArPSBtYXBwZWQudGV4dDtcclxuICAgICAgICAgICAgaWYgKG1hcHBlZC50eXBlID09PSBcIm11dGF0aW9uLXByb3Bvc2VkXCIpIHtcclxuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnNlc3Npb25zLnJlY29yZEFzc2lzdGFudE1lc3NhZ2UodmlzaWJsZVRleHQpO1xyXG4gICAgICAgICAgICAgIHZpc2libGVUZXh0ID0gXCJcIjtcclxuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnNlc3Npb25zLnJlY29yZFByb3Bvc2FsKFxyXG4gICAgICAgICAgICAgICAgbWFwcGVkLmVkaXQuaWQsXHJcbiAgICAgICAgICAgICAgICBtYXBwZWQuZWRpdC5wcm9wb3NhbCxcclxuICAgICAgICAgICAgICApO1xyXG4gICAgICAgICAgICB9XHJcbiAgICAgICAgICAgIHlpZWxkIG1hcHBlZDtcclxuICAgICAgICAgIH1cclxuICAgICAgICAgIGF3YWl0IHRoaXMuc2Vzc2lvbnMucmVjb3JkQXNzaXN0YW50TWVzc2FnZSh2aXNpYmxlVGV4dCk7XHJcbiAgICAgICAgICB5aWVsZCB7IHR5cGU6IFwiY29tcGxldGVkXCIgfTtcclxuICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChldmVudC50eXBlID09PSBcImZhaWxlZFwiKSB7XHJcbiAgICAgICAgICB5aWVsZCB7IHR5cGU6IFwiZmFpbGVkXCIsIGZhaWx1cmU6IGV2ZW50LmZhaWx1cmUgfTtcclxuICAgICAgICAgIHJldHVybjtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChhY3RpdmVUdXJuLmNhbmNlbFJlYXNvbiA9PT0gXCJ0aW1lb3V0XCIpIHtcclxuICAgICAgICAgIHlpZWxkIHtcclxuICAgICAgICAgICAgdHlwZTogXCJmYWlsZWRcIixcclxuICAgICAgICAgICAgZmFpbHVyZToge1xyXG4gICAgICAgICAgICAgIGNvZGU6IFwidGltZW91dFwiLFxyXG4gICAgICAgICAgICAgIG1lc3NhZ2U6IFwiTm8gcmVzcG9uc2UgYWZ0ZXIgNjAgc2Vjb25kcy4gVGhlIGFnZW50IHJ1bnRpbWUgbWF5IGJlIGJ1c3kuXCIsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgICB5aWVsZCB7IHR5cGU6IFwiY2FuY2VsbGVkXCIgfTtcclxuICAgICAgICB9XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zdCBmYWlsdXJlOiBBZ2VudEZhaWx1cmUgPSB7XHJcbiAgICAgICAgY29kZTogXCJwcm90b2NvbC1pbnZhbGlkXCIsXHJcbiAgICAgICAgbWVzc2FnZTogXCJGb3JnZSBjb3VsZCBub3QgaW50ZXJwcmV0IHRoZSBhZ2VudCByZXNwb25zZS5cIixcclxuICAgICAgICBkaWFnbm9zdGljOiBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvciksXHJcbiAgICAgIH07XHJcbiAgICAgIHlpZWxkIHsgdHlwZTogXCJmYWlsZWRcIiwgZmFpbHVyZSB9O1xyXG4gICAgfSBmaW5hbGx5IHtcclxuICAgICAgY2xlYXJUaW1lb3V0KHRpbWVvdXQpO1xyXG4gICAgICBpZiAodGhpcy5hY3RpdmVUdXJuID09PSBhY3RpdmVUdXJuKSB0aGlzLmFjdGl2ZVR1cm4gPSBudWxsO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgYXBwbHlQcm9wb3NhbChwcm9wb3NhbElkOiBzdHJpbmcpOiBQcm9taXNlPEFwcGx5UmVzdWx0PiB7XHJcbiAgICBjb25zdCBwZW5kaW5nID0gdGhpcy5wZW5kaW5nUHJvcG9zYWxzLmdldChwcm9wb3NhbElkKTtcclxuICAgIGlmICghcGVuZGluZykge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIG9rOiBmYWxzZSxcclxuICAgICAgICByZWFzb246IFwic3RhbGVcIixcclxuICAgICAgICBtZXNzYWdlOiBcIlRoaXMgcHJvcG9zYWwgaXMgbm8gbG9uZ2VyIGFjdGl2ZS4gUmVnZW5lcmF0ZSB0aGUgZWRpdC5cIixcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByZXN1bHQgPSBhd2FpdCB0aGlzLm11dGF0aW9ucy5hcHBseShcclxuICAgICAgcGVuZGluZy5wcm9wb3NhbCxcclxuICAgICAgcGVuZGluZy5hbGxvd2VkRmlsZXMsXHJcbiAgICApO1xyXG4gICAgdGhpcy5wZW5kaW5nUHJvcG9zYWxzLmRlbGV0ZShwcm9wb3NhbElkKTtcclxuICAgIGF3YWl0IHRoaXMuc2Vzc2lvbnMudXBkYXRlUHJvcG9zYWxTdGF0ZShcclxuICAgICAgcHJvcG9zYWxJZCxcclxuICAgICAgcmVzdWx0Lm9rID8gXCJhcHBsaWVkXCIgOiBcInN0YWxlXCIsXHJcbiAgICApO1xyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcblxyXG4gIGFzeW5jIHJlamVjdFByb3Bvc2FsKHByb3Bvc2FsSWQ6IHN0cmluZyk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdGhpcy5wZW5kaW5nUHJvcG9zYWxzLmRlbGV0ZShwcm9wb3NhbElkKTtcclxuICAgIGF3YWl0IHRoaXMuc2Vzc2lvbnMudXBkYXRlUHJvcG9zYWxTdGF0ZShwcm9wb3NhbElkLCBcInJlamVjdGVkXCIpO1xyXG4gIH1cclxuXHJcbiAgY2FuY2VsKCk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLmFjdGl2ZVR1cm4pIHJldHVybjtcclxuICAgIHRoaXMuYWN0aXZlVHVybi5jYW5jZWxSZWFzb24gPSBcInVzZXJcIjtcclxuICAgIHRoaXMuYWN0aXZlVHVybi5jb250cm9sbGVyLmFib3J0KCk7XHJcbiAgfVxyXG5cclxuICBkaXNwb3NlKCk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLmFjdGl2ZVR1cm4pIHJldHVybjtcclxuICAgIHRoaXMuYWN0aXZlVHVybi5jYW5jZWxSZWFzb24gPSBcImRpc3Bvc2VcIjtcclxuICAgIHRoaXMuYWN0aXZlVHVybi5jb250cm9sbGVyLmFib3J0KCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jICptYXBTdHJ1Y3R1cmVkRXZlbnRzKFxyXG4gICAgZXZlbnRzOiBTdHJ1Y3R1cmVkU3RyZWFtRXZlbnRbXSxcclxuICAgIHJlcXVlc3Q6IExlYXJuaW5nUmVxdWVzdCxcclxuICAgIGNvbnRleHQ6IFR1cm5Db250ZXh0U25hcHNob3QsXHJcbiAgKTogQXN5bmNJdGVyYWJsZTxMZWFybmluZ0V2ZW50PiB7XHJcbiAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIGV2ZW50cykge1xyXG4gICAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJ0ZXh0XCIpIHtcclxuICAgICAgICBpZiAoZXZlbnQudGV4dCkge1xyXG4gICAgICAgICAgeWllbGQge1xyXG4gICAgICAgICAgICB0eXBlOiBcInJlc3BvbnNlLWRlbHRhXCIsXHJcbiAgICAgICAgICAgIHRleHQ6IGV2ZW50LnRleHQsXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKGV2ZW50LnR5cGUgPT09IFwicHJvcG9zYWxcIikge1xyXG4gICAgICAgIGlmICghY29udGV4dC5hbGxvd2VkTXV0YXRpb25GaWxlcy5pbmNsdWRlcyhldmVudC5wcm9wb3NhbC5maWxlKSkge1xyXG4gICAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICAgICAgICBgRWRpdCB0YXJnZXQgaXMgb3V0c2lkZSB0aGUgYXBwcm92ZWQgY29udGV4dDogJHtldmVudC5wcm9wb3NhbC5maWxlfWAsXHJcbiAgICAgICAgICApO1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb25zdCBlZGl0OiBQcm9wb3NlZEVkaXQgPSB7XHJcbiAgICAgICAgICBpZDogY3J5cHRvLnJhbmRvbVVVSUQoKSxcclxuICAgICAgICAgIHByb3Bvc2FsOiBldmVudC5wcm9wb3NhbCxcclxuICAgICAgICB9O1xyXG4gICAgICAgIHRoaXMucGVuZGluZ1Byb3Bvc2Fscy5zZXQoZWRpdC5pZCwge1xyXG4gICAgICAgICAgcHJvcG9zYWw6IGVkaXQucHJvcG9zYWwsXHJcbiAgICAgICAgICBhbGxvd2VkRmlsZXM6IGNvbnRleHQuYWxsb3dlZE11dGF0aW9uRmlsZXMsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgeWllbGQge1xyXG4gICAgICAgICAgdHlwZTogXCJtdXRhdGlvbi1wcm9wb3NlZFwiLFxyXG4gICAgICAgICAgZWRpdCxcclxuICAgICAgICB9O1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJwcmFjdGljZS1xdWVzdGlvblwiKSB7XHJcbiAgICAgICAgdGhpcy5hY2NlcHRQcmFjdGljZVF1ZXN0aW9uKGV2ZW50LnF1ZXN0aW9uKTtcclxuICAgICAgICB5aWVsZCB7XHJcbiAgICAgICAgICB0eXBlOiBcInByYWN0aWNlLXF1ZXN0aW9uXCIsXHJcbiAgICAgICAgICBxdWVzdGlvbjogZXZlbnQucXVlc3Rpb24sXHJcbiAgICAgICAgfTtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKGV2ZW50LnR5cGUgPT09IFwicmV2aWV3LWZpbmRpbmdzXCIpIHtcclxuICAgICAgICBjb25zdCBzb3VyY2UgPVxyXG4gICAgICAgICAgY29udGV4dC5yZXNvbHZlZC5zZWxlY3Rpb24/LmZpbGUgPz9cclxuICAgICAgICAgIGNvbnRleHQucmVzb2x2ZWQuYWN0aXZlTm90ZT8ucGF0aCA/P1xyXG4gICAgICAgICAgXCJsZWFybmluZy1zZXNzaW9uXCI7XHJcblxyXG4gICAgICAgIHlpZWxkIHtcclxuICAgICAgICAgIHR5cGU6IFwicmV2aWV3LWZpbmRpbmdzXCIsXHJcbiAgICAgICAgICBmaW5kaW5nczogZXZlbnQuZmluZGluZ3MsXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgY29uc3Qgc3RhdGUgPSBhd2FpdCB0aGlzLmxlYXJuaW5nU3RhdGUucmVjb3JkUmV2aWV3RmluZGluZ3Moe1xyXG4gICAgICAgICAgZmluZGluZ3M6IGV2ZW50LmZpbmRpbmdzLFxyXG4gICAgICAgICAgc291cmNlLFxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICBpZiAoZXZlbnQuZmluZGluZ3MubGVuZ3RoID4gMCkge1xyXG4gICAgICAgICAgeWllbGQge1xyXG4gICAgICAgICAgICB0eXBlOiBcImxlYXJuaW5nLXN0YXRlLXVwZGF0ZWRcIixcclxuICAgICAgICAgICAgc3RhdGUsXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKGV2ZW50LnR5cGUgPT09IFwicHJhY3RpY2UtZXZhbHVhdGlvblwiKSB7XHJcbiAgICAgICAgY29uc3QgZXZhbHVhdGlvbiA9IGV2ZW50LmV2YWx1YXRpb247XHJcbiAgICAgICAgdGhpcy5hY2NlcHRQcmFjdGljZUV2YWx1YXRpb24oXHJcbiAgICAgICAgICBldmFsdWF0aW9uLFxyXG4gICAgICAgICAgcmVxdWVzdC5wcm9tcHQsXHJcbiAgICAgICAgKTtcclxuXHJcbiAgICAgICAgeWllbGQge1xyXG4gICAgICAgICAgdHlwZTogXCJwcmFjdGljZS1ldmFsdWF0aW9uXCIsXHJcbiAgICAgICAgICBldmFsdWF0aW9uLFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGNvbnN0IHNvdXJjZSA9XHJcbiAgICAgICAgICBjb250ZXh0LnJlc29sdmVkLnNlbGVjdGlvbj8uZmlsZSA/P1xyXG4gICAgICAgICAgY29udGV4dC5yZXNvbHZlZC5hY3RpdmVOb3RlPy5wYXRoID8/XHJcbiAgICAgICAgICBcImxlYXJuaW5nLXNlc3Npb25cIjtcclxuXHJcbiAgICAgICAgY29uc3Qgc3RhdGUgPVxyXG4gICAgICAgICAgYXdhaXQgdGhpcy5sZWFybmluZ1N0YXRlLnJlY29yZFByYWN0aWNlRXZhbHVhdGlvbih7XHJcbiAgICAgICAgICAgIGV2YWx1YXRpb24sXHJcbiAgICAgICAgICAgIHNvdXJjZSxcclxuICAgICAgICAgIH0pO1xyXG5cclxuICAgICAgICB5aWVsZCB7XHJcbiAgICAgICAgICB0eXBlOiBcImxlYXJuaW5nLXN0YXRlLXVwZGF0ZWRcIixcclxuICAgICAgICAgIHN0YXRlLFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGlmIChldmFsdWF0aW9uLm5leHRRdWVzdGlvbj8udHJpbSgpKSB7XHJcbiAgICAgICAgICBjb25zdCBuZXh0OiBQcmFjdGljZVF1ZXN0aW9uID0ge1xyXG4gICAgICAgICAgICBraW5kOiBcInF1ZXN0aW9uXCIsXHJcbiAgICAgICAgICAgIGNvbmNlcHQ6IGV2YWx1YXRpb24uY29uY2VwdCxcclxuICAgICAgICAgICAgcXVlc3Rpb246IGV2YWx1YXRpb24ubmV4dFF1ZXN0aW9uLnRyaW0oKSxcclxuICAgICAgICAgIH07XHJcblxyXG4gICAgICAgICAgdGhpcy5hY2NlcHRQcmFjdGljZVF1ZXN0aW9uKG5leHQpO1xyXG4gICAgICAgICAgeWllbGQge1xyXG4gICAgICAgICAgICB0eXBlOiBcInByYWN0aWNlLXF1ZXN0aW9uXCIsXHJcbiAgICAgICAgICAgIHF1ZXN0aW9uOiBuZXh0LFxyXG4gICAgICAgICAgfTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICB0aHJvdyBuZXcgRXJyb3IoZXZlbnQubWVzc2FnZSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFjY2VwdFByYWN0aWNlUXVlc3Rpb24oXHJcbiAgICBxdWVzdGlvbjogUHJhY3RpY2VRdWVzdGlvbixcclxuICApOiB2b2lkIHtcclxuICAgIGlmICghdGhpcy5wcmFjdGljZVNlc3Npb24pIHtcclxuICAgICAgdGhpcy5wcmFjdGljZVNlc3Npb24gPSB7XHJcbiAgICAgICAgaWQ6IGNyeXB0by5yYW5kb21VVUlEKCksXHJcbiAgICAgICAgc3RhdGU6IFwiZ2VuZXJhdGluZ1wiLFxyXG4gICAgICAgIHR1cm5zOiBbXSxcclxuICAgICAgfTtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLnByYWN0aWNlU2Vzc2lvbi5jb25jZXB0ID0gcXVlc3Rpb24uY29uY2VwdDtcclxuICAgIHRoaXMucHJhY3RpY2VTZXNzaW9uLmN1cnJlbnRRdWVzdGlvbiA9IHF1ZXN0aW9uLnF1ZXN0aW9uO1xyXG4gICAgdGhpcy5wcmFjdGljZVNlc3Npb24uc3RhdGUgPSBcIndhaXRpbmctYW5zd2VyXCI7XHJcblxyXG4gICAgY29uc3QgY3VycmVudCA9XHJcbiAgICAgIHRoaXMucHJhY3RpY2VTZXNzaW9uLnR1cm5zW1xyXG4gICAgICAgIHRoaXMucHJhY3RpY2VTZXNzaW9uLnR1cm5zLmxlbmd0aCAtIDFcclxuICAgICAgXTtcclxuXHJcbiAgICBpZiAoXHJcbiAgICAgIGN1cnJlbnQgJiZcclxuICAgICAgIWN1cnJlbnQuYW5zd2VyICYmXHJcbiAgICAgIGN1cnJlbnQucXVlc3Rpb24gPT09IHF1ZXN0aW9uLnF1ZXN0aW9uXHJcbiAgICApIHtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMucHJhY3RpY2VTZXNzaW9uLnR1cm5zLnB1c2goe1xyXG4gICAgICBpZDogY3J5cHRvLnJhbmRvbVVVSUQoKSxcclxuICAgICAgY29uY2VwdDogcXVlc3Rpb24uY29uY2VwdCxcclxuICAgICAgcXVlc3Rpb246IHF1ZXN0aW9uLnF1ZXN0aW9uLFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFjY2VwdFByYWN0aWNlRXZhbHVhdGlvbihcclxuICAgIGV2YWx1YXRpb246IFByYWN0aWNlRXZhbHVhdGlvbixcclxuICAgIGFuc3dlcjogc3RyaW5nLFxyXG4gICk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLnByYWN0aWNlU2Vzc2lvbikgcmV0dXJuO1xyXG5cclxuICAgIGNvbnN0IGN1cnJlbnQgPVxyXG4gICAgICB0aGlzLnByYWN0aWNlU2Vzc2lvbi50dXJuc1tcclxuICAgICAgICB0aGlzLnByYWN0aWNlU2Vzc2lvbi50dXJucy5sZW5ndGggLSAxXHJcbiAgICAgIF07XHJcblxyXG4gICAgaWYgKGN1cnJlbnQpIHtcclxuICAgICAgY3VycmVudC5hbnN3ZXIgPSBhbnN3ZXI7XHJcbiAgICAgIGN1cnJlbnQuZXZhbHVhdGlvbiA9IGV2YWx1YXRpb247XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5wcmFjdGljZVNlc3Npb24uY29uY2VwdCA9IGV2YWx1YXRpb24uY29uY2VwdDtcclxuXHJcbiAgICBpZiAoZXZhbHVhdGlvbi5uZXh0UXVlc3Rpb24/LnRyaW0oKSkge1xyXG4gICAgICB0aGlzLnByYWN0aWNlU2Vzc2lvbi5zdGF0ZSA9IFwid2FpdGluZy1hbnN3ZXJcIjtcclxuICAgICAgdGhpcy5wcmFjdGljZVNlc3Npb24uY3VycmVudFF1ZXN0aW9uID1cclxuICAgICAgICBldmFsdWF0aW9uLm5leHRRdWVzdGlvbi50cmltKCk7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICB0aGlzLnByYWN0aWNlU2Vzc2lvbi5zdGF0ZSA9IFwiY29tcGxldGVcIjtcclxuICAgICAgdGhpcy5wcmFjdGljZVNlc3Npb24uY3VycmVudFF1ZXN0aW9uID0gdW5kZWZpbmVkO1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgQXBwLCBNYXJrZG93blZpZXcsIFRGaWxlIH0gZnJvbSBcIm9ic2lkaWFuXCI7XHJcbmltcG9ydCB7IEFwcGx5UmVzdWx0LCBFZGl0UHJvcG9zYWwgfSBmcm9tIFwiLi4vdHlwZXNcIjtcclxuXHJcbmZ1bmN0aW9uIGZpbmRPY2N1cnJlbmNlcyhjb250ZW50OiBzdHJpbmcsIG5lZWRsZTogc3RyaW5nKTogbnVtYmVyW10ge1xyXG4gIGlmICghbmVlZGxlKSByZXR1cm4gW107XHJcblxyXG4gIGNvbnN0IG1hdGNoZXM6IG51bWJlcltdID0gW107XHJcbiAgbGV0IGN1cnNvciA9IDA7XHJcblxyXG4gIHdoaWxlIChjdXJzb3IgPD0gY29udGVudC5sZW5ndGggLSBuZWVkbGUubGVuZ3RoKSB7XHJcbiAgICBjb25zdCBpbmRleCA9IGNvbnRlbnQuaW5kZXhPZihuZWVkbGUsIGN1cnNvcik7XHJcbiAgICBpZiAoaW5kZXggPT09IC0xKSBicmVhaztcclxuXHJcbiAgICBtYXRjaGVzLnB1c2goaW5kZXgpO1xyXG4gICAgY3Vyc29yID0gaW5kZXggKyBuZWVkbGUubGVuZ3RoO1xyXG4gIH1cclxuXHJcbiAgcmV0dXJuIG1hdGNoZXM7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBPd25zIHVzZXItYXBwcm92ZWQgTWFya2Rvd24gbXV0YXRpb25zLlxyXG4gKlxyXG4gKiBBZ2VudCBvdXRwdXQgaXMgb25seSBhIHByb3Bvc2FsLiBUaGlzIHNlcnZpY2UgcmV2YWxpZGF0ZXMgdGhlIHRhcmdldCBhdFxyXG4gKiBhcHBseS10aW1lIGFuZCByZWZ1c2VzIHN0YWxlIG9yIGFtYmlndW91cyByZXBsYWNlbWVudHMuXHJcbiAqL1xyXG5leHBvcnQgY2xhc3MgTXV0YXRpb25TZXJ2aWNlIHtcclxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGFwcDogQXBwKSB7fVxyXG5cclxuICBhc3luYyBhcHBseShcbiAgICBwcm9wb3NhbDogRWRpdFByb3Bvc2FsLFxuICAgIGFsbG93ZWRGaWxlczogcmVhZG9ubHkgc3RyaW5nW10sXG4gICk6IFByb21pc2U8QXBwbHlSZXN1bHQ+IHtcbiAgICBpZiAoIWFsbG93ZWRGaWxlcy5pbmNsdWRlcyhwcm9wb3NhbC5maWxlKSkge1xuICAgICAgcmV0dXJuIHtcbiAgICAgICAgb2s6IGZhbHNlLFxuICAgICAgICByZWFzb246IFwidW5hdXRob3JpemVkXCIsXG4gICAgICAgIG1lc3NhZ2U6IFwiVGhpcyBlZGl0IHRhcmdldHMgYSBub3RlIG91dHNpZGUgdGhlIGFwcHJvdmVkIHR1cm4gY29udGV4dC5cIixcbiAgICAgIH07XG4gICAgfVxuXG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEZpbGVCeVBhdGgocHJvcG9zYWwuZmlsZSk7XHJcblxyXG4gICAgaWYgKCFmaWxlIHx8ICEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIG9rOiBmYWxzZSxcclxuICAgICAgICByZWFzb246IFwibWlzc2luZy1maWxlXCIsXHJcbiAgICAgICAgbWVzc2FnZTogYFRhcmdldCBub3RlIG5vdCBmb3VuZDogJHtwcm9wb3NhbC5maWxlfWAsXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgYWN0aXZlRmlsZSA9IHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVGaWxlKCk7XHJcbiAgICAgIGNvbnN0IGFjdGl2ZVZpZXcgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlVmlld09mVHlwZShNYXJrZG93blZpZXcpO1xyXG5cclxuICAgICAgaWYgKGFjdGl2ZUZpbGU/LnBhdGggPT09IGZpbGUucGF0aCAmJiBhY3RpdmVWaWV3Py5lZGl0b3IpIHtcclxuICAgICAgICBjb25zdCBlZGl0b3IgPSBhY3RpdmVWaWV3LmVkaXRvcjtcclxuICAgICAgICBjb25zdCBjb250ZW50ID0gZWRpdG9yLmdldFZhbHVlKCk7XHJcbiAgICAgICAgY29uc3QgbWF0Y2hlcyA9IGZpbmRPY2N1cnJlbmNlcyhjb250ZW50LCBwcm9wb3NhbC5vcmlnaW5hbCk7XHJcblxyXG4gICAgICAgIGlmIChtYXRjaGVzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgb2s6IGZhbHNlLFxyXG4gICAgICAgICAgICByZWFzb246IFwic3RhbGVcIixcclxuICAgICAgICAgICAgbWVzc2FnZTogXCJOb3RlIGNoYW5nZWQgc2luY2UgdGhlIHByb3Bvc2FsIHdhcyBtYWRlLiBSZWdlbmVyYXRlIHRoZSBlZGl0LlwiLFxyXG4gICAgICAgICAgfTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChtYXRjaGVzLmxlbmd0aCA+IDEpIHtcclxuICAgICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICAgIG9rOiBmYWxzZSxcclxuICAgICAgICAgICAgcmVhc29uOiBcImFtYmlndW91c1wiLFxyXG4gICAgICAgICAgICBtZXNzYWdlOiBcIlRoZSBvcmlnaW5hbCB0ZXh0IG9jY3VycyBtb3JlIHRoYW4gb25jZS4gUmVnZW5lcmF0ZSB3aXRoIGEgbW9yZSBzcGVjaWZpYyBzZWxlY3Rpb24uXCIsXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgaW5kZXggPSBtYXRjaGVzWzBdO1xyXG4gICAgICAgIGNvbnN0IGZyb20gPSBlZGl0b3Iub2Zmc2V0VG9Qb3MoaW5kZXgpO1xyXG4gICAgICAgIGNvbnN0IHRvID0gZWRpdG9yLm9mZnNldFRvUG9zKGluZGV4ICsgcHJvcG9zYWwub3JpZ2luYWwubGVuZ3RoKTtcclxuXHJcbiAgICAgICAgZWRpdG9yLnJlcGxhY2VSYW5nZShwcm9wb3NhbC5yZXBsYWNlbWVudCwgZnJvbSwgdG8pO1xyXG4gICAgICAgIHJldHVybiB7IG9rOiB0cnVlIH07XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xyXG4gICAgICBjb25zdCBtYXRjaGVzID0gZmluZE9jY3VycmVuY2VzKGNvbnRlbnQsIHByb3Bvc2FsLm9yaWdpbmFsKTtcclxuXHJcbiAgICAgIGlmIChtYXRjaGVzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBvazogZmFsc2UsXHJcbiAgICAgICAgICByZWFzb246IFwic3RhbGVcIixcclxuICAgICAgICAgIG1lc3NhZ2U6IFwiTm90ZSBjaGFuZ2VkIHNpbmNlIHRoZSBwcm9wb3NhbCB3YXMgbWFkZS4gUmVnZW5lcmF0ZSB0aGUgZWRpdC5cIixcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAobWF0Y2hlcy5sZW5ndGggPiAxKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIG9rOiBmYWxzZSxcclxuICAgICAgICAgIHJlYXNvbjogXCJhbWJpZ3VvdXNcIixcclxuICAgICAgICAgIG1lc3NhZ2U6IFwiVGhlIG9yaWdpbmFsIHRleHQgb2NjdXJzIG1vcmUgdGhhbiBvbmNlLiBSZWdlbmVyYXRlIHdpdGggYSBtb3JlIHNwZWNpZmljIHNlbGVjdGlvbi5cIixcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCBpbmRleCA9IG1hdGNoZXNbMF07XHJcbiAgICAgIGNvbnN0IG5leHQgPVxyXG4gICAgICAgIGNvbnRlbnQuc2xpY2UoMCwgaW5kZXgpICtcclxuICAgICAgICBwcm9wb3NhbC5yZXBsYWNlbWVudCArXHJcbiAgICAgICAgY29udGVudC5zbGljZShpbmRleCArIHByb3Bvc2FsLm9yaWdpbmFsLmxlbmd0aCk7XHJcblxyXG4gICAgICBhd2FpdCB0aGlzLmFwcC52YXVsdC5tb2RpZnkoZmlsZSwgbmV4dCk7XHJcbiAgICAgIHJldHVybiB7IG9rOiB0cnVlIH07XHJcbiAgICB9IGNhdGNoIChlcnIpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBvazogZmFsc2UsXHJcbiAgICAgICAgcmVhc29uOiBcImVycm9yXCIsXHJcbiAgICAgICAgbWVzc2FnZTogZXJyIGluc3RhbmNlb2YgRXJyb3IgPyBlcnIubWVzc2FnZSA6IFN0cmluZyhlcnIpLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgQXBwLCBURmlsZSB9IGZyb20gXCJvYnNpZGlhblwiO1xyXG5pbXBvcnQge1xyXG4gIERFRkFVTFRfTEVBUk5JTkdfU1RBVEUsXHJcbiAgTGVhcm5pbmdFdmlkZW5jZSxcclxuICBMZWFybmluZ1N0YXRlLFxyXG59IGZyb20gXCIuLi9sZWFybmluZy9sZWFybmluZy1zdGF0ZVwiO1xyXG5pbXBvcnQgeyBQcmFjdGljZUV2YWx1YXRpb24gfSBmcm9tIFwiLi4vbGVhcm5pbmcvcHJhY3RpY2UtdHlwZXNcIjtcclxuaW1wb3J0IHsgUmV2aWV3RmluZGluZyB9IGZyb20gXCIuLi9sZWFybmluZy9yZXZpZXctdHlwZXNcIjtcclxuXHJcbmNvbnN0IFJPT1QgPSBcIjAwLWxlYXJuaW5nLW9zXCI7XHJcbmNvbnN0IFBST0dSRVNTX1BBVEggPSBgJHtST09UfS9wcm9ncmVzcy5qc29uYDtcclxuXHJcbmZ1bmN0aW9uIGNsb25lRGVmYXVsdFN0YXRlKCk6IExlYXJuaW5nU3RhdGUge1xyXG4gIHJldHVybiB7XHJcbiAgICAuLi5ERUZBVUxUX0xFQVJOSU5HX1NUQVRFLFxyXG4gICAgZ2FwczogW10sXHJcbiAgICBldmlkZW5jZTogW10sXHJcbiAgfTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNMZWFybmluZ1N0YXRlKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgTGVhcm5pbmdTdGF0ZSB7XHJcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZTtcclxuICBjb25zdCBvYmogPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcclxuXHJcbiAgcmV0dXJuIChcclxuICAgIG9iai52ZXJzaW9uID09PSAxICYmXHJcbiAgICAob2JqLnRhcmdldCA9PT0gbnVsbCB8fCB0eXBlb2Ygb2JqLnRhcmdldCA9PT0gXCJzdHJpbmdcIikgJiZcclxuICAgIEFycmF5LmlzQXJyYXkob2JqLmdhcHMpICYmXHJcbiAgICBBcnJheS5pc0FycmF5KG9iai5ldmlkZW5jZSlcclxuICApO1xyXG59XHJcblxyXG5mdW5jdGlvbiBub3JtYWxpemUodmFsdWU6IHN0cmluZyk6IHN0cmluZyB7XHJcbiAgcmV0dXJuIHZhbHVlLnRyaW0oKS50b0xvd2VyQ2FzZSgpO1xyXG59XHJcblxyXG4vKipcclxuICogRHVyYWJsZSBMZWFybmluZyBPUyBzdGF0ZSBzdG9yZWQgaW5zaWRlIHRoZSB2YXVsdCBzbyBwcm9ncmVzcyB0cmF2ZWxzIHdpdGhcclxuICogdGhlIHZhdWx0IGluc3RlYWQgb2YgYmVpbmcgdHJhcHBlZCBpbiBPYnNpZGlhbiBwbHVnaW4gZGF0YS5cclxuICovXHJcbmV4cG9ydCBjbGFzcyBWYXVsdExlYXJuaW5nU3RvcmUge1xyXG4gIGNvbnN0cnVjdG9yKHByaXZhdGUgcmVhZG9ubHkgYXBwOiBBcHApIHt9XHJcblxyXG4gIGFzeW5jIGxvYWQoKTogUHJvbWlzZTxMZWFybmluZ1N0YXRlPiB7XHJcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0RmlsZUJ5UGF0aChQUk9HUkVTU19QQVRIKTtcclxuICAgIGlmICghZmlsZSB8fCAhKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcclxuICAgICAgcmV0dXJuIGNsb25lRGVmYXVsdFN0YXRlKCk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcmF3ID0gYXdhaXQgdGhpcy5hcHAudmF1bHQuY2FjaGVkUmVhZChmaWxlKTtcclxuXHJcbiAgICBsZXQgcGFyc2VkOiB1bmtub3duO1xyXG4gICAgdHJ5IHtcclxuICAgICAgcGFyc2VkID0gSlNPTi5wYXJzZShyYXcpO1xyXG4gICAgfSBjYXRjaCB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcclxuICAgICAgICBgTGVhcm5pbmcgc3RhdGUgaXMgaW52YWxpZCBKU09OOiAke1BST0dSRVNTX1BBVEh9YCxcclxuICAgICAgKTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoIWlzTGVhcm5pbmdTdGF0ZShwYXJzZWQpKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcclxuICAgICAgICBgTGVhcm5pbmcgc3RhdGUgaGFzIGFuIHVuc3VwcG9ydGVkIHNoYXBlOiAke1BST0dSRVNTX1BBVEh9YCxcclxuICAgICAgKTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gcGFyc2VkO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgc2F2ZShzdGF0ZTogTGVhcm5pbmdTdGF0ZSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSb290KCk7XHJcblxyXG4gICAgY29uc3QgY29udGVudCA9IEpTT04uc3RyaW5naWZ5KHN0YXRlLCBudWxsLCAyKSArIFwiXFxuXCI7XHJcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0RmlsZUJ5UGF0aChQUk9HUkVTU19QQVRIKTtcclxuXHJcbiAgICBpZiAoZmlsZSAmJiBmaWxlIGluc3RhbmNlb2YgVEZpbGUpIHtcclxuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQubW9kaWZ5KGZpbGUsIGNvbnRlbnQpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlKFBST0dSRVNTX1BBVEgsIGNvbnRlbnQpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgcmVjb3JkUHJhY3RpY2VFdmFsdWF0aW9uKGlucHV0OiB7XHJcbiAgICBldmFsdWF0aW9uOiBQcmFjdGljZUV2YWx1YXRpb247XHJcbiAgICBzb3VyY2U6IHN0cmluZztcclxuICB9KTogUHJvbWlzZTxMZWFybmluZ1N0YXRlPiB7XHJcbiAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IHRoaXMubG9hZCgpO1xyXG5cclxuICAgIGNvbnN0IGV2aWRlbmNlOiBMZWFybmluZ0V2aWRlbmNlID0ge1xyXG4gICAgICBpZDogY3J5cHRvLnJhbmRvbVVVSUQoKSxcclxuICAgICAgdHlwZTogXCJwcmFjdGljZVwiLFxyXG4gICAgICBjb25jZXB0OiBpbnB1dC5ldmFsdWF0aW9uLmNvbmNlcHQsXHJcbiAgICAgIHNvdXJjZTogaW5wdXQuc291cmNlLFxyXG4gICAgICBvdXRjb21lOiBpbnB1dC5ldmFsdWF0aW9uLm91dGNvbWUsXHJcbiAgICAgIGNyZWF0ZWRBdDogRGF0ZS5ub3coKSxcclxuICAgIH07XHJcblxyXG4gICAgc3RhdGUuZXZpZGVuY2UucHVzaChldmlkZW5jZSk7XHJcbiAgICBzdGF0ZS5jdXJyZW50VG9waWMgPSBpbnB1dC5ldmFsdWF0aW9uLmNvbmNlcHQ7XHJcblxyXG4gICAgZm9yIChjb25zdCBtaXNjb25jZXB0aW9uIG9mIGlucHV0LmV2YWx1YXRpb24ubWlzY29uY2VwdGlvbnMpIHtcclxuICAgICAgY29uc3QgZXhpc3RpbmcgPSBzdGF0ZS5nYXBzLmZpbmQoXHJcbiAgICAgICAgKGdhcCkgPT5cclxuICAgICAgICAgIG5vcm1hbGl6ZShnYXAuY29uY2VwdCkgPT09IG5vcm1hbGl6ZShpbnB1dC5ldmFsdWF0aW9uLmNvbmNlcHQpICYmXHJcbiAgICAgICAgICBub3JtYWxpemUoZ2FwLnJlYXNvbikgPT09IG5vcm1hbGl6ZShtaXNjb25jZXB0aW9uKSxcclxuICAgICAgKTtcclxuXHJcbiAgICAgIGlmIChleGlzdGluZykge1xyXG4gICAgICAgIGlmICghZXhpc3RpbmcuZXZpZGVuY2VJZHMuaW5jbHVkZXMoZXZpZGVuY2UuaWQpKSB7XHJcbiAgICAgICAgICBleGlzdGluZy5ldmlkZW5jZUlkcy5wdXNoKGV2aWRlbmNlLmlkKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZXhpc3Rpbmcuc3RhdHVzID0gXCJvcGVuXCI7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgc3RhdGUuZ2Fwcy5wdXNoKHtcclxuICAgICAgICAgIGlkOiBjcnlwdG8ucmFuZG9tVVVJRCgpLFxyXG4gICAgICAgICAgY29uY2VwdDogaW5wdXQuZXZhbHVhdGlvbi5jb25jZXB0LFxyXG4gICAgICAgICAgcmVhc29uOiBtaXNjb25jZXB0aW9uLFxyXG4gICAgICAgICAgZXZpZGVuY2VJZHM6IFtldmlkZW5jZS5pZF0sXHJcbiAgICAgICAgICBzdGF0dXM6IFwib3BlblwiLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKFxyXG4gICAgICBpbnB1dC5ldmFsdWF0aW9uLm91dGNvbWUgPT09IFwiY29ycmVjdFwiICYmXHJcbiAgICAgIGlucHV0LmV2YWx1YXRpb24ubWlzY29uY2VwdGlvbnMubGVuZ3RoID09PSAwXHJcbiAgICApIHtcclxuICAgICAgZm9yIChjb25zdCBnYXAgb2Ygc3RhdGUuZ2Fwcykge1xyXG4gICAgICAgIGlmIChcclxuICAgICAgICAgIG5vcm1hbGl6ZShnYXAuY29uY2VwdCkgPT09XHJcbiAgICAgICAgICAgIG5vcm1hbGl6ZShpbnB1dC5ldmFsdWF0aW9uLmNvbmNlcHQpICYmXHJcbiAgICAgICAgICBnYXAuc3RhdHVzID09PSBcIm9wZW5cIlxyXG4gICAgICAgICkge1xyXG4gICAgICAgICAgLy8gT25lIGdvb2QgYW5zd2VyIGlzIGV2aWRlbmNlIG9mIGltcHJvdmVtZW50LCBub3QgcHJvb2Ygb2YgbWFzdGVyeS5cclxuICAgICAgICAgIGdhcC5zdGF0dXMgPSBcImltcHJvdmluZ1wiO1xyXG4gICAgICAgICAgZ2FwLmV2aWRlbmNlSWRzLnB1c2goZXZpZGVuY2UuaWQpO1xyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGF3YWl0IHRoaXMuc2F2ZShzdGF0ZSk7XHJcbiAgICByZXR1cm4gc3RhdGU7XHJcbiAgfVxyXG5cclxuICBhc3luYyByZWNvcmRSZXZpZXdGaW5kaW5ncyhpbnB1dDoge1xyXG4gICAgZmluZGluZ3M6IFJldmlld0ZpbmRpbmdbXTtcclxuICAgIHNvdXJjZTogc3RyaW5nO1xyXG4gIH0pOiBQcm9taXNlPExlYXJuaW5nU3RhdGU+IHtcclxuICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgdGhpcy5sb2FkKCk7XHJcbiAgICBpZiAoaW5wdXQuZmluZGluZ3MubGVuZ3RoID09PSAwKSByZXR1cm4gc3RhdGU7XHJcblxyXG4gICAgZm9yIChjb25zdCBmaW5kaW5nIG9mIGlucHV0LmZpbmRpbmdzKSB7XHJcbiAgICAgIGNvbnN0IGV2aWRlbmNlOiBMZWFybmluZ0V2aWRlbmNlID0ge1xyXG4gICAgICAgIGlkOiBjcnlwdG8ucmFuZG9tVVVJRCgpLFxyXG4gICAgICAgIHR5cGU6IFwicmV2aWV3XCIsXHJcbiAgICAgICAgY29uY2VwdDogZmluZGluZy5jb25jZXB0LFxyXG4gICAgICAgIHNvdXJjZTogaW5wdXQuc291cmNlLFxyXG4gICAgICAgIG91dGNvbWU6IGZpbmRpbmcua2luZCxcclxuICAgICAgICBjcmVhdGVkQXQ6IERhdGUubm93KCksXHJcbiAgICAgIH07XHJcbiAgICAgIHN0YXRlLmV2aWRlbmNlLnB1c2goZXZpZGVuY2UpO1xyXG4gICAgICBzdGF0ZS5jdXJyZW50VG9waWMgPSBmaW5kaW5nLmNvbmNlcHQ7XHJcblxyXG4gICAgICBjb25zdCBleGlzdGluZyA9IHN0YXRlLmdhcHMuZmluZChcclxuICAgICAgICAoZ2FwKSA9PlxyXG4gICAgICAgICAgbm9ybWFsaXplKGdhcC5jb25jZXB0KSA9PT0gbm9ybWFsaXplKGZpbmRpbmcuY29uY2VwdCkgJiZcclxuICAgICAgICAgIG5vcm1hbGl6ZShnYXAucmVhc29uKSA9PT0gbm9ybWFsaXplKGZpbmRpbmcuZGV0YWlsKSxcclxuICAgICAgKTtcclxuXHJcbiAgICAgIGlmIChleGlzdGluZykge1xyXG4gICAgICAgIGlmICghZXhpc3RpbmcuZXZpZGVuY2VJZHMuaW5jbHVkZXMoZXZpZGVuY2UuaWQpKSB7XHJcbiAgICAgICAgICBleGlzdGluZy5ldmlkZW5jZUlkcy5wdXNoKGV2aWRlbmNlLmlkKTtcclxuICAgICAgICB9XHJcbiAgICAgICAgZXhpc3Rpbmcuc3RhdHVzID0gXCJvcGVuXCI7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgc3RhdGUuZ2Fwcy5wdXNoKHtcclxuICAgICAgICAgIGlkOiBjcnlwdG8ucmFuZG9tVVVJRCgpLFxyXG4gICAgICAgICAgY29uY2VwdDogZmluZGluZy5jb25jZXB0LFxyXG4gICAgICAgICAgcmVhc29uOiBmaW5kaW5nLmRldGFpbCxcclxuICAgICAgICAgIGV2aWRlbmNlSWRzOiBbZXZpZGVuY2UuaWRdLFxyXG4gICAgICAgICAgc3RhdHVzOiBcIm9wZW5cIixcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGF3YWl0IHRoaXMuc2F2ZShzdGF0ZSk7XHJcbiAgICByZXR1cm4gc3RhdGU7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGVuc3VyZVJvb3QoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBleGlzdGluZyA9IHRoaXMuYXBwLnZhdWx0LmdldEFic3RyYWN0RmlsZUJ5UGF0aChST09UKTtcclxuICAgIGlmIChleGlzdGluZykgcmV0dXJuO1xyXG5cclxuICAgIGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNyZWF0ZUZvbGRlcihST09UKTtcclxuICB9XHJcbn1cclxuIiwgImV4cG9ydCBpbnRlcmZhY2UgS25vd2xlZGdlR2FwIHtcclxuICBpZDogc3RyaW5nO1xyXG4gIGNvbmNlcHQ6IHN0cmluZztcclxuICByZWFzb246IHN0cmluZztcclxuICBldmlkZW5jZUlkczogc3RyaW5nW107XHJcbiAgc3RhdHVzOiBcIm9wZW5cIiB8IFwiaW1wcm92aW5nXCIgfCBcInJlc29sdmVkXCI7XHJcbn1cclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgTGVhcm5pbmdFdmlkZW5jZSB7XHJcbiAgaWQ6IHN0cmluZztcclxuICB0eXBlOiBcInByYWN0aWNlXCIgfCBcInJldmlld1wiIHwgXCJwcm9qZWN0XCI7XHJcbiAgY29uY2VwdDogc3RyaW5nO1xyXG4gIHNvdXJjZTogc3RyaW5nO1xyXG4gIG91dGNvbWU/OiBzdHJpbmc7XHJcbiAgY3JlYXRlZEF0OiBudW1iZXI7XHJcbn1cclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgTGVhcm5pbmdTdGF0ZSB7XHJcbiAgdmVyc2lvbjogMTtcclxuICB0YXJnZXQ6IHN0cmluZyB8IG51bGw7XHJcbiAgY3VycmVudFRvcGljPzogc3RyaW5nO1xyXG4gIGdhcHM6IEtub3dsZWRnZUdhcFtdO1xyXG4gIGV2aWRlbmNlOiBMZWFybmluZ0V2aWRlbmNlW107XHJcbn1cclxuXHJcbmV4cG9ydCBjb25zdCBERUZBVUxUX0xFQVJOSU5HX1NUQVRFOiBMZWFybmluZ1N0YXRlID0ge1xyXG4gIHZlcnNpb246IDEsXHJcbiAgdGFyZ2V0OiBudWxsLFxyXG4gIGdhcHM6IFtdLFxyXG4gIGV2aWRlbmNlOiBbXSxcclxufTtcclxuIiwgImltcG9ydCB7IFBsdWdpbiB9IGZyb20gXCJvYnNpZGlhblwiO1xyXG5pbXBvcnQgeyBTZXNzaW9uU3RvcmUgfSBmcm9tIFwiLi9TZXNzaW9uU3RvcmVcIjtcclxuaW1wb3J0IHtcclxuICBBZ2VudEFkYXB0ZXIsXG4gIEFnZW50SGVhbHRoLFxuICBBZ2VudENvbnRleHQsXHJcbiAgQWdlbnRJbnB1dCxcclxuICBBZ2VudE1vZGVsLFxuICBBZ2VudFN0cmVhbUV2ZW50LFxuICBDaGF0U2Vzc2lvbixcclxufSBmcm9tIFwiLi4vdHlwZXNcIjtcclxuXHJcbi8qKlxyXG4gKiBPd25zIGNoYXQvYWdlbnQgY29udmVyc2F0aW9uIHBlcnNpc3RlbmNlIG9ubHkuXHJcbiAqXHJcbiAqIExlYXJuaW5nIG9yY2hlc3RyYXRpb24sIGNvbnRleHQgcmVzb2x1dGlvbiwgYW5kIE1hcmtkb3duIG11dGF0aW9uIGxpdmUgYWJvdmVcclxuICogb3IgYmVzaWRlIHRoaXMgY2xhc3MuIFRoaXMga2VlcHMgc2Vzc2lvbiBzdGF0ZSBpbmRlcGVuZGVudCBvZiBMZWFybmluZyBPU1xyXG4gKiBiZWhhdmlvci5cclxuICovXHJcbmV4cG9ydCBjbGFzcyBTZXNzaW9uQ29udHJvbGxlciB7XHJcbiAgcHJpdmF0ZSBjdXJyZW50U2Vzc2lvbjogQ2hhdFNlc3Npb24gfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIG1vZGVsczogQWdlbnRNb2RlbFtdID0gW107XG5cclxuICBjb25zdHJ1Y3RvcihcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luOiBQbHVnaW4sXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IHN0b3JlOiBTZXNzaW9uU3RvcmUsXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IGFkYXB0ZXI6IEFnZW50QWRhcHRlcixcclxuICApIHt9XHJcblxyXG4gIGFzeW5jIGluaXQoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBkYXRhID0gYXdhaXQgdGhpcy5wbHVnaW4ubG9hZERhdGEoKTtcclxuICAgIGF3YWl0IHRoaXMuc3RvcmUubG9hZChkYXRhKTtcclxuXHJcbiAgICB0aGlzLmN1cnJlbnRTZXNzaW9uID0gdGhpcy5zdG9yZS5nZXRDdXJyZW50U2Vzc2lvbigpO1xyXG4gICAgaWYgKCF0aGlzLmN1cnJlbnRTZXNzaW9uKSB7XHJcbiAgICAgIHRoaXMuY3VycmVudFNlc3Npb24gPSB0aGlzLnN0b3JlLmNyZWF0ZVNlc3Npb24odGhpcy5zdG9yZS5nZXREZWZhdWx0TW9kZWwoKSk7XHJcbiAgICB9XHJcblxyXG4gICAgdHJ5IHtcbiAgICAgIHRoaXMubW9kZWxzID0gYXdhaXQgdGhpcy5hZGFwdGVyLmxpc3RNb2RlbHMoKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHRoaXMubW9kZWxzID0gW107XG4gICAgfVxuICB9XG5cbiAgY2hlY2tSdW50aW1lKCk6IFByb21pc2U8QWdlbnRIZWFsdGg+IHtcbiAgICByZXR1cm4gdGhpcy5hZGFwdGVyLmNoZWNrKCk7XG4gIH1cclxuXHJcbiAgZ2V0U2Vzc2lvbigpOiBDaGF0U2Vzc2lvbiB7XHJcbiAgICBpZiAoIXRoaXMuY3VycmVudFNlc3Npb24pIHRocm93IG5ldyBFcnJvcihcIlNlc3Npb24gbm90IGluaXRpYWxpemVkXCIpO1xyXG4gICAgcmV0dXJuIHRoaXMuY3VycmVudFNlc3Npb247XHJcbiAgfVxyXG5cclxuICBhc3luYyBuZXdTZXNzaW9uKCk6IFByb21pc2U8Q2hhdFNlc3Npb24+IHtcclxuICAgIGNvbnN0IG1vZGVsID0gdGhpcy5jdXJyZW50U2Vzc2lvbj8ubW9kZWwgPz8gdGhpcy5zdG9yZS5nZXREZWZhdWx0TW9kZWwoKTtcclxuICAgIHRoaXMuY3VycmVudFNlc3Npb24gPSB0aGlzLnN0b3JlLmNyZWF0ZVNlc3Npb24obW9kZWwpO1xyXG4gICAgYXdhaXQgdGhpcy5zYXZlKCk7XHJcbiAgICByZXR1cm4gdGhpcy5jdXJyZW50U2Vzc2lvbjtcclxuICB9XHJcblxyXG4gIHNldE1vZGVsKG1vZGVsSWQ/OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbW9kZWxJZCB8fCB1bmRlZmluZWQ7XG4gICAgdGhpcy5zdG9yZS5zZXREZWZhdWx0TW9kZWwobm9ybWFsaXplZCk7XG5cbiAgICBpZiAodGhpcy5jdXJyZW50U2Vzc2lvbikge1xuICAgICAgdGhpcy5jdXJyZW50U2Vzc2lvbi5tb2RlbCA9IG5vcm1hbGl6ZWQ7XG4gICAgICB0aGlzLnN0b3JlLnVwZGF0ZVNlc3Npb24odGhpcy5jdXJyZW50U2Vzc2lvbik7XHJcbiAgICAgIHZvaWQgdGhpcy5zYXZlKCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBnZXRNb2RlbHMoKTogQWdlbnRNb2RlbFtdIHtcbiAgICByZXR1cm4gdGhpcy5tb2RlbHM7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBFeGVjdXRlIG9uZSBwcmVwYXJlZCBhZ2VudCB0dXJuLlxyXG4gICAqXHJcbiAgICogQ29udGV4dCBpcyBhbHJlYWR5IHJlc29sdmVkIGJ5IExlYXJuaW5nQ29udHJvbGxlci4gZGlzcGxheVByb21wdCBpcyB0aGUgcmF3XHJcbiAgICogdXNlciB0ZXh0IHN0b3JlZCBpbiBsb2NhbCBoaXN0b3J5IHNvIGludGVybmFsIGxlYXJuaW5nIGluc3RydWN0aW9ucyBkbyBub3RcclxuICAgKiBsZWFrIGludG8gdGhlIHZpc2libGUvc2Vzc2lvbiB0cmFuc2NyaXB0LlxyXG4gICAqL1xyXG4gIGFzeW5jICpzZW5kVHVybihcbiAgICBwcm9tcHQ6IHN0cmluZyxcbiAgICBjb250ZXh0OiBBZ2VudENvbnRleHRbXSxcbiAgICBkaXNwbGF5UHJvbXB0OiBzdHJpbmcsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgKTogQXN5bmNJdGVyYWJsZTxBZ2VudFN0cmVhbUV2ZW50PiB7XG4gICAgY29uc3Qgc2Vzc2lvbiA9IHRoaXMuZ2V0U2Vzc2lvbigpO1xyXG4gICAgY29uc3QgaW5wdXQ6IEFnZW50SW5wdXQgPSB7IHByb21wdCwgY29udGV4dCB9O1xyXG5cclxuICAgIHNlc3Npb24ubWVzc2FnZXMucHVzaCh7XHJcbiAgICAgIHJvbGU6IFwidXNlclwiLFxyXG4gICAgICBjb250ZW50OiBkaXNwbGF5UHJvbXB0LFxyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5zdG9yZS51cGRhdGVTZXNzaW9uKHNlc3Npb24pO1xuICAgIGF3YWl0IHRoaXMuc2F2ZSgpO1xuXG4gICAgZm9yIGF3YWl0IChjb25zdCBldmVudCBvZiB0aGlzLmFkYXB0ZXIuc2VuZChpbnB1dCwge1xuICAgICAgbW9kZWw6IHNlc3Npb24ubW9kZWwsXG4gICAgICBjb252ZXJzYXRpb25JZDogc2Vzc2lvbi5jb252ZXJzYXRpb25JZCxcbiAgICB9LCBzaWduYWwpKSB7XG4gICAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJjb21wbGV0ZWRcIiAmJiBldmVudC5jb252ZXJzYXRpb25JZCkge1xuICAgICAgICBzZXNzaW9uLmNvbnZlcnNhdGlvbklkID0gZXZlbnQuY29udmVyc2F0aW9uSWQ7XG4gICAgICB9XG5cclxuICAgICAgeWllbGQgZXZlbnQ7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5zdG9yZS51cGRhdGVTZXNzaW9uKHNlc3Npb24pO1xuICAgIGF3YWl0IHRoaXMuc2F2ZSgpO1xuICB9XG5cbiAgYXN5bmMgcmVjb3JkQXNzaXN0YW50TWVzc2FnZShjb250ZW50OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWNvbnRlbnQudHJpbSgpKSByZXR1cm47XG4gICAgY29uc3Qgc2Vzc2lvbiA9IHRoaXMuZ2V0U2Vzc2lvbigpO1xuICAgIHNlc3Npb24ubWVzc2FnZXMucHVzaCh7IHJvbGU6IFwiYXNzaXN0YW50XCIsIGNvbnRlbnQgfSk7XG4gICAgdGhpcy5zdG9yZS51cGRhdGVTZXNzaW9uKHNlc3Npb24pO1xuICAgIGF3YWl0IHRoaXMuc2F2ZSgpO1xuICB9XG5cbiAgYXN5bmMgcmVjb3JkUHJvcG9zYWwoXG4gICAgcHJvcG9zYWxJZDogc3RyaW5nLFxuICAgIHByb3Bvc2FsOiBpbXBvcnQoXCIuLi90eXBlc1wiKS5FZGl0UHJvcG9zYWwsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHNlc3Npb24gPSB0aGlzLmdldFNlc3Npb24oKTtcbiAgICBzZXNzaW9uLm1lc3NhZ2VzLnB1c2goe1xuICAgICAgcm9sZTogXCJhc3Npc3RhbnRcIixcbiAgICAgIGNvbnRlbnQ6IFwiXCIsXG4gICAgICBwcm9wb3NhbElkLFxuICAgICAgcHJvcG9zYWwsXG4gICAgICBwcm9wb3NhbFN0YXRlOiBcInBlbmRpbmdcIixcbiAgICB9KTtcbiAgICB0aGlzLnN0b3JlLnVwZGF0ZVNlc3Npb24oc2Vzc2lvbik7XG4gICAgYXdhaXQgdGhpcy5zYXZlKCk7XG4gIH1cblxuICBhc3luYyB1cGRhdGVQcm9wb3NhbFN0YXRlKFxuICAgIHByb3Bvc2FsSWQ6IHN0cmluZyxcbiAgICBzdGF0ZTogXCJhcHBsaWVkXCIgfCBcInJlamVjdGVkXCIgfCBcInN0YWxlXCIsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1lc3NhZ2UgPSB0aGlzLmdldFNlc3Npb24oKS5tZXNzYWdlcy5maW5kKFxuICAgICAgKGl0ZW0pID0+IGl0ZW0ucHJvcG9zYWxJZCA9PT0gcHJvcG9zYWxJZCxcbiAgICApO1xuICAgIGlmICghbWVzc2FnZSkgcmV0dXJuO1xuICAgIG1lc3NhZ2UucHJvcG9zYWxTdGF0ZSA9IHN0YXRlO1xuICAgIHRoaXMuc3RvcmUudXBkYXRlU2Vzc2lvbih0aGlzLmdldFNlc3Npb24oKSk7XG4gICAgYXdhaXQgdGhpcy5zYXZlKCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNhdmUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY3VycmVudCA9IChhd2FpdCB0aGlzLnBsdWdpbi5sb2FkRGF0YSgpKSA/PyB7fTtcbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlRGF0YSh7IC4uLmN1cnJlbnQsIC4uLnRoaXMuc3RvcmUuc2VyaWFsaXplKCkgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBDaGF0U2Vzc2lvbiB9IGZyb20gXCIuLi90eXBlc1wiO1xuXG5jb25zdCBTVE9SRV9LRVkgPSBcImZvcmdlLXNlc3Npb25zXCI7XG5jb25zdCBMRUdBQ1lfU1RPUkVfS0VZID0gXCJhZ3ktc2Vzc2lvbnNcIjtcbmludGVyZmFjZSBTdG9yZURhdGEge1xuICBjdXJyZW50U2Vzc2lvbklkOiBzdHJpbmcgfCBudWxsO1xuICBzZXNzaW9uczogUmVjb3JkPHN0cmluZywgQ2hhdFNlc3Npb24+O1xuICBkZWZhdWx0TW9kZWw/OiBzdHJpbmc7XG59XG5cbi8qKlxuICogU2Vzc2lvblN0b3JlIFx1MjAxNCBwZXJzaXN0cyBzZXNzaW9ucyB0byBPYnNpZGlhbiBwbHVnaW4gZGF0YS5cbiAqXG4gKiBTcGlrZSA1OiBzZXNzaW9ucyBzdXJ2aXZlIE9ic2lkaWFuIHJlc3RhcnRzLlxuICogVGhlIHN0b3JlIGlzIGEgdGhpbiB3cmFwcGVyIGFyb3VuZCBwbHVnaW4ubG9hZERhdGEgLyBwbHVnaW4uc2F2ZURhdGEuXG4gKi9cbmV4cG9ydCBjbGFzcyBTZXNzaW9uU3RvcmUge1xuICBwcml2YXRlIGRhdGE6IFN0b3JlRGF0YSA9IHtcbiAgICBjdXJyZW50U2Vzc2lvbklkOiBudWxsLFxuICAgIHNlc3Npb25zOiB7fSxcbiAgfTtcblxuICAvKiogQ2FsbCBvbmNlIG9uIHBsdWdpbiBsb2FkLiAqL1xuICBhc3luYyBsb2FkKHJhd0RhdGE6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbCk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHN0b3JlZCA9IHJhd0RhdGE/LltTVE9SRV9LRVldID8/IHJhd0RhdGE/LltMRUdBQ1lfU1RPUkVfS0VZXTtcbiAgICBpZiAoIXN0b3JlZCB8fCB0eXBlb2Ygc3RvcmVkICE9PSBcIm9iamVjdFwiKSByZXR1cm47XG5cbiAgICBjb25zdCBjYW5kaWRhdGUgPSBzdG9yZWQgYXMgUGFydGlhbDxTdG9yZURhdGE+O1xuICAgIGNvbnN0IHNlc3Npb25zOiBSZWNvcmQ8c3RyaW5nLCBDaGF0U2Vzc2lvbj4gPSB7fTtcbiAgICBpZiAoY2FuZGlkYXRlLnNlc3Npb25zICYmIHR5cGVvZiBjYW5kaWRhdGUuc2Vzc2lvbnMgPT09IFwib2JqZWN0XCIpIHtcbiAgICAgIGZvciAoY29uc3QgW2lkLCB2YWx1ZV0gb2YgT2JqZWN0LmVudHJpZXMoY2FuZGlkYXRlLnNlc3Npb25zKSkge1xuICAgICAgICBjb25zdCBzZXNzaW9uID0gdGhpcy5kZWNvZGVTZXNzaW9uKHZhbHVlKTtcbiAgICAgICAgaWYgKHNlc3Npb24pIHNlc3Npb25zW2lkXSA9IHNlc3Npb247XG4gICAgICB9XG4gICAgfVxuXG4gICAgdGhpcy5kYXRhID0ge1xuICAgICAgY3VycmVudFNlc3Npb25JZDpcbiAgICAgICAgdHlwZW9mIGNhbmRpZGF0ZS5jdXJyZW50U2Vzc2lvbklkID09PSBcInN0cmluZ1wiXG4gICAgICAgICAgPyBjYW5kaWRhdGUuY3VycmVudFNlc3Npb25JZFxuICAgICAgICAgIDogbnVsbCxcbiAgICAgIHNlc3Npb25zLFxuICAgICAgZGVmYXVsdE1vZGVsOlxuICAgICAgICB0eXBlb2YgY2FuZGlkYXRlLmRlZmF1bHRNb2RlbCA9PT0gXCJzdHJpbmdcIlxuICAgICAgICAgID8gY2FuZGlkYXRlLmRlZmF1bHRNb2RlbFxuICAgICAgICAgIDogdW5kZWZpbmVkLFxuICAgIH07XG4gIH1cblxuICAvKiogU2VyaWFsaXplIHRvIHBsdWdpbiBkYXRhIG9iamVjdC4gKi9cbiAgc2VyaWFsaXplKCk6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHtcbiAgICByZXR1cm4geyBbU1RPUkVfS0VZXTogdGhpcy5kYXRhIH07XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgU2Vzc2lvbiBDUlVEIFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFx1MjUwMFxuXG4gIGNyZWF0ZVNlc3Npb24obW9kZWw/OiBzdHJpbmcpOiBDaGF0U2Vzc2lvbiB7XG4gICAgY29uc3Qgc2Vzc2lvbjogQ2hhdFNlc3Npb24gPSB7XG4gICAgICBpZDogY3J5cHRvLnJhbmRvbVVVSUQoKSxcbiAgICAgIG1vZGVsLFxuICAgICAgbWVzc2FnZXM6IFtdLFxuICAgICAgY3JlYXRlZEF0OiBEYXRlLm5vdygpLFxuICAgICAgdXBkYXRlZEF0OiBEYXRlLm5vdygpLFxuICAgIH07XG4gICAgdGhpcy5kYXRhLnNlc3Npb25zW3Nlc3Npb24uaWRdID0gc2Vzc2lvbjtcbiAgICB0aGlzLmRhdGEuY3VycmVudFNlc3Npb25JZCA9IHNlc3Npb24uaWQ7XG4gICAgcmV0dXJuIHNlc3Npb247XG4gIH1cblxuICBnZXRTZXNzaW9uKGlkOiBzdHJpbmcpOiBDaGF0U2Vzc2lvbiB8IG51bGwge1xuICAgIHJldHVybiB0aGlzLmRhdGEuc2Vzc2lvbnNbaWRdID8/IG51bGw7XG4gIH1cblxuICBnZXRDdXJyZW50U2Vzc2lvbigpOiBDaGF0U2Vzc2lvbiB8IG51bGwge1xuICAgIGlmICghdGhpcy5kYXRhLmN1cnJlbnRTZXNzaW9uSWQpIHJldHVybiBudWxsO1xuICAgIHJldHVybiB0aGlzLmdldFNlc3Npb24odGhpcy5kYXRhLmN1cnJlbnRTZXNzaW9uSWQpO1xuICB9XG5cbiAgdXBkYXRlU2Vzc2lvbihzZXNzaW9uOiBDaGF0U2Vzc2lvbik6IHZvaWQge1xuICAgIHNlc3Npb24udXBkYXRlZEF0ID0gRGF0ZS5ub3coKTtcbiAgICB0aGlzLmRhdGEuc2Vzc2lvbnNbc2Vzc2lvbi5pZF0gPSBzZXNzaW9uO1xuICB9XG5cbiAgc2V0Q3VycmVudFNlc3Npb24oaWQ6IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMuZGF0YS5jdXJyZW50U2Vzc2lvbklkID0gaWQ7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgTW9kZWwgcHJlZmVyZW5jZSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICBnZXREZWZhdWx0TW9kZWwoKTogc3RyaW5nIHwgdW5kZWZpbmVkIHtcbiAgICByZXR1cm4gdGhpcy5kYXRhLmRlZmF1bHRNb2RlbDtcbiAgfVxuXG4gIHNldERlZmF1bHRNb2RlbChtb2RlbD86IHN0cmluZyk6IHZvaWQge1xuICAgIHRoaXMuZGF0YS5kZWZhdWx0TW9kZWwgPSBtb2RlbCB8fCB1bmRlZmluZWQ7XG4gIH1cblxuICAvLyBcdTI1MDBcdTI1MDAgVXRpbGl0eSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcblxuICAvKiogQWxsIHNlc3Npb25zLCBuZXdlc3QgZmlyc3QuICovXG4gIGxpc3RTZXNzaW9ucygpOiBDaGF0U2Vzc2lvbltdIHtcbiAgICByZXR1cm4gT2JqZWN0LnZhbHVlcyh0aGlzLmRhdGEuc2Vzc2lvbnMpLnNvcnQoXG4gICAgICAoYSwgYikgPT4gYi51cGRhdGVkQXQgLSBhLnVwZGF0ZWRBdFxuICAgICk7XG4gIH1cblxuICBwcml2YXRlIGRlY29kZVNlc3Npb24odmFsdWU6IHVua25vd24pOiBDaGF0U2Vzc2lvbiB8IG51bGwge1xuICAgIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gbnVsbDtcbiAgICBjb25zdCBzZXNzaW9uID0gdmFsdWUgYXMgUGFydGlhbDxDaGF0U2Vzc2lvbj47XG4gICAgaWYgKFxuICAgICAgdHlwZW9mIHNlc3Npb24uaWQgIT09IFwic3RyaW5nXCIgfHxcbiAgICAgICFBcnJheS5pc0FycmF5KHNlc3Npb24ubWVzc2FnZXMpIHx8XG4gICAgICB0eXBlb2Ygc2Vzc2lvbi5jcmVhdGVkQXQgIT09IFwibnVtYmVyXCIgfHxcbiAgICAgIHR5cGVvZiBzZXNzaW9uLnVwZGF0ZWRBdCAhPT0gXCJudW1iZXJcIlxuICAgICkge1xuICAgICAgcmV0dXJuIG51bGw7XG4gICAgfVxuXG4gICAgcmV0dXJuIHtcbiAgICAgIGlkOiBzZXNzaW9uLmlkLFxuICAgICAgY29udmVyc2F0aW9uSWQ6XG4gICAgICAgIHR5cGVvZiBzZXNzaW9uLmNvbnZlcnNhdGlvbklkID09PSBcInN0cmluZ1wiXG4gICAgICAgICAgPyBzZXNzaW9uLmNvbnZlcnNhdGlvbklkXG4gICAgICAgICAgOiB1bmRlZmluZWQsXG4gICAgICBtb2RlbDogdHlwZW9mIHNlc3Npb24ubW9kZWwgPT09IFwic3RyaW5nXCIgPyBzZXNzaW9uLm1vZGVsIDogdW5kZWZpbmVkLFxuICAgICAgbWVzc2FnZXM6IHNlc3Npb24ubWVzc2FnZXNcbiAgICAgICAgLmZpbHRlcigobWVzc2FnZSkgPT4ge1xuICAgICAgICAgIGlmICghbWVzc2FnZSB8fCB0eXBlb2YgbWVzc2FnZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgIGNvbnN0IGNhbmRpZGF0ZSA9IG1lc3NhZ2UgYXMgeyByb2xlPzogdW5rbm93bjsgY29udGVudD86IHVua25vd24gfTtcbiAgICAgICAgICByZXR1cm4gKFxuICAgICAgICAgICAgKGNhbmRpZGF0ZS5yb2xlID09PSBcInVzZXJcIiB8fCBjYW5kaWRhdGUucm9sZSA9PT0gXCJhc3Npc3RhbnRcIikgJiZcbiAgICAgICAgICAgIHR5cGVvZiBjYW5kaWRhdGUuY29udGVudCA9PT0gXCJzdHJpbmdcIlxuICAgICAgICAgICk7XG4gICAgICAgIH0pXG4gICAgICAgIC5tYXAoKG1lc3NhZ2UpID0+ICh7XG4gICAgICAgICAgLi4ubWVzc2FnZSxcbiAgICAgICAgICBwcm9wb3NhbFN0YXRlOlxuICAgICAgICAgICAgbWVzc2FnZS5wcm9wb3NhbFN0YXRlID09PSBcInBlbmRpbmdcIlxuICAgICAgICAgICAgICA/IFwic3RhbGVcIlxuICAgICAgICAgICAgICA6IG1lc3NhZ2UucHJvcG9zYWxTdGF0ZSxcbiAgICAgICAgfSkpLFxuICAgICAgY3JlYXRlZEF0OiBzZXNzaW9uLmNyZWF0ZWRBdCxcbiAgICAgIHVwZGF0ZWRBdDogc2Vzc2lvbi51cGRhdGVkQXQsXG4gICAgfTtcbiAgfVxufVxuIiwgImltcG9ydCB7IFBsdWdpbiB9IGZyb20gXCJvYnNpZGlhblwiO1xuXG5leHBvcnQgY29uc3QgRk9SR0VfU0VUVElOR1NfS0VZID0gXCJmb3JnZS1zZXR0aW5nc1wiO1xuXG5leHBvcnQgaW50ZXJmYWNlIEZvcmdlU2V0dGluZ3Mge1xuICBleGVjdXRhYmxlUGF0aDogc3RyaW5nO1xuICBwcmVmZXJyZWRNb2RlbDogc3RyaW5nO1xufVxuXG5leHBvcnQgY29uc3QgREVGQVVMVF9GT1JHRV9TRVRUSU5HUzogRm9yZ2VTZXR0aW5ncyA9IHtcbiAgZXhlY3V0YWJsZVBhdGg6IFwiXCIsXG4gIHByZWZlcnJlZE1vZGVsOiBcIlwiLFxufTtcblxuZXhwb3J0IGZ1bmN0aW9uIGRlY29kZUZvcmdlU2V0dGluZ3MoXG4gIHJhd0RhdGE6IFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgbnVsbCxcbik6IEZvcmdlU2V0dGluZ3Mge1xuICBjb25zdCB2YWx1ZSA9IHJhd0RhdGE/LltGT1JHRV9TRVRUSU5HU19LRVldO1xuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIHsgLi4uREVGQVVMVF9GT1JHRV9TRVRUSU5HUyB9O1xuICBjb25zdCBjYW5kaWRhdGUgPSB2YWx1ZSBhcyBQYXJ0aWFsPEZvcmdlU2V0dGluZ3M+O1xuICByZXR1cm4ge1xuICAgIGV4ZWN1dGFibGVQYXRoOlxuICAgICAgdHlwZW9mIGNhbmRpZGF0ZS5leGVjdXRhYmxlUGF0aCA9PT0gXCJzdHJpbmdcIlxuICAgICAgICA/IGNhbmRpZGF0ZS5leGVjdXRhYmxlUGF0aFxuICAgICAgICA6IFwiXCIsXG4gICAgcHJlZmVycmVkTW9kZWw6XG4gICAgICB0eXBlb2YgY2FuZGlkYXRlLnByZWZlcnJlZE1vZGVsID09PSBcInN0cmluZ1wiXG4gICAgICAgID8gY2FuZGlkYXRlLnByZWZlcnJlZE1vZGVsXG4gICAgICAgIDogXCJcIixcbiAgfTtcbn1cblxuZXhwb3J0IGFzeW5jIGZ1bmN0aW9uIHNhdmVGb3JnZVNldHRpbmdzKFxuICBwbHVnaW46IFBsdWdpbixcbiAgc2V0dGluZ3M6IEZvcmdlU2V0dGluZ3MsXG4pOiBQcm9taXNlPHZvaWQ+IHtcbiAgY29uc3QgY3VycmVudCA9IChhd2FpdCBwbHVnaW4ubG9hZERhdGEoKSkgPz8ge307XG4gIGF3YWl0IHBsdWdpbi5zYXZlRGF0YSh7XG4gICAgLi4uY3VycmVudCxcbiAgICBbRk9SR0VfU0VUVElOR1NfS0VZXTogc2V0dGluZ3MsXG4gIH0pO1xufVxuIiwgImltcG9ydCB7IEFwcCwgUGx1Z2luU2V0dGluZ1RhYiwgU2V0dGluZyB9IGZyb20gXCJvYnNpZGlhblwiO1xuaW1wb3J0IHR5cGUgRm9yZ2VQbHVnaW4gZnJvbSBcIi4uL21haW5cIjtcblxuZXhwb3J0IGNsYXNzIEZvcmdlU2V0dGluZ3NUYWIgZXh0ZW5kcyBQbHVnaW5TZXR0aW5nVGFiIHtcbiAgY29uc3RydWN0b3IoYXBwOiBBcHAsIHByaXZhdGUgcmVhZG9ubHkgZm9yZ2U6IEZvcmdlUGx1Z2luKSB7XG4gICAgc3VwZXIoYXBwLCBmb3JnZSk7XG4gIH1cblxuICBkaXNwbGF5KCk6IHZvaWQge1xuICAgIGNvbnN0IHsgY29udGFpbmVyRWwgfSA9IHRoaXM7XG4gICAgY29uc3Qgc2V0dGluZ3MgPSB0aGlzLmZvcmdlLmdldFNldHRpbmdzKCk7XG4gICAgY29udGFpbmVyRWwuZW1wdHkoKTtcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJGb3JnZVwiIH0pO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIkFnZW50IGV4ZWN1dGFibGVcIilcbiAgICAgIC5zZXREZXNjKFwiT3B0aW9uYWwgYWJzb2x1dGUgcGF0aCB0byB0aGUgY29uZmlndXJlZCBhZ2VudCBydW50aW1lLlwiKVxuICAgICAgLmFkZFRleHQoKHRleHQpID0+XG4gICAgICAgIHRleHRcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJVc2UgUEFUSCBkaXNjb3ZlcnlcIilcbiAgICAgICAgICAuc2V0VmFsdWUoc2V0dGluZ3MuZXhlY3V0YWJsZVBhdGgpXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xuICAgICAgICAgICAgYXdhaXQgdGhpcy5mb3JnZS51cGRhdGVTZXR0aW5ncyh7IGV4ZWN1dGFibGVQYXRoOiB2YWx1ZS50cmltKCkgfSk7XG4gICAgICAgICAgfSksXG4gICAgICApO1xuXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXG4gICAgICAuc2V0TmFtZShcIlByZWZlcnJlZCBtb2RlbFwiKVxuICAgICAgLnNldERlc2MoXCJMZWF2ZSBibGFuayB0byB1c2UgdGhlIHJ1bnRpbWUgZGVmYXVsdCBtb2RlbC5cIilcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxuICAgICAgICB0ZXh0XG4gICAgICAgICAgLnNldFBsYWNlaG9sZGVyKFwiUnVudGltZSBkZWZhdWx0XCIpXG4gICAgICAgICAgLnNldFZhbHVlKHNldHRpbmdzLnByZWZlcnJlZE1vZGVsKVxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcbiAgICAgICAgICAgIGF3YWl0IHRoaXMuZm9yZ2UudXBkYXRlU2V0dGluZ3MoeyBwcmVmZXJyZWRNb2RlbDogdmFsdWUudHJpbSgpIH0pO1xuICAgICAgICAgIH0pLFxuICAgICAgKTtcbiAgfVxufVxuIl0sCiAgIm1hcHBpbmdzIjogIjs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxJQUFBQSxtQkFBbUQ7OztBQ0FuRCwyQkFBb0M7QUFD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O0FBQUEsTUFDUjtBQUFBLElBQ0YsQ0FBQztBQUFBLEVBQ0g7QUFBQSxFQUVBLE1BQU0sV0FBMEI7QUFoSGxDO0FBaUhJLFNBQUssSUFBSSxVQUFVLG1CQUFtQixlQUFlO0FBQ3JELGVBQUssYUFBTCxtQkFBZTtBQUFBLEVBQ2pCO0FBQUEsRUFFQSxNQUFjLGVBQThCO0FBQzFDLFVBQU0sRUFBRSxVQUFVLElBQUksS0FBSztBQUMzQixVQUFNLFdBQVcsVUFBVSxnQkFBZ0IsZUFBZTtBQUUxRCxRQUFJLFNBQVMsU0FBUyxHQUFHO0FBQ3ZCLGdCQUFVLFdBQVcsU0FBUyxDQUFDLENBQUM7QUFDaEM7QUFBQSxJQUNGO0FBRUEsVUFBTSxPQUFPLFVBQVUsYUFBYSxLQUFLO0FBQ3pDLFFBQUksQ0FBQyxLQUFNO0FBRVgsVUFBTSxLQUFLLGFBQWE7QUFBQSxNQUN0QixNQUFNO0FBQUEsTUFDTixRQUFRO0FBQUEsSUFDVixDQUFDO0FBQ0QsY0FBVSxXQUFXLElBQUk7QUFBQSxFQUMzQjtBQUFBLEVBRUEsY0FBNkI7QUFDM0IsV0FBTyxFQUFFLEdBQUcsS0FBSyxjQUFjO0FBQUEsRUFDakM7QUFBQSxFQUVBLGFBQXFCO0FBQ25CLFVBQU0sYUFBYSxHQUFHLEtBQUssU0FBUyxHQUFHO0FBQ3ZDLFdBQU8sS0FBSyxJQUFJLE1BQU0sUUFBUSxnQkFBZ0IsVUFBVTtBQUFBLEVBQzFEO0FBQUEsRUFFQSxNQUFNLGVBQWUsUUFBK0M7QUFDbEUsU0FBSyxnQkFBZ0IsRUFBRSxHQUFHLEtBQUssZUFBZSxHQUFHLE9BQU87QUFDeEQsVUFBTSxrQkFBa0IsTUFBTSxLQUFLLGFBQWE7QUFDaEQsUUFBSSxPQUFPLG1CQUFtQixRQUFXO0FBQ3ZDLFdBQUssU0FBUyxTQUFTLE9BQU8sa0JBQWtCLE1BQVM7QUFBQSxJQUMzRDtBQUFBLEVBQ0Y7QUFBQSxFQUVRLGVBQXFCO0FBQzNCLFVBQU0sTUFBTSxLQUFLO0FBTWpCLFFBQUksUUFBUSxLQUFLO0FBQ2pCLFFBQUksUUFBUSxZQUFZLEtBQUssU0FBUyxFQUFFO0FBQUEsRUFDMUM7QUFDRjsiLAogICJuYW1lcyI6IFsiaW1wb3J0X29ic2lkaWFuIiwgIl9hIiwgIml0ZW0iLCAiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF9vYnNpZGlhbiIsICJpbXBvcnRfb2JzaWRpYW4iLCAiY29udGVudCIsICJtYXRjaGVzIiwgImluZGV4IiwgImltcG9ydF9vYnNpZGlhbiIsICJpbXBvcnRfb2JzaWRpYW4iXQp9Cg==
