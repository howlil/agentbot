import {
  ItemView,
  MarkdownRenderer,
  setIcon,
  WorkspaceLeaf,
  type IconName,
} from "obsidian";
import { LearningController } from "../learning/LearningController";
import {
  LearningActionKind,
  LearningEvent,
} from "../learning/learning-types";
import {
  ExplicitContextRef,
  LearningContext,
} from "../context/context-types";
import {
  PracticeEvaluation,
  PracticeQuestion,
} from "../learning/practice-types";
import { ReviewFinding } from "../learning/review-types";
import { ChatMessage, EditProposal } from "../types";
import { ProposedEdit } from "../learning/learning-types";
import {
  parsePromptToken,
  PromptMenuKind,
} from "./prompt-token";
import { NOX_CAPABILITIES } from "./capabilities";

export const NOX_VIEW_TYPE = "nox-sidebar";

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
  ...NOX_CAPABILITIES.map((capability) => ({
    kind: capability.action,
    label: capability.title,
  })),
];

const PROMPT_COMMANDS: Array<{
  kind: Exclude<LearningActionKind, "ask">;
  name: string;
  description: string;
}> = NOX_CAPABILITIES.map((capability) => ({
  kind: capability.action,
  name: capability.title,
  description: capability.description,
}));

type PromptMenuAction =
  | { type: "attach" }
  | { type: "info" }
  | { type: "vault-note"; path: string }
  | { type: "learning"; kind: Exclude<LearningActionKind, "ask"> };

interface PromptMenuItem {
  key: string;
  name: string;
  description: string;
  icon: IconName;
  disabled?: boolean;
  action: PromptMenuAction;
}

function setNoxIcon(element: HTMLElement, icon: IconName): void {
  element.empty();
  setIcon(element, icon);
}

export class ChatView extends ItemView {
  private thread!: HTMLElement;
  private composer!: HTMLElement;
  private headerEl!: HTMLElement;

  private input!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private selectionChip!: HTMLElement;
  private noteChip!: HTMLElement;
  private systemChip!: HTMLElement;
  private cancelBtn!: HTMLButtonElement;
  private modelSelect!: HTMLSelectElement;
  private fileInput!: HTMLInputElement;
  private promptPlusBtn!: HTMLButtonElement;
  private attachmentsEl: HTMLElement | null = null;
  private intentEl: HTMLElement | null = null;
  private promptMenuEl: HTMLElement | null = null;
  private promptMenu: PromptMenuKind | null = null;
  private promptMenuActive = 0;
  private promptMenuRows: HTMLButtonElement[] = [];
  private promptMenuRequest = 0;
  private attachments: Array<{
    name: string;
    ref: ExplicitContextRef;
  }> = [];

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
  private runningAction: LearningActionKind | null = null;
  private actionButtons = new Map<LearningActionKind, HTMLButtonElement>();
  private systemContextFiles: string[] = [];

  private extraCtx: ExplicitContextRef[] = [];
  private currentContext: LearningContext | null = null;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly learning: LearningController,
    private readonly openSettings: () => void,
    private readonly getLogoUrl: () => string,
  ) {
    super(leaf);
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

  async onOpen(): Promise<void> {
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
    } catch {
      this.showError("Agent runtime is unavailable. Check Nox runtime settings.");
      return;
    }

    await this.syncChips();
    await this.restoreSession();

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
    this.stopThinkingSequence();
    this.stopLoadingTimer();
  }

  focusComposer(): void {
    this.input?.focus();
  }

  private buildHeader(root: HTMLElement): void {
    this.headerEl = root.createDiv({ cls: "nox-header" });
    const top = this.headerEl.createDiv({ cls: "nox-header-top" });
    const brand = top.createDiv({ cls: "nox-header-brand" });
    brand.createEl("img", {
      cls: "nox-header-logo",
      attr: {
        src: this.getLogoUrl(),
        alt: "Nox",
      },
    });

    const copy = brand.createDiv({ cls: "nox-header-copy" });
    copy.createSpan({ cls: "nox-header-title", text: "Nox" });

    const right = top.createDiv({ cls: "nox-header-right" });

    const newBtn = right.createEl("button", {
      cls: "nox-new-btn",
      attr: {
        type: "button",
        "aria-label": "New learning session",
      },
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
        "aria-label": "Open Nox settings",
      },
    });
    setNoxIcon(moreBtn, "more-horizontal");
    moreBtn.title = "Nox settings";
    moreBtn.addEventListener("click", () => this.openSettings());
  }

  private buildActionButtons(parent: HTMLElement): void {
    for (const action of ACTIONS) {
      const button = parent.createEl("button", {
        cls: "nox-action-btn",
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

    this.modelSelect.empty();
    const currentModel = this.learning.getSession().model;

    const defaultOption = this.modelSelect.createEl("option", {
      value: "",
      text: "Runtime default",
    });
    defaultOption.selected = !currentModel;

    for (const model of models) {
      const option = this.modelSelect.createEl("option", {
        value: model.id,
        text: model.name,
      });

      if (model.id === currentModel) option.selected = true;
    }
  }

  private buildComposer(parent: HTMLElement): void {
    const contextRow = parent.createDiv({ cls: "nox-context-row" });
    contextRow.createSpan({
      cls: "nox-context-label",
      text: "Using",
    });

    const chips = contextRow.createDiv({ cls: "nox-chips" });

    this.selectionChip = chips.createSpan({
      cls: "nox-chip nox-chip--hidden",
    });
    this.selectionChip.createSpan({ cls: "nox-chip-dot" });
    this.selectionChip.createSpan({
      cls: "nox-chip-label",
      text: "@selection",
    });

    this.noteChip = chips.createSpan({
      cls: "nox-chip nox-chip--hidden",
    });
    this.noteChip.createSpan({ cls: "nox-chip-dot" });
    this.noteChip.createSpan({
      cls: "nox-chip-label",
      text: "@note",
    });

    this.systemChip = chips.createSpan({
      cls: "nox-chip nox-chip--hidden",
    });
    this.systemChip.createSpan({ cls: "nox-chip-dot" });
    this.systemChip.createSpan({
      cls: "nox-chip-label",
      text: "@nox-system",
    });

    const anchor = parent.createDiv({ cls: "nox-prompt-anchor" });
    this.promptMenuEl = anchor.createDiv({
      cls: "nox-prompt-menu nox-hidden",
    });

    const box = anchor.createDiv({ cls: "nox-composer-box" });
    box.addEventListener("click", (event) => {
      if (!(event.target instanceof HTMLButtonElement) &&
          !(event.target instanceof HTMLSelectElement)) {
        this.input.focus();
      }
    });

    this.intentEl = box.createDiv({
      cls: "nox-intent-row nox-hidden",
    });

    this.attachmentsEl = box.createDiv({
      cls: "nox-attachments nox-hidden",
    });

    this.fileInput = box.createEl("input", {
      cls: "nox-file-input",
      attr: {
        type: "file",
        multiple: "",
        accept: ".md,.txt,.csv,.json,.yaml,.yml",
      },
    });
    this.fileInput.addEventListener("change", () => {
      void this.handleFiles(this.fileInput.files);
    });

    const controls = box.createDiv({ cls: "nox-composer-controls" });

    this.input = controls.createEl("textarea", {
      cls: "nox-input",
      attr: {
        placeholder: "Ask anything about this note...",
        rows: "1",
      },
    });
    this.input.addEventListener("input", () => this.onInput());
    this.input.addEventListener("keydown", (event) => this.onKey(event));

    const footer = box.createDiv({ cls: "nox-composer-footer" });
    this.promptPlusBtn = footer.createEl("button", {
      cls: "nox-prompt-plus",
      attr: {
        type: "button",
        "aria-label": "Add context or file",
        "aria-expanded": "false",
      },
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
        "aria-expanded": "false",
      },
    });
    actionMenuBtn.createSpan({
      cls: "nox-action-menu-key",
      text: "/",
    });
    actionMenuBtn.createSpan({
      text: "Actions",
    });
    actionMenuBtn.addEventListener("click", () => {
      this.promptMenu =
        this.promptMenu === "command" ? null : "command";
      this.promptMenuActive = 0;
      actionMenuBtn.setAttribute(
        "aria-expanded",
        String(this.promptMenu === "command"),
      );
      void this.renderPromptMenu();
      this.input.focus();
    });

    this.modelSelect = tools.createEl("select", {
      cls: "nox-model-select",
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

    const btnGroup = footer.createDiv({ cls: "nox-btn-group" });

    this.cancelBtn = btnGroup.createEl("button", {
      cls: "nox-cancel-btn nox-hidden",
      attr: { type: "button", "aria-label": "Stop generating" },
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
      attr: { type: "button", "aria-label": "Send message" },
    });
    setNoxIcon(this.sendBtn, "arrow-up");
    this.sendBtn.title = "Send message";
    this.sendBtn.setAttribute("aria-label", "Send message");
    this.sendBtn.disabled = true;
    this.sendBtn.addEventListener("click", () => {
      void this.doSend();
    });

  }

  private renderAttachments(): void {
    if (!this.attachmentsEl) return;

    this.attachmentsEl.empty();
    this.attachmentsEl.toggleClass("nox-hidden", this.attachments.length === 0);

    for (const [index, attachment] of this.attachments.entries()) {
      const chip = this.attachmentsEl.createDiv({
        cls: "nox-attachment-chip",
      });
      const attachmentIcon = chip.createSpan({ cls: "nox-attachment-icon" });
      setNoxIcon(attachmentIcon, "file-text");
      chip.createSpan({ cls: "nox-attachment-name", text: attachment.name });

      const remove = chip.createEl("button", {
        cls: "nox-attachment-remove",
        attr: {
          type: "button",
          "aria-label": `Remove ${attachment.name}`,
        },
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

  private async handleFiles(files: FileList | null): Promise<void> {
    if (!files || files.length === 0) return;

    this.closePromptMenu();

    for (const file of Array.from(files)) {
      const content = await file.text();
      this.attachments.push({
        name: file.name,
        ref: {
          kind: "attachment",
          name: file.name,
          content,
        },
      });
    }

    this.extraCtx = this.attachments.map((item) => item.ref);
    this.renderAttachments();
    this.fileInput.value = "";
    await this.syncChips();
    this.input.focus();
  }

  private async getPromptMenuItems(): Promise<PromptMenuItem[]> {
    if (this.promptMenu === "command") {
      return PROMPT_COMMANDS.map((command) => ({
        key: command.kind,
        name: command.name,
        description: command.description,
        icon: "sparkles",
        action: { type: "learning" as const, kind: command.kind },
      }));
    }

    const items: PromptMenuItem[] = [];
    const token = parsePromptToken(this.input.value);
    const query = token?.kind === "source" ? token.query : "";

    if (this.currentContext?.selection) {
      items.push({
        key: "current-selection",
        name: "Current selection",
        description: this.currentContext.selection.file,
        icon: "check",
        disabled: true,
        action: { type: "info" },
      });
    } else if (this.currentContext?.activeNote) {
      items.push({
        key: "current-note",
        name: this.currentContext.activeNote.path.split("/").pop() ??
          this.currentContext.activeNote.path,
        description: "Current note · automatic context",
        icon: "file-text",
        disabled: true,
        action: { type: "info" },
      });
    }

    if (query) {
      const excluded = new Set([
        this.currentContext?.activeNote?.path,
        this.currentContext?.selection?.file,
        ...this.extraCtx
          .filter(
            (item): item is Extract<
              ExplicitContextRef,
              { kind: "vault-note" }
            > => item.kind === "vault-note",
          )
          .map((item) => item.path),
      ].filter((value): value is string => Boolean(value)));

      for (const note of this.learning.searchNotes(query, 6)) {
        if (excluded.has(note.path)) continue;
        items.push({
          key: `note:${note.path}`,
          name: note.name,
          description: note.path,
          icon: "file-text",
          action: { type: "vault-note", path: note.path },
        });
      }
    }

    items.push({
      key: "attach",
      name: "Attach text file",
      description: "Markdown, text, CSV, JSON, or YAML",
      icon: "paperclip",
      action: { type: "attach" },
    });

    return items;
  }

  private async renderPromptMenu(): Promise<void> {
    if (!this.promptMenuEl) return;

    const requestId = ++this.promptMenuRequest;
    this.promptMenuEl.empty();
    this.promptMenuRows = [];
    this.promptMenuEl.toggleClass("nox-hidden", this.promptMenu === null);
    this.promptPlusBtn?.setAttribute("aria-expanded", String(this.promptMenu !== null));
    if (!this.promptMenu) return;

    const token = parsePromptToken(this.input.value);
    const query = token?.kind === this.promptMenu ? token.query : "";
    const rows = await this.getPromptMenuItems();
    if (requestId !== this.promptMenuRequest || !this.promptMenu) return;

    let interactiveIndex = 0;
    for (const item of rows) {
      const menuIndex = item.disabled ? -1 : interactiveIndex++;
      const button = this.promptMenuEl.createEl("button", {
        cls: `nox-prompt-menu-row${menuIndex === this.promptMenuActive ? " is-active" : ""}`,
        attr: { type: "button" },
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
      text: this.promptMenu === "source"
        ? query ? "Select a note or attach a text file" : "Type @name to search vault notes"
        : "Choose a learning action",
    });
  }

  private async pickPromptMenuItem(item: PromptMenuItem): Promise<void> {
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
        (item) =>
          item.kind === "vault-note" &&
          item.path === action.path,
      );

      if (!exists) {
        const ref: ExplicitContextRef = {
          kind: "vault-note",
          path: action.path,
        };

        this.attachments.push({
          name: action.path.split("/").pop() ?? action.path,
          ref,
        });
        this.extraCtx = this.attachments.map((item) => item.ref);
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

  private closePromptMenu(): void {
    this.promptMenuRequest += 1;
    this.promptMenu = null;
    this.promptMenuActive = 0;
    void this.renderPromptMenu();
  }

  private setAction(action: LearningActionKind): void {
    this.selectedAction = action;
    this.syncActionButtons();
    this.updatePlaceholder();
  }

  private syncActionButtons(): void {
    for (const [kind, button] of this.actionButtons) {
      const active = kind === this.selectedAction;
      button.toggleClass("is-active", active);
      button.setAttribute("aria-pressed", String(active));
    }
    this.renderIntent();
  }

  private renderIntent(): void {
    if (!this.intentEl) return;
    this.intentEl.empty();

    const visible = this.selectedAction !== "ask";
    this.intentEl.toggleClass("nox-hidden", !visible);
    if (!visible) return;

    const label = ACTIONS.find((item) => item.kind === this.selectedAction)?.label ?? this.selectedAction;
    const chip = this.intentEl.createDiv({
      cls: `nox-intent-chip nox-intent-chip--${this.selectedAction}`,
    });
    chip.createSpan({ cls: "nox-intent-label", text: label });

    const remove = chip.createEl("button", {
      cls: "nox-intent-remove",
      attr: { type: "button", "aria-label": `Exit ${label} mode` },
    });
    setNoxIcon(remove, "x");
    remove.addEventListener("click", () => {
      this.setAction("ask");
      this.input.focus();
    });
  }

  private updatePlaceholder(): void {
    const hasSelection = Boolean(this.currentContext?.selection);
    const hasNote = Boolean(this.currentContext?.activeNote);

    const askPlaceholder = hasSelection
      ? "Ask about this selection..."
      : hasNote
        ? "Ask about this note..."
        : "Ask Nox...";

    const placeholders: Record<LearningActionKind, string> = {
      ask: askPlaceholder,
      explain: hasSelection
        ? "What should I explain about this selection?"
        : "What should I explain?",
      practice: hasSelection
        ? "Practice this selection..."
        : "What should we practice?",
      review: hasNote
        ? "What should I review in this note?"
        : "What should I review?",
      edit: hasNote
        ? "How should I improve this note?"
        : "What should I improve?",
    };

    if (this.input) {
      this.input.placeholder = placeholders[this.selectedAction];
    }
  }

  private async syncChips(): Promise<void> {
    const context = await this.learning.resolveContext(this.extraCtx);
    this.currentContext = context;
    this.systemChip.addClass("nox-chip--hidden");

    const hasSelection = Boolean(context.selection);
    this.selectionChip.toggleClass("nox-chip--hidden", !hasSelection);

    const activeNote = context.activeNote;
    this.noteChip.toggleClass("nox-chip--hidden", !activeNote);

    if (activeNote) {
      const name = activeNote.path.split("/").pop() ?? activeNote.path;
      const label = this.noteChip.querySelector<HTMLElement>(".nox-chip-label");
      if (label) label.textContent = `@${name}`;
      this.noteChip.title = activeNote.path;
    }

    this.updatePlaceholder();

    if (
      this.uiState === "EMPTY" &&
      this.thread.querySelector(".nox-empty-slate")
    ) {
      this.showEmpty();
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
        explicitContext,
      })) {
        this.handleLearningEvent(event);
      }
    } catch (err) {
      this.finishStreamingBubble("Stopped");

      const message =
        err instanceof Error ? err.message : String(err);

      console.warn("[Nox] Unexpected turn failure", message);
      this.appendInlineError(
        this.thread,
        "Nox hit an unexpected error. Try again.",
      );
      this.setUIState("ANSWER");
    }
  }

  private handleLearningEvent(event: LearningEvent): void {
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
      if (!event.evaluation.nextQuestion?.trim()) this.setAction("ask");
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
      if (
        this.runningAction === "explain" ||
        this.runningAction === "review" ||
        this.runningAction === "edit"
      ) {
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

  private finishStreamingBubble(doneLabel?: string): void {
    const elapsed = this.formatElapsed(Date.now() - this.loadingStartedAt);
    this.stopThinkingSequence();
    this.flushStreamingText();
    this.renderMarkdownResponse();
    if (doneLabel === undefined) this.appendStreamActions();
    this.settleThinking(doneLabel ?? `Completed in ${elapsed}`);
    if (this.responseTimeEl) this.responseTimeEl.textContent = `for ${elapsed}`;
    this.stopLoadingTimer();
    this.agentCursorEl?.removeClass("nox-bubble--streaming");
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

  private settleThinking(doneLabel: string): void {
    if (!this.thinkingLabelEl) return;

    this.thinkingLabelEl.textContent = doneLabel;
    this.thinkingLabelEl.removeClass("nox-thinking-label--active");
    this.thinkingLabelEl.addClass("nox-thinking-label--done");

    for (const row of this.thinkingRows) {
      row.removeClass("nox-hidden");
      row.removeClass("is-active");
      row.addClass("is-done");

      const marker = row.firstElementChild as HTMLElement | null;
      if (marker) {
        marker.textContent = "✓";
        marker.removeClass("nox-thinking-marker--spinner");
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

      row.toggleClass("nox-hidden", index >= visible);
      row.toggleClass("is-active", active);
      row.toggleClass("is-done", done);

      if (marker) {
        marker.textContent = done ? "✓" : "";
        marker.toggleClass("nox-thinking-marker--spinner", active);
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
    this.cancelBtn.disabled = false;
    this.input.disabled = busy || state === "ERROR";
    this.sendBtn.disabled =
      busy || state === "ERROR" || !this.canSend();
    this.cancelBtn.toggleClass("nox-hidden", !busy);
  }

  private canSend(): boolean {
    return this.input.value.trim().length > 0 || this.attachments.length > 0;
  }

  private showEmpty(): void {
    this.stopLoadingTimer();
    this.thread.empty();
    this.agentCursorEl = null;
    this.statusEl = null;

    const slate = this.thread.createDiv({
      cls: "nox-empty-slate",
    });

    this.renderEmptyContext(slate);

    const intro = slate.createDiv({
      cls: "nox-empty-intro",
    });
    intro.createDiv({
      cls: "nox-empty-title",
      text: "What do you want to work on?",
    });
    intro.createDiv({
      cls: "nox-empty-description",
      text:
        "Choose a focused action for the current note, or ask Nox directly.",
    });

    const section = slate.createDiv({
      cls: "nox-capability-section",
    });
    const sectionHead = section.createDiv({
      cls: "nox-capability-header",
    });
    sectionHead.createSpan({
      cls: "nox-capability-label",
      text: "Focused actions",
    });

    const commandHint = sectionHead.createEl("button", {
      cls: "nox-capability-command-hint",
      text: "Type / to see all actions",
      attr: {
        type: "button",
        "aria-label": "Show all Nox actions",
      },
    });
    commandHint.addEventListener("click", () => {
      this.promptMenu = "command";
      this.promptMenuActive = 0;
      void this.renderPromptMenu();
      this.focusComposer();
    });

    const grid = section.createDiv({
      cls: "nox-capability-grid",
    });

    for (const capability of NOX_CAPABILITIES) {
      const card = grid.createEl("button", {
        cls:
          `nox-capability-card ` +
          `nox-capability-card--${capability.tone}`,
        attr: {
          type: "button",
          "aria-label": capability.title,
        },
      });

      const top = card.createDiv({
        cls: "nox-capability-card-top",
      });
      const name = top.createDiv({
        cls: "nox-capability-name",
      });
      const icon = name.createSpan({
        cls: "nox-capability-icon",
      });
      setNoxIcon(icon, capability.icon as IconName);
      name.createSpan({
        cls: "nox-capability-title",
        text: capability.title,
      });
      top.createSpan({
        cls: "nox-capability-command",
        text: capability.command,
      });

      card.createDiv({
        cls: "nox-capability-description",
        text: capability.description,
      });
      card.createSpan({
        cls: "nox-capability-meta",
        text: capability.meta,
      });

      card.addEventListener("click", () => {
        this.setAction(capability.action);
        this.focusComposer();
      });
    }

    this.setUIState("EMPTY");
  }

  private renderEmptyContext(parent: HTMLElement): void {
    const context = this.currentContext;
    if (!context?.selection && !context?.activeNote) return;

    const wrap = parent.createDiv({
      cls: "nox-empty-context",
    });
    const left = wrap.createDiv({
      cls: "nox-empty-context-main",
    });
    const icon = left.createSpan({
      cls: "nox-empty-context-icon",
    });
    setNoxIcon(icon, "file-text");

    const copy = left.createDiv({
      cls: "nox-empty-context-copy",
    });
    copy.createSpan({
      cls: "nox-empty-context-label",
      text: "Current context",
    });

    const file =
      context.selection?.file ??
      context.activeNote?.path ??
      "";
    copy.createSpan({
      cls: "nox-empty-context-file",
      text: file.split("/").pop() ?? file,
    });

    if (context.selection) {
      wrap.createSpan({
        cls: "nox-empty-context-meta",
        text: "Selection",
      });
    }
  }

  private async restoreSession(): Promise<void> {
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

  private async appendRestoredAssistant(markdown: string): Promise<void> {
    const bubble = this.thread.createDiv({
      cls: "nox-bubble nox-bubble--agent",
    });
    const meta = bubble.createDiv({ cls: "nox-response-meta" });
    meta.createSpan({ cls: "nox-response-label", text: "Nox" });
    meta.createSpan({ cls: "nox-response-sub", text: "Restored" });
    const content = bubble.createDiv({
      cls: "nox-bubble-content nox-markdown",
    });
    const sourcePath =
      this.currentContext?.selection?.file ??
      this.currentContext?.activeNote?.path ??
      "Nox.md";
    await MarkdownRenderer.render(
      this.app,
      markdown,
      content,
      sourcePath,
      this,
    );
  }

  private appendRestoredProposal(message: ChatMessage): void {
    const proposal = message.proposal;
    if (!proposal) return;
    const wrap = this.renderProposal(proposal);
    const state = message.proposalState ?? "stale";
    const labels: Record<string, string> = {
      applied: `✓ Applied to ${proposal.file}`,
      rejected: "✕ Rejected",
      stale: "⚠ Expired after restart",
      pending: "⚠ Expired after restart",
    };
    wrap.createDiv({
      cls: `nox-result-badge nox-badge--${state === "applied" ? "applied" : state === "rejected" ? "rejected" : "stale"}`,
      text: labels[state],
    });
  }

  private showError(message: string): void {
    this.stopLoadingTimer();
    this.thread.empty();
    this.agentCursorEl = null;
    this.statusEl = null;

    const slate = this.thread.createDiv({
      cls: "nox-error-slate",
    });
    slate.createDiv({
      cls: "nox-error-icon",
      text: "⚠",
    });
    slate.createDiv({
      cls: "nox-error-title",
      text: "Nox unavailable",
    });
    slate.createDiv({
      cls: "nox-error-body",
      text: message,
    });

    const button = slate.createEl("button", {
      cls: "nox-configure-btn",
      text: "Configure Nox →",
    });
    button.addEventListener("click", () => {
      this.openSettings();
    });

    this.setUIState("ERROR");
  }

  private appendUserBubble(text: string): void {
    this.thread.querySelector(".nox-empty-slate")?.remove();
    const bubble = this.thread.createDiv({
      cls: "nox-bubble nox-bubble--user",
    });
    bubble.setText(text);
  }

  private ensureAgentBubble(): void {
    if (this.agentCursorEl) return;

    this.statusEl = this.buildThinkingTrace();

    this.agentCursorEl = this.thread.createDiv({
      cls: "nox-bubble nox-bubble--agent nox-bubble--streaming",
    });
    const meta = this.agentCursorEl.createDiv({ cls: "nox-response-meta" });
    meta.createSpan({ cls: "nox-response-label", text: "Nox" });
    meta.createSpan({
      cls: "nox-response-sub",
      text: ACTIONS.find((action) => action.kind === this.selectedAction)?.label ?? "Response",
    });
    this.responseTimeEl = meta.createSpan({ cls: "nox-response-time", text: "for 0.0s" });
    this.agentContentEl = this.agentCursorEl.createDiv({
      cls: "nox-bubble-content",
    });
  }

  private buildThinkingTrace(): HTMLElement {
    const trace = this.thread.createDiv({ cls: "nox-thinking" });
    trace.setAttribute("role", "status");
    trace.setAttribute("aria-live", "polite");

    const toggle = trace.createEl("button", {
      cls: "nox-thinking-toggle",
      attr: { type: "button", "aria-expanded": "false" },
    });
    this.thinkingToggleEl = toggle;

    toggle.createEl("img", {
      cls: "nox-thinking-logo",
      attr: { src: this.getLogoUrl(), alt: "" },
    });

    this.thinkingLabelEl = toggle.createSpan({
      cls: "nox-thinking-label nox-thinking-label--active",
      text: "Working",
    });
    this.loadingElapsedEl = toggle.createSpan({ cls: "nox-thinking-elapsed" });
    this.loadingElapsedEl.setAttribute("aria-hidden", "true");

    const chevron = toggle.createSpan({ cls: "nox-thinking-chevron", text: "⌄" });
    this.thinkingChevronEl = chevron;

    const panel = trace.createDiv({ cls: "nox-thinking-panel" });
    this.thinkingPanelEl = panel;
    const list = panel.createDiv({ cls: "nox-thinking-trace nox-thinking-trace--facts" });

    const source = this.currentContext?.selection?.file ?? this.currentContext?.activeNote?.path;
    const facts: Array<{ primary: string; secondary?: string }> = [
      {
        primary: this.currentContext?.selection
          ? "Current selection"
          : this.currentContext?.activeNote ? "Current note" : "No automatic note context",
        secondary: source?.split("/").pop(),
      },
      {
        primary: "Learning intent",
        secondary: ACTIONS.find((action) => action.kind === this.runningAction)?.label ?? "Ask",
      },
    ];

    this.thinkingRows = facts.map((fact) => {
      const row = list.createDiv({ cls: "nox-thinking-row is-done" });
      row.createSpan({ cls: "nox-thinking-marker", text: "·" });
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

  private appendToAgentBubble(text: string): void {
    if (!this.agentContentEl) return;

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
        this.agentContentEl.appendText(part);
        continue;
      }

      this.agentContentEl.createSpan({
        cls: "nox-stream-word",
        text: part,
      });
    }

    this.scrollThread();
  }

  private flushStreamingText(): void {
    if (!this.agentContentEl || !this.streamingPendingText) return;

    this.agentContentEl.createSpan({
      cls: "nox-stream-word",
      text: this.streamingPendingText,
    });
    this.streamingPendingText = "";
  }

  private renderMarkdownResponse(): void {
    if (!this.agentContentEl || !this.streamedResponseText.trim()) return;

    const content = this.agentContentEl;
    const markdown = this.streamedResponseText;
    const sourcePath =
      this.currentContext?.selection?.file ??
      this.currentContext?.activeNote?.path ??
      "Nox.md";

    content.empty();
    content.addClass("nox-markdown");

    void MarkdownRenderer.render(this.app, markdown, content, sourcePath, this).catch(() => {
      content.empty();
      content.removeClass("nox-markdown");
      content.addClass("nox-markdown-error");
      content.setText("Markdown response could not be rendered.");
    });
  }

  private appendStreamActions(): void {
    if (!this.agentCursorEl || !this.streamedResponseText.trim()) return;

    const responseText = this.streamedResponseText.trim();
    const actions = this.agentCursorEl.createDiv({
      cls: "nox-stream-actions",
    });
    const copyButton = actions.createEl("button", {
      cls: "nox-stream-action",
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
    if (!this.agentCursorEl) return;

    const card = this.agentCursorEl.createDiv({
      cls: "nox-practice-card",
    });
    card.createDiv({
      cls: "nox-practice-label",
      text: `Practice · ${question.concept}`,
    });
    card.createDiv({
      cls: "nox-practice-question",
      text: question.question,
    });

    if (question.hint) {
      card.createDiv({
        cls: "nox-practice-hint",
        text: `Hint: ${question.hint}`,
      });
    }

    this.scrollThread();
  }

  private appendPracticeEvaluation(
    evaluation: PracticeEvaluation,
  ): void {
    if (!this.agentCursorEl) return;

    const card = this.agentCursorEl.createDiv({
      cls: `nox-practice-evaluation nox-outcome--${evaluation.outcome}`,
    });

    const outcomeLabel =
      evaluation.outcome === "correct"
        ? "Correct"
        : evaluation.outcome === "partial"
          ? "Partial"
          : "Needs work";

    card.createDiv({
      cls: "nox-practice-label",
      text: `${outcomeLabel} · ${evaluation.concept}`,
    });
    card.createDiv({
      cls: "nox-practice-feedback",
      text: evaluation.feedback,
    });

    if (evaluation.misconceptions.length > 0) {
      const gaps = card.createDiv({
        cls: "nox-practice-gaps",
      });
      gaps.createDiv({
        cls: "nox-practice-gaps-label",
        text: "Gap",
      });

      for (const misconception of evaluation.misconceptions) {
        gaps.createDiv({
          cls: "nox-practice-gap",
          text: misconception,
        });
      }
    }

    this.scrollThread();
  }

  private appendReviewFindings(findings: ReviewFinding[]): void {
    if (!this.agentCursorEl) return;

    const wrap = this.agentCursorEl.createDiv({ cls: "nox-review" });
    wrap.createDiv({
      cls: "nox-review-summary",
      text: findings.length === 0
        ? "No material learning gaps found."
        : `${findings.length} important ${findings.length === 1 ? "gap" : "gaps"}`,
    });

    for (const finding of findings) {
      const card = wrap.createDiv({
        cls: `nox-review-card nox-review-card--${finding.kind}`,
      });
      card.createDiv({ cls: "nox-review-kind", text: finding.kind.replace("-", " ") });
      card.createDiv({ cls: "nox-review-title", text: finding.title });
      card.createDiv({ cls: "nox-review-detail", text: finding.detail });

      const actions = card.createDiv({ cls: "nox-review-actions" });
      const practice = actions.createEl("button", {
        cls: "nox-review-action",
        text: "Practice",
        attr: { type: "button" },
      });
      practice.addEventListener("click", () => {
        this.setAction("practice");
        this.input.value = `Practice this gap: ${finding.concept} — ${finding.detail}`;
        this.onInput();
        this.input.focus();
      });

      const fix = actions.createEl("button", {
        cls: "nox-review-action",
        text: "Fix",
        attr: { type: "button" },
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

  private appendProgressUpdate(
    topic: string | undefined,
    gaps: Array<{ status: string }>,
  ): void {
    if (!topic) return;
    const open = gaps.filter((gap) => gap.status === "open").length;
    const row = this.thread.createDiv({ cls: "nox-progress-row" });
    const mark = row.createSpan({ cls: "nox-progress-mark" });
    setNoxIcon(mark, "check");
    row.createSpan({
      cls: "nox-progress-text",
      text: open > 0
        ? `Learning state updated · ${open} open ${open === 1 ? "gap" : "gaps"}`
        : "Learning state updated",
    });
  }

  private appendProposalBubble(edit: ProposedEdit): void {
    const proposal = edit.proposal;
    const wrap = this.renderProposal(proposal);

    const actions = wrap.createDiv({
      cls: "nox-proposal-actions",
    });

    const rejectBtn = actions.createEl("button", {
      cls: "nox-btn-reject",
      text: "Reject",
    });

    const applyBtn = actions.createEl("button", {
      cls: "nox-btn-apply",
      text: "Apply ✓",
    });

    rejectBtn.addEventListener("click", () => {
      void this.learning.rejectProposal(edit.id);
      actions.remove();
      wrap.createDiv({
        cls: "nox-result-badge nox-badge--rejected",
        text: "✕ Rejected",
      });
      this.setUIState("ANSWER");
    });

    applyBtn.addEventListener("click", async () => {
      applyBtn.disabled = true;
      applyBtn.textContent = "Applying…";

      const result = await this.learning.applyProposal(edit.id);
      actions.remove();

      if (result.ok) {
        wrap.createDiv({
          cls: "nox-result-badge nox-badge--applied",
          text: "✓ Applied to " + proposal.file,
        });
        this.setUIState("APPLIED");
      } else {
        wrap.createDiv({
          cls: "nox-result-badge nox-badge--stale",
          text: "⚠ " + result.message,
        });
        this.setUIState("ANSWER");
      }
    });

    this.scrollThread();
  }

  private renderProposal(proposal: EditProposal): HTMLElement {
    const wrap = this.thread.createDiv({ cls: "nox-proposal" });
    wrap.createDiv({
      cls: "nox-proposal-badge",
      text: "📄 " + proposal.file,
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

  private appendInlineError(
    parent: HTMLElement,
    message: string,
  ): void {
    parent.createDiv({
      cls: "nox-inline-error",
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
