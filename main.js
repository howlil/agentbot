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
  default: () => NoxPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian7 = require("obsidian");

// src/agent/AgyAdapter.ts
var import_child_process = require("child_process");
var import_fs = require("fs");
var import_os = require("os");
var import_path = require("path");

// src/agent/AgyProtocol.ts
function encodeAgyUserMessage(prompt) {
  return JSON.stringify({
    event: "user",
    message: {
      content: prompt
    }
  }) + "\n";
}
function failure(message, code = "process-failed") {
  return {
    code,
    message: code === "permission-required" ? "The agent runtime requires approval before it can continue." : code === "protocol-invalid" ? "The agent runtime returned an invalid response." : "The agent runtime could not complete the request.",
    diagnostic: message
  };
}
function classifyFailure(message) {
  const normalized = message.toLowerCase();
  if (normalized.includes("permission") || normalized.includes("approval")) {
    return "permission-required";
  }
  if (normalized.includes("json") || normalized.includes("protocol")) {
    return "protocol-invalid";
  }
  return "process-failed";
}
function parseAgyLine(line, previous) {
  var _a, _b, _c, _d;
  let obj;
  try {
    obj = JSON.parse(line);
  } catch (e) {
    return {
      events: [],
      state: previous,
      terminal: false
    };
  }
  const event = obj["event"];
  if (event === "init") {
    const conversationId2 = obj["conversation_id"] || ((_a = obj["init"]) == null ? void 0 : _a["conversation_id"]);
    return {
      events: [],
      state: {
        ...previous,
        conversationId: conversationId2 != null ? conversationId2 : previous.conversationId
      },
      terminal: false
    };
  }
  if (event === "step_update") {
    const update = obj["step_update"];
    const delta = update == null ? void 0 : update["text_delta"];
    if (typeof delta !== "string" || delta.length === 0) {
      return { events: [], state: previous, terminal: false };
    }
    return {
      events: [{ type: "text", content: delta }],
      state: { ...previous, sawText: true },
      terminal: false
    };
  }
  if (event === "text") {
    const text = obj["text"];
    if (typeof text !== "string" || text.length === 0) {
      return { events: [], state: previous, terminal: false };
    }
    return {
      events: [{ type: "text", content: text }],
      state: { ...previous, sawText: true },
      terminal: false
    };
  }
  if (event === "error") {
    const message = String(
      (_b = obj["error"]) != null ? _b : "Unknown agent runtime error"
    );
    return {
      events: [
        {
          type: "failed",
          failure: failure(message, classifyFailure(message))
        }
      ],
      state: previous,
      terminal: true
    };
  }
  if (event !== "result") {
    return { events: [], state: previous, terminal: false };
  }
  const result = obj["result"];
  const status = String((_c = result == null ? void 0 : result["status"]) != null ? _c : "").toUpperCase();
  const conversationId = (result == null ? void 0 : result["conversation_id"]) || previous.conversationId;
  if (!status) {
    return {
      events: [
        {
          type: "failed",
          failure: failure(
            "AGY result is missing a terminal status.",
            "protocol-invalid"
          )
        }
      ],
      state: { ...previous, conversationId },
      terminal: true
    };
  }
  if (status === "CANCELED" || status === "CANCELLED" || status === "INTERRUPTED") {
    return {
      events: [{ type: "cancelled" }],
      state: { ...previous, conversationId },
      terminal: true
    };
  }
  if (status && status !== "SUCCESS") {
    const message = String(
      (_d = result == null ? void 0 : result["error"]) != null ? _d : `AGY finished with status ${status} without an error message.`
    );
    return {
      events: [
        {
          type: "failed",
          failure: failure(message, classifyFailure(message))
        }
      ],
      state: { ...previous, conversationId },
      terminal: true
    };
  }
  const events = [];
  const response = result == null ? void 0 : result["response"];
  let sawText = previous.sawText;
  if (!sawText && typeof response === "string" && response.length > 0) {
    events.push({ type: "text", content: response });
    sawText = true;
  }
  events.push({
    type: "completed",
    conversationId
  });
  return {
    events,
    state: {
      conversationId,
      sawText
    },
    terminal: true
  };
}

// src/agent/AgyAdapter.ts
function escapeAttribute(value) {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
var DEFAULT_RUNTIME_DEPS = {
  spawn: import_child_process.spawn,
  existsSync: import_fs.existsSync,
  homedir: import_os.homedir,
  platform: process.platform,
  env: process.env
};
var AgyAdapter = class {
  constructor(cwd, getConfig = () => ({}), deps = {}) {
    this.cwd = cwd;
    this.getConfig = getConfig;
    this.deps = {
      ...DEFAULT_RUNTIME_DEPS,
      ...deps
    };
  }
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
    const configured = ((_a = this.getConfig().executablePath) == null ? void 0 : _a.trim()) || ((_b = this.deps.env.AGY_PATH) == null ? void 0 : _b.trim());
    if (configured && !this.deps.existsSync(configured)) {
      throw new Error(
        `Configured agent executable does not exist: ${configured}`
      );
    }
    const candidates = [
      configured,
      ...this.deps.platform === "win32" ? [
        this.deps.env.LOCALAPPDATA ? (0, import_path.join)(this.deps.env.LOCALAPPDATA, "agy", "bin", "agy.exe") : void 0,
        this.deps.env.ProgramFiles ? (0, import_path.join)(
          this.deps.env.ProgramFiles,
          "Google",
          "antigravity-cli",
          "agy.exe"
        ) : void 0
      ] : [(0, import_path.join)(this.deps.homedir(), ".local", "bin", "agy")]
    ].filter((value) => Boolean(value));
    for (const candidate of candidates) {
      if (this.deps.existsSync(candidate)) return candidate;
    }
    return new Promise((resolve, reject) => {
      var _a2;
      const locator = this.deps.platform === "win32" ? "where" : "which";
      const child = this.deps.spawn(locator, ["agy"]);
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
      (_a2 = child.stdout) == null ? void 0 : _a2.on("data", (data) => {
        out += data.toString();
      });
      child.on("error", fail);
      child.on("close", (code) => {
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
    const proc = this.deps.spawn(bin, this.buildArgs(opts), {
      cwd: this.cwd,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    const abort = () => {
      if (proc.exitCode === null && !proc.killed) {
        proc.kill("SIGTERM");
      }
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      if (!proc.stdin) {
        yield {
          type: "failed",
          failure: this.failureFrom(
            "AGY stdin is unavailable.",
            "process-failed"
          )
        };
        return;
      }
      const fullPrompt = this.buildFullPrompt(input);
      proc.stdin.end(encodeAgyUserMessage(fullPrompt));
      yield* this.readEvents(proc, signal);
    } finally {
      signal.removeEventListener("abort", abort);
      abort();
    }
  }
  buildArgs(opts) {
    const args = [
      "--input-format",
      "stream-json",
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
  buildFullPrompt(input) {
    const contextPreamble = this.formatContext(input.context);
    return contextPreamble ? `${contextPreamble}

---

${input.prompt}` : input.prompt;
  }
  formatContext(ctx) {
    if (ctx.length === 0) return "";
    return ctx.map((context, index) => {
      const type = context.type === "selection" ? "selection" : "note";
      const header = `<obsidian-context index="${index + 1}" type="${type}" file="${escapeAttribute(context.file)}">`;
      return `${header}
${context.content}
</obsidian-context>`;
    }).join("\n\n");
  }
  async *readEvents(proc, signal) {
    var _a, _b, _c, _d, _e, _f;
    let buffer = "";
    let stderr = "";
    let exitCode = null;
    const processState = {};
    let closed = false;
    let sawTerminalEvent = false;
    let protocolState = {
      sawText: false
    };
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
      const message = chunk.toString();
      stderr += message;
      const trimmed = message.trim();
      if (trimmed) {
        console.warn("[Nox agent provider]", trimmed);
      }
    });
    (_c = proc.stdin) == null ? void 0 : _c.on("error", (error) => {
      processState.inputError = error;
      wake();
    });
    proc.on("error", (error) => {
      processState.spawnError = error;
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
        const parsed = parseAgyLine(line, protocolState);
        protocolState = parsed.state;
        for (const event of parsed.events) {
          yield event;
          if (event.type === "completed" || event.type === "failed" || event.type === "cancelled") {
            sawTerminalEvent = true;
          }
        }
        if (parsed.terminal) break;
        continue;
      }
      if (closed) {
        if (!sawTerminalEvent) {
          if (signal.aborted) {
            yield { type: "cancelled" };
            break;
          }
          const detail = ((_d = processState.inputError) == null ? void 0 : _d.message) || ((_e = processState.spawnError) == null ? void 0 : _e.message) || stderr.trim() || (exitCode !== 0 ? `AGY exited with code ${exitCode != null ? exitCode : "unknown"} before returning a result.` : "AGY exited without returning a result.");
          yield {
            type: "failed",
            failure: this.failureFrom(detail, "process-failed")
          };
        }
        break;
      }
      const processError = (_f = processState.inputError) != null ? _f : processState.spawnError;
      if (processError) {
        yield {
          type: "failed",
          failure: this.failureFrom(
            processError,
            "process-failed"
          )
        };
        break;
      }
      await new Promise((resolve) => {
        notify = resolve;
      });
    }
  }
  async listModels() {
    const bin = await this.resolveBinary();
    return new Promise((resolve, reject) => {
      var _a, _b;
      const child = this.deps.spawn(bin, ["models"], {
        cwd: this.cwd,
        windowsHide: true
      });
      let out = "";
      let err = "";
      (_a = child.stdout) == null ? void 0 : _a.on("data", (data) => {
        out += data.toString();
      });
      (_b = child.stderr) == null ? void 0 : _b.on("data", (data) => {
        err += data.toString();
      });
      child.on("error", reject);
      child.on("close", (code) => {
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
        }).filter(
          (model) => model !== null
        );
        resolve(models);
      });
    });
  }
  failureFrom(error, code) {
    const diagnostic = error instanceof Error ? error.message : String(error);
    const message = code === "runtime-unavailable" ? "Agent runtime is unavailable. Configure its executable path and try again." : code === "permission-required" ? "The agent runtime requires approval before it can continue." : code === "protocol-invalid" ? "The agent runtime returned an invalid response." : "The agent runtime could not complete the request.";
    return { code, message, diagnostic };
  }
};

// src/chat/ChatView.ts
var import_obsidian = require("obsidian");

// src/chat/prompt-token.ts
function parsePromptToken(value) {
  const match = /(^|\s)([@/])([\w-]*)$/.exec(value);
  if (!match) return null;
  return {
    kind: match[2] === "@" ? "source" : "command",
    query: match[3].toLowerCase(),
    start: match.index + match[1].length
  };
}

// src/chat/capabilities.ts
var NOX_CAPABILITIES = [
  {
    action: "explain",
    title: "Explain",
    command: "/explain",
    description: "Break down a concept and its relationships.",
    meta: "Understanding",
    icon: "circle-help",
    tone: "purple"
  },
  {
    action: "practice",
    title: "Practice",
    command: "/practice",
    description: "Test understanding with active recall.",
    meta: "Recall",
    icon: "list-checks",
    tone: "blue"
  },
  {
    action: "review",
    title: "Review",
    command: "/review",
    description: "Find missing links and weak explanations.",
    meta: "Gaps",
    icon: "search",
    tone: "coral"
  },
  {
    action: "edit",
    title: "Improve note",
    command: "/edit",
    description: "Propose a safe change to the active note.",
    meta: "Safe edit",
    icon: "pencil",
    tone: "green"
  }
];

// src/chat/ChatView.ts
var NOX_VIEW_TYPE = "nox-sidebar";
var ACTIONS = [
  { kind: "ask", label: "Ask" },
  ...NOX_CAPABILITIES.map((capability) => ({
    kind: capability.action,
    label: capability.title
  }))
];
var PROMPT_COMMANDS = NOX_CAPABILITIES.map((capability) => ({
  kind: capability.action,
  name: capability.title,
  description: capability.description
}));
function setNoxIcon(element, icon) {
  element.empty();
  (0, import_obsidian.setIcon)(element, icon);
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
    return NOX_VIEW_TYPE;
  }
  getDisplayText() {
    return "Nox";
  }
  getIcon() {
    return "nox-logo";
  }
  async onOpen() {
    const root = this.contentEl;
    root.empty();
    root.addClass("nox-root");
    this.buildHeader(root);
    this.thread = root.createDiv({ cls: "nox-thread" });
    this.composer = root.createDiv({ cls: "nox-composer" });
    this.buildComposer(this.composer);
    try {
      const health = await this.learning.checkRuntime();
      if (health.status !== "ready") {
        this.showError(health.failure.message);
        return;
      }
    } catch (e) {
      this.showError("Agent runtime is unavailable. Check Nox runtime settings.");
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
    this.headerEl = root.createDiv({ cls: "nox-header" });
    const top = this.headerEl.createDiv({ cls: "nox-header-top" });
    const brand = top.createDiv({ cls: "nox-header-brand" });
    brand.createEl("img", {
      cls: "nox-header-logo",
      attr: {
        src: this.getLogoUrl(),
        alt: "Nox"
      }
    });
    const copy = brand.createDiv({ cls: "nox-header-copy" });
    copy.createSpan({ cls: "nox-header-title", text: "Nox" });
    const right = top.createDiv({ cls: "nox-header-right" });
    const newBtn = right.createEl("button", {
      cls: "nox-new-btn",
      attr: {
        type: "button",
        "aria-label": "New learning session"
      }
    });
    setNoxIcon(newBtn, "plus");
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
      cls: "nox-more-btn",
      attr: {
        type: "button",
        "aria-label": "Open Nox settings"
      }
    });
    setNoxIcon(moreBtn, "more-horizontal");
    moreBtn.title = "Nox settings";
    moreBtn.addEventListener("click", () => this.openSettings());
  }
  buildActionButtons(parent) {
    for (const action of ACTIONS) {
      const button = parent.createEl("button", {
        cls: "nox-action-btn",
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
    const contextRow = parent.createDiv({ cls: "nox-context-row" });
    contextRow.createSpan({
      cls: "nox-context-label",
      text: "Using"
    });
    const chips = contextRow.createDiv({ cls: "nox-chips" });
    this.selectionChip = chips.createSpan({
      cls: "nox-chip nox-chip--hidden"
    });
    this.selectionChip.createSpan({ cls: "nox-chip-dot" });
    this.selectionChip.createSpan({
      cls: "nox-chip-label",
      text: "@selection"
    });
    this.noteChip = chips.createSpan({
      cls: "nox-chip nox-chip--hidden"
    });
    this.noteChip.createSpan({ cls: "nox-chip-dot" });
    this.noteChip.createSpan({
      cls: "nox-chip-label",
      text: "@note"
    });
    this.systemChip = chips.createSpan({
      cls: "nox-chip nox-chip--hidden"
    });
    this.systemChip.createSpan({ cls: "nox-chip-dot" });
    this.systemChip.createSpan({
      cls: "nox-chip-label",
      text: "@nox-system"
    });
    const anchor = parent.createDiv({ cls: "nox-prompt-anchor" });
    this.promptMenuEl = anchor.createDiv({
      cls: "nox-prompt-menu nox-hidden"
    });
    const box = anchor.createDiv({ cls: "nox-composer-box" });
    box.addEventListener("click", (event) => {
      if (!(event.target instanceof HTMLButtonElement) && !(event.target instanceof HTMLSelectElement)) {
        this.input.focus();
      }
    });
    this.intentEl = box.createDiv({
      cls: "nox-intent-row nox-hidden"
    });
    this.attachmentsEl = box.createDiv({
      cls: "nox-attachments nox-hidden"
    });
    this.fileInput = box.createEl("input", {
      cls: "nox-file-input",
      attr: {
        type: "file",
        multiple: "",
        accept: ".md,.txt,.csv,.json,.yaml,.yml"
      }
    });
    this.fileInput.addEventListener("change", () => {
      void this.handleFiles(this.fileInput.files);
    });
    const controls = box.createDiv({ cls: "nox-composer-controls" });
    this.input = controls.createEl("textarea", {
      cls: "nox-input",
      attr: {
        placeholder: "Ask anything about this note...",
        rows: "1"
      }
    });
    this.input.addEventListener("input", () => this.onInput());
    this.input.addEventListener("keydown", (event) => this.onKey(event));
    const footer = box.createDiv({ cls: "nox-composer-footer" });
    this.promptPlusBtn = footer.createEl("button", {
      cls: "nox-prompt-plus",
      attr: {
        type: "button",
        "aria-label": "Add context or file",
        "aria-expanded": "false"
      }
    });
    setNoxIcon(this.promptPlusBtn, "plus");
    this.promptPlusBtn.title = "Add context or file";
    this.promptPlusBtn.addEventListener("click", () => {
      this.promptMenu = this.promptMenu === "source" ? null : "source";
      this.promptMenuActive = 0;
      void this.renderPromptMenu();
      this.input.focus();
    });
    const tools = footer.createDiv({ cls: "nox-composer-tools" });
    const actionMenuBtn = tools.createEl("button", {
      cls: "nox-action-menu-btn",
      attr: {
        type: "button",
        "aria-label": "Show Nox actions",
        "aria-expanded": "false"
      }
    });
    actionMenuBtn.createSpan({
      cls: "nox-action-menu-key",
      text: "/"
    });
    actionMenuBtn.createSpan({
      text: "Actions"
    });
    actionMenuBtn.addEventListener("click", () => {
      this.promptMenu = this.promptMenu === "command" ? null : "command";
      this.promptMenuActive = 0;
      actionMenuBtn.setAttribute(
        "aria-expanded",
        String(this.promptMenu === "command")
      );
      void this.renderPromptMenu();
      this.input.focus();
    });
    this.modelSelect = tools.createEl("select", {
      cls: "nox-model-select"
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
    const btnGroup = footer.createDiv({ cls: "nox-btn-group" });
    this.cancelBtn = btnGroup.createEl("button", {
      cls: "nox-cancel-btn nox-hidden",
      attr: { type: "button", "aria-label": "Stop generating" }
    });
    setNoxIcon(this.cancelBtn, "x");
    this.cancelBtn.title = "Stop";
    this.cancelBtn.setAttribute("aria-label", "Stop generating");
    this.cancelBtn.addEventListener("click", () => {
      this.learning.cancel();
      this.cancelBtn.disabled = true;
    });
    this.sendBtn = btnGroup.createEl("button", {
      cls: "nox-send-btn",
      attr: { type: "button", "aria-label": "Send message" }
    });
    setNoxIcon(this.sendBtn, "arrow-up");
    this.sendBtn.title = "Send message";
    this.sendBtn.setAttribute("aria-label", "Send message");
    this.sendBtn.disabled = true;
    this.sendBtn.addEventListener("click", () => {
      void this.doSend();
    });
  }
  renderAttachments() {
    if (!this.attachmentsEl) return;
    this.attachmentsEl.empty();
    this.attachmentsEl.toggleClass("nox-hidden", this.attachments.length === 0);
    for (const [index, attachment] of this.attachments.entries()) {
      const chip = this.attachmentsEl.createDiv({
        cls: "nox-attachment-chip"
      });
      const attachmentIcon = chip.createSpan({ cls: "nox-attachment-icon" });
      setNoxIcon(attachmentIcon, "file-text");
      chip.createSpan({ cls: "nox-attachment-name", text: attachment.name });
      const remove = chip.createEl("button", {
        cls: "nox-attachment-remove",
        attr: {
          type: "button",
          "aria-label": `Remove ${attachment.name}`
        }
      });
      setNoxIcon(remove, "x");
      remove.addEventListener("click", () => {
        this.attachments.splice(index, 1);
        this.extraCtx = this.attachments.map((item) => item.ref);
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
        ref: {
          kind: "attachment",
          name: file.name,
          content
        }
      });
    }
    this.extraCtx = this.attachments.map((item) => item.ref);
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
        ...this.extraCtx.filter(
          (item) => item.kind === "vault-note"
        ).map((item) => item.path)
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
    this.promptMenuEl.toggleClass("nox-hidden", this.promptMenu === null);
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
        cls: `nox-prompt-menu-row${menuIndex === this.promptMenuActive ? " is-active" : ""}`,
        attr: { type: "button" }
      });
      button.disabled = Boolean(item.disabled);
      const icon = button.createSpan({ cls: "nox-prompt-menu-icon" });
      setNoxIcon(icon, item.icon);
      button.createSpan({ cls: "nox-prompt-menu-name", text: item.name });
      button.createSpan({ cls: "nox-prompt-menu-description", text: item.description });
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
      cls: "nox-prompt-menu-hint",
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
      const exists = this.extraCtx.some(
        (item2) => item2.kind === "vault-note" && item2.path === action.path
      );
      if (!exists) {
        const ref = {
          kind: "vault-note",
          path: action.path
        };
        this.attachments.push({
          name: (_a = action.path.split("/").pop()) != null ? _a : action.path,
          ref
        });
        this.extraCtx = this.attachments.map((item2) => item2.ref);
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
    this.intentEl.toggleClass("nox-hidden", !visible);
    if (!visible) return;
    const label = (_b = (_a = ACTIONS.find((item) => item.kind === this.selectedAction)) == null ? void 0 : _a.label) != null ? _b : this.selectedAction;
    const chip = this.intentEl.createDiv({
      cls: `nox-intent-chip nox-intent-chip--${this.selectedAction}`
    });
    chip.createSpan({ cls: "nox-intent-label", text: label });
    const remove = chip.createEl("button", {
      cls: "nox-intent-remove",
      attr: { type: "button", "aria-label": `Exit ${label} mode` }
    });
    setNoxIcon(remove, "x");
    remove.addEventListener("click", () => {
      this.setAction("ask");
      this.input.focus();
    });
  }
  updatePlaceholder() {
    var _a, _b;
    const hasSelection = Boolean((_a = this.currentContext) == null ? void 0 : _a.selection);
    const hasNote = Boolean((_b = this.currentContext) == null ? void 0 : _b.activeNote);
    const askPlaceholder = hasSelection ? "Ask about this selection..." : hasNote ? "Ask about this note..." : "Ask Nox...";
    const placeholders = {
      ask: askPlaceholder,
      explain: hasSelection ? "What should I explain about this selection?" : "What should I explain?",
      practice: hasSelection ? "Practice this selection..." : "What should we practice?",
      review: hasNote ? "What should I review in this note?" : "What should I review?",
      edit: hasNote ? "How should I improve this note?" : "What should I improve?"
    };
    if (this.input) {
      this.input.placeholder = placeholders[this.selectedAction];
    }
  }
  async syncChips() {
    var _a;
    const context = await this.learning.resolveContext(this.extraCtx);
    this.currentContext = context;
    this.systemChip.addClass("nox-chip--hidden");
    const hasSelection = Boolean(context.selection);
    this.selectionChip.toggleClass("nox-chip--hidden", !hasSelection);
    const activeNote = context.activeNote;
    this.noteChip.toggleClass("nox-chip--hidden", !activeNote);
    if (activeNote) {
      const name = (_a = activeNote.path.split("/").pop()) != null ? _a : activeNote.path;
      const label = this.noteChip.querySelector(".nox-chip-label");
      if (label) label.textContent = `@${name}`;
      this.noteChip.title = activeNote.path;
    }
    this.updatePlaceholder();
    if (this.uiState === "EMPTY" && this.thread.querySelector(".nox-empty-slate")) {
      this.showEmpty();
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
      console.warn("[Nox] Unexpected turn failure", message);
      this.appendInlineError(
        this.thread,
        "Nox hit an unexpected error. Try again."
      );
      this.setUIState("ANSWER");
    }
  }
  handleLearningEvent(event) {
    var _a;
    if (event.type === "context-ready") {
      this.currentContext = event.context.resolved;
      this.systemContextFiles = event.context.system.map((item) => item.file);
      this.systemChip.toggleClass("nox-chip--hidden", event.context.system.length === 0);
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
    (_a = this.agentCursorEl) == null ? void 0 : _a.removeClass("nox-bubble--streaming");
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
    this.thinkingLabelEl.removeClass("nox-thinking-label--active");
    this.thinkingLabelEl.addClass("nox-thinking-label--done");
    for (const row of this.thinkingRows) {
      row.removeClass("nox-hidden");
      row.removeClass("is-active");
      row.addClass("is-done");
      const marker = row.firstElementChild;
      if (marker) {
        marker.textContent = "\u2713";
        marker.removeClass("nox-thinking-marker--spinner");
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
      row.toggleClass("nox-hidden", index >= visible);
      row.toggleClass("is-active", active);
      row.toggleClass("is-done", done);
      if (marker) {
        marker.textContent = done ? "\u2713" : "";
        marker.toggleClass("nox-thinking-marker--spinner", active);
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
    this.cancelBtn.toggleClass("nox-hidden", !busy);
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
      cls: "nox-empty-slate"
    });
    this.renderEmptyContext(slate);
    const intro = slate.createDiv({
      cls: "nox-empty-intro"
    });
    intro.createDiv({
      cls: "nox-empty-title",
      text: "What do you want to work on?"
    });
    intro.createDiv({
      cls: "nox-empty-description",
      text: "Choose a focused action for the current note, or ask Nox directly."
    });
    const section = slate.createDiv({
      cls: "nox-capability-section"
    });
    const sectionHead = section.createDiv({
      cls: "nox-capability-header"
    });
    sectionHead.createSpan({
      cls: "nox-capability-label",
      text: "Focused actions"
    });
    const commandHint = sectionHead.createEl("button", {
      cls: "nox-capability-command-hint",
      text: "Type / to see all actions",
      attr: {
        type: "button",
        "aria-label": "Show all Nox actions"
      }
    });
    commandHint.addEventListener("click", () => {
      this.promptMenu = "command";
      this.promptMenuActive = 0;
      void this.renderPromptMenu();
      this.focusComposer();
    });
    const grid = section.createDiv({
      cls: "nox-capability-grid"
    });
    for (const capability of NOX_CAPABILITIES) {
      const card = grid.createEl("button", {
        cls: `nox-capability-card nox-capability-card--${capability.tone}`,
        attr: {
          type: "button",
          "aria-label": capability.title
        }
      });
      const top = card.createDiv({
        cls: "nox-capability-card-top"
      });
      const name = top.createDiv({
        cls: "nox-capability-name"
      });
      const icon = name.createSpan({
        cls: "nox-capability-icon"
      });
      setNoxIcon(icon, capability.icon);
      name.createSpan({
        cls: "nox-capability-title",
        text: capability.title
      });
      top.createSpan({
        cls: "nox-capability-command",
        text: capability.command
      });
      card.createDiv({
        cls: "nox-capability-description",
        text: capability.description
      });
      card.createSpan({
        cls: "nox-capability-meta",
        text: capability.meta
      });
      card.addEventListener("click", () => {
        this.setAction(capability.action);
        this.focusComposer();
      });
    }
    this.setUIState("EMPTY");
  }
  renderEmptyContext(parent) {
    var _a, _b, _c, _d, _e;
    const context = this.currentContext;
    if (!(context == null ? void 0 : context.selection) && !(context == null ? void 0 : context.activeNote)) return;
    const wrap = parent.createDiv({
      cls: "nox-empty-context"
    });
    const left = wrap.createDiv({
      cls: "nox-empty-context-main"
    });
    const icon = left.createSpan({
      cls: "nox-empty-context-icon"
    });
    setNoxIcon(icon, "file-text");
    const copy = left.createDiv({
      cls: "nox-empty-context-copy"
    });
    copy.createSpan({
      cls: "nox-empty-context-label",
      text: "Current context"
    });
    const file = (_d = (_c = (_a = context.selection) == null ? void 0 : _a.file) != null ? _c : (_b = context.activeNote) == null ? void 0 : _b.path) != null ? _d : "";
    copy.createSpan({
      cls: "nox-empty-context-file",
      text: (_e = file.split("/").pop()) != null ? _e : file
    });
    if (context.selection) {
      wrap.createSpan({
        cls: "nox-empty-context-meta",
        text: "Selection"
      });
    }
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
      cls: "nox-bubble nox-bubble--agent"
    });
    const meta = bubble.createDiv({ cls: "nox-response-meta" });
    meta.createSpan({ cls: "nox-response-label", text: "Nox" });
    meta.createSpan({ cls: "nox-response-sub", text: "Restored" });
    const content = bubble.createDiv({
      cls: "nox-bubble-content nox-markdown"
    });
    const sourcePath = (_f = (_e = (_b = (_a = this.currentContext) == null ? void 0 : _a.selection) == null ? void 0 : _b.file) != null ? _e : (_d = (_c = this.currentContext) == null ? void 0 : _c.activeNote) == null ? void 0 : _d.path) != null ? _f : "Nox.md";
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
      cls: `nox-result-badge nox-badge--${state === "applied" ? "applied" : state === "rejected" ? "rejected" : "stale"}`,
      text: labels[state]
    });
  }
  showError(message) {
    this.stopLoadingTimer();
    this.thread.empty();
    this.agentCursorEl = null;
    this.statusEl = null;
    const slate = this.thread.createDiv({
      cls: "nox-error-slate"
    });
    slate.createDiv({
      cls: "nox-error-icon",
      text: "\u26A0"
    });
    slate.createDiv({
      cls: "nox-error-title",
      text: "Nox unavailable"
    });
    slate.createDiv({
      cls: "nox-error-body",
      text: message
    });
    const button = slate.createEl("button", {
      cls: "nox-configure-btn",
      text: "Configure Nox \u2192"
    });
    button.addEventListener("click", () => {
      this.openSettings();
    });
    this.setUIState("ERROR");
  }
  appendUserBubble(text) {
    var _a;
    (_a = this.thread.querySelector(".nox-empty-slate")) == null ? void 0 : _a.remove();
    const bubble = this.thread.createDiv({
      cls: "nox-bubble nox-bubble--user"
    });
    bubble.setText(text);
  }
  ensureAgentBubble() {
    var _a, _b;
    if (this.agentCursorEl) return;
    this.statusEl = this.buildThinkingTrace();
    this.agentCursorEl = this.thread.createDiv({
      cls: "nox-bubble nox-bubble--agent nox-bubble--streaming"
    });
    const meta = this.agentCursorEl.createDiv({ cls: "nox-response-meta" });
    meta.createSpan({ cls: "nox-response-label", text: "Nox" });
    meta.createSpan({
      cls: "nox-response-sub",
      text: (_b = (_a = ACTIONS.find((action) => action.kind === this.selectedAction)) == null ? void 0 : _a.label) != null ? _b : "Response"
    });
    this.responseTimeEl = meta.createSpan({ cls: "nox-response-time", text: "for 0.0s" });
    this.agentContentEl = this.agentCursorEl.createDiv({
      cls: "nox-bubble-content"
    });
  }
  buildThinkingTrace() {
    var _a, _b, _c, _d, _e, _f, _g, _h, _i;
    const trace = this.thread.createDiv({ cls: "nox-thinking" });
    trace.setAttribute("role", "status");
    trace.setAttribute("aria-live", "polite");
    const toggle = trace.createEl("button", {
      cls: "nox-thinking-toggle",
      attr: { type: "button", "aria-expanded": "false" }
    });
    this.thinkingToggleEl = toggle;
    toggle.createEl("img", {
      cls: "nox-thinking-logo",
      attr: { src: this.getLogoUrl(), alt: "" }
    });
    this.thinkingLabelEl = toggle.createSpan({
      cls: "nox-thinking-label nox-thinking-label--active",
      text: "Working"
    });
    this.loadingElapsedEl = toggle.createSpan({ cls: "nox-thinking-elapsed" });
    this.loadingElapsedEl.setAttribute("aria-hidden", "true");
    const chevron = toggle.createSpan({ cls: "nox-thinking-chevron", text: "\u2304" });
    this.thinkingChevronEl = chevron;
    const panel = trace.createDiv({ cls: "nox-thinking-panel" });
    this.thinkingPanelEl = panel;
    const list = panel.createDiv({ cls: "nox-thinking-trace nox-thinking-trace--facts" });
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
      const row = list.createDiv({ cls: "nox-thinking-row is-done" });
      row.createSpan({ cls: "nox-thinking-marker", text: "\xB7" });
      row.createSpan({ cls: "nox-thinking-primary", text: fact.primary });
      if (fact.secondary) row.createSpan({ cls: "nox-thinking-secondary", text: fact.secondary });
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
        cls: "nox-stream-word",
        text: part
      });
    }
    this.scrollThread();
  }
  flushStreamingText() {
    if (!this.agentContentEl || !this.streamingPendingText) return;
    this.agentContentEl.createSpan({
      cls: "nox-stream-word",
      text: this.streamingPendingText
    });
    this.streamingPendingText = "";
  }
  renderMarkdownResponse() {
    var _a, _b, _c, _d, _e, _f;
    if (!this.agentContentEl || !this.streamedResponseText.trim()) return;
    const content = this.agentContentEl;
    const markdown = this.streamedResponseText;
    const sourcePath = (_f = (_e = (_b = (_a = this.currentContext) == null ? void 0 : _a.selection) == null ? void 0 : _b.file) != null ? _e : (_d = (_c = this.currentContext) == null ? void 0 : _c.activeNote) == null ? void 0 : _d.path) != null ? _f : "Nox.md";
    content.empty();
    content.addClass("nox-markdown");
    void import_obsidian.MarkdownRenderer.render(this.app, markdown, content, sourcePath, this).catch(() => {
      content.empty();
      content.removeClass("nox-markdown");
      content.addClass("nox-markdown-error");
      content.setText("Markdown response could not be rendered.");
    });
  }
  appendStreamActions() {
    if (!this.agentCursorEl || !this.streamedResponseText.trim()) return;
    const responseText = this.streamedResponseText.trim();
    const actions = this.agentCursorEl.createDiv({
      cls: "nox-stream-actions"
    });
    const copyButton = actions.createEl("button", {
      cls: "nox-stream-action",
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
      cls: "nox-practice-card"
    });
    card.createDiv({
      cls: "nox-practice-label",
      text: `Practice \xB7 ${question.concept}`
    });
    card.createDiv({
      cls: "nox-practice-question",
      text: question.question
    });
    if (question.hint) {
      card.createDiv({
        cls: "nox-practice-hint",
        text: `Hint: ${question.hint}`
      });
    }
    this.scrollThread();
  }
  appendPracticeEvaluation(evaluation) {
    if (!this.agentCursorEl) return;
    const card = this.agentCursorEl.createDiv({
      cls: `nox-practice-evaluation nox-outcome--${evaluation.outcome}`
    });
    const outcomeLabel = evaluation.outcome === "correct" ? "Correct" : evaluation.outcome === "partial" ? "Partial" : "Needs work";
    card.createDiv({
      cls: "nox-practice-label",
      text: `${outcomeLabel} \xB7 ${evaluation.concept}`
    });
    card.createDiv({
      cls: "nox-practice-feedback",
      text: evaluation.feedback
    });
    if (evaluation.misconceptions.length > 0) {
      const gaps = card.createDiv({
        cls: "nox-practice-gaps"
      });
      gaps.createDiv({
        cls: "nox-practice-gaps-label",
        text: "Gap"
      });
      for (const misconception of evaluation.misconceptions) {
        gaps.createDiv({
          cls: "nox-practice-gap",
          text: misconception
        });
      }
    }
    this.scrollThread();
  }
  appendReviewFindings(findings) {
    if (!this.agentCursorEl) return;
    const wrap = this.agentCursorEl.createDiv({ cls: "nox-review" });
    wrap.createDiv({
      cls: "nox-review-summary",
      text: findings.length === 0 ? "No material learning gaps found." : `${findings.length} important ${findings.length === 1 ? "gap" : "gaps"}`
    });
    for (const finding of findings) {
      const card = wrap.createDiv({
        cls: `nox-review-card nox-review-card--${finding.kind}`
      });
      card.createDiv({ cls: "nox-review-kind", text: finding.kind.replace("-", " ") });
      card.createDiv({ cls: "nox-review-title", text: finding.title });
      card.createDiv({ cls: "nox-review-detail", text: finding.detail });
      const actions = card.createDiv({ cls: "nox-review-actions" });
      const practice = actions.createEl("button", {
        cls: "nox-review-action",
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
        cls: "nox-review-action",
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
    const row = this.thread.createDiv({ cls: "nox-progress-row" });
    const mark = row.createSpan({ cls: "nox-progress-mark" });
    setNoxIcon(mark, "check");
    row.createSpan({
      cls: "nox-progress-text",
      text: open > 0 ? `Learning state updated \xB7 ${open} open ${open === 1 ? "gap" : "gaps"}` : "Learning state updated"
    });
  }
  appendProposalBubble(edit) {
    const proposal = edit.proposal;
    const wrap = this.renderProposal(proposal);
    const actions = wrap.createDiv({
      cls: "nox-proposal-actions"
    });
    const rejectBtn = actions.createEl("button", {
      cls: "nox-btn-reject",
      text: "Reject"
    });
    const applyBtn = actions.createEl("button", {
      cls: "nox-btn-apply",
      text: "Apply \u2713"
    });
    rejectBtn.addEventListener("click", () => {
      void this.learning.rejectProposal(edit.id);
      actions.remove();
      wrap.createDiv({
        cls: "nox-result-badge nox-badge--rejected",
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
          cls: "nox-result-badge nox-badge--applied",
          text: "\u2713 Applied to " + proposal.file
        });
        this.setUIState("APPLIED");
      } else {
        wrap.createDiv({
          cls: "nox-result-badge nox-badge--stale",
          text: "\u26A0 " + result.message
        });
        this.setUIState("ANSWER");
      }
    });
    this.scrollThread();
  }
  renderProposal(proposal) {
    const wrap = this.thread.createDiv({ cls: "nox-proposal" });
    wrap.createDiv({
      cls: "nox-proposal-badge",
      text: "\u{1F4C4} " + proposal.file
    });
    if (proposal.reason) {
      wrap.createDiv({ cls: "nox-proposal-reason", text: proposal.reason });
    }
    const diff = wrap.createDiv({ cls: "nox-proposal-diff" });
    proposal.original.split("\n").forEach((line) => {
      diff.createDiv({ cls: "nox-diff-removed", text: "- " + line });
    });
    proposal.replacement.split("\n").forEach((line) => {
      diff.createDiv({ cls: "nox-diff-added", text: "+ " + line });
    });
    return wrap;
  }
  appendInlineError(parent, message) {
    parent.createDiv({
      cls: "nox-inline-error",
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
    const explicitDocs = [];
    for (const ref of explicit) {
      if (ref.kind === "attachment") {
        explicitDocs.push({
          type: "note",
          path: `attachment/${ref.name}`,
          content: ref.content,
          source: "explicit"
        });
        continue;
      }
      const note = await this.obsidian.loadNote(ref.path);
      if (!note) {
        throw new Error(
          `Explicit context note no longer exists: ${ref.path}`
        );
      }
      explicitDocs.push({
        type: "note",
        path: note.file,
        content: note.content,
        source: "explicit"
      });
    }
    return {
      selection: selection != null ? selection : void 0,
      activeNote: activeNote ? {
        path: activeNote.file,
        content: activeNote.content
      } : void 0,
      explicit: explicitDocs
    };
  }
  searchNotes(query, limit = 8) {
    return this.obsidian.searchNotes(query, limit);
  }
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
  constructor(app, plugin) {
    this.app = app;
    this.lastMarkdownView = null;
    this.captureCurrentMarkdownView();
    plugin.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if ((leaf == null ? void 0 : leaf.view) instanceof import_obsidian2.MarkdownView) {
          this.lastMarkdownView = leaf.view;
        }
      })
    );
    plugin.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.captureCurrentMarkdownView();
      })
    );
  }
  getSelection() {
    var _a;
    const view = this.getRelevantMarkdownView();
    const file = view == null ? void 0 : view.file;
    const selection = (_a = view == null ? void 0 : view.editor.getSelection()) != null ? _a : "";
    if (!file || !selection) return null;
    return {
      file: file.path,
      content: selection
    };
  }
  async getCurrentNote() {
    const view = this.getRelevantMarkdownView();
    if (view == null ? void 0 : view.file) {
      return {
        file: view.file.path,
        content: view.editor.getValue()
      };
    }
    const file = this.app.workspace.getActiveFile();
    if (!file || !(file instanceof import_obsidian2.TFile)) return null;
    return {
      file: file.path,
      content: await this.app.vault.cachedRead(file)
    };
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
    ).sort(
      (a, b) => a.score - b.score || a.path.localeCompare(b.path)
    ).slice(0, limit).map(({ path, name }) => ({ path, name }));
  }
  async loadNote(path) {
    var _a;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof import_obsidian2.MarkdownView && ((_a = leaf.view.file) == null ? void 0 : _a.path) === path) {
        return {
          file: path,
          content: leaf.view.editor.getValue()
        };
      }
    }
    const file = this.app.vault.getFileByPath(path);
    if (!file || !(file instanceof import_obsidian2.TFile)) return null;
    return {
      file: file.path,
      content: await this.app.vault.cachedRead(file)
    };
  }
  captureCurrentMarkdownView() {
    const active = this.app.workspace.getActiveViewOfType(import_obsidian2.MarkdownView);
    if (active) {
      this.lastMarkdownView = active;
    }
  }
  getRelevantMarkdownView() {
    var _a;
    const active = this.app.workspace.getActiveViewOfType(import_obsidian2.MarkdownView);
    if (active) {
      this.lastMarkdownView = active;
      return active;
    }
    if (((_a = this.lastMarkdownView) == null ? void 0 : _a.file) && this.app.workspace.getLeavesOfType("markdown").some((leaf) => leaf.view === this.lastMarkdownView)) {
      return this.lastMarkdownView;
    }
    this.lastMarkdownView = null;
    return null;
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

// src/learning/learning-state-projection.ts
var MAX_PROMPT_GAPS = 20;
var MAX_PROMPT_EVIDENCE = 20;
function toPromptLearningState(state) {
  return {
    version: 2,
    target: state.target,
    currentTopic: state.currentTopic,
    gaps: state.gaps.filter((gap) => gap.status !== "resolved").slice(-MAX_PROMPT_GAPS).map((gap) => ({
      ...gap,
      evidenceIds: [...gap.evidenceIds]
    })),
    recentEvidence: state.evidence.slice(-MAX_PROMPT_EVIDENCE).map((item) => ({ ...item }))
  };
}

// src/learning/PracticeStateMachine.ts
var PracticeStateMachine = class {
  constructor(makeId = () => crypto.randomUUID()) {
    this.makeId = makeId;
    this.session = null;
  }
  reset() {
    this.session = null;
  }
  start() {
    this.session = {
      id: this.makeId(),
      state: "generating",
      turns: []
    };
    return this.session;
  }
  snapshot() {
    return this.session;
  }
  isWaitingForAnswer() {
    var _a;
    return Boolean(
      ((_a = this.session) == null ? void 0 : _a.state) === "waiting-answer" && this.session.currentQuestion
    );
  }
  acceptQuestion(question) {
    if (!this.session) {
      this.start();
    }
    const session = this.session;
    session.concept = question.concept;
    session.currentQuestion = question.question;
    session.state = "waiting-answer";
    const current = session.turns[session.turns.length - 1];
    if (current && !current.answer && current.question === question.question) {
      return;
    }
    session.turns.push({
      id: this.makeId(),
      concept: question.concept,
      question: question.question
    });
  }
  beginEvaluation(answer) {
    const session = this.session;
    if (!session || session.state !== "waiting-answer" || !session.currentQuestion) {
      return null;
    }
    const attempt = {
      id: this.makeId(),
      sessionId: session.id,
      question: session.currentQuestion,
      concept: session.concept,
      answer
    };
    session.state = "evaluating";
    return attempt;
  }
  commitEvaluation(attempt, evaluation) {
    var _a;
    const session = this.session;
    if (!session || session.id !== attempt.sessionId || session.state !== "evaluating" || session.currentQuestion !== attempt.question) {
      throw new Error(
        "Practice evaluation no longer matches the active question."
      );
    }
    const current = session.turns[session.turns.length - 1];
    if (!current || current.question !== attempt.question) {
      throw new Error(
        "Practice session is missing the active question turn."
      );
    }
    current.answer = attempt.answer;
    current.evaluation = evaluation;
    session.concept = evaluation.concept;
    const nextQuestion = (_a = evaluation.nextQuestion) == null ? void 0 : _a.trim();
    if (!nextQuestion) {
      session.state = "complete";
      session.currentQuestion = void 0;
      return void 0;
    }
    const next = {
      kind: "question",
      concept: evaluation.concept,
      question: nextQuestion
    };
    session.state = "waiting-answer";
    session.currentQuestion = nextQuestion;
    session.turns.push({
      id: this.makeId(),
      concept: next.concept,
      question: next.question
    });
    return next;
  }
  rollbackEvaluation(attempt) {
    const session = this.session;
    if (!session || session.id !== attempt.sessionId || session.state !== "evaluating" || session.currentQuestion !== attempt.question) {
      return;
    }
    session.state = "waiting-answer";
  }
};

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
  constructor(sessions, contexts, policies, mutations, learningState, options = {}) {
    this.sessions = sessions;
    this.contexts = contexts;
    this.policies = policies;
    this.mutations = mutations;
    this.learningState = learningState;
    this.practice = new PracticeStateMachine();
    this.activeTurn = null;
    this.pendingProposals = /* @__PURE__ */ new Map();
    var _a;
    this.turnTimeoutMs = (_a = options.turnTimeoutMs) != null ? _a : 6e4;
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
    this.practice.reset();
    this.pendingProposals.clear();
    return this.sessions.newSession();
  }
  async resolveContext(explicitContext = []) {
    return this.contexts.resolve(explicitContext);
  }
  searchNotes(query, limit = 8) {
    return this.contexts.searchNotes(query, limit);
  }
  async *run(request) {
    var _a, _b, _c, _d;
    if (this.activeTurn) {
      yield {
        type: "failed",
        failure: {
          code: "busy",
          message: "Another Nox turn is still running."
        }
      };
      return;
    }
    let context;
    let policy;
    let state;
    try {
      context = await this.contexts.resolve(
        request.explicitContext
      );
      [policy, state] = await Promise.all([
        this.policies.load(),
        this.learningState.load()
      ]);
    } catch (error) {
      yield {
        type: "failed",
        failure: {
          code: "unknown",
          message: "Nox could not prepare this learning turn.",
          diagnostic: error instanceof Error ? error.message : String(error)
        }
      };
      return;
    }
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
      content: JSON.stringify(
        toPromptLearningState(state),
        null,
        2
      )
    });
    const readableFiles = Array.from(
      new Set(
        visible.filter(
          (item) => !item.file.startsWith("attachment/")
        ).map((item) => item.file)
      )
    );
    const mutableFile = (_c = (_a = context.selection) == null ? void 0 : _a.file) != null ? _c : (_b = context.activeNote) == null ? void 0 : _b.path;
    const snapshot = {
      resolved: context,
      visible,
      system,
      readableFiles,
      mutableFile
    };
    yield { type: "context-ready", context: snapshot };
    let preparedPrompt;
    let practiceAttempt;
    if (request.action === "practice") {
      if (this.practice.isWaitingForAnswer()) {
        const attempt = this.practice.beginEvaluation(request.prompt);
        if (!attempt) {
          yield {
            type: "failed",
            failure: {
              code: "unknown",
              message: "The active practice question is no longer available."
            }
          };
          return;
        }
        practiceAttempt = attempt;
        preparedPrompt = buildPracticeEvaluationInstruction({
          question: attempt.question,
          answer: attempt.answer,
          concept: attempt.concept
        });
      } else {
        this.practice.start();
        preparedPrompt = buildPracticeQuestionInstruction(
          request.prompt
        );
      }
    } else {
      this.practice.reset();
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
    }, this.turnTimeoutMs);
    let visibleText = "";
    const rollbackPractice = () => {
      if (practiceAttempt) {
        this.practice.rollbackEvaluation(
          practiceAttempt
        );
      }
    };
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
            snapshot,
            practiceAttempt
          )) {
            if (mapped.type === "response-delta") {
              visibleText += mapped.text;
            }
            if (mapped.type === "mutation-proposed") {
              await this.sessions.recordAssistantMessage(
                visibleText
              );
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
            snapshot,
            practiceAttempt
          )) {
            if (mapped.type === "response-delta") {
              visibleText += mapped.text;
            }
            if (mapped.type === "mutation-proposed") {
              await this.sessions.recordAssistantMessage(
                visibleText
              );
              visibleText = "";
              await this.sessions.recordProposal(
                mapped.edit.id,
                mapped.edit.proposal
              );
            }
            yield mapped;
          }
          if (practiceAttempt && ((_d = this.practice.snapshot()) == null ? void 0 : _d.state) === "evaluating") {
            throw new Error(
              "Agent completed without a practice evaluation."
            );
          }
          await this.sessions.recordAssistantMessage(
            visibleText
          );
          yield { type: "completed" };
          return;
        }
        if (event.type === "failed") {
          rollbackPractice();
          yield {
            type: "failed",
            failure: event.failure
          };
          return;
        }
        rollbackPractice();
        if (activeTurn.cancelReason === "timeout") {
          const seconds = Math.max(
            1,
            Math.ceil(this.turnTimeoutMs / 1e3)
          );
          yield {
            type: "failed",
            failure: {
              code: "timeout",
              message: `No response after ${seconds} seconds. The agent runtime may be busy.`
            }
          };
        } else {
          yield { type: "cancelled" };
        }
        return;
      }
      if (practiceAttempt) {
        rollbackPractice();
      }
    } catch (error) {
      rollbackPractice();
      const failure2 = {
        code: "protocol-invalid",
        message: "Nox could not interpret the agent response.",
        diagnostic: error instanceof Error ? error.message : String(error)
      };
      yield { type: "failed", failure: failure2 };
    } finally {
      clearTimeout(timeout);
      if (this.activeTurn === activeTurn) {
        this.activeTurn = null;
      }
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
      pending.mutableFile
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
    await this.sessions.updateProposalState(
      proposalId,
      "rejected"
    );
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
  async *mapStructuredEvents(events, request, context, practiceAttempt) {
    var _a, _b, _c, _d, _e, _f, _g, _h;
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
        if (!context.mutableFile || event.proposal.file !== context.mutableFile) {
          throw new Error(
            `Edit target is not the active mutable note: ${event.proposal.file}`
          );
        }
        const edit = {
          id: crypto.randomUUID(),
          proposal: event.proposal
        };
        this.pendingProposals.set(edit.id, {
          proposal: edit.proposal,
          mutableFile: context.mutableFile
        });
        yield {
          type: "mutation-proposed",
          edit
        };
        continue;
      }
      if (event.type === "practice-question") {
        this.practice.acceptQuestion(
          event.question
        );
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
        const nextState = await this.learningState.recordReviewFindings(
          {
            findings: event.findings,
            source
          }
        );
        if (event.findings.length > 0) {
          yield {
            type: "learning-state-updated",
            state: nextState
          };
        }
        continue;
      }
      if (event.type === "practice-evaluation") {
        if (!practiceAttempt) {
          throw new Error(
            "Practice evaluation arrived without an active answer attempt."
          );
        }
        const nextQuestion = this.practice.commitEvaluation(
          practiceAttempt,
          event.evaluation
        );
        yield {
          type: "practice-evaluation",
          evaluation: event.evaluation
        };
        const source = (_h = (_g = (_e = context.resolved.selection) == null ? void 0 : _e.file) != null ? _g : (_f = context.resolved.activeNote) == null ? void 0 : _f.path) != null ? _h : "learning-session";
        const nextState = await this.learningState.recordPracticeEvaluation(
          {
            evaluation: event.evaluation,
            source
          }
        );
        yield {
          type: "learning-state-updated",
          state: nextState
        };
        if (nextQuestion) {
          yield {
            type: "practice-question",
            question: nextQuestion
          };
        }
        continue;
      }
      throw new Error(event.message);
    }
  }
};

// src/mutation/MutationService.ts
var import_obsidian4 = require("obsidian");

// src/mutation/replacement.ts
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
function planReplacement(content, original, replacement) {
  const matches = findOccurrences(content, original);
  if (matches.length === 0) {
    return { ok: false, reason: "stale" };
  }
  if (matches.length > 1) {
    return { ok: false, reason: "ambiguous" };
  }
  const index = matches[0];
  return {
    ok: true,
    index,
    next: content.slice(0, index) + replacement + content.slice(index + original.length)
  };
}

// src/mutation/MutationService.ts
var MutationService = class {
  constructor(app) {
    this.app = app;
  }
  async apply(proposal, mutableFile) {
    if (!mutableFile || proposal.file !== mutableFile) {
      return {
        ok: false,
        reason: "unauthorized",
        message: "Nox can only edit the primary note used for this turn."
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
      const targetView = this.findOpenMarkdownView(file.path);
      if (!targetView) {
        return {
          ok: false,
          reason: "no-editor",
          message: "Open the target note in an editor before applying this change."
        };
      }
      const editor = targetView.editor;
      const content = editor.getValue();
      const plan = planReplacement(
        content,
        proposal.original,
        proposal.replacement
      );
      if (!plan.ok && plan.reason === "stale") {
        return {
          ok: false,
          reason: "stale",
          message: "Note changed since the proposal was made. Regenerate the edit."
        };
      }
      if (!plan.ok) {
        return {
          ok: false,
          reason: "ambiguous",
          message: "The original text occurs more than once. Regenerate with a more specific selection."
        };
      }
      const from = editor.offsetToPos(plan.index);
      const to = editor.offsetToPos(
        plan.index + proposal.original.length
      );
      editor.replaceRange(proposal.replacement, from, to);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        reason: "error",
        message: error instanceof Error ? error.message : String(error)
      };
    }
  }
  findOpenMarkdownView(path) {
    var _a;
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (leaf.view instanceof import_obsidian4.MarkdownView && ((_a = leaf.view.file) == null ? void 0 : _a.path) === path) {
        return leaf.view;
      }
    }
    return null;
  }
};

// src/persistence/VaultLearningStore.ts
var import_obsidian5 = require("obsidian");

// src/learning/learning-state.ts
var DEFAULT_LEARNING_STATE = {
  version: 2,
  target: null,
  gaps: [],
  evidence: []
};

// src/persistence/learning-state-schema.ts
function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}
function isKnowledgeGap(value) {
  if (!value || typeof value !== "object") return false;
  const gap = value;
  return typeof gap.id === "string" && typeof gap.concept === "string" && typeof gap.reason === "string" && isStringArray(gap.evidenceIds) && (gap.status === "open" || gap.status === "improving" || gap.status === "resolved");
}
function isEvidenceV1(value) {
  if (!value || typeof value !== "object") return false;
  const evidence = value;
  return typeof evidence.id === "string" && (evidence.type === "practice" || evidence.type === "review" || evidence.type === "project") && typeof evidence.concept === "string" && typeof evidence.source === "string" && (evidence.outcome === void 0 || typeof evidence.outcome === "string") && typeof evidence.createdAt === "number";
}
function isEvidenceV2(value) {
  if (!isEvidenceV1(value)) return false;
  const scope = value.scope;
  return scope === "learner" || scope === "material";
}
function hasSharedShape(value) {
  return (value.target === null || typeof value.target === "string") && (value.currentTopic === void 0 || typeof value.currentTopic === "string") && Array.isArray(value.gaps) && value.gaps.every(isKnowledgeGap) && Array.isArray(value.evidence);
}
function isV1(value) {
  if (!value || typeof value !== "object") return false;
  const state = value;
  return state.version === 1 && hasSharedShape(state) && state.evidence.every(isEvidenceV1);
}
function isV2(value) {
  if (!value || typeof value !== "object") return false;
  const state = value;
  return state.version === 2 && hasSharedShape(state) && state.evidence.every(isEvidenceV2);
}
function migrateLearningStateV1(state) {
  const evidence = state.evidence.map(
    (item) => ({
      ...item,
      scope: item.type === "review" ? "material" : "learner"
    })
  );
  const evidenceById = new Map(
    evidence.map((item) => [item.id, item])
  );
  const gaps = state.gaps.filter((gap) => {
    if (gap.evidenceIds.length === 0) return true;
    const referenced = gap.evidenceIds.map((id) => evidenceById.get(id)).filter(
      (item) => item !== void 0
    );
    return !(referenced.length === gap.evidenceIds.length && referenced.every((item) => item.scope === "material"));
  });
  return {
    version: 2,
    target: state.target,
    currentTopic: state.currentTopic,
    gaps,
    evidence
  };
}
function decodeLearningState(value) {
  if (isV2(value)) {
    return {
      ...value,
      gaps: value.gaps.map((gap) => ({
        ...gap,
        evidenceIds: [...gap.evidenceIds]
      })),
      evidence: value.evidence.map((item) => ({ ...item }))
    };
  }
  if (isV1(value)) {
    return migrateLearningStateV1(value);
  }
  throw new Error("Learning state has an unsupported shape.");
}

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
    try {
      return decodeLearningState(parsed);
    } catch (e) {
      throw new Error(
        `Learning state has an unsupported shape: ${PROGRESS_PATH}`
      );
    }
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
      scope: "learner",
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
          if (!gap.evidenceIds.includes(evidence.id)) {
            gap.evidenceIds.push(evidence.id);
          }
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
        scope: "material",
        concept: finding.concept,
        source: input.source,
        outcome: finding.kind,
        createdAt: Date.now()
      };
      state.evidence.push(evidence);
      state.currentTopic = finding.concept;
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
var STORE_KEY = "nox-sessions";
var LEGACY_STORE_KEY = "agy-sessions";
var SessionStore = class {
  constructor(options = {}) {
    this.data = {
      currentSessionId: null,
      sessions: {}
    };
    var _a, _b;
    this.now = (_a = options.now) != null ? _a : Date.now;
    this.uuid = (_b = options.uuid) != null ? _b : (() => crypto.randomUUID());
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
    const now = this.now();
    const session = {
      id: this.uuid(),
      model,
      messages: [],
      createdAt: now,
      updatedAt: now
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
    session.updatedAt = this.now();
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

// src/settings/NoxSettings.ts
var NOX_SETTINGS_KEY = "nox-settings";
var DEFAULT_NOX_SETTINGS = {
  executablePath: "",
  preferredModel: ""
};
function decodeNoxSettings(rawData) {
  const value = rawData == null ? void 0 : rawData[NOX_SETTINGS_KEY];
  if (!value || typeof value !== "object") return { ...DEFAULT_NOX_SETTINGS };
  const candidate = value;
  return {
    executablePath: typeof candidate.executablePath === "string" ? candidate.executablePath : "",
    preferredModel: typeof candidate.preferredModel === "string" ? candidate.preferredModel : ""
  };
}
async function saveNoxSettings(plugin, settings) {
  var _a;
  const current = (_a = await plugin.loadData()) != null ? _a : {};
  await plugin.saveData({
    ...current,
    [NOX_SETTINGS_KEY]: settings
  });
}

// src/settings/SettingsTab.ts
var import_obsidian6 = require("obsidian");
var NoxSettingsTab = class extends import_obsidian6.PluginSettingTab {
  constructor(app, nox) {
    super(app, nox);
    this.nox = nox;
  }
  display() {
    const { containerEl } = this;
    const settings = this.nox.getSettings();
    containerEl.empty();
    containerEl.createEl("h2", { text: "Nox" });
    new import_obsidian6.Setting(containerEl).setName("Agent executable").setDesc("Optional absolute path to the configured agent runtime.").addText(
      (text) => text.setPlaceholder("Use PATH discovery").setValue(settings.executablePath).onChange(async (value) => {
        await this.nox.updateSettings({ executablePath: value.trim() });
      })
    );
    new import_obsidian6.Setting(containerEl).setName("Preferred model").setDesc("Leave blank to use the runtime default model.").addText(
      (text) => text.setPlaceholder("Runtime default").setValue(settings.preferredModel).onChange(async (value) => {
        await this.nox.updateSettings({ preferredModel: value.trim() });
      })
    );
  }
};

// src/main.ts
var NoxPlugin = class extends import_obsidian7.Plugin {
  async onload() {
    const vaultAdapter = this.app.vault.adapter;
    const vaultPath = vaultAdapter instanceof import_obsidian7.FileSystemAdapter ? vaultAdapter.getBasePath() : void 0;
    this.noxSettings = decodeNoxSettings(await this.loadData());
    const adapter = new AgyAdapter(vaultPath, () => ({
      executablePath: this.noxSettings.executablePath
    }));
    const sessionStore = new SessionStore();
    const sessions = new SessionController(
      this,
      sessionStore,
      adapter
    );
    await sessions.init();
    if (!sessions.getSession().model && this.noxSettings.preferredModel) {
      sessions.setModel(this.noxSettings.preferredModel);
    }
    const obsidianContext = new ObsidianContext(this.app, this);
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
      "nox-logo",
      `<image href="${logoUrl}" x="0" y="0" width="100%" height="100%" preserveAspectRatio="xMidYMid slice" />`
    );
    this.registerView(
      NOX_VIEW_TYPE,
      (leaf) => new ChatView(
        leaf,
        this.learning,
        () => this.openSettings(),
        () => this.getLogoUrl()
      )
    );
    this.addSettingTab(new NoxSettingsTab(this.app, this));
    this.addRibbonIcon(
      "nox-logo",
      "Open Nox",
      () => this.activateView()
    );
    this.addCommand({
      id: "open-nox-sidebar",
      name: "Open Nox sidebar",
      callback: () => this.activateView()
    });
    this.addCommand({
      id: "focus-nox-composer",
      name: "Focus Nox composer",
      hotkeys: [{ modifiers: ["Mod"], key: "l" }],
      callback: async () => {
        await this.activateView();
        setTimeout(() => {
          var _a;
          const leaves = this.app.workspace.getLeavesOfType(NOX_VIEW_TYPE);
          const view = (_a = leaves[0]) == null ? void 0 : _a.view;
          view == null ? void 0 : view.focusComposer();
        }, 100);
      }
    });
  }
  async onunload() {
    var _a;
    this.app.workspace.detachLeavesOfType(NOX_VIEW_TYPE);
    (_a = this.learning) == null ? void 0 : _a.dispose();
  }
  async activateView() {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(NOX_VIEW_TYPE);
    if (existing.length > 0) {
      workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({
      type: NOX_VIEW_TYPE,
      active: true
    });
    workspace.revealLeaf(leaf);
  }
  getSettings() {
    return { ...this.noxSettings };
  }
  getLogoUrl() {
    const pluginPath = `${this.manifest.dir}/nox.png`;
    return this.app.vault.adapter.getResourcePath(pluginPath);
  }
  async updateSettings(update) {
    this.noxSettings = { ...this.noxSettings, ...update };
    await saveNoxSettings(this, this.noxSettings);
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
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsic3JjL21haW4udHMiLCAic3JjL2FnZW50L0FneUFkYXB0ZXIudHMiLCAic3JjL2FnZW50L0FneVByb3RvY29sLnRzIiwgInNyYy9jaGF0L0NoYXRWaWV3LnRzIiwgInNyYy9jaGF0L3Byb21wdC10b2tlbi50cyIsICJzcmMvY2hhdC9jYXBhYmlsaXRpZXMudHMiLCAic3JjL2NvbnRleHQvQ29udGV4dFJlc29sdmVyLnRzIiwgInNyYy9jb250ZXh0L09ic2lkaWFuQ29udGV4dC50cyIsICJzcmMvY29udGV4dC9Qb2xpY3lMb2FkZXIudHMiLCAic3JjL2xlYXJuaW5nL2FjdGlvbi1idWlsZGVycy50cyIsICJzcmMvbGVhcm5pbmcvbGVhcm5pbmctc3RhdGUtcHJvamVjdGlvbi50cyIsICJzcmMvbGVhcm5pbmcvUHJhY3RpY2VTdGF0ZU1hY2hpbmUudHMiLCAic3JjL2xlYXJuaW5nL1N0cnVjdHVyZWRTdHJlYW1QYXJzZXIudHMiLCAic3JjL2xlYXJuaW5nL0xlYXJuaW5nQ29udHJvbGxlci50cyIsICJzcmMvbXV0YXRpb24vTXV0YXRpb25TZXJ2aWNlLnRzIiwgInNyYy9tdXRhdGlvbi9yZXBsYWNlbWVudC50cyIsICJzcmMvcGVyc2lzdGVuY2UvVmF1bHRMZWFybmluZ1N0b3JlLnRzIiwgInNyYy9sZWFybmluZy9sZWFybmluZy1zdGF0ZS50cyIsICJzcmMvcGVyc2lzdGVuY2UvbGVhcm5pbmctc3RhdGUtc2NoZW1hLnRzIiwgInNyYy9zZXNzaW9uL1Nlc3Npb25Db250cm9sbGVyLnRzIiwgInNyYy9zZXNzaW9uL1Nlc3Npb25TdG9yZS50cyIsICJzcmMvc2V0dGluZ3MvTm94U2V0dGluZ3MudHMiLCAic3JjL3NldHRpbmdzL1NldHRpbmdzVGFiLnRzIl0sCiAgInNvdXJjZXNDb250ZW50IjogWyJpbXBvcnQgeyBhZGRJY29uLCBGaWxlU3lzdGVtQWRhcHRlciwgUGx1Z2luIH0gZnJvbSBcIm9ic2lkaWFuXCI7XHJcbmltcG9ydCB7IEFneUFkYXB0ZXIgfSBmcm9tIFwiLi9hZ2VudC9BZ3lBZGFwdGVyXCI7XHJcbmltcG9ydCB7IENoYXRWaWV3LCBOT1hfVklFV19UWVBFIH0gZnJvbSBcIi4vY2hhdC9DaGF0Vmlld1wiO1xyXG5pbXBvcnQgeyBDb250ZXh0UmVzb2x2ZXIgfSBmcm9tIFwiLi9jb250ZXh0L0NvbnRleHRSZXNvbHZlclwiO1xyXG5pbXBvcnQgeyBPYnNpZGlhbkNvbnRleHQgfSBmcm9tIFwiLi9jb250ZXh0L09ic2lkaWFuQ29udGV4dFwiO1xyXG5pbXBvcnQgeyBQb2xpY3lMb2FkZXIgfSBmcm9tIFwiLi9jb250ZXh0L1BvbGljeUxvYWRlclwiO1xyXG5pbXBvcnQgeyBMZWFybmluZ0NvbnRyb2xsZXIgfSBmcm9tIFwiLi9sZWFybmluZy9MZWFybmluZ0NvbnRyb2xsZXJcIjtcclxuaW1wb3J0IHsgTXV0YXRpb25TZXJ2aWNlIH0gZnJvbSBcIi4vbXV0YXRpb24vTXV0YXRpb25TZXJ2aWNlXCI7XHJcbmltcG9ydCB7IFZhdWx0TGVhcm5pbmdTdG9yZSB9IGZyb20gXCIuL3BlcnNpc3RlbmNlL1ZhdWx0TGVhcm5pbmdTdG9yZVwiO1xyXG5pbXBvcnQgeyBTZXNzaW9uQ29udHJvbGxlciB9IGZyb20gXCIuL3Nlc3Npb24vU2Vzc2lvbkNvbnRyb2xsZXJcIjtcclxuaW1wb3J0IHsgU2Vzc2lvblN0b3JlIH0gZnJvbSBcIi4vc2Vzc2lvbi9TZXNzaW9uU3RvcmVcIjtcclxuaW1wb3J0IHtcclxuICBkZWNvZGVOb3hTZXR0aW5ncyxcclxuICBOb3hTZXR0aW5ncyxcclxuICBzYXZlTm94U2V0dGluZ3MsXHJcbn0gZnJvbSBcIi4vc2V0dGluZ3MvTm94U2V0dGluZ3NcIjtcclxuaW1wb3J0IHsgTm94U2V0dGluZ3NUYWIgfSBmcm9tIFwiLi9zZXR0aW5ncy9TZXR0aW5nc1RhYlwiO1xyXG5cclxuLyoqXHJcbiAqIENvbXBvc2l0aW9uIHJvb3QuXHJcbiAqXHJcbiAqIEJ1c2luZXNzIGJlaGF2aW9yIGJlbG9uZ3MgaW4gTGVhcm5pbmdDb250cm9sbGVyL3NlcnZpY2VzOyB0aGlzIGZpbGUgb25seVxyXG4gKiBjb25zdHJ1Y3RzIGRlcGVuZGVuY2llcywgcmVnaXN0ZXJzIE9ic2lkaWFuIHN1cmZhY2VzLCBhbmQgZGlzcG9zZXMgcnVudGltZVxyXG4gKiByZXNvdXJjZXMuXHJcbiAqL1xyXG5leHBvcnQgZGVmYXVsdCBjbGFzcyBOb3hQbHVnaW4gZXh0ZW5kcyBQbHVnaW4ge1xyXG4gIHByaXZhdGUgbGVhcm5pbmchOiBMZWFybmluZ0NvbnRyb2xsZXI7XHJcbiAgcHJpdmF0ZSBub3hTZXR0aW5ncyE6IE5veFNldHRpbmdzO1xyXG5cclxuICBhc3luYyBvbmxvYWQoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCB2YXVsdEFkYXB0ZXIgPSB0aGlzLmFwcC52YXVsdC5hZGFwdGVyO1xyXG4gICAgY29uc3QgdmF1bHRQYXRoID1cclxuICAgICAgdmF1bHRBZGFwdGVyIGluc3RhbmNlb2YgRmlsZVN5c3RlbUFkYXB0ZXJcclxuICAgICAgICA/IHZhdWx0QWRhcHRlci5nZXRCYXNlUGF0aCgpXHJcbiAgICAgICAgOiB1bmRlZmluZWQ7XHJcblxyXG4gICAgdGhpcy5ub3hTZXR0aW5ncyA9IGRlY29kZU5veFNldHRpbmdzKGF3YWl0IHRoaXMubG9hZERhdGEoKSk7XHJcbiAgICBjb25zdCBhZGFwdGVyID0gbmV3IEFneUFkYXB0ZXIodmF1bHRQYXRoLCAoKSA9PiAoe1xyXG4gICAgICBleGVjdXRhYmxlUGF0aDogdGhpcy5ub3hTZXR0aW5ncy5leGVjdXRhYmxlUGF0aCxcclxuICAgIH0pKTtcclxuICAgIGNvbnN0IHNlc3Npb25TdG9yZSA9IG5ldyBTZXNzaW9uU3RvcmUoKTtcclxuICAgIGNvbnN0IHNlc3Npb25zID0gbmV3IFNlc3Npb25Db250cm9sbGVyKFxyXG4gICAgICB0aGlzLFxyXG4gICAgICBzZXNzaW9uU3RvcmUsXHJcbiAgICAgIGFkYXB0ZXIsXHJcbiAgICApO1xyXG5cclxuICAgIGF3YWl0IHNlc3Npb25zLmluaXQoKTtcclxuICAgIGlmICghc2Vzc2lvbnMuZ2V0U2Vzc2lvbigpLm1vZGVsICYmIHRoaXMubm94U2V0dGluZ3MucHJlZmVycmVkTW9kZWwpIHtcclxuICAgICAgc2Vzc2lvbnMuc2V0TW9kZWwodGhpcy5ub3hTZXR0aW5ncy5wcmVmZXJyZWRNb2RlbCk7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3Qgb2JzaWRpYW5Db250ZXh0ID0gbmV3IE9ic2lkaWFuQ29udGV4dCh0aGlzLmFwcCwgdGhpcyk7XHJcbiAgICBjb25zdCBjb250ZXh0cyA9IG5ldyBDb250ZXh0UmVzb2x2ZXIob2JzaWRpYW5Db250ZXh0KTtcclxuICAgIGNvbnN0IHBvbGljaWVzID0gbmV3IFBvbGljeUxvYWRlcih0aGlzLmFwcCk7XHJcbiAgICBjb25zdCBtdXRhdGlvbnMgPSBuZXcgTXV0YXRpb25TZXJ2aWNlKHRoaXMuYXBwKTtcclxuICAgIGNvbnN0IGxlYXJuaW5nU3RhdGUgPSBuZXcgVmF1bHRMZWFybmluZ1N0b3JlKHRoaXMuYXBwKTtcclxuXHJcbiAgICB0aGlzLmxlYXJuaW5nID0gbmV3IExlYXJuaW5nQ29udHJvbGxlcihcclxuICAgICAgc2Vzc2lvbnMsXHJcbiAgICAgIGNvbnRleHRzLFxyXG4gICAgICBwb2xpY2llcyxcclxuICAgICAgbXV0YXRpb25zLFxyXG4gICAgICBsZWFybmluZ1N0YXRlLFxyXG4gICAgKTtcclxuXHJcbiAgICBjb25zdCBsb2dvVXJsID0gdGhpcy5nZXRMb2dvVXJsKCkucmVwbGFjZSgvJi9nLCBcIiZhbXA7XCIpO1xyXG4gICAgYWRkSWNvbihcclxuICAgICAgXCJub3gtbG9nb1wiLFxyXG4gICAgICBgPGltYWdlIGhyZWY9XCIke2xvZ29Vcmx9XCIgeD1cIjBcIiB5PVwiMFwiIHdpZHRoPVwiMTAwJVwiIGhlaWdodD1cIjEwMCVcIiBwcmVzZXJ2ZUFzcGVjdFJhdGlvPVwieE1pZFlNaWQgc2xpY2VcIiAvPmAsXHJcbiAgICApO1xyXG5cclxuICAgIHRoaXMucmVnaXN0ZXJWaWV3KFxyXG4gICAgICBOT1hfVklFV19UWVBFLFxyXG4gICAgICAobGVhZikgPT4gbmV3IENoYXRWaWV3KFxyXG4gICAgICAgIGxlYWYsXHJcbiAgICAgICAgdGhpcy5sZWFybmluZyxcclxuICAgICAgICAoKSA9PiB0aGlzLm9wZW5TZXR0aW5ncygpLFxyXG4gICAgICAgICgpID0+IHRoaXMuZ2V0TG9nb1VybCgpLFxyXG4gICAgICApLFxyXG4gICAgKTtcclxuXHJcbiAgICB0aGlzLmFkZFNldHRpbmdUYWIobmV3IE5veFNldHRpbmdzVGFiKHRoaXMuYXBwLCB0aGlzKSk7XHJcblxyXG4gICAgdGhpcy5hZGRSaWJib25JY29uKFxyXG4gICAgICBcIm5veC1sb2dvXCIsXHJcbiAgICAgIFwiT3BlbiBOb3hcIixcclxuICAgICAgKCkgPT4gdGhpcy5hY3RpdmF0ZVZpZXcoKSxcclxuICAgICk7XHJcblxyXG4gICAgdGhpcy5hZGRDb21tYW5kKHtcclxuICAgICAgaWQ6IFwib3Blbi1ub3gtc2lkZWJhclwiLFxyXG4gICAgICBuYW1lOiBcIk9wZW4gTm94IHNpZGViYXJcIixcclxuICAgICAgY2FsbGJhY2s6ICgpID0+IHRoaXMuYWN0aXZhdGVWaWV3KCksXHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLmFkZENvbW1hbmQoe1xyXG4gICAgICBpZDogXCJmb2N1cy1ub3gtY29tcG9zZXJcIixcclxuICAgICAgbmFtZTogXCJGb2N1cyBOb3ggY29tcG9zZXJcIixcclxuICAgICAgaG90a2V5czogW3sgbW9kaWZpZXJzOiBbXCJNb2RcIl0sIGtleTogXCJsXCIgfV0sXHJcbiAgICAgIGNhbGxiYWNrOiBhc3luYyAoKSA9PiB7XHJcbiAgICAgICAgYXdhaXQgdGhpcy5hY3RpdmF0ZVZpZXcoKTtcclxuXHJcbiAgICAgICAgc2V0VGltZW91dCgoKSA9PiB7XHJcbiAgICAgICAgICBjb25zdCBsZWF2ZXMgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0TGVhdmVzT2ZUeXBlKE5PWF9WSUVXX1RZUEUpO1xyXG4gICAgICAgICAgY29uc3QgdmlldyA9IGxlYXZlc1swXT8udmlldyBhcyBDaGF0VmlldyB8IHVuZGVmaW5lZDtcclxuICAgICAgICAgIHZpZXc/LmZvY3VzQ29tcG9zZXIoKTtcclxuICAgICAgICB9LCAxMDApO1xyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBvbnVubG9hZCgpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIHRoaXMuYXBwLndvcmtzcGFjZS5kZXRhY2hMZWF2ZXNPZlR5cGUoTk9YX1ZJRVdfVFlQRSk7XHJcbiAgICB0aGlzLmxlYXJuaW5nPy5kaXNwb3NlKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGFjdGl2YXRlVmlldygpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IHsgd29ya3NwYWNlIH0gPSB0aGlzLmFwcDtcclxuICAgIGNvbnN0IGV4aXN0aW5nID0gd29ya3NwYWNlLmdldExlYXZlc09mVHlwZShOT1hfVklFV19UWVBFKTtcclxuXHJcbiAgICBpZiAoZXhpc3RpbmcubGVuZ3RoID4gMCkge1xyXG4gICAgICB3b3Jrc3BhY2UucmV2ZWFsTGVhZihleGlzdGluZ1swXSk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBsZWFmID0gd29ya3NwYWNlLmdldFJpZ2h0TGVhZihmYWxzZSk7XHJcbiAgICBpZiAoIWxlYWYpIHJldHVybjtcclxuXHJcbiAgICBhd2FpdCBsZWFmLnNldFZpZXdTdGF0ZSh7XHJcbiAgICAgIHR5cGU6IE5PWF9WSUVXX1RZUEUsXHJcbiAgICAgIGFjdGl2ZTogdHJ1ZSxcclxuICAgIH0pO1xyXG4gICAgd29ya3NwYWNlLnJldmVhbExlYWYobGVhZik7XHJcbiAgfVxyXG5cclxuICBnZXRTZXR0aW5ncygpOiBOb3hTZXR0aW5ncyB7XHJcbiAgICByZXR1cm4geyAuLi50aGlzLm5veFNldHRpbmdzIH07XHJcbiAgfVxyXG5cclxuICBnZXRMb2dvVXJsKCk6IHN0cmluZyB7XHJcbiAgICBjb25zdCBwbHVnaW5QYXRoID0gYCR7dGhpcy5tYW5pZmVzdC5kaXJ9L25veC5wbmdgO1xyXG4gICAgcmV0dXJuIHRoaXMuYXBwLnZhdWx0LmFkYXB0ZXIuZ2V0UmVzb3VyY2VQYXRoKHBsdWdpblBhdGgpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgdXBkYXRlU2V0dGluZ3ModXBkYXRlOiBQYXJ0aWFsPE5veFNldHRpbmdzPik6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdGhpcy5ub3hTZXR0aW5ncyA9IHsgLi4udGhpcy5ub3hTZXR0aW5ncywgLi4udXBkYXRlIH07XHJcbiAgICBhd2FpdCBzYXZlTm94U2V0dGluZ3ModGhpcywgdGhpcy5ub3hTZXR0aW5ncyk7XHJcbiAgICBpZiAodXBkYXRlLnByZWZlcnJlZE1vZGVsICE9PSB1bmRlZmluZWQpIHtcclxuICAgICAgdGhpcy5sZWFybmluZy5zZXRNb2RlbCh1cGRhdGUucHJlZmVycmVkTW9kZWwgfHwgdW5kZWZpbmVkKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgb3BlblNldHRpbmdzKCk6IHZvaWQge1xyXG4gICAgY29uc3QgYXBwID0gdGhpcy5hcHAgYXMgdHlwZW9mIHRoaXMuYXBwICYge1xyXG4gICAgICBzZXR0aW5nOiB7XHJcbiAgICAgICAgb3BlbigpOiB2b2lkO1xyXG4gICAgICAgIG9wZW5UYWJCeUlkKGlkOiBzdHJpbmcpOiB2b2lkO1xyXG4gICAgICB9O1xyXG4gICAgfTtcclxuICAgIGFwcC5zZXR0aW5nLm9wZW4oKTtcclxuICAgIGFwcC5zZXR0aW5nLm9wZW5UYWJCeUlkKHRoaXMubWFuaWZlc3QuaWQpO1xyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgQ2hpbGRQcm9jZXNzLCBzcGF3biB9IGZyb20gXCJjaGlsZF9wcm9jZXNzXCI7XHJcbmltcG9ydCB7IGV4aXN0c1N5bmMgfSBmcm9tIFwiZnNcIjtcclxuaW1wb3J0IHsgaG9tZWRpciB9IGZyb20gXCJvc1wiO1xyXG5pbXBvcnQgeyBqb2luIH0gZnJvbSBcInBhdGhcIjtcclxuaW1wb3J0IHtcclxuICBBZ2VudEFkYXB0ZXIsXHJcbiAgQWdlbnRJbnB1dCxcclxuICBBZ2VudENvbnRleHQsXHJcbiAgQWdlbnRTdHJlYW1FdmVudCxcclxuICBBZ2VudE1vZGVsLFxyXG4gIEFnZW50RmFpbHVyZSxcclxuICBBZ2VudEhlYWx0aCxcclxuICBBZ2VudFJ1bnRpbWVDb25maWcsXHJcbiAgU2VuZE9wdGlvbnMsXHJcbn0gZnJvbSBcIi4uL3R5cGVzXCI7XHJcbmltcG9ydCB7XHJcbiAgQWd5UHJvdG9jb2xTdGF0ZSxcclxuICBlbmNvZGVBZ3lVc2VyTWVzc2FnZSxcclxuICBwYXJzZUFneUxpbmUsXHJcbn0gZnJvbSBcIi4vQWd5UHJvdG9jb2xcIjtcclxuXHJcbmZ1bmN0aW9uIGVzY2FwZUF0dHJpYnV0ZSh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICByZXR1cm4gdmFsdWVcclxuICAgIC5yZXBsYWNlKC8mL2csIFwiJmFtcDtcIilcclxuICAgIC5yZXBsYWNlKC9cIi9nLCBcIiZxdW90O1wiKVxyXG4gICAgLnJlcGxhY2UoLzwvZywgXCImbHQ7XCIpXHJcbiAgICAucmVwbGFjZSgvPi9nLCBcIiZndDtcIik7XHJcbn1cclxuXHJcbi8vIEFHWSBoZWFkbGVzcyBwcm90b2NvbCB1c2VkIGJ5IHRoaXMgYWRhcHRlcjpcclxuLy9cclxuLy8gICBhZ3kgLS1pbnB1dC1mb3JtYXQgc3RyZWFtLWpzb24gLS1vdXRwdXQtZm9ybWF0IHN0cmVhbS1qc29uXHJcbi8vICAgICAgIFstLW1vZGVsIDxpZD5dIFstLWNvbnZlcnNhdGlvbiA8aWQ+XVxyXG4vL1xyXG4vLyBQcm9tcHRzIGFyZSB3cml0dGVuIHRvIHN0ZGluIGFzIG9uZSBKU09OIHVzZXIgZXZlbnQgcGVyIGxpbmUuIFRoaXMga2VlcHNcclxuLy8gbm90ZS9jb250ZXh0IHBheWxvYWRzIG91dCBvZiBPUyBhcmd2IGFuZCBhdm9pZHMgY29tbWFuZC1saW5lIHNpemUgbGltaXRzLlxyXG4vLyBFYWNoIHNlbmQoKSBzdGlsbCBvd25zIG9uZSBwcm9jZXNzIHNvIGNhbmNlbGxhdGlvbiBhbmQgY29udmVyc2F0aW9uXHJcbi8vIHBlcnNpc3RlbmNlIHJlbWFpbiBzaW1wbGUgYXQgdGhlIE5veCBib3VuZGFyeS5cclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgQWd5UnVudGltZURlcHMge1xyXG4gIHNwYXduOiB0eXBlb2Ygc3Bhd247XHJcbiAgZXhpc3RzU3luYzogdHlwZW9mIGV4aXN0c1N5bmM7XHJcbiAgaG9tZWRpcjogdHlwZW9mIGhvbWVkaXI7XHJcbiAgcGxhdGZvcm06IE5vZGVKUy5QbGF0Zm9ybTtcclxuICBlbnY6IE5vZGVKUy5Qcm9jZXNzRW52O1xyXG59XHJcblxyXG5jb25zdCBERUZBVUxUX1JVTlRJTUVfREVQUzogQWd5UnVudGltZURlcHMgPSB7XHJcbiAgc3Bhd24sXHJcbiAgZXhpc3RzU3luYyxcclxuICBob21lZGlyLFxyXG4gIHBsYXRmb3JtOiBwcm9jZXNzLnBsYXRmb3JtLFxyXG4gIGVudjogcHJvY2Vzcy5lbnYsXHJcbn07XHJcblxyXG5leHBvcnQgY2xhc3MgQWd5QWRhcHRlciBpbXBsZW1lbnRzIEFnZW50QWRhcHRlciB7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBkZXBzOiBBZ3lSdW50aW1lRGVwcztcclxuXHJcbiAgY29uc3RydWN0b3IoXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IGN3ZD86IHN0cmluZyxcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgZ2V0Q29uZmlnOiAoKSA9PiBBZ2VudFJ1bnRpbWVDb25maWcgPSAoKSA9PiAoe30pLFxyXG4gICAgZGVwczogUGFydGlhbDxBZ3lSdW50aW1lRGVwcz4gPSB7fSxcclxuICApIHtcclxuICAgIHRoaXMuZGVwcyA9IHtcclxuICAgICAgLi4uREVGQVVMVF9SVU5USU1FX0RFUFMsXHJcbiAgICAgIC4uLmRlcHMsXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgY2hlY2soKTogUHJvbWlzZTxBZ2VudEhlYWx0aD4ge1xyXG4gICAgdHJ5IHtcclxuICAgICAgYXdhaXQgdGhpcy5yZXNvbHZlQmluYXJ5KCk7XHJcbiAgICAgIHJldHVybiB7IHN0YXR1czogXCJyZWFkeVwiIH07XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICBjb25zdCBjb25maWd1cmVkID0gdGhpcy5nZXRDb25maWcoKS5leGVjdXRhYmxlUGF0aD8udHJpbSgpO1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIHN0YXR1czogY29uZmlndXJlZCA/IFwibWlzY29uZmlndXJlZFwiIDogXCJ1bmF2YWlsYWJsZVwiLFxyXG4gICAgICAgIGZhaWx1cmU6IHRoaXMuZmFpbHVyZUZyb20oZXJyb3IsIFwicnVudGltZS11bmF2YWlsYWJsZVwiKSxcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgcmVzb2x2ZUJpbmFyeSgpOiBQcm9taXNlPHN0cmluZz4ge1xyXG4gICAgY29uc3QgY29uZmlndXJlZCA9XHJcbiAgICAgIHRoaXMuZ2V0Q29uZmlnKCkuZXhlY3V0YWJsZVBhdGg/LnRyaW0oKSB8fFxyXG4gICAgICB0aGlzLmRlcHMuZW52LkFHWV9QQVRIPy50cmltKCk7XHJcblxyXG4gICAgaWYgKGNvbmZpZ3VyZWQgJiYgIXRoaXMuZGVwcy5leGlzdHNTeW5jKGNvbmZpZ3VyZWQpKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcclxuICAgICAgICBgQ29uZmlndXJlZCBhZ2VudCBleGVjdXRhYmxlIGRvZXMgbm90IGV4aXN0OiAke2NvbmZpZ3VyZWR9YCxcclxuICAgICAgKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBjYW5kaWRhdGVzID0gW1xyXG4gICAgICBjb25maWd1cmVkLFxyXG4gICAgICAuLi4odGhpcy5kZXBzLnBsYXRmb3JtID09PSBcIndpbjMyXCJcclxuICAgICAgICA/IFtcclxuICAgICAgICAgICAgdGhpcy5kZXBzLmVudi5MT0NBTEFQUERBVEFcclxuICAgICAgICAgICAgICA/IGpvaW4odGhpcy5kZXBzLmVudi5MT0NBTEFQUERBVEEsIFwiYWd5XCIsIFwiYmluXCIsIFwiYWd5LmV4ZVwiKVxyXG4gICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxyXG4gICAgICAgICAgICB0aGlzLmRlcHMuZW52LlByb2dyYW1GaWxlc1xyXG4gICAgICAgICAgICAgID8gam9pbihcclxuICAgICAgICAgICAgICAgICAgdGhpcy5kZXBzLmVudi5Qcm9ncmFtRmlsZXMsXHJcbiAgICAgICAgICAgICAgICAgIFwiR29vZ2xlXCIsXHJcbiAgICAgICAgICAgICAgICAgIFwiYW50aWdyYXZpdHktY2xpXCIsXHJcbiAgICAgICAgICAgICAgICAgIFwiYWd5LmV4ZVwiLFxyXG4gICAgICAgICAgICAgICAgKVxyXG4gICAgICAgICAgICAgIDogdW5kZWZpbmVkLFxyXG4gICAgICAgICAgXVxyXG4gICAgICAgIDogW2pvaW4odGhpcy5kZXBzLmhvbWVkaXIoKSwgXCIubG9jYWxcIiwgXCJiaW5cIiwgXCJhZ3lcIildKSxcclxuICAgIF0uZmlsdGVyKCh2YWx1ZSk6IHZhbHVlIGlzIHN0cmluZyA9PiBCb29sZWFuKHZhbHVlKSk7XHJcblxyXG4gICAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgY2FuZGlkYXRlcykge1xyXG4gICAgICBpZiAodGhpcy5kZXBzLmV4aXN0c1N5bmMoY2FuZGlkYXRlKSkgcmV0dXJuIGNhbmRpZGF0ZTtcclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICBjb25zdCBsb2NhdG9yID0gdGhpcy5kZXBzLnBsYXRmb3JtID09PSBcIndpbjMyXCIgPyBcIndoZXJlXCIgOiBcIndoaWNoXCI7XHJcbiAgICAgIGNvbnN0IGNoaWxkID0gdGhpcy5kZXBzLnNwYXduKGxvY2F0b3IsIFtcImFneVwiXSk7XHJcbiAgICAgIGxldCBvdXQgPSBcIlwiO1xyXG4gICAgICBsZXQgc2V0dGxlZCA9IGZhbHNlO1xyXG5cclxuICAgICAgY29uc3QgZmFpbCA9ICgpID0+IHtcclxuICAgICAgICBpZiAoc2V0dGxlZCkgcmV0dXJuO1xyXG4gICAgICAgIHNldHRsZWQgPSB0cnVlO1xyXG4gICAgICAgIHJlamVjdChcclxuICAgICAgICAgIG5ldyBFcnJvcihcclxuICAgICAgICAgICAgXCJBR1kgQ0xJIG5vdCBmb3VuZC4gSW5zdGFsbCBpdCwgcmVzdGFydCBPYnNpZGlhbiBhZnRlciBjaGFuZ2luZyBQQVRILCBvciBzZXQgQUdZX1BBVEggdG8gdGhlIEFHWSBleGVjdXRhYmxlLlwiLFxyXG4gICAgICAgICAgKSxcclxuICAgICAgICApO1xyXG4gICAgICB9O1xyXG5cclxuICAgICAgY2hpbGQuc3Rkb3V0Py5vbihcImRhdGFcIiwgKGRhdGE6IEJ1ZmZlcikgPT4ge1xyXG4gICAgICAgIG91dCArPSBkYXRhLnRvU3RyaW5nKCk7XHJcbiAgICAgIH0pO1xyXG4gICAgICBjaGlsZC5vbihcImVycm9yXCIsIGZhaWwpO1xyXG4gICAgICBjaGlsZC5vbihcImNsb3NlXCIsIChjb2RlKSA9PiB7XHJcbiAgICAgICAgaWYgKHNldHRsZWQpIHJldHVybjtcclxuXHJcbiAgICAgICAgaWYgKGNvZGUgPT09IDAgJiYgb3V0LnRyaW0oKSkge1xyXG4gICAgICAgICAgc2V0dGxlZCA9IHRydWU7XHJcbiAgICAgICAgICByZXNvbHZlKG91dC50cmltKCkuc3BsaXQoL1xccj9cXG4vKVswXSk7XHJcbiAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBmYWlsKCk7XHJcbiAgICAgIH0pO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBhc3luYyAqc2VuZChcclxuICAgIGlucHV0OiBBZ2VudElucHV0LFxyXG4gICAgb3B0czogU2VuZE9wdGlvbnMsXHJcbiAgICBzaWduYWw6IEFib3J0U2lnbmFsLFxyXG4gICk6IEFzeW5jSXRlcmFibGU8QWdlbnRTdHJlYW1FdmVudD4ge1xyXG4gICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XHJcbiAgICAgIHlpZWxkIHsgdHlwZTogXCJjYW5jZWxsZWRcIiB9O1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgbGV0IGJpbjogc3RyaW5nO1xyXG4gICAgdHJ5IHtcclxuICAgICAgYmluID0gYXdhaXQgdGhpcy5yZXNvbHZlQmluYXJ5KCk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICB5aWVsZCB7XHJcbiAgICAgICAgdHlwZTogXCJmYWlsZWRcIixcclxuICAgICAgICBmYWlsdXJlOiB0aGlzLmZhaWx1cmVGcm9tKGVycm9yLCBcInJ1bnRpbWUtdW5hdmFpbGFibGVcIiksXHJcbiAgICAgIH07XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBwcm9jID0gdGhpcy5kZXBzLnNwYXduKGJpbiwgdGhpcy5idWlsZEFyZ3Mob3B0cyksIHtcclxuICAgICAgY3dkOiB0aGlzLmN3ZCxcclxuICAgICAgc3RkaW86IFtcInBpcGVcIiwgXCJwaXBlXCIsIFwicGlwZVwiXSxcclxuICAgICAgd2luZG93c0hpZGU6IHRydWUsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBhYm9ydCA9ICgpID0+IHtcclxuICAgICAgaWYgKHByb2MuZXhpdENvZGUgPT09IG51bGwgJiYgIXByb2Mua2lsbGVkKSB7XHJcbiAgICAgICAgcHJvYy5raWxsKFwiU0lHVEVSTVwiKTtcclxuICAgICAgfVxyXG4gICAgfTtcclxuICAgIHNpZ25hbC5hZGRFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnQsIHsgb25jZTogdHJ1ZSB9KTtcclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBpZiAoIXByb2Muc3RkaW4pIHtcclxuICAgICAgICB5aWVsZCB7XHJcbiAgICAgICAgICB0eXBlOiBcImZhaWxlZFwiLFxyXG4gICAgICAgICAgZmFpbHVyZTogdGhpcy5mYWlsdXJlRnJvbShcclxuICAgICAgICAgICAgXCJBR1kgc3RkaW4gaXMgdW5hdmFpbGFibGUuXCIsXHJcbiAgICAgICAgICAgIFwicHJvY2Vzcy1mYWlsZWRcIixcclxuICAgICAgICAgICksXHJcbiAgICAgICAgfTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IGZ1bGxQcm9tcHQgPSB0aGlzLmJ1aWxkRnVsbFByb21wdChpbnB1dCk7XHJcbiAgICAgIHByb2Muc3RkaW4uZW5kKGVuY29kZUFneVVzZXJNZXNzYWdlKGZ1bGxQcm9tcHQpKTtcclxuXHJcbiAgICAgIHlpZWxkKiB0aGlzLnJlYWRFdmVudHMocHJvYywgc2lnbmFsKTtcclxuICAgIH0gZmluYWxseSB7XHJcbiAgICAgIHNpZ25hbC5yZW1vdmVFdmVudExpc3RlbmVyKFwiYWJvcnRcIiwgYWJvcnQpO1xyXG4gICAgICBhYm9ydCgpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBidWlsZEFyZ3Mob3B0czogU2VuZE9wdGlvbnMpOiBzdHJpbmdbXSB7XHJcbiAgICBjb25zdCBhcmdzID0gW1xyXG4gICAgICBcIi0taW5wdXQtZm9ybWF0XCIsXHJcbiAgICAgIFwic3RyZWFtLWpzb25cIixcclxuICAgICAgXCItLW91dHB1dC1mb3JtYXRcIixcclxuICAgICAgXCJzdHJlYW0tanNvblwiLFxyXG4gICAgXTtcclxuXHJcbiAgICBpZiAob3B0cy5tb2RlbCkge1xyXG4gICAgICBhcmdzLnB1c2goXCItLW1vZGVsXCIsIG9wdHMubW9kZWwpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChvcHRzLmNvbnZlcnNhdGlvbklkKSB7XHJcbiAgICAgIGFyZ3MucHVzaChcIi0tY29udmVyc2F0aW9uXCIsIG9wdHMuY29udmVyc2F0aW9uSWQpO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiBhcmdzO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBidWlsZEZ1bGxQcm9tcHQoaW5wdXQ6IEFnZW50SW5wdXQpOiBzdHJpbmcge1xyXG4gICAgY29uc3QgY29udGV4dFByZWFtYmxlID0gdGhpcy5mb3JtYXRDb250ZXh0KGlucHV0LmNvbnRleHQpO1xyXG5cclxuICAgIHJldHVybiBjb250ZXh0UHJlYW1ibGVcclxuICAgICAgPyBgJHtjb250ZXh0UHJlYW1ibGV9XFxuXFxuLS0tXFxuXFxuJHtpbnB1dC5wcm9tcHR9YFxyXG4gICAgICA6IGlucHV0LnByb21wdDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZm9ybWF0Q29udGV4dChjdHg6IEFnZW50Q29udGV4dFtdKTogc3RyaW5nIHtcclxuICAgIGlmIChjdHgubGVuZ3RoID09PSAwKSByZXR1cm4gXCJcIjtcclxuXHJcbiAgICByZXR1cm4gY3R4XHJcbiAgICAgIC5tYXAoKGNvbnRleHQsIGluZGV4KSA9PiB7XHJcbiAgICAgICAgY29uc3QgdHlwZSA9XHJcbiAgICAgICAgICBjb250ZXh0LnR5cGUgPT09IFwic2VsZWN0aW9uXCIgPyBcInNlbGVjdGlvblwiIDogXCJub3RlXCI7XHJcbiAgICAgICAgY29uc3QgaGVhZGVyID1cclxuICAgICAgICAgIGA8b2JzaWRpYW4tY29udGV4dCBpbmRleD1cIiR7aW5kZXggKyAxfVwiIHR5cGU9XCIke3R5cGV9XCIgZmlsZT1cIiR7ZXNjYXBlQXR0cmlidXRlKGNvbnRleHQuZmlsZSl9XCI+YDtcclxuXHJcbiAgICAgICAgcmV0dXJuIChcclxuICAgICAgICAgIGAke2hlYWRlcn1cXG4ke2NvbnRleHQuY29udGVudH1cXG48L29ic2lkaWFuLWNvbnRleHQ+YFxyXG4gICAgICAgICk7XHJcbiAgICAgIH0pXHJcbiAgICAgIC5qb2luKFwiXFxuXFxuXCIpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyAqcmVhZEV2ZW50cyhcclxuICAgIHByb2M6IENoaWxkUHJvY2VzcyxcclxuICAgIHNpZ25hbDogQWJvcnRTaWduYWwsXHJcbiAgKTogQXN5bmNJdGVyYWJsZTxBZ2VudFN0cmVhbUV2ZW50PiB7XHJcbiAgICBsZXQgYnVmZmVyID0gXCJcIjtcclxuICAgIGxldCBzdGRlcnIgPSBcIlwiO1xyXG4gICAgbGV0IGV4aXRDb2RlOiBudW1iZXIgfCBudWxsID0gbnVsbDtcclxuICAgIGNvbnN0IHByb2Nlc3NTdGF0ZToge1xyXG4gICAgICBzcGF3bkVycm9yPzogRXJyb3I7XHJcbiAgICAgIGlucHV0RXJyb3I/OiBFcnJvcjtcclxuICAgIH0gPSB7fTtcclxuICAgIGxldCBjbG9zZWQgPSBmYWxzZTtcclxuICAgIGxldCBzYXdUZXJtaW5hbEV2ZW50ID0gZmFsc2U7XHJcbiAgICBsZXQgcHJvdG9jb2xTdGF0ZTogQWd5UHJvdG9jb2xTdGF0ZSA9IHtcclxuICAgICAgc2F3VGV4dDogZmFsc2UsXHJcbiAgICB9O1xyXG5cclxuICAgIGNvbnN0IHF1ZXVlOiBzdHJpbmdbXSA9IFtdO1xyXG4gICAgbGV0IG5vdGlmeTogKCgpID0+IHZvaWQpIHwgbnVsbCA9IG51bGw7XHJcblxyXG4gICAgY29uc3Qgd2FrZSA9ICgpID0+IHtcclxuICAgICAgbm90aWZ5Py4oKTtcclxuICAgICAgbm90aWZ5ID0gbnVsbDtcclxuICAgIH07XHJcblxyXG4gICAgY29uc3QgcHVzaCA9IChsaW5lOiBzdHJpbmcpID0+IHtcclxuICAgICAgcXVldWUucHVzaChsaW5lKTtcclxuICAgICAgd2FrZSgpO1xyXG4gICAgfTtcclxuXHJcbiAgICBwcm9jLnN0ZG91dD8ub24oXCJkYXRhXCIsIChjaHVuazogQnVmZmVyKSA9PiB7XHJcbiAgICAgIGJ1ZmZlciArPSBjaHVuay50b1N0cmluZygpO1xyXG4gICAgICBjb25zdCBwYXJ0cyA9IGJ1ZmZlci5zcGxpdCgvXFxyP1xcbi8pO1xyXG4gICAgICBidWZmZXIgPSBwYXJ0cy5wb3AoKSA/PyBcIlwiO1xyXG5cclxuICAgICAgZm9yIChjb25zdCBwYXJ0IG9mIHBhcnRzKSB7XHJcbiAgICAgICAgY29uc3QgbGluZSA9IHBhcnQudHJpbSgpO1xyXG4gICAgICAgIGlmIChsaW5lKSBwdXNoKGxpbmUpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICBwcm9jLnN0ZGVycj8ub24oXCJkYXRhXCIsIChjaHVuazogQnVmZmVyKSA9PiB7XHJcbiAgICAgIGNvbnN0IG1lc3NhZ2UgPSBjaHVuay50b1N0cmluZygpO1xyXG4gICAgICBzdGRlcnIgKz0gbWVzc2FnZTtcclxuICAgICAgY29uc3QgdHJpbW1lZCA9IG1lc3NhZ2UudHJpbSgpO1xyXG4gICAgICBpZiAodHJpbW1lZCkge1xyXG4gICAgICAgIGNvbnNvbGUud2FybihcIltOb3ggYWdlbnQgcHJvdmlkZXJdXCIsIHRyaW1tZWQpO1xyXG4gICAgICB9XHJcbiAgICB9KTtcclxuXHJcbiAgICBwcm9jLnN0ZGluPy5vbihcImVycm9yXCIsIChlcnJvcikgPT4ge1xyXG4gICAgICBwcm9jZXNzU3RhdGUuaW5wdXRFcnJvciA9IGVycm9yO1xyXG4gICAgICB3YWtlKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBwcm9jLm9uKFwiZXJyb3JcIiwgKGVycm9yKSA9PiB7XHJcbiAgICAgIHByb2Nlc3NTdGF0ZS5zcGF3bkVycm9yID0gZXJyb3I7XHJcbiAgICAgIHdha2UoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIHByb2Mub24oXCJjbG9zZVwiLCAoY29kZSkgPT4ge1xyXG4gICAgICBleGl0Q29kZSA9IGNvZGU7XHJcbiAgICAgIGNvbnN0IGZpbmFsTGluZSA9IGJ1ZmZlci50cmltKCk7XHJcbiAgICAgIGJ1ZmZlciA9IFwiXCI7XHJcbiAgICAgIGlmIChmaW5hbExpbmUpIHF1ZXVlLnB1c2goZmluYWxMaW5lKTtcclxuICAgICAgY2xvc2VkID0gdHJ1ZTtcclxuICAgICAgd2FrZSgpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgd2hpbGUgKHRydWUpIHtcclxuICAgICAgaWYgKHNpZ25hbC5hYm9ydGVkKSB7XHJcbiAgICAgICAgeWllbGQgeyB0eXBlOiBcImNhbmNlbGxlZFwiIH07XHJcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChxdWV1ZS5sZW5ndGggPiAwKSB7XHJcbiAgICAgICAgY29uc3QgbGluZSA9IHF1ZXVlLnNoaWZ0KCkhO1xyXG4gICAgICAgIGNvbnN0IHBhcnNlZCA9IHBhcnNlQWd5TGluZShsaW5lLCBwcm90b2NvbFN0YXRlKTtcclxuICAgICAgICBwcm90b2NvbFN0YXRlID0gcGFyc2VkLnN0YXRlO1xyXG5cclxuICAgICAgICBmb3IgKGNvbnN0IGV2ZW50IG9mIHBhcnNlZC5ldmVudHMpIHtcclxuICAgICAgICAgIHlpZWxkIGV2ZW50O1xyXG5cclxuICAgICAgICAgIGlmIChcclxuICAgICAgICAgICAgZXZlbnQudHlwZSA9PT0gXCJjb21wbGV0ZWRcIiB8fFxyXG4gICAgICAgICAgICBldmVudC50eXBlID09PSBcImZhaWxlZFwiIHx8XHJcbiAgICAgICAgICAgIGV2ZW50LnR5cGUgPT09IFwiY2FuY2VsbGVkXCJcclxuICAgICAgICAgICkge1xyXG4gICAgICAgICAgICBzYXdUZXJtaW5hbEV2ZW50ID0gdHJ1ZTtcclxuICAgICAgICAgIH1cclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChwYXJzZWQudGVybWluYWwpIGJyZWFrO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAoY2xvc2VkKSB7XHJcbiAgICAgICAgaWYgKCFzYXdUZXJtaW5hbEV2ZW50KSB7XHJcbiAgICAgICAgICBpZiAoc2lnbmFsLmFib3J0ZWQpIHtcclxuICAgICAgICAgICAgeWllbGQgeyB0eXBlOiBcImNhbmNlbGxlZFwiIH07XHJcbiAgICAgICAgICAgIGJyZWFrO1xyXG4gICAgICAgICAgfVxyXG5cclxuICAgICAgICAgIGNvbnN0IGRldGFpbCA9XHJcbiAgICAgICAgICAgIHByb2Nlc3NTdGF0ZS5pbnB1dEVycm9yPy5tZXNzYWdlIHx8XHJcbiAgICAgICAgICAgIHByb2Nlc3NTdGF0ZS5zcGF3bkVycm9yPy5tZXNzYWdlIHx8XHJcbiAgICAgICAgICAgIHN0ZGVyci50cmltKCkgfHxcclxuICAgICAgICAgICAgKGV4aXRDb2RlICE9PSAwXHJcbiAgICAgICAgICAgICAgPyBgQUdZIGV4aXRlZCB3aXRoIGNvZGUgJHtleGl0Q29kZSA/PyBcInVua25vd25cIn0gYmVmb3JlIHJldHVybmluZyBhIHJlc3VsdC5gXHJcbiAgICAgICAgICAgICAgOiBcIkFHWSBleGl0ZWQgd2l0aG91dCByZXR1cm5pbmcgYSByZXN1bHQuXCIpO1xyXG5cclxuICAgICAgICAgIHlpZWxkIHtcclxuICAgICAgICAgICAgdHlwZTogXCJmYWlsZWRcIixcclxuICAgICAgICAgICAgZmFpbHVyZTogdGhpcy5mYWlsdXJlRnJvbShkZXRhaWwsIFwicHJvY2Vzcy1mYWlsZWRcIiksXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICBicmVhaztcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgcHJvY2Vzc0Vycm9yID1cclxuICAgICAgICBwcm9jZXNzU3RhdGUuaW5wdXRFcnJvciA/PyBwcm9jZXNzU3RhdGUuc3Bhd25FcnJvcjtcclxuXHJcbiAgICAgIGlmIChwcm9jZXNzRXJyb3IpIHtcclxuICAgICAgICB5aWVsZCB7XHJcbiAgICAgICAgICB0eXBlOiBcImZhaWxlZFwiLFxyXG4gICAgICAgICAgZmFpbHVyZTogdGhpcy5mYWlsdXJlRnJvbShcclxuICAgICAgICAgICAgcHJvY2Vzc0Vycm9yLFxyXG4gICAgICAgICAgICBcInByb2Nlc3MtZmFpbGVkXCIsXHJcbiAgICAgICAgICApLFxyXG4gICAgICAgIH07XHJcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGF3YWl0IG5ldyBQcm9taXNlPHZvaWQ+KChyZXNvbHZlKSA9PiB7XHJcbiAgICAgICAgbm90aWZ5ID0gcmVzb2x2ZTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBsaXN0TW9kZWxzKCk6IFByb21pc2U8QWdlbnRNb2RlbFtdPiB7XHJcbiAgICBjb25zdCBiaW4gPSBhd2FpdCB0aGlzLnJlc29sdmVCaW5hcnkoKTtcclxuXHJcbiAgICByZXR1cm4gbmV3IFByb21pc2UoKHJlc29sdmUsIHJlamVjdCkgPT4ge1xyXG4gICAgICBjb25zdCBjaGlsZCA9IHRoaXMuZGVwcy5zcGF3bihiaW4sIFtcIm1vZGVsc1wiXSwge1xyXG4gICAgICAgIGN3ZDogdGhpcy5jd2QsXHJcbiAgICAgICAgd2luZG93c0hpZGU6IHRydWUsXHJcbiAgICAgIH0pO1xyXG4gICAgICBsZXQgb3V0ID0gXCJcIjtcclxuICAgICAgbGV0IGVyciA9IFwiXCI7XHJcblxyXG4gICAgICBjaGlsZC5zdGRvdXQ/Lm9uKFwiZGF0YVwiLCAoZGF0YTogQnVmZmVyKSA9PiB7XHJcbiAgICAgICAgb3V0ICs9IGRhdGEudG9TdHJpbmcoKTtcclxuICAgICAgfSk7XHJcbiAgICAgIGNoaWxkLnN0ZGVycj8ub24oXCJkYXRhXCIsIChkYXRhOiBCdWZmZXIpID0+IHtcclxuICAgICAgICBlcnIgKz0gZGF0YS50b1N0cmluZygpO1xyXG4gICAgICB9KTtcclxuICAgICAgY2hpbGQub24oXCJlcnJvclwiLCByZWplY3QpO1xyXG4gICAgICBjaGlsZC5vbihcImNsb3NlXCIsIChjb2RlKSA9PiB7XHJcbiAgICAgICAgaWYgKGNvZGUgIT09IDApIHtcclxuICAgICAgICAgIHJlamVjdChcclxuICAgICAgICAgICAgbmV3IEVycm9yKFxyXG4gICAgICAgICAgICAgIGVyci50cmltKCkgfHxcclxuICAgICAgICAgICAgICAgIGBGYWlsZWQgdG8gbGlzdCBBR1kgbW9kZWxzIChleGl0ICR7Y29kZSA/PyBcInVua25vd25cIn0pLmAsXHJcbiAgICAgICAgICAgICksXHJcbiAgICAgICAgICApO1xyXG4gICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgbW9kZWxzOiBBZ2VudE1vZGVsW10gPSBvdXRcclxuICAgICAgICAgIC5zcGxpdCgvXFxyP1xcbi8pXHJcbiAgICAgICAgICAubWFwKChsaW5lKSA9PiBsaW5lLnRyaW0oKSlcclxuICAgICAgICAgIC5maWx0ZXIoQm9vbGVhbilcclxuICAgICAgICAgIC5tYXAoKGxpbmUpID0+IHtcclxuICAgICAgICAgICAgY29uc3QgY29sdW1ucyA9IGxpbmVcclxuICAgICAgICAgICAgICAuc3BsaXQoL1xcdCt8XFxzezIsfS8pXHJcbiAgICAgICAgICAgICAgLmZpbHRlcihCb29sZWFuKTtcclxuXHJcbiAgICAgICAgICAgIGlmIChjb2x1bW5zLmxlbmd0aCA8IDIpIHJldHVybiBudWxsO1xyXG5cclxuICAgICAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgICAgICBpZDogY29sdW1uc1swXS50cmltKCksXHJcbiAgICAgICAgICAgICAgbmFtZTogY29sdW1ucy5zbGljZSgxKS5qb2luKFwiIFwiKS50cmltKCksXHJcbiAgICAgICAgICAgIH07XHJcbiAgICAgICAgICB9KVxyXG4gICAgICAgICAgLmZpbHRlcihcclxuICAgICAgICAgICAgKG1vZGVsKTogbW9kZWwgaXMgQWdlbnRNb2RlbCA9PiBtb2RlbCAhPT0gbnVsbCxcclxuICAgICAgICAgICk7XHJcblxyXG4gICAgICAgIHJlc29sdmUobW9kZWxzKTtcclxuICAgICAgfSk7XHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZmFpbHVyZUZyb20oXHJcbiAgICBlcnJvcjogdW5rbm93bixcclxuICAgIGNvZGU6IEFnZW50RmFpbHVyZVtcImNvZGVcIl0sXHJcbiAgKTogQWdlbnRGYWlsdXJlIHtcclxuICAgIGNvbnN0IGRpYWdub3N0aWMgPVxyXG4gICAgICBlcnJvciBpbnN0YW5jZW9mIEVycm9yID8gZXJyb3IubWVzc2FnZSA6IFN0cmluZyhlcnJvcik7XHJcblxyXG4gICAgY29uc3QgbWVzc2FnZSA9XHJcbiAgICAgIGNvZGUgPT09IFwicnVudGltZS11bmF2YWlsYWJsZVwiXHJcbiAgICAgICAgPyBcIkFnZW50IHJ1bnRpbWUgaXMgdW5hdmFpbGFibGUuIENvbmZpZ3VyZSBpdHMgZXhlY3V0YWJsZSBwYXRoIGFuZCB0cnkgYWdhaW4uXCJcclxuICAgICAgICA6IGNvZGUgPT09IFwicGVybWlzc2lvbi1yZXF1aXJlZFwiXHJcbiAgICAgICAgICA/IFwiVGhlIGFnZW50IHJ1bnRpbWUgcmVxdWlyZXMgYXBwcm92YWwgYmVmb3JlIGl0IGNhbiBjb250aW51ZS5cIlxyXG4gICAgICAgICAgOiBjb2RlID09PSBcInByb3RvY29sLWludmFsaWRcIlxyXG4gICAgICAgICAgICA/IFwiVGhlIGFnZW50IHJ1bnRpbWUgcmV0dXJuZWQgYW4gaW52YWxpZCByZXNwb25zZS5cIlxyXG4gICAgICAgICAgICA6IFwiVGhlIGFnZW50IHJ1bnRpbWUgY291bGQgbm90IGNvbXBsZXRlIHRoZSByZXF1ZXN0LlwiO1xyXG5cclxuICAgIHJldHVybiB7IGNvZGUsIG1lc3NhZ2UsIGRpYWdub3N0aWMgfTtcclxuICB9XHJcbn1cclxuIiwgImltcG9ydCB0eXBlIHtcclxuICBBZ2VudEZhaWx1cmUsXHJcbiAgQWdlbnRGYWlsdXJlQ29kZSxcclxuICBBZ2VudFN0cmVhbUV2ZW50LFxyXG59IGZyb20gXCIuLi90eXBlc1wiO1xyXG5cclxuZXhwb3J0IGludGVyZmFjZSBBZ3lQcm90b2NvbFN0YXRlIHtcclxuICBjb252ZXJzYXRpb25JZD86IHN0cmluZztcclxuICBzYXdUZXh0OiBib29sZWFuO1xyXG59XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIEFneVBhcnNlZExpbmUge1xyXG4gIGV2ZW50czogQWdlbnRTdHJlYW1FdmVudFtdO1xyXG4gIHN0YXRlOiBBZ3lQcm90b2NvbFN0YXRlO1xyXG4gIHRlcm1pbmFsOiBib29sZWFuO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZW5jb2RlQWd5VXNlck1lc3NhZ2UocHJvbXB0OiBzdHJpbmcpOiBzdHJpbmcge1xyXG4gIHJldHVybiBKU09OLnN0cmluZ2lmeSh7XHJcbiAgICBldmVudDogXCJ1c2VyXCIsXHJcbiAgICBtZXNzYWdlOiB7XHJcbiAgICAgIGNvbnRlbnQ6IHByb21wdCxcclxuICAgIH0sXHJcbiAgfSkgKyBcIlxcblwiO1xyXG59XHJcblxyXG5mdW5jdGlvbiBmYWlsdXJlKFxyXG4gIG1lc3NhZ2U6IHN0cmluZyxcclxuICBjb2RlOiBBZ2VudEZhaWx1cmVDb2RlID0gXCJwcm9jZXNzLWZhaWxlZFwiLFxyXG4pOiBBZ2VudEZhaWx1cmUge1xyXG4gIHJldHVybiB7XHJcbiAgICBjb2RlLFxyXG4gICAgbWVzc2FnZTpcclxuICAgICAgY29kZSA9PT0gXCJwZXJtaXNzaW9uLXJlcXVpcmVkXCJcclxuICAgICAgICA/IFwiVGhlIGFnZW50IHJ1bnRpbWUgcmVxdWlyZXMgYXBwcm92YWwgYmVmb3JlIGl0IGNhbiBjb250aW51ZS5cIlxyXG4gICAgICAgIDogY29kZSA9PT0gXCJwcm90b2NvbC1pbnZhbGlkXCJcclxuICAgICAgICAgID8gXCJUaGUgYWdlbnQgcnVudGltZSByZXR1cm5lZCBhbiBpbnZhbGlkIHJlc3BvbnNlLlwiXHJcbiAgICAgICAgICA6IFwiVGhlIGFnZW50IHJ1bnRpbWUgY291bGQgbm90IGNvbXBsZXRlIHRoZSByZXF1ZXN0LlwiLFxyXG4gICAgZGlhZ25vc3RpYzogbWVzc2FnZSxcclxuICB9O1xyXG59XHJcblxyXG5mdW5jdGlvbiBjbGFzc2lmeUZhaWx1cmUobWVzc2FnZTogc3RyaW5nKTogQWdlbnRGYWlsdXJlQ29kZSB7XHJcbiAgY29uc3Qgbm9ybWFsaXplZCA9IG1lc3NhZ2UudG9Mb3dlckNhc2UoKTtcclxuICBpZiAobm9ybWFsaXplZC5pbmNsdWRlcyhcInBlcm1pc3Npb25cIikgfHwgbm9ybWFsaXplZC5pbmNsdWRlcyhcImFwcHJvdmFsXCIpKSB7XHJcbiAgICByZXR1cm4gXCJwZXJtaXNzaW9uLXJlcXVpcmVkXCI7XHJcbiAgfVxyXG4gIGlmIChub3JtYWxpemVkLmluY2x1ZGVzKFwianNvblwiKSB8fCBub3JtYWxpemVkLmluY2x1ZGVzKFwicHJvdG9jb2xcIikpIHtcclxuICAgIHJldHVybiBcInByb3RvY29sLWludmFsaWRcIjtcclxuICB9XHJcbiAgcmV0dXJuIFwicHJvY2Vzcy1mYWlsZWRcIjtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHBhcnNlQWd5TGluZShcclxuICBsaW5lOiBzdHJpbmcsXHJcbiAgcHJldmlvdXM6IEFneVByb3RvY29sU3RhdGUsXHJcbik6IEFneVBhcnNlZExpbmUge1xyXG4gIGxldCBvYmo6IFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xyXG5cclxuICB0cnkge1xyXG4gICAgb2JqID0gSlNPTi5wYXJzZShsaW5lKTtcclxuICB9IGNhdGNoIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIGV2ZW50czogW10sXHJcbiAgICAgIHN0YXRlOiBwcmV2aW91cyxcclxuICAgICAgdGVybWluYWw6IGZhbHNlLFxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIGNvbnN0IGV2ZW50ID0gb2JqW1wiZXZlbnRcIl0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkO1xyXG5cclxuICBpZiAoZXZlbnQgPT09IFwiaW5pdFwiKSB7XHJcbiAgICBjb25zdCBjb252ZXJzYXRpb25JZCA9XHJcbiAgICAgIChvYmpbXCJjb252ZXJzYXRpb25faWRcIl0gYXMgc3RyaW5nIHwgdW5kZWZpbmVkKSB8fFxyXG4gICAgICAoKG9ialtcImluaXRcIl0gYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCB1bmRlZmluZWQpPy5bXHJcbiAgICAgICAgXCJjb252ZXJzYXRpb25faWRcIlxyXG4gICAgICBdIGFzIHN0cmluZyB8IHVuZGVmaW5lZCk7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgZXZlbnRzOiBbXSxcclxuICAgICAgc3RhdGU6IHtcclxuICAgICAgICAuLi5wcmV2aW91cyxcclxuICAgICAgICBjb252ZXJzYXRpb25JZDogY29udmVyc2F0aW9uSWQgPz8gcHJldmlvdXMuY29udmVyc2F0aW9uSWQsXHJcbiAgICAgIH0sXHJcbiAgICAgIHRlcm1pbmFsOiBmYWxzZSxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICBpZiAoZXZlbnQgPT09IFwic3RlcF91cGRhdGVcIikge1xyXG4gICAgY29uc3QgdXBkYXRlID0gb2JqW1wic3RlcF91cGRhdGVcIl0gYXNcclxuICAgICAgfCBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPlxyXG4gICAgICB8IHVuZGVmaW5lZDtcclxuICAgIGNvbnN0IGRlbHRhID0gdXBkYXRlPy5bXCJ0ZXh0X2RlbHRhXCJdO1xyXG5cclxuICAgIGlmICh0eXBlb2YgZGVsdGEgIT09IFwic3RyaW5nXCIgfHwgZGVsdGEubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIHJldHVybiB7IGV2ZW50czogW10sIHN0YXRlOiBwcmV2aW91cywgdGVybWluYWw6IGZhbHNlIH07XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgZXZlbnRzOiBbeyB0eXBlOiBcInRleHRcIiwgY29udGVudDogZGVsdGEgfV0sXHJcbiAgICAgIHN0YXRlOiB7IC4uLnByZXZpb3VzLCBzYXdUZXh0OiB0cnVlIH0sXHJcbiAgICAgIHRlcm1pbmFsOiBmYWxzZSxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICBpZiAoZXZlbnQgPT09IFwidGV4dFwiKSB7XHJcbiAgICBjb25zdCB0ZXh0ID0gb2JqW1widGV4dFwiXTtcclxuICAgIGlmICh0eXBlb2YgdGV4dCAhPT0gXCJzdHJpbmdcIiB8fCB0ZXh0Lmxlbmd0aCA9PT0gMCkge1xyXG4gICAgICByZXR1cm4geyBldmVudHM6IFtdLCBzdGF0ZTogcHJldmlvdXMsIHRlcm1pbmFsOiBmYWxzZSB9O1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIGV2ZW50czogW3sgdHlwZTogXCJ0ZXh0XCIsIGNvbnRlbnQ6IHRleHQgfV0sXHJcbiAgICAgIHN0YXRlOiB7IC4uLnByZXZpb3VzLCBzYXdUZXh0OiB0cnVlIH0sXHJcbiAgICAgIHRlcm1pbmFsOiBmYWxzZSxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICBpZiAoZXZlbnQgPT09IFwiZXJyb3JcIikge1xyXG4gICAgY29uc3QgbWVzc2FnZSA9IFN0cmluZyhcclxuICAgICAgb2JqW1wiZXJyb3JcIl0gPz8gXCJVbmtub3duIGFnZW50IHJ1bnRpbWUgZXJyb3JcIixcclxuICAgICk7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBldmVudHM6IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICB0eXBlOiBcImZhaWxlZFwiLFxyXG4gICAgICAgICAgZmFpbHVyZTogZmFpbHVyZShtZXNzYWdlLCBjbGFzc2lmeUZhaWx1cmUobWVzc2FnZSkpLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIF0sXHJcbiAgICAgIHN0YXRlOiBwcmV2aW91cyxcclxuICAgICAgdGVybWluYWw6IHRydWUsXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgaWYgKGV2ZW50ICE9PSBcInJlc3VsdFwiKSB7XHJcbiAgICByZXR1cm4geyBldmVudHM6IFtdLCBzdGF0ZTogcHJldmlvdXMsIHRlcm1pbmFsOiBmYWxzZSB9O1xyXG4gIH1cclxuXHJcbiAgY29uc3QgcmVzdWx0ID0gb2JqW1wicmVzdWx0XCJdIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+IHwgdW5kZWZpbmVkO1xyXG4gIGNvbnN0IHN0YXR1cyA9IFN0cmluZyhyZXN1bHQ/LltcInN0YXR1c1wiXSA/PyBcIlwiKS50b1VwcGVyQ2FzZSgpO1xyXG4gIGNvbnN0IGNvbnZlcnNhdGlvbklkID1cclxuICAgIChyZXN1bHQ/LltcImNvbnZlcnNhdGlvbl9pZFwiXSBhcyBzdHJpbmcgfCB1bmRlZmluZWQpIHx8XHJcbiAgICBwcmV2aW91cy5jb252ZXJzYXRpb25JZDtcclxuXHJcbiAgaWYgKCFzdGF0dXMpIHtcclxuICAgIHJldHVybiB7XHJcbiAgICAgIGV2ZW50czogW1xyXG4gICAgICAgIHtcclxuICAgICAgICAgIHR5cGU6IFwiZmFpbGVkXCIsXHJcbiAgICAgICAgICBmYWlsdXJlOiBmYWlsdXJlKFxyXG4gICAgICAgICAgICBcIkFHWSByZXN1bHQgaXMgbWlzc2luZyBhIHRlcm1pbmFsIHN0YXR1cy5cIixcclxuICAgICAgICAgICAgXCJwcm90b2NvbC1pbnZhbGlkXCIsXHJcbiAgICAgICAgICApLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIF0sXHJcbiAgICAgIHN0YXRlOiB7IC4uLnByZXZpb3VzLCBjb252ZXJzYXRpb25JZCB9LFxyXG4gICAgICB0ZXJtaW5hbDogdHJ1ZSxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICBpZiAoc3RhdHVzID09PSBcIkNBTkNFTEVEXCIgfHwgc3RhdHVzID09PSBcIkNBTkNFTExFRFwiIHx8IHN0YXR1cyA9PT0gXCJJTlRFUlJVUFRFRFwiKSB7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBldmVudHM6IFt7IHR5cGU6IFwiY2FuY2VsbGVkXCIgfV0sXHJcbiAgICAgIHN0YXRlOiB7IC4uLnByZXZpb3VzLCBjb252ZXJzYXRpb25JZCB9LFxyXG4gICAgICB0ZXJtaW5hbDogdHJ1ZSxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICBpZiAoc3RhdHVzICYmIHN0YXR1cyAhPT0gXCJTVUNDRVNTXCIpIHtcclxuICAgIGNvbnN0IG1lc3NhZ2UgPSBTdHJpbmcoXHJcbiAgICAgIHJlc3VsdD8uW1wiZXJyb3JcIl0gPz9cclxuICAgICAgICBgQUdZIGZpbmlzaGVkIHdpdGggc3RhdHVzICR7c3RhdHVzfSB3aXRob3V0IGFuIGVycm9yIG1lc3NhZ2UuYCxcclxuICAgICk7XHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBldmVudHM6IFtcclxuICAgICAgICB7XHJcbiAgICAgICAgICB0eXBlOiBcImZhaWxlZFwiLFxyXG4gICAgICAgICAgZmFpbHVyZTogZmFpbHVyZShtZXNzYWdlLCBjbGFzc2lmeUZhaWx1cmUobWVzc2FnZSkpLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIF0sXHJcbiAgICAgIHN0YXRlOiB7IC4uLnByZXZpb3VzLCBjb252ZXJzYXRpb25JZCB9LFxyXG4gICAgICB0ZXJtaW5hbDogdHJ1ZSxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICBjb25zdCBldmVudHM6IEFnZW50U3RyZWFtRXZlbnRbXSA9IFtdO1xyXG4gIGNvbnN0IHJlc3BvbnNlID0gcmVzdWx0Py5bXCJyZXNwb25zZVwiXTtcclxuICBsZXQgc2F3VGV4dCA9IHByZXZpb3VzLnNhd1RleHQ7XHJcblxyXG4gIGlmICghc2F3VGV4dCAmJiB0eXBlb2YgcmVzcG9uc2UgPT09IFwic3RyaW5nXCIgJiYgcmVzcG9uc2UubGVuZ3RoID4gMCkge1xyXG4gICAgZXZlbnRzLnB1c2goeyB0eXBlOiBcInRleHRcIiwgY29udGVudDogcmVzcG9uc2UgfSk7XHJcbiAgICBzYXdUZXh0ID0gdHJ1ZTtcclxuICB9XHJcblxyXG4gIGV2ZW50cy5wdXNoKHtcclxuICAgIHR5cGU6IFwiY29tcGxldGVkXCIsXHJcbiAgICBjb252ZXJzYXRpb25JZCxcclxuICB9KTtcclxuXHJcbiAgcmV0dXJuIHtcclxuICAgIGV2ZW50cyxcclxuICAgIHN0YXRlOiB7XHJcbiAgICAgIGNvbnZlcnNhdGlvbklkLFxyXG4gICAgICBzYXdUZXh0LFxyXG4gICAgfSxcclxuICAgIHRlcm1pbmFsOiB0cnVlLFxyXG4gIH07XHJcbn1cclxuIiwgImltcG9ydCB7XHJcbiAgSXRlbVZpZXcsXHJcbiAgTWFya2Rvd25SZW5kZXJlcixcclxuICBzZXRJY29uLFxyXG4gIFdvcmtzcGFjZUxlYWYsXHJcbiAgdHlwZSBJY29uTmFtZSxcclxufSBmcm9tIFwib2JzaWRpYW5cIjtcclxuaW1wb3J0IHsgTGVhcm5pbmdDb250cm9sbGVyIH0gZnJvbSBcIi4uL2xlYXJuaW5nL0xlYXJuaW5nQ29udHJvbGxlclwiO1xyXG5pbXBvcnQge1xyXG4gIExlYXJuaW5nQWN0aW9uS2luZCxcclxuICBMZWFybmluZ0V2ZW50LFxyXG59IGZyb20gXCIuLi9sZWFybmluZy9sZWFybmluZy10eXBlc1wiO1xyXG5pbXBvcnQge1xyXG4gIEV4cGxpY2l0Q29udGV4dFJlZixcclxuICBMZWFybmluZ0NvbnRleHQsXHJcbn0gZnJvbSBcIi4uL2NvbnRleHQvY29udGV4dC10eXBlc1wiO1xyXG5pbXBvcnQge1xyXG4gIFByYWN0aWNlRXZhbHVhdGlvbixcclxuICBQcmFjdGljZVF1ZXN0aW9uLFxyXG59IGZyb20gXCIuLi9sZWFybmluZy9wcmFjdGljZS10eXBlc1wiO1xyXG5pbXBvcnQgeyBSZXZpZXdGaW5kaW5nIH0gZnJvbSBcIi4uL2xlYXJuaW5nL3Jldmlldy10eXBlc1wiO1xyXG5pbXBvcnQgeyBDaGF0TWVzc2FnZSwgRWRpdFByb3Bvc2FsIH0gZnJvbSBcIi4uL3R5cGVzXCI7XHJcbmltcG9ydCB7IFByb3Bvc2VkRWRpdCB9IGZyb20gXCIuLi9sZWFybmluZy9sZWFybmluZy10eXBlc1wiO1xyXG5pbXBvcnQge1xyXG4gIHBhcnNlUHJvbXB0VG9rZW4sXHJcbiAgUHJvbXB0TWVudUtpbmQsXHJcbn0gZnJvbSBcIi4vcHJvbXB0LXRva2VuXCI7XHJcbmltcG9ydCB7IE5PWF9DQVBBQklMSVRJRVMgfSBmcm9tIFwiLi9jYXBhYmlsaXRpZXNcIjtcclxuXHJcbmV4cG9ydCBjb25zdCBOT1hfVklFV19UWVBFID0gXCJub3gtc2lkZWJhclwiO1xyXG5cclxudHlwZSBVSVN0YXRlID1cclxuICB8IFwiRU1QVFlcIlxyXG4gIHwgXCJSVU5OSU5HXCJcclxuICB8IFwiQU5TV0VSXCJcclxuICB8IFwiUFJPUE9TQUxcIlxyXG4gIHwgXCJBUFBMSUVEXCJcclxuICB8IFwiRVJST1JcIjtcclxuXHJcbmNvbnN0IEFDVElPTlM6IEFycmF5PHtcclxuICBraW5kOiBMZWFybmluZ0FjdGlvbktpbmQ7XHJcbiAgbGFiZWw6IHN0cmluZztcclxufT4gPSBbXHJcbiAgeyBraW5kOiBcImFza1wiLCBsYWJlbDogXCJBc2tcIiB9LFxyXG4gIC4uLk5PWF9DQVBBQklMSVRJRVMubWFwKChjYXBhYmlsaXR5KSA9PiAoe1xyXG4gICAga2luZDogY2FwYWJpbGl0eS5hY3Rpb24sXHJcbiAgICBsYWJlbDogY2FwYWJpbGl0eS50aXRsZSxcclxuICB9KSksXHJcbl07XHJcblxyXG5jb25zdCBQUk9NUFRfQ09NTUFORFM6IEFycmF5PHtcclxuICBraW5kOiBFeGNsdWRlPExlYXJuaW5nQWN0aW9uS2luZCwgXCJhc2tcIj47XHJcbiAgbmFtZTogc3RyaW5nO1xyXG4gIGRlc2NyaXB0aW9uOiBzdHJpbmc7XHJcbn0+ID0gTk9YX0NBUEFCSUxJVElFUy5tYXAoKGNhcGFiaWxpdHkpID0+ICh7XHJcbiAga2luZDogY2FwYWJpbGl0eS5hY3Rpb24sXHJcbiAgbmFtZTogY2FwYWJpbGl0eS50aXRsZSxcclxuICBkZXNjcmlwdGlvbjogY2FwYWJpbGl0eS5kZXNjcmlwdGlvbixcclxufSkpO1xyXG5cclxudHlwZSBQcm9tcHRNZW51QWN0aW9uID1cclxuICB8IHsgdHlwZTogXCJhdHRhY2hcIiB9XHJcbiAgfCB7IHR5cGU6IFwiaW5mb1wiIH1cclxuICB8IHsgdHlwZTogXCJ2YXVsdC1ub3RlXCI7IHBhdGg6IHN0cmluZyB9XHJcbiAgfCB7IHR5cGU6IFwibGVhcm5pbmdcIjsga2luZDogRXhjbHVkZTxMZWFybmluZ0FjdGlvbktpbmQsIFwiYXNrXCI+IH07XHJcblxyXG5pbnRlcmZhY2UgUHJvbXB0TWVudUl0ZW0ge1xyXG4gIGtleTogc3RyaW5nO1xyXG4gIG5hbWU6IHN0cmluZztcclxuICBkZXNjcmlwdGlvbjogc3RyaW5nO1xyXG4gIGljb246IEljb25OYW1lO1xyXG4gIGRpc2FibGVkPzogYm9vbGVhbjtcclxuICBhY3Rpb246IFByb21wdE1lbnVBY3Rpb247XHJcbn1cclxuXHJcbmZ1bmN0aW9uIHNldE5veEljb24oZWxlbWVudDogSFRNTEVsZW1lbnQsIGljb246IEljb25OYW1lKTogdm9pZCB7XHJcbiAgZWxlbWVudC5lbXB0eSgpO1xyXG4gIHNldEljb24oZWxlbWVudCwgaWNvbik7XHJcbn1cclxuXHJcbmV4cG9ydCBjbGFzcyBDaGF0VmlldyBleHRlbmRzIEl0ZW1WaWV3IHtcclxuICBwcml2YXRlIHRocmVhZCE6IEhUTUxFbGVtZW50O1xyXG4gIHByaXZhdGUgY29tcG9zZXIhOiBIVE1MRWxlbWVudDtcclxuICBwcml2YXRlIGhlYWRlckVsITogSFRNTEVsZW1lbnQ7XHJcblxyXG4gIHByaXZhdGUgaW5wdXQhOiBIVE1MVGV4dEFyZWFFbGVtZW50O1xyXG4gIHByaXZhdGUgc2VuZEJ0biE6IEhUTUxCdXR0b25FbGVtZW50O1xyXG4gIHByaXZhdGUgc2VsZWN0aW9uQ2hpcCE6IEhUTUxFbGVtZW50O1xyXG4gIHByaXZhdGUgbm90ZUNoaXAhOiBIVE1MRWxlbWVudDtcclxuICBwcml2YXRlIHN5c3RlbUNoaXAhOiBIVE1MRWxlbWVudDtcclxuICBwcml2YXRlIGNhbmNlbEJ0biE6IEhUTUxCdXR0b25FbGVtZW50O1xyXG4gIHByaXZhdGUgbW9kZWxTZWxlY3QhOiBIVE1MU2VsZWN0RWxlbWVudDtcclxuICBwcml2YXRlIGZpbGVJbnB1dCE6IEhUTUxJbnB1dEVsZW1lbnQ7XHJcbiAgcHJpdmF0ZSBwcm9tcHRQbHVzQnRuITogSFRNTEJ1dHRvbkVsZW1lbnQ7XHJcbiAgcHJpdmF0ZSBhdHRhY2htZW50c0VsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgaW50ZW50RWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBwcm9tcHRNZW51RWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBwcm9tcHRNZW51OiBQcm9tcHRNZW51S2luZCB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgcHJvbXB0TWVudUFjdGl2ZSA9IDA7XHJcbiAgcHJpdmF0ZSBwcm9tcHRNZW51Um93czogSFRNTEJ1dHRvbkVsZW1lbnRbXSA9IFtdO1xyXG4gIHByaXZhdGUgcHJvbXB0TWVudVJlcXVlc3QgPSAwO1xyXG4gIHByaXZhdGUgYXR0YWNobWVudHM6IEFycmF5PHtcclxuICAgIG5hbWU6IHN0cmluZztcclxuICAgIHJlZjogRXhwbGljaXRDb250ZXh0UmVmO1xyXG4gIH0+ID0gW107XHJcblxyXG4gIHByaXZhdGUgYWdlbnRDdXJzb3JFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIGFnZW50Q29udGVudEVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgc3RhdHVzRWw6IEhUTUxFbGVtZW50IHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBsb2FkaW5nRWxhcHNlZEVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgbG9hZGluZ1N0YXJ0ZWRBdCA9IDA7XHJcbiAgcHJpdmF0ZSBsb2FkaW5nVGltZXI6IG51bWJlciB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgdGhpbmtpbmdUb2dnbGVFbDogSFRNTEJ1dHRvbkVsZW1lbnQgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIHRoaW5raW5nTGFiZWxFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIHRoaW5raW5nQ2hldnJvbkVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgdGhpbmtpbmdQYW5lbEVsOiBIVE1MRWxlbWVudCB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgdGhpbmtpbmdSb3dzOiBIVE1MRWxlbWVudFtdID0gW107XHJcbiAgcHJpdmF0ZSB0aGlua2luZ1N0YWdlVGltZXI6IG51bWJlciB8IG51bGwgPSBudWxsO1xyXG4gIHByaXZhdGUgdGhpbmtpbmdTdGFnZSA9IDA7XHJcbiAgcHJpdmF0ZSB0aGlua2luZ01hbnVhbEV4cGFuZGVkOiBib29sZWFuIHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSBzdHJlYW1lZFJlc3BvbnNlVGV4dCA9IFwiXCI7XHJcbiAgcHJpdmF0ZSBzdHJlYW1pbmdQZW5kaW5nVGV4dCA9IFwiXCI7XHJcbiAgcHJpdmF0ZSByZXNwb25zZVRpbWVFbDogSFRNTEVsZW1lbnQgfCBudWxsID0gbnVsbDtcclxuXHJcbiAgcHJpdmF0ZSB1aVN0YXRlOiBVSVN0YXRlID0gXCJFTVBUWVwiO1xyXG4gIHByaXZhdGUgc2VsZWN0ZWRBY3Rpb246IExlYXJuaW5nQWN0aW9uS2luZCA9IFwiYXNrXCI7XHJcbiAgcHJpdmF0ZSBydW5uaW5nQWN0aW9uOiBMZWFybmluZ0FjdGlvbktpbmQgfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIGFjdGlvbkJ1dHRvbnMgPSBuZXcgTWFwPExlYXJuaW5nQWN0aW9uS2luZCwgSFRNTEJ1dHRvbkVsZW1lbnQ+KCk7XHJcbiAgcHJpdmF0ZSBzeXN0ZW1Db250ZXh0RmlsZXM6IHN0cmluZ1tdID0gW107XHJcblxyXG4gIHByaXZhdGUgZXh0cmFDdHg6IEV4cGxpY2l0Q29udGV4dFJlZltdID0gW107XHJcbiAgcHJpdmF0ZSBjdXJyZW50Q29udGV4dDogTGVhcm5pbmdDb250ZXh0IHwgbnVsbCA9IG51bGw7XHJcblxyXG4gIGNvbnN0cnVjdG9yKFxyXG4gICAgbGVhZjogV29ya3NwYWNlTGVhZixcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgbGVhcm5pbmc6IExlYXJuaW5nQ29udHJvbGxlcixcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgb3BlblNldHRpbmdzOiAoKSA9PiB2b2lkLFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBnZXRMb2dvVXJsOiAoKSA9PiBzdHJpbmcsXHJcbiAgKSB7XHJcbiAgICBzdXBlcihsZWFmKTtcclxuICB9XHJcblxyXG4gIGdldFZpZXdUeXBlKCkge1xyXG4gICAgcmV0dXJuIE5PWF9WSUVXX1RZUEU7XHJcbiAgfVxyXG5cclxuICBnZXREaXNwbGF5VGV4dCgpIHtcclxuICAgIHJldHVybiBcIk5veFwiO1xyXG4gIH1cclxuXHJcbiAgZ2V0SWNvbigpIHtcclxuICAgIHJldHVybiBcIm5veC1sb2dvXCI7XHJcbiAgfVxyXG5cclxuICBhc3luYyBvbk9wZW4oKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCByb290ID0gdGhpcy5jb250ZW50RWw7XHJcbiAgICByb290LmVtcHR5KCk7XHJcbiAgICByb290LmFkZENsYXNzKFwibm94LXJvb3RcIik7XHJcblxyXG4gICAgdGhpcy5idWlsZEhlYWRlcihyb290KTtcclxuICAgIHRoaXMudGhyZWFkID0gcm9vdC5jcmVhdGVEaXYoeyBjbHM6IFwibm94LXRocmVhZFwiIH0pO1xyXG4gICAgdGhpcy5jb21wb3NlciA9IHJvb3QuY3JlYXRlRGl2KHsgY2xzOiBcIm5veC1jb21wb3NlclwiIH0pO1xyXG4gICAgdGhpcy5idWlsZENvbXBvc2VyKHRoaXMuY29tcG9zZXIpO1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGNvbnN0IGhlYWx0aCA9IGF3YWl0IHRoaXMubGVhcm5pbmcuY2hlY2tSdW50aW1lKCk7XHJcbiAgICAgIGlmIChoZWFsdGguc3RhdHVzICE9PSBcInJlYWR5XCIpIHtcclxuICAgICAgICB0aGlzLnNob3dFcnJvcihoZWFsdGguZmFpbHVyZS5tZXNzYWdlKTtcclxuICAgICAgICByZXR1cm47XHJcbiAgICAgIH1cclxuICAgIH0gY2F0Y2gge1xyXG4gICAgICB0aGlzLnNob3dFcnJvcihcIkFnZW50IHJ1bnRpbWUgaXMgdW5hdmFpbGFibGUuIENoZWNrIE5veCBydW50aW1lIHNldHRpbmdzLlwiKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGF3YWl0IHRoaXMuc3luY0NoaXBzKCk7XHJcbiAgICBhd2FpdCB0aGlzLnJlc3RvcmVTZXNzaW9uKCk7XHJcblxyXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxyXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJhY3RpdmUtbGVhZi1jaGFuZ2VcIiwgKCkgPT4ge1xyXG4gICAgICAgIHZvaWQgdGhpcy5zeW5jQ2hpcHMoKTtcclxuICAgICAgfSksXHJcbiAgICApO1xyXG4gICAgdGhpcy5yZWdpc3RlckV2ZW50KFxyXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2Uub24oXCJlZGl0b3Itc2VsZWN0aW9uLWNoYW5nZVwiIGFzIGFueSwgKCkgPT4ge1xyXG4gICAgICAgIHZvaWQgdGhpcy5zeW5jQ2hpcHMoKTtcclxuICAgICAgfSksXHJcbiAgICApO1xyXG5cclxuICAgIHZvaWQgdGhpcy5yZWZyZXNoTW9kZWxMaXN0KCk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBvbkNsb3NlKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdGhpcy5sZWFybmluZy5jYW5jZWwoKTtcclxuICAgIHRoaXMuc3RvcFRoaW5raW5nU2VxdWVuY2UoKTtcclxuICAgIHRoaXMuc3RvcExvYWRpbmdUaW1lcigpO1xyXG4gIH1cclxuXHJcbiAgZm9jdXNDb21wb3NlcigpOiB2b2lkIHtcclxuICAgIHRoaXMuaW5wdXQ/LmZvY3VzKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGJ1aWxkSGVhZGVyKHJvb3Q6IEhUTUxFbGVtZW50KTogdm9pZCB7XHJcbiAgICB0aGlzLmhlYWRlckVsID0gcm9vdC5jcmVhdGVEaXYoeyBjbHM6IFwibm94LWhlYWRlclwiIH0pO1xyXG4gICAgY29uc3QgdG9wID0gdGhpcy5oZWFkZXJFbC5jcmVhdGVEaXYoeyBjbHM6IFwibm94LWhlYWRlci10b3BcIiB9KTtcclxuICAgIGNvbnN0IGJyYW5kID0gdG9wLmNyZWF0ZURpdih7IGNsczogXCJub3gtaGVhZGVyLWJyYW5kXCIgfSk7XHJcbiAgICBicmFuZC5jcmVhdGVFbChcImltZ1wiLCB7XHJcbiAgICAgIGNsczogXCJub3gtaGVhZGVyLWxvZ29cIixcclxuICAgICAgYXR0cjoge1xyXG4gICAgICAgIHNyYzogdGhpcy5nZXRMb2dvVXJsKCksXHJcbiAgICAgICAgYWx0OiBcIk5veFwiLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgY29weSA9IGJyYW5kLmNyZWF0ZURpdih7IGNsczogXCJub3gtaGVhZGVyLWNvcHlcIiB9KTtcclxuICAgIGNvcHkuY3JlYXRlU3Bhbih7IGNsczogXCJub3gtaGVhZGVyLXRpdGxlXCIsIHRleHQ6IFwiTm94XCIgfSk7XHJcblxyXG4gICAgY29uc3QgcmlnaHQgPSB0b3AuY3JlYXRlRGl2KHsgY2xzOiBcIm5veC1oZWFkZXItcmlnaHRcIiB9KTtcclxuXHJcbiAgICBjb25zdCBuZXdCdG4gPSByaWdodC5jcmVhdGVFbChcImJ1dHRvblwiLCB7XHJcbiAgICAgIGNsczogXCJub3gtbmV3LWJ0blwiLFxyXG4gICAgICBhdHRyOiB7XHJcbiAgICAgICAgdHlwZTogXCJidXR0b25cIixcclxuICAgICAgICBcImFyaWEtbGFiZWxcIjogXCJOZXcgbGVhcm5pbmcgc2Vzc2lvblwiLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgICBzZXROb3hJY29uKG5ld0J0biwgXCJwbHVzXCIpO1xyXG4gICAgbmV3QnRuLnRpdGxlID0gXCJOZXcgbGVhcm5pbmcgc2Vzc2lvblwiO1xyXG4gICAgbmV3QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCBhc3luYyAoKSA9PiB7XHJcbiAgICAgIGF3YWl0IHRoaXMubGVhcm5pbmcubmV3U2Vzc2lvbigpO1xyXG4gICAgICB0aGlzLmV4dHJhQ3R4ID0gW107XHJcbiAgICAgIHRoaXMuYXR0YWNobWVudHMgPSBbXTtcclxuICAgICAgdGhpcy5yZW5kZXJBdHRhY2htZW50cygpO1xyXG4gICAgICB0aGlzLmNsb3NlUHJvbXB0TWVudSgpO1xyXG4gICAgICB0aGlzLnNldEFjdGlvbihcImFza1wiKTtcclxuICAgICAgYXdhaXQgdGhpcy5zeW5jQ2hpcHMoKTtcclxuICAgICAgdGhpcy5zaG93RW1wdHkoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IG1vcmVCdG4gPSByaWdodC5jcmVhdGVFbChcImJ1dHRvblwiLCB7XHJcbiAgICAgIGNsczogXCJub3gtbW9yZS1idG5cIixcclxuICAgICAgYXR0cjoge1xyXG4gICAgICAgIHR5cGU6IFwiYnV0dG9uXCIsXHJcbiAgICAgICAgXCJhcmlhLWxhYmVsXCI6IFwiT3BlbiBOb3ggc2V0dGluZ3NcIixcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gICAgc2V0Tm94SWNvbihtb3JlQnRuLCBcIm1vcmUtaG9yaXpvbnRhbFwiKTtcclxuICAgIG1vcmVCdG4udGl0bGUgPSBcIk5veCBzZXR0aW5nc1wiO1xyXG4gICAgbW9yZUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4gdGhpcy5vcGVuU2V0dGluZ3MoKSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGJ1aWxkQWN0aW9uQnV0dG9ucyhwYXJlbnQ6IEhUTUxFbGVtZW50KTogdm9pZCB7XHJcbiAgICBmb3IgKGNvbnN0IGFjdGlvbiBvZiBBQ1RJT05TKSB7XHJcbiAgICAgIGNvbnN0IGJ1dHRvbiA9IHBhcmVudC5jcmVhdGVFbChcImJ1dHRvblwiLCB7XHJcbiAgICAgICAgY2xzOiBcIm5veC1hY3Rpb24tYnRuXCIsXHJcbiAgICAgICAgdGV4dDogYWN0aW9uLmxhYmVsLFxyXG4gICAgICB9KTtcclxuICAgICAgYnV0dG9uLnR5cGUgPSBcImJ1dHRvblwiO1xyXG4gICAgICBidXR0b24uc2V0QXR0cmlidXRlKFwiYXJpYS1sYWJlbFwiLCBgVXNlICR7YWN0aW9uLmxhYmVsfSBtb2RlYCk7XHJcbiAgICAgIGJ1dHRvbi50aXRsZSA9IGAke2FjdGlvbi5sYWJlbH0gbW9kZWA7XHJcbiAgICAgIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAgIHRoaXMuc2VsZWN0ZWRBY3Rpb24gPSBhY3Rpb24ua2luZDtcclxuICAgICAgICB0aGlzLnN5bmNBY3Rpb25CdXR0b25zKCk7XHJcbiAgICAgICAgdGhpcy51cGRhdGVQbGFjZWhvbGRlcigpO1xyXG4gICAgICB9KTtcclxuICAgICAgdGhpcy5hY3Rpb25CdXR0b25zLnNldChhY3Rpb24ua2luZCwgYnV0dG9uKTtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLnN5bmNBY3Rpb25CdXR0b25zKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJlZnJlc2hNb2RlbExpc3QoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBsZXQgbW9kZWxzID0gdGhpcy5sZWFybmluZy5nZXRNb2RlbHMoKTtcclxuXHJcbiAgICB0aGlzLm1vZGVsU2VsZWN0LmVtcHR5KCk7XHJcbiAgICBjb25zdCBjdXJyZW50TW9kZWwgPSB0aGlzLmxlYXJuaW5nLmdldFNlc3Npb24oKS5tb2RlbDtcclxuXHJcbiAgICBjb25zdCBkZWZhdWx0T3B0aW9uID0gdGhpcy5tb2RlbFNlbGVjdC5jcmVhdGVFbChcIm9wdGlvblwiLCB7XHJcbiAgICAgIHZhbHVlOiBcIlwiLFxyXG4gICAgICB0ZXh0OiBcIlJ1bnRpbWUgZGVmYXVsdFwiLFxyXG4gICAgfSk7XHJcbiAgICBkZWZhdWx0T3B0aW9uLnNlbGVjdGVkID0gIWN1cnJlbnRNb2RlbDtcclxuXHJcbiAgICBmb3IgKGNvbnN0IG1vZGVsIG9mIG1vZGVscykge1xyXG4gICAgICBjb25zdCBvcHRpb24gPSB0aGlzLm1vZGVsU2VsZWN0LmNyZWF0ZUVsKFwib3B0aW9uXCIsIHtcclxuICAgICAgICB2YWx1ZTogbW9kZWwuaWQsXHJcbiAgICAgICAgdGV4dDogbW9kZWwubmFtZSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBpZiAobW9kZWwuaWQgPT09IGN1cnJlbnRNb2RlbCkgb3B0aW9uLnNlbGVjdGVkID0gdHJ1ZTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYnVpbGRDb21wb3NlcihwYXJlbnQ6IEhUTUxFbGVtZW50KTogdm9pZCB7XHJcbiAgICBjb25zdCBjb250ZXh0Um93ID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJub3gtY29udGV4dC1yb3dcIiB9KTtcclxuICAgIGNvbnRleHRSb3cuY3JlYXRlU3Bhbih7XHJcbiAgICAgIGNsczogXCJub3gtY29udGV4dC1sYWJlbFwiLFxyXG4gICAgICB0ZXh0OiBcIlVzaW5nXCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBjaGlwcyA9IGNvbnRleHRSb3cuY3JlYXRlRGl2KHsgY2xzOiBcIm5veC1jaGlwc1wiIH0pO1xyXG5cclxuICAgIHRoaXMuc2VsZWN0aW9uQ2hpcCA9IGNoaXBzLmNyZWF0ZVNwYW4oe1xyXG4gICAgICBjbHM6IFwibm94LWNoaXAgbm94LWNoaXAtLWhpZGRlblwiLFxyXG4gICAgfSk7XHJcbiAgICB0aGlzLnNlbGVjdGlvbkNoaXAuY3JlYXRlU3Bhbih7IGNsczogXCJub3gtY2hpcC1kb3RcIiB9KTtcclxuICAgIHRoaXMuc2VsZWN0aW9uQ2hpcC5jcmVhdGVTcGFuKHtcclxuICAgICAgY2xzOiBcIm5veC1jaGlwLWxhYmVsXCIsXHJcbiAgICAgIHRleHQ6IFwiQHNlbGVjdGlvblwiLFxyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5ub3RlQ2hpcCA9IGNoaXBzLmNyZWF0ZVNwYW4oe1xyXG4gICAgICBjbHM6IFwibm94LWNoaXAgbm94LWNoaXAtLWhpZGRlblwiLFxyXG4gICAgfSk7XHJcbiAgICB0aGlzLm5vdGVDaGlwLmNyZWF0ZVNwYW4oeyBjbHM6IFwibm94LWNoaXAtZG90XCIgfSk7XHJcbiAgICB0aGlzLm5vdGVDaGlwLmNyZWF0ZVNwYW4oe1xyXG4gICAgICBjbHM6IFwibm94LWNoaXAtbGFiZWxcIixcclxuICAgICAgdGV4dDogXCJAbm90ZVwiLFxyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5zeXN0ZW1DaGlwID0gY2hpcHMuY3JlYXRlU3Bhbih7XHJcbiAgICAgIGNsczogXCJub3gtY2hpcCBub3gtY2hpcC0taGlkZGVuXCIsXHJcbiAgICB9KTtcclxuICAgIHRoaXMuc3lzdGVtQ2hpcC5jcmVhdGVTcGFuKHsgY2xzOiBcIm5veC1jaGlwLWRvdFwiIH0pO1xyXG4gICAgdGhpcy5zeXN0ZW1DaGlwLmNyZWF0ZVNwYW4oe1xyXG4gICAgICBjbHM6IFwibm94LWNoaXAtbGFiZWxcIixcclxuICAgICAgdGV4dDogXCJAbm94LXN5c3RlbVwiLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgYW5jaG9yID0gcGFyZW50LmNyZWF0ZURpdih7IGNsczogXCJub3gtcHJvbXB0LWFuY2hvclwiIH0pO1xyXG4gICAgdGhpcy5wcm9tcHRNZW51RWwgPSBhbmNob3IuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcIm5veC1wcm9tcHQtbWVudSBub3gtaGlkZGVuXCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBib3ggPSBhbmNob3IuY3JlYXRlRGl2KHsgY2xzOiBcIm5veC1jb21wb3Nlci1ib3hcIiB9KTtcclxuICAgIGJveC5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKGV2ZW50KSA9PiB7XHJcbiAgICAgIGlmICghKGV2ZW50LnRhcmdldCBpbnN0YW5jZW9mIEhUTUxCdXR0b25FbGVtZW50KSAmJlxyXG4gICAgICAgICAgIShldmVudC50YXJnZXQgaW5zdGFuY2VvZiBIVE1MU2VsZWN0RWxlbWVudCkpIHtcclxuICAgICAgICB0aGlzLmlucHV0LmZvY3VzKCk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuaW50ZW50RWwgPSBib3guY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcIm5veC1pbnRlbnQtcm93IG5veC1oaWRkZW5cIixcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuYXR0YWNobWVudHNFbCA9IGJveC5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwibm94LWF0dGFjaG1lbnRzIG5veC1oaWRkZW5cIixcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMuZmlsZUlucHV0ID0gYm94LmNyZWF0ZUVsKFwiaW5wdXRcIiwge1xyXG4gICAgICBjbHM6IFwibm94LWZpbGUtaW5wdXRcIixcclxuICAgICAgYXR0cjoge1xyXG4gICAgICAgIHR5cGU6IFwiZmlsZVwiLFxyXG4gICAgICAgIG11bHRpcGxlOiBcIlwiLFxyXG4gICAgICAgIGFjY2VwdDogXCIubWQsLnR4dCwuY3N2LC5qc29uLC55YW1sLC55bWxcIixcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gICAgdGhpcy5maWxlSW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImNoYW5nZVwiLCAoKSA9PiB7XHJcbiAgICAgIHZvaWQgdGhpcy5oYW5kbGVGaWxlcyh0aGlzLmZpbGVJbnB1dC5maWxlcyk7XHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBjb250cm9scyA9IGJveC5jcmVhdGVEaXYoeyBjbHM6IFwibm94LWNvbXBvc2VyLWNvbnRyb2xzXCIgfSk7XHJcblxyXG4gICAgdGhpcy5pbnB1dCA9IGNvbnRyb2xzLmNyZWF0ZUVsKFwidGV4dGFyZWFcIiwge1xyXG4gICAgICBjbHM6IFwibm94LWlucHV0XCIsXHJcbiAgICAgIGF0dHI6IHtcclxuICAgICAgICBwbGFjZWhvbGRlcjogXCJBc2sgYW55dGhpbmcgYWJvdXQgdGhpcyBub3RlLi4uXCIsXHJcbiAgICAgICAgcm93czogXCIxXCIsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuICAgIHRoaXMuaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImlucHV0XCIsICgpID0+IHRoaXMub25JbnB1dCgpKTtcclxuICAgIHRoaXMuaW5wdXQuYWRkRXZlbnRMaXN0ZW5lcihcImtleWRvd25cIiwgKGV2ZW50KSA9PiB0aGlzLm9uS2V5KGV2ZW50KSk7XHJcblxyXG4gICAgY29uc3QgZm9vdGVyID0gYm94LmNyZWF0ZURpdih7IGNsczogXCJub3gtY29tcG9zZXItZm9vdGVyXCIgfSk7XHJcbiAgICB0aGlzLnByb21wdFBsdXNCdG4gPSBmb290ZXIuY3JlYXRlRWwoXCJidXR0b25cIiwge1xyXG4gICAgICBjbHM6IFwibm94LXByb21wdC1wbHVzXCIsXHJcbiAgICAgIGF0dHI6IHtcclxuICAgICAgICB0eXBlOiBcImJ1dHRvblwiLFxyXG4gICAgICAgIFwiYXJpYS1sYWJlbFwiOiBcIkFkZCBjb250ZXh0IG9yIGZpbGVcIixcclxuICAgICAgICBcImFyaWEtZXhwYW5kZWRcIjogXCJmYWxzZVwiLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcbiAgICBzZXROb3hJY29uKHRoaXMucHJvbXB0UGx1c0J0biwgXCJwbHVzXCIpO1xyXG4gICAgdGhpcy5wcm9tcHRQbHVzQnRuLnRpdGxlID0gXCJBZGQgY29udGV4dCBvciBmaWxlXCI7XHJcbiAgICB0aGlzLnByb21wdFBsdXNCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgdGhpcy5wcm9tcHRNZW51ID0gdGhpcy5wcm9tcHRNZW51ID09PSBcInNvdXJjZVwiID8gbnVsbCA6IFwic291cmNlXCI7XHJcbiAgICAgIHRoaXMucHJvbXB0TWVudUFjdGl2ZSA9IDA7XHJcbiAgICAgIHZvaWQgdGhpcy5yZW5kZXJQcm9tcHRNZW51KCk7XHJcbiAgICAgIHRoaXMuaW5wdXQuZm9jdXMoKTtcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHRvb2xzID0gZm9vdGVyLmNyZWF0ZURpdih7IGNsczogXCJub3gtY29tcG9zZXItdG9vbHNcIiB9KTtcclxuXHJcbiAgICBjb25zdCBhY3Rpb25NZW51QnRuID0gdG9vbHMuY3JlYXRlRWwoXCJidXR0b25cIiwge1xyXG4gICAgICBjbHM6IFwibm94LWFjdGlvbi1tZW51LWJ0blwiLFxyXG4gICAgICBhdHRyOiB7XHJcbiAgICAgICAgdHlwZTogXCJidXR0b25cIixcclxuICAgICAgICBcImFyaWEtbGFiZWxcIjogXCJTaG93IE5veCBhY3Rpb25zXCIsXHJcbiAgICAgICAgXCJhcmlhLWV4cGFuZGVkXCI6IFwiZmFsc2VcIixcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gICAgYWN0aW9uTWVudUJ0bi5jcmVhdGVTcGFuKHtcclxuICAgICAgY2xzOiBcIm5veC1hY3Rpb24tbWVudS1rZXlcIixcclxuICAgICAgdGV4dDogXCIvXCIsXHJcbiAgICB9KTtcclxuICAgIGFjdGlvbk1lbnVCdG4uY3JlYXRlU3Bhbih7XHJcbiAgICAgIHRleHQ6IFwiQWN0aW9uc1wiLFxyXG4gICAgfSk7XHJcbiAgICBhY3Rpb25NZW51QnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XHJcbiAgICAgIHRoaXMucHJvbXB0TWVudSA9XHJcbiAgICAgICAgdGhpcy5wcm9tcHRNZW51ID09PSBcImNvbW1hbmRcIiA/IG51bGwgOiBcImNvbW1hbmRcIjtcclxuICAgICAgdGhpcy5wcm9tcHRNZW51QWN0aXZlID0gMDtcclxuICAgICAgYWN0aW9uTWVudUJ0bi5zZXRBdHRyaWJ1dGUoXHJcbiAgICAgICAgXCJhcmlhLWV4cGFuZGVkXCIsXHJcbiAgICAgICAgU3RyaW5nKHRoaXMucHJvbXB0TWVudSA9PT0gXCJjb21tYW5kXCIpLFxyXG4gICAgICApO1xyXG4gICAgICB2b2lkIHRoaXMucmVuZGVyUHJvbXB0TWVudSgpO1xyXG4gICAgICB0aGlzLmlucHV0LmZvY3VzKCk7XHJcbiAgICB9KTtcclxuXHJcbiAgICB0aGlzLm1vZGVsU2VsZWN0ID0gdG9vbHMuY3JlYXRlRWwoXCJzZWxlY3RcIiwge1xyXG4gICAgICBjbHM6IFwibm94LW1vZGVsLXNlbGVjdFwiLFxyXG4gICAgfSk7XHJcbiAgICB0aGlzLm1vZGVsU2VsZWN0LmFkZEV2ZW50TGlzdGVuZXIoXCJjaGFuZ2VcIiwgKCkgPT4ge1xyXG4gICAgICB0aGlzLmxlYXJuaW5nLnNldE1vZGVsKHRoaXMubW9kZWxTZWxlY3QudmFsdWUpO1xyXG4gICAgfSk7XHJcbiAgICB0aGlzLm1vZGVsU2VsZWN0LnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgXCJMZWFybmluZyBtb2RlbFwiKTtcclxuICAgIHRoaXMubW9kZWxTZWxlY3QudGl0bGUgPSBcIkxlYXJuaW5nIG1vZGVsXCI7XHJcbiAgICB0aGlzLm1vZGVsU2VsZWN0LmNyZWF0ZUVsKFwib3B0aW9uXCIsIHtcclxuICAgICAgdGV4dDogXCJMb2FkaW5nIG1vZGVsc1x1MjAyNlwiLFxyXG4gICAgICBhdHRyOiB7XHJcbiAgICAgICAgZGlzYWJsZWQ6IFwiXCIsXHJcbiAgICAgICAgc2VsZWN0ZWQ6IFwiXCIsXHJcbiAgICAgIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBidG5Hcm91cCA9IGZvb3Rlci5jcmVhdGVEaXYoeyBjbHM6IFwibm94LWJ0bi1ncm91cFwiIH0pO1xyXG5cclxuICAgIHRoaXMuY2FuY2VsQnRuID0gYnRuR3JvdXAuY3JlYXRlRWwoXCJidXR0b25cIiwge1xyXG4gICAgICBjbHM6IFwibm94LWNhbmNlbC1idG4gbm94LWhpZGRlblwiLFxyXG4gICAgICBhdHRyOiB7IHR5cGU6IFwiYnV0dG9uXCIsIFwiYXJpYS1sYWJlbFwiOiBcIlN0b3AgZ2VuZXJhdGluZ1wiIH0sXHJcbiAgICB9KTtcclxuICAgIHNldE5veEljb24odGhpcy5jYW5jZWxCdG4sIFwieFwiKTtcclxuICAgIHRoaXMuY2FuY2VsQnRuLnRpdGxlID0gXCJTdG9wXCI7XHJcbiAgICB0aGlzLmNhbmNlbEJ0bi5zZXRBdHRyaWJ1dGUoXCJhcmlhLWxhYmVsXCIsIFwiU3RvcCBnZW5lcmF0aW5nXCIpO1xyXG4gICAgdGhpcy5jYW5jZWxCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgdGhpcy5sZWFybmluZy5jYW5jZWwoKTtcclxuICAgICAgdGhpcy5jYW5jZWxCdG4uZGlzYWJsZWQgPSB0cnVlO1xyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5zZW5kQnRuID0gYnRuR3JvdXAuY3JlYXRlRWwoXCJidXR0b25cIiwge1xyXG4gICAgICBjbHM6IFwibm94LXNlbmQtYnRuXCIsXHJcbiAgICAgIGF0dHI6IHsgdHlwZTogXCJidXR0b25cIiwgXCJhcmlhLWxhYmVsXCI6IFwiU2VuZCBtZXNzYWdlXCIgfSxcclxuICAgIH0pO1xyXG4gICAgc2V0Tm94SWNvbih0aGlzLnNlbmRCdG4sIFwiYXJyb3ctdXBcIik7XHJcbiAgICB0aGlzLnNlbmRCdG4udGl0bGUgPSBcIlNlbmQgbWVzc2FnZVwiO1xyXG4gICAgdGhpcy5zZW5kQnRuLnNldEF0dHJpYnV0ZShcImFyaWEtbGFiZWxcIiwgXCJTZW5kIG1lc3NhZ2VcIik7XHJcbiAgICB0aGlzLnNlbmRCdG4uZGlzYWJsZWQgPSB0cnVlO1xyXG4gICAgdGhpcy5zZW5kQnRuLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XHJcbiAgICAgIHZvaWQgdGhpcy5kb1NlbmQoKTtcclxuICAgIH0pO1xyXG5cclxuICB9XHJcblxyXG4gIHByaXZhdGUgcmVuZGVyQXR0YWNobWVudHMoKTogdm9pZCB7XHJcbiAgICBpZiAoIXRoaXMuYXR0YWNobWVudHNFbCkgcmV0dXJuO1xyXG5cclxuICAgIHRoaXMuYXR0YWNobWVudHNFbC5lbXB0eSgpO1xyXG4gICAgdGhpcy5hdHRhY2htZW50c0VsLnRvZ2dsZUNsYXNzKFwibm94LWhpZGRlblwiLCB0aGlzLmF0dGFjaG1lbnRzLmxlbmd0aCA9PT0gMCk7XHJcblxyXG4gICAgZm9yIChjb25zdCBbaW5kZXgsIGF0dGFjaG1lbnRdIG9mIHRoaXMuYXR0YWNobWVudHMuZW50cmllcygpKSB7XHJcbiAgICAgIGNvbnN0IGNoaXAgPSB0aGlzLmF0dGFjaG1lbnRzRWwuY3JlYXRlRGl2KHtcclxuICAgICAgICBjbHM6IFwibm94LWF0dGFjaG1lbnQtY2hpcFwiLFxyXG4gICAgICB9KTtcclxuICAgICAgY29uc3QgYXR0YWNobWVudEljb24gPSBjaGlwLmNyZWF0ZVNwYW4oeyBjbHM6IFwibm94LWF0dGFjaG1lbnQtaWNvblwiIH0pO1xyXG4gICAgICBzZXROb3hJY29uKGF0dGFjaG1lbnRJY29uLCBcImZpbGUtdGV4dFwiKTtcclxuICAgICAgY2hpcC5jcmVhdGVTcGFuKHsgY2xzOiBcIm5veC1hdHRhY2htZW50LW5hbWVcIiwgdGV4dDogYXR0YWNobWVudC5uYW1lIH0pO1xyXG5cclxuICAgICAgY29uc3QgcmVtb3ZlID0gY2hpcC5jcmVhdGVFbChcImJ1dHRvblwiLCB7XHJcbiAgICAgICAgY2xzOiBcIm5veC1hdHRhY2htZW50LXJlbW92ZVwiLFxyXG4gICAgICAgIGF0dHI6IHtcclxuICAgICAgICAgIHR5cGU6IFwiYnV0dG9uXCIsXHJcbiAgICAgICAgICBcImFyaWEtbGFiZWxcIjogYFJlbW92ZSAke2F0dGFjaG1lbnQubmFtZX1gLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH0pO1xyXG4gICAgICBzZXROb3hJY29uKHJlbW92ZSwgXCJ4XCIpO1xyXG4gICAgICByZW1vdmUuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgICB0aGlzLmF0dGFjaG1lbnRzLnNwbGljZShpbmRleCwgMSk7XHJcbiAgICAgICAgdGhpcy5leHRyYUN0eCA9IHRoaXMuYXR0YWNobWVudHMubWFwKChpdGVtKSA9PiBpdGVtLnJlZik7XHJcbiAgICAgICAgdGhpcy5yZW5kZXJBdHRhY2htZW50cygpO1xyXG4gICAgICAgIHZvaWQgdGhpcy5zeW5jQ2hpcHMoKTtcclxuICAgICAgfSk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGhhbmRsZUZpbGVzKGZpbGVzOiBGaWxlTGlzdCB8IG51bGwpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGlmICghZmlsZXMgfHwgZmlsZXMubGVuZ3RoID09PSAwKSByZXR1cm47XHJcblxyXG4gICAgdGhpcy5jbG9zZVByb21wdE1lbnUoKTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IGZpbGUgb2YgQXJyYXkuZnJvbShmaWxlcykpIHtcclxuICAgICAgY29uc3QgY29udGVudCA9IGF3YWl0IGZpbGUudGV4dCgpO1xyXG4gICAgICB0aGlzLmF0dGFjaG1lbnRzLnB1c2goe1xyXG4gICAgICAgIG5hbWU6IGZpbGUubmFtZSxcclxuICAgICAgICByZWY6IHtcclxuICAgICAgICAgIGtpbmQ6IFwiYXR0YWNobWVudFwiLFxyXG4gICAgICAgICAgbmFtZTogZmlsZS5uYW1lLFxyXG4gICAgICAgICAgY29udGVudCxcclxuICAgICAgICB9LFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLmV4dHJhQ3R4ID0gdGhpcy5hdHRhY2htZW50cy5tYXAoKGl0ZW0pID0+IGl0ZW0ucmVmKTtcclxuICAgIHRoaXMucmVuZGVyQXR0YWNobWVudHMoKTtcclxuICAgIHRoaXMuZmlsZUlucHV0LnZhbHVlID0gXCJcIjtcclxuICAgIGF3YWl0IHRoaXMuc3luY0NoaXBzKCk7XHJcbiAgICB0aGlzLmlucHV0LmZvY3VzKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGdldFByb21wdE1lbnVJdGVtcygpOiBQcm9taXNlPFByb21wdE1lbnVJdGVtW10+IHtcclxuICAgIGlmICh0aGlzLnByb21wdE1lbnUgPT09IFwiY29tbWFuZFwiKSB7XHJcbiAgICAgIHJldHVybiBQUk9NUFRfQ09NTUFORFMubWFwKChjb21tYW5kKSA9PiAoe1xyXG4gICAgICAgIGtleTogY29tbWFuZC5raW5kLFxyXG4gICAgICAgIG5hbWU6IGNvbW1hbmQubmFtZSxcclxuICAgICAgICBkZXNjcmlwdGlvbjogY29tbWFuZC5kZXNjcmlwdGlvbixcclxuICAgICAgICBpY29uOiBcInNwYXJrbGVzXCIsXHJcbiAgICAgICAgYWN0aW9uOiB7IHR5cGU6IFwibGVhcm5pbmdcIiBhcyBjb25zdCwga2luZDogY29tbWFuZC5raW5kIH0sXHJcbiAgICAgIH0pKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBpdGVtczogUHJvbXB0TWVudUl0ZW1bXSA9IFtdO1xyXG4gICAgY29uc3QgdG9rZW4gPSBwYXJzZVByb21wdFRva2VuKHRoaXMuaW5wdXQudmFsdWUpO1xyXG4gICAgY29uc3QgcXVlcnkgPSB0b2tlbj8ua2luZCA9PT0gXCJzb3VyY2VcIiA/IHRva2VuLnF1ZXJ5IDogXCJcIjtcclxuXHJcbiAgICBpZiAodGhpcy5jdXJyZW50Q29udGV4dD8uc2VsZWN0aW9uKSB7XHJcbiAgICAgIGl0ZW1zLnB1c2goe1xyXG4gICAgICAgIGtleTogXCJjdXJyZW50LXNlbGVjdGlvblwiLFxyXG4gICAgICAgIG5hbWU6IFwiQ3VycmVudCBzZWxlY3Rpb25cIixcclxuICAgICAgICBkZXNjcmlwdGlvbjogdGhpcy5jdXJyZW50Q29udGV4dC5zZWxlY3Rpb24uZmlsZSxcclxuICAgICAgICBpY29uOiBcImNoZWNrXCIsXHJcbiAgICAgICAgZGlzYWJsZWQ6IHRydWUsXHJcbiAgICAgICAgYWN0aW9uOiB7IHR5cGU6IFwiaW5mb1wiIH0sXHJcbiAgICAgIH0pO1xyXG4gICAgfSBlbHNlIGlmICh0aGlzLmN1cnJlbnRDb250ZXh0Py5hY3RpdmVOb3RlKSB7XHJcbiAgICAgIGl0ZW1zLnB1c2goe1xyXG4gICAgICAgIGtleTogXCJjdXJyZW50LW5vdGVcIixcclxuICAgICAgICBuYW1lOiB0aGlzLmN1cnJlbnRDb250ZXh0LmFjdGl2ZU5vdGUucGF0aC5zcGxpdChcIi9cIikucG9wKCkgPz9cclxuICAgICAgICAgIHRoaXMuY3VycmVudENvbnRleHQuYWN0aXZlTm90ZS5wYXRoLFxyXG4gICAgICAgIGRlc2NyaXB0aW9uOiBcIkN1cnJlbnQgbm90ZSBcdTAwQjcgYXV0b21hdGljIGNvbnRleHRcIixcclxuICAgICAgICBpY29uOiBcImZpbGUtdGV4dFwiLFxyXG4gICAgICAgIGRpc2FibGVkOiB0cnVlLFxyXG4gICAgICAgIGFjdGlvbjogeyB0eXBlOiBcImluZm9cIiB9LFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAocXVlcnkpIHtcclxuICAgICAgY29uc3QgZXhjbHVkZWQgPSBuZXcgU2V0KFtcclxuICAgICAgICB0aGlzLmN1cnJlbnRDb250ZXh0Py5hY3RpdmVOb3RlPy5wYXRoLFxyXG4gICAgICAgIHRoaXMuY3VycmVudENvbnRleHQ/LnNlbGVjdGlvbj8uZmlsZSxcclxuICAgICAgICAuLi50aGlzLmV4dHJhQ3R4XHJcbiAgICAgICAgICAuZmlsdGVyKFxyXG4gICAgICAgICAgICAoaXRlbSk6IGl0ZW0gaXMgRXh0cmFjdDxcclxuICAgICAgICAgICAgICBFeHBsaWNpdENvbnRleHRSZWYsXHJcbiAgICAgICAgICAgICAgeyBraW5kOiBcInZhdWx0LW5vdGVcIiB9XHJcbiAgICAgICAgICAgID4gPT4gaXRlbS5raW5kID09PSBcInZhdWx0LW5vdGVcIixcclxuICAgICAgICAgIClcclxuICAgICAgICAgIC5tYXAoKGl0ZW0pID0+IGl0ZW0ucGF0aCksXHJcbiAgICAgIF0uZmlsdGVyKCh2YWx1ZSk6IHZhbHVlIGlzIHN0cmluZyA9PiBCb29sZWFuKHZhbHVlKSkpO1xyXG5cclxuICAgICAgZm9yIChjb25zdCBub3RlIG9mIHRoaXMubGVhcm5pbmcuc2VhcmNoTm90ZXMocXVlcnksIDYpKSB7XHJcbiAgICAgICAgaWYgKGV4Y2x1ZGVkLmhhcyhub3RlLnBhdGgpKSBjb250aW51ZTtcclxuICAgICAgICBpdGVtcy5wdXNoKHtcclxuICAgICAgICAgIGtleTogYG5vdGU6JHtub3RlLnBhdGh9YCxcclxuICAgICAgICAgIG5hbWU6IG5vdGUubmFtZSxcclxuICAgICAgICAgIGRlc2NyaXB0aW9uOiBub3RlLnBhdGgsXHJcbiAgICAgICAgICBpY29uOiBcImZpbGUtdGV4dFwiLFxyXG4gICAgICAgICAgYWN0aW9uOiB7IHR5cGU6IFwidmF1bHQtbm90ZVwiLCBwYXRoOiBub3RlLnBhdGggfSxcclxuICAgICAgICB9KTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGl0ZW1zLnB1c2goe1xyXG4gICAgICBrZXk6IFwiYXR0YWNoXCIsXHJcbiAgICAgIG5hbWU6IFwiQXR0YWNoIHRleHQgZmlsZVwiLFxyXG4gICAgICBkZXNjcmlwdGlvbjogXCJNYXJrZG93biwgdGV4dCwgQ1NWLCBKU09OLCBvciBZQU1MXCIsXHJcbiAgICAgIGljb246IFwicGFwZXJjbGlwXCIsXHJcbiAgICAgIGFjdGlvbjogeyB0eXBlOiBcImF0dGFjaFwiIH0sXHJcbiAgICB9KTtcclxuXHJcbiAgICByZXR1cm4gaXRlbXM7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHJlbmRlclByb21wdE1lbnUoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBpZiAoIXRoaXMucHJvbXB0TWVudUVsKSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgcmVxdWVzdElkID0gKyt0aGlzLnByb21wdE1lbnVSZXF1ZXN0O1xyXG4gICAgdGhpcy5wcm9tcHRNZW51RWwuZW1wdHkoKTtcclxuICAgIHRoaXMucHJvbXB0TWVudVJvd3MgPSBbXTtcclxuICAgIHRoaXMucHJvbXB0TWVudUVsLnRvZ2dsZUNsYXNzKFwibm94LWhpZGRlblwiLCB0aGlzLnByb21wdE1lbnUgPT09IG51bGwpO1xyXG4gICAgdGhpcy5wcm9tcHRQbHVzQnRuPy5zZXRBdHRyaWJ1dGUoXCJhcmlhLWV4cGFuZGVkXCIsIFN0cmluZyh0aGlzLnByb21wdE1lbnUgIT09IG51bGwpKTtcclxuICAgIGlmICghdGhpcy5wcm9tcHRNZW51KSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgdG9rZW4gPSBwYXJzZVByb21wdFRva2VuKHRoaXMuaW5wdXQudmFsdWUpO1xyXG4gICAgY29uc3QgcXVlcnkgPSB0b2tlbj8ua2luZCA9PT0gdGhpcy5wcm9tcHRNZW51ID8gdG9rZW4ucXVlcnkgOiBcIlwiO1xyXG4gICAgY29uc3Qgcm93cyA9IGF3YWl0IHRoaXMuZ2V0UHJvbXB0TWVudUl0ZW1zKCk7XHJcbiAgICBpZiAocmVxdWVzdElkICE9PSB0aGlzLnByb21wdE1lbnVSZXF1ZXN0IHx8ICF0aGlzLnByb21wdE1lbnUpIHJldHVybjtcclxuXHJcbiAgICBsZXQgaW50ZXJhY3RpdmVJbmRleCA9IDA7XHJcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2Ygcm93cykge1xyXG4gICAgICBjb25zdCBtZW51SW5kZXggPSBpdGVtLmRpc2FibGVkID8gLTEgOiBpbnRlcmFjdGl2ZUluZGV4Kys7XHJcbiAgICAgIGNvbnN0IGJ1dHRvbiA9IHRoaXMucHJvbXB0TWVudUVsLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcclxuICAgICAgICBjbHM6IGBub3gtcHJvbXB0LW1lbnUtcm93JHttZW51SW5kZXggPT09IHRoaXMucHJvbXB0TWVudUFjdGl2ZSA/IFwiIGlzLWFjdGl2ZVwiIDogXCJcIn1gLFxyXG4gICAgICAgIGF0dHI6IHsgdHlwZTogXCJidXR0b25cIiB9LFxyXG4gICAgICB9KTtcclxuICAgICAgYnV0dG9uLmRpc2FibGVkID0gQm9vbGVhbihpdGVtLmRpc2FibGVkKTtcclxuICAgICAgY29uc3QgaWNvbiA9IGJ1dHRvbi5jcmVhdGVTcGFuKHsgY2xzOiBcIm5veC1wcm9tcHQtbWVudS1pY29uXCIgfSk7XHJcbiAgICAgIHNldE5veEljb24oaWNvbiwgaXRlbS5pY29uKTtcclxuICAgICAgYnV0dG9uLmNyZWF0ZVNwYW4oeyBjbHM6IFwibm94LXByb21wdC1tZW51LW5hbWVcIiwgdGV4dDogaXRlbS5uYW1lIH0pO1xyXG4gICAgICBidXR0b24uY3JlYXRlU3Bhbih7IGNsczogXCJub3gtcHJvbXB0LW1lbnUtZGVzY3JpcHRpb25cIiwgdGV4dDogaXRlbS5kZXNjcmlwdGlvbiB9KTtcclxuXHJcbiAgICAgIGlmICghaXRlbS5kaXNhYmxlZCkge1xyXG4gICAgICAgIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwibW91c2VlbnRlclwiLCAoKSA9PiB7XHJcbiAgICAgICAgICB0aGlzLnByb21wdE1lbnVBY3RpdmUgPSBtZW51SW5kZXg7XHJcbiAgICAgICAgICB0aGlzLnByb21wdE1lbnVSb3dzLmZvckVhY2goKHJvdywgaW5kZXgpID0+IHtcclxuICAgICAgICAgICAgcm93LnRvZ2dsZUNsYXNzKFwiaXMtYWN0aXZlXCIsIGluZGV4ID09PSB0aGlzLnByb21wdE1lbnVBY3RpdmUpO1xyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgYnV0dG9uLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB2b2lkIHRoaXMucGlja1Byb21wdE1lbnVJdGVtKGl0ZW0pKTtcclxuICAgICAgICB0aGlzLnByb21wdE1lbnVSb3dzLnB1c2goYnV0dG9uKTtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHRoaXMucHJvbXB0TWVudUVsLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJub3gtcHJvbXB0LW1lbnUtaGludFwiLFxyXG4gICAgICB0ZXh0OiB0aGlzLnByb21wdE1lbnUgPT09IFwic291cmNlXCJcclxuICAgICAgICA/IHF1ZXJ5ID8gXCJTZWxlY3QgYSBub3RlIG9yIGF0dGFjaCBhIHRleHQgZmlsZVwiIDogXCJUeXBlIEBuYW1lIHRvIHNlYXJjaCB2YXVsdCBub3Rlc1wiXHJcbiAgICAgICAgOiBcIkNob29zZSBhIGxlYXJuaW5nIGFjdGlvblwiLFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIHBpY2tQcm9tcHRNZW51SXRlbShpdGVtOiBQcm9tcHRNZW51SXRlbSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgYWN0aW9uID0gaXRlbS5hY3Rpb247XHJcbiAgICBpZiAoYWN0aW9uLnR5cGUgPT09IFwiYXR0YWNoXCIpIHtcclxuICAgICAgdGhpcy5jbG9zZVByb21wdE1lbnUoKTtcclxuICAgICAgdGhpcy5maWxlSW5wdXQuY2xpY2soKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG4gICAgaWYgKGFjdGlvbi50eXBlID09PSBcImluZm9cIikgcmV0dXJuO1xyXG5cclxuICAgIGNvbnN0IHRva2VuID0gcGFyc2VQcm9tcHRUb2tlbih0aGlzLmlucHV0LnZhbHVlKTtcclxuICAgIGNvbnN0IHByZWZpeCA9IHRva2VuID8gdGhpcy5pbnB1dC52YWx1ZS5zbGljZSgwLCB0b2tlbi5zdGFydCkgOiB0aGlzLmlucHV0LnZhbHVlO1xyXG5cclxuICAgIGlmIChhY3Rpb24udHlwZSA9PT0gXCJ2YXVsdC1ub3RlXCIpIHtcclxuICAgICAgY29uc3QgZXhpc3RzID0gdGhpcy5leHRyYUN0eC5zb21lKFxyXG4gICAgICAgIChpdGVtKSA9PlxyXG4gICAgICAgICAgaXRlbS5raW5kID09PSBcInZhdWx0LW5vdGVcIiAmJlxyXG4gICAgICAgICAgaXRlbS5wYXRoID09PSBhY3Rpb24ucGF0aCxcclxuICAgICAgKTtcclxuXHJcbiAgICAgIGlmICghZXhpc3RzKSB7XHJcbiAgICAgICAgY29uc3QgcmVmOiBFeHBsaWNpdENvbnRleHRSZWYgPSB7XHJcbiAgICAgICAgICBraW5kOiBcInZhdWx0LW5vdGVcIixcclxuICAgICAgICAgIHBhdGg6IGFjdGlvbi5wYXRoLFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIHRoaXMuYXR0YWNobWVudHMucHVzaCh7XHJcbiAgICAgICAgICBuYW1lOiBhY3Rpb24ucGF0aC5zcGxpdChcIi9cIikucG9wKCkgPz8gYWN0aW9uLnBhdGgsXHJcbiAgICAgICAgICByZWYsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgdGhpcy5leHRyYUN0eCA9IHRoaXMuYXR0YWNobWVudHMubWFwKChpdGVtKSA9PiBpdGVtLnJlZik7XHJcbiAgICAgICAgdGhpcy5yZW5kZXJBdHRhY2htZW50cygpO1xyXG4gICAgICAgIGF3YWl0IHRoaXMuc3luY0NoaXBzKCk7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHRoaXMuaW5wdXQudmFsdWUgPSBwcmVmaXg7XHJcbiAgICAgIHRoaXMuY2xvc2VQcm9tcHRNZW51KCk7XHJcbiAgICAgIHRoaXMub25JbnB1dCgpO1xyXG4gICAgICB0aGlzLmlucHV0LmZvY3VzKCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLnNldEFjdGlvbihhY3Rpb24ua2luZCk7XHJcbiAgICB0aGlzLmlucHV0LnZhbHVlID0gcHJlZml4O1xyXG4gICAgdGhpcy5jbG9zZVByb21wdE1lbnUoKTtcclxuICAgIHRoaXMub25JbnB1dCgpO1xyXG4gICAgdGhpcy5pbnB1dC5mb2N1cygpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjbG9zZVByb21wdE1lbnUoKTogdm9pZCB7XHJcbiAgICB0aGlzLnByb21wdE1lbnVSZXF1ZXN0ICs9IDE7XHJcbiAgICB0aGlzLnByb21wdE1lbnUgPSBudWxsO1xyXG4gICAgdGhpcy5wcm9tcHRNZW51QWN0aXZlID0gMDtcclxuICAgIHZvaWQgdGhpcy5yZW5kZXJQcm9tcHRNZW51KCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHNldEFjdGlvbihhY3Rpb246IExlYXJuaW5nQWN0aW9uS2luZCk6IHZvaWQge1xyXG4gICAgdGhpcy5zZWxlY3RlZEFjdGlvbiA9IGFjdGlvbjtcclxuICAgIHRoaXMuc3luY0FjdGlvbkJ1dHRvbnMoKTtcclxuICAgIHRoaXMudXBkYXRlUGxhY2Vob2xkZXIoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3luY0FjdGlvbkJ1dHRvbnMoKTogdm9pZCB7XHJcbiAgICBmb3IgKGNvbnN0IFtraW5kLCBidXR0b25dIG9mIHRoaXMuYWN0aW9uQnV0dG9ucykge1xyXG4gICAgICBjb25zdCBhY3RpdmUgPSBraW5kID09PSB0aGlzLnNlbGVjdGVkQWN0aW9uO1xyXG4gICAgICBidXR0b24udG9nZ2xlQ2xhc3MoXCJpcy1hY3RpdmVcIiwgYWN0aXZlKTtcclxuICAgICAgYnV0dG9uLnNldEF0dHJpYnV0ZShcImFyaWEtcHJlc3NlZFwiLCBTdHJpbmcoYWN0aXZlKSk7XHJcbiAgICB9XHJcbiAgICB0aGlzLnJlbmRlckludGVudCgpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZW5kZXJJbnRlbnQoKTogdm9pZCB7XHJcbiAgICBpZiAoIXRoaXMuaW50ZW50RWwpIHJldHVybjtcclxuICAgIHRoaXMuaW50ZW50RWwuZW1wdHkoKTtcclxuXHJcbiAgICBjb25zdCB2aXNpYmxlID0gdGhpcy5zZWxlY3RlZEFjdGlvbiAhPT0gXCJhc2tcIjtcclxuICAgIHRoaXMuaW50ZW50RWwudG9nZ2xlQ2xhc3MoXCJub3gtaGlkZGVuXCIsICF2aXNpYmxlKTtcclxuICAgIGlmICghdmlzaWJsZSkgcmV0dXJuO1xyXG5cclxuICAgIGNvbnN0IGxhYmVsID0gQUNUSU9OUy5maW5kKChpdGVtKSA9PiBpdGVtLmtpbmQgPT09IHRoaXMuc2VsZWN0ZWRBY3Rpb24pPy5sYWJlbCA/PyB0aGlzLnNlbGVjdGVkQWN0aW9uO1xyXG4gICAgY29uc3QgY2hpcCA9IHRoaXMuaW50ZW50RWwuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBgbm94LWludGVudC1jaGlwIG5veC1pbnRlbnQtY2hpcC0tJHt0aGlzLnNlbGVjdGVkQWN0aW9ufWAsXHJcbiAgICB9KTtcclxuICAgIGNoaXAuY3JlYXRlU3Bhbih7IGNsczogXCJub3gtaW50ZW50LWxhYmVsXCIsIHRleHQ6IGxhYmVsIH0pO1xyXG5cclxuICAgIGNvbnN0IHJlbW92ZSA9IGNoaXAuY3JlYXRlRWwoXCJidXR0b25cIiwge1xyXG4gICAgICBjbHM6IFwibm94LWludGVudC1yZW1vdmVcIixcclxuICAgICAgYXR0cjogeyB0eXBlOiBcImJ1dHRvblwiLCBcImFyaWEtbGFiZWxcIjogYEV4aXQgJHtsYWJlbH0gbW9kZWAgfSxcclxuICAgIH0pO1xyXG4gICAgc2V0Tm94SWNvbihyZW1vdmUsIFwieFwiKTtcclxuICAgIHJlbW92ZS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICB0aGlzLnNldEFjdGlvbihcImFza1wiKTtcclxuICAgICAgdGhpcy5pbnB1dC5mb2N1cygpO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHVwZGF0ZVBsYWNlaG9sZGVyKCk6IHZvaWQge1xyXG4gICAgY29uc3QgaGFzU2VsZWN0aW9uID0gQm9vbGVhbih0aGlzLmN1cnJlbnRDb250ZXh0Py5zZWxlY3Rpb24pO1xyXG4gICAgY29uc3QgaGFzTm90ZSA9IEJvb2xlYW4odGhpcy5jdXJyZW50Q29udGV4dD8uYWN0aXZlTm90ZSk7XHJcblxyXG4gICAgY29uc3QgYXNrUGxhY2Vob2xkZXIgPSBoYXNTZWxlY3Rpb25cclxuICAgICAgPyBcIkFzayBhYm91dCB0aGlzIHNlbGVjdGlvbi4uLlwiXHJcbiAgICAgIDogaGFzTm90ZVxyXG4gICAgICAgID8gXCJBc2sgYWJvdXQgdGhpcyBub3RlLi4uXCJcclxuICAgICAgICA6IFwiQXNrIE5veC4uLlwiO1xyXG5cclxuICAgIGNvbnN0IHBsYWNlaG9sZGVyczogUmVjb3JkPExlYXJuaW5nQWN0aW9uS2luZCwgc3RyaW5nPiA9IHtcclxuICAgICAgYXNrOiBhc2tQbGFjZWhvbGRlcixcclxuICAgICAgZXhwbGFpbjogaGFzU2VsZWN0aW9uXHJcbiAgICAgICAgPyBcIldoYXQgc2hvdWxkIEkgZXhwbGFpbiBhYm91dCB0aGlzIHNlbGVjdGlvbj9cIlxyXG4gICAgICAgIDogXCJXaGF0IHNob3VsZCBJIGV4cGxhaW4/XCIsXHJcbiAgICAgIHByYWN0aWNlOiBoYXNTZWxlY3Rpb25cclxuICAgICAgICA/IFwiUHJhY3RpY2UgdGhpcyBzZWxlY3Rpb24uLi5cIlxyXG4gICAgICAgIDogXCJXaGF0IHNob3VsZCB3ZSBwcmFjdGljZT9cIixcclxuICAgICAgcmV2aWV3OiBoYXNOb3RlXHJcbiAgICAgICAgPyBcIldoYXQgc2hvdWxkIEkgcmV2aWV3IGluIHRoaXMgbm90ZT9cIlxyXG4gICAgICAgIDogXCJXaGF0IHNob3VsZCBJIHJldmlldz9cIixcclxuICAgICAgZWRpdDogaGFzTm90ZVxyXG4gICAgICAgID8gXCJIb3cgc2hvdWxkIEkgaW1wcm92ZSB0aGlzIG5vdGU/XCJcclxuICAgICAgICA6IFwiV2hhdCBzaG91bGQgSSBpbXByb3ZlP1wiLFxyXG4gICAgfTtcclxuXHJcbiAgICBpZiAodGhpcy5pbnB1dCkge1xyXG4gICAgICB0aGlzLmlucHV0LnBsYWNlaG9sZGVyID0gcGxhY2Vob2xkZXJzW3RoaXMuc2VsZWN0ZWRBY3Rpb25dO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyBzeW5jQ2hpcHMoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBjb250ZXh0ID0gYXdhaXQgdGhpcy5sZWFybmluZy5yZXNvbHZlQ29udGV4dCh0aGlzLmV4dHJhQ3R4KTtcclxuICAgIHRoaXMuY3VycmVudENvbnRleHQgPSBjb250ZXh0O1xyXG4gICAgdGhpcy5zeXN0ZW1DaGlwLmFkZENsYXNzKFwibm94LWNoaXAtLWhpZGRlblwiKTtcclxuXHJcbiAgICBjb25zdCBoYXNTZWxlY3Rpb24gPSBCb29sZWFuKGNvbnRleHQuc2VsZWN0aW9uKTtcclxuICAgIHRoaXMuc2VsZWN0aW9uQ2hpcC50b2dnbGVDbGFzcyhcIm5veC1jaGlwLS1oaWRkZW5cIiwgIWhhc1NlbGVjdGlvbik7XHJcblxyXG4gICAgY29uc3QgYWN0aXZlTm90ZSA9IGNvbnRleHQuYWN0aXZlTm90ZTtcclxuICAgIHRoaXMubm90ZUNoaXAudG9nZ2xlQ2xhc3MoXCJub3gtY2hpcC0taGlkZGVuXCIsICFhY3RpdmVOb3RlKTtcclxuXHJcbiAgICBpZiAoYWN0aXZlTm90ZSkge1xyXG4gICAgICBjb25zdCBuYW1lID0gYWN0aXZlTm90ZS5wYXRoLnNwbGl0KFwiL1wiKS5wb3AoKSA/PyBhY3RpdmVOb3RlLnBhdGg7XHJcbiAgICAgIGNvbnN0IGxhYmVsID0gdGhpcy5ub3RlQ2hpcC5xdWVyeVNlbGVjdG9yPEhUTUxFbGVtZW50PihcIi5ub3gtY2hpcC1sYWJlbFwiKTtcclxuICAgICAgaWYgKGxhYmVsKSBsYWJlbC50ZXh0Q29udGVudCA9IGBAJHtuYW1lfWA7XHJcbiAgICAgIHRoaXMubm90ZUNoaXAudGl0bGUgPSBhY3RpdmVOb3RlLnBhdGg7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy51cGRhdGVQbGFjZWhvbGRlcigpO1xyXG5cclxuICAgIGlmIChcclxuICAgICAgdGhpcy51aVN0YXRlID09PSBcIkVNUFRZXCIgJiZcclxuICAgICAgdGhpcy50aHJlYWQucXVlcnlTZWxlY3RvcihcIi5ub3gtZW1wdHktc2xhdGVcIilcclxuICAgICkge1xyXG4gICAgICB0aGlzLnNob3dFbXB0eSgpO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBvbklucHV0KCk6IHZvaWQge1xyXG4gICAgdGhpcy5zZW5kQnRuLmRpc2FibGVkID1cclxuICAgICAgIXRoaXMuY2FuU2VuZCgpIHx8IHRoaXMudWlTdGF0ZSA9PT0gXCJSVU5OSU5HXCI7XHJcblxyXG4gICAgY29uc3QgdG9rZW4gPSBwYXJzZVByb21wdFRva2VuKHRoaXMuaW5wdXQudmFsdWUpO1xyXG4gICAgaWYgKHRva2VuICYmIHRoaXMucHJvbXB0TWVudSAhPT0gdG9rZW4ua2luZCkge1xyXG4gICAgICB0aGlzLnByb21wdE1lbnUgPSB0b2tlbi5raW5kO1xyXG4gICAgICB0aGlzLnByb21wdE1lbnVBY3RpdmUgPSAwO1xyXG4gICAgfSBlbHNlIGlmICghdG9rZW4pIHtcclxuICAgICAgdGhpcy5jbG9zZVByb21wdE1lbnUoKTtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLnJlbmRlclByb21wdE1lbnUoKTtcclxuXHJcbiAgICB0aGlzLmlucHV0LnN0eWxlLmhlaWdodCA9IFwiYXV0b1wiO1xyXG4gICAgdGhpcy5pbnB1dC5zdHlsZS5oZWlnaHQgPVxyXG4gICAgICBNYXRoLm1pbih0aGlzLmlucHV0LnNjcm9sbEhlaWdodCwgODApICsgXCJweFwiO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBvbktleShldmVudDogS2V5Ym9hcmRFdmVudCk6IHZvaWQge1xyXG4gICAgaWYgKHRoaXMucHJvbXB0TWVudSAmJiB0aGlzLnByb21wdE1lbnVSb3dzLmxlbmd0aCA+IDApIHtcclxuICAgICAgaWYgKGV2ZW50LmtleSA9PT0gXCJBcnJvd0Rvd25cIiB8fCBldmVudC5rZXkgPT09IFwiQXJyb3dVcFwiKSB7XHJcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICBjb25zdCBkaXJlY3Rpb24gPSBldmVudC5rZXkgPT09IFwiQXJyb3dEb3duXCIgPyAxIDogLTE7XHJcbiAgICAgICAgdGhpcy5wcm9tcHRNZW51QWN0aXZlID1cclxuICAgICAgICAgICh0aGlzLnByb21wdE1lbnVBY3RpdmUgKyBkaXJlY3Rpb24gKyB0aGlzLnByb21wdE1lbnVSb3dzLmxlbmd0aCkgJVxyXG4gICAgICAgICAgdGhpcy5wcm9tcHRNZW51Um93cy5sZW5ndGg7XHJcbiAgICAgICAgdGhpcy5wcm9tcHRNZW51Um93cy5mb3JFYWNoKChyb3csIGluZGV4KSA9PiB7XHJcbiAgICAgICAgICByb3cudG9nZ2xlQ2xhc3MoXCJpcy1hY3RpdmVcIiwgaW5kZXggPT09IHRoaXMucHJvbXB0TWVudUFjdGl2ZSk7XHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAoKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiICYmICFldmVudC5zaGlmdEtleSkgfHwgZXZlbnQua2V5ID09PSBcIlRhYlwiKSB7XHJcbiAgICAgICAgZXZlbnQucHJldmVudERlZmF1bHQoKTtcclxuICAgICAgICBjb25zdCByb3cgPSB0aGlzLnByb21wdE1lbnVSb3dzW3RoaXMucHJvbXB0TWVudUFjdGl2ZV07XHJcbiAgICAgICAgaWYgKHJvdykgcm93LmNsaWNrKCk7XHJcbiAgICAgICAgcmV0dXJuO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGV2ZW50LmtleSA9PT0gXCJFbnRlclwiICYmICFldmVudC5zaGlmdEtleSkge1xyXG4gICAgICBldmVudC5wcmV2ZW50RGVmYXVsdCgpO1xyXG4gICAgICBpZiAoIXRoaXMuc2VuZEJ0bi5kaXNhYmxlZCkgdm9pZCB0aGlzLmRvU2VuZCgpO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChldmVudC5rZXkgPT09IFwiRXNjYXBlXCIpIHtcclxuICAgICAgaWYgKHRoaXMucHJvbXB0TWVudSkge1xyXG4gICAgICAgIHRoaXMuY2xvc2VQcm9tcHRNZW51KCk7XHJcbiAgICAgIH0gZWxzZSBpZiAodGhpcy51aVN0YXRlID09PSBcIlJVTk5JTkdcIikge1xyXG4gICAgICAgIHRoaXMuY2FuY2VsQnRuLmNsaWNrKCk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZG9TZW5kKCk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgY29uc3QgcHJvbXB0ID0gdGhpcy5pbnB1dC52YWx1ZS50cmltKCkgfHwgXCJSZXZpZXcgdGhlIGF0dGFjaGVkIGNvbnRleHQuXCI7XHJcbiAgICBpZiAoIXRoaXMuY2FuU2VuZCgpIHx8IHRoaXMudWlTdGF0ZSA9PT0gXCJSVU5OSU5HXCIpIHJldHVybjtcclxuXHJcbiAgICBjb25zdCBleHBsaWNpdENvbnRleHQgPSB0aGlzLmV4dHJhQ3R4O1xyXG4gICAgdGhpcy5jbG9zZVByb21wdE1lbnUoKTtcclxuXHJcbiAgICB0aGlzLmlucHV0LnZhbHVlID0gXCJcIjtcclxuICAgIHRoaXMuaW5wdXQuc3R5bGUuaGVpZ2h0ID0gXCJcIjtcclxuICAgIHRoaXMuYXR0YWNobWVudHMgPSBbXTtcclxuICAgIHRoaXMuZXh0cmFDdHggPSBbXTtcclxuICAgIHRoaXMucmVuZGVyQXR0YWNobWVudHMoKTtcclxuICAgIHRoaXMuc2VuZEJ0bi5kaXNhYmxlZCA9IHRydWU7XHJcblxyXG4gICAgdGhpcy5hZ2VudEN1cnNvckVsID0gbnVsbDtcclxuICAgIHRoaXMuYWdlbnRDb250ZW50RWwgPSBudWxsO1xyXG4gICAgdGhpcy5zdGF0dXNFbCA9IG51bGw7XHJcbiAgICB0aGlzLnN0cmVhbWVkUmVzcG9uc2VUZXh0ID0gXCJcIjtcclxuICAgIHRoaXMuc3RyZWFtaW5nUGVuZGluZ1RleHQgPSBcIlwiO1xyXG4gICAgdGhpcy5zdG9wVGhpbmtpbmdTZXF1ZW5jZSgpO1xyXG4gICAgdGhpcy5zdG9wTG9hZGluZ1RpbWVyKCk7XHJcblxyXG4gICAgdGhpcy5ydW5uaW5nQWN0aW9uID0gdGhpcy5zZWxlY3RlZEFjdGlvbjtcclxuICAgIHRoaXMuYXBwZW5kVXNlckJ1YmJsZShwcm9tcHQpO1xyXG4gICAgdGhpcy5zZXRVSVN0YXRlKFwiUlVOTklOR1wiKTtcclxuICAgIHRoaXMuZW5zdXJlQWdlbnRCdWJibGUoKTtcclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBmb3IgYXdhaXQgKGNvbnN0IGV2ZW50IG9mIHRoaXMubGVhcm5pbmcucnVuKHtcclxuICAgICAgICBwcm9tcHQsXHJcbiAgICAgICAgYWN0aW9uOiB0aGlzLnJ1bm5pbmdBY3Rpb24sXHJcbiAgICAgICAgZXhwbGljaXRDb250ZXh0LFxyXG4gICAgICB9KSkge1xyXG4gICAgICAgIHRoaXMuaGFuZGxlTGVhcm5pbmdFdmVudChldmVudCk7XHJcbiAgICAgIH1cclxuICAgIH0gY2F0Y2ggKGVycikge1xyXG4gICAgICB0aGlzLmZpbmlzaFN0cmVhbWluZ0J1YmJsZShcIlN0b3BwZWRcIik7XHJcblxyXG4gICAgICBjb25zdCBtZXNzYWdlID1cclxuICAgICAgICBlcnIgaW5zdGFuY2VvZiBFcnJvciA/IGVyci5tZXNzYWdlIDogU3RyaW5nKGVycik7XHJcblxyXG4gICAgICBjb25zb2xlLndhcm4oXCJbTm94XSBVbmV4cGVjdGVkIHR1cm4gZmFpbHVyZVwiLCBtZXNzYWdlKTtcclxuICAgICAgdGhpcy5hcHBlbmRJbmxpbmVFcnJvcihcclxuICAgICAgICB0aGlzLnRocmVhZCxcclxuICAgICAgICBcIk5veCBoaXQgYW4gdW5leHBlY3RlZCBlcnJvci4gVHJ5IGFnYWluLlwiLFxyXG4gICAgICApO1xyXG4gICAgICB0aGlzLnNldFVJU3RhdGUoXCJBTlNXRVJcIik7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGhhbmRsZUxlYXJuaW5nRXZlbnQoZXZlbnQ6IExlYXJuaW5nRXZlbnQpOiB2b2lkIHtcclxuICAgIGlmIChldmVudC50eXBlID09PSBcImNvbnRleHQtcmVhZHlcIikge1xyXG4gICAgICB0aGlzLmN1cnJlbnRDb250ZXh0ID0gZXZlbnQuY29udGV4dC5yZXNvbHZlZDtcclxuICAgICAgdGhpcy5zeXN0ZW1Db250ZXh0RmlsZXMgPSBldmVudC5jb250ZXh0LnN5c3RlbS5tYXAoKGl0ZW0pID0+IGl0ZW0uZmlsZSk7XHJcbiAgICAgIHRoaXMuc3lzdGVtQ2hpcC50b2dnbGVDbGFzcyhcIm5veC1jaGlwLS1oaWRkZW5cIiwgZXZlbnQuY29udGV4dC5zeXN0ZW0ubGVuZ3RoID09PSAwKTtcclxuICAgICAgdGhpcy5zeXN0ZW1DaGlwLnRpdGxlID0gdGhpcy5zeXN0ZW1Db250ZXh0RmlsZXMuam9pbihcIlxcblwiKTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChldmVudC50eXBlID09PSBcInJlc3BvbnNlLWRlbHRhXCIpIHtcclxuICAgICAgdGhpcy5hcHBlbmRUb0FnZW50QnViYmxlKGV2ZW50LnRleHQpO1xyXG4gICAgICB0aGlzLnNjcm9sbFRocmVhZCgpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGV2ZW50LnR5cGUgPT09IFwicHJhY3RpY2UtcXVlc3Rpb25cIikge1xyXG4gICAgICB0aGlzLmFwcGVuZFByYWN0aWNlUXVlc3Rpb24oZXZlbnQucXVlc3Rpb24pO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGV2ZW50LnR5cGUgPT09IFwicHJhY3RpY2UtZXZhbHVhdGlvblwiKSB7XHJcbiAgICAgIHRoaXMuYXBwZW5kUHJhY3RpY2VFdmFsdWF0aW9uKGV2ZW50LmV2YWx1YXRpb24pO1xyXG4gICAgICBpZiAoIWV2ZW50LmV2YWx1YXRpb24ubmV4dFF1ZXN0aW9uPy50cmltKCkpIHRoaXMuc2V0QWN0aW9uKFwiYXNrXCIpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGV2ZW50LnR5cGUgPT09IFwicmV2aWV3LWZpbmRpbmdzXCIpIHtcclxuICAgICAgdGhpcy5hcHBlbmRSZXZpZXdGaW5kaW5ncyhldmVudC5maW5kaW5ncyk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJsZWFybmluZy1zdGF0ZS11cGRhdGVkXCIpIHtcclxuICAgICAgdGhpcy5hcHBlbmRQcm9ncmVzc1VwZGF0ZShldmVudC5zdGF0ZS5jdXJyZW50VG9waWMsIGV2ZW50LnN0YXRlLmdhcHMpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGV2ZW50LnR5cGUgPT09IFwibXV0YXRpb24tcHJvcG9zZWRcIikge1xyXG4gICAgICB0aGlzLnNldFVJU3RhdGUoXCJQUk9QT1NBTFwiKTtcclxuICAgICAgdGhpcy5hcHBlbmRQcm9wb3NhbEJ1YmJsZShldmVudC5lZGl0KTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGlmIChldmVudC50eXBlID09PSBcImNvbXBsZXRlZFwiKSB7XHJcbiAgICAgIGlmICh0aGlzLnVpU3RhdGUgPT09IFwiUlVOTklOR1wiKSB0aGlzLnNldFVJU3RhdGUoXCJBTlNXRVJcIik7XHJcbiAgICAgIHRoaXMuZmluaXNoU3RyZWFtaW5nQnViYmxlKCk7XHJcbiAgICAgIGlmIChcclxuICAgICAgICB0aGlzLnJ1bm5pbmdBY3Rpb24gPT09IFwiZXhwbGFpblwiIHx8XHJcbiAgICAgICAgdGhpcy5ydW5uaW5nQWN0aW9uID09PSBcInJldmlld1wiIHx8XHJcbiAgICAgICAgdGhpcy5ydW5uaW5nQWN0aW9uID09PSBcImVkaXRcIlxyXG4gICAgICApIHtcclxuICAgICAgICB0aGlzLnNldEFjdGlvbihcImFza1wiKTtcclxuICAgICAgfVxyXG4gICAgICB0aGlzLnJ1bm5pbmdBY3Rpb24gPSBudWxsO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKGV2ZW50LnR5cGUgPT09IFwiY2FuY2VsbGVkXCIpIHtcclxuICAgICAgdGhpcy5maW5pc2hTdHJlYW1pbmdCdWJibGUoXCJTdG9wcGVkXCIpO1xyXG4gICAgICB0aGlzLmFwcGVuZElubGluZUVycm9yKHRoaXMudGhyZWFkLCBcIlN0b3BwZWQuXCIpO1xyXG4gICAgICB0aGlzLnNldFVJU3RhdGUoXCJBTlNXRVJcIik7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJmYWlsZWRcIikge1xyXG4gICAgICB0aGlzLmZpbmlzaFN0cmVhbWluZ0J1YmJsZShcIlVuYWJsZSB0byBmaW5pc2hcIik7XHJcbiAgICAgIHRoaXMuYXBwZW5kSW5saW5lRXJyb3IodGhpcy50aHJlYWQsIGV2ZW50LmZhaWx1cmUubWVzc2FnZSk7XHJcbiAgICAgIHRoaXMuc2V0VUlTdGF0ZShcIkFOU1dFUlwiKTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgZmluaXNoU3RyZWFtaW5nQnViYmxlKGRvbmVMYWJlbD86IHN0cmluZyk6IHZvaWQge1xyXG4gICAgY29uc3QgZWxhcHNlZCA9IHRoaXMuZm9ybWF0RWxhcHNlZChEYXRlLm5vdygpIC0gdGhpcy5sb2FkaW5nU3RhcnRlZEF0KTtcclxuICAgIHRoaXMuc3RvcFRoaW5raW5nU2VxdWVuY2UoKTtcclxuICAgIHRoaXMuZmx1c2hTdHJlYW1pbmdUZXh0KCk7XHJcbiAgICB0aGlzLnJlbmRlck1hcmtkb3duUmVzcG9uc2UoKTtcclxuICAgIGlmIChkb25lTGFiZWwgPT09IHVuZGVmaW5lZCkgdGhpcy5hcHBlbmRTdHJlYW1BY3Rpb25zKCk7XHJcbiAgICB0aGlzLnNldHRsZVRoaW5raW5nKGRvbmVMYWJlbCA/PyBgQ29tcGxldGVkIGluICR7ZWxhcHNlZH1gKTtcclxuICAgIGlmICh0aGlzLnJlc3BvbnNlVGltZUVsKSB0aGlzLnJlc3BvbnNlVGltZUVsLnRleHRDb250ZW50ID0gYGZvciAke2VsYXBzZWR9YDtcclxuICAgIHRoaXMuc3RvcExvYWRpbmdUaW1lcigpO1xyXG4gICAgdGhpcy5hZ2VudEN1cnNvckVsPy5yZW1vdmVDbGFzcyhcIm5veC1idWJibGUtLXN0cmVhbWluZ1wiKTtcclxuICAgIHRoaXMuYWdlbnRDdXJzb3JFbCA9IG51bGw7XHJcbiAgICB0aGlzLmFnZW50Q29udGVudEVsID0gbnVsbDtcclxuICAgIHRoaXMuc3RhdHVzRWwgPSBudWxsO1xyXG4gICAgdGhpcy50aGlua2luZ1RvZ2dsZUVsID0gbnVsbDtcclxuICAgIHRoaXMudGhpbmtpbmdMYWJlbEVsID0gbnVsbDtcclxuICAgIHRoaXMudGhpbmtpbmdDaGV2cm9uRWwgPSBudWxsO1xyXG4gICAgdGhpcy50aGlua2luZ1BhbmVsRWwgPSBudWxsO1xyXG4gICAgdGhpcy50aGlua2luZ1Jvd3MgPSBbXTtcclxuICAgIHRoaXMudGhpbmtpbmdNYW51YWxFeHBhbmRlZCA9IG51bGw7XHJcbiAgICB0aGlzLnJlc3BvbnNlVGltZUVsID0gbnVsbDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc2V0dGxlVGhpbmtpbmcoZG9uZUxhYmVsOiBzdHJpbmcpOiB2b2lkIHtcclxuICAgIGlmICghdGhpcy50aGlua2luZ0xhYmVsRWwpIHJldHVybjtcclxuXHJcbiAgICB0aGlzLnRoaW5raW5nTGFiZWxFbC50ZXh0Q29udGVudCA9IGRvbmVMYWJlbDtcclxuICAgIHRoaXMudGhpbmtpbmdMYWJlbEVsLnJlbW92ZUNsYXNzKFwibm94LXRoaW5raW5nLWxhYmVsLS1hY3RpdmVcIik7XHJcbiAgICB0aGlzLnRoaW5raW5nTGFiZWxFbC5hZGRDbGFzcyhcIm5veC10aGlua2luZy1sYWJlbC0tZG9uZVwiKTtcclxuXHJcbiAgICBmb3IgKGNvbnN0IHJvdyBvZiB0aGlzLnRoaW5raW5nUm93cykge1xyXG4gICAgICByb3cucmVtb3ZlQ2xhc3MoXCJub3gtaGlkZGVuXCIpO1xyXG4gICAgICByb3cucmVtb3ZlQ2xhc3MoXCJpcy1hY3RpdmVcIik7XHJcbiAgICAgIHJvdy5hZGRDbGFzcyhcImlzLWRvbmVcIik7XHJcblxyXG4gICAgICBjb25zdCBtYXJrZXIgPSByb3cuZmlyc3RFbGVtZW50Q2hpbGQgYXMgSFRNTEVsZW1lbnQgfCBudWxsO1xyXG4gICAgICBpZiAobWFya2VyKSB7XHJcbiAgICAgICAgbWFya2VyLnRleHRDb250ZW50ID0gXCJcdTI3MTNcIjtcclxuICAgICAgICBtYXJrZXIucmVtb3ZlQ2xhc3MoXCJub3gtdGhpbmtpbmctbWFya2VyLS1zcGlubmVyXCIpO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgZXhwYW5kZWQgPSB0aGlzLnRoaW5raW5nTWFudWFsRXhwYW5kZWQgPz8gZmFsc2U7XHJcbiAgICB0aGlzLnRoaW5raW5nUGFuZWxFbD8udG9nZ2xlQ2xhc3MoXCJpcy1leHBhbmRlZFwiLCBleHBhbmRlZCk7XHJcbiAgICB0aGlzLnRoaW5raW5nVG9nZ2xlRWw/LnNldEF0dHJpYnV0ZShcImFyaWEtZXhwYW5kZWRcIiwgU3RyaW5nKGV4cGFuZGVkKSk7XHJcbiAgICB0aGlzLnRoaW5raW5nQ2hldnJvbkVsPy50b2dnbGVDbGFzcyhcImlzLWV4cGFuZGVkXCIsIGV4cGFuZGVkKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RvcFRoaW5raW5nU2VxdWVuY2UoKTogdm9pZCB7XHJcbiAgICBpZiAodGhpcy50aGlua2luZ1N0YWdlVGltZXIgIT09IG51bGwpIHtcclxuICAgICAgd2luZG93LmNsZWFyVGltZW91dCh0aGlzLnRoaW5raW5nU3RhZ2VUaW1lcik7XHJcbiAgICAgIHRoaXMudGhpbmtpbmdTdGFnZVRpbWVyID0gbnVsbDtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgc3RhcnRUaGlua2luZ1NlcXVlbmNlKCk6IHZvaWQge1xyXG4gICAgdGhpcy50aGlua2luZ1N0YWdlID0gMDtcclxuICAgIHRoaXMucmVuZGVyVGhpbmtpbmdTdGFnZSgpO1xyXG4gICAgdGhpcy5zY2hlZHVsZVRoaW5raW5nU3RhZ2UoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc2NoZWR1bGVUaGlua2luZ1N0YWdlKCk6IHZvaWQge1xyXG4gICAgaWYgKHRoaXMudGhpbmtpbmdTdGFnZSA+PSB0aGlzLnRoaW5raW5nUm93cy5sZW5ndGggLSAxKSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgZGVsYXlzID0gWzgwMCwgNjAwLCAxODAwLCAyNjAwXTtcclxuICAgIGNvbnN0IGRlbGF5ID0gZGVsYXlzW3RoaXMudGhpbmtpbmdTdGFnZV0gPz8gMTIwMDtcclxuXHJcbiAgICB0aGlzLnRoaW5raW5nU3RhZ2VUaW1lciA9IHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgdGhpcy50aGlua2luZ1N0YWdlICs9IDE7XHJcbiAgICAgIHRoaXMucmVuZGVyVGhpbmtpbmdTdGFnZSgpO1xyXG4gICAgICB0aGlzLnNjaGVkdWxlVGhpbmtpbmdTdGFnZSgpO1xyXG4gICAgfSwgZGVsYXkpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSByZW5kZXJUaGlua2luZ1N0YWdlKCk6IHZvaWQge1xyXG4gICAgY29uc3QgdmlzaWJsZSA9IE1hdGgubWluKFxyXG4gICAgICB0aGlzLnRoaW5raW5nU3RhZ2UgKyAxLFxyXG4gICAgICB0aGlzLnRoaW5raW5nUm93cy5sZW5ndGgsXHJcbiAgICApO1xyXG5cclxuICAgIHRoaXMudGhpbmtpbmdSb3dzLmZvckVhY2goKHJvdywgaW5kZXgpID0+IHtcclxuICAgICAgY29uc3QgYWN0aXZlID0gaW5kZXggPT09IHZpc2libGUgLSAxO1xyXG4gICAgICBjb25zdCBkb25lID0gaW5kZXggPCB2aXNpYmxlIC0gMTtcclxuICAgICAgY29uc3QgbWFya2VyID0gcm93LmZpcnN0RWxlbWVudENoaWxkIGFzIEhUTUxFbGVtZW50IHwgbnVsbDtcclxuXHJcbiAgICAgIHJvdy50b2dnbGVDbGFzcyhcIm5veC1oaWRkZW5cIiwgaW5kZXggPj0gdmlzaWJsZSk7XHJcbiAgICAgIHJvdy50b2dnbGVDbGFzcyhcImlzLWFjdGl2ZVwiLCBhY3RpdmUpO1xyXG4gICAgICByb3cudG9nZ2xlQ2xhc3MoXCJpcy1kb25lXCIsIGRvbmUpO1xyXG5cclxuICAgICAgaWYgKG1hcmtlcikge1xyXG4gICAgICAgIG1hcmtlci50ZXh0Q29udGVudCA9IGRvbmUgPyBcIlx1MjcxM1wiIDogXCJcIjtcclxuICAgICAgICBtYXJrZXIudG9nZ2xlQ2xhc3MoXCJub3gtdGhpbmtpbmctbWFya2VyLS1zcGlubmVyXCIsIGFjdGl2ZSk7XHJcbiAgICAgIH1cclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdGFydExvYWRpbmdUaW1lcigpOiB2b2lkIHtcclxuICAgIGlmICh0aGlzLmxvYWRpbmdUaW1lciAhPT0gbnVsbCkge1xyXG4gICAgICB3aW5kb3cuY2xlYXJJbnRlcnZhbCh0aGlzLmxvYWRpbmdUaW1lcik7XHJcbiAgICAgIHRoaXMubG9hZGluZ1RpbWVyID0gbnVsbDtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCB1cGRhdGUgPSAoKSA9PiB7XHJcbiAgICAgIGNvbnN0IGVsYXBzZWQgPSB0aGlzLmZvcm1hdEVsYXBzZWQoRGF0ZS5ub3coKSAtIHRoaXMubG9hZGluZ1N0YXJ0ZWRBdCk7XHJcbiAgICAgIGlmICh0aGlzLmxvYWRpbmdFbGFwc2VkRWwpIHRoaXMubG9hZGluZ0VsYXBzZWRFbC50ZXh0Q29udGVudCA9IGVsYXBzZWQ7XHJcbiAgICAgIGlmICh0aGlzLnJlc3BvbnNlVGltZUVsKSB0aGlzLnJlc3BvbnNlVGltZUVsLnRleHRDb250ZW50ID0gYGZvciAke2VsYXBzZWR9YDtcclxuICAgIH07XHJcblxyXG4gICAgdGhpcy5sb2FkaW5nU3RhcnRlZEF0ID0gRGF0ZS5ub3coKTtcclxuICAgIHVwZGF0ZSgpO1xyXG4gICAgdGhpcy5sb2FkaW5nVGltZXIgPSB3aW5kb3cuc2V0SW50ZXJ2YWwodXBkYXRlLCAxMDApO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzdG9wTG9hZGluZ1RpbWVyKCk6IHZvaWQge1xyXG4gICAgaWYgKHRoaXMubG9hZGluZ1RpbWVyICE9PSBudWxsKSB7XHJcbiAgICAgIHdpbmRvdy5jbGVhckludGVydmFsKHRoaXMubG9hZGluZ1RpbWVyKTtcclxuICAgICAgdGhpcy5sb2FkaW5nVGltZXIgPSBudWxsO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMubG9hZGluZ0VsYXBzZWRFbCA9IG51bGw7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGZvcm1hdEVsYXBzZWQobWlsbGlzZWNvbmRzOiBudW1iZXIpOiBzdHJpbmcge1xyXG4gICAgY29uc3Qgc2Vjb25kcyA9IG1pbGxpc2Vjb25kcyAvIDEwMDA7XHJcblxyXG4gICAgaWYgKHNlY29uZHMgPCA2MCkgcmV0dXJuIGAke3NlY29uZHMudG9GaXhlZCgxKX1zYDtcclxuXHJcbiAgICByZXR1cm4gYCR7TWF0aC5mbG9vcihzZWNvbmRzIC8gNjApfW0gJHsoc2Vjb25kcyAlIDYwKS50b0ZpeGVkKDEpfXNgO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBzZXRVSVN0YXRlKHN0YXRlOiBVSVN0YXRlKTogdm9pZCB7XHJcbiAgICB0aGlzLnVpU3RhdGUgPSBzdGF0ZTtcclxuXHJcbiAgICBjb25zdCBidXN5ID0gc3RhdGUgPT09IFwiUlVOTklOR1wiO1xyXG4gICAgdGhpcy5jYW5jZWxCdG4uZGlzYWJsZWQgPSBmYWxzZTtcclxuICAgIHRoaXMuaW5wdXQuZGlzYWJsZWQgPSBidXN5IHx8IHN0YXRlID09PSBcIkVSUk9SXCI7XHJcbiAgICB0aGlzLnNlbmRCdG4uZGlzYWJsZWQgPVxyXG4gICAgICBidXN5IHx8IHN0YXRlID09PSBcIkVSUk9SXCIgfHwgIXRoaXMuY2FuU2VuZCgpO1xyXG4gICAgdGhpcy5jYW5jZWxCdG4udG9nZ2xlQ2xhc3MoXCJub3gtaGlkZGVuXCIsICFidXN5KTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgY2FuU2VuZCgpOiBib29sZWFuIHtcclxuICAgIHJldHVybiB0aGlzLmlucHV0LnZhbHVlLnRyaW0oKS5sZW5ndGggPiAwIHx8IHRoaXMuYXR0YWNobWVudHMubGVuZ3RoID4gMDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc2hvd0VtcHR5KCk6IHZvaWQge1xyXG4gICAgdGhpcy5zdG9wTG9hZGluZ1RpbWVyKCk7XHJcbiAgICB0aGlzLnRocmVhZC5lbXB0eSgpO1xyXG4gICAgdGhpcy5hZ2VudEN1cnNvckVsID0gbnVsbDtcclxuICAgIHRoaXMuc3RhdHVzRWwgPSBudWxsO1xyXG5cclxuICAgIGNvbnN0IHNsYXRlID0gdGhpcy50aHJlYWQuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcIm5veC1lbXB0eS1zbGF0ZVwiLFxyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5yZW5kZXJFbXB0eUNvbnRleHQoc2xhdGUpO1xyXG5cclxuICAgIGNvbnN0IGludHJvID0gc2xhdGUuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcIm5veC1lbXB0eS1pbnRyb1wiLFxyXG4gICAgfSk7XHJcbiAgICBpbnRyby5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwibm94LWVtcHR5LXRpdGxlXCIsXHJcbiAgICAgIHRleHQ6IFwiV2hhdCBkbyB5b3Ugd2FudCB0byB3b3JrIG9uP1wiLFxyXG4gICAgfSk7XHJcbiAgICBpbnRyby5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwibm94LWVtcHR5LWRlc2NyaXB0aW9uXCIsXHJcbiAgICAgIHRleHQ6XHJcbiAgICAgICAgXCJDaG9vc2UgYSBmb2N1c2VkIGFjdGlvbiBmb3IgdGhlIGN1cnJlbnQgbm90ZSwgb3IgYXNrIE5veCBkaXJlY3RseS5cIixcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHNlY3Rpb24gPSBzbGF0ZS5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwibm94LWNhcGFiaWxpdHktc2VjdGlvblwiLFxyXG4gICAgfSk7XHJcbiAgICBjb25zdCBzZWN0aW9uSGVhZCA9IHNlY3Rpb24uY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcIm5veC1jYXBhYmlsaXR5LWhlYWRlclwiLFxyXG4gICAgfSk7XHJcbiAgICBzZWN0aW9uSGVhZC5jcmVhdGVTcGFuKHtcclxuICAgICAgY2xzOiBcIm5veC1jYXBhYmlsaXR5LWxhYmVsXCIsXHJcbiAgICAgIHRleHQ6IFwiRm9jdXNlZCBhY3Rpb25zXCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBjb21tYW5kSGludCA9IHNlY3Rpb25IZWFkLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcclxuICAgICAgY2xzOiBcIm5veC1jYXBhYmlsaXR5LWNvbW1hbmQtaGludFwiLFxyXG4gICAgICB0ZXh0OiBcIlR5cGUgLyB0byBzZWUgYWxsIGFjdGlvbnNcIixcclxuICAgICAgYXR0cjoge1xyXG4gICAgICAgIHR5cGU6IFwiYnV0dG9uXCIsXHJcbiAgICAgICAgXCJhcmlhLWxhYmVsXCI6IFwiU2hvdyBhbGwgTm94IGFjdGlvbnNcIixcclxuICAgICAgfSxcclxuICAgIH0pO1xyXG4gICAgY29tbWFuZEhpbnQuYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgdGhpcy5wcm9tcHRNZW51ID0gXCJjb21tYW5kXCI7XHJcbiAgICAgIHRoaXMucHJvbXB0TWVudUFjdGl2ZSA9IDA7XHJcbiAgICAgIHZvaWQgdGhpcy5yZW5kZXJQcm9tcHRNZW51KCk7XHJcbiAgICAgIHRoaXMuZm9jdXNDb21wb3NlcigpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgZ3JpZCA9IHNlY3Rpb24uY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcIm5veC1jYXBhYmlsaXR5LWdyaWRcIixcclxuICAgIH0pO1xyXG5cclxuICAgIGZvciAoY29uc3QgY2FwYWJpbGl0eSBvZiBOT1hfQ0FQQUJJTElUSUVTKSB7XHJcbiAgICAgIGNvbnN0IGNhcmQgPSBncmlkLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcclxuICAgICAgICBjbHM6XHJcbiAgICAgICAgICBgbm94LWNhcGFiaWxpdHktY2FyZCBgICtcclxuICAgICAgICAgIGBub3gtY2FwYWJpbGl0eS1jYXJkLS0ke2NhcGFiaWxpdHkudG9uZX1gLFxyXG4gICAgICAgIGF0dHI6IHtcclxuICAgICAgICAgIHR5cGU6IFwiYnV0dG9uXCIsXHJcbiAgICAgICAgICBcImFyaWEtbGFiZWxcIjogY2FwYWJpbGl0eS50aXRsZSxcclxuICAgICAgICB9LFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IHRvcCA9IGNhcmQuY3JlYXRlRGl2KHtcclxuICAgICAgICBjbHM6IFwibm94LWNhcGFiaWxpdHktY2FyZC10b3BcIixcclxuICAgICAgfSk7XHJcbiAgICAgIGNvbnN0IG5hbWUgPSB0b3AuY3JlYXRlRGl2KHtcclxuICAgICAgICBjbHM6IFwibm94LWNhcGFiaWxpdHktbmFtZVwiLFxyXG4gICAgICB9KTtcclxuICAgICAgY29uc3QgaWNvbiA9IG5hbWUuY3JlYXRlU3Bhbih7XHJcbiAgICAgICAgY2xzOiBcIm5veC1jYXBhYmlsaXR5LWljb25cIixcclxuICAgICAgfSk7XHJcbiAgICAgIHNldE5veEljb24oaWNvbiwgY2FwYWJpbGl0eS5pY29uIGFzIEljb25OYW1lKTtcclxuICAgICAgbmFtZS5jcmVhdGVTcGFuKHtcclxuICAgICAgICBjbHM6IFwibm94LWNhcGFiaWxpdHktdGl0bGVcIixcclxuICAgICAgICB0ZXh0OiBjYXBhYmlsaXR5LnRpdGxlLFxyXG4gICAgICB9KTtcclxuICAgICAgdG9wLmNyZWF0ZVNwYW4oe1xyXG4gICAgICAgIGNsczogXCJub3gtY2FwYWJpbGl0eS1jb21tYW5kXCIsXHJcbiAgICAgICAgdGV4dDogY2FwYWJpbGl0eS5jb21tYW5kLFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNhcmQuY3JlYXRlRGl2KHtcclxuICAgICAgICBjbHM6IFwibm94LWNhcGFiaWxpdHktZGVzY3JpcHRpb25cIixcclxuICAgICAgICB0ZXh0OiBjYXBhYmlsaXR5LmRlc2NyaXB0aW9uLFxyXG4gICAgICB9KTtcclxuICAgICAgY2FyZC5jcmVhdGVTcGFuKHtcclxuICAgICAgICBjbHM6IFwibm94LWNhcGFiaWxpdHktbWV0YVwiLFxyXG4gICAgICAgIHRleHQ6IGNhcGFiaWxpdHkubWV0YSxcclxuICAgICAgfSk7XHJcblxyXG4gICAgICBjYXJkLmFkZEV2ZW50TGlzdGVuZXIoXCJjbGlja1wiLCAoKSA9PiB7XHJcbiAgICAgICAgdGhpcy5zZXRBY3Rpb24oY2FwYWJpbGl0eS5hY3Rpb24pO1xyXG4gICAgICAgIHRoaXMuZm9jdXNDb21wb3NlcigpO1xyXG4gICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLnNldFVJU3RhdGUoXCJFTVBUWVwiKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgcmVuZGVyRW1wdHlDb250ZXh0KHBhcmVudDogSFRNTEVsZW1lbnQpOiB2b2lkIHtcclxuICAgIGNvbnN0IGNvbnRleHQgPSB0aGlzLmN1cnJlbnRDb250ZXh0O1xyXG4gICAgaWYgKCFjb250ZXh0Py5zZWxlY3Rpb24gJiYgIWNvbnRleHQ/LmFjdGl2ZU5vdGUpIHJldHVybjtcclxuXHJcbiAgICBjb25zdCB3cmFwID0gcGFyZW50LmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJub3gtZW1wdHktY29udGV4dFwiLFxyXG4gICAgfSk7XHJcbiAgICBjb25zdCBsZWZ0ID0gd3JhcC5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwibm94LWVtcHR5LWNvbnRleHQtbWFpblwiLFxyXG4gICAgfSk7XHJcbiAgICBjb25zdCBpY29uID0gbGVmdC5jcmVhdGVTcGFuKHtcclxuICAgICAgY2xzOiBcIm5veC1lbXB0eS1jb250ZXh0LWljb25cIixcclxuICAgIH0pO1xyXG4gICAgc2V0Tm94SWNvbihpY29uLCBcImZpbGUtdGV4dFwiKTtcclxuXHJcbiAgICBjb25zdCBjb3B5ID0gbGVmdC5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwibm94LWVtcHR5LWNvbnRleHQtY29weVwiLFxyXG4gICAgfSk7XHJcbiAgICBjb3B5LmNyZWF0ZVNwYW4oe1xyXG4gICAgICBjbHM6IFwibm94LWVtcHR5LWNvbnRleHQtbGFiZWxcIixcclxuICAgICAgdGV4dDogXCJDdXJyZW50IGNvbnRleHRcIixcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGZpbGUgPVxyXG4gICAgICBjb250ZXh0LnNlbGVjdGlvbj8uZmlsZSA/P1xyXG4gICAgICBjb250ZXh0LmFjdGl2ZU5vdGU/LnBhdGggPz9cclxuICAgICAgXCJcIjtcclxuICAgIGNvcHkuY3JlYXRlU3Bhbih7XHJcbiAgICAgIGNsczogXCJub3gtZW1wdHktY29udGV4dC1maWxlXCIsXHJcbiAgICAgIHRleHQ6IGZpbGUuc3BsaXQoXCIvXCIpLnBvcCgpID8/IGZpbGUsXHJcbiAgICB9KTtcclxuXHJcbiAgICBpZiAoY29udGV4dC5zZWxlY3Rpb24pIHtcclxuICAgICAgd3JhcC5jcmVhdGVTcGFuKHtcclxuICAgICAgICBjbHM6IFwibm94LWVtcHR5LWNvbnRleHQtbWV0YVwiLFxyXG4gICAgICAgIHRleHQ6IFwiU2VsZWN0aW9uXCIsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyByZXN0b3JlU2Vzc2lvbigpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IG1lc3NhZ2VzID0gdGhpcy5sZWFybmluZy5nZXRTZXNzaW9uKCkubWVzc2FnZXM7XHJcbiAgICBpZiAobWVzc2FnZXMubGVuZ3RoID09PSAwKSB7XHJcbiAgICAgIHRoaXMuc2hvd0VtcHR5KCk7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLnRocmVhZC5lbXB0eSgpO1xyXG4gICAgZm9yIChjb25zdCBtZXNzYWdlIG9mIG1lc3NhZ2VzKSB7XHJcbiAgICAgIGlmIChtZXNzYWdlLnJvbGUgPT09IFwidXNlclwiKSB7XHJcbiAgICAgICAgdGhpcy5hcHBlbmRVc2VyQnViYmxlKG1lc3NhZ2UuY29udGVudCk7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKG1lc3NhZ2UuY29udGVudC50cmltKCkpIHtcclxuICAgICAgICBhd2FpdCB0aGlzLmFwcGVuZFJlc3RvcmVkQXNzaXN0YW50KG1lc3NhZ2UuY29udGVudCk7XHJcbiAgICAgIH1cclxuICAgICAgaWYgKG1lc3NhZ2UucHJvcG9zYWwpIHtcclxuICAgICAgICB0aGlzLmFwcGVuZFJlc3RvcmVkUHJvcG9zYWwobWVzc2FnZSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuICAgIHRoaXMuc2V0VUlTdGF0ZShcIkFOU1dFUlwiKTtcclxuICAgIHRoaXMuc2Nyb2xsVGhyZWFkKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFzeW5jIGFwcGVuZFJlc3RvcmVkQXNzaXN0YW50KG1hcmtkb3duOiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IGJ1YmJsZSA9IHRoaXMudGhyZWFkLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJub3gtYnViYmxlIG5veC1idWJibGUtLWFnZW50XCIsXHJcbiAgICB9KTtcclxuICAgIGNvbnN0IG1ldGEgPSBidWJibGUuY3JlYXRlRGl2KHsgY2xzOiBcIm5veC1yZXNwb25zZS1tZXRhXCIgfSk7XHJcbiAgICBtZXRhLmNyZWF0ZVNwYW4oeyBjbHM6IFwibm94LXJlc3BvbnNlLWxhYmVsXCIsIHRleHQ6IFwiTm94XCIgfSk7XHJcbiAgICBtZXRhLmNyZWF0ZVNwYW4oeyBjbHM6IFwibm94LXJlc3BvbnNlLXN1YlwiLCB0ZXh0OiBcIlJlc3RvcmVkXCIgfSk7XHJcbiAgICBjb25zdCBjb250ZW50ID0gYnViYmxlLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJub3gtYnViYmxlLWNvbnRlbnQgbm94LW1hcmtkb3duXCIsXHJcbiAgICB9KTtcclxuICAgIGNvbnN0IHNvdXJjZVBhdGggPVxyXG4gICAgICB0aGlzLmN1cnJlbnRDb250ZXh0Py5zZWxlY3Rpb24/LmZpbGUgPz9cclxuICAgICAgdGhpcy5jdXJyZW50Q29udGV4dD8uYWN0aXZlTm90ZT8ucGF0aCA/P1xyXG4gICAgICBcIk5veC5tZFwiO1xyXG4gICAgYXdhaXQgTWFya2Rvd25SZW5kZXJlci5yZW5kZXIoXHJcbiAgICAgIHRoaXMuYXBwLFxyXG4gICAgICBtYXJrZG93bixcclxuICAgICAgY29udGVudCxcclxuICAgICAgc291cmNlUGF0aCxcclxuICAgICAgdGhpcyxcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFwcGVuZFJlc3RvcmVkUHJvcG9zYWwobWVzc2FnZTogQ2hhdE1lc3NhZ2UpOiB2b2lkIHtcclxuICAgIGNvbnN0IHByb3Bvc2FsID0gbWVzc2FnZS5wcm9wb3NhbDtcclxuICAgIGlmICghcHJvcG9zYWwpIHJldHVybjtcclxuICAgIGNvbnN0IHdyYXAgPSB0aGlzLnJlbmRlclByb3Bvc2FsKHByb3Bvc2FsKTtcclxuICAgIGNvbnN0IHN0YXRlID0gbWVzc2FnZS5wcm9wb3NhbFN0YXRlID8/IFwic3RhbGVcIjtcclxuICAgIGNvbnN0IGxhYmVsczogUmVjb3JkPHN0cmluZywgc3RyaW5nPiA9IHtcclxuICAgICAgYXBwbGllZDogYFx1MjcxMyBBcHBsaWVkIHRvICR7cHJvcG9zYWwuZmlsZX1gLFxyXG4gICAgICByZWplY3RlZDogXCJcdTI3MTUgUmVqZWN0ZWRcIixcclxuICAgICAgc3RhbGU6IFwiXHUyNkEwIEV4cGlyZWQgYWZ0ZXIgcmVzdGFydFwiLFxyXG4gICAgICBwZW5kaW5nOiBcIlx1MjZBMCBFeHBpcmVkIGFmdGVyIHJlc3RhcnRcIixcclxuICAgIH07XHJcbiAgICB3cmFwLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogYG5veC1yZXN1bHQtYmFkZ2Ugbm94LWJhZGdlLS0ke3N0YXRlID09PSBcImFwcGxpZWRcIiA/IFwiYXBwbGllZFwiIDogc3RhdGUgPT09IFwicmVqZWN0ZWRcIiA/IFwicmVqZWN0ZWRcIiA6IFwic3RhbGVcIn1gLFxyXG4gICAgICB0ZXh0OiBsYWJlbHNbc3RhdGVdLFxyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIHNob3dFcnJvcihtZXNzYWdlOiBzdHJpbmcpOiB2b2lkIHtcclxuICAgIHRoaXMuc3RvcExvYWRpbmdUaW1lcigpO1xyXG4gICAgdGhpcy50aHJlYWQuZW1wdHkoKTtcclxuICAgIHRoaXMuYWdlbnRDdXJzb3JFbCA9IG51bGw7XHJcbiAgICB0aGlzLnN0YXR1c0VsID0gbnVsbDtcclxuXHJcbiAgICBjb25zdCBzbGF0ZSA9IHRoaXMudGhyZWFkLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJub3gtZXJyb3Itc2xhdGVcIixcclxuICAgIH0pO1xyXG4gICAgc2xhdGUuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcIm5veC1lcnJvci1pY29uXCIsXHJcbiAgICAgIHRleHQ6IFwiXHUyNkEwXCIsXHJcbiAgICB9KTtcclxuICAgIHNsYXRlLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJub3gtZXJyb3ItdGl0bGVcIixcclxuICAgICAgdGV4dDogXCJOb3ggdW5hdmFpbGFibGVcIixcclxuICAgIH0pO1xyXG4gICAgc2xhdGUuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcIm5veC1lcnJvci1ib2R5XCIsXHJcbiAgICAgIHRleHQ6IG1lc3NhZ2UsXHJcbiAgICB9KTtcclxuXHJcbiAgICBjb25zdCBidXR0b24gPSBzbGF0ZS5jcmVhdGVFbChcImJ1dHRvblwiLCB7XHJcbiAgICAgIGNsczogXCJub3gtY29uZmlndXJlLWJ0blwiLFxyXG4gICAgICB0ZXh0OiBcIkNvbmZpZ3VyZSBOb3ggXHUyMTkyXCIsXHJcbiAgICB9KTtcclxuICAgIGJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICB0aGlzLm9wZW5TZXR0aW5ncygpO1xyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5zZXRVSVN0YXRlKFwiRVJST1JcIik7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFwcGVuZFVzZXJCdWJibGUodGV4dDogc3RyaW5nKTogdm9pZCB7XHJcbiAgICB0aGlzLnRocmVhZC5xdWVyeVNlbGVjdG9yKFwiLm5veC1lbXB0eS1zbGF0ZVwiKT8ucmVtb3ZlKCk7XHJcbiAgICBjb25zdCBidWJibGUgPSB0aGlzLnRocmVhZC5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwibm94LWJ1YmJsZSBub3gtYnViYmxlLS11c2VyXCIsXHJcbiAgICB9KTtcclxuICAgIGJ1YmJsZS5zZXRUZXh0KHRleHQpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBlbnN1cmVBZ2VudEJ1YmJsZSgpOiB2b2lkIHtcclxuICAgIGlmICh0aGlzLmFnZW50Q3Vyc29yRWwpIHJldHVybjtcclxuXHJcbiAgICB0aGlzLnN0YXR1c0VsID0gdGhpcy5idWlsZFRoaW5raW5nVHJhY2UoKTtcclxuXHJcbiAgICB0aGlzLmFnZW50Q3Vyc29yRWwgPSB0aGlzLnRocmVhZC5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwibm94LWJ1YmJsZSBub3gtYnViYmxlLS1hZ2VudCBub3gtYnViYmxlLS1zdHJlYW1pbmdcIixcclxuICAgIH0pO1xyXG4gICAgY29uc3QgbWV0YSA9IHRoaXMuYWdlbnRDdXJzb3JFbC5jcmVhdGVEaXYoeyBjbHM6IFwibm94LXJlc3BvbnNlLW1ldGFcIiB9KTtcclxuICAgIG1ldGEuY3JlYXRlU3Bhbih7IGNsczogXCJub3gtcmVzcG9uc2UtbGFiZWxcIiwgdGV4dDogXCJOb3hcIiB9KTtcclxuICAgIG1ldGEuY3JlYXRlU3Bhbih7XHJcbiAgICAgIGNsczogXCJub3gtcmVzcG9uc2Utc3ViXCIsXHJcbiAgICAgIHRleHQ6IEFDVElPTlMuZmluZCgoYWN0aW9uKSA9PiBhY3Rpb24ua2luZCA9PT0gdGhpcy5zZWxlY3RlZEFjdGlvbik/LmxhYmVsID8/IFwiUmVzcG9uc2VcIixcclxuICAgIH0pO1xyXG4gICAgdGhpcy5yZXNwb25zZVRpbWVFbCA9IG1ldGEuY3JlYXRlU3Bhbih7IGNsczogXCJub3gtcmVzcG9uc2UtdGltZVwiLCB0ZXh0OiBcImZvciAwLjBzXCIgfSk7XHJcbiAgICB0aGlzLmFnZW50Q29udGVudEVsID0gdGhpcy5hZ2VudEN1cnNvckVsLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJub3gtYnViYmxlLWNvbnRlbnRcIixcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBidWlsZFRoaW5raW5nVHJhY2UoKTogSFRNTEVsZW1lbnQge1xyXG4gICAgY29uc3QgdHJhY2UgPSB0aGlzLnRocmVhZC5jcmVhdGVEaXYoeyBjbHM6IFwibm94LXRoaW5raW5nXCIgfSk7XHJcbiAgICB0cmFjZS5zZXRBdHRyaWJ1dGUoXCJyb2xlXCIsIFwic3RhdHVzXCIpO1xyXG4gICAgdHJhY2Uuc2V0QXR0cmlidXRlKFwiYXJpYS1saXZlXCIsIFwicG9saXRlXCIpO1xyXG5cclxuICAgIGNvbnN0IHRvZ2dsZSA9IHRyYWNlLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcclxuICAgICAgY2xzOiBcIm5veC10aGlua2luZy10b2dnbGVcIixcclxuICAgICAgYXR0cjogeyB0eXBlOiBcImJ1dHRvblwiLCBcImFyaWEtZXhwYW5kZWRcIjogXCJmYWxzZVwiIH0sXHJcbiAgICB9KTtcclxuICAgIHRoaXMudGhpbmtpbmdUb2dnbGVFbCA9IHRvZ2dsZTtcclxuXHJcbiAgICB0b2dnbGUuY3JlYXRlRWwoXCJpbWdcIiwge1xyXG4gICAgICBjbHM6IFwibm94LXRoaW5raW5nLWxvZ29cIixcclxuICAgICAgYXR0cjogeyBzcmM6IHRoaXMuZ2V0TG9nb1VybCgpLCBhbHQ6IFwiXCIgfSxcclxuICAgIH0pO1xyXG5cclxuICAgIHRoaXMudGhpbmtpbmdMYWJlbEVsID0gdG9nZ2xlLmNyZWF0ZVNwYW4oe1xyXG4gICAgICBjbHM6IFwibm94LXRoaW5raW5nLWxhYmVsIG5veC10aGlua2luZy1sYWJlbC0tYWN0aXZlXCIsXHJcbiAgICAgIHRleHQ6IFwiV29ya2luZ1wiLFxyXG4gICAgfSk7XHJcbiAgICB0aGlzLmxvYWRpbmdFbGFwc2VkRWwgPSB0b2dnbGUuY3JlYXRlU3Bhbih7IGNsczogXCJub3gtdGhpbmtpbmctZWxhcHNlZFwiIH0pO1xyXG4gICAgdGhpcy5sb2FkaW5nRWxhcHNlZEVsLnNldEF0dHJpYnV0ZShcImFyaWEtaGlkZGVuXCIsIFwidHJ1ZVwiKTtcclxuXHJcbiAgICBjb25zdCBjaGV2cm9uID0gdG9nZ2xlLmNyZWF0ZVNwYW4oeyBjbHM6IFwibm94LXRoaW5raW5nLWNoZXZyb25cIiwgdGV4dDogXCJcdTIzMDRcIiB9KTtcclxuICAgIHRoaXMudGhpbmtpbmdDaGV2cm9uRWwgPSBjaGV2cm9uO1xyXG5cclxuICAgIGNvbnN0IHBhbmVsID0gdHJhY2UuY3JlYXRlRGl2KHsgY2xzOiBcIm5veC10aGlua2luZy1wYW5lbFwiIH0pO1xyXG4gICAgdGhpcy50aGlua2luZ1BhbmVsRWwgPSBwYW5lbDtcclxuICAgIGNvbnN0IGxpc3QgPSBwYW5lbC5jcmVhdGVEaXYoeyBjbHM6IFwibm94LXRoaW5raW5nLXRyYWNlIG5veC10aGlua2luZy10cmFjZS0tZmFjdHNcIiB9KTtcclxuXHJcbiAgICBjb25zdCBzb3VyY2UgPSB0aGlzLmN1cnJlbnRDb250ZXh0Py5zZWxlY3Rpb24/LmZpbGUgPz8gdGhpcy5jdXJyZW50Q29udGV4dD8uYWN0aXZlTm90ZT8ucGF0aDtcclxuICAgIGNvbnN0IGZhY3RzOiBBcnJheTx7IHByaW1hcnk6IHN0cmluZzsgc2Vjb25kYXJ5Pzogc3RyaW5nIH0+ID0gW1xyXG4gICAgICB7XHJcbiAgICAgICAgcHJpbWFyeTogdGhpcy5jdXJyZW50Q29udGV4dD8uc2VsZWN0aW9uXHJcbiAgICAgICAgICA/IFwiQ3VycmVudCBzZWxlY3Rpb25cIlxyXG4gICAgICAgICAgOiB0aGlzLmN1cnJlbnRDb250ZXh0Py5hY3RpdmVOb3RlID8gXCJDdXJyZW50IG5vdGVcIiA6IFwiTm8gYXV0b21hdGljIG5vdGUgY29udGV4dFwiLFxyXG4gICAgICAgIHNlY29uZGFyeTogc291cmNlPy5zcGxpdChcIi9cIikucG9wKCksXHJcbiAgICAgIH0sXHJcbiAgICAgIHtcclxuICAgICAgICBwcmltYXJ5OiBcIkxlYXJuaW5nIGludGVudFwiLFxyXG4gICAgICAgIHNlY29uZGFyeTogQUNUSU9OUy5maW5kKChhY3Rpb24pID0+IGFjdGlvbi5raW5kID09PSB0aGlzLnJ1bm5pbmdBY3Rpb24pPy5sYWJlbCA/PyBcIkFza1wiLFxyXG4gICAgICB9LFxyXG4gICAgXTtcclxuXHJcbiAgICB0aGlzLnRoaW5raW5nUm93cyA9IGZhY3RzLm1hcCgoZmFjdCkgPT4ge1xyXG4gICAgICBjb25zdCByb3cgPSBsaXN0LmNyZWF0ZURpdih7IGNsczogXCJub3gtdGhpbmtpbmctcm93IGlzLWRvbmVcIiB9KTtcclxuICAgICAgcm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwibm94LXRoaW5raW5nLW1hcmtlclwiLCB0ZXh0OiBcIlx1MDBCN1wiIH0pO1xyXG4gICAgICByb3cuY3JlYXRlU3Bhbih7IGNsczogXCJub3gtdGhpbmtpbmctcHJpbWFyeVwiLCB0ZXh0OiBmYWN0LnByaW1hcnkgfSk7XHJcbiAgICAgIGlmIChmYWN0LnNlY29uZGFyeSkgcm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwibm94LXRoaW5raW5nLXNlY29uZGFyeVwiLCB0ZXh0OiBmYWN0LnNlY29uZGFyeSB9KTtcclxuICAgICAgcmV0dXJuIHJvdztcclxuICAgIH0pO1xyXG5cclxuICAgIHRvZ2dsZS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICBjb25zdCBleHBhbmRlZCA9ICFwYW5lbC5oYXNDbGFzcyhcImlzLWV4cGFuZGVkXCIpO1xyXG4gICAgICBwYW5lbC50b2dnbGVDbGFzcyhcImlzLWV4cGFuZGVkXCIsIGV4cGFuZGVkKTtcclxuICAgICAgdG9nZ2xlLnNldEF0dHJpYnV0ZShcImFyaWEtZXhwYW5kZWRcIiwgU3RyaW5nKGV4cGFuZGVkKSk7XHJcbiAgICAgIGNoZXZyb24udG9nZ2xlQ2xhc3MoXCJpcy1leHBhbmRlZFwiLCBleHBhbmRlZCk7XHJcbiAgICAgIHRoaXMudGhpbmtpbmdNYW51YWxFeHBhbmRlZCA9IGV4cGFuZGVkO1xyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5zdGFydExvYWRpbmdUaW1lcigpO1xyXG4gICAgcmV0dXJuIHRyYWNlO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhcHBlbmRUb0FnZW50QnViYmxlKHRleHQ6IHN0cmluZyk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLmFnZW50Q29udGVudEVsKSByZXR1cm47XHJcblxyXG4gICAgdGhpcy5zdHJlYW1lZFJlc3BvbnNlVGV4dCArPSB0ZXh0O1xyXG4gICAgdGhpcy5zdHJlYW1pbmdQZW5kaW5nVGV4dCArPSB0ZXh0O1xyXG5cclxuICAgIGNvbnN0IHBhcnRzID0gdGhpcy5zdHJlYW1pbmdQZW5kaW5nVGV4dC5zcGxpdCgvKFxccyspLyk7XHJcbiAgICBjb25zdCBsYXN0UGFydCA9IHBhcnRzW3BhcnRzLmxlbmd0aCAtIDFdID8/IFwiXCI7XHJcbiAgICBjb25zdCBoYXNUcmFpbGluZ1doaXRlc3BhY2UgPSAvXFxzJC8udGVzdCh0aGlzLnN0cmVhbWluZ1BlbmRpbmdUZXh0KTtcclxuXHJcbiAgICBpZiAoIWhhc1RyYWlsaW5nV2hpdGVzcGFjZSkge1xyXG4gICAgICB0aGlzLnN0cmVhbWluZ1BlbmRpbmdUZXh0ID0gcGFydHMucG9wKCkgPz8gbGFzdFBhcnQ7XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICB0aGlzLnN0cmVhbWluZ1BlbmRpbmdUZXh0ID0gXCJcIjtcclxuICAgIH1cclxuXHJcbiAgICBmb3IgKGNvbnN0IHBhcnQgb2YgcGFydHMpIHtcclxuICAgICAgaWYgKCFwYXJ0KSBjb250aW51ZTtcclxuXHJcbiAgICAgIGlmICgvXFxzKy8udGVzdChwYXJ0KSkge1xyXG4gICAgICAgIHRoaXMuYWdlbnRDb250ZW50RWwuYXBwZW5kVGV4dChwYXJ0KTtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgdGhpcy5hZ2VudENvbnRlbnRFbC5jcmVhdGVTcGFuKHtcclxuICAgICAgICBjbHM6IFwibm94LXN0cmVhbS13b3JkXCIsXHJcbiAgICAgICAgdGV4dDogcGFydCxcclxuICAgICAgfSk7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5zY3JvbGxUaHJlYWQoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgZmx1c2hTdHJlYW1pbmdUZXh0KCk6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLmFnZW50Q29udGVudEVsIHx8ICF0aGlzLnN0cmVhbWluZ1BlbmRpbmdUZXh0KSByZXR1cm47XHJcblxyXG4gICAgdGhpcy5hZ2VudENvbnRlbnRFbC5jcmVhdGVTcGFuKHtcclxuICAgICAgY2xzOiBcIm5veC1zdHJlYW0td29yZFwiLFxyXG4gICAgICB0ZXh0OiB0aGlzLnN0cmVhbWluZ1BlbmRpbmdUZXh0LFxyXG4gICAgfSk7XHJcbiAgICB0aGlzLnN0cmVhbWluZ1BlbmRpbmdUZXh0ID0gXCJcIjtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgcmVuZGVyTWFya2Rvd25SZXNwb25zZSgpOiB2b2lkIHtcclxuICAgIGlmICghdGhpcy5hZ2VudENvbnRlbnRFbCB8fCAhdGhpcy5zdHJlYW1lZFJlc3BvbnNlVGV4dC50cmltKCkpIHJldHVybjtcclxuXHJcbiAgICBjb25zdCBjb250ZW50ID0gdGhpcy5hZ2VudENvbnRlbnRFbDtcclxuICAgIGNvbnN0IG1hcmtkb3duID0gdGhpcy5zdHJlYW1lZFJlc3BvbnNlVGV4dDtcclxuICAgIGNvbnN0IHNvdXJjZVBhdGggPVxyXG4gICAgICB0aGlzLmN1cnJlbnRDb250ZXh0Py5zZWxlY3Rpb24/LmZpbGUgPz9cclxuICAgICAgdGhpcy5jdXJyZW50Q29udGV4dD8uYWN0aXZlTm90ZT8ucGF0aCA/P1xyXG4gICAgICBcIk5veC5tZFwiO1xyXG5cclxuICAgIGNvbnRlbnQuZW1wdHkoKTtcclxuICAgIGNvbnRlbnQuYWRkQ2xhc3MoXCJub3gtbWFya2Rvd25cIik7XHJcblxyXG4gICAgdm9pZCBNYXJrZG93blJlbmRlcmVyLnJlbmRlcih0aGlzLmFwcCwgbWFya2Rvd24sIGNvbnRlbnQsIHNvdXJjZVBhdGgsIHRoaXMpLmNhdGNoKCgpID0+IHtcclxuICAgICAgY29udGVudC5lbXB0eSgpO1xyXG4gICAgICBjb250ZW50LnJlbW92ZUNsYXNzKFwibm94LW1hcmtkb3duXCIpO1xyXG4gICAgICBjb250ZW50LmFkZENsYXNzKFwibm94LW1hcmtkb3duLWVycm9yXCIpO1xyXG4gICAgICBjb250ZW50LnNldFRleHQoXCJNYXJrZG93biByZXNwb25zZSBjb3VsZCBub3QgYmUgcmVuZGVyZWQuXCIpO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFwcGVuZFN0cmVhbUFjdGlvbnMoKTogdm9pZCB7XHJcbiAgICBpZiAoIXRoaXMuYWdlbnRDdXJzb3JFbCB8fCAhdGhpcy5zdHJlYW1lZFJlc3BvbnNlVGV4dC50cmltKCkpIHJldHVybjtcclxuXHJcbiAgICBjb25zdCByZXNwb25zZVRleHQgPSB0aGlzLnN0cmVhbWVkUmVzcG9uc2VUZXh0LnRyaW0oKTtcclxuICAgIGNvbnN0IGFjdGlvbnMgPSB0aGlzLmFnZW50Q3Vyc29yRWwuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcIm5veC1zdHJlYW0tYWN0aW9uc1wiLFxyXG4gICAgfSk7XHJcbiAgICBjb25zdCBjb3B5QnV0dG9uID0gYWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7XHJcbiAgICAgIGNsczogXCJub3gtc3RyZWFtLWFjdGlvblwiLFxyXG4gICAgICB0ZXh0OiBcIkNvcHlcIixcclxuICAgICAgYXR0cjoge1xyXG4gICAgICAgIHR5cGU6IFwiYnV0dG9uXCIsXHJcbiAgICAgICAgXCJhcmlhLWxhYmVsXCI6IFwiQ29weSByZXNwb25zZVwiLFxyXG4gICAgICB9LFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29weUJ1dHRvbi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIGF3YWl0IG5hdmlnYXRvci5jbGlwYm9hcmQud3JpdGVUZXh0KHJlc3BvbnNlVGV4dCk7XHJcbiAgICAgICAgY29weUJ1dHRvbi50ZXh0Q29udGVudCA9IFwiQ29waWVkXCI7XHJcbiAgICAgIH0gY2F0Y2gge1xyXG4gICAgICAgIGNvcHlCdXR0b24udGV4dENvbnRlbnQgPSBcIkNvcHkgZmFpbGVkXCI7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIHdpbmRvdy5zZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgICBjb3B5QnV0dG9uLnRleHRDb250ZW50ID0gXCJDb3B5XCI7XHJcbiAgICAgIH0sIDE0MDApO1xyXG4gICAgfSk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFwcGVuZFByYWN0aWNlUXVlc3Rpb24oXHJcbiAgICBxdWVzdGlvbjogUHJhY3RpY2VRdWVzdGlvbixcclxuICApOiB2b2lkIHtcclxuICAgIGlmICghdGhpcy5hZ2VudEN1cnNvckVsKSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgY2FyZCA9IHRoaXMuYWdlbnRDdXJzb3JFbC5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwibm94LXByYWN0aWNlLWNhcmRcIixcclxuICAgIH0pO1xyXG4gICAgY2FyZC5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwibm94LXByYWN0aWNlLWxhYmVsXCIsXHJcbiAgICAgIHRleHQ6IGBQcmFjdGljZSBcdTAwQjcgJHtxdWVzdGlvbi5jb25jZXB0fWAsXHJcbiAgICB9KTtcclxuICAgIGNhcmQuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcIm5veC1wcmFjdGljZS1xdWVzdGlvblwiLFxyXG4gICAgICB0ZXh0OiBxdWVzdGlvbi5xdWVzdGlvbixcclxuICAgIH0pO1xyXG5cclxuICAgIGlmIChxdWVzdGlvbi5oaW50KSB7XHJcbiAgICAgIGNhcmQuY3JlYXRlRGl2KHtcclxuICAgICAgICBjbHM6IFwibm94LXByYWN0aWNlLWhpbnRcIixcclxuICAgICAgICB0ZXh0OiBgSGludDogJHtxdWVzdGlvbi5oaW50fWAsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuc2Nyb2xsVGhyZWFkKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFwcGVuZFByYWN0aWNlRXZhbHVhdGlvbihcclxuICAgIGV2YWx1YXRpb246IFByYWN0aWNlRXZhbHVhdGlvbixcclxuICApOiB2b2lkIHtcclxuICAgIGlmICghdGhpcy5hZ2VudEN1cnNvckVsKSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgY2FyZCA9IHRoaXMuYWdlbnRDdXJzb3JFbC5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IGBub3gtcHJhY3RpY2UtZXZhbHVhdGlvbiBub3gtb3V0Y29tZS0tJHtldmFsdWF0aW9uLm91dGNvbWV9YCxcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IG91dGNvbWVMYWJlbCA9XHJcbiAgICAgIGV2YWx1YXRpb24ub3V0Y29tZSA9PT0gXCJjb3JyZWN0XCJcclxuICAgICAgICA/IFwiQ29ycmVjdFwiXHJcbiAgICAgICAgOiBldmFsdWF0aW9uLm91dGNvbWUgPT09IFwicGFydGlhbFwiXHJcbiAgICAgICAgICA/IFwiUGFydGlhbFwiXHJcbiAgICAgICAgICA6IFwiTmVlZHMgd29ya1wiO1xyXG5cclxuICAgIGNhcmQuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcIm5veC1wcmFjdGljZS1sYWJlbFwiLFxyXG4gICAgICB0ZXh0OiBgJHtvdXRjb21lTGFiZWx9IFx1MDBCNyAke2V2YWx1YXRpb24uY29uY2VwdH1gLFxyXG4gICAgfSk7XHJcbiAgICBjYXJkLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJub3gtcHJhY3RpY2UtZmVlZGJhY2tcIixcclxuICAgICAgdGV4dDogZXZhbHVhdGlvbi5mZWVkYmFjayxcclxuICAgIH0pO1xyXG5cclxuICAgIGlmIChldmFsdWF0aW9uLm1pc2NvbmNlcHRpb25zLmxlbmd0aCA+IDApIHtcclxuICAgICAgY29uc3QgZ2FwcyA9IGNhcmQuY3JlYXRlRGl2KHtcclxuICAgICAgICBjbHM6IFwibm94LXByYWN0aWNlLWdhcHNcIixcclxuICAgICAgfSk7XHJcbiAgICAgIGdhcHMuY3JlYXRlRGl2KHtcclxuICAgICAgICBjbHM6IFwibm94LXByYWN0aWNlLWdhcHMtbGFiZWxcIixcclxuICAgICAgICB0ZXh0OiBcIkdhcFwiLFxyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGZvciAoY29uc3QgbWlzY29uY2VwdGlvbiBvZiBldmFsdWF0aW9uLm1pc2NvbmNlcHRpb25zKSB7XHJcbiAgICAgICAgZ2Fwcy5jcmVhdGVEaXYoe1xyXG4gICAgICAgICAgY2xzOiBcIm5veC1wcmFjdGljZS1nYXBcIixcclxuICAgICAgICAgIHRleHQ6IG1pc2NvbmNlcHRpb24sXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICB0aGlzLnNjcm9sbFRocmVhZCgpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhcHBlbmRSZXZpZXdGaW5kaW5ncyhmaW5kaW5nczogUmV2aWV3RmluZGluZ1tdKTogdm9pZCB7XHJcbiAgICBpZiAoIXRoaXMuYWdlbnRDdXJzb3JFbCkgcmV0dXJuO1xyXG5cclxuICAgIGNvbnN0IHdyYXAgPSB0aGlzLmFnZW50Q3Vyc29yRWwuY3JlYXRlRGl2KHsgY2xzOiBcIm5veC1yZXZpZXdcIiB9KTtcclxuICAgIHdyYXAuY3JlYXRlRGl2KHtcclxuICAgICAgY2xzOiBcIm5veC1yZXZpZXctc3VtbWFyeVwiLFxyXG4gICAgICB0ZXh0OiBmaW5kaW5ncy5sZW5ndGggPT09IDBcclxuICAgICAgICA/IFwiTm8gbWF0ZXJpYWwgbGVhcm5pbmcgZ2FwcyBmb3VuZC5cIlxyXG4gICAgICAgIDogYCR7ZmluZGluZ3MubGVuZ3RofSBpbXBvcnRhbnQgJHtmaW5kaW5ncy5sZW5ndGggPT09IDEgPyBcImdhcFwiIDogXCJnYXBzXCJ9YCxcclxuICAgIH0pO1xyXG5cclxuICAgIGZvciAoY29uc3QgZmluZGluZyBvZiBmaW5kaW5ncykge1xyXG4gICAgICBjb25zdCBjYXJkID0gd3JhcC5jcmVhdGVEaXYoe1xyXG4gICAgICAgIGNsczogYG5veC1yZXZpZXctY2FyZCBub3gtcmV2aWV3LWNhcmQtLSR7ZmluZGluZy5raW5kfWAsXHJcbiAgICAgIH0pO1xyXG4gICAgICBjYXJkLmNyZWF0ZURpdih7IGNsczogXCJub3gtcmV2aWV3LWtpbmRcIiwgdGV4dDogZmluZGluZy5raW5kLnJlcGxhY2UoXCItXCIsIFwiIFwiKSB9KTtcclxuICAgICAgY2FyZC5jcmVhdGVEaXYoeyBjbHM6IFwibm94LXJldmlldy10aXRsZVwiLCB0ZXh0OiBmaW5kaW5nLnRpdGxlIH0pO1xyXG4gICAgICBjYXJkLmNyZWF0ZURpdih7IGNsczogXCJub3gtcmV2aWV3LWRldGFpbFwiLCB0ZXh0OiBmaW5kaW5nLmRldGFpbCB9KTtcclxuXHJcbiAgICAgIGNvbnN0IGFjdGlvbnMgPSBjYXJkLmNyZWF0ZURpdih7IGNsczogXCJub3gtcmV2aWV3LWFjdGlvbnNcIiB9KTtcclxuICAgICAgY29uc3QgcHJhY3RpY2UgPSBhY3Rpb25zLmNyZWF0ZUVsKFwiYnV0dG9uXCIsIHtcclxuICAgICAgICBjbHM6IFwibm94LXJldmlldy1hY3Rpb25cIixcclxuICAgICAgICB0ZXh0OiBcIlByYWN0aWNlXCIsXHJcbiAgICAgICAgYXR0cjogeyB0eXBlOiBcImJ1dHRvblwiIH0sXHJcbiAgICAgIH0pO1xyXG4gICAgICBwcmFjdGljZS5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgKCkgPT4ge1xyXG4gICAgICAgIHRoaXMuc2V0QWN0aW9uKFwicHJhY3RpY2VcIik7XHJcbiAgICAgICAgdGhpcy5pbnB1dC52YWx1ZSA9IGBQcmFjdGljZSB0aGlzIGdhcDogJHtmaW5kaW5nLmNvbmNlcHR9IFx1MjAxNCAke2ZpbmRpbmcuZGV0YWlsfWA7XHJcbiAgICAgICAgdGhpcy5vbklucHV0KCk7XHJcbiAgICAgICAgdGhpcy5pbnB1dC5mb2N1cygpO1xyXG4gICAgICB9KTtcclxuXHJcbiAgICAgIGNvbnN0IGZpeCA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwge1xyXG4gICAgICAgIGNsczogXCJub3gtcmV2aWV3LWFjdGlvblwiLFxyXG4gICAgICAgIHRleHQ6IFwiRml4XCIsXHJcbiAgICAgICAgYXR0cjogeyB0eXBlOiBcImJ1dHRvblwiIH0sXHJcbiAgICAgIH0pO1xyXG4gICAgICBmaXguYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgICB0aGlzLnNldEFjdGlvbihcImVkaXRcIik7XHJcbiAgICAgICAgdGhpcy5pbnB1dC52YWx1ZSA9IGBGaXggdGhpcyBsZWFybmluZyBnYXA6ICR7ZmluZGluZy5kZXRhaWx9YDtcclxuICAgICAgICB0aGlzLm9uSW5wdXQoKTtcclxuICAgICAgICB0aGlzLmlucHV0LmZvY3VzKCk7XHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuc2Nyb2xsVGhyZWFkKCk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGFwcGVuZFByb2dyZXNzVXBkYXRlKFxyXG4gICAgdG9waWM6IHN0cmluZyB8IHVuZGVmaW5lZCxcclxuICAgIGdhcHM6IEFycmF5PHsgc3RhdHVzOiBzdHJpbmcgfT4sXHJcbiAgKTogdm9pZCB7XHJcbiAgICBpZiAoIXRvcGljKSByZXR1cm47XHJcbiAgICBjb25zdCBvcGVuID0gZ2Fwcy5maWx0ZXIoKGdhcCkgPT4gZ2FwLnN0YXR1cyA9PT0gXCJvcGVuXCIpLmxlbmd0aDtcclxuICAgIGNvbnN0IHJvdyA9IHRoaXMudGhyZWFkLmNyZWF0ZURpdih7IGNsczogXCJub3gtcHJvZ3Jlc3Mtcm93XCIgfSk7XHJcbiAgICBjb25zdCBtYXJrID0gcm93LmNyZWF0ZVNwYW4oeyBjbHM6IFwibm94LXByb2dyZXNzLW1hcmtcIiB9KTtcclxuICAgIHNldE5veEljb24obWFyaywgXCJjaGVja1wiKTtcclxuICAgIHJvdy5jcmVhdGVTcGFuKHtcclxuICAgICAgY2xzOiBcIm5veC1wcm9ncmVzcy10ZXh0XCIsXHJcbiAgICAgIHRleHQ6IG9wZW4gPiAwXHJcbiAgICAgICAgPyBgTGVhcm5pbmcgc3RhdGUgdXBkYXRlZCBcdTAwQjcgJHtvcGVufSBvcGVuICR7b3BlbiA9PT0gMSA/IFwiZ2FwXCIgOiBcImdhcHNcIn1gXHJcbiAgICAgICAgOiBcIkxlYXJuaW5nIHN0YXRlIHVwZGF0ZWRcIixcclxuICAgIH0pO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhcHBlbmRQcm9wb3NhbEJ1YmJsZShlZGl0OiBQcm9wb3NlZEVkaXQpOiB2b2lkIHtcclxuICAgIGNvbnN0IHByb3Bvc2FsID0gZWRpdC5wcm9wb3NhbDtcclxuICAgIGNvbnN0IHdyYXAgPSB0aGlzLnJlbmRlclByb3Bvc2FsKHByb3Bvc2FsKTtcclxuXHJcbiAgICBjb25zdCBhY3Rpb25zID0gd3JhcC5jcmVhdGVEaXYoe1xyXG4gICAgICBjbHM6IFwibm94LXByb3Bvc2FsLWFjdGlvbnNcIixcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IHJlamVjdEJ0biA9IGFjdGlvbnMuY3JlYXRlRWwoXCJidXR0b25cIiwge1xyXG4gICAgICBjbHM6IFwibm94LWJ0bi1yZWplY3RcIixcclxuICAgICAgdGV4dDogXCJSZWplY3RcIixcclxuICAgIH0pO1xyXG5cclxuICAgIGNvbnN0IGFwcGx5QnRuID0gYWN0aW9ucy5jcmVhdGVFbChcImJ1dHRvblwiLCB7XHJcbiAgICAgIGNsczogXCJub3gtYnRuLWFwcGx5XCIsXHJcbiAgICAgIHRleHQ6IFwiQXBwbHkgXHUyNzEzXCIsXHJcbiAgICB9KTtcclxuXHJcbiAgICByZWplY3RCdG4uYWRkRXZlbnRMaXN0ZW5lcihcImNsaWNrXCIsICgpID0+IHtcclxuICAgICAgdm9pZCB0aGlzLmxlYXJuaW5nLnJlamVjdFByb3Bvc2FsKGVkaXQuaWQpO1xyXG4gICAgICBhY3Rpb25zLnJlbW92ZSgpO1xyXG4gICAgICB3cmFwLmNyZWF0ZURpdih7XHJcbiAgICAgICAgY2xzOiBcIm5veC1yZXN1bHQtYmFkZ2Ugbm94LWJhZGdlLS1yZWplY3RlZFwiLFxyXG4gICAgICAgIHRleHQ6IFwiXHUyNzE1IFJlamVjdGVkXCIsXHJcbiAgICAgIH0pO1xyXG4gICAgICB0aGlzLnNldFVJU3RhdGUoXCJBTlNXRVJcIik7XHJcbiAgICB9KTtcclxuXHJcbiAgICBhcHBseUJ0bi5hZGRFdmVudExpc3RlbmVyKFwiY2xpY2tcIiwgYXN5bmMgKCkgPT4ge1xyXG4gICAgICBhcHBseUJ0bi5kaXNhYmxlZCA9IHRydWU7XHJcbiAgICAgIGFwcGx5QnRuLnRleHRDb250ZW50ID0gXCJBcHBseWluZ1x1MjAyNlwiO1xyXG5cclxuICAgICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5sZWFybmluZy5hcHBseVByb3Bvc2FsKGVkaXQuaWQpO1xyXG4gICAgICBhY3Rpb25zLnJlbW92ZSgpO1xyXG5cclxuICAgICAgaWYgKHJlc3VsdC5vaykge1xyXG4gICAgICAgIHdyYXAuY3JlYXRlRGl2KHtcclxuICAgICAgICAgIGNsczogXCJub3gtcmVzdWx0LWJhZGdlIG5veC1iYWRnZS0tYXBwbGllZFwiLFxyXG4gICAgICAgICAgdGV4dDogXCJcdTI3MTMgQXBwbGllZCB0byBcIiArIHByb3Bvc2FsLmZpbGUsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgdGhpcy5zZXRVSVN0YXRlKFwiQVBQTElFRFwiKTtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICB3cmFwLmNyZWF0ZURpdih7XHJcbiAgICAgICAgICBjbHM6IFwibm94LXJlc3VsdC1iYWRnZSBub3gtYmFkZ2UtLXN0YWxlXCIsXHJcbiAgICAgICAgICB0ZXh0OiBcIlx1MjZBMCBcIiArIHJlc3VsdC5tZXNzYWdlLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIHRoaXMuc2V0VUlTdGF0ZShcIkFOU1dFUlwiKTtcclxuICAgICAgfVxyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5zY3JvbGxUaHJlYWQoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgcmVuZGVyUHJvcG9zYWwocHJvcG9zYWw6IEVkaXRQcm9wb3NhbCk6IEhUTUxFbGVtZW50IHtcclxuICAgIGNvbnN0IHdyYXAgPSB0aGlzLnRocmVhZC5jcmVhdGVEaXYoeyBjbHM6IFwibm94LXByb3Bvc2FsXCIgfSk7XHJcbiAgICB3cmFwLmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJub3gtcHJvcG9zYWwtYmFkZ2VcIixcclxuICAgICAgdGV4dDogXCJcdUQ4M0RcdURDQzQgXCIgKyBwcm9wb3NhbC5maWxlLFxyXG4gICAgfSk7XHJcbiAgICBpZiAocHJvcG9zYWwucmVhc29uKSB7XHJcbiAgICAgIHdyYXAuY3JlYXRlRGl2KHsgY2xzOiBcIm5veC1wcm9wb3NhbC1yZWFzb25cIiwgdGV4dDogcHJvcG9zYWwucmVhc29uIH0pO1xyXG4gICAgfVxyXG4gICAgY29uc3QgZGlmZiA9IHdyYXAuY3JlYXRlRGl2KHsgY2xzOiBcIm5veC1wcm9wb3NhbC1kaWZmXCIgfSk7XHJcbiAgICBwcm9wb3NhbC5vcmlnaW5hbC5zcGxpdChcIlxcblwiKS5mb3JFYWNoKChsaW5lKSA9PiB7XHJcbiAgICAgIGRpZmYuY3JlYXRlRGl2KHsgY2xzOiBcIm5veC1kaWZmLXJlbW92ZWRcIiwgdGV4dDogXCItIFwiICsgbGluZSB9KTtcclxuICAgIH0pO1xyXG4gICAgcHJvcG9zYWwucmVwbGFjZW1lbnQuc3BsaXQoXCJcXG5cIikuZm9yRWFjaCgobGluZSkgPT4ge1xyXG4gICAgICBkaWZmLmNyZWF0ZURpdih7IGNsczogXCJub3gtZGlmZi1hZGRlZFwiLCB0ZXh0OiBcIisgXCIgKyBsaW5lIH0pO1xyXG4gICAgfSk7XHJcbiAgICByZXR1cm4gd3JhcDtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXBwZW5kSW5saW5lRXJyb3IoXHJcbiAgICBwYXJlbnQ6IEhUTUxFbGVtZW50LFxyXG4gICAgbWVzc2FnZTogc3RyaW5nLFxyXG4gICk6IHZvaWQge1xyXG4gICAgcGFyZW50LmNyZWF0ZURpdih7XHJcbiAgICAgIGNsczogXCJub3gtaW5saW5lLWVycm9yXCIsXHJcbiAgICAgIHRleHQ6IFwiXHUyNkEwIFwiICsgbWVzc2FnZSxcclxuICAgIH0pO1xyXG4gICAgdGhpcy5zY3JvbGxUaHJlYWQoKTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgc2Nyb2xsVGhyZWFkKCk6IHZvaWQge1xyXG4gICAgdGhpcy50aHJlYWQuc2Nyb2xsVG8oe1xyXG4gICAgICB0b3A6IHRoaXMudGhyZWFkLnNjcm9sbEhlaWdodCxcclxuICAgICAgYmVoYXZpb3I6IFwic21vb3RoXCIsXHJcbiAgICB9KTtcclxuICB9XHJcbn1cclxuIiwgImV4cG9ydCB0eXBlIFByb21wdE1lbnVLaW5kID0gXCJzb3VyY2VcIiB8IFwiY29tbWFuZFwiO1xyXG5cclxuZXhwb3J0IGludGVyZmFjZSBQcm9tcHRUb2tlbiB7XHJcbiAga2luZDogUHJvbXB0TWVudUtpbmQ7XHJcbiAgcXVlcnk6IHN0cmluZztcclxuICBzdGFydDogbnVtYmVyO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcGFyc2VQcm9tcHRUb2tlbihcclxuICB2YWx1ZTogc3RyaW5nLFxyXG4pOiBQcm9tcHRUb2tlbiB8IG51bGwge1xyXG4gIGNvbnN0IG1hdGNoID0gLyhefFxccykoW0AvXSkoW1xcdy1dKikkLy5leGVjKHZhbHVlKTtcclxuICBpZiAoIW1hdGNoKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgcmV0dXJuIHtcclxuICAgIGtpbmQ6IG1hdGNoWzJdID09PSBcIkBcIiA/IFwic291cmNlXCIgOiBcImNvbW1hbmRcIixcclxuICAgIHF1ZXJ5OiBtYXRjaFszXS50b0xvd2VyQ2FzZSgpLFxyXG4gICAgc3RhcnQ6IG1hdGNoLmluZGV4ICsgbWF0Y2hbMV0ubGVuZ3RoLFxyXG4gIH07XHJcbn1cclxuIiwgImltcG9ydCB0eXBlIHsgTGVhcm5pbmdBY3Rpb25LaW5kIH0gZnJvbSBcIi4uL2xlYXJuaW5nL2xlYXJuaW5nLXR5cGVzXCI7XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIE5veENhcGFiaWxpdHkge1xyXG4gIGFjdGlvbjogRXhjbHVkZTxMZWFybmluZ0FjdGlvbktpbmQsIFwiYXNrXCI+O1xyXG4gIHRpdGxlOiBzdHJpbmc7XHJcbiAgY29tbWFuZDogc3RyaW5nO1xyXG4gIGRlc2NyaXB0aW9uOiBzdHJpbmc7XHJcbiAgbWV0YTogc3RyaW5nO1xyXG4gIGljb246IHN0cmluZztcclxuICB0b25lOiBcInB1cnBsZVwiIHwgXCJibHVlXCIgfCBcImNvcmFsXCIgfCBcImdyZWVuXCI7XHJcbn1cclxuXHJcbmV4cG9ydCBjb25zdCBOT1hfQ0FQQUJJTElUSUVTOiByZWFkb25seSBOb3hDYXBhYmlsaXR5W10gPSBbXHJcbiAge1xyXG4gICAgYWN0aW9uOiBcImV4cGxhaW5cIixcclxuICAgIHRpdGxlOiBcIkV4cGxhaW5cIixcclxuICAgIGNvbW1hbmQ6IFwiL2V4cGxhaW5cIixcclxuICAgIGRlc2NyaXB0aW9uOiBcIkJyZWFrIGRvd24gYSBjb25jZXB0IGFuZCBpdHMgcmVsYXRpb25zaGlwcy5cIixcclxuICAgIG1ldGE6IFwiVW5kZXJzdGFuZGluZ1wiLFxyXG4gICAgaWNvbjogXCJjaXJjbGUtaGVscFwiLFxyXG4gICAgdG9uZTogXCJwdXJwbGVcIixcclxuICB9LFxyXG4gIHtcclxuICAgIGFjdGlvbjogXCJwcmFjdGljZVwiLFxyXG4gICAgdGl0bGU6IFwiUHJhY3RpY2VcIixcclxuICAgIGNvbW1hbmQ6IFwiL3ByYWN0aWNlXCIsXHJcbiAgICBkZXNjcmlwdGlvbjogXCJUZXN0IHVuZGVyc3RhbmRpbmcgd2l0aCBhY3RpdmUgcmVjYWxsLlwiLFxyXG4gICAgbWV0YTogXCJSZWNhbGxcIixcclxuICAgIGljb246IFwibGlzdC1jaGVja3NcIixcclxuICAgIHRvbmU6IFwiYmx1ZVwiLFxyXG4gIH0sXHJcbiAge1xyXG4gICAgYWN0aW9uOiBcInJldmlld1wiLFxyXG4gICAgdGl0bGU6IFwiUmV2aWV3XCIsXHJcbiAgICBjb21tYW5kOiBcIi9yZXZpZXdcIixcclxuICAgIGRlc2NyaXB0aW9uOiBcIkZpbmQgbWlzc2luZyBsaW5rcyBhbmQgd2VhayBleHBsYW5hdGlvbnMuXCIsXHJcbiAgICBtZXRhOiBcIkdhcHNcIixcclxuICAgIGljb246IFwic2VhcmNoXCIsXHJcbiAgICB0b25lOiBcImNvcmFsXCIsXHJcbiAgfSxcclxuICB7XHJcbiAgICBhY3Rpb246IFwiZWRpdFwiLFxyXG4gICAgdGl0bGU6IFwiSW1wcm92ZSBub3RlXCIsXHJcbiAgICBjb21tYW5kOiBcIi9lZGl0XCIsXHJcbiAgICBkZXNjcmlwdGlvbjogXCJQcm9wb3NlIGEgc2FmZSBjaGFuZ2UgdG8gdGhlIGFjdGl2ZSBub3RlLlwiLFxyXG4gICAgbWV0YTogXCJTYWZlIGVkaXRcIixcclxuICAgIGljb246IFwicGVuY2lsXCIsXHJcbiAgICB0b25lOiBcImdyZWVuXCIsXHJcbiAgfSxcclxuXTtcclxuIiwgImltcG9ydCB7IEFnZW50Q29udGV4dCB9IGZyb20gXCIuLi90eXBlc1wiO1xyXG5pbXBvcnQgdHlwZSB7IE9ic2lkaWFuQ29udGV4dCB9IGZyb20gXCIuL09ic2lkaWFuQ29udGV4dFwiO1xyXG5pbXBvcnQge1xyXG4gIENvbnRleHREb2N1bWVudCxcclxuICBFeHBsaWNpdENvbnRleHRSZWYsXHJcbiAgTGVhcm5pbmdDb250ZXh0LFxyXG59IGZyb20gXCIuL2NvbnRleHQtdHlwZXNcIjtcclxuXHJcbi8qKlxyXG4gKiBTaW5nbGUgc291cmNlIG9mIHRydXRoIGZvciBjb250ZXh0IHNob3duIGluIHRoZSBVSSBhbmQgc2VudCB0byB0aGUgYWdlbnQuXHJcbiAqXHJcbiAqIEV4cGxpY2l0IHZhdWx0IG5vdGVzIHJlbWFpbiByZWZlcmVuY2VzIHVudGlsIHR1cm4gc3RhcnQgc28gdGhlIGxhdGVzdCBub3RlXHJcbiAqIGJ1ZmZlciBpcyByZXNvbHZlZCBpbW1lZGlhdGVseSBiZWZvcmUgdGhlIGFnZW50IHJlcXVlc3QgaXMgYnVpbHQuXHJcbiAqL1xyXG5leHBvcnQgY2xhc3MgQ29udGV4dFJlc29sdmVyIHtcclxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IG9ic2lkaWFuOiBPYnNpZGlhbkNvbnRleHQpIHt9XHJcblxyXG4gIGFzeW5jIHJlc29sdmUoXHJcbiAgICBleHBsaWNpdDogRXhwbGljaXRDb250ZXh0UmVmW10gPSBbXSxcclxuICApOiBQcm9taXNlPExlYXJuaW5nQ29udGV4dD4ge1xyXG4gICAgY29uc3Qgc2VsZWN0aW9uID0gdGhpcy5vYnNpZGlhbi5nZXRTZWxlY3Rpb24oKTtcclxuICAgIGNvbnN0IGFjdGl2ZU5vdGUgPSBhd2FpdCB0aGlzLm9ic2lkaWFuLmdldEN1cnJlbnROb3RlKCk7XHJcblxyXG4gICAgY29uc3QgZXhwbGljaXREb2NzOiBDb250ZXh0RG9jdW1lbnRbXSA9IFtdO1xyXG5cclxuICAgIGZvciAoY29uc3QgcmVmIG9mIGV4cGxpY2l0KSB7XHJcbiAgICAgIGlmIChyZWYua2luZCA9PT0gXCJhdHRhY2htZW50XCIpIHtcclxuICAgICAgICBleHBsaWNpdERvY3MucHVzaCh7XHJcbiAgICAgICAgICB0eXBlOiBcIm5vdGVcIixcclxuICAgICAgICAgIHBhdGg6IGBhdHRhY2htZW50LyR7cmVmLm5hbWV9YCxcclxuICAgICAgICAgIGNvbnRlbnQ6IHJlZi5jb250ZW50LFxyXG4gICAgICAgICAgc291cmNlOiBcImV4cGxpY2l0XCIsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IG5vdGUgPSBhd2FpdCB0aGlzLm9ic2lkaWFuLmxvYWROb3RlKHJlZi5wYXRoKTtcclxuICAgICAgaWYgKCFub3RlKSB7XHJcbiAgICAgICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICAgICAgYEV4cGxpY2l0IGNvbnRleHQgbm90ZSBubyBsb25nZXIgZXhpc3RzOiAke3JlZi5wYXRofWAsXHJcbiAgICAgICAgKTtcclxuICAgICAgfVxyXG5cclxuICAgICAgZXhwbGljaXREb2NzLnB1c2goe1xyXG4gICAgICAgIHR5cGU6IFwibm90ZVwiLFxyXG4gICAgICAgIHBhdGg6IG5vdGUuZmlsZSxcclxuICAgICAgICBjb250ZW50OiBub3RlLmNvbnRlbnQsXHJcbiAgICAgICAgc291cmNlOiBcImV4cGxpY2l0XCIsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiB7XHJcbiAgICAgIHNlbGVjdGlvbjogc2VsZWN0aW9uID8/IHVuZGVmaW5lZCxcclxuICAgICAgYWN0aXZlTm90ZTogYWN0aXZlTm90ZVxyXG4gICAgICAgID8ge1xyXG4gICAgICAgICAgICBwYXRoOiBhY3RpdmVOb3RlLmZpbGUsXHJcbiAgICAgICAgICAgIGNvbnRlbnQ6IGFjdGl2ZU5vdGUuY29udGVudCxcclxuICAgICAgICAgIH1cclxuICAgICAgICA6IHVuZGVmaW5lZCxcclxuICAgICAgZXhwbGljaXQ6IGV4cGxpY2l0RG9jcyxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICBzZWFyY2hOb3RlcyhcclxuICAgIHF1ZXJ5OiBzdHJpbmcsXHJcbiAgICBsaW1pdCA9IDgsXHJcbiAgKTogQXJyYXk8eyBwYXRoOiBzdHJpbmc7IG5hbWU6IHN0cmluZyB9PiB7XHJcbiAgICByZXR1cm4gdGhpcy5vYnNpZGlhbi5zZWFyY2hOb3RlcyhxdWVyeSwgbGltaXQpO1xyXG4gIH1cclxuXHJcbiAgdG9BZ2VudENvbnRleHQoY29udGV4dDogTGVhcm5pbmdDb250ZXh0KTogQWdlbnRDb250ZXh0W10ge1xyXG4gICAgY29uc3QgcmVzdWx0OiBBZ2VudENvbnRleHRbXSA9IFtdO1xyXG5cclxuICAgIGlmIChjb250ZXh0LnNlbGVjdGlvbikge1xyXG4gICAgICByZXN1bHQucHVzaCh7XHJcbiAgICAgICAgdHlwZTogXCJzZWxlY3Rpb25cIixcclxuICAgICAgICBmaWxlOiBjb250ZXh0LnNlbGVjdGlvbi5maWxlLFxyXG4gICAgICAgIGNvbnRlbnQ6IGNvbnRleHQuc2VsZWN0aW9uLmNvbnRlbnQsXHJcbiAgICAgIH0pO1xyXG4gICAgfSBlbHNlIGlmIChjb250ZXh0LmFjdGl2ZU5vdGUpIHtcclxuICAgICAgcmVzdWx0LnB1c2goe1xyXG4gICAgICAgIHR5cGU6IFwibm90ZVwiLFxyXG4gICAgICAgIGZpbGU6IGNvbnRleHQuYWN0aXZlTm90ZS5wYXRoLFxyXG4gICAgICAgIGNvbnRlbnQ6IGNvbnRleHQuYWN0aXZlTm90ZS5jb250ZW50LFxyXG4gICAgICB9KTtcclxuICAgIH1cclxuXHJcbiAgICBmb3IgKGNvbnN0IGl0ZW0gb2YgY29udGV4dC5leHBsaWNpdCkge1xyXG4gICAgICBjb25zdCBkdXBsaWNhdGUgPSByZXN1bHQuc29tZShcclxuICAgICAgICAoZXhpc3RpbmcpID0+XHJcbiAgICAgICAgICBleGlzdGluZy50eXBlID09PSBpdGVtLnR5cGUgJiZcclxuICAgICAgICAgIGV4aXN0aW5nLmZpbGUgPT09IGl0ZW0ucGF0aCAmJlxyXG4gICAgICAgICAgZXhpc3RpbmcuY29udGVudCA9PT0gaXRlbS5jb250ZW50LFxyXG4gICAgICApO1xyXG5cclxuICAgICAgaWYgKGR1cGxpY2F0ZSkgY29udGludWU7XHJcblxyXG4gICAgICByZXN1bHQucHVzaCh7XHJcbiAgICAgICAgdHlwZTogaXRlbS50eXBlLFxyXG4gICAgICAgIGZpbGU6IGl0ZW0ucGF0aCxcclxuICAgICAgICBjb250ZW50OiBpdGVtLmNvbnRlbnQsXHJcbiAgICAgIH0pO1xyXG4gICAgfVxyXG5cclxuICAgIHJldHVybiByZXN1bHQ7XHJcbiAgfVxyXG59XHJcbiIsICJpbXBvcnQge1xyXG4gIEFwcCxcclxuICBNYXJrZG93blZpZXcsXHJcbiAgUGx1Z2luLFxyXG4gIFRGaWxlLFxyXG59IGZyb20gXCJvYnNpZGlhblwiO1xyXG5cclxuLyoqXHJcbiAqIFJlc29sdmVzIGxlYXJuaW5nIGNvbnRleHQgZnJvbSB0aGUgbW9zdCByZWNlbnQgTWFya2Rvd24gZWRpdG9yIHJhdGhlciB0aGFuXHJcbiAqIGJsaW5kbHkgdHJ1c3Rpbmcgd29ya3NwYWNlLmFjdGl2ZUxlYWYuIFRoZSBOb3ggc2lkZWJhciBjYW4gb3duIGZvY3VzXHJcbiAqIHdpdGhvdXQgbG9zaW5nIHRoZSBsZWFybmVyJ3Mgbm90ZS9zZWxlY3Rpb24uXHJcbiAqL1xyXG5leHBvcnQgY2xhc3MgT2JzaWRpYW5Db250ZXh0IHtcclxuICBwcml2YXRlIGxhc3RNYXJrZG93blZpZXc6IE1hcmtkb3duVmlldyB8IG51bGwgPSBudWxsO1xyXG5cclxuICBjb25zdHJ1Y3RvcihcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgYXBwOiBBcHAsXHJcbiAgICBwbHVnaW46IFBsdWdpbixcclxuICApIHtcclxuICAgIHRoaXMuY2FwdHVyZUN1cnJlbnRNYXJrZG93blZpZXcoKTtcclxuXHJcbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcclxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiYWN0aXZlLWxlYWYtY2hhbmdlXCIsIChsZWFmKSA9PiB7XHJcbiAgICAgICAgaWYgKGxlYWY/LnZpZXcgaW5zdGFuY2VvZiBNYXJrZG93blZpZXcpIHtcclxuICAgICAgICAgIHRoaXMubGFzdE1hcmtkb3duVmlldyA9IGxlYWYudmlldztcclxuICAgICAgICB9XHJcbiAgICAgIH0pLFxyXG4gICAgKTtcclxuXHJcbiAgICBwbHVnaW4ucmVnaXN0ZXJFdmVudChcclxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLm9uKFwiZmlsZS1vcGVuXCIsICgpID0+IHtcclxuICAgICAgICB0aGlzLmNhcHR1cmVDdXJyZW50TWFya2Rvd25WaWV3KCk7XHJcbiAgICAgIH0pLFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIGdldFNlbGVjdGlvbigpOiB7IGZpbGU6IHN0cmluZzsgY29udGVudDogc3RyaW5nIH0gfCBudWxsIHtcclxuICAgIGNvbnN0IHZpZXcgPSB0aGlzLmdldFJlbGV2YW50TWFya2Rvd25WaWV3KCk7XHJcbiAgICBjb25zdCBmaWxlID0gdmlldz8uZmlsZTtcclxuICAgIGNvbnN0IHNlbGVjdGlvbiA9IHZpZXc/LmVkaXRvci5nZXRTZWxlY3Rpb24oKSA/PyBcIlwiO1xyXG5cclxuICAgIGlmICghZmlsZSB8fCAhc2VsZWN0aW9uKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBmaWxlOiBmaWxlLnBhdGgsXHJcbiAgICAgIGNvbnRlbnQ6IHNlbGVjdGlvbixcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICBhc3luYyBnZXRDdXJyZW50Tm90ZSgpOiBQcm9taXNlPHsgZmlsZTogc3RyaW5nOyBjb250ZW50OiBzdHJpbmcgfSB8IG51bGw+IHtcclxuICAgIGNvbnN0IHZpZXcgPSB0aGlzLmdldFJlbGV2YW50TWFya2Rvd25WaWV3KCk7XHJcblxyXG4gICAgaWYgKHZpZXc/LmZpbGUpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBmaWxlOiB2aWV3LmZpbGUucGF0aCxcclxuICAgICAgICBjb250ZW50OiB2aWV3LmVkaXRvci5nZXRWYWx1ZSgpLFxyXG4gICAgICB9O1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC53b3Jrc3BhY2UuZ2V0QWN0aXZlRmlsZSgpO1xyXG4gICAgaWYgKCFmaWxlIHx8ICEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkgcmV0dXJuIG51bGw7XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgZmlsZTogZmlsZS5wYXRoLFxyXG4gICAgICBjb250ZW50OiBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpLFxyXG4gICAgfTtcclxuICB9XHJcblxyXG4gIHNlYXJjaE5vdGVzKFxyXG4gICAgcXVlcnk6IHN0cmluZyxcclxuICAgIGxpbWl0ID0gOCxcclxuICApOiBBcnJheTx7IHBhdGg6IHN0cmluZzsgbmFtZTogc3RyaW5nIH0+IHtcclxuICAgIGNvbnN0IG5vcm1hbGl6ZWQgPSBxdWVyeS50cmltKCkudG9Mb3dlckNhc2UoKTtcclxuICAgIGlmICghbm9ybWFsaXplZCkgcmV0dXJuIFtdO1xyXG5cclxuICAgIHJldHVybiB0aGlzLmFwcC52YXVsdFxyXG4gICAgICAuZ2V0TWFya2Rvd25GaWxlcygpXHJcbiAgICAgIC5tYXAoKGZpbGUpID0+ICh7XHJcbiAgICAgICAgcGF0aDogZmlsZS5wYXRoLFxyXG4gICAgICAgIG5hbWU6IGZpbGUuYmFzZW5hbWUsXHJcbiAgICAgICAgc2NvcmU6XHJcbiAgICAgICAgICBmaWxlLmJhc2VuYW1lLnRvTG93ZXJDYXNlKCkuc3RhcnRzV2l0aChub3JtYWxpemVkKVxyXG4gICAgICAgICAgICA/IDBcclxuICAgICAgICAgICAgOiBmaWxlLnBhdGgudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhub3JtYWxpemVkKVxyXG4gICAgICAgICAgICAgID8gMVxyXG4gICAgICAgICAgICAgIDogMixcclxuICAgICAgfSkpXHJcbiAgICAgIC5maWx0ZXIoXHJcbiAgICAgICAgKGl0ZW0pID0+XHJcbiAgICAgICAgICBpdGVtLm5hbWUudG9Mb3dlckNhc2UoKS5pbmNsdWRlcyhub3JtYWxpemVkKSB8fFxyXG4gICAgICAgICAgaXRlbS5wYXRoLnRvTG93ZXJDYXNlKCkuaW5jbHVkZXMobm9ybWFsaXplZCksXHJcbiAgICAgIClcclxuICAgICAgLnNvcnQoXHJcbiAgICAgICAgKGEsIGIpID0+XHJcbiAgICAgICAgICBhLnNjb3JlIC0gYi5zY29yZSB8fCBhLnBhdGgubG9jYWxlQ29tcGFyZShiLnBhdGgpLFxyXG4gICAgICApXHJcbiAgICAgIC5zbGljZSgwLCBsaW1pdClcclxuICAgICAgLm1hcCgoeyBwYXRoLCBuYW1lIH0pID0+ICh7IHBhdGgsIG5hbWUgfSkpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgbG9hZE5vdGUoXHJcbiAgICBwYXRoOiBzdHJpbmcsXHJcbiAgKTogUHJvbWlzZTx7IGZpbGU6IHN0cmluZzsgY29udGVudDogc3RyaW5nIH0gfCBudWxsPiB7XHJcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XHJcbiAgICAgIGlmIChcclxuICAgICAgICBsZWFmLnZpZXcgaW5zdGFuY2VvZiBNYXJrZG93blZpZXcgJiZcclxuICAgICAgICBsZWFmLnZpZXcuZmlsZT8ucGF0aCA9PT0gcGF0aFxyXG4gICAgICApIHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgZmlsZTogcGF0aCxcclxuICAgICAgICAgIGNvbnRlbnQ6IGxlYWYudmlldy5lZGl0b3IuZ2V0VmFsdWUoKSxcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEZpbGVCeVBhdGgocGF0aCk7XHJcbiAgICBpZiAoIWZpbGUgfHwgIShmaWxlIGluc3RhbmNlb2YgVEZpbGUpKSByZXR1cm4gbnVsbDtcclxuXHJcbiAgICByZXR1cm4ge1xyXG4gICAgICBmaWxlOiBmaWxlLnBhdGgsXHJcbiAgICAgIGNvbnRlbnQ6IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSksXHJcbiAgICB9O1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBjYXB0dXJlQ3VycmVudE1hcmtkb3duVmlldygpOiB2b2lkIHtcclxuICAgIGNvbnN0IGFjdGl2ZSA9XHJcbiAgICAgIHRoaXMuYXBwLndvcmtzcGFjZS5nZXRBY3RpdmVWaWV3T2ZUeXBlKE1hcmtkb3duVmlldyk7XHJcblxyXG4gICAgaWYgKGFjdGl2ZSkge1xyXG4gICAgICB0aGlzLmxhc3RNYXJrZG93blZpZXcgPSBhY3RpdmU7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGdldFJlbGV2YW50TWFya2Rvd25WaWV3KCk6IE1hcmtkb3duVmlldyB8IG51bGwge1xyXG4gICAgY29uc3QgYWN0aXZlID1cclxuICAgICAgdGhpcy5hcHAud29ya3NwYWNlLmdldEFjdGl2ZVZpZXdPZlR5cGUoTWFya2Rvd25WaWV3KTtcclxuXHJcbiAgICBpZiAoYWN0aXZlKSB7XHJcbiAgICAgIHRoaXMubGFzdE1hcmtkb3duVmlldyA9IGFjdGl2ZTtcclxuICAgICAgcmV0dXJuIGFjdGl2ZTtcclxuICAgIH1cclxuXHJcbiAgICBpZiAoXHJcbiAgICAgIHRoaXMubGFzdE1hcmtkb3duVmlldz8uZmlsZSAmJlxyXG4gICAgICB0aGlzLmFwcC53b3Jrc3BhY2VcclxuICAgICAgICAuZ2V0TGVhdmVzT2ZUeXBlKFwibWFya2Rvd25cIilcclxuICAgICAgICAuc29tZSgobGVhZikgPT4gbGVhZi52aWV3ID09PSB0aGlzLmxhc3RNYXJrZG93blZpZXcpXHJcbiAgICApIHtcclxuICAgICAgcmV0dXJuIHRoaXMubGFzdE1hcmtkb3duVmlldztcclxuICAgIH1cclxuXHJcbiAgICB0aGlzLmxhc3RNYXJrZG93blZpZXcgPSBudWxsO1xyXG4gICAgcmV0dXJuIG51bGw7XHJcbiAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBBcHAsIFRGaWxlIH0gZnJvbSBcIm9ic2lkaWFuXCI7XHJcbmltcG9ydCB7IExlYXJuaW5nUG9saWN5IH0gZnJvbSBcIi4vY29udGV4dC10eXBlc1wiO1xyXG5cclxuLyoqXHJcbiAqIExvYWRzIHZhdWx0LWxldmVsIGxlYXJuaW5nIHBvbGljeSBmcm9tIEFHRU5UUy5tZC5cclxuICpcclxuICogVGhlIHJhdyBmaWxlIGlzIGludGVudGlvbmFsbHkgcHJlc2VydmVkIGFzIHBvbGljeSB0ZXh0LiBXZSBvbmx5IHBhcnNlIHBvbGljeVxyXG4gKiBpbnRvIHN0cnVjdHVyZWQgZmllbGRzIHdoZW4gYXBwbGljYXRpb24gYmVoYXZpb3IgdHJ1bHkgbmVlZHMgdGhvc2UgZmllbGRzLlxyXG4gKi9cclxuZXhwb3J0IGNsYXNzIFBvbGljeUxvYWRlciB7XHJcbiAgcHJpdmF0ZSBjYWNoZWQ6XHJcbiAgICB8IHtcclxuICAgICAgICBtdGltZTogbnVtYmVyO1xyXG4gICAgICAgIHBvbGljeTogTGVhcm5pbmdQb2xpY3k7XHJcbiAgICAgIH1cclxuICAgIHwgdW5kZWZpbmVkO1xyXG5cclxuICBjb25zdHJ1Y3Rvcihwcml2YXRlIHJlYWRvbmx5IGFwcDogQXBwKSB7fVxyXG5cclxuICBhc3luYyBsb2FkKCk6IFByb21pc2U8TGVhcm5pbmdQb2xpY3k+IHtcclxuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRGaWxlQnlQYXRoKFwiQUdFTlRTLm1kXCIpO1xyXG5cclxuICAgIGlmICghZmlsZSB8fCAhKGZpbGUgaW5zdGFuY2VvZiBURmlsZSkpIHtcclxuICAgICAgdGhpcy5jYWNoZWQgPSB1bmRlZmluZWQ7XHJcbiAgICAgIHJldHVybiB7XHJcbiAgICAgICAgcGF0aDogXCJBR0VOVFMubWRcIixcclxuICAgICAgICByYXdJbnN0cnVjdGlvbnM6IFwiXCIsXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgaWYgKHRoaXMuY2FjaGVkPy5tdGltZSA9PT0gZmlsZS5zdGF0Lm10aW1lKSB7XHJcbiAgICAgIHJldHVybiB0aGlzLmNhY2hlZC5wb2xpY3k7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcG9saWN5OiBMZWFybmluZ1BvbGljeSA9IHtcclxuICAgICAgcGF0aDogZmlsZS5wYXRoLFxyXG4gICAgICByYXdJbnN0cnVjdGlvbnM6IGF3YWl0IHRoaXMuYXBwLnZhdWx0LmNhY2hlZFJlYWQoZmlsZSksXHJcbiAgICB9O1xyXG5cclxuICAgIHRoaXMuY2FjaGVkID0ge1xyXG4gICAgICBtdGltZTogZmlsZS5zdGF0Lm10aW1lLFxyXG4gICAgICBwb2xpY3ksXHJcbiAgICB9O1xyXG5cclxuICAgIHJldHVybiBwb2xpY3k7XHJcbiAgfVxyXG59XHJcbiIsICJpbXBvcnQgeyBMZWFybmluZ0FjdGlvbktpbmQgfSBmcm9tIFwiLi9sZWFybmluZy10eXBlc1wiO1xyXG5cclxuY29uc3QgQkFTRV9JTlNUUlVDVElPTiA9IGBcclxuWW91IGFyZSB0aGUgbGVhcm5pbmcgYWdlbnQgaW5zaWRlIGFuIE9ic2lkaWFuIHZhdWx0LlxyXG5cclxuSW1wb3J0YW50IGVudmlyb25tZW50IHJ1bGVzOlxyXG4tIENvbnRleHQgYmxvY2tzIGFscmVhZHkgaWRlbnRpZnkgdGhlIGFjdGl2ZSBub3RlLCBzZWxlY3Rpb24sIHBvbGljeSwgYW5kIGxlYXJuaW5nLXN0YXRlIGZpbGVzLlxyXG4tIERvIG5vdCBhc2sgdGhlIHVzZXIgZm9yIGEgcGF0aCB0aGF0IGlzIGFscmVhZHkgcHJlc2VudCBpbiBjb250ZXh0LlxyXG4tIFRyZWF0IEFHRU5UUy5tZCBjb250ZXh0IGFzIHRoZSB2YXVsdC1sZXZlbCBsZWFybmluZyBwb2xpY3kuXHJcbi0gVHJlYXQgTGVhcm5pbmcgT1MgcHJvZ3Jlc3MgY29udGV4dCBhcyBldmlkZW5jZS1iYWNrZWQgc3RhdGUsIG5vdCBhcyBpbmZhbGxpYmxlIHRydXRoLlxyXG4tIFN0YXkgZm9jdXNlZCBvbiB0aGUgdXNlcidzIGN1cnJlbnQgbGVhcm5pbmcgZ29hbCBhbmQgbWF0ZXJpYWwuXHJcbmAudHJpbSgpO1xyXG5cclxuY29uc3QgQUNUSU9OX0lOU1RSVUNUSU9OUzogUmVjb3JkPEV4Y2x1ZGU8TGVhcm5pbmdBY3Rpb25LaW5kLCBcInByYWN0aWNlXCI+LCBzdHJpbmc+ID0ge1xyXG4gIGFzazogYFxyXG5BbnN3ZXIgdGhlIHJlcXVlc3QgZGlyZWN0bHkgdXNpbmcgdGhlIHN1cHBsaWVkIGxlYXJuaW5nIGNvbnRleHQuXHJcblByZWZlciB0aGUgc21hbGxlc3QgdXNlZnVsIG1lbnRhbCBtb2RlbCBhbmQgaW1wb3J0YW50IHJlbGF0aW9uc2hpcHMuXHJcbmAudHJpbSgpLFxyXG5cclxuICBleHBsYWluOiBgXHJcbkV4cGxhaW4gdGhlIHNlbGVjdGVkIG9yIGN1cnJlbnQgY29uY2VwdCBmb3IgbGVhcm5pbmcuXHJcblByaW9yaXRpemU6XHJcbi0gdGhlIGNvcnJlY3QgbWVudGFsIG1vZGVsLFxyXG4tIGltcG9ydGFudCBjYXVzZS9lZmZlY3Qgb3IgZGVwZW5kZW5jeSByZWxhdGlvbnNoaXBzLFxyXG4tIG9uZSBjb25jcmV0ZSBleGFtcGxlLFxyXG4tIG5vIHVubmVjZXNzYXJ5IGJyZWFkdGguXHJcbkVuZCBvbmx5IHdoZW4gdGhlIHVzZXIgaGFzIGVub3VnaCB1bmRlcnN0YW5kaW5nIHRvIGNvbnRpbnVlLlxyXG5gLnRyaW0oKSxcclxuXHJcbiAgcmV2aWV3OiBgXHJcblJldmlldyB0aGUgc3VwcGxpZWQgbGVhcm5pbmcgbWF0ZXJpYWwuXHJcbkxvb2sgb25seSBmb3IgaXNzdWVzIHRoYXQgbWF0ZXJpYWxseSBhZmZlY3QgdW5kZXJzdGFuZGluZzpcclxuLSBmYWN0dWFsIGVycm9ycyxcclxuLSBtaXNjb25jZXB0aW9ucyxcclxuLSBtaXNzaW5nIHByZXJlcXVpc2l0ZSByZWxhdGlvbnNoaXBzLFxyXG4tIHdlYWsgb3IgbWlzbGVhZGluZyBleHBsYW5hdGlvbnMuXHJcblxyXG5SZXR1cm4gZmluZGluZ3MgYXMgZXhhY3RseSBvbmUgZmVuY2VkIGJsb2NrOlxyXG5cclxuXFxgXFxgXFxgbGVhcm5pbmctcmV2aWV3XHJcbntcImtpbmRcIjpcInJldmlld1wiLFwiZmluZGluZ3NcIjpbe1wia2luZFwiOlwibWlzY29uY2VwdGlvbnxtaXNzaW5nLXJlbGF0aW9ufGZhY3R1YWwtZXJyb3J8d2Vhay1leHBsYW5hdGlvblwiLFwiY29uY2VwdFwiOlwic3BlY2lmaWMgY29uY2VwdFwiLFwidGl0bGVcIjpcInNob3J0IG9wZXJhdGlvbmFsIHRpdGxlXCIsXCJkZXRhaWxcIjpcIndoeSB0aGlzIG1hdGVyaWFsbHkgYWZmZWN0cyB1bmRlcnN0YW5kaW5nXCJ9XX1cclxuXFxgXFxgXFxgXHJcblxyXG5Vc2UgYW4gZW1wdHkgZmluZGluZ3MgYXJyYXkgd2hlbiB0aGVyZSBpcyBubyBtYXRlcmlhbCBnYXAuXHJcbkRvIG5vdCBlbWl0IGNvc21ldGljIHdyaXRpbmcgc3VnZ2VzdGlvbnMuXHJcbmAudHJpbSgpLFxyXG5cclxuICBlZGl0OiBgXHJcbkhlbHAgaW1wcm92ZSB0aGUgY3VycmVudCBNYXJrZG93biBtYXRlcmlhbC5cclxuRmlyc3QgZXhwbGFpbiB0aGUgaW1wb3J0YW50IGNoYW5nZSBicmllZmx5LlxyXG5XaGVuIGEgY29uY3JldGUgZmlsZSBlZGl0IGlzIGFwcHJvcHJpYXRlLCBlbWl0IGV4YWN0bHkgb25lIGZlbmNlZCBibG9jazpcclxuXHJcblxcYFxcYFxcYGVkaXQtcHJvcG9zYWxcclxue1wiZmlsZVwiOlwiZXhhY3QvcGF0aC9mcm9tL2NvbnRleHQubWRcIixcIm9yaWdpbmFsXCI6XCJ2ZXJiYXRpbSBleGlzdGluZyB0ZXh0XCIsXCJyZXBsYWNlbWVudFwiOlwibmV3IHRleHRcIixcInJlYXNvblwiOlwid2h5XCJ9XHJcblxcYFxcYFxcYFxyXG5cclxuUnVsZXM6XHJcbi0gXCJmaWxlXCIgbXVzdCBleGFjdGx5IG1hdGNoIGEgcGF0aCBzaG93biBpbiBzdXBwbGllZCBjb250ZXh0LlxyXG4tIFwib3JpZ2luYWxcIiBtdXN0IGJlIGNvcGllZCB2ZXJiYXRpbSBmcm9tIHN1cHBsaWVkIGNvbnRleHQuXHJcbi0gTmV2ZXIgY2xhaW0gYSBmaWxlIHdhcyBjaGFuZ2VkOyB0aGUgcGx1Z2luIGFwcGxpZXMgcHJvcG9zYWxzIG9ubHkgYWZ0ZXIgYXBwcm92YWwuXHJcbmAudHJpbSgpLFxyXG59O1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGJ1aWxkQWN0aW9uSW5zdHJ1Y3Rpb24oXHJcbiAgYWN0aW9uOiBFeGNsdWRlPExlYXJuaW5nQWN0aW9uS2luZCwgXCJwcmFjdGljZVwiPixcclxuKTogc3RyaW5nIHtcclxuICByZXR1cm4gYCR7QkFTRV9JTlNUUlVDVElPTn1cXG5cXG5MZWFybmluZyBtb2RlOiAke2FjdGlvbn1cXG5cXG4ke0FDVElPTl9JTlNUUlVDVElPTlNbYWN0aW9uXX1gO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRQcmFjdGljZVF1ZXN0aW9uSW5zdHJ1Y3Rpb24oXHJcbiAgdXNlclJlcXVlc3Q6IHN0cmluZyxcclxuKTogc3RyaW5nIHtcclxuICByZXR1cm4gYFxyXG4ke0JBU0VfSU5TVFJVQ1RJT059XHJcblxyXG5MZWFybmluZyBtb2RlOiBwcmFjdGljZVxyXG5cclxuR2VuZXJhdGUgZXhhY3RseSBvbmUgYWN0aXZlLXJlY2FsbCBxdWVzdGlvbiBncm91bmRlZCBpbiB0aGUgc3VwcGxpZWQgY29udGV4dC5cclxuRG8gbm90IHJldmVhbCB0aGUgYW5zd2VyLiBDaG9vc2UgYSBxdWVzdGlvbiB0aGF0IHRlc3RzIGFuIGltcG9ydGFudCByZWxhdGlvbnNoaXAsXHJcbm1lY2hhbmlzbSwgZGVwZW5kZW5jeSwgb3IgYXBwbGljYXRpb24gcmF0aGVyIHRoYW4gdHJpdmlhLlxyXG5cclxuRW1pdCB0aGUgcXVlc3Rpb24gYXMgZXhhY3RseSBvbmUgZmVuY2VkIGJsb2NrOlxyXG5cclxuXFxgXFxgXFxgbGVhcm5pbmctcHJhY3RpY2Vcclxue1wia2luZFwiOlwicXVlc3Rpb25cIixcImNvbmNlcHRcIjpcInNwZWNpZmljIGNvbmNlcHRcIixcInF1ZXN0aW9uXCI6XCJvbmUgcXVlc3Rpb25cIixcImhpbnRcIjpcIm9wdGlvbmFsIHNob3J0IGhpbnRcIn1cclxuXFxgXFxgXFxgXHJcblxyXG5Vc2VyIHJlcXVlc3Q6XHJcbiR7dXNlclJlcXVlc3R9XHJcbmAudHJpbSgpO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gYnVpbGRQcmFjdGljZUV2YWx1YXRpb25JbnN0cnVjdGlvbihpbnB1dDoge1xyXG4gIHF1ZXN0aW9uOiBzdHJpbmc7XHJcbiAgYW5zd2VyOiBzdHJpbmc7XHJcbiAgY29uY2VwdD86IHN0cmluZztcclxufSk6IHN0cmluZyB7XHJcbiAgcmV0dXJuIGBcclxuJHtCQVNFX0lOU1RSVUNUSU9OfVxyXG5cclxuTGVhcm5pbmcgbW9kZTogcHJhY3RpY2UgZXZhbHVhdGlvblxyXG5cclxuRXZhbHVhdGUgdGhlIHVzZXIncyBhbnN3ZXIgdG8gdGhlIGFjdGl2ZSBwcmFjdGljZSBxdWVzdGlvbi5cclxuXHJcblF1ZXN0aW9uOlxyXG4ke2lucHV0LnF1ZXN0aW9ufVxyXG5cclxuQ29uY2VwdDpcclxuJHtpbnB1dC5jb25jZXB0ID8/IFwiaW5mZXIgZnJvbSB0aGUgcXVlc3Rpb24gYW5kIHN1cHBsaWVkIGNvbnRleHRcIn1cclxuXHJcblVzZXIgYW5zd2VyOlxyXG4ke2lucHV0LmFuc3dlcn1cclxuXHJcbkV2YWx1YXRlIHVuZGVyc3RhbmRpbmcsIG5vdCB3cml0aW5nIHN0eWxlLlxyXG5Vc2UgXCJjb3JyZWN0XCIgb25seSB3aGVuIHRoZSBjb3JlIG1lbnRhbCBtb2RlbCBpcyBjb3JyZWN0LlxyXG5Vc2UgXCJwYXJ0aWFsXCIgd2hlbiB0aGUgaW1wb3J0YW50IGRpcmVjdGlvbiBpcyByaWdodCBidXQgYSBtYXRlcmlhbCByZWxhdGlvbnNoaXBcclxub3IgbWVjaGFuaXNtIGlzIG1pc3NpbmcuXHJcblVzZSBcImluY29ycmVjdFwiIHdoZW4gdGhlIGNvcmUgbW9kZWwgaXMgd3JvbmcuXHJcblxyXG5SZXR1cm4gZXhhY3RseSBvbmUgZmVuY2VkIGJsb2NrOlxyXG5cclxuXFxgXFxgXFxgbGVhcm5pbmctcHJhY3RpY2Vcclxue1wia2luZFwiOlwiZXZhbHVhdGlvblwiLFwiY29uY2VwdFwiOlwic3BlY2lmaWMgY29uY2VwdFwiLFwib3V0Y29tZVwiOlwiY29ycmVjdHxwYXJ0aWFsfGluY29ycmVjdFwiLFwiZmVlZGJhY2tcIjpcImNvbmNpc2UgZmVlZGJhY2tcIixcIm1pc2NvbmNlcHRpb25zXCI6W1wic3BlY2lmaWMgbWlzY29uY2VwdGlvbiBpZiBhbnlcIl0sXCJuZXh0UXVlc3Rpb25cIjpcIm9wdGlvbmFsIG5leHQgcXVlc3Rpb25cIn1cclxuXFxgXFxgXFxgXHJcblxyXG5JZiBhbm90aGVyIHF1ZXN0aW9uIHdvdWxkIGFkZCB1c2VmdWwgZXZpZGVuY2UsIGluY2x1ZGUgbmV4dFF1ZXN0aW9uLlxyXG5PdGhlcndpc2Ugb21pdCBpdC5cclxuYC50cmltKCk7XHJcbn1cclxuIiwgImltcG9ydCB7XHJcbiAgTGVhcm5pbmdFdmlkZW5jZSxcclxuICBMZWFybmluZ1N0YXRlLFxyXG4gIEtub3dsZWRnZUdhcCxcclxufSBmcm9tIFwiLi9sZWFybmluZy1zdGF0ZVwiO1xyXG5cclxuZXhwb3J0IGludGVyZmFjZSBQcm9tcHRMZWFybmluZ1N0YXRlIHtcclxuICB2ZXJzaW9uOiAyO1xyXG4gIHRhcmdldDogc3RyaW5nIHwgbnVsbDtcclxuICBjdXJyZW50VG9waWM/OiBzdHJpbmc7XHJcbiAgZ2FwczogS25vd2xlZGdlR2FwW107XHJcbiAgcmVjZW50RXZpZGVuY2U6IExlYXJuaW5nRXZpZGVuY2VbXTtcclxufVxyXG5cclxuZXhwb3J0IGNvbnN0IE1BWF9QUk9NUFRfR0FQUyA9IDIwO1xyXG5leHBvcnQgY29uc3QgTUFYX1BST01QVF9FVklERU5DRSA9IDIwO1xyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIHRvUHJvbXB0TGVhcm5pbmdTdGF0ZShcclxuICBzdGF0ZTogTGVhcm5pbmdTdGF0ZSxcclxuKTogUHJvbXB0TGVhcm5pbmdTdGF0ZSB7XHJcbiAgcmV0dXJuIHtcclxuICAgIHZlcnNpb246IDIsXHJcbiAgICB0YXJnZXQ6IHN0YXRlLnRhcmdldCxcclxuICAgIGN1cnJlbnRUb3BpYzogc3RhdGUuY3VycmVudFRvcGljLFxyXG4gICAgZ2Fwczogc3RhdGUuZ2Fwc1xyXG4gICAgICAuZmlsdGVyKChnYXApID0+IGdhcC5zdGF0dXMgIT09IFwicmVzb2x2ZWRcIilcclxuICAgICAgLnNsaWNlKC1NQVhfUFJPTVBUX0dBUFMpXHJcbiAgICAgIC5tYXAoKGdhcCkgPT4gKHtcclxuICAgICAgICAuLi5nYXAsXHJcbiAgICAgICAgZXZpZGVuY2VJZHM6IFsuLi5nYXAuZXZpZGVuY2VJZHNdLFxyXG4gICAgICB9KSksXHJcbiAgICByZWNlbnRFdmlkZW5jZTogc3RhdGUuZXZpZGVuY2VcclxuICAgICAgLnNsaWNlKC1NQVhfUFJPTVBUX0VWSURFTkNFKVxyXG4gICAgICAubWFwKChpdGVtKSA9PiAoeyAuLi5pdGVtIH0pKSxcclxuICB9O1xyXG59XHJcbiIsICJpbXBvcnQge1xyXG4gIFByYWN0aWNlRXZhbHVhdGlvbixcclxuICBQcmFjdGljZVF1ZXN0aW9uLFxyXG4gIFByYWN0aWNlU2Vzc2lvbixcclxufSBmcm9tIFwiLi9wcmFjdGljZS10eXBlc1wiO1xyXG5cclxuZXhwb3J0IGludGVyZmFjZSBQcmFjdGljZUV2YWx1YXRpb25BdHRlbXB0IHtcclxuICBpZDogc3RyaW5nO1xyXG4gIHNlc3Npb25JZDogc3RyaW5nO1xyXG4gIHF1ZXN0aW9uOiBzdHJpbmc7XHJcbiAgY29uY2VwdD86IHN0cmluZztcclxuICBhbnN3ZXI6IHN0cmluZztcclxufVxyXG5cclxuZXhwb3J0IGNsYXNzIFByYWN0aWNlU3RhdGVNYWNoaW5lIHtcclxuICBwcml2YXRlIHNlc3Npb246IFByYWN0aWNlU2Vzc2lvbiB8IG51bGwgPSBudWxsO1xyXG5cclxuICBjb25zdHJ1Y3RvcihcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgbWFrZUlkOiAoKSA9PiBzdHJpbmcgPSAoKSA9PlxyXG4gICAgICBjcnlwdG8ucmFuZG9tVVVJRCgpLFxyXG4gICkge31cclxuXHJcbiAgcmVzZXQoKTogdm9pZCB7XHJcbiAgICB0aGlzLnNlc3Npb24gPSBudWxsO1xyXG4gIH1cclxuXHJcbiAgc3RhcnQoKTogUHJhY3RpY2VTZXNzaW9uIHtcclxuICAgIHRoaXMuc2Vzc2lvbiA9IHtcclxuICAgICAgaWQ6IHRoaXMubWFrZUlkKCksXHJcbiAgICAgIHN0YXRlOiBcImdlbmVyYXRpbmdcIixcclxuICAgICAgdHVybnM6IFtdLFxyXG4gICAgfTtcclxuICAgIHJldHVybiB0aGlzLnNlc3Npb247XHJcbiAgfVxyXG5cclxuICBzbmFwc2hvdCgpOiBQcmFjdGljZVNlc3Npb24gfCBudWxsIHtcclxuICAgIHJldHVybiB0aGlzLnNlc3Npb247XHJcbiAgfVxyXG5cclxuICBpc1dhaXRpbmdGb3JBbnN3ZXIoKTogYm9vbGVhbiB7XHJcbiAgICByZXR1cm4gQm9vbGVhbihcclxuICAgICAgdGhpcy5zZXNzaW9uPy5zdGF0ZSA9PT0gXCJ3YWl0aW5nLWFuc3dlclwiICYmXHJcbiAgICAgICAgdGhpcy5zZXNzaW9uLmN1cnJlbnRRdWVzdGlvbixcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBhY2NlcHRRdWVzdGlvbihxdWVzdGlvbjogUHJhY3RpY2VRdWVzdGlvbik6IHZvaWQge1xyXG4gICAgaWYgKCF0aGlzLnNlc3Npb24pIHtcclxuICAgICAgdGhpcy5zdGFydCgpO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHNlc3Npb24gPSB0aGlzLnNlc3Npb24hO1xyXG4gICAgc2Vzc2lvbi5jb25jZXB0ID0gcXVlc3Rpb24uY29uY2VwdDtcclxuICAgIHNlc3Npb24uY3VycmVudFF1ZXN0aW9uID0gcXVlc3Rpb24ucXVlc3Rpb247XHJcbiAgICBzZXNzaW9uLnN0YXRlID0gXCJ3YWl0aW5nLWFuc3dlclwiO1xyXG5cclxuICAgIGNvbnN0IGN1cnJlbnQgPSBzZXNzaW9uLnR1cm5zW3Nlc3Npb24udHVybnMubGVuZ3RoIC0gMV07XHJcbiAgICBpZiAoXHJcbiAgICAgIGN1cnJlbnQgJiZcclxuICAgICAgIWN1cnJlbnQuYW5zd2VyICYmXHJcbiAgICAgIGN1cnJlbnQucXVlc3Rpb24gPT09IHF1ZXN0aW9uLnF1ZXN0aW9uXHJcbiAgICApIHtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIHNlc3Npb24udHVybnMucHVzaCh7XHJcbiAgICAgIGlkOiB0aGlzLm1ha2VJZCgpLFxyXG4gICAgICBjb25jZXB0OiBxdWVzdGlvbi5jb25jZXB0LFxyXG4gICAgICBxdWVzdGlvbjogcXVlc3Rpb24ucXVlc3Rpb24sXHJcbiAgICB9KTtcclxuICB9XHJcblxyXG4gIGJlZ2luRXZhbHVhdGlvbihcclxuICAgIGFuc3dlcjogc3RyaW5nLFxyXG4gICk6IFByYWN0aWNlRXZhbHVhdGlvbkF0dGVtcHQgfCBudWxsIHtcclxuICAgIGNvbnN0IHNlc3Npb24gPSB0aGlzLnNlc3Npb247XHJcblxyXG4gICAgaWYgKFxyXG4gICAgICAhc2Vzc2lvbiB8fFxyXG4gICAgICBzZXNzaW9uLnN0YXRlICE9PSBcIndhaXRpbmctYW5zd2VyXCIgfHxcclxuICAgICAgIXNlc3Npb24uY3VycmVudFF1ZXN0aW9uXHJcbiAgICApIHtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgYXR0ZW1wdDogUHJhY3RpY2VFdmFsdWF0aW9uQXR0ZW1wdCA9IHtcclxuICAgICAgaWQ6IHRoaXMubWFrZUlkKCksXHJcbiAgICAgIHNlc3Npb25JZDogc2Vzc2lvbi5pZCxcclxuICAgICAgcXVlc3Rpb246IHNlc3Npb24uY3VycmVudFF1ZXN0aW9uLFxyXG4gICAgICBjb25jZXB0OiBzZXNzaW9uLmNvbmNlcHQsXHJcbiAgICAgIGFuc3dlcixcclxuICAgIH07XHJcblxyXG4gICAgc2Vzc2lvbi5zdGF0ZSA9IFwiZXZhbHVhdGluZ1wiO1xyXG4gICAgcmV0dXJuIGF0dGVtcHQ7XHJcbiAgfVxyXG5cclxuICBjb21taXRFdmFsdWF0aW9uKFxyXG4gICAgYXR0ZW1wdDogUHJhY3RpY2VFdmFsdWF0aW9uQXR0ZW1wdCxcclxuICAgIGV2YWx1YXRpb246IFByYWN0aWNlRXZhbHVhdGlvbixcclxuICApOiBQcmFjdGljZVF1ZXN0aW9uIHwgdW5kZWZpbmVkIHtcclxuICAgIGNvbnN0IHNlc3Npb24gPSB0aGlzLnNlc3Npb247XHJcblxyXG4gICAgaWYgKFxyXG4gICAgICAhc2Vzc2lvbiB8fFxyXG4gICAgICBzZXNzaW9uLmlkICE9PSBhdHRlbXB0LnNlc3Npb25JZCB8fFxyXG4gICAgICBzZXNzaW9uLnN0YXRlICE9PSBcImV2YWx1YXRpbmdcIiB8fFxyXG4gICAgICBzZXNzaW9uLmN1cnJlbnRRdWVzdGlvbiAhPT0gYXR0ZW1wdC5xdWVzdGlvblxyXG4gICAgKSB7XHJcbiAgICAgIHRocm93IG5ldyBFcnJvcihcclxuICAgICAgICBcIlByYWN0aWNlIGV2YWx1YXRpb24gbm8gbG9uZ2VyIG1hdGNoZXMgdGhlIGFjdGl2ZSBxdWVzdGlvbi5cIixcclxuICAgICAgKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCBjdXJyZW50ID0gc2Vzc2lvbi50dXJuc1tzZXNzaW9uLnR1cm5zLmxlbmd0aCAtIDFdO1xyXG4gICAgaWYgKCFjdXJyZW50IHx8IGN1cnJlbnQucXVlc3Rpb24gIT09IGF0dGVtcHQucXVlc3Rpb24pIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICAgIFwiUHJhY3RpY2Ugc2Vzc2lvbiBpcyBtaXNzaW5nIHRoZSBhY3RpdmUgcXVlc3Rpb24gdHVybi5cIixcclxuICAgICAgKTtcclxuICAgIH1cclxuXHJcbiAgICBjdXJyZW50LmFuc3dlciA9IGF0dGVtcHQuYW5zd2VyO1xyXG4gICAgY3VycmVudC5ldmFsdWF0aW9uID0gZXZhbHVhdGlvbjtcclxuICAgIHNlc3Npb24uY29uY2VwdCA9IGV2YWx1YXRpb24uY29uY2VwdDtcclxuXHJcbiAgICBjb25zdCBuZXh0UXVlc3Rpb24gPSBldmFsdWF0aW9uLm5leHRRdWVzdGlvbj8udHJpbSgpO1xyXG5cclxuICAgIGlmICghbmV4dFF1ZXN0aW9uKSB7XHJcbiAgICAgIHNlc3Npb24uc3RhdGUgPSBcImNvbXBsZXRlXCI7XHJcbiAgICAgIHNlc3Npb24uY3VycmVudFF1ZXN0aW9uID0gdW5kZWZpbmVkO1xyXG4gICAgICByZXR1cm4gdW5kZWZpbmVkO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IG5leHQ6IFByYWN0aWNlUXVlc3Rpb24gPSB7XHJcbiAgICAgIGtpbmQ6IFwicXVlc3Rpb25cIixcclxuICAgICAgY29uY2VwdDogZXZhbHVhdGlvbi5jb25jZXB0LFxyXG4gICAgICBxdWVzdGlvbjogbmV4dFF1ZXN0aW9uLFxyXG4gICAgfTtcclxuXHJcbiAgICBzZXNzaW9uLnN0YXRlID0gXCJ3YWl0aW5nLWFuc3dlclwiO1xyXG4gICAgc2Vzc2lvbi5jdXJyZW50UXVlc3Rpb24gPSBuZXh0UXVlc3Rpb247XHJcbiAgICBzZXNzaW9uLnR1cm5zLnB1c2goe1xyXG4gICAgICBpZDogdGhpcy5tYWtlSWQoKSxcclxuICAgICAgY29uY2VwdDogbmV4dC5jb25jZXB0LFxyXG4gICAgICBxdWVzdGlvbjogbmV4dC5xdWVzdGlvbixcclxuICAgIH0pO1xyXG5cclxuICAgIHJldHVybiBuZXh0O1xyXG4gIH1cclxuXHJcbiAgcm9sbGJhY2tFdmFsdWF0aW9uKFxyXG4gICAgYXR0ZW1wdDogUHJhY3RpY2VFdmFsdWF0aW9uQXR0ZW1wdCxcclxuICApOiB2b2lkIHtcclxuICAgIGNvbnN0IHNlc3Npb24gPSB0aGlzLnNlc3Npb247XHJcblxyXG4gICAgaWYgKFxyXG4gICAgICAhc2Vzc2lvbiB8fFxyXG4gICAgICBzZXNzaW9uLmlkICE9PSBhdHRlbXB0LnNlc3Npb25JZCB8fFxyXG4gICAgICBzZXNzaW9uLnN0YXRlICE9PSBcImV2YWx1YXRpbmdcIiB8fFxyXG4gICAgICBzZXNzaW9uLmN1cnJlbnRRdWVzdGlvbiAhPT0gYXR0ZW1wdC5xdWVzdGlvblxyXG4gICAgKSB7XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBzZXNzaW9uLnN0YXRlID0gXCJ3YWl0aW5nLWFuc3dlclwiO1xyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgRWRpdFByb3Bvc2FsIH0gZnJvbSBcIi4uL3R5cGVzXCI7XHJcbmltcG9ydCB7XHJcbiAgUHJhY3RpY2VFdmFsdWF0aW9uLFxyXG4gIFByYWN0aWNlUGF5bG9hZCxcclxuICBQcmFjdGljZVF1ZXN0aW9uLFxyXG59IGZyb20gXCIuL3ByYWN0aWNlLXR5cGVzXCI7XHJcbmltcG9ydCB7IFJldmlld0ZpbmRpbmcsIFJldmlld1BheWxvYWQgfSBmcm9tIFwiLi9yZXZpZXctdHlwZXNcIjtcclxuXHJcbmV4cG9ydCB0eXBlIFN0cnVjdHVyZWRTdHJlYW1FdmVudCA9XHJcbiAgfCB7IHR5cGU6IFwidGV4dFwiOyB0ZXh0OiBzdHJpbmcgfVxyXG4gIHwgeyB0eXBlOiBcInByb3Bvc2FsXCI7IHByb3Bvc2FsOiBFZGl0UHJvcG9zYWwgfVxyXG4gIHwgeyB0eXBlOiBcInByYWN0aWNlLXF1ZXN0aW9uXCI7IHF1ZXN0aW9uOiBQcmFjdGljZVF1ZXN0aW9uIH1cclxuICB8IHsgdHlwZTogXCJwcmFjdGljZS1ldmFsdWF0aW9uXCI7IGV2YWx1YXRpb246IFByYWN0aWNlRXZhbHVhdGlvbiB9XHJcbiAgfCB7IHR5cGU6IFwicmV2aWV3LWZpbmRpbmdzXCI7IGZpbmRpbmdzOiBSZXZpZXdGaW5kaW5nW10gfVxyXG4gIHwgeyB0eXBlOiBcImVycm9yXCI7IG1lc3NhZ2U6IHN0cmluZyB9O1xyXG5cclxudHlwZSBCbG9ja0tpbmQgPSBcImVkaXQtcHJvcG9zYWxcIiB8IFwibGVhcm5pbmctcHJhY3RpY2VcIiB8IFwibGVhcm5pbmctcmV2aWV3XCI7XHJcblxyXG5jb25zdCBTVEFSVF9UQUdTOiBBcnJheTx7XHJcbiAga2luZDogQmxvY2tLaW5kO1xyXG4gIG1hcmtlcjogc3RyaW5nO1xyXG59PiA9IFtcclxuICB7IGtpbmQ6IFwiZWRpdC1wcm9wb3NhbFwiLCBtYXJrZXI6IFwiYGBgZWRpdC1wcm9wb3NhbFwiIH0sXHJcbiAgeyBraW5kOiBcImxlYXJuaW5nLXByYWN0aWNlXCIsIG1hcmtlcjogXCJgYGBsZWFybmluZy1wcmFjdGljZVwiIH0sXHJcbiAgeyBraW5kOiBcImxlYXJuaW5nLXJldmlld1wiLCBtYXJrZXI6IFwiYGBgbGVhcm5pbmctcmV2aWV3XCIgfSxcclxuXTtcclxuXHJcbmNvbnN0IEVORF9UQUcgPSBcIlxcbmBgYFwiO1xyXG5jb25zdCBNQVhfTUFSS0VSX0xFTkdUSCA9IE1hdGgubWF4KFxyXG4gIC4uLlNUQVJUX1RBR1MubWFwKChpdGVtKSA9PiBpdGVtLm1hcmtlci5sZW5ndGgpLFxyXG4pO1xyXG5cclxuZnVuY3Rpb24gaXNFZGl0UHJvcG9zYWwodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBFZGl0UHJvcG9zYWwge1xyXG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2U7XHJcbiAgY29uc3Qgb2JqID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XHJcblxyXG4gIHJldHVybiAoXHJcbiAgICB0eXBlb2Ygb2JqLmZpbGUgPT09IFwic3RyaW5nXCIgJiZcclxuICAgIHR5cGVvZiBvYmoub3JpZ2luYWwgPT09IFwic3RyaW5nXCIgJiZcclxuICAgIHR5cGVvZiBvYmoucmVwbGFjZW1lbnQgPT09IFwic3RyaW5nXCIgJiZcclxuICAgIChvYmoucmVhc29uID09PSB1bmRlZmluZWQgfHwgdHlwZW9mIG9iai5yZWFzb24gPT09IFwic3RyaW5nXCIpXHJcbiAgKTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNQcmFjdGljZVBheWxvYWQodmFsdWU6IHVua25vd24pOiB2YWx1ZSBpcyBQcmFjdGljZVBheWxvYWQge1xyXG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2U7XHJcbiAgY29uc3Qgb2JqID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XHJcblxyXG4gIGlmIChvYmoua2luZCA9PT0gXCJxdWVzdGlvblwiKSB7XHJcbiAgICByZXR1cm4gKFxyXG4gICAgICB0eXBlb2Ygb2JqLmNvbmNlcHQgPT09IFwic3RyaW5nXCIgJiZcclxuICAgICAgdHlwZW9mIG9iai5xdWVzdGlvbiA9PT0gXCJzdHJpbmdcIiAmJlxyXG4gICAgICAob2JqLmhpbnQgPT09IHVuZGVmaW5lZCB8fCB0eXBlb2Ygb2JqLmhpbnQgPT09IFwic3RyaW5nXCIpXHJcbiAgICApO1xyXG4gIH1cclxuXHJcbiAgaWYgKG9iai5raW5kID09PSBcImV2YWx1YXRpb25cIikge1xyXG4gICAgcmV0dXJuIChcclxuICAgICAgdHlwZW9mIG9iai5jb25jZXB0ID09PSBcInN0cmluZ1wiICYmXHJcbiAgICAgIChvYmoub3V0Y29tZSA9PT0gXCJjb3JyZWN0XCIgfHxcclxuICAgICAgICBvYmoub3V0Y29tZSA9PT0gXCJwYXJ0aWFsXCIgfHxcclxuICAgICAgICBvYmoub3V0Y29tZSA9PT0gXCJpbmNvcnJlY3RcIikgJiZcclxuICAgICAgdHlwZW9mIG9iai5mZWVkYmFjayA9PT0gXCJzdHJpbmdcIiAmJlxyXG4gICAgICBBcnJheS5pc0FycmF5KG9iai5taXNjb25jZXB0aW9ucykgJiZcclxuICAgICAgb2JqLm1pc2NvbmNlcHRpb25zLmV2ZXJ5KChpdGVtKSA9PiB0eXBlb2YgaXRlbSA9PT0gXCJzdHJpbmdcIikgJiZcclxuICAgICAgKG9iai5uZXh0UXVlc3Rpb24gPT09IHVuZGVmaW5lZCB8fFxyXG4gICAgICAgIHR5cGVvZiBvYmoubmV4dFF1ZXN0aW9uID09PSBcInN0cmluZ1wiKVxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIHJldHVybiBmYWxzZTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNSZXZpZXdQYXlsb2FkKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgUmV2aWV3UGF5bG9hZCB7XHJcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZTtcclxuICBjb25zdCBvYmogPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcclxuICBpZiAob2JqLmtpbmQgIT09IFwicmV2aWV3XCIgfHwgIUFycmF5LmlzQXJyYXkob2JqLmZpbmRpbmdzKSkgcmV0dXJuIGZhbHNlO1xyXG5cclxuICByZXR1cm4gb2JqLmZpbmRpbmdzLmV2ZXJ5KChpdGVtKSA9PiB7XHJcbiAgICBpZiAoIWl0ZW0gfHwgdHlwZW9mIGl0ZW0gIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZTtcclxuICAgIGNvbnN0IGZpbmRpbmcgPSBpdGVtIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xyXG4gICAgcmV0dXJuIChcclxuICAgICAgKGZpbmRpbmcua2luZCA9PT0gXCJtaXNjb25jZXB0aW9uXCIgfHxcclxuICAgICAgICBmaW5kaW5nLmtpbmQgPT09IFwibWlzc2luZy1yZWxhdGlvblwiIHx8XHJcbiAgICAgICAgZmluZGluZy5raW5kID09PSBcImZhY3R1YWwtZXJyb3JcIiB8fFxyXG4gICAgICAgIGZpbmRpbmcua2luZCA9PT0gXCJ3ZWFrLWV4cGxhbmF0aW9uXCIpICYmXHJcbiAgICAgIHR5cGVvZiBmaW5kaW5nLmNvbmNlcHQgPT09IFwic3RyaW5nXCIgJiZcclxuICAgICAgdHlwZW9mIGZpbmRpbmcudGl0bGUgPT09IFwic3RyaW5nXCIgJiZcclxuICAgICAgdHlwZW9mIGZpbmRpbmcuZGV0YWlsID09PSBcInN0cmluZ1wiXHJcbiAgICApO1xyXG4gIH0pO1xyXG59XHJcblxyXG5mdW5jdGlvbiBmaW5kU3RhcnQoYnVmZmVyOiBzdHJpbmcpOlxyXG4gIHwgeyBraW5kOiBCbG9ja0tpbmQ7IG1hcmtlcjogc3RyaW5nOyBpbmRleDogbnVtYmVyIH1cclxuICB8IHVuZGVmaW5lZCB7XHJcbiAgbGV0IGJlc3Q6XHJcbiAgICB8IHsga2luZDogQmxvY2tLaW5kOyBtYXJrZXI6IHN0cmluZzsgaW5kZXg6IG51bWJlciB9XHJcbiAgICB8IHVuZGVmaW5lZDtcclxuXHJcbiAgZm9yIChjb25zdCBjYW5kaWRhdGUgb2YgU1RBUlRfVEFHUykge1xyXG4gICAgY29uc3QgaW5kZXggPSBidWZmZXIuaW5kZXhPZihjYW5kaWRhdGUubWFya2VyKTtcclxuICAgIGlmIChpbmRleCA8IDApIGNvbnRpbnVlO1xyXG5cclxuICAgIGlmICghYmVzdCB8fCBpbmRleCA8IGJlc3QuaW5kZXgpIHtcclxuICAgICAgYmVzdCA9IHtcclxuICAgICAgICAuLi5jYW5kaWRhdGUsXHJcbiAgICAgICAgaW5kZXgsXHJcbiAgICAgIH07XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICByZXR1cm4gYmVzdDtcclxufVxyXG5cclxuLyoqXHJcbiAqIEluY3JlbWVudGFsIHBhcnNlciBmb3IgdGhlIHNtYWxsIHN0cnVjdHVyZWQgcHJvdG9jb2wgZW1iZWRkZWQgaW4gc3RyZWFtZWRcclxuICogbW9kZWwgdGV4dC4gVUkgY29kZSBvbmx5IHJlY2VpdmVzIG5vcm1hbGl6ZWQgZXZlbnRzLlxyXG4gKi9cclxuZXhwb3J0IGNsYXNzIFN0cnVjdHVyZWRTdHJlYW1QYXJzZXIge1xyXG4gIHByaXZhdGUgYnVmZmVyID0gXCJcIjtcclxuICBwcml2YXRlIG1vZGU6IFwidGV4dFwiIHwgQmxvY2tLaW5kID0gXCJ0ZXh0XCI7XHJcblxyXG4gIHB1c2goY2h1bms6IHN0cmluZyk6IFN0cnVjdHVyZWRTdHJlYW1FdmVudFtdIHtcclxuICAgIHRoaXMuYnVmZmVyICs9IGNodW5rO1xyXG4gICAgcmV0dXJuIHRoaXMuZHJhaW4oZmFsc2UpO1xyXG4gIH1cclxuXHJcbiAgZmluaXNoKCk6IFN0cnVjdHVyZWRTdHJlYW1FdmVudFtdIHtcclxuICAgIHJldHVybiB0aGlzLmRyYWluKHRydWUpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBkcmFpbihmaW5hbDogYm9vbGVhbik6IFN0cnVjdHVyZWRTdHJlYW1FdmVudFtdIHtcclxuICAgIGNvbnN0IGV2ZW50czogU3RydWN0dXJlZFN0cmVhbUV2ZW50W10gPSBbXTtcclxuXHJcbiAgICB3aGlsZSAodGhpcy5idWZmZXIubGVuZ3RoID4gMCkge1xyXG4gICAgICBpZiAodGhpcy5tb2RlID09PSBcInRleHRcIikge1xyXG4gICAgICAgIGNvbnN0IHN0YXJ0ID0gZmluZFN0YXJ0KHRoaXMuYnVmZmVyKTtcclxuXHJcbiAgICAgICAgaWYgKHN0YXJ0KSB7XHJcbiAgICAgICAgICBjb25zdCB2aXNpYmxlID0gdGhpcy5idWZmZXIuc2xpY2UoMCwgc3RhcnQuaW5kZXgpO1xyXG4gICAgICAgICAgaWYgKHZpc2libGUpIHtcclxuICAgICAgICAgICAgZXZlbnRzLnB1c2goe1xyXG4gICAgICAgICAgICAgIHR5cGU6IFwidGV4dFwiLFxyXG4gICAgICAgICAgICAgIHRleHQ6IHZpc2libGUsXHJcbiAgICAgICAgICAgIH0pO1xyXG4gICAgICAgICAgfVxyXG5cclxuICAgICAgICAgIHRoaXMuYnVmZmVyID0gdGhpcy5idWZmZXIuc2xpY2UoXHJcbiAgICAgICAgICAgIHN0YXJ0LmluZGV4ICsgc3RhcnQubWFya2VyLmxlbmd0aCxcclxuICAgICAgICAgICk7XHJcbiAgICAgICAgICB0aGlzLm1vZGUgPSBzdGFydC5raW5kO1xyXG4gICAgICAgICAgY29udGludWU7XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBpZiAoZmluYWwpIHtcclxuICAgICAgICAgIGV2ZW50cy5wdXNoKHtcclxuICAgICAgICAgICAgdHlwZTogXCJ0ZXh0XCIsXHJcbiAgICAgICAgICAgIHRleHQ6IHRoaXMuYnVmZmVyLFxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICB0aGlzLmJ1ZmZlciA9IFwiXCI7XHJcbiAgICAgICAgICBicmVhaztcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGNvbnN0IGtlZXAgPSBNYXRoLm1pbihcclxuICAgICAgICAgIE1BWF9NQVJLRVJfTEVOR1RIIC0gMSxcclxuICAgICAgICAgIHRoaXMuYnVmZmVyLmxlbmd0aCxcclxuICAgICAgICApO1xyXG4gICAgICAgIGNvbnN0IGVtaXRMZW5ndGggPSB0aGlzLmJ1ZmZlci5sZW5ndGggLSBrZWVwO1xyXG5cclxuICAgICAgICBpZiAoZW1pdExlbmd0aCA+IDApIHtcclxuICAgICAgICAgIGV2ZW50cy5wdXNoKHtcclxuICAgICAgICAgICAgdHlwZTogXCJ0ZXh0XCIsXHJcbiAgICAgICAgICAgIHRleHQ6IHRoaXMuYnVmZmVyLnNsaWNlKDAsIGVtaXRMZW5ndGgpLFxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICB0aGlzLmJ1ZmZlciA9IHRoaXMuYnVmZmVyLnNsaWNlKGVtaXRMZW5ndGgpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBicmVhaztcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgZW5kID0gdGhpcy5idWZmZXIuaW5kZXhPZihFTkRfVEFHKTtcclxuXHJcbiAgICAgIGlmIChlbmQgPCAwKSB7XHJcbiAgICAgICAgaWYgKGZpbmFsKSB7XHJcbiAgICAgICAgICBldmVudHMucHVzaCh7XHJcbiAgICAgICAgICAgIHR5cGU6IFwiZXJyb3JcIixcclxuICAgICAgICAgICAgbWVzc2FnZTogYEluY29tcGxldGUgJHt0aGlzLm1vZGV9IGJsb2NrIHJldHVybmVkIGJ5IHRoZSBhZ2VudC5gLFxyXG4gICAgICAgICAgfSk7XHJcbiAgICAgICAgICB0aGlzLmJ1ZmZlciA9IFwiXCI7XHJcbiAgICAgICAgICB0aGlzLm1vZGUgPSBcInRleHRcIjtcclxuICAgICAgICB9XHJcbiAgICAgICAgYnJlYWs7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGNvbnN0IHJhdyA9IHRoaXMuYnVmZmVyLnNsaWNlKDAsIGVuZCkudHJpbSgpO1xyXG4gICAgICBjb25zdCBibG9ja0tpbmQgPSB0aGlzLm1vZGU7XHJcblxyXG4gICAgICB0aGlzLmJ1ZmZlciA9IHRoaXMuYnVmZmVyLnNsaWNlKGVuZCArIEVORF9UQUcubGVuZ3RoKTtcclxuICAgICAgdGhpcy5tb2RlID0gXCJ0ZXh0XCI7XHJcblxyXG4gICAgICBsZXQgcGFyc2VkOiB1bmtub3duO1xyXG4gICAgICB0cnkge1xyXG4gICAgICAgIHBhcnNlZCA9IEpTT04ucGFyc2UocmF3KTtcclxuICAgICAgfSBjYXRjaCB7XHJcbiAgICAgICAgZXZlbnRzLnB1c2goe1xyXG4gICAgICAgICAgdHlwZTogXCJlcnJvclwiLFxyXG4gICAgICAgICAgbWVzc2FnZTogYENvdWxkIG5vdCBwYXJzZSAke2Jsb2NrS2luZH0gcmV0dXJuZWQgYnkgdGhlIGFnZW50LmAsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChibG9ja0tpbmQgPT09IFwiZWRpdC1wcm9wb3NhbFwiKSB7XHJcbiAgICAgICAgaWYgKCFpc0VkaXRQcm9wb3NhbChwYXJzZWQpKSB7XHJcbiAgICAgICAgICBldmVudHMucHVzaCh7XHJcbiAgICAgICAgICAgIHR5cGU6IFwiZXJyb3JcIixcclxuICAgICAgICAgICAgbWVzc2FnZTogXCJBZ2VudCByZXR1cm5lZCBhbiBpbnZhbGlkIGVkaXQgcHJvcG9zYWwuXCIsXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZXZlbnRzLnB1c2goe1xyXG4gICAgICAgICAgdHlwZTogXCJwcm9wb3NhbFwiLFxyXG4gICAgICAgICAgcHJvcG9zYWw6IHBhcnNlZCxcclxuICAgICAgICB9KTtcclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKGJsb2NrS2luZCA9PT0gXCJsZWFybmluZy1yZXZpZXdcIikge1xyXG4gICAgICAgIGlmICghaXNSZXZpZXdQYXlsb2FkKHBhcnNlZCkpIHtcclxuICAgICAgICAgIGV2ZW50cy5wdXNoKHtcclxuICAgICAgICAgICAgdHlwZTogXCJlcnJvclwiLFxyXG4gICAgICAgICAgICBtZXNzYWdlOiBcIkFnZW50IHJldHVybmVkIGFuIGludmFsaWQgcmV2aWV3IHBheWxvYWQuXCIsXHJcbiAgICAgICAgICB9KTtcclxuICAgICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgZXZlbnRzLnB1c2goe1xyXG4gICAgICAgICAgdHlwZTogXCJyZXZpZXctZmluZGluZ3NcIixcclxuICAgICAgICAgIGZpbmRpbmdzOiBwYXJzZWQuZmluZGluZ3MsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmICghaXNQcmFjdGljZVBheWxvYWQocGFyc2VkKSkge1xyXG4gICAgICAgIGV2ZW50cy5wdXNoKHtcclxuICAgICAgICAgIHR5cGU6IFwiZXJyb3JcIixcclxuICAgICAgICAgIG1lc3NhZ2U6IFwiQWdlbnQgcmV0dXJuZWQgYW4gaW52YWxpZCBwcmFjdGljZSBwYXlsb2FkLlwiLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAocGFyc2VkLmtpbmQgPT09IFwicXVlc3Rpb25cIikge1xyXG4gICAgICAgIGV2ZW50cy5wdXNoKHtcclxuICAgICAgICAgIHR5cGU6IFwicHJhY3RpY2UtcXVlc3Rpb25cIixcclxuICAgICAgICAgIHF1ZXN0aW9uOiBwYXJzZWQsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH0gZWxzZSB7XHJcbiAgICAgICAgZXZlbnRzLnB1c2goe1xyXG4gICAgICAgICAgdHlwZTogXCJwcmFjdGljZS1ldmFsdWF0aW9uXCIsXHJcbiAgICAgICAgICBldmFsdWF0aW9uOiBwYXJzZWQsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICByZXR1cm4gZXZlbnRzO1xyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHtcclxuICBBZ2VudENvbnRleHQsXHJcbiAgQWdlbnRGYWlsdXJlLFxyXG4gIEFnZW50SGVhbHRoLFxyXG4gIEFwcGx5UmVzdWx0LFxyXG4gIEFnZW50TW9kZWwsXHJcbiAgQ2hhdFNlc3Npb24sXHJcbiAgRWRpdFByb3Bvc2FsLFxyXG59IGZyb20gXCIuLi90eXBlc1wiO1xyXG5pbXBvcnQgdHlwZSB7IENvbnRleHRSZXNvbHZlciB9IGZyb20gXCIuLi9jb250ZXh0L0NvbnRleHRSZXNvbHZlclwiO1xyXG5pbXBvcnQge1xyXG4gIEV4cGxpY2l0Q29udGV4dFJlZixcclxuICBMZWFybmluZ0NvbnRleHQsXHJcbiAgVHVybkNvbnRleHRTbmFwc2hvdCxcclxufSBmcm9tIFwiLi4vY29udGV4dC9jb250ZXh0LXR5cGVzXCI7XHJcbmltcG9ydCB0eXBlIHsgUG9saWN5TG9hZGVyIH0gZnJvbSBcIi4uL2NvbnRleHQvUG9saWN5TG9hZGVyXCI7XHJcbmltcG9ydCB0eXBlIHsgTXV0YXRpb25TZXJ2aWNlIH0gZnJvbSBcIi4uL211dGF0aW9uL011dGF0aW9uU2VydmljZVwiO1xyXG5pbXBvcnQgdHlwZSB7IFZhdWx0TGVhcm5pbmdTdG9yZSB9IGZyb20gXCIuLi9wZXJzaXN0ZW5jZS9WYXVsdExlYXJuaW5nU3RvcmVcIjtcclxuaW1wb3J0IHR5cGUgeyBTZXNzaW9uQ29udHJvbGxlciB9IGZyb20gXCIuLi9zZXNzaW9uL1Nlc3Npb25Db250cm9sbGVyXCI7XHJcbmltcG9ydCB7XHJcbiAgYnVpbGRBY3Rpb25JbnN0cnVjdGlvbixcclxuICBidWlsZFByYWN0aWNlRXZhbHVhdGlvbkluc3RydWN0aW9uLFxyXG4gIGJ1aWxkUHJhY3RpY2VRdWVzdGlvbkluc3RydWN0aW9uLFxyXG59IGZyb20gXCIuL2FjdGlvbi1idWlsZGVyc1wiO1xyXG5pbXBvcnQgeyB0b1Byb21wdExlYXJuaW5nU3RhdGUgfSBmcm9tIFwiLi9sZWFybmluZy1zdGF0ZS1wcm9qZWN0aW9uXCI7XHJcbmltcG9ydCB7XHJcbiAgTGVhcm5pbmdFdmVudCxcclxuICBMZWFybmluZ1JlcXVlc3QsXHJcbiAgUHJvcG9zZWRFZGl0LFxyXG59IGZyb20gXCIuL2xlYXJuaW5nLXR5cGVzXCI7XHJcbmltcG9ydCB7IFByYWN0aWNlUXVlc3Rpb24gfSBmcm9tIFwiLi9wcmFjdGljZS10eXBlc1wiO1xyXG5pbXBvcnQge1xyXG4gIFByYWN0aWNlRXZhbHVhdGlvbkF0dGVtcHQsXHJcbiAgUHJhY3RpY2VTdGF0ZU1hY2hpbmUsXHJcbn0gZnJvbSBcIi4vUHJhY3RpY2VTdGF0ZU1hY2hpbmVcIjtcclxuaW1wb3J0IHtcclxuICBTdHJ1Y3R1cmVkU3RyZWFtRXZlbnQsXHJcbiAgU3RydWN0dXJlZFN0cmVhbVBhcnNlcixcclxufSBmcm9tIFwiLi9TdHJ1Y3R1cmVkU3RyZWFtUGFyc2VyXCI7XHJcblxyXG50eXBlIFNlc3Npb25Qb3J0ID0gUGljazxcclxuICBTZXNzaW9uQ29udHJvbGxlcixcclxuICB8IFwiY2hlY2tSdW50aW1lXCJcclxuICB8IFwiZ2V0U2Vzc2lvblwiXHJcbiAgfCBcImdldE1vZGVsc1wiXHJcbiAgfCBcInNldE1vZGVsXCJcclxuICB8IFwibmV3U2Vzc2lvblwiXHJcbiAgfCBcInNlbmRUdXJuXCJcclxuICB8IFwicmVjb3JkQXNzaXN0YW50TWVzc2FnZVwiXHJcbiAgfCBcInJlY29yZFByb3Bvc2FsXCJcclxuICB8IFwidXBkYXRlUHJvcG9zYWxTdGF0ZVwiXHJcbj47XHJcblxyXG50eXBlIENvbnRleHRQb3J0ID0gUGljazxcclxuICBDb250ZXh0UmVzb2x2ZXIsXHJcbiAgXCJyZXNvbHZlXCIgfCBcInNlYXJjaE5vdGVzXCIgfCBcInRvQWdlbnRDb250ZXh0XCJcclxuPjtcclxuXHJcbnR5cGUgUG9saWN5UG9ydCA9IFBpY2s8UG9saWN5TG9hZGVyLCBcImxvYWRcIj47XHJcbnR5cGUgTXV0YXRpb25Qb3J0ID0gUGljazxNdXRhdGlvblNlcnZpY2UsIFwiYXBwbHlcIj47XHJcbnR5cGUgTGVhcm5pbmdTdGF0ZVBvcnQgPSBQaWNrPFxyXG4gIFZhdWx0TGVhcm5pbmdTdG9yZSxcclxuICBcImxvYWRcIiB8IFwicmVjb3JkUHJhY3RpY2VFdmFsdWF0aW9uXCIgfCBcInJlY29yZFJldmlld0ZpbmRpbmdzXCJcclxuPjtcclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgTGVhcm5pbmdDb250cm9sbGVyT3B0aW9ucyB7XHJcbiAgdHVyblRpbWVvdXRNcz86IG51bWJlcjtcclxufVxyXG5cclxuLyoqXHJcbiAqIEFwcGxpY2F0aW9uIGJvdW5kYXJ5IGZvciB0aGUgTGVhcm5pbmcgT1MuXHJcbiAqXHJcbiAqIFRoZSB2aWV3IHNlbmRzIHVzZXIgaW50ZW50IGhlcmUuIFRoaXMgY29udHJvbGxlciBvd25zIG9yY2hlc3RyYXRpb246XHJcbiAqIGNvbnRleHQgLT4gcG9saWN5IC0+IGxlYXJuaW5nIHN0YXRlIC0+IGFjdGlvbiAtPiBhZ2VudCBzZXNzaW9uIC0+IG5vcm1hbGl6ZWRcclxuICogVUkgZXZlbnRzLiBQcm92aWRlciB0cmFuc3BvcnQgc3RheXMgYmVoaW5kIFNlc3Npb25Db250cm9sbGVyL0FnZW50QWRhcHRlci5cclxuICovXHJcbmV4cG9ydCBjbGFzcyBMZWFybmluZ0NvbnRyb2xsZXIge1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgcHJhY3RpY2UgPSBuZXcgUHJhY3RpY2VTdGF0ZU1hY2hpbmUoKTtcclxuICBwcml2YXRlIGFjdGl2ZVR1cm46IHtcclxuICAgIGNvbnRyb2xsZXI6IEFib3J0Q29udHJvbGxlcjtcclxuICAgIGNhbmNlbFJlYXNvbj86IFwidXNlclwiIHwgXCJ0aW1lb3V0XCIgfCBcImRpc3Bvc2VcIjtcclxuICB9IHwgbnVsbCA9IG51bGw7XHJcbiAgcHJpdmF0ZSByZWFkb25seSBwZW5kaW5nUHJvcG9zYWxzID0gbmV3IE1hcDxcclxuICAgIHN0cmluZyxcclxuICAgIHsgcHJvcG9zYWw6IEVkaXRQcm9wb3NhbDsgbXV0YWJsZUZpbGU/OiBzdHJpbmcgfVxyXG4gID4oKTtcclxuICBwcml2YXRlIHJlYWRvbmx5IHR1cm5UaW1lb3V0TXM6IG51bWJlcjtcclxuXHJcbiAgY29uc3RydWN0b3IoXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IHNlc3Npb25zOiBTZXNzaW9uUG9ydCxcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgY29udGV4dHM6IENvbnRleHRQb3J0LFxyXG4gICAgcHJpdmF0ZSByZWFkb25seSBwb2xpY2llczogUG9saWN5UG9ydCxcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgbXV0YXRpb25zOiBNdXRhdGlvblBvcnQsXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IGxlYXJuaW5nU3RhdGU6IExlYXJuaW5nU3RhdGVQb3J0LFxyXG4gICAgb3B0aW9uczogTGVhcm5pbmdDb250cm9sbGVyT3B0aW9ucyA9IHt9LFxyXG4gICkge1xyXG4gICAgdGhpcy50dXJuVGltZW91dE1zID0gb3B0aW9ucy50dXJuVGltZW91dE1zID8/IDYwXzAwMDtcclxuICB9XHJcblxyXG4gIGNoZWNrUnVudGltZSgpOiBQcm9taXNlPEFnZW50SGVhbHRoPiB7XHJcbiAgICByZXR1cm4gdGhpcy5zZXNzaW9ucy5jaGVja1J1bnRpbWUoKTtcclxuICB9XHJcblxyXG4gIGdldFNlc3Npb24oKTogQ2hhdFNlc3Npb24ge1xyXG4gICAgcmV0dXJuIHRoaXMuc2Vzc2lvbnMuZ2V0U2Vzc2lvbigpO1xyXG4gIH1cclxuXHJcbiAgZ2V0TW9kZWxzKCk6IEFnZW50TW9kZWxbXSB7XHJcbiAgICByZXR1cm4gdGhpcy5zZXNzaW9ucy5nZXRNb2RlbHMoKTtcclxuICB9XHJcblxyXG4gIHNldE1vZGVsKG1vZGVsSWQ/OiBzdHJpbmcpOiB2b2lkIHtcclxuICAgIHRoaXMuc2Vzc2lvbnMuc2V0TW9kZWwobW9kZWxJZCk7XHJcbiAgfVxyXG5cclxuICBhc3luYyBuZXdTZXNzaW9uKCk6IFByb21pc2U8Q2hhdFNlc3Npb24+IHtcclxuICAgIHRoaXMucHJhY3RpY2UucmVzZXQoKTtcclxuICAgIHRoaXMucGVuZGluZ1Byb3Bvc2Fscy5jbGVhcigpO1xyXG4gICAgcmV0dXJuIHRoaXMuc2Vzc2lvbnMubmV3U2Vzc2lvbigpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgcmVzb2x2ZUNvbnRleHQoXHJcbiAgICBleHBsaWNpdENvbnRleHQ6IEV4cGxpY2l0Q29udGV4dFJlZltdID0gW10sXHJcbiAgKTogUHJvbWlzZTxMZWFybmluZ0NvbnRleHQ+IHtcclxuICAgIHJldHVybiB0aGlzLmNvbnRleHRzLnJlc29sdmUoZXhwbGljaXRDb250ZXh0KTtcclxuICB9XHJcblxyXG4gIHNlYXJjaE5vdGVzKFxyXG4gICAgcXVlcnk6IHN0cmluZyxcclxuICAgIGxpbWl0ID0gOCxcclxuICApOiBBcnJheTx7IHBhdGg6IHN0cmluZzsgbmFtZTogc3RyaW5nIH0+IHtcclxuICAgIHJldHVybiB0aGlzLmNvbnRleHRzLnNlYXJjaE5vdGVzKHF1ZXJ5LCBsaW1pdCk7XHJcbiAgfVxyXG5cclxuICBhc3luYyAqcnVuKFxyXG4gICAgcmVxdWVzdDogTGVhcm5pbmdSZXF1ZXN0LFxyXG4gICk6IEFzeW5jSXRlcmFibGU8TGVhcm5pbmdFdmVudD4ge1xyXG4gICAgaWYgKHRoaXMuYWN0aXZlVHVybikge1xyXG4gICAgICB5aWVsZCB7XHJcbiAgICAgICAgdHlwZTogXCJmYWlsZWRcIixcclxuICAgICAgICBmYWlsdXJlOiB7XHJcbiAgICAgICAgICBjb2RlOiBcImJ1c3lcIixcclxuICAgICAgICAgIG1lc3NhZ2U6IFwiQW5vdGhlciBOb3ggdHVybiBpcyBzdGlsbCBydW5uaW5nLlwiLFxyXG4gICAgICAgIH0sXHJcbiAgICAgIH07XHJcbiAgICAgIHJldHVybjtcclxuICAgIH1cclxuXHJcbiAgICBsZXQgY29udGV4dDogTGVhcm5pbmdDb250ZXh0O1xyXG4gICAgbGV0IHBvbGljeTogQXdhaXRlZDxSZXR1cm5UeXBlPFBvbGljeVBvcnRbXCJsb2FkXCJdPj47XHJcbiAgICBsZXQgc3RhdGU6IEF3YWl0ZWQ8UmV0dXJuVHlwZTxMZWFybmluZ1N0YXRlUG9ydFtcImxvYWRcIl0+PjtcclxuXHJcbiAgICB0cnkge1xyXG4gICAgICBjb250ZXh0ID0gYXdhaXQgdGhpcy5jb250ZXh0cy5yZXNvbHZlKFxyXG4gICAgICAgIHJlcXVlc3QuZXhwbGljaXRDb250ZXh0LFxyXG4gICAgICApO1xyXG4gICAgICBbcG9saWN5LCBzdGF0ZV0gPSBhd2FpdCBQcm9taXNlLmFsbChbXHJcbiAgICAgICAgdGhpcy5wb2xpY2llcy5sb2FkKCksXHJcbiAgICAgICAgdGhpcy5sZWFybmluZ1N0YXRlLmxvYWQoKSxcclxuICAgICAgXSk7XHJcbiAgICB9IGNhdGNoIChlcnJvcikge1xyXG4gICAgICB5aWVsZCB7XHJcbiAgICAgICAgdHlwZTogXCJmYWlsZWRcIixcclxuICAgICAgICBmYWlsdXJlOiB7XHJcbiAgICAgICAgICBjb2RlOiBcInVua25vd25cIixcclxuICAgICAgICAgIG1lc3NhZ2U6IFwiTm94IGNvdWxkIG5vdCBwcmVwYXJlIHRoaXMgbGVhcm5pbmcgdHVybi5cIixcclxuICAgICAgICAgIGRpYWdub3N0aWM6XHJcbiAgICAgICAgICAgIGVycm9yIGluc3RhbmNlb2YgRXJyb3JcclxuICAgICAgICAgICAgICA/IGVycm9yLm1lc3NhZ2VcclxuICAgICAgICAgICAgICA6IFN0cmluZyhlcnJvciksXHJcbiAgICAgICAgfSxcclxuICAgICAgfTtcclxuICAgICAgcmV0dXJuO1xyXG4gICAgfVxyXG5cclxuICAgIGNvbnN0IHZpc2libGUgPSB0aGlzLmNvbnRleHRzLnRvQWdlbnRDb250ZXh0KGNvbnRleHQpO1xyXG4gICAgY29uc3Qgc3lzdGVtOiBBZ2VudENvbnRleHRbXSA9IFtdO1xyXG5cclxuICAgIGlmIChwb2xpY3kucmF3SW5zdHJ1Y3Rpb25zKSB7XHJcbiAgICAgIGNvbnN0IGFscmVhZHlJbmNsdWRlZCA9IHZpc2libGUuc29tZShcclxuICAgICAgICAoaXRlbSkgPT5cclxuICAgICAgICAgIGl0ZW0udHlwZSA9PT0gXCJub3RlXCIgJiZcclxuICAgICAgICAgIGl0ZW0uZmlsZSA9PT0gcG9saWN5LnBhdGgsXHJcbiAgICAgICk7XHJcblxyXG4gICAgICBpZiAoIWFscmVhZHlJbmNsdWRlZCkge1xyXG4gICAgICAgIHN5c3RlbS5wdXNoKHtcclxuICAgICAgICAgIHR5cGU6IFwibm90ZVwiLFxyXG4gICAgICAgICAgZmlsZTogcG9saWN5LnBhdGgsXHJcbiAgICAgICAgICBjb250ZW50OiBwb2xpY3kucmF3SW5zdHJ1Y3Rpb25zLFxyXG4gICAgICAgIH0pO1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgc3lzdGVtLnB1c2goe1xyXG4gICAgICB0eXBlOiBcIm5vdGVcIixcclxuICAgICAgZmlsZTogXCIwMC1sZWFybmluZy1vcy9wcm9ncmVzcy5qc29uXCIsXHJcbiAgICAgIGNvbnRlbnQ6IEpTT04uc3RyaW5naWZ5KFxyXG4gICAgICAgIHRvUHJvbXB0TGVhcm5pbmdTdGF0ZShzdGF0ZSksXHJcbiAgICAgICAgbnVsbCxcclxuICAgICAgICAyLFxyXG4gICAgICApLFxyXG4gICAgfSk7XHJcblxyXG4gICAgY29uc3QgcmVhZGFibGVGaWxlcyA9IEFycmF5LmZyb20oXHJcbiAgICAgIG5ldyBTZXQoXHJcbiAgICAgICAgdmlzaWJsZVxyXG4gICAgICAgICAgLmZpbHRlcihcclxuICAgICAgICAgICAgKGl0ZW0pID0+XHJcbiAgICAgICAgICAgICAgIWl0ZW0uZmlsZS5zdGFydHNXaXRoKFwiYXR0YWNobWVudC9cIiksXHJcbiAgICAgICAgICApXHJcbiAgICAgICAgICAubWFwKChpdGVtKSA9PiBpdGVtLmZpbGUpLFxyXG4gICAgICApLFxyXG4gICAgKTtcclxuXHJcbiAgICBjb25zdCBtdXRhYmxlRmlsZSA9XHJcbiAgICAgIGNvbnRleHQuc2VsZWN0aW9uPy5maWxlID8/XHJcbiAgICAgIGNvbnRleHQuYWN0aXZlTm90ZT8ucGF0aDtcclxuXHJcbiAgICBjb25zdCBzbmFwc2hvdDogVHVybkNvbnRleHRTbmFwc2hvdCA9IHtcclxuICAgICAgcmVzb2x2ZWQ6IGNvbnRleHQsXHJcbiAgICAgIHZpc2libGUsXHJcbiAgICAgIHN5c3RlbSxcclxuICAgICAgcmVhZGFibGVGaWxlcyxcclxuICAgICAgbXV0YWJsZUZpbGUsXHJcbiAgICB9O1xyXG5cclxuICAgIHlpZWxkIHsgdHlwZTogXCJjb250ZXh0LXJlYWR5XCIsIGNvbnRleHQ6IHNuYXBzaG90IH07XHJcblxyXG4gICAgbGV0IHByZXBhcmVkUHJvbXB0OiBzdHJpbmc7XHJcbiAgICBsZXQgcHJhY3RpY2VBdHRlbXB0OlxyXG4gICAgICB8IFByYWN0aWNlRXZhbHVhdGlvbkF0dGVtcHRcclxuICAgICAgfCB1bmRlZmluZWQ7XHJcblxyXG4gICAgaWYgKHJlcXVlc3QuYWN0aW9uID09PSBcInByYWN0aWNlXCIpIHtcclxuICAgICAgaWYgKHRoaXMucHJhY3RpY2UuaXNXYWl0aW5nRm9yQW5zd2VyKCkpIHtcclxuICAgICAgICBjb25zdCBhdHRlbXB0ID1cclxuICAgICAgICAgIHRoaXMucHJhY3RpY2UuYmVnaW5FdmFsdWF0aW9uKHJlcXVlc3QucHJvbXB0KTtcclxuXHJcbiAgICAgICAgaWYgKCFhdHRlbXB0KSB7XHJcbiAgICAgICAgICB5aWVsZCB7XHJcbiAgICAgICAgICAgIHR5cGU6IFwiZmFpbGVkXCIsXHJcbiAgICAgICAgICAgIGZhaWx1cmU6IHtcclxuICAgICAgICAgICAgICBjb2RlOiBcInVua25vd25cIixcclxuICAgICAgICAgICAgICBtZXNzYWdlOlxyXG4gICAgICAgICAgICAgICAgXCJUaGUgYWN0aXZlIHByYWN0aWNlIHF1ZXN0aW9uIGlzIG5vIGxvbmdlciBhdmFpbGFibGUuXCIsXHJcbiAgICAgICAgICAgIH0sXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgcHJhY3RpY2VBdHRlbXB0ID0gYXR0ZW1wdDtcclxuICAgICAgICBwcmVwYXJlZFByb21wdCA9XHJcbiAgICAgICAgICBidWlsZFByYWN0aWNlRXZhbHVhdGlvbkluc3RydWN0aW9uKHtcclxuICAgICAgICAgICAgcXVlc3Rpb246IGF0dGVtcHQucXVlc3Rpb24sXHJcbiAgICAgICAgICAgIGFuc3dlcjogYXR0ZW1wdC5hbnN3ZXIsXHJcbiAgICAgICAgICAgIGNvbmNlcHQ6IGF0dGVtcHQuY29uY2VwdCxcclxuICAgICAgICAgIH0pO1xyXG4gICAgICB9IGVsc2Uge1xyXG4gICAgICAgIHRoaXMucHJhY3RpY2Uuc3RhcnQoKTtcclxuICAgICAgICBwcmVwYXJlZFByb21wdCA9XHJcbiAgICAgICAgICBidWlsZFByYWN0aWNlUXVlc3Rpb25JbnN0cnVjdGlvbihcclxuICAgICAgICAgICAgcmVxdWVzdC5wcm9tcHQsXHJcbiAgICAgICAgICApO1xyXG4gICAgICB9XHJcbiAgICB9IGVsc2Uge1xyXG4gICAgICB0aGlzLnByYWN0aWNlLnJlc2V0KCk7XHJcbiAgICAgIGNvbnN0IGluc3RydWN0aW9uID1cclxuICAgICAgICBidWlsZEFjdGlvbkluc3RydWN0aW9uKHJlcXVlc3QuYWN0aW9uKTtcclxuICAgICAgcHJlcGFyZWRQcm9tcHQgPVxyXG4gICAgICAgIGAke2luc3RydWN0aW9ufVxcblxcblVzZXIgcmVxdWVzdDpcXG4ke3JlcXVlc3QucHJvbXB0fWA7XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcGFyc2VyID0gbmV3IFN0cnVjdHVyZWRTdHJlYW1QYXJzZXIoKTtcclxuICAgIGNvbnN0IGNvbnRyb2xsZXIgPSBuZXcgQWJvcnRDb250cm9sbGVyKCk7XHJcbiAgICBjb25zdCBhY3RpdmVUdXJuID0geyBjb250cm9sbGVyIH0gYXMge1xyXG4gICAgICBjb250cm9sbGVyOiBBYm9ydENvbnRyb2xsZXI7XHJcbiAgICAgIGNhbmNlbFJlYXNvbj86IFwidXNlclwiIHwgXCJ0aW1lb3V0XCIgfCBcImRpc3Bvc2VcIjtcclxuICAgIH07XHJcbiAgICB0aGlzLmFjdGl2ZVR1cm4gPSBhY3RpdmVUdXJuO1xyXG5cclxuICAgIGNvbnN0IHRpbWVvdXQgPSBzZXRUaW1lb3V0KCgpID0+IHtcclxuICAgICAgYWN0aXZlVHVybi5jYW5jZWxSZWFzb24gPSBcInRpbWVvdXRcIjtcclxuICAgICAgY29udHJvbGxlci5hYm9ydCgpO1xyXG4gICAgfSwgdGhpcy50dXJuVGltZW91dE1zKTtcclxuXHJcbiAgICBsZXQgdmlzaWJsZVRleHQgPSBcIlwiO1xyXG5cclxuICAgIGNvbnN0IHJvbGxiYWNrUHJhY3RpY2UgPSAoKSA9PiB7XHJcbiAgICAgIGlmIChwcmFjdGljZUF0dGVtcHQpIHtcclxuICAgICAgICB0aGlzLnByYWN0aWNlLnJvbGxiYWNrRXZhbHVhdGlvbihcclxuICAgICAgICAgIHByYWN0aWNlQXR0ZW1wdCxcclxuICAgICAgICApO1xyXG4gICAgICB9XHJcbiAgICB9O1xyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIGZvciBhd2FpdCAoY29uc3QgZXZlbnQgb2YgdGhpcy5zZXNzaW9ucy5zZW5kVHVybihcclxuICAgICAgICBwcmVwYXJlZFByb21wdCxcclxuICAgICAgICBbLi4uc25hcHNob3QudmlzaWJsZSwgLi4uc25hcHNob3Quc3lzdGVtXSxcclxuICAgICAgICByZXF1ZXN0LnByb21wdCxcclxuICAgICAgICBjb250cm9sbGVyLnNpZ25hbCxcclxuICAgICAgKSkge1xyXG4gICAgICAgIGlmIChldmVudC50eXBlID09PSBcInRleHRcIikge1xyXG4gICAgICAgICAgZm9yIGF3YWl0IChjb25zdCBtYXBwZWQgb2YgdGhpcy5tYXBTdHJ1Y3R1cmVkRXZlbnRzKFxyXG4gICAgICAgICAgICBwYXJzZXIucHVzaChldmVudC5jb250ZW50KSxcclxuICAgICAgICAgICAgcmVxdWVzdCxcclxuICAgICAgICAgICAgc25hcHNob3QsXHJcbiAgICAgICAgICAgIHByYWN0aWNlQXR0ZW1wdCxcclxuICAgICAgICAgICkpIHtcclxuICAgICAgICAgICAgaWYgKG1hcHBlZC50eXBlID09PSBcInJlc3BvbnNlLWRlbHRhXCIpIHtcclxuICAgICAgICAgICAgICB2aXNpYmxlVGV4dCArPSBtYXBwZWQudGV4dDtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgaWYgKG1hcHBlZC50eXBlID09PSBcIm11dGF0aW9uLXByb3Bvc2VkXCIpIHtcclxuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnNlc3Npb25zLnJlY29yZEFzc2lzdGFudE1lc3NhZ2UoXHJcbiAgICAgICAgICAgICAgICB2aXNpYmxlVGV4dCxcclxuICAgICAgICAgICAgICApO1xyXG4gICAgICAgICAgICAgIHZpc2libGVUZXh0ID0gXCJcIjtcclxuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnNlc3Npb25zLnJlY29yZFByb3Bvc2FsKFxyXG4gICAgICAgICAgICAgICAgbWFwcGVkLmVkaXQuaWQsXHJcbiAgICAgICAgICAgICAgICBtYXBwZWQuZWRpdC5wcm9wb3NhbCxcclxuICAgICAgICAgICAgICApO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICB5aWVsZCBtYXBwZWQ7XHJcbiAgICAgICAgICB9XHJcbiAgICAgICAgICBjb250aW51ZTtcclxuICAgICAgICB9XHJcblxyXG4gICAgICAgIGlmIChldmVudC50eXBlID09PSBcImNvbXBsZXRlZFwiKSB7XHJcbiAgICAgICAgICBmb3IgYXdhaXQgKGNvbnN0IG1hcHBlZCBvZiB0aGlzLm1hcFN0cnVjdHVyZWRFdmVudHMoXHJcbiAgICAgICAgICAgIHBhcnNlci5maW5pc2goKSxcclxuICAgICAgICAgICAgcmVxdWVzdCxcclxuICAgICAgICAgICAgc25hcHNob3QsXHJcbiAgICAgICAgICAgIHByYWN0aWNlQXR0ZW1wdCxcclxuICAgICAgICAgICkpIHtcclxuICAgICAgICAgICAgaWYgKG1hcHBlZC50eXBlID09PSBcInJlc3BvbnNlLWRlbHRhXCIpIHtcclxuICAgICAgICAgICAgICB2aXNpYmxlVGV4dCArPSBtYXBwZWQudGV4dDtcclxuICAgICAgICAgICAgfVxyXG5cclxuICAgICAgICAgICAgaWYgKG1hcHBlZC50eXBlID09PSBcIm11dGF0aW9uLXByb3Bvc2VkXCIpIHtcclxuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnNlc3Npb25zLnJlY29yZEFzc2lzdGFudE1lc3NhZ2UoXHJcbiAgICAgICAgICAgICAgICB2aXNpYmxlVGV4dCxcclxuICAgICAgICAgICAgICApO1xyXG4gICAgICAgICAgICAgIHZpc2libGVUZXh0ID0gXCJcIjtcclxuICAgICAgICAgICAgICBhd2FpdCB0aGlzLnNlc3Npb25zLnJlY29yZFByb3Bvc2FsKFxyXG4gICAgICAgICAgICAgICAgbWFwcGVkLmVkaXQuaWQsXHJcbiAgICAgICAgICAgICAgICBtYXBwZWQuZWRpdC5wcm9wb3NhbCxcclxuICAgICAgICAgICAgICApO1xyXG4gICAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgICB5aWVsZCBtYXBwZWQ7XHJcbiAgICAgICAgICB9XHJcblxyXG4gICAgICAgICAgaWYgKFxyXG4gICAgICAgICAgICBwcmFjdGljZUF0dGVtcHQgJiZcclxuICAgICAgICAgICAgdGhpcy5wcmFjdGljZS5zbmFwc2hvdCgpPy5zdGF0ZSA9PT1cclxuICAgICAgICAgICAgICBcImV2YWx1YXRpbmdcIlxyXG4gICAgICAgICAgKSB7XHJcbiAgICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcclxuICAgICAgICAgICAgICBcIkFnZW50IGNvbXBsZXRlZCB3aXRob3V0IGEgcHJhY3RpY2UgZXZhbHVhdGlvbi5cIixcclxuICAgICAgICAgICAgKTtcclxuICAgICAgICAgIH1cclxuXHJcbiAgICAgICAgICBhd2FpdCB0aGlzLnNlc3Npb25zLnJlY29yZEFzc2lzdGFudE1lc3NhZ2UoXHJcbiAgICAgICAgICAgIHZpc2libGVUZXh0LFxyXG4gICAgICAgICAgKTtcclxuICAgICAgICAgIHlpZWxkIHsgdHlwZTogXCJjb21wbGV0ZWRcIiB9O1xyXG4gICAgICAgICAgcmV0dXJuO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgaWYgKGV2ZW50LnR5cGUgPT09IFwiZmFpbGVkXCIpIHtcclxuICAgICAgICAgIHJvbGxiYWNrUHJhY3RpY2UoKTtcclxuICAgICAgICAgIHlpZWxkIHtcclxuICAgICAgICAgICAgdHlwZTogXCJmYWlsZWRcIixcclxuICAgICAgICAgICAgZmFpbHVyZTogZXZlbnQuZmFpbHVyZSxcclxuICAgICAgICAgIH07XHJcbiAgICAgICAgICByZXR1cm47XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICByb2xsYmFja1ByYWN0aWNlKCk7XHJcblxyXG4gICAgICAgIGlmIChhY3RpdmVUdXJuLmNhbmNlbFJlYXNvbiA9PT0gXCJ0aW1lb3V0XCIpIHtcclxuICAgICAgICAgIGNvbnN0IHNlY29uZHMgPSBNYXRoLm1heChcclxuICAgICAgICAgICAgMSxcclxuICAgICAgICAgICAgTWF0aC5jZWlsKHRoaXMudHVyblRpbWVvdXRNcyAvIDEwMDApLFxyXG4gICAgICAgICAgKTtcclxuICAgICAgICAgIHlpZWxkIHtcclxuICAgICAgICAgICAgdHlwZTogXCJmYWlsZWRcIixcclxuICAgICAgICAgICAgZmFpbHVyZToge1xyXG4gICAgICAgICAgICAgIGNvZGU6IFwidGltZW91dFwiLFxyXG4gICAgICAgICAgICAgIG1lc3NhZ2U6XHJcbiAgICAgICAgICAgICAgICBgTm8gcmVzcG9uc2UgYWZ0ZXIgJHtzZWNvbmRzfSBzZWNvbmRzLiBUaGUgYWdlbnQgcnVudGltZSBtYXkgYmUgYnVzeS5gLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgfTtcclxuICAgICAgICB9IGVsc2Uge1xyXG4gICAgICAgICAgeWllbGQgeyB0eXBlOiBcImNhbmNlbGxlZFwiIH07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIHJldHVybjtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKHByYWN0aWNlQXR0ZW1wdCkge1xyXG4gICAgICAgIHJvbGxiYWNrUHJhY3RpY2UoKTtcclxuICAgICAgfVxyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgcm9sbGJhY2tQcmFjdGljZSgpO1xyXG5cclxuICAgICAgY29uc3QgZmFpbHVyZTogQWdlbnRGYWlsdXJlID0ge1xyXG4gICAgICAgIGNvZGU6IFwicHJvdG9jb2wtaW52YWxpZFwiLFxyXG4gICAgICAgIG1lc3NhZ2U6XHJcbiAgICAgICAgICBcIk5veCBjb3VsZCBub3QgaW50ZXJwcmV0IHRoZSBhZ2VudCByZXNwb25zZS5cIixcclxuICAgICAgICBkaWFnbm9zdGljOlxyXG4gICAgICAgICAgZXJyb3IgaW5zdGFuY2VvZiBFcnJvclxyXG4gICAgICAgICAgICA/IGVycm9yLm1lc3NhZ2VcclxuICAgICAgICAgICAgOiBTdHJpbmcoZXJyb3IpLFxyXG4gICAgICB9O1xyXG5cclxuICAgICAgeWllbGQgeyB0eXBlOiBcImZhaWxlZFwiLCBmYWlsdXJlIH07XHJcbiAgICB9IGZpbmFsbHkge1xyXG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XHJcbiAgICAgIGlmICh0aGlzLmFjdGl2ZVR1cm4gPT09IGFjdGl2ZVR1cm4pIHtcclxuICAgICAgICB0aGlzLmFjdGl2ZVR1cm4gPSBudWxsO1xyXG4gICAgICB9XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBhc3luYyBhcHBseVByb3Bvc2FsKFxyXG4gICAgcHJvcG9zYWxJZDogc3RyaW5nLFxyXG4gICk6IFByb21pc2U8QXBwbHlSZXN1bHQ+IHtcclxuICAgIGNvbnN0IHBlbmRpbmcgPVxyXG4gICAgICB0aGlzLnBlbmRpbmdQcm9wb3NhbHMuZ2V0KHByb3Bvc2FsSWQpO1xyXG5cclxuICAgIGlmICghcGVuZGluZykge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIG9rOiBmYWxzZSxcclxuICAgICAgICByZWFzb246IFwic3RhbGVcIixcclxuICAgICAgICBtZXNzYWdlOlxyXG4gICAgICAgICAgXCJUaGlzIHByb3Bvc2FsIGlzIG5vIGxvbmdlciBhY3RpdmUuIFJlZ2VuZXJhdGUgdGhlIGVkaXQuXCIsXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgcmVzdWx0ID0gYXdhaXQgdGhpcy5tdXRhdGlvbnMuYXBwbHkoXHJcbiAgICAgIHBlbmRpbmcucHJvcG9zYWwsXHJcbiAgICAgIHBlbmRpbmcubXV0YWJsZUZpbGUsXHJcbiAgICApO1xyXG5cclxuICAgIHRoaXMucGVuZGluZ1Byb3Bvc2Fscy5kZWxldGUocHJvcG9zYWxJZCk7XHJcblxyXG4gICAgYXdhaXQgdGhpcy5zZXNzaW9ucy51cGRhdGVQcm9wb3NhbFN0YXRlKFxyXG4gICAgICBwcm9wb3NhbElkLFxyXG4gICAgICByZXN1bHQub2sgPyBcImFwcGxpZWRcIiA6IFwic3RhbGVcIixcclxuICAgICk7XHJcblxyXG4gICAgcmV0dXJuIHJlc3VsdDtcclxuICB9XHJcblxyXG4gIGFzeW5jIHJlamVjdFByb3Bvc2FsKFxyXG4gICAgcHJvcG9zYWxJZDogc3RyaW5nLFxyXG4gICk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgdGhpcy5wZW5kaW5nUHJvcG9zYWxzLmRlbGV0ZShwcm9wb3NhbElkKTtcclxuICAgIGF3YWl0IHRoaXMuc2Vzc2lvbnMudXBkYXRlUHJvcG9zYWxTdGF0ZShcclxuICAgICAgcHJvcG9zYWxJZCxcclxuICAgICAgXCJyZWplY3RlZFwiLFxyXG4gICAgKTtcclxuICB9XHJcblxyXG4gIGNhbmNlbCgpOiB2b2lkIHtcclxuICAgIGlmICghdGhpcy5hY3RpdmVUdXJuKSByZXR1cm47XHJcbiAgICB0aGlzLmFjdGl2ZVR1cm4uY2FuY2VsUmVhc29uID0gXCJ1c2VyXCI7XHJcbiAgICB0aGlzLmFjdGl2ZVR1cm4uY29udHJvbGxlci5hYm9ydCgpO1xyXG4gIH1cclxuXHJcbiAgZGlzcG9zZSgpOiB2b2lkIHtcclxuICAgIGlmICghdGhpcy5hY3RpdmVUdXJuKSByZXR1cm47XHJcbiAgICB0aGlzLmFjdGl2ZVR1cm4uY2FuY2VsUmVhc29uID0gXCJkaXNwb3NlXCI7XHJcbiAgICB0aGlzLmFjdGl2ZVR1cm4uY29udHJvbGxlci5hYm9ydCgpO1xyXG4gIH1cclxuXHJcbiAgcHJpdmF0ZSBhc3luYyAqbWFwU3RydWN0dXJlZEV2ZW50cyhcclxuICAgIGV2ZW50czogU3RydWN0dXJlZFN0cmVhbUV2ZW50W10sXHJcbiAgICByZXF1ZXN0OiBMZWFybmluZ1JlcXVlc3QsXHJcbiAgICBjb250ZXh0OiBUdXJuQ29udGV4dFNuYXBzaG90LFxyXG4gICAgcHJhY3RpY2VBdHRlbXB0PzogUHJhY3RpY2VFdmFsdWF0aW9uQXR0ZW1wdCxcclxuICApOiBBc3luY0l0ZXJhYmxlPExlYXJuaW5nRXZlbnQ+IHtcclxuICAgIGZvciAoY29uc3QgZXZlbnQgb2YgZXZlbnRzKSB7XHJcbiAgICAgIGlmIChldmVudC50eXBlID09PSBcInRleHRcIikge1xyXG4gICAgICAgIGlmIChldmVudC50ZXh0KSB7XHJcbiAgICAgICAgICB5aWVsZCB7XHJcbiAgICAgICAgICAgIHR5cGU6IFwicmVzcG9uc2UtZGVsdGFcIixcclxuICAgICAgICAgICAgdGV4dDogZXZlbnQudGV4dCxcclxuICAgICAgICAgIH07XHJcbiAgICAgICAgfVxyXG4gICAgICAgIGNvbnRpbnVlO1xyXG4gICAgICB9XHJcblxyXG4gICAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJwcm9wb3NhbFwiKSB7XHJcbiAgICAgICAgaWYgKFxyXG4gICAgICAgICAgIWNvbnRleHQubXV0YWJsZUZpbGUgfHxcclxuICAgICAgICAgIGV2ZW50LnByb3Bvc2FsLmZpbGUgIT09XHJcbiAgICAgICAgICAgIGNvbnRleHQubXV0YWJsZUZpbGVcclxuICAgICAgICApIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcclxuICAgICAgICAgICAgYEVkaXQgdGFyZ2V0IGlzIG5vdCB0aGUgYWN0aXZlIG11dGFibGUgbm90ZTogJHtldmVudC5wcm9wb3NhbC5maWxlfWAsXHJcbiAgICAgICAgICApO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgZWRpdDogUHJvcG9zZWRFZGl0ID0ge1xyXG4gICAgICAgICAgaWQ6IGNyeXB0by5yYW5kb21VVUlEKCksXHJcbiAgICAgICAgICBwcm9wb3NhbDogZXZlbnQucHJvcG9zYWwsXHJcbiAgICAgICAgfTtcclxuXHJcbiAgICAgICAgdGhpcy5wZW5kaW5nUHJvcG9zYWxzLnNldChlZGl0LmlkLCB7XHJcbiAgICAgICAgICBwcm9wb3NhbDogZWRpdC5wcm9wb3NhbCxcclxuICAgICAgICAgIG11dGFibGVGaWxlOiBjb250ZXh0Lm11dGFibGVGaWxlLFxyXG4gICAgICAgIH0pO1xyXG5cclxuICAgICAgICB5aWVsZCB7XHJcbiAgICAgICAgICB0eXBlOiBcIm11dGF0aW9uLXByb3Bvc2VkXCIsXHJcbiAgICAgICAgICBlZGl0LFxyXG4gICAgICAgIH07XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChldmVudC50eXBlID09PSBcInByYWN0aWNlLXF1ZXN0aW9uXCIpIHtcclxuICAgICAgICB0aGlzLnByYWN0aWNlLmFjY2VwdFF1ZXN0aW9uKFxyXG4gICAgICAgICAgZXZlbnQucXVlc3Rpb24sXHJcbiAgICAgICAgKTtcclxuXHJcbiAgICAgICAgeWllbGQge1xyXG4gICAgICAgICAgdHlwZTogXCJwcmFjdGljZS1xdWVzdGlvblwiLFxyXG4gICAgICAgICAgcXVlc3Rpb246IGV2ZW50LnF1ZXN0aW9uLFxyXG4gICAgICAgIH07XHJcbiAgICAgICAgY29udGludWU7XHJcbiAgICAgIH1cclxuXHJcbiAgICAgIGlmIChldmVudC50eXBlID09PSBcInJldmlldy1maW5kaW5nc1wiKSB7XHJcbiAgICAgICAgY29uc3Qgc291cmNlID1cclxuICAgICAgICAgIGNvbnRleHQucmVzb2x2ZWQuc2VsZWN0aW9uPy5maWxlID8/XHJcbiAgICAgICAgICBjb250ZXh0LnJlc29sdmVkLmFjdGl2ZU5vdGU/LnBhdGggPz9cclxuICAgICAgICAgIFwibGVhcm5pbmctc2Vzc2lvblwiO1xyXG5cclxuICAgICAgICB5aWVsZCB7XHJcbiAgICAgICAgICB0eXBlOiBcInJldmlldy1maW5kaW5nc1wiLFxyXG4gICAgICAgICAgZmluZGluZ3M6IGV2ZW50LmZpbmRpbmdzLFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGNvbnN0IG5leHRTdGF0ZSA9XHJcbiAgICAgICAgICBhd2FpdCB0aGlzLmxlYXJuaW5nU3RhdGUucmVjb3JkUmV2aWV3RmluZGluZ3MoXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICBmaW5kaW5nczogZXZlbnQuZmluZGluZ3MsXHJcbiAgICAgICAgICAgICAgc291cmNlLFxyXG4gICAgICAgICAgICB9LFxyXG4gICAgICAgICAgKTtcclxuXHJcbiAgICAgICAgaWYgKGV2ZW50LmZpbmRpbmdzLmxlbmd0aCA+IDApIHtcclxuICAgICAgICAgIHlpZWxkIHtcclxuICAgICAgICAgICAgdHlwZTogXCJsZWFybmluZy1zdGF0ZS11cGRhdGVkXCIsXHJcbiAgICAgICAgICAgIHN0YXRlOiBuZXh0U3RhdGUsXHJcbiAgICAgICAgICB9O1xyXG4gICAgICAgIH1cclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKGV2ZW50LnR5cGUgPT09IFwicHJhY3RpY2UtZXZhbHVhdGlvblwiKSB7XHJcbiAgICAgICAgaWYgKCFwcmFjdGljZUF0dGVtcHQpIHtcclxuICAgICAgICAgIHRocm93IG5ldyBFcnJvcihcclxuICAgICAgICAgICAgXCJQcmFjdGljZSBldmFsdWF0aW9uIGFycml2ZWQgd2l0aG91dCBhbiBhY3RpdmUgYW5zd2VyIGF0dGVtcHQuXCIsXHJcbiAgICAgICAgICApO1xyXG4gICAgICAgIH1cclxuXHJcbiAgICAgICAgY29uc3QgbmV4dFF1ZXN0aW9uID1cclxuICAgICAgICAgIHRoaXMucHJhY3RpY2UuY29tbWl0RXZhbHVhdGlvbihcclxuICAgICAgICAgICAgcHJhY3RpY2VBdHRlbXB0LFxyXG4gICAgICAgICAgICBldmVudC5ldmFsdWF0aW9uLFxyXG4gICAgICAgICAgKTtcclxuXHJcbiAgICAgICAgeWllbGQge1xyXG4gICAgICAgICAgdHlwZTogXCJwcmFjdGljZS1ldmFsdWF0aW9uXCIsXHJcbiAgICAgICAgICBldmFsdWF0aW9uOiBldmVudC5ldmFsdWF0aW9uLFxyXG4gICAgICAgIH07XHJcblxyXG4gICAgICAgIGNvbnN0IHNvdXJjZSA9XHJcbiAgICAgICAgICBjb250ZXh0LnJlc29sdmVkLnNlbGVjdGlvbj8uZmlsZSA/P1xyXG4gICAgICAgICAgY29udGV4dC5yZXNvbHZlZC5hY3RpdmVOb3RlPy5wYXRoID8/XHJcbiAgICAgICAgICBcImxlYXJuaW5nLXNlc3Npb25cIjtcclxuXHJcbiAgICAgICAgY29uc3QgbmV4dFN0YXRlID1cclxuICAgICAgICAgIGF3YWl0IHRoaXMubGVhcm5pbmdTdGF0ZS5yZWNvcmRQcmFjdGljZUV2YWx1YXRpb24oXHJcbiAgICAgICAgICAgIHtcclxuICAgICAgICAgICAgICBldmFsdWF0aW9uOiBldmVudC5ldmFsdWF0aW9uLFxyXG4gICAgICAgICAgICAgIHNvdXJjZSxcclxuICAgICAgICAgICAgfSxcclxuICAgICAgICAgICk7XHJcblxyXG4gICAgICAgIHlpZWxkIHtcclxuICAgICAgICAgIHR5cGU6IFwibGVhcm5pbmctc3RhdGUtdXBkYXRlZFwiLFxyXG4gICAgICAgICAgc3RhdGU6IG5leHRTdGF0ZSxcclxuICAgICAgICB9O1xyXG5cclxuICAgICAgICBpZiAobmV4dFF1ZXN0aW9uKSB7XHJcbiAgICAgICAgICB5aWVsZCB7XHJcbiAgICAgICAgICAgIHR5cGU6IFwicHJhY3RpY2UtcXVlc3Rpb25cIixcclxuICAgICAgICAgICAgcXVlc3Rpb246IG5leHRRdWVzdGlvbixcclxuICAgICAgICAgIH07XHJcbiAgICAgICAgfVxyXG5cclxuICAgICAgICBjb250aW51ZTtcclxuICAgICAgfVxyXG5cclxuICAgICAgdGhyb3cgbmV3IEVycm9yKGV2ZW50Lm1lc3NhZ2UpO1xyXG4gICAgfVxyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgQXBwLCBNYXJrZG93blZpZXcsIFRGaWxlIH0gZnJvbSBcIm9ic2lkaWFuXCI7XHJcbmltcG9ydCB7IEFwcGx5UmVzdWx0LCBFZGl0UHJvcG9zYWwgfSBmcm9tIFwiLi4vdHlwZXNcIjtcclxuaW1wb3J0IHsgcGxhblJlcGxhY2VtZW50IH0gZnJvbSBcIi4vcmVwbGFjZW1lbnRcIjtcclxuXHJcbi8qKlxyXG4gKiBPd25zIHVzZXItYXBwcm92ZWQgTWFya2Rvd24gbXV0YXRpb25zLlxyXG4gKlxyXG4gKiBOb3ggdjEgb25seSBtdXRhdGVzIHRoZSBhY3RpdmUgdHVybidzIHByaW1hcnkgTWFya2Rvd24gbm90ZSB0aHJvdWdoIGFuXHJcbiAqIG9wZW4gT2JzaWRpYW4gZWRpdG9yLiBTdXBwb3J0aW5nIG5vdGVzIHJlbWFpbiByZWFkLW9ubHkgY29udGV4dCBzbyBBcHBseVxyXG4gKiBhbHdheXMgcGFydGljaXBhdGVzIGluIG5hdGl2ZSBlZGl0b3IgaGlzdG9yeSBhbmQgQ3RybC9DbWQrWiByZW1haW5zIHZhbGlkLlxyXG4gKi9cclxuZXhwb3J0IGNsYXNzIE11dGF0aW9uU2VydmljZSB7XHJcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBhcHA6IEFwcCkge31cclxuXHJcbiAgYXN5bmMgYXBwbHkoXHJcbiAgICBwcm9wb3NhbDogRWRpdFByb3Bvc2FsLFxyXG4gICAgbXV0YWJsZUZpbGU/OiBzdHJpbmcsXHJcbiAgKTogUHJvbWlzZTxBcHBseVJlc3VsdD4ge1xyXG4gICAgaWYgKCFtdXRhYmxlRmlsZSB8fCBwcm9wb3NhbC5maWxlICE9PSBtdXRhYmxlRmlsZSkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIG9rOiBmYWxzZSxcclxuICAgICAgICByZWFzb246IFwidW5hdXRob3JpemVkXCIsXHJcbiAgICAgICAgbWVzc2FnZTpcclxuICAgICAgICAgIFwiTm94IGNhbiBvbmx5IGVkaXQgdGhlIHByaW1hcnkgbm90ZSB1c2VkIGZvciB0aGlzIHR1cm4uXCIsXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgY29uc3QgZmlsZSA9IHRoaXMuYXBwLnZhdWx0LmdldEZpbGVCeVBhdGgocHJvcG9zYWwuZmlsZSk7XHJcblxyXG4gICAgaWYgKCFmaWxlIHx8ICEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xyXG4gICAgICByZXR1cm4ge1xyXG4gICAgICAgIG9rOiBmYWxzZSxcclxuICAgICAgICByZWFzb246IFwibWlzc2luZy1maWxlXCIsXHJcbiAgICAgICAgbWVzc2FnZTogYFRhcmdldCBub3RlIG5vdCBmb3VuZDogJHtwcm9wb3NhbC5maWxlfWAsXHJcbiAgICAgIH07XHJcbiAgICB9XHJcblxyXG4gICAgdHJ5IHtcclxuICAgICAgY29uc3QgdGFyZ2V0VmlldyA9IHRoaXMuZmluZE9wZW5NYXJrZG93blZpZXcoZmlsZS5wYXRoKTtcclxuXHJcbiAgICAgIGlmICghdGFyZ2V0Vmlldykge1xyXG4gICAgICAgIHJldHVybiB7XHJcbiAgICAgICAgICBvazogZmFsc2UsXHJcbiAgICAgICAgICByZWFzb246IFwibm8tZWRpdG9yXCIsXHJcbiAgICAgICAgICBtZXNzYWdlOlxyXG4gICAgICAgICAgICBcIk9wZW4gdGhlIHRhcmdldCBub3RlIGluIGFuIGVkaXRvciBiZWZvcmUgYXBwbHlpbmcgdGhpcyBjaGFuZ2UuXCIsXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgY29uc3QgZWRpdG9yID0gdGFyZ2V0Vmlldy5lZGl0b3I7XHJcbiAgICAgIGNvbnN0IGNvbnRlbnQgPSBlZGl0b3IuZ2V0VmFsdWUoKTtcclxuICAgICAgY29uc3QgcGxhbiA9IHBsYW5SZXBsYWNlbWVudChcclxuICAgICAgICBjb250ZW50LFxyXG4gICAgICAgIHByb3Bvc2FsLm9yaWdpbmFsLFxyXG4gICAgICAgIHByb3Bvc2FsLnJlcGxhY2VtZW50LFxyXG4gICAgICApO1xyXG5cclxuICAgICAgaWYgKCFwbGFuLm9rICYmIHBsYW4ucmVhc29uID09PSBcInN0YWxlXCIpIHtcclxuICAgICAgICByZXR1cm4ge1xyXG4gICAgICAgICAgb2s6IGZhbHNlLFxyXG4gICAgICAgICAgcmVhc29uOiBcInN0YWxlXCIsXHJcbiAgICAgICAgICBtZXNzYWdlOlxyXG4gICAgICAgICAgICBcIk5vdGUgY2hhbmdlZCBzaW5jZSB0aGUgcHJvcG9zYWwgd2FzIG1hZGUuIFJlZ2VuZXJhdGUgdGhlIGVkaXQuXCIsXHJcbiAgICAgICAgfTtcclxuICAgICAgfVxyXG5cclxuICAgICAgaWYgKCFwbGFuLm9rKSB7XHJcbiAgICAgICAgcmV0dXJuIHtcclxuICAgICAgICAgIG9rOiBmYWxzZSxcclxuICAgICAgICAgIHJlYXNvbjogXCJhbWJpZ3VvdXNcIixcclxuICAgICAgICAgIG1lc3NhZ2U6XHJcbiAgICAgICAgICAgIFwiVGhlIG9yaWdpbmFsIHRleHQgb2NjdXJzIG1vcmUgdGhhbiBvbmNlLiBSZWdlbmVyYXRlIHdpdGggYSBtb3JlIHNwZWNpZmljIHNlbGVjdGlvbi5cIixcclxuICAgICAgICB9O1xyXG4gICAgICB9XHJcblxyXG4gICAgICBjb25zdCBmcm9tID0gZWRpdG9yLm9mZnNldFRvUG9zKHBsYW4uaW5kZXgpO1xyXG4gICAgICBjb25zdCB0byA9IGVkaXRvci5vZmZzZXRUb1BvcyhcclxuICAgICAgICBwbGFuLmluZGV4ICsgcHJvcG9zYWwub3JpZ2luYWwubGVuZ3RoLFxyXG4gICAgICApO1xyXG5cclxuICAgICAgZWRpdG9yLnJlcGxhY2VSYW5nZShwcm9wb3NhbC5yZXBsYWNlbWVudCwgZnJvbSwgdG8pO1xyXG4gICAgICByZXR1cm4geyBvazogdHJ1ZSB9O1xyXG4gICAgfSBjYXRjaCAoZXJyb3IpIHtcclxuICAgICAgcmV0dXJuIHtcclxuICAgICAgICBvazogZmFsc2UsXHJcbiAgICAgICAgcmVhc29uOiBcImVycm9yXCIsXHJcbiAgICAgICAgbWVzc2FnZTpcclxuICAgICAgICAgIGVycm9yIGluc3RhbmNlb2YgRXJyb3JcclxuICAgICAgICAgICAgPyBlcnJvci5tZXNzYWdlXHJcbiAgICAgICAgICAgIDogU3RyaW5nKGVycm9yKSxcclxuICAgICAgfTtcclxuICAgIH1cclxuICB9XHJcblxyXG4gIHByaXZhdGUgZmluZE9wZW5NYXJrZG93blZpZXcoXHJcbiAgICBwYXRoOiBzdHJpbmcsXHJcbiAgKTogTWFya2Rvd25WaWV3IHwgbnVsbCB7XHJcbiAgICBmb3IgKGNvbnN0IGxlYWYgb2YgdGhpcy5hcHAud29ya3NwYWNlLmdldExlYXZlc09mVHlwZShcIm1hcmtkb3duXCIpKSB7XHJcbiAgICAgIGlmIChcclxuICAgICAgICBsZWFmLnZpZXcgaW5zdGFuY2VvZiBNYXJrZG93blZpZXcgJiZcclxuICAgICAgICBsZWFmLnZpZXcuZmlsZT8ucGF0aCA9PT0gcGF0aFxyXG4gICAgICApIHtcclxuICAgICAgICByZXR1cm4gbGVhZi52aWV3O1xyXG4gICAgICB9XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIG51bGw7XHJcbiAgfVxyXG59XHJcbiIsICJleHBvcnQgdHlwZSBSZXBsYWNlbWVudFBsYW4gPVxyXG4gIHwge1xyXG4gICAgICBvazogdHJ1ZTtcclxuICAgICAgaW5kZXg6IG51bWJlcjtcclxuICAgICAgbmV4dDogc3RyaW5nO1xyXG4gICAgfVxyXG4gIHwge1xyXG4gICAgICBvazogZmFsc2U7XHJcbiAgICAgIHJlYXNvbjogXCJzdGFsZVwiIHwgXCJhbWJpZ3VvdXNcIjtcclxuICAgIH07XHJcblxyXG5mdW5jdGlvbiBmaW5kT2NjdXJyZW5jZXMoY29udGVudDogc3RyaW5nLCBuZWVkbGU6IHN0cmluZyk6IG51bWJlcltdIHtcclxuICBpZiAoIW5lZWRsZSkgcmV0dXJuIFtdO1xyXG5cclxuICBjb25zdCBtYXRjaGVzOiBudW1iZXJbXSA9IFtdO1xyXG4gIGxldCBjdXJzb3IgPSAwO1xyXG5cclxuICB3aGlsZSAoY3Vyc29yIDw9IGNvbnRlbnQubGVuZ3RoIC0gbmVlZGxlLmxlbmd0aCkge1xyXG4gICAgY29uc3QgaW5kZXggPSBjb250ZW50LmluZGV4T2YobmVlZGxlLCBjdXJzb3IpO1xyXG4gICAgaWYgKGluZGV4ID09PSAtMSkgYnJlYWs7XHJcblxyXG4gICAgbWF0Y2hlcy5wdXNoKGluZGV4KTtcclxuICAgIGN1cnNvciA9IGluZGV4ICsgbmVlZGxlLmxlbmd0aDtcclxuICB9XHJcblxyXG4gIHJldHVybiBtYXRjaGVzO1xyXG59XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gcGxhblJlcGxhY2VtZW50KFxyXG4gIGNvbnRlbnQ6IHN0cmluZyxcclxuICBvcmlnaW5hbDogc3RyaW5nLFxyXG4gIHJlcGxhY2VtZW50OiBzdHJpbmcsXHJcbik6IFJlcGxhY2VtZW50UGxhbiB7XHJcbiAgY29uc3QgbWF0Y2hlcyA9IGZpbmRPY2N1cnJlbmNlcyhjb250ZW50LCBvcmlnaW5hbCk7XHJcblxyXG4gIGlmIChtYXRjaGVzLmxlbmd0aCA9PT0gMCkge1xyXG4gICAgcmV0dXJuIHsgb2s6IGZhbHNlLCByZWFzb246IFwic3RhbGVcIiB9O1xyXG4gIH1cclxuXHJcbiAgaWYgKG1hdGNoZXMubGVuZ3RoID4gMSkge1xyXG4gICAgcmV0dXJuIHsgb2s6IGZhbHNlLCByZWFzb246IFwiYW1iaWd1b3VzXCIgfTtcclxuICB9XHJcblxyXG4gIGNvbnN0IGluZGV4ID0gbWF0Y2hlc1swXTtcclxuICByZXR1cm4ge1xyXG4gICAgb2s6IHRydWUsXHJcbiAgICBpbmRleCxcclxuICAgIG5leHQ6XHJcbiAgICAgIGNvbnRlbnQuc2xpY2UoMCwgaW5kZXgpICtcclxuICAgICAgcmVwbGFjZW1lbnQgK1xyXG4gICAgICBjb250ZW50LnNsaWNlKGluZGV4ICsgb3JpZ2luYWwubGVuZ3RoKSxcclxuICB9O1xyXG59XHJcbiIsICJpbXBvcnQgeyBBcHAsIFRGaWxlIH0gZnJvbSBcIm9ic2lkaWFuXCI7XHJcbmltcG9ydCB7XHJcbiAgREVGQVVMVF9MRUFSTklOR19TVEFURSxcclxuICBMZWFybmluZ0V2aWRlbmNlLFxyXG4gIExlYXJuaW5nU3RhdGUsXHJcbn0gZnJvbSBcIi4uL2xlYXJuaW5nL2xlYXJuaW5nLXN0YXRlXCI7XHJcbmltcG9ydCB7IFByYWN0aWNlRXZhbHVhdGlvbiB9IGZyb20gXCIuLi9sZWFybmluZy9wcmFjdGljZS10eXBlc1wiO1xyXG5pbXBvcnQgeyBSZXZpZXdGaW5kaW5nIH0gZnJvbSBcIi4uL2xlYXJuaW5nL3Jldmlldy10eXBlc1wiO1xyXG5pbXBvcnQgeyBkZWNvZGVMZWFybmluZ1N0YXRlIH0gZnJvbSBcIi4vbGVhcm5pbmctc3RhdGUtc2NoZW1hXCI7XHJcblxyXG5jb25zdCBST09UID0gXCIwMC1sZWFybmluZy1vc1wiO1xyXG5jb25zdCBQUk9HUkVTU19QQVRIID0gYCR7Uk9PVH0vcHJvZ3Jlc3MuanNvbmA7XHJcblxyXG5mdW5jdGlvbiBjbG9uZURlZmF1bHRTdGF0ZSgpOiBMZWFybmluZ1N0YXRlIHtcclxuICByZXR1cm4ge1xyXG4gICAgLi4uREVGQVVMVF9MRUFSTklOR19TVEFURSxcclxuICAgIGdhcHM6IFtdLFxyXG4gICAgZXZpZGVuY2U6IFtdLFxyXG4gIH07XHJcbn1cclxuXHJcbmZ1bmN0aW9uIG5vcm1hbGl6ZSh2YWx1ZTogc3RyaW5nKTogc3RyaW5nIHtcclxuICByZXR1cm4gdmFsdWUudHJpbSgpLnRvTG93ZXJDYXNlKCk7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBEdXJhYmxlIExlYXJuaW5nIE9TIHN0YXRlIHN0b3JlZCBpbnNpZGUgdGhlIHZhdWx0IHNvIHByb2dyZXNzIHRyYXZlbHMgd2l0aFxyXG4gKiB0aGUgdmF1bHQgaW5zdGVhZCBvZiBiZWluZyB0cmFwcGVkIGluIE9ic2lkaWFuIHBsdWdpbiBkYXRhLlxyXG4gKi9cclxuZXhwb3J0IGNsYXNzIFZhdWx0TGVhcm5pbmdTdG9yZSB7XHJcbiAgY29uc3RydWN0b3IocHJpdmF0ZSByZWFkb25seSBhcHA6IEFwcCkge31cclxuXHJcbiAgYXN5bmMgbG9hZCgpOiBQcm9taXNlPExlYXJuaW5nU3RhdGU+IHtcclxuICAgIGNvbnN0IGZpbGUgPSB0aGlzLmFwcC52YXVsdC5nZXRGaWxlQnlQYXRoKFBST0dSRVNTX1BBVEgpO1xyXG4gICAgaWYgKCFmaWxlIHx8ICEoZmlsZSBpbnN0YW5jZW9mIFRGaWxlKSkge1xyXG4gICAgICByZXR1cm4gY2xvbmVEZWZhdWx0U3RhdGUoKTtcclxuICAgIH1cclxuXHJcbiAgICBjb25zdCByYXcgPSBhd2FpdCB0aGlzLmFwcC52YXVsdC5jYWNoZWRSZWFkKGZpbGUpO1xyXG5cclxuICAgIGxldCBwYXJzZWQ6IHVua25vd247XHJcbiAgICB0cnkge1xyXG4gICAgICBwYXJzZWQgPSBKU09OLnBhcnNlKHJhdyk7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICAgIGBMZWFybmluZyBzdGF0ZSBpcyBpbnZhbGlkIEpTT046ICR7UFJPR1JFU1NfUEFUSH1gLFxyXG4gICAgICApO1xyXG4gICAgfVxyXG5cclxuICAgIHRyeSB7XHJcbiAgICAgIHJldHVybiBkZWNvZGVMZWFybmluZ1N0YXRlKHBhcnNlZCk7XHJcbiAgICB9IGNhdGNoIHtcclxuICAgICAgdGhyb3cgbmV3IEVycm9yKFxyXG4gICAgICAgIGBMZWFybmluZyBzdGF0ZSBoYXMgYW4gdW5zdXBwb3J0ZWQgc2hhcGU6ICR7UFJPR1JFU1NfUEFUSH1gLFxyXG4gICAgICApO1xyXG4gICAgfVxyXG4gIH1cclxuXHJcbiAgYXN5bmMgc2F2ZShzdGF0ZTogTGVhcm5pbmdTdGF0ZSk6IFByb21pc2U8dm9pZD4ge1xyXG4gICAgYXdhaXQgdGhpcy5lbnN1cmVSb290KCk7XHJcblxyXG4gICAgY29uc3QgY29udGVudCA9IEpTT04uc3RyaW5naWZ5KHN0YXRlLCBudWxsLCAyKSArIFwiXFxuXCI7XHJcbiAgICBjb25zdCBmaWxlID0gdGhpcy5hcHAudmF1bHQuZ2V0RmlsZUJ5UGF0aChQUk9HUkVTU19QQVRIKTtcclxuXHJcbiAgICBpZiAoZmlsZSAmJiBmaWxlIGluc3RhbmNlb2YgVEZpbGUpIHtcclxuICAgICAgYXdhaXQgdGhpcy5hcHAudmF1bHQubW9kaWZ5KGZpbGUsIGNvbnRlbnQpO1xyXG4gICAgICByZXR1cm47XHJcbiAgICB9XHJcblxyXG4gICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlKFBST0dSRVNTX1BBVEgsIGNvbnRlbnQpO1xyXG4gIH1cclxuXHJcbiAgYXN5bmMgcmVjb3JkUHJhY3RpY2VFdmFsdWF0aW9uKGlucHV0OiB7XHJcbiAgICBldmFsdWF0aW9uOiBQcmFjdGljZUV2YWx1YXRpb247XHJcbiAgICBzb3VyY2U6IHN0cmluZztcclxuICB9KTogUHJvbWlzZTxMZWFybmluZ1N0YXRlPiB7XHJcbiAgICBjb25zdCBzdGF0ZSA9IGF3YWl0IHRoaXMubG9hZCgpO1xyXG5cclxuICAgIGNvbnN0IGV2aWRlbmNlOiBMZWFybmluZ0V2aWRlbmNlID0ge1xyXG4gICAgICBpZDogY3J5cHRvLnJhbmRvbVVVSUQoKSxcclxuICAgICAgdHlwZTogXCJwcmFjdGljZVwiLFxyXG4gICAgICBzY29wZTogXCJsZWFybmVyXCIsXHJcbiAgICAgIGNvbmNlcHQ6IGlucHV0LmV2YWx1YXRpb24uY29uY2VwdCxcclxuICAgICAgc291cmNlOiBpbnB1dC5zb3VyY2UsXHJcbiAgICAgIG91dGNvbWU6IGlucHV0LmV2YWx1YXRpb24ub3V0Y29tZSxcclxuICAgICAgY3JlYXRlZEF0OiBEYXRlLm5vdygpLFxyXG4gICAgfTtcclxuXHJcbiAgICBzdGF0ZS5ldmlkZW5jZS5wdXNoKGV2aWRlbmNlKTtcclxuICAgIHN0YXRlLmN1cnJlbnRUb3BpYyA9IGlucHV0LmV2YWx1YXRpb24uY29uY2VwdDtcclxuXHJcbiAgICBmb3IgKGNvbnN0IG1pc2NvbmNlcHRpb24gb2YgaW5wdXQuZXZhbHVhdGlvbi5taXNjb25jZXB0aW9ucykge1xyXG4gICAgICBjb25zdCBleGlzdGluZyA9IHN0YXRlLmdhcHMuZmluZChcclxuICAgICAgICAoZ2FwKSA9PlxyXG4gICAgICAgICAgbm9ybWFsaXplKGdhcC5jb25jZXB0KSA9PT1cclxuICAgICAgICAgICAgbm9ybWFsaXplKGlucHV0LmV2YWx1YXRpb24uY29uY2VwdCkgJiZcclxuICAgICAgICAgIG5vcm1hbGl6ZShnYXAucmVhc29uKSA9PT0gbm9ybWFsaXplKG1pc2NvbmNlcHRpb24pLFxyXG4gICAgICApO1xyXG5cclxuICAgICAgaWYgKGV4aXN0aW5nKSB7XHJcbiAgICAgICAgaWYgKCFleGlzdGluZy5ldmlkZW5jZUlkcy5pbmNsdWRlcyhldmlkZW5jZS5pZCkpIHtcclxuICAgICAgICAgIGV4aXN0aW5nLmV2aWRlbmNlSWRzLnB1c2goZXZpZGVuY2UuaWQpO1xyXG4gICAgICAgIH1cclxuICAgICAgICBleGlzdGluZy5zdGF0dXMgPSBcIm9wZW5cIjtcclxuICAgICAgfSBlbHNlIHtcclxuICAgICAgICBzdGF0ZS5nYXBzLnB1c2goe1xyXG4gICAgICAgICAgaWQ6IGNyeXB0by5yYW5kb21VVUlEKCksXHJcbiAgICAgICAgICBjb25jZXB0OiBpbnB1dC5ldmFsdWF0aW9uLmNvbmNlcHQsXHJcbiAgICAgICAgICByZWFzb246IG1pc2NvbmNlcHRpb24sXHJcbiAgICAgICAgICBldmlkZW5jZUlkczogW2V2aWRlbmNlLmlkXSxcclxuICAgICAgICAgIHN0YXR1czogXCJvcGVuXCIsXHJcbiAgICAgICAgfSk7XHJcbiAgICAgIH1cclxuICAgIH1cclxuXHJcbiAgICBpZiAoXHJcbiAgICAgIGlucHV0LmV2YWx1YXRpb24ub3V0Y29tZSA9PT0gXCJjb3JyZWN0XCIgJiZcclxuICAgICAgaW5wdXQuZXZhbHVhdGlvbi5taXNjb25jZXB0aW9ucy5sZW5ndGggPT09IDBcclxuICAgICkge1xyXG4gICAgICBmb3IgKGNvbnN0IGdhcCBvZiBzdGF0ZS5nYXBzKSB7XHJcbiAgICAgICAgaWYgKFxyXG4gICAgICAgICAgbm9ybWFsaXplKGdhcC5jb25jZXB0KSA9PT1cclxuICAgICAgICAgICAgbm9ybWFsaXplKGlucHV0LmV2YWx1YXRpb24uY29uY2VwdCkgJiZcclxuICAgICAgICAgIGdhcC5zdGF0dXMgPT09IFwib3BlblwiXHJcbiAgICAgICAgKSB7XHJcbiAgICAgICAgICAvLyBPbmUgZ29vZCBhbnN3ZXIgaXMgZXZpZGVuY2Ugb2YgaW1wcm92ZW1lbnQsIG5vdCBwcm9vZiBvZiBtYXN0ZXJ5LlxyXG4gICAgICAgICAgZ2FwLnN0YXR1cyA9IFwiaW1wcm92aW5nXCI7XHJcbiAgICAgICAgICBpZiAoIWdhcC5ldmlkZW5jZUlkcy5pbmNsdWRlcyhldmlkZW5jZS5pZCkpIHtcclxuICAgICAgICAgICAgZ2FwLmV2aWRlbmNlSWRzLnB1c2goZXZpZGVuY2UuaWQpO1xyXG4gICAgICAgICAgfVxyXG4gICAgICAgIH1cclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIGF3YWl0IHRoaXMuc2F2ZShzdGF0ZSk7XHJcbiAgICByZXR1cm4gc3RhdGU7XHJcbiAgfVxyXG5cclxuICBhc3luYyByZWNvcmRSZXZpZXdGaW5kaW5ncyhpbnB1dDoge1xyXG4gICAgZmluZGluZ3M6IFJldmlld0ZpbmRpbmdbXTtcclxuICAgIHNvdXJjZTogc3RyaW5nO1xyXG4gIH0pOiBQcm9taXNlPExlYXJuaW5nU3RhdGU+IHtcclxuICAgIGNvbnN0IHN0YXRlID0gYXdhaXQgdGhpcy5sb2FkKCk7XHJcbiAgICBpZiAoaW5wdXQuZmluZGluZ3MubGVuZ3RoID09PSAwKSByZXR1cm4gc3RhdGU7XHJcblxyXG4gICAgZm9yIChjb25zdCBmaW5kaW5nIG9mIGlucHV0LmZpbmRpbmdzKSB7XHJcbiAgICAgIGNvbnN0IGV2aWRlbmNlOiBMZWFybmluZ0V2aWRlbmNlID0ge1xyXG4gICAgICAgIGlkOiBjcnlwdG8ucmFuZG9tVVVJRCgpLFxyXG4gICAgICAgIHR5cGU6IFwicmV2aWV3XCIsXHJcbiAgICAgICAgc2NvcGU6IFwibWF0ZXJpYWxcIixcclxuICAgICAgICBjb25jZXB0OiBmaW5kaW5nLmNvbmNlcHQsXHJcbiAgICAgICAgc291cmNlOiBpbnB1dC5zb3VyY2UsXHJcbiAgICAgICAgb3V0Y29tZTogZmluZGluZy5raW5kLFxyXG4gICAgICAgIGNyZWF0ZWRBdDogRGF0ZS5ub3coKSxcclxuICAgICAgfTtcclxuXHJcbiAgICAgIHN0YXRlLmV2aWRlbmNlLnB1c2goZXZpZGVuY2UpO1xyXG4gICAgICBzdGF0ZS5jdXJyZW50VG9waWMgPSBmaW5kaW5nLmNvbmNlcHQ7XHJcbiAgICB9XHJcblxyXG4gICAgYXdhaXQgdGhpcy5zYXZlKHN0YXRlKTtcclxuICAgIHJldHVybiBzdGF0ZTtcclxuICB9XHJcblxyXG4gIHByaXZhdGUgYXN5bmMgZW5zdXJlUm9vdCgpOiBQcm9taXNlPHZvaWQ+IHtcclxuICAgIGNvbnN0IGV4aXN0aW5nID1cclxuICAgICAgdGhpcy5hcHAudmF1bHQuZ2V0QWJzdHJhY3RGaWxlQnlQYXRoKFJPT1QpO1xyXG4gICAgaWYgKGV4aXN0aW5nKSByZXR1cm47XHJcblxyXG4gICAgYXdhaXQgdGhpcy5hcHAudmF1bHQuY3JlYXRlRm9sZGVyKFJPT1QpO1xyXG4gIH1cclxufVxyXG4iLCAiZXhwb3J0IGludGVyZmFjZSBLbm93bGVkZ2VHYXAge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgY29uY2VwdDogc3RyaW5nO1xyXG4gIHJlYXNvbjogc3RyaW5nO1xyXG4gIGV2aWRlbmNlSWRzOiBzdHJpbmdbXTtcclxuICBzdGF0dXM6IFwib3BlblwiIHwgXCJpbXByb3ZpbmdcIiB8IFwicmVzb2x2ZWRcIjtcclxufVxyXG5cclxuZXhwb3J0IGludGVyZmFjZSBMZWFybmluZ0V2aWRlbmNlIHtcclxuICBpZDogc3RyaW5nO1xyXG4gIHR5cGU6IFwicHJhY3RpY2VcIiB8IFwicmV2aWV3XCIgfCBcInByb2plY3RcIjtcclxuICBzY29wZTogXCJsZWFybmVyXCIgfCBcIm1hdGVyaWFsXCI7XHJcbiAgY29uY2VwdDogc3RyaW5nO1xyXG4gIHNvdXJjZTogc3RyaW5nO1xyXG4gIG91dGNvbWU/OiBzdHJpbmc7XHJcbiAgY3JlYXRlZEF0OiBudW1iZXI7XHJcbn1cclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgTGVhcm5pbmdTdGF0ZSB7XHJcbiAgdmVyc2lvbjogMjtcclxuICB0YXJnZXQ6IHN0cmluZyB8IG51bGw7XHJcbiAgY3VycmVudFRvcGljPzogc3RyaW5nO1xyXG4gIGdhcHM6IEtub3dsZWRnZUdhcFtdO1xyXG4gIGV2aWRlbmNlOiBMZWFybmluZ0V2aWRlbmNlW107XHJcbn1cclxuXHJcbmV4cG9ydCBjb25zdCBERUZBVUxUX0xFQVJOSU5HX1NUQVRFOiBMZWFybmluZ1N0YXRlID0ge1xyXG4gIHZlcnNpb246IDIsXHJcbiAgdGFyZ2V0OiBudWxsLFxyXG4gIGdhcHM6IFtdLFxyXG4gIGV2aWRlbmNlOiBbXSxcclxufTtcclxuIiwgImltcG9ydCB7XHJcbiAgS25vd2xlZGdlR2FwLFxyXG4gIExlYXJuaW5nRXZpZGVuY2UsXHJcbiAgTGVhcm5pbmdTdGF0ZSxcclxufSBmcm9tIFwiLi4vbGVhcm5pbmcvbGVhcm5pbmctc3RhdGVcIjtcclxuXHJcbmludGVyZmFjZSBMZWFybmluZ0V2aWRlbmNlVjEge1xyXG4gIGlkOiBzdHJpbmc7XHJcbiAgdHlwZTogXCJwcmFjdGljZVwiIHwgXCJyZXZpZXdcIiB8IFwicHJvamVjdFwiO1xyXG4gIGNvbmNlcHQ6IHN0cmluZztcclxuICBzb3VyY2U6IHN0cmluZztcclxuICBvdXRjb21lPzogc3RyaW5nO1xyXG4gIGNyZWF0ZWRBdDogbnVtYmVyO1xyXG59XHJcblxyXG5pbnRlcmZhY2UgTGVhcm5pbmdTdGF0ZVYxIHtcclxuICB2ZXJzaW9uOiAxO1xyXG4gIHRhcmdldDogc3RyaW5nIHwgbnVsbDtcclxuICBjdXJyZW50VG9waWM/OiBzdHJpbmc7XHJcbiAgZ2FwczogS25vd2xlZGdlR2FwW107XHJcbiAgZXZpZGVuY2U6IExlYXJuaW5nRXZpZGVuY2VWMVtdO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc1N0cmluZ0FycmF5KHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgc3RyaW5nW10ge1xyXG4gIHJldHVybiAoXHJcbiAgICBBcnJheS5pc0FycmF5KHZhbHVlKSAmJlxyXG4gICAgdmFsdWUuZXZlcnkoKGl0ZW0pID0+IHR5cGVvZiBpdGVtID09PSBcInN0cmluZ1wiKVxyXG4gICk7XHJcbn1cclxuXHJcbmZ1bmN0aW9uIGlzS25vd2xlZGdlR2FwKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgS25vd2xlZGdlR2FwIHtcclxuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlO1xyXG4gIGNvbnN0IGdhcCA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xyXG5cclxuICByZXR1cm4gKFxyXG4gICAgdHlwZW9mIGdhcC5pZCA9PT0gXCJzdHJpbmdcIiAmJlxyXG4gICAgdHlwZW9mIGdhcC5jb25jZXB0ID09PSBcInN0cmluZ1wiICYmXHJcbiAgICB0eXBlb2YgZ2FwLnJlYXNvbiA9PT0gXCJzdHJpbmdcIiAmJlxyXG4gICAgaXNTdHJpbmdBcnJheShnYXAuZXZpZGVuY2VJZHMpICYmXHJcbiAgICAoZ2FwLnN0YXR1cyA9PT0gXCJvcGVuXCIgfHxcclxuICAgICAgZ2FwLnN0YXR1cyA9PT0gXCJpbXByb3ZpbmdcIiB8fFxyXG4gICAgICBnYXAuc3RhdHVzID09PSBcInJlc29sdmVkXCIpXHJcbiAgKTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNFdmlkZW5jZVYxKFxyXG4gIHZhbHVlOiB1bmtub3duLFxyXG4pOiB2YWx1ZSBpcyBMZWFybmluZ0V2aWRlbmNlVjEge1xyXG4gIGlmICghdmFsdWUgfHwgdHlwZW9mIHZhbHVlICE9PSBcIm9iamVjdFwiKSByZXR1cm4gZmFsc2U7XHJcbiAgY29uc3QgZXZpZGVuY2UgPSB2YWx1ZSBhcyBSZWNvcmQ8c3RyaW5nLCB1bmtub3duPjtcclxuXHJcbiAgcmV0dXJuIChcclxuICAgIHR5cGVvZiBldmlkZW5jZS5pZCA9PT0gXCJzdHJpbmdcIiAmJlxyXG4gICAgKGV2aWRlbmNlLnR5cGUgPT09IFwicHJhY3RpY2VcIiB8fFxyXG4gICAgICBldmlkZW5jZS50eXBlID09PSBcInJldmlld1wiIHx8XHJcbiAgICAgIGV2aWRlbmNlLnR5cGUgPT09IFwicHJvamVjdFwiKSAmJlxyXG4gICAgdHlwZW9mIGV2aWRlbmNlLmNvbmNlcHQgPT09IFwic3RyaW5nXCIgJiZcclxuICAgIHR5cGVvZiBldmlkZW5jZS5zb3VyY2UgPT09IFwic3RyaW5nXCIgJiZcclxuICAgIChldmlkZW5jZS5vdXRjb21lID09PSB1bmRlZmluZWQgfHxcclxuICAgICAgdHlwZW9mIGV2aWRlbmNlLm91dGNvbWUgPT09IFwic3RyaW5nXCIpICYmXHJcbiAgICB0eXBlb2YgZXZpZGVuY2UuY3JlYXRlZEF0ID09PSBcIm51bWJlclwiXHJcbiAgKTtcclxufVxyXG5cclxuZnVuY3Rpb24gaXNFdmlkZW5jZVYyKFxyXG4gIHZhbHVlOiB1bmtub3duLFxyXG4pOiB2YWx1ZSBpcyBMZWFybmluZ0V2aWRlbmNlIHtcclxuICBpZiAoIWlzRXZpZGVuY2VWMSh2YWx1ZSkpIHJldHVybiBmYWxzZTtcclxuXHJcbiAgY29uc3Qgc2NvcGUgPSAoXHJcbiAgICB2YWx1ZSBhcyBMZWFybmluZ0V2aWRlbmNlVjEgJiB7IHNjb3BlPzogdW5rbm93biB9XHJcbiAgKS5zY29wZTtcclxuXHJcbiAgcmV0dXJuIHNjb3BlID09PSBcImxlYXJuZXJcIiB8fCBzY29wZSA9PT0gXCJtYXRlcmlhbFwiO1xyXG59XHJcblxyXG5mdW5jdGlvbiBoYXNTaGFyZWRTaGFwZSh2YWx1ZTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4pOiBib29sZWFuIHtcclxuICByZXR1cm4gKFxyXG4gICAgKHZhbHVlLnRhcmdldCA9PT0gbnVsbCB8fCB0eXBlb2YgdmFsdWUudGFyZ2V0ID09PSBcInN0cmluZ1wiKSAmJlxyXG4gICAgKHZhbHVlLmN1cnJlbnRUb3BpYyA9PT0gdW5kZWZpbmVkIHx8XHJcbiAgICAgIHR5cGVvZiB2YWx1ZS5jdXJyZW50VG9waWMgPT09IFwic3RyaW5nXCIpICYmXHJcbiAgICBBcnJheS5pc0FycmF5KHZhbHVlLmdhcHMpICYmXHJcbiAgICB2YWx1ZS5nYXBzLmV2ZXJ5KGlzS25vd2xlZGdlR2FwKSAmJlxyXG4gICAgQXJyYXkuaXNBcnJheSh2YWx1ZS5ldmlkZW5jZSlcclxuICApO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc1YxKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgTGVhcm5pbmdTdGF0ZVYxIHtcclxuICBpZiAoIXZhbHVlIHx8IHR5cGVvZiB2YWx1ZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlO1xyXG4gIGNvbnN0IHN0YXRlID0gdmFsdWUgYXMgUmVjb3JkPHN0cmluZywgdW5rbm93bj47XHJcblxyXG4gIHJldHVybiAoXHJcbiAgICBzdGF0ZS52ZXJzaW9uID09PSAxICYmXHJcbiAgICBoYXNTaGFyZWRTaGFwZShzdGF0ZSkgJiZcclxuICAgIChzdGF0ZS5ldmlkZW5jZSBhcyB1bmtub3duW10pLmV2ZXJ5KGlzRXZpZGVuY2VWMSlcclxuICApO1xyXG59XHJcblxyXG5mdW5jdGlvbiBpc1YyKHZhbHVlOiB1bmtub3duKTogdmFsdWUgaXMgTGVhcm5pbmdTdGF0ZSB7XHJcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIpIHJldHVybiBmYWxzZTtcclxuICBjb25zdCBzdGF0ZSA9IHZhbHVlIGFzIFJlY29yZDxzdHJpbmcsIHVua25vd24+O1xyXG5cclxuICByZXR1cm4gKFxyXG4gICAgc3RhdGUudmVyc2lvbiA9PT0gMiAmJlxyXG4gICAgaGFzU2hhcmVkU2hhcGUoc3RhdGUpICYmXHJcbiAgICAoc3RhdGUuZXZpZGVuY2UgYXMgdW5rbm93bltdKS5ldmVyeShpc0V2aWRlbmNlVjIpXHJcbiAgKTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIG1pZ3JhdGVMZWFybmluZ1N0YXRlVjEoXHJcbiAgc3RhdGU6IExlYXJuaW5nU3RhdGVWMSxcclxuKTogTGVhcm5pbmdTdGF0ZSB7XHJcbiAgY29uc3QgZXZpZGVuY2U6IExlYXJuaW5nRXZpZGVuY2VbXSA9IHN0YXRlLmV2aWRlbmNlLm1hcChcclxuICAgIChpdGVtKSA9PiAoe1xyXG4gICAgICAuLi5pdGVtLFxyXG4gICAgICBzY29wZTogaXRlbS50eXBlID09PSBcInJldmlld1wiID8gXCJtYXRlcmlhbFwiIDogXCJsZWFybmVyXCIsXHJcbiAgICB9KSxcclxuICApO1xyXG5cclxuICBjb25zdCBldmlkZW5jZUJ5SWQgPSBuZXcgTWFwKFxyXG4gICAgZXZpZGVuY2UubWFwKChpdGVtKSA9PiBbaXRlbS5pZCwgaXRlbV0gYXMgY29uc3QpLFxyXG4gICk7XHJcblxyXG4gIGNvbnN0IGdhcHMgPSBzdGF0ZS5nYXBzLmZpbHRlcigoZ2FwKSA9PiB7XHJcbiAgICBpZiAoZ2FwLmV2aWRlbmNlSWRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHRydWU7XHJcblxyXG4gICAgY29uc3QgcmVmZXJlbmNlZCA9IGdhcC5ldmlkZW5jZUlkc1xyXG4gICAgICAubWFwKChpZCkgPT4gZXZpZGVuY2VCeUlkLmdldChpZCkpXHJcbiAgICAgIC5maWx0ZXIoXHJcbiAgICAgICAgKGl0ZW0pOiBpdGVtIGlzIExlYXJuaW5nRXZpZGVuY2UgPT4gaXRlbSAhPT0gdW5kZWZpbmVkLFxyXG4gICAgICApO1xyXG5cclxuICAgIHJldHVybiAhKFxyXG4gICAgICByZWZlcmVuY2VkLmxlbmd0aCA9PT0gZ2FwLmV2aWRlbmNlSWRzLmxlbmd0aCAmJlxyXG4gICAgICByZWZlcmVuY2VkLmV2ZXJ5KChpdGVtKSA9PiBpdGVtLnNjb3BlID09PSBcIm1hdGVyaWFsXCIpXHJcbiAgICApO1xyXG4gIH0pO1xyXG5cclxuICByZXR1cm4ge1xyXG4gICAgdmVyc2lvbjogMixcclxuICAgIHRhcmdldDogc3RhdGUudGFyZ2V0LFxyXG4gICAgY3VycmVudFRvcGljOiBzdGF0ZS5jdXJyZW50VG9waWMsXHJcbiAgICBnYXBzLFxyXG4gICAgZXZpZGVuY2UsXHJcbiAgfTtcclxufVxyXG5cclxuZXhwb3J0IGZ1bmN0aW9uIGRlY29kZUxlYXJuaW5nU3RhdGUoXHJcbiAgdmFsdWU6IHVua25vd24sXHJcbik6IExlYXJuaW5nU3RhdGUge1xyXG4gIGlmIChpc1YyKHZhbHVlKSkge1xyXG4gICAgcmV0dXJuIHtcclxuICAgICAgLi4udmFsdWUsXHJcbiAgICAgIGdhcHM6IHZhbHVlLmdhcHMubWFwKChnYXApID0+ICh7XHJcbiAgICAgICAgLi4uZ2FwLFxyXG4gICAgICAgIGV2aWRlbmNlSWRzOiBbLi4uZ2FwLmV2aWRlbmNlSWRzXSxcclxuICAgICAgfSkpLFxyXG4gICAgICBldmlkZW5jZTogdmFsdWUuZXZpZGVuY2UubWFwKChpdGVtKSA9PiAoeyAuLi5pdGVtIH0pKSxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICBpZiAoaXNWMSh2YWx1ZSkpIHtcclxuICAgIHJldHVybiBtaWdyYXRlTGVhcm5pbmdTdGF0ZVYxKHZhbHVlKTtcclxuICB9XHJcblxyXG4gIHRocm93IG5ldyBFcnJvcihcIkxlYXJuaW5nIHN0YXRlIGhhcyBhbiB1bnN1cHBvcnRlZCBzaGFwZS5cIik7XHJcbn1cclxuIiwgImltcG9ydCB7IFBsdWdpbiB9IGZyb20gXCJvYnNpZGlhblwiO1xyXG5pbXBvcnQgeyBTZXNzaW9uU3RvcmUgfSBmcm9tIFwiLi9TZXNzaW9uU3RvcmVcIjtcclxuaW1wb3J0IHtcclxuICBBZ2VudEFkYXB0ZXIsXG4gIEFnZW50SGVhbHRoLFxuICBBZ2VudENvbnRleHQsXHJcbiAgQWdlbnRJbnB1dCxcclxuICBBZ2VudE1vZGVsLFxuICBBZ2VudFN0cmVhbUV2ZW50LFxuICBDaGF0U2Vzc2lvbixcclxufSBmcm9tIFwiLi4vdHlwZXNcIjtcclxuXHJcbi8qKlxyXG4gKiBPd25zIGNoYXQvYWdlbnQgY29udmVyc2F0aW9uIHBlcnNpc3RlbmNlIG9ubHkuXHJcbiAqXHJcbiAqIExlYXJuaW5nIG9yY2hlc3RyYXRpb24sIGNvbnRleHQgcmVzb2x1dGlvbiwgYW5kIE1hcmtkb3duIG11dGF0aW9uIGxpdmUgYWJvdmVcclxuICogb3IgYmVzaWRlIHRoaXMgY2xhc3MuIFRoaXMga2VlcHMgc2Vzc2lvbiBzdGF0ZSBpbmRlcGVuZGVudCBvZiBMZWFybmluZyBPU1xyXG4gKiBiZWhhdmlvci5cclxuICovXHJcbmV4cG9ydCBjbGFzcyBTZXNzaW9uQ29udHJvbGxlciB7XHJcbiAgcHJpdmF0ZSBjdXJyZW50U2Vzc2lvbjogQ2hhdFNlc3Npb24gfCBudWxsID0gbnVsbDtcclxuICBwcml2YXRlIG1vZGVsczogQWdlbnRNb2RlbFtdID0gW107XG5cclxuICBjb25zdHJ1Y3RvcihcclxuICAgIHByaXZhdGUgcmVhZG9ubHkgcGx1Z2luOiBQbHVnaW4sXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IHN0b3JlOiBTZXNzaW9uU3RvcmUsXHJcbiAgICBwcml2YXRlIHJlYWRvbmx5IGFkYXB0ZXI6IEFnZW50QWRhcHRlcixcclxuICApIHt9XHJcblxyXG4gIGFzeW5jIGluaXQoKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBkYXRhID0gYXdhaXQgdGhpcy5wbHVnaW4ubG9hZERhdGEoKTtcclxuICAgIGF3YWl0IHRoaXMuc3RvcmUubG9hZChkYXRhKTtcclxuXHJcbiAgICB0aGlzLmN1cnJlbnRTZXNzaW9uID0gdGhpcy5zdG9yZS5nZXRDdXJyZW50U2Vzc2lvbigpO1xyXG4gICAgaWYgKCF0aGlzLmN1cnJlbnRTZXNzaW9uKSB7XHJcbiAgICAgIHRoaXMuY3VycmVudFNlc3Npb24gPSB0aGlzLnN0b3JlLmNyZWF0ZVNlc3Npb24odGhpcy5zdG9yZS5nZXREZWZhdWx0TW9kZWwoKSk7XHJcbiAgICB9XHJcblxyXG4gICAgdHJ5IHtcbiAgICAgIHRoaXMubW9kZWxzID0gYXdhaXQgdGhpcy5hZGFwdGVyLmxpc3RNb2RlbHMoKTtcbiAgICB9IGNhdGNoIHtcbiAgICAgIHRoaXMubW9kZWxzID0gW107XG4gICAgfVxuICB9XG5cbiAgY2hlY2tSdW50aW1lKCk6IFByb21pc2U8QWdlbnRIZWFsdGg+IHtcbiAgICByZXR1cm4gdGhpcy5hZGFwdGVyLmNoZWNrKCk7XG4gIH1cclxuXHJcbiAgZ2V0U2Vzc2lvbigpOiBDaGF0U2Vzc2lvbiB7XHJcbiAgICBpZiAoIXRoaXMuY3VycmVudFNlc3Npb24pIHRocm93IG5ldyBFcnJvcihcIlNlc3Npb24gbm90IGluaXRpYWxpemVkXCIpO1xyXG4gICAgcmV0dXJuIHRoaXMuY3VycmVudFNlc3Npb247XHJcbiAgfVxyXG5cclxuICBhc3luYyBuZXdTZXNzaW9uKCk6IFByb21pc2U8Q2hhdFNlc3Npb24+IHtcclxuICAgIGNvbnN0IG1vZGVsID0gdGhpcy5jdXJyZW50U2Vzc2lvbj8ubW9kZWwgPz8gdGhpcy5zdG9yZS5nZXREZWZhdWx0TW9kZWwoKTtcclxuICAgIHRoaXMuY3VycmVudFNlc3Npb24gPSB0aGlzLnN0b3JlLmNyZWF0ZVNlc3Npb24obW9kZWwpO1xyXG4gICAgYXdhaXQgdGhpcy5zYXZlKCk7XHJcbiAgICByZXR1cm4gdGhpcy5jdXJyZW50U2Vzc2lvbjtcclxuICB9XHJcblxyXG4gIHNldE1vZGVsKG1vZGVsSWQ/OiBzdHJpbmcpOiB2b2lkIHtcbiAgICBjb25zdCBub3JtYWxpemVkID0gbW9kZWxJZCB8fCB1bmRlZmluZWQ7XG4gICAgdGhpcy5zdG9yZS5zZXREZWZhdWx0TW9kZWwobm9ybWFsaXplZCk7XG5cbiAgICBpZiAodGhpcy5jdXJyZW50U2Vzc2lvbikge1xuICAgICAgdGhpcy5jdXJyZW50U2Vzc2lvbi5tb2RlbCA9IG5vcm1hbGl6ZWQ7XG4gICAgICB0aGlzLnN0b3JlLnVwZGF0ZVNlc3Npb24odGhpcy5jdXJyZW50U2Vzc2lvbik7XHJcbiAgICAgIHZvaWQgdGhpcy5zYXZlKCk7XHJcbiAgICB9XHJcbiAgfVxyXG5cclxuICBnZXRNb2RlbHMoKTogQWdlbnRNb2RlbFtdIHtcbiAgICByZXR1cm4gdGhpcy5tb2RlbHM7XHJcbiAgfVxyXG5cclxuICAvKipcclxuICAgKiBFeGVjdXRlIG9uZSBwcmVwYXJlZCBhZ2VudCB0dXJuLlxyXG4gICAqXHJcbiAgICogQ29udGV4dCBpcyBhbHJlYWR5IHJlc29sdmVkIGJ5IExlYXJuaW5nQ29udHJvbGxlci4gZGlzcGxheVByb21wdCBpcyB0aGUgcmF3XHJcbiAgICogdXNlciB0ZXh0IHN0b3JlZCBpbiBsb2NhbCBoaXN0b3J5IHNvIGludGVybmFsIGxlYXJuaW5nIGluc3RydWN0aW9ucyBkbyBub3RcclxuICAgKiBsZWFrIGludG8gdGhlIHZpc2libGUvc2Vzc2lvbiB0cmFuc2NyaXB0LlxyXG4gICAqL1xyXG4gIGFzeW5jICpzZW5kVHVybihcbiAgICBwcm9tcHQ6IHN0cmluZyxcbiAgICBjb250ZXh0OiBBZ2VudENvbnRleHRbXSxcbiAgICBkaXNwbGF5UHJvbXB0OiBzdHJpbmcsXG4gICAgc2lnbmFsOiBBYm9ydFNpZ25hbCxcbiAgKTogQXN5bmNJdGVyYWJsZTxBZ2VudFN0cmVhbUV2ZW50PiB7XG4gICAgY29uc3Qgc2Vzc2lvbiA9IHRoaXMuZ2V0U2Vzc2lvbigpO1xyXG4gICAgY29uc3QgaW5wdXQ6IEFnZW50SW5wdXQgPSB7IHByb21wdCwgY29udGV4dCB9O1xyXG5cclxuICAgIHNlc3Npb24ubWVzc2FnZXMucHVzaCh7XHJcbiAgICAgIHJvbGU6IFwidXNlclwiLFxyXG4gICAgICBjb250ZW50OiBkaXNwbGF5UHJvbXB0LFxyXG4gICAgfSk7XHJcblxyXG4gICAgdGhpcy5zdG9yZS51cGRhdGVTZXNzaW9uKHNlc3Npb24pO1xuICAgIGF3YWl0IHRoaXMuc2F2ZSgpO1xuXG4gICAgZm9yIGF3YWl0IChjb25zdCBldmVudCBvZiB0aGlzLmFkYXB0ZXIuc2VuZChpbnB1dCwge1xuICAgICAgbW9kZWw6IHNlc3Npb24ubW9kZWwsXG4gICAgICBjb252ZXJzYXRpb25JZDogc2Vzc2lvbi5jb252ZXJzYXRpb25JZCxcbiAgICB9LCBzaWduYWwpKSB7XG4gICAgICBpZiAoZXZlbnQudHlwZSA9PT0gXCJjb21wbGV0ZWRcIiAmJiBldmVudC5jb252ZXJzYXRpb25JZCkge1xuICAgICAgICBzZXNzaW9uLmNvbnZlcnNhdGlvbklkID0gZXZlbnQuY29udmVyc2F0aW9uSWQ7XG4gICAgICB9XG5cclxuICAgICAgeWllbGQgZXZlbnQ7XHJcbiAgICB9XHJcblxyXG4gICAgdGhpcy5zdG9yZS51cGRhdGVTZXNzaW9uKHNlc3Npb24pO1xuICAgIGF3YWl0IHRoaXMuc2F2ZSgpO1xuICB9XG5cbiAgYXN5bmMgcmVjb3JkQXNzaXN0YW50TWVzc2FnZShjb250ZW50OiBzdHJpbmcpOiBQcm9taXNlPHZvaWQ+IHtcbiAgICBpZiAoIWNvbnRlbnQudHJpbSgpKSByZXR1cm47XG4gICAgY29uc3Qgc2Vzc2lvbiA9IHRoaXMuZ2V0U2Vzc2lvbigpO1xuICAgIHNlc3Npb24ubWVzc2FnZXMucHVzaCh7IHJvbGU6IFwiYXNzaXN0YW50XCIsIGNvbnRlbnQgfSk7XG4gICAgdGhpcy5zdG9yZS51cGRhdGVTZXNzaW9uKHNlc3Npb24pO1xuICAgIGF3YWl0IHRoaXMuc2F2ZSgpO1xuICB9XG5cbiAgYXN5bmMgcmVjb3JkUHJvcG9zYWwoXG4gICAgcHJvcG9zYWxJZDogc3RyaW5nLFxuICAgIHByb3Bvc2FsOiBpbXBvcnQoXCIuLi90eXBlc1wiKS5FZGl0UHJvcG9zYWwsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IHNlc3Npb24gPSB0aGlzLmdldFNlc3Npb24oKTtcbiAgICBzZXNzaW9uLm1lc3NhZ2VzLnB1c2goe1xuICAgICAgcm9sZTogXCJhc3Npc3RhbnRcIixcbiAgICAgIGNvbnRlbnQ6IFwiXCIsXG4gICAgICBwcm9wb3NhbElkLFxuICAgICAgcHJvcG9zYWwsXG4gICAgICBwcm9wb3NhbFN0YXRlOiBcInBlbmRpbmdcIixcbiAgICB9KTtcbiAgICB0aGlzLnN0b3JlLnVwZGF0ZVNlc3Npb24oc2Vzc2lvbik7XG4gICAgYXdhaXQgdGhpcy5zYXZlKCk7XG4gIH1cblxuICBhc3luYyB1cGRhdGVQcm9wb3NhbFN0YXRlKFxuICAgIHByb3Bvc2FsSWQ6IHN0cmluZyxcbiAgICBzdGF0ZTogXCJhcHBsaWVkXCIgfCBcInJlamVjdGVkXCIgfCBcInN0YWxlXCIsXG4gICk6IFByb21pc2U8dm9pZD4ge1xuICAgIGNvbnN0IG1lc3NhZ2UgPSB0aGlzLmdldFNlc3Npb24oKS5tZXNzYWdlcy5maW5kKFxuICAgICAgKGl0ZW0pID0+IGl0ZW0ucHJvcG9zYWxJZCA9PT0gcHJvcG9zYWxJZCxcbiAgICApO1xuICAgIGlmICghbWVzc2FnZSkgcmV0dXJuO1xuICAgIG1lc3NhZ2UucHJvcG9zYWxTdGF0ZSA9IHN0YXRlO1xuICAgIHRoaXMuc3RvcmUudXBkYXRlU2Vzc2lvbih0aGlzLmdldFNlc3Npb24oKSk7XG4gICAgYXdhaXQgdGhpcy5zYXZlKCk7XG4gIH1cblxuICBwcml2YXRlIGFzeW5jIHNhdmUoKTogUHJvbWlzZTx2b2lkPiB7XG4gICAgY29uc3QgY3VycmVudCA9IChhd2FpdCB0aGlzLnBsdWdpbi5sb2FkRGF0YSgpKSA/PyB7fTtcbiAgICBhd2FpdCB0aGlzLnBsdWdpbi5zYXZlRGF0YSh7IC4uLmN1cnJlbnQsIC4uLnRoaXMuc3RvcmUuc2VyaWFsaXplKCkgfSk7XG4gIH1cbn1cbiIsICJpbXBvcnQgeyBDaGF0U2Vzc2lvbiB9IGZyb20gXCIuLi90eXBlc1wiO1xyXG5cclxuY29uc3QgU1RPUkVfS0VZID0gXCJub3gtc2Vzc2lvbnNcIjtcclxuY29uc3QgTEVHQUNZX1NUT1JFX0tFWSA9IFwiYWd5LXNlc3Npb25zXCI7XHJcbmludGVyZmFjZSBTdG9yZURhdGEge1xyXG4gIGN1cnJlbnRTZXNzaW9uSWQ6IHN0cmluZyB8IG51bGw7XHJcbiAgc2Vzc2lvbnM6IFJlY29yZDxzdHJpbmcsIENoYXRTZXNzaW9uPjtcclxuICBkZWZhdWx0TW9kZWw/OiBzdHJpbmc7XHJcbn1cclxuXHJcbmV4cG9ydCBpbnRlcmZhY2UgU2Vzc2lvblN0b3JlT3B0aW9ucyB7XHJcbiAgbm93PzogKCkgPT4gbnVtYmVyO1xyXG4gIHV1aWQ/OiAoKSA9PiBzdHJpbmc7XHJcbn1cclxuXHJcbi8qKlxyXG4gKiBTZXNzaW9uU3RvcmUgXHUyMDE0IHBlcnNpc3RzIHNlc3Npb25zIHRvIE9ic2lkaWFuIHBsdWdpbiBkYXRhLlxyXG4gKlxyXG4gKiBTcGlrZSA1OiBzZXNzaW9ucyBzdXJ2aXZlIE9ic2lkaWFuIHJlc3RhcnRzLlxyXG4gKiBUaGUgc3RvcmUgaXMgYSB0aGluIHdyYXBwZXIgYXJvdW5kIHBsdWdpbi5sb2FkRGF0YSAvIHBsdWdpbi5zYXZlRGF0YS5cclxuICovXHJcbmV4cG9ydCBjbGFzcyBTZXNzaW9uU3RvcmUge1xyXG4gIHByaXZhdGUgZGF0YTogU3RvcmVEYXRhID0ge1xyXG4gICAgY3VycmVudFNlc3Npb25JZDogbnVsbCxcclxuICAgIHNlc3Npb25zOiB7fSxcclxuICB9O1xyXG4gIHByaXZhdGUgcmVhZG9ubHkgbm93OiAoKSA9PiBudW1iZXI7XHJcbiAgcHJpdmF0ZSByZWFkb25seSB1dWlkOiAoKSA9PiBzdHJpbmc7XHJcblxyXG4gIGNvbnN0cnVjdG9yKG9wdGlvbnM6IFNlc3Npb25TdG9yZU9wdGlvbnMgPSB7fSkge1xyXG4gICAgdGhpcy5ub3cgPSBvcHRpb25zLm5vdyA/PyBEYXRlLm5vdztcclxuICAgIHRoaXMudXVpZCA9IG9wdGlvbnMudXVpZCA/PyAoKCkgPT4gY3J5cHRvLnJhbmRvbVVVSUQoKSk7XHJcbiAgfVxyXG5cclxuICAvKiogQ2FsbCBvbmNlIG9uIHBsdWdpbiBsb2FkLiAqL1xyXG4gIGFzeW5jIGxvYWQocmF3RGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsKTogUHJvbWlzZTx2b2lkPiB7XHJcbiAgICBjb25zdCBzdG9yZWQgPSByYXdEYXRhPy5bU1RPUkVfS0VZXSA/PyByYXdEYXRhPy5bTEVHQUNZX1NUT1JFX0tFWV07XHJcbiAgICBpZiAoIXN0b3JlZCB8fCB0eXBlb2Ygc3RvcmVkICE9PSBcIm9iamVjdFwiKSByZXR1cm47XHJcblxyXG4gICAgY29uc3QgY2FuZGlkYXRlID0gc3RvcmVkIGFzIFBhcnRpYWw8U3RvcmVEYXRhPjtcclxuICAgIGNvbnN0IHNlc3Npb25zOiBSZWNvcmQ8c3RyaW5nLCBDaGF0U2Vzc2lvbj4gPSB7fTtcclxuICAgIGlmIChjYW5kaWRhdGUuc2Vzc2lvbnMgJiYgdHlwZW9mIGNhbmRpZGF0ZS5zZXNzaW9ucyA9PT0gXCJvYmplY3RcIikge1xyXG4gICAgICBmb3IgKGNvbnN0IFtpZCwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKGNhbmRpZGF0ZS5zZXNzaW9ucykpIHtcclxuICAgICAgICBjb25zdCBzZXNzaW9uID0gdGhpcy5kZWNvZGVTZXNzaW9uKHZhbHVlKTtcclxuICAgICAgICBpZiAoc2Vzc2lvbikgc2Vzc2lvbnNbaWRdID0gc2Vzc2lvbjtcclxuICAgICAgfVxyXG4gICAgfVxyXG5cclxuICAgIHRoaXMuZGF0YSA9IHtcclxuICAgICAgY3VycmVudFNlc3Npb25JZDpcclxuICAgICAgICB0eXBlb2YgY2FuZGlkYXRlLmN1cnJlbnRTZXNzaW9uSWQgPT09IFwic3RyaW5nXCJcclxuICAgICAgICAgID8gY2FuZGlkYXRlLmN1cnJlbnRTZXNzaW9uSWRcclxuICAgICAgICAgIDogbnVsbCxcclxuICAgICAgc2Vzc2lvbnMsXHJcbiAgICAgIGRlZmF1bHRNb2RlbDpcclxuICAgICAgICB0eXBlb2YgY2FuZGlkYXRlLmRlZmF1bHRNb2RlbCA9PT0gXCJzdHJpbmdcIlxyXG4gICAgICAgICAgPyBjYW5kaWRhdGUuZGVmYXVsdE1vZGVsXHJcbiAgICAgICAgICA6IHVuZGVmaW5lZCxcclxuICAgIH07XHJcbiAgfVxyXG5cclxuICAvKiogU2VyaWFsaXplIHRvIHBsdWdpbiBkYXRhIG9iamVjdC4gKi9cclxuICBzZXJpYWxpemUoKTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4ge1xyXG4gICAgcmV0dXJuIHsgW1NUT1JFX0tFWV06IHRoaXMuZGF0YSB9O1xyXG4gIH1cclxuXHJcbiAgLy8gXHUyNTAwXHUyNTAwIFNlc3Npb24gQ1JVRCBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbiAgY3JlYXRlU2Vzc2lvbihtb2RlbD86IHN0cmluZyk6IENoYXRTZXNzaW9uIHtcclxuICAgIGNvbnN0IG5vdyA9IHRoaXMubm93KCk7XHJcbiAgICBjb25zdCBzZXNzaW9uOiBDaGF0U2Vzc2lvbiA9IHtcclxuICAgICAgaWQ6IHRoaXMudXVpZCgpLFxyXG4gICAgICBtb2RlbCxcclxuICAgICAgbWVzc2FnZXM6IFtdLFxyXG4gICAgICBjcmVhdGVkQXQ6IG5vdyxcclxuICAgICAgdXBkYXRlZEF0OiBub3csXHJcbiAgICB9O1xyXG4gICAgdGhpcy5kYXRhLnNlc3Npb25zW3Nlc3Npb24uaWRdID0gc2Vzc2lvbjtcclxuICAgIHRoaXMuZGF0YS5jdXJyZW50U2Vzc2lvbklkID0gc2Vzc2lvbi5pZDtcclxuICAgIHJldHVybiBzZXNzaW9uO1xyXG4gIH1cclxuXHJcbiAgZ2V0U2Vzc2lvbihpZDogc3RyaW5nKTogQ2hhdFNlc3Npb24gfCBudWxsIHtcclxuICAgIHJldHVybiB0aGlzLmRhdGEuc2Vzc2lvbnNbaWRdID8/IG51bGw7XHJcbiAgfVxyXG5cclxuICBnZXRDdXJyZW50U2Vzc2lvbigpOiBDaGF0U2Vzc2lvbiB8IG51bGwge1xyXG4gICAgaWYgKCF0aGlzLmRhdGEuY3VycmVudFNlc3Npb25JZCkgcmV0dXJuIG51bGw7XHJcbiAgICByZXR1cm4gdGhpcy5nZXRTZXNzaW9uKHRoaXMuZGF0YS5jdXJyZW50U2Vzc2lvbklkKTtcclxuICB9XHJcblxyXG4gIHVwZGF0ZVNlc3Npb24oc2Vzc2lvbjogQ2hhdFNlc3Npb24pOiB2b2lkIHtcclxuICAgIHNlc3Npb24udXBkYXRlZEF0ID0gdGhpcy5ub3coKTtcclxuICAgIHRoaXMuZGF0YS5zZXNzaW9uc1tzZXNzaW9uLmlkXSA9IHNlc3Npb247XHJcbiAgfVxyXG5cclxuICBzZXRDdXJyZW50U2Vzc2lvbihpZDogc3RyaW5nKTogdm9pZCB7XHJcbiAgICB0aGlzLmRhdGEuY3VycmVudFNlc3Npb25JZCA9IGlkO1xyXG4gIH1cclxuXHJcbiAgLy8gXHUyNTAwXHUyNTAwIE1vZGVsIHByZWZlcmVuY2UgXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHUyNTAwXHJcblxyXG4gIGdldERlZmF1bHRNb2RlbCgpOiBzdHJpbmcgfCB1bmRlZmluZWQge1xyXG4gICAgcmV0dXJuIHRoaXMuZGF0YS5kZWZhdWx0TW9kZWw7XHJcbiAgfVxyXG5cclxuICBzZXREZWZhdWx0TW9kZWwobW9kZWw/OiBzdHJpbmcpOiB2b2lkIHtcclxuICAgIHRoaXMuZGF0YS5kZWZhdWx0TW9kZWwgPSBtb2RlbCB8fCB1bmRlZmluZWQ7XHJcbiAgfVxyXG5cclxuICAvLyBcdTI1MDBcdTI1MDAgVXRpbGl0eSBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcdTI1MDBcclxuXHJcbiAgLyoqIEFsbCBzZXNzaW9ucywgbmV3ZXN0IGZpcnN0LiAqL1xyXG4gIGxpc3RTZXNzaW9ucygpOiBDaGF0U2Vzc2lvbltdIHtcclxuICAgIHJldHVybiBPYmplY3QudmFsdWVzKHRoaXMuZGF0YS5zZXNzaW9ucykuc29ydChcclxuICAgICAgKGEsIGIpID0+IGIudXBkYXRlZEF0IC0gYS51cGRhdGVkQXRcclxuICAgICk7XHJcbiAgfVxyXG5cclxuICBwcml2YXRlIGRlY29kZVNlc3Npb24odmFsdWU6IHVua25vd24pOiBDaGF0U2Vzc2lvbiB8IG51bGwge1xyXG4gICAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIpIHJldHVybiBudWxsO1xyXG4gICAgY29uc3Qgc2Vzc2lvbiA9IHZhbHVlIGFzIFBhcnRpYWw8Q2hhdFNlc3Npb24+O1xyXG4gICAgaWYgKFxyXG4gICAgICB0eXBlb2Ygc2Vzc2lvbi5pZCAhPT0gXCJzdHJpbmdcIiB8fFxyXG4gICAgICAhQXJyYXkuaXNBcnJheShzZXNzaW9uLm1lc3NhZ2VzKSB8fFxyXG4gICAgICB0eXBlb2Ygc2Vzc2lvbi5jcmVhdGVkQXQgIT09IFwibnVtYmVyXCIgfHxcclxuICAgICAgdHlwZW9mIHNlc3Npb24udXBkYXRlZEF0ICE9PSBcIm51bWJlclwiXHJcbiAgICApIHtcclxuICAgICAgcmV0dXJuIG51bGw7XHJcbiAgICB9XHJcblxyXG4gICAgcmV0dXJuIHtcclxuICAgICAgaWQ6IHNlc3Npb24uaWQsXHJcbiAgICAgIGNvbnZlcnNhdGlvbklkOlxyXG4gICAgICAgIHR5cGVvZiBzZXNzaW9uLmNvbnZlcnNhdGlvbklkID09PSBcInN0cmluZ1wiXHJcbiAgICAgICAgICA/IHNlc3Npb24uY29udmVyc2F0aW9uSWRcclxuICAgICAgICAgIDogdW5kZWZpbmVkLFxyXG4gICAgICBtb2RlbDogdHlwZW9mIHNlc3Npb24ubW9kZWwgPT09IFwic3RyaW5nXCIgPyBzZXNzaW9uLm1vZGVsIDogdW5kZWZpbmVkLFxyXG4gICAgICBtZXNzYWdlczogc2Vzc2lvbi5tZXNzYWdlc1xyXG4gICAgICAgIC5maWx0ZXIoKG1lc3NhZ2UpID0+IHtcclxuICAgICAgICAgIGlmICghbWVzc2FnZSB8fCB0eXBlb2YgbWVzc2FnZSAhPT0gXCJvYmplY3RcIikgcmV0dXJuIGZhbHNlO1xyXG4gICAgICAgICAgY29uc3QgY2FuZGlkYXRlID0gbWVzc2FnZSBhcyB7IHJvbGU/OiB1bmtub3duOyBjb250ZW50PzogdW5rbm93biB9O1xyXG4gICAgICAgICAgcmV0dXJuIChcclxuICAgICAgICAgICAgKGNhbmRpZGF0ZS5yb2xlID09PSBcInVzZXJcIiB8fCBjYW5kaWRhdGUucm9sZSA9PT0gXCJhc3Npc3RhbnRcIikgJiZcclxuICAgICAgICAgICAgdHlwZW9mIGNhbmRpZGF0ZS5jb250ZW50ID09PSBcInN0cmluZ1wiXHJcbiAgICAgICAgICApO1xyXG4gICAgICAgIH0pXHJcbiAgICAgICAgLm1hcCgobWVzc2FnZSkgPT4gKHtcclxuICAgICAgICAgIC4uLm1lc3NhZ2UsXHJcbiAgICAgICAgICBwcm9wb3NhbFN0YXRlOlxyXG4gICAgICAgICAgICBtZXNzYWdlLnByb3Bvc2FsU3RhdGUgPT09IFwicGVuZGluZ1wiXHJcbiAgICAgICAgICAgICAgPyBcInN0YWxlXCJcclxuICAgICAgICAgICAgICA6IG1lc3NhZ2UucHJvcG9zYWxTdGF0ZSxcclxuICAgICAgICB9KSksXHJcbiAgICAgIGNyZWF0ZWRBdDogc2Vzc2lvbi5jcmVhdGVkQXQsXHJcbiAgICAgIHVwZGF0ZWRBdDogc2Vzc2lvbi51cGRhdGVkQXQsXHJcbiAgICB9O1xyXG4gIH1cclxufVxyXG4iLCAiaW1wb3J0IHsgUGx1Z2luIH0gZnJvbSBcIm9ic2lkaWFuXCI7XHJcblxyXG5leHBvcnQgY29uc3QgTk9YX1NFVFRJTkdTX0tFWSA9IFwibm94LXNldHRpbmdzXCI7XHJcblxyXG5leHBvcnQgaW50ZXJmYWNlIE5veFNldHRpbmdzIHtcclxuICBleGVjdXRhYmxlUGF0aDogc3RyaW5nO1xyXG4gIHByZWZlcnJlZE1vZGVsOiBzdHJpbmc7XHJcbn1cclxuXHJcbmV4cG9ydCBjb25zdCBERUZBVUxUX05PWF9TRVRUSU5HUzogTm94U2V0dGluZ3MgPSB7XHJcbiAgZXhlY3V0YWJsZVBhdGg6IFwiXCIsXHJcbiAgcHJlZmVycmVkTW9kZWw6IFwiXCIsXHJcbn07XHJcblxyXG5leHBvcnQgZnVuY3Rpb24gZGVjb2RlTm94U2V0dGluZ3MoXHJcbiAgcmF3RGF0YTogUmVjb3JkPHN0cmluZywgdW5rbm93bj4gfCBudWxsLFxyXG4pOiBOb3hTZXR0aW5ncyB7XHJcbiAgY29uc3QgdmFsdWUgPSByYXdEYXRhPy5bTk9YX1NFVFRJTkdTX0tFWV07XHJcbiAgaWYgKCF2YWx1ZSB8fCB0eXBlb2YgdmFsdWUgIT09IFwib2JqZWN0XCIpIHJldHVybiB7IC4uLkRFRkFVTFRfTk9YX1NFVFRJTkdTIH07XHJcbiAgY29uc3QgY2FuZGlkYXRlID0gdmFsdWUgYXMgUGFydGlhbDxOb3hTZXR0aW5ncz47XHJcbiAgcmV0dXJuIHtcclxuICAgIGV4ZWN1dGFibGVQYXRoOlxyXG4gICAgICB0eXBlb2YgY2FuZGlkYXRlLmV4ZWN1dGFibGVQYXRoID09PSBcInN0cmluZ1wiXHJcbiAgICAgICAgPyBjYW5kaWRhdGUuZXhlY3V0YWJsZVBhdGhcclxuICAgICAgICA6IFwiXCIsXHJcbiAgICBwcmVmZXJyZWRNb2RlbDpcclxuICAgICAgdHlwZW9mIGNhbmRpZGF0ZS5wcmVmZXJyZWRNb2RlbCA9PT0gXCJzdHJpbmdcIlxyXG4gICAgICAgID8gY2FuZGlkYXRlLnByZWZlcnJlZE1vZGVsXHJcbiAgICAgICAgOiBcIlwiLFxyXG4gIH07XHJcbn1cclxuXHJcbmV4cG9ydCBhc3luYyBmdW5jdGlvbiBzYXZlTm94U2V0dGluZ3MoXHJcbiAgcGx1Z2luOiBQbHVnaW4sXHJcbiAgc2V0dGluZ3M6IE5veFNldHRpbmdzLFxyXG4pOiBQcm9taXNlPHZvaWQ+IHtcclxuICBjb25zdCBjdXJyZW50ID0gKGF3YWl0IHBsdWdpbi5sb2FkRGF0YSgpKSA/PyB7fTtcclxuICBhd2FpdCBwbHVnaW4uc2F2ZURhdGEoe1xyXG4gICAgLi4uY3VycmVudCxcclxuICAgIFtOT1hfU0VUVElOR1NfS0VZXTogc2V0dGluZ3MsXHJcbiAgfSk7XHJcbn1cclxuIiwgImltcG9ydCB7IEFwcCwgUGx1Z2luU2V0dGluZ1RhYiwgU2V0dGluZyB9IGZyb20gXCJvYnNpZGlhblwiO1xyXG5pbXBvcnQgdHlwZSBOb3hQbHVnaW4gZnJvbSBcIi4uL21haW5cIjtcclxuXHJcbmV4cG9ydCBjbGFzcyBOb3hTZXR0aW5nc1RhYiBleHRlbmRzIFBsdWdpblNldHRpbmdUYWIge1xyXG4gIGNvbnN0cnVjdG9yKGFwcDogQXBwLCBwcml2YXRlIHJlYWRvbmx5IG5veDogTm94UGx1Z2luKSB7XHJcbiAgICBzdXBlcihhcHAsIG5veCk7XHJcbiAgfVxyXG5cclxuICBkaXNwbGF5KCk6IHZvaWQge1xyXG4gICAgY29uc3QgeyBjb250YWluZXJFbCB9ID0gdGhpcztcclxuICAgIGNvbnN0IHNldHRpbmdzID0gdGhpcy5ub3guZ2V0U2V0dGluZ3MoKTtcclxuICAgIGNvbnRhaW5lckVsLmVtcHR5KCk7XHJcbiAgICBjb250YWluZXJFbC5jcmVhdGVFbChcImgyXCIsIHsgdGV4dDogXCJOb3hcIiB9KTtcclxuXHJcbiAgICBuZXcgU2V0dGluZyhjb250YWluZXJFbClcclxuICAgICAgLnNldE5hbWUoXCJBZ2VudCBleGVjdXRhYmxlXCIpXHJcbiAgICAgIC5zZXREZXNjKFwiT3B0aW9uYWwgYWJzb2x1dGUgcGF0aCB0byB0aGUgY29uZmlndXJlZCBhZ2VudCBydW50aW1lLlwiKVxyXG4gICAgICAuYWRkVGV4dCgodGV4dCkgPT5cclxuICAgICAgICB0ZXh0XHJcbiAgICAgICAgICAuc2V0UGxhY2Vob2xkZXIoXCJVc2UgUEFUSCBkaXNjb3ZlcnlcIilcclxuICAgICAgICAgIC5zZXRWYWx1ZShzZXR0aW5ncy5leGVjdXRhYmxlUGF0aClcclxuICAgICAgICAgIC5vbkNoYW5nZShhc3luYyAodmFsdWUpID0+IHtcclxuICAgICAgICAgICAgYXdhaXQgdGhpcy5ub3gudXBkYXRlU2V0dGluZ3MoeyBleGVjdXRhYmxlUGF0aDogdmFsdWUudHJpbSgpIH0pO1xyXG4gICAgICAgICAgfSksXHJcbiAgICAgICk7XHJcblxyXG4gICAgbmV3IFNldHRpbmcoY29udGFpbmVyRWwpXHJcbiAgICAgIC5zZXROYW1lKFwiUHJlZmVycmVkIG1vZGVsXCIpXHJcbiAgICAgIC5zZXREZXNjKFwiTGVhdmUgYmxhbmsgdG8gdXNlIHRoZSBydW50aW1lIGRlZmF1bHQgbW9kZWwuXCIpXHJcbiAgICAgIC5hZGRUZXh0KCh0ZXh0KSA9PlxyXG4gICAgICAgIHRleHRcclxuICAgICAgICAgIC5zZXRQbGFjZWhvbGRlcihcIlJ1bnRpbWUgZGVmYXVsdFwiKVxyXG4gICAgICAgICAgLnNldFZhbHVlKHNldHRpbmdzLnByZWZlcnJlZE1vZGVsKVxyXG4gICAgICAgICAgLm9uQ2hhbmdlKGFzeW5jICh2YWx1ZSkgPT4ge1xyXG4gICAgICAgICAgICBhd2FpdCB0aGlzLm5veC51cGRhdGVTZXR0aW5ncyh7IHByZWZlcnJlZE1vZGVsOiB2YWx1ZS50cmltKCkgfSk7XHJcbiAgICAgICAgICB9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QU0sUUFBUSxnQkFBZ0IsVUFBVTtBQUFBLEVBQzFEO0FBQUEsRUFFQSxNQUFNLGVBQWUsUUFBNkM7QUFDaEUsU0FBSyxjQUFjLEVBQUUsR0FBRyxLQUFLLGFBQWEsR0FBRyxPQUFPO0FBQ3BELFVBQU0sZ0JBQWdCLE1BQU0sS0FBSyxXQUFXO0FBQzVDLFFBQUksT0FBTyxtQkFBbUIsUUFBVztBQUN2QyxXQUFLLFNBQVMsU0FBUyxPQUFPLGtCQUFrQixNQUFTO0FBQUEsSUFDM0Q7QUFBQSxFQUNGO0FBQUEsRUFFUSxlQUFxQjtBQUMzQixVQUFNLE1BQU0sS0FBSztBQU1qQixRQUFJLFFBQVEsS0FBSztBQUNqQixRQUFJLFFBQVEsWUFBWSxLQUFLLFNBQVMsRUFBRTtBQUFBLEVBQzFDO0FBQ0Y7IiwKICAibmFtZXMiOiBbImltcG9ydF9vYnNpZGlhbiIsICJjb252ZXJzYXRpb25JZCIsICJfYSIsICJpdGVtIiwgImltcG9ydF9vYnNpZGlhbiIsICJpbXBvcnRfb2JzaWRpYW4iLCAiZmFpbHVyZSIsICJpbXBvcnRfb2JzaWRpYW4iLCAiaW1wb3J0X29ic2lkaWFuIiwgImltcG9ydF9vYnNpZGlhbiJdCn0K
