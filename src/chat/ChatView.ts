import { ItemView, MarkdownRenderer, WorkspaceLeaf } from "obsidian";
import { LearningController } from "../learning/LearningController";
import {
  LearningActionKind,
  LearningEvent,
} from "../learning/learning-types";
import { LearningContext } from "../context/context-types";
import {
  PracticeEvaluation,
  PracticeQuestion,
} from "../learning/practice-types";
import { AgentContext, EditProposal } from "../types";

export const FORGE_VIEW_TYPE = "forge-sidebar";

type UIState =
  | "EMPTY"
  | "RUNNING"
  | "ANSWER"
  | "PROPOSAL"
  | "APPLIED"
  | "ERROR";

const ACTIONS: Array<{
  kind: LearningActionKind;
  label: string;
}> = [
  { kind: "ask", label: "Ask" },
  { kind: "explain", label: "Explain" },
  { kind: "practice", label: "Practice" },
  { kind: "review", label: "Review" },
  { kind: "edit", label: "Edit" },
];

const PROMPT_COMMANDS: Array<{
  kind: LearningActionKind;
  name: string;
  description: string;
}> = [
  { kind: "ask", name: "/ask", description: "Ask about the current context" },
  { kind: "explain", name: "/explain", description: "Break down a concept" },
  { kind: "practice", name: "/practice", description: "Generate a practice question" },
  { kind: "review", name: "/review", description: "Review understanding and gaps" },
  { kind: "edit", name: "/edit", description: "Improve the current note" },
];

type PromptMenuKind = "source" | "command";

function parsePromptToken(value: string): {
  kind: PromptMenuKind;
  query: string;
  start: number;
} | null {
  const match = /(^|\s)([@/])([\w-]*)$/.exec(value);
  if (!match) return null;

  return {
    kind: match[2] === "@" ? "source" : "command",
    query: match[3].toLowerCase(),
    start: match.index + match[1].length,
  };
}

export class ChatView extends ItemView {
  private thread!: HTMLElement;
  private composer!: HTMLElement;
  private headerEl!: HTMLElement;

  private input!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private selectionChip!: HTMLElement;
  private noteChip!: HTMLElement;
  private cancelBtn!: HTMLButtonElement;
  private modelSelect!: HTMLSelectElement;
  private dictationBtn!: HTMLButtonElement;
  private fileInput!: HTMLInputElement;
  private promptPlusBtn!: HTMLButtonElement;
  private attachmentsEl: HTMLElement | null = null;
  private promptMenuEl: HTMLElement | null = null;
  private promptMenu: PromptMenuKind | null = null;
  private promptMenuActive = 0;
  private promptMenuRows: HTMLButtonElement[] = [];
  private dictationRecognition: any = null;
  private dictationListening = false;
  private attachments: Array<{ name: string; context: AgentContext }> = [];

  private agentCursorEl: HTMLElement | null = null;
  private agentContentEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private loadingElapsedEl: HTMLElement | null = null;
  private loadingStartedAt = 0;
  private loadingTimer: number | null = null;
  private thinkingToggleEl: HTMLButtonElement | null = null;
  private thinkingLabelEl: HTMLElement | null = null;
  private thinkingChevronEl: HTMLElement | null = null;
  private thinkingPanelEl: HTMLElement | null = null;
  private thinkingRows: HTMLElement[] = [];
  private thinkingStageTimer: number | null = null;
  private thinkingStage = 0;
  private thinkingManualExpanded: boolean | null = null;
  private streamedResponseText = "";
  private streamingPendingText = "";
  private responseTimeEl: HTMLElement | null = null;

  private uiState: UIState = "EMPTY";
  private selectedAction: LearningActionKind = "ask";
  private actionButtons = new Map<LearningActionKind, HTMLButtonElement>();

  private extraCtx: AgentContext[] = [];
  private currentContext: LearningContext | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly learning: LearningController,
  ) {
    super(leaf);
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

  async onOpen(): Promise<void> {
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
      }),
    );
    this.registerEvent(
      this.app.workspace.on("editor-selection-change" as any, () => {
        void this.syncChips();
      }),
    );

    void this.refreshModelList();
  }

  async onClose(): Promise<void> {
    this.learning.cancel();
    this.dictationRecognition?.stop?.();
    this.dictationRecognition = null;
    this.dictationListening = false;
    this.stopThinkingSequence();
    this.stopLoadingTimer();
  }

  private buildHeader(root: HTMLElement): void {
    this.headerEl = root.createDiv({ cls: "forge-header" });
    const top = this.headerEl.createDiv({ cls: "forge-header-top" });
    const brand = top.createDiv({ cls: "forge-header-brand" });
    brand.createSpan({ cls: "forge-header-mark", text: "✦" });

    const copy = brand.createDiv({ cls: "forge-header-copy" });
    copy.createSpan({
      cls: "forge-header-title",
      text: "Forge",
    });
    copy.createSpan({
      cls: "forge-header-subtitle",
      text: "Learning OS",
    });

    const right = top.createDiv({ cls: "forge-header-right" });

    const newBtn = right.createEl("button", {
      cls: "forge-new-btn",
      text: "＋",
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

  private buildActionButtons(parent: HTMLElement): void {
    for (const action of ACTIONS) {
      const button = parent.createEl("button", {
        cls: "forge-action-btn",
        text: action.label,
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

  private async refreshModelList(): Promise<void> {
    let models = this.learning.getModels();

    if (models.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      models = this.learning.getModels();
    }

    if (models.length === 0) return;

    this.modelSelect.empty();
    const currentModel = this.learning.getSession().model;

    for (const model of models) {
      const option = this.modelSelect.createEl("option", {
        value: model.id,
        text: model.name,
      });

      if (model.id === currentModel) option.selected = true;
    }
  }

  private buildComposer(parent: HTMLElement): void {
    const contextRow = parent.createDiv({ cls: "forge-context-row" });
    contextRow.createSpan({
      cls: "forge-context-label",
      text: "Using",
    });

    const chips = contextRow.createDiv({ cls: "forge-chips" });

    this.selectionChip = chips.createSpan({
      cls: "forge-chip forge-chip--hidden",
    });
    this.selectionChip.createSpan({ cls: "forge-chip-dot" });
    this.selectionChip.createSpan({
      cls: "forge-chip-label",
      text: "@selection",
    });

    this.noteChip = chips.createSpan({
      cls: "forge-chip forge-chip--hidden",
    });
    this.noteChip.createSpan({ cls: "forge-chip-dot" });
    this.noteChip.createSpan({
      cls: "forge-chip-label",
      text: "@note",
    });

    const anchor = parent.createDiv({ cls: "forge-prompt-anchor" });
    this.promptMenuEl = anchor.createDiv({
      cls: "forge-prompt-menu forge-hidden",
    });

    const box = anchor.createDiv({ cls: "forge-composer-box" });
    box.addEventListener("click", (event) => {
      if (!(event.target instanceof HTMLButtonElement) &&
          !(event.target instanceof HTMLSelectElement)) {
        this.input.focus();
      }
    });

    this.attachmentsEl = box.createDiv({
      cls: "forge-attachments forge-hidden",
    });

    this.fileInput = box.createEl("input", {
      cls: "forge-file-input",
      attr: {
        type: "file",
        multiple: "",
        accept: ".md,.txt,.csv,.json,.yaml,.yml",
      },
    });
    this.fileInput.addEventListener("change", () => {
      void this.handleFiles(this.fileInput.files);
    });

    const controls = box.createDiv({ cls: "forge-composer-controls" });
    this.promptPlusBtn = controls.createEl("button", {
      cls: "forge-prompt-plus",
      text: "＋",
      attr: {
        type: "button",
        "aria-label": "Add context or file",
        "aria-expanded": "false",
      },
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
        placeholder: "Ask about what you're learning…",
        rows: "1",
      },
    });
    this.input.addEventListener("input", () => this.onInput());
    this.input.addEventListener("keydown", (event) => this.onKey(event));

    const footer = box.createDiv({ cls: "forge-composer-footer" });
    const tools = footer.createDiv({ cls: "forge-composer-tools" });

    this.modelSelect = tools.createEl("select", {
      cls: "forge-model-select",
    });
    this.modelSelect.addEventListener("change", () => {
      this.learning.setModel(this.modelSelect.value);
    });
    this.modelSelect.setAttribute("aria-label", "Learning model");
    this.modelSelect.title = "Learning model";
    this.modelSelect.createEl("option", {
      text: "Loading models…",
      attr: {
        disabled: "",
        selected: "",
      },
    });

    this.dictationBtn = tools.createEl("button", {
      cls: "forge-composer-icon-btn",
      text: "◉",
      attr: {
        type: "button",
        "aria-label": "Start dictation",
        "aria-pressed": "false",
      },
    });
    this.dictationBtn.title = "Start dictation";
    this.dictationBtn.addEventListener("click", () => this.toggleDictation());

    const btnGroup = footer.createDiv({ cls: "forge-btn-group" });

    this.cancelBtn = btnGroup.createEl("button", {
      cls: "forge-cancel-btn forge-hidden",
      text: "×",
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
      text: "↑",
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
      text: "Enter to send · Shift + Enter for a new line",
    });
  }

  private renderAttachments(): void {
    if (!this.attachmentsEl) return;

    this.attachmentsEl.empty();
    this.attachmentsEl.toggleClass("forge-hidden", this.attachments.length === 0);

    for (const [index, attachment] of this.attachments.entries()) {
      const chip = this.attachmentsEl.createDiv({
        cls: "forge-attachment-chip",
      });
      chip.createSpan({ cls: "forge-attachment-icon", text: "▧" });
      chip.createSpan({ cls: "forge-attachment-name", text: attachment.name });

      const remove = chip.createEl("button", {
        cls: "forge-attachment-remove",
        text: "×",
        attr: {
          type: "button",
          "aria-label": `Remove ${attachment.name}`,
        },
      });
      remove.addEventListener("click", () => {
        this.attachments.splice(index, 1);
        this.extraCtx = this.attachments.map((item) => item.context);
        this.renderAttachments();
        void this.syncChips();
      });
    }
  }

  private async handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;

    this.closePromptMenu();

    for (const file of Array.from(files)) {
      const content = await file.text();
      this.attachments.push({
        name: file.name,
        context: {
          type: "note",
          file: `attachment/${file.name}`,
          content,
        },
      });
    }

    this.extraCtx = this.attachments.map((item) => item.context);
    this.renderAttachments();
    this.fileInput.value = "";
    await this.syncChips();
    this.input.focus();
  }

  private getPromptMenuItems(): Array<{
    key: string;
    name: string;
    description: string;
    action: "attach" | "selection" | "note" | LearningActionKind;
  }> {
    if (this.promptMenu === "command") {
      return PROMPT_COMMANDS.map((command) => ({
        key: command.kind,
        name: command.name,
        description: command.description,
        action: command.kind,
      }));
    }

    const items: Array<{
      key: string;
      name: string;
      description: string;
      action: "attach" | "selection" | "note";
    }> = [
      {
        key: "attach",
        name: "Add text files",
        description: "Attach Markdown or data context",
        action: "attach",
      },
    ];

    if (this.currentContext?.selection) {
      items.push({
        key: "selection",
        name: "Current selection",
        description: "Use the selected text",
        action: "selection",
      });
    }

    if (this.currentContext?.activeNote) {
      items.push({
        key: "note",
        name: "Current note",
        description: "Use the active note",
        action: "note",
      });
    }

    return items;
  }

  private renderPromptMenu(): void {
    if (!this.promptMenuEl) return;

    this.promptMenuEl.empty();
    this.promptMenuRows = [];
    this.promptMenuEl.toggleClass("forge-hidden", this.promptMenu === null);
    this.promptPlusBtn?.setAttribute(
      "aria-expanded",
      String(this.promptMenu !== null),
    );

    if (!this.promptMenu) return;

    const token = parsePromptToken(this.input.value);
    const query = token?.kind === this.promptMenu ? token.query : "";
    const rows = this.getPromptMenuItems().filter((item) =>
      `${item.name} ${item.description}`.toLowerCase().includes(query),
    );

    rows.forEach((item, index) => {
      const button = this.promptMenuEl!.createEl("button", {
        cls: `forge-prompt-menu-row${index === this.promptMenuActive ? " is-active" : ""}`,
        attr: { type: "button" },
      });
      button.createSpan({ cls: "forge-prompt-menu-icon", text: item.action === "attach" ? "＋" : "@" });
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
        text: `No matches for “${query}”`,
      });
    }

    this.promptMenuEl.createDiv({
      cls: "forge-prompt-menu-hint",
      text: this.promptMenu === "source"
        ? "Select a source or attach a text file"
        : "Choose a learning action",
    });
  }

  private pickPromptMenuItem(item: {
    name: string;
    action: "attach" | "selection" | "note" | LearningActionKind;
  }): void {
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

  private closePromptMenu(): void {
    this.promptMenu = null;
    this.promptMenuActive = 0;
    this.renderPromptMenu();
  }

  private setupDictation(): void {
    const SpeechRecognition = (window as any).SpeechRecognition ??
      (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
      this.dictationBtn.disabled = true;
      this.dictationBtn.title = "Dictation is unavailable in this environment";
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = "id-ID";
    recognition.onresult = (event: any) => {
      const transcript = event.results?.[0]?.[0]?.transcript?.trim();
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

  private toggleDictation(): void {
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
    } catch {
      this.dictationListening = false;
      this.syncDictationButton();
    }
  }

  private syncDictationButton(): void {
    if (!this.dictationBtn) return;

    this.dictationBtn.toggleClass("is-active", this.dictationListening);
    this.dictationBtn.setAttribute("aria-pressed", String(this.dictationListening));
    this.dictationBtn.setAttribute(
      "aria-label",
      this.dictationListening ? "Stop dictation" : "Start dictation",
    );
    this.dictationBtn.title = this.dictationListening ? "Stop dictation" : "Start dictation";
    this.dictationBtn.textContent = this.dictationListening ? "◌" : "◉";
  }

  private syncActionButtons(): void {
    for (const [kind, button] of this.actionButtons) {
      const active = kind === this.selectedAction;
      button.toggleClass("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  private updatePlaceholder(): void {
    const placeholders: Record<LearningActionKind, string> = {
      ask: "Ask about what you're learning…",
      explain: "What should I explain?",
      practice: "What should we practice?",
      review: "What should I review?",
      edit: "How should I improve this note?",
    };

    if (this.input) {
      this.input.placeholder = placeholders[this.selectedAction];
    }
  }

  private async syncChips(): Promise<void> {
    const context = await this.learning.resolveContext(this.extraCtx);
    this.currentContext = context;

    const hasSelection = Boolean(context.selection);
    this.selectionChip.toggleClass("agy-chip--hidden", !hasSelection);

    const activeNote = context.activeNote;
    this.noteChip.toggleClass("agy-chip--hidden", !activeNote);

    if (activeNote) {
      const name = activeNote.path.split("/").pop() ?? activeNote.path;
      const label = this.noteChip.querySelector<HTMLElement>(".agy-chip-label");
      if (label) label.textContent = `@${name}`;
      this.noteChip.title = activeNote.path;
    }
  }

  private onInput(): void {
    this.sendBtn.disabled =
      !this.canSend() || this.uiState === "RUNNING";

    const token = parsePromptToken(this.input.value);
    if (token && this.promptMenu !== token.kind) {
      this.promptMenu = token.kind;
      this.promptMenuActive = 0;
    } else if (!token) {
      this.closePromptMenu();
    }

    this.renderPromptMenu();

    this.input.style.height = "auto";
    this.input.style.height =
      Math.min(this.input.scrollHeight, 80) + "px";
  }

  private onKey(event: KeyboardEvent): void {
    if (this.promptMenu && this.promptMenuRows.length > 0) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        const direction = event.key === "ArrowDown" ? 1 : -1;
        this.promptMenuActive =
          (this.promptMenuActive + direction + this.promptMenuRows.length) %
          this.promptMenuRows.length;
        this.promptMenuRows.forEach((row, index) => {
          row.toggleClass("is-active", index === this.promptMenuActive);
        });
        return;
      }

      if ((event.key === "Enter" && !event.shiftKey) || event.key === "Tab") {
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

  private async doSend(): Promise<void> {
    const prompt = this.input.value.trim() || "Review the attached context.";
    if (!this.canSend() || this.uiState === "RUNNING") return;

    const explicitContext = this.extraCtx;
    this.closePromptMenu();
    if (this.dictationListening) this.dictationRecognition?.stop?.();

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
        "No response after 60 s. The agent runtime may be busy.",
      );
    }, 60_000);

    try {
      for await (const event of this.learning.run({
        prompt,
        action: this.selectedAction,
        explicitContext,
      })) {
        this.handleLearningEvent(event, timeout);
      }
    } catch (err) {
      window.clearTimeout(timeout);
      this.finishStreamingBubble("Stopped");

      const message =
        err instanceof Error ? err.message : String(err);

      if (message.includes("not found") || message.includes("ENOENT")) {
        this.showError("Agent runtime not found. Check Forge runtime settings.");
      } else {
        console.warn("[Forge] Agent runtime error", message);
        this.appendInlineError(
          this.thread,
          this.runtimeErrorMessage(err),
        );
        this.setUIState("ANSWER");
      }
    }
  }

  private handleLearningEvent(
    event: LearningEvent,
    timeout: number,
  ): void {
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
      // Durable progress is intentionally quiet. The interaction itself is the
      // primary UI; progress state is supporting context for future turns.
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
        this.runtimeErrorMessage(event.message),
      );
      this.setUIState("ANSWER");
    }
  }

  private finishStreamingBubble(doneLabel?: string): void {
    const elapsed = this.formatElapsed(Date.now() - this.loadingStartedAt);
    this.stopThinkingSequence();
    this.flushStreamingText();
    this.renderMarkdownResponse();
    if (doneLabel === undefined) this.appendStreamActions();
    this.settleThinking(doneLabel ?? `Thought for ${elapsed}`);
    if (this.responseTimeEl) this.responseTimeEl.textContent = `for ${elapsed}`;
    this.stopLoadingTimer();
    this.agyCursorEl?.removeClass("forge-bubble--streaming");
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

  private settleThinking(doneLabel: string): void {
    if (!this.thinkingLabelEl) return;

    this.thinkingLabelEl.textContent = doneLabel;
    this.thinkingLabelEl.removeClass("forge-thinking-label--active");
    this.thinkingLabelEl.addClass("forge-thinking-label--done");

    for (const row of this.thinkingRows) {
      row.removeClass("forge-hidden");
      row.removeClass("is-active");
      row.addClass("is-done");

      const marker = row.firstElementChild as HTMLElement | null;
      if (marker) {
        marker.textContent = "✓";
        marker.removeClass("forge-thinking-marker--spinner");
      }
    }

    const expanded = this.thinkingManualExpanded ?? false;
    this.thinkingPanelEl?.toggleClass("is-expanded", expanded);
    this.thinkingToggleEl?.setAttribute("aria-expanded", String(expanded));
    this.thinkingChevronEl?.toggleClass("is-expanded", expanded);
  }

  private stopThinkingSequence(): void {
    if (this.thinkingStageTimer !== null) {
      window.clearTimeout(this.thinkingStageTimer);
      this.thinkingStageTimer = null;
    }
  }

  private startThinkingSequence(): void {
    this.thinkingStage = 0;
    this.renderThinkingStage();
    this.scheduleThinkingStage();
  }

  private scheduleThinkingStage(): void {
    if (this.thinkingStage >= this.thinkingRows.length - 1) return;

    const delays = [800, 600, 1800, 2600];
    const delay = delays[this.thinkingStage] ?? 1200;

    this.thinkingStageTimer = window.setTimeout(() => {
      this.thinkingStage += 1;
      this.renderThinkingStage();
      this.scheduleThinkingStage();
    }, delay);
  }

  private renderThinkingStage(): void {
    const visible = Math.min(
      this.thinkingStage + 1,
      this.thinkingRows.length,
    );

    this.thinkingRows.forEach((row, index) => {
      const active = index === visible - 1;
      const done = index < visible - 1;
      const marker = row.firstElementChild as HTMLElement | null;

      row.toggleClass("forge-hidden", index >= visible);
      row.toggleClass("is-active", active);
      row.toggleClass("is-done", done);

      if (marker) {
        marker.textContent = done ? "✓" : "";
        marker.toggleClass("forge-thinking-marker--spinner", active);
      }
    });
  }

  private startLoadingTimer(): void {
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

  private stopLoadingTimer(): void {
    if (this.loadingTimer !== null) {
      window.clearInterval(this.loadingTimer);
      this.loadingTimer = null;
    }

    this.loadingElapsedEl = null;
  }

  private formatElapsed(milliseconds: number): string {
    const seconds = milliseconds / 1000;

    if (seconds < 60) return `${seconds.toFixed(1)}s`;

    return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`;
  }

  private setUIState(state: UIState): void {
    this.uiState = state;

    const busy = state === "RUNNING";
    this.input.disabled = busy || state === "ERROR";
    this.sendBtn.disabled =
      busy || state === "ERROR" || !this.canSend();
    this.cancelBtn.toggleClass("forge-hidden", !busy);
  }

  private canSend(): boolean {
    return this.input.value.trim().length > 0 || this.attachments.length > 0;
  }

  private showEmpty(): void {
    this.stopLoadingTimer();
    this.thread.empty();
    this.agyCursorEl = null;
    this.statusEl = null;

    const slate = this.thread.createDiv({
      cls: "forge-empty-slate",
    });
    slate.createDiv({
      cls: "forge-empty-mark",
      text: "✦",
    });
    slate.createDiv({
      cls: "forge-empty-kicker",
      text: "LEARNING OS",
    });

    let label = "Open a note or ask about your Learning OS.";

    if (this.currentContext?.selection) {
      label = "Selection ready — explain, practice, review, or edit it.";
    } else if (this.currentContext?.activeNote) {
      const name =
        this.currentContext.activeNote.path.split("/").pop() ??
        this.currentContext.activeNote.path;
      label = `Learn with ${name}`;
    }

    slate.createDiv({
      cls: "forge-empty-label",
      text: label,
    });
    slate.createDiv({
      cls: "forge-empty-hint",
      text: "Ask, explain, practice, review, or edit from the current context.",
    });

    this.setUIState("EMPTY");
  }

  private showError(message: string): void {
    this.stopLoadingTimer();
    this.thread.empty();
    this.agyCursorEl = null;
    this.statusEl = null;

    const slate = this.thread.createDiv({
      cls: "forge-error-slate",
    });
    slate.createDiv({
      cls: "forge-error-icon",
      text: "⚠",
    });
    slate.createDiv({
      cls: "forge-error-title",
      text: "Forge unavailable",
    });
    slate.createDiv({
      cls: "forge-error-body",
      text: message,
    });

    const button = slate.createEl("button", {
      cls: "forge-configure-btn",
      text: "Configure Forge →",
    });
    button.addEventListener("click", () => {
      (this.app as any).setting?.open?.();
    });

    this.setUIState("ERROR");
  }

  private runtimeErrorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);

    if (message.includes("not found") || message.includes("ENOENT")) {
      return "Agent runtime not found. Check Forge runtime settings.";
    }

    return "Forge could not complete the request. Check the agent runtime connection and try again.";
  }

  private appendUserBubble(text: string): void {
    this.thread.querySelector(".forge-empty-slate")?.remove();
    const bubble = this.thread.createDiv({
      cls: "forge-bubble forge-bubble--user",
    });
    bubble.setText(text);
  }

  private ensureAgentBubble(): void {
    if (this.agyCursorEl) return;

    this.statusEl = this.buildThinkingTrace();

    this.agyCursorEl = this.thread.createDiv({
      cls: "forge-bubble forge-bubble--agent forge-bubble--streaming",
    });
    const meta = this.agyCursorEl.createDiv({ cls: "forge-response-meta" });
    meta.createSpan({ cls: "forge-response-label", text: "Forge" });
    meta.createSpan({
      cls: "forge-response-sub",
      text: ACTIONS.find((action) => action.kind === this.selectedAction)?.label ?? "Response",
    });
    this.responseTimeEl = meta.createSpan({ cls: "forge-response-time", text: "for 0.0s" });
    this.agyContentEl = this.agyCursorEl.createDiv({
      cls: "forge-bubble-content",
    });
  }

  private buildThinkingTrace(): HTMLElement {
    const trace = this.thread.createDiv({
      cls: "forge-thinking",
    });
    trace.setAttribute("role", "status");
    trace.setAttribute("aria-live", "polite");

    const toggle = trace.createEl("button", {
      cls: "forge-thinking-toggle",
      attr: {
        type: "button",
        "aria-expanded": "true",
      },
    });
    this.thinkingToggleEl = toggle;

    toggle.createSpan({
      cls: "forge-thinking-icon",
      text: "✦",
    });

    this.thinkingLabelEl = toggle.createSpan({
      cls: "forge-thinking-label forge-thinking-label--active",
      text: "Thinking",
    });

    this.loadingElapsedEl = toggle.createSpan({
      cls: "forge-thinking-elapsed",
    });
    this.loadingElapsedEl.setAttribute("aria-hidden", "true");

    const chevron = toggle.createSpan({
      cls: "forge-thinking-chevron",
      text: "⌄",
    });
    this.thinkingChevronEl = chevron;

    const panel = trace.createDiv({
      cls: "forge-thinking-panel is-expanded",
    });
    this.thinkingPanelEl = panel;

    const traceList = panel.createDiv({
      cls: "forge-thinking-trace",
    });
    const source = this.currentContext?.selection
      ? this.currentContext.selection.file
      : this.currentContext?.activeNote?.path;
    const sourceName = source?.split("/").pop();
    const readingLabel = this.currentContext?.selection
      ? "Reading selected text"
      : this.currentContext?.activeNote
        ? "Reading current note"
        : "Resolving workspace context";

    const rows = [
      { primary: "Resolving current context" },
      { primary: readingLabel, secondary: sourceName },
      { primary: "Loading Learning OS policy" },
      { primary: "Preparing response" },
    ];

    this.thinkingRows = rows.map((row) => {
      const rowEl = traceList.createDiv({
        cls: "forge-thinking-row",
      });
      rowEl.createSpan({
        cls: "forge-thinking-marker forge-thinking-marker--spinner",
      });
      rowEl.createSpan({
        cls: "forge-thinking-primary",
        text: row.primary,
      });

      if (row.secondary) {
        rowEl.createSpan({
          cls: "forge-thinking-secondary",
          text: row.secondary,
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

  private appendToAgentBubble(text: string): void {
    if (!this.agyContentEl) return;

    this.streamedResponseText += text;
    this.streamingPendingText += text;

    const parts = this.streamingPendingText.split(/(\s+)/);
    const lastPart = parts[parts.length - 1] ?? "";
    const hasTrailingWhitespace = /\s$/.test(this.streamingPendingText);

    if (!hasTrailingWhitespace) {
      this.streamingPendingText = parts.pop() ?? lastPart;
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
        text: part,
      });
    }

    this.scrollThread();
  }

  private flushStreamingText(): void {
    if (!this.agyContentEl || !this.streamingPendingText) return;

    this.agyContentEl.createSpan({
      cls: "forge-stream-word",
      text: this.streamingPendingText,
    });
    this.streamingPendingText = "";
  }

  private renderMarkdownResponse(): void {
    if (!this.agyContentEl || !this.streamedResponseText.trim()) return;

    const content = this.agyContentEl;
    const markdown = this.streamedResponseText;
    const sourcePath =
      this.currentContext?.selection?.file ??
      this.currentContext?.activeNote?.path ??
      "Forge.md";

    content.empty();
    content.addClass("forge-markdown");

    void MarkdownRenderer.render(this.app, markdown, content, sourcePath, this).catch(() => {
      content.empty();
      content.removeClass("forge-markdown");
      content.addClass("forge-markdown-error");
      content.setText("Markdown response could not be rendered.");
    });
  }

  private appendStreamActions(): void {
    if (!this.agyCursorEl || !this.streamedResponseText.trim()) return;

    const responseText = this.streamedResponseText.trim();
    const actions = this.agyCursorEl.createDiv({
      cls: "forge-stream-actions",
    });
    const copyButton = actions.createEl("button", {
      cls: "forge-stream-action",
      text: "Copy",
      attr: {
        type: "button",
        "aria-label": "Copy response",
      },
    });

    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(responseText);
        copyButton.textContent = "Copied";
      } catch {
        copyButton.textContent = "Copy failed";
      }

      window.setTimeout(() => {
        copyButton.textContent = "Copy";
      }, 1400);
    });
  }

  private appendPracticeQuestion(
    question: PracticeQuestion,
  ): void {
    if (!this.agyCursorEl) return;

    const card = this.agyCursorEl.createDiv({
      cls: "forge-practice-card",
    });
    card.createDiv({
      cls: "forge-practice-label",
      text: `Practice · ${question.concept}`,
    });
    card.createDiv({
      cls: "forge-practice-question",
      text: question.question,
    });

    if (question.hint) {
      card.createDiv({
        cls: "forge-practice-hint",
        text: `Hint: ${question.hint}`,
      });
    }

    this.scrollThread();
  }

  private appendPracticeEvaluation(
    evaluation: PracticeEvaluation,
  ): void {
    if (!this.agyCursorEl) return;

    const card = this.agyCursorEl.createDiv({
      cls: "forge-practice-evaluation",
    });

    const outcomeLabel =
      evaluation.outcome === "correct"
        ? "Correct"
        : evaluation.outcome === "partial"
          ? "Partial"
          : "Needs work";

    card.createDiv({
      cls: "forge-practice-label",
      text: `${outcomeLabel} · ${evaluation.concept}`,
    });
    card.createDiv({
      cls: "forge-practice-feedback",
      text: evaluation.feedback,
    });

    if (evaluation.misconceptions.length > 0) {
      const gaps = card.createDiv({
        cls: "forge-practice-gaps",
      });
      gaps.createDiv({
        cls: "forge-practice-gaps-label",
        text: "Gap",
      });

      for (const misconception of evaluation.misconceptions) {
        gaps.createDiv({
          cls: "forge-practice-gap",
          text: misconception,
        });
      }
    }

    this.scrollThread();
  }

  private appendProposalBubble(proposal: EditProposal): void {
    const wrap = this.thread.createDiv({
      cls: "forge-proposal",
    });

    wrap.createDiv({
      cls: "forge-proposal-badge",
      text: "📄 " + proposal.file,
    });

    if (proposal.reason) {
      wrap.createDiv({
        cls: "forge-proposal-reason",
        text: proposal.reason,
      });
    }

    const diff = wrap.createDiv({
      cls: "forge-proposal-diff",
    });

    proposal.original.split("\n").forEach((line) => {
      diff.createDiv({
        cls: "forge-diff-removed",
        text: "- " + line,
      });
    });

    proposal.replacement.split("\n").forEach((line) => {
      diff.createDiv({
        cls: "forge-diff-added",
        text: "+ " + line,
      });
    });

    const actions = wrap.createDiv({
      cls: "forge-proposal-actions",
    });

    const rejectBtn = actions.createEl("button", {
      cls: "forge-btn-reject",
      text: "Reject",
    });

    const applyBtn = actions.createEl("button", {
      cls: "forge-btn-apply",
      text: "Apply ✓",
    });

    rejectBtn.addEventListener("click", () => {
      actions.remove();
      wrap.createDiv({
        cls: "forge-result-badge forge-badge--rejected",
        text: "✕ Rejected",
      });
      this.setUIState("ANSWER");
    });

    applyBtn.addEventListener("click", async () => {
      applyBtn.disabled = true;
      applyBtn.textContent = "Applying…";

      const result = await this.learning.applyProposal(proposal);
      actions.remove();

      if (result.ok) {
        wrap.createDiv({
          cls: "forge-result-badge forge-badge--applied",
          text: "✓ Applied to " + proposal.file,
        });
        this.setUIState("APPLIED");
      } else {
        wrap.createDiv({
          cls: "forge-result-badge forge-badge--stale",
          text: "⚠ " + result.message,
        });
        this.setUIState("ANSWER");
      }
    });

    this.scrollThread();
  }

  private appendInlineError(
    parent: HTMLElement,
    message: string,
  ): void {
    parent.createDiv({
      cls: "forge-inline-error",
      text: "⚠ " + message,
    });
    this.scrollThread();
  }

  private scrollThread(): void {
    this.thread.scrollTo({
      top: this.thread.scrollHeight,
      behavior: "smooth",
    });
  }
}
