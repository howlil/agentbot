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
  LearningRequest,
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
import { ChatMessage, EditProposal, type AgentModel } from "../types";
import { ProposedEdit } from "../learning/learning-types";
import {
  parsePromptToken,
  PromptMenuKind,
  stripPromptToken,
} from "./prompt-token";
import { NOX_CAPABILITIES } from "./capabilities";
import { animateNoxEnter, animateNoxPopover } from "./motion";
import {
  hasInspectableContext,
  shouldResetAction,
  TerminalOutcome,
} from "./chat-state";

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

const PROMPT_COMMANDS = NOX_CAPABILITIES;

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

  const svg = element.querySelector<SVGElement>("svg");
  if (!svg) return;

  svg.classList.add("nox-icon");
  svg.setAttribute("width", "15");
  svg.setAttribute("height", "15");
  svg.style.setProperty("width", "15px", "important");
  svg.style.setProperty("height", "15px", "important");
  svg.style.setProperty("min-width", "15px", "important");
  svg.style.setProperty("min-height", "15px", "important");
  svg.style.setProperty("display", "block", "important");
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
  private modelTrigger!: HTMLButtonElement;
  private modelMenuEl: HTMLElement | null = null;
  private modelMenuOpen = false;
  private modelMenuActive = 0;
  private modelMenuRows: HTMLButtonElement[] = [];
  private models: AgentModel[] = [];
  private fileInput!: HTMLInputElement;
  private promptPlusBtn!: HTMLButtonElement;
  private actionMenuBtn!: HTMLButtonElement;
  private contextRow!: HTMLElement;
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
  private thinkingManualExpanded: boolean | null = null;
  private streamedResponseText = "";
  private streamingPendingText = "";
  private responseTimeEl: HTMLElement | null = null;

  private uiState: UIState = "EMPTY";
  private selectedAction: LearningActionKind = "ask";
  private runningAction: LearningActionKind | null = null;
  private capabilityCards = new Map<LearningActionKind, HTMLButtonElement>();
  private systemContextFiles: string[] = [];
  private lastTurnRequest: LearningRequest | null = null;
  private turnTerminal = false;
  private workspaceEventsRegistered = false;

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

    if (!(await this.ensureRuntimeReady())) return;
    await this.restoreRuntimeState();
  }

  async onClose(): Promise<void> {
    this.learning.cancel();
    this.stopLoadingTimer();
  }

  private async ensureRuntimeReady(): Promise<boolean> {
    try {
      const health = await this.learning.checkRuntime();
      if (health.status === "ready") return true;

      this.showError(health.failure.message);
    } catch {
      this.showError("Agent runtime is unavailable. Check Nox runtime settings.");
    }

    return false;
  }

  private async restoreRuntimeState(): Promise<void> {
    await this.syncChips();
    await this.restoreSession();

    if (!this.workspaceEventsRegistered) {
      this.workspaceEventsRegistered = true;
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
    }

    void this.refreshModelList();
  }

  private async retryRuntime(): Promise<void> {
    if (this.uiState === "RUNNING") return;

    if (!(await this.ensureRuntimeReady())) return;
    await this.restoreRuntimeState();
    this.focusComposer();
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
      try {
        await this.learning.newSession();
        this.lastTurnRequest = null;
        this.systemContextFiles = [];
        this.extraCtx = [];
        this.attachments = [];
        this.renderAttachments();
        this.closePromptMenu();
        this.closeModelMenu();
        this.setAction("ask");
        await this.syncChips();
        this.showEmpty();
        this.focusComposer();
      } catch (error) {
        console.warn(
          "[Nox] Could not start a new session",
          error instanceof Error ? error.message : String(error),
        );
        this.appendInlineStatus(
          this.thread,
          "failed",
          "Could not start a new session.",
        );
      }
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

  private async refreshModelList(): Promise<void> {
    this.models = this.learning.getModels();
    if (this.modelMenuOpen) this.modelMenuActive = this.getSelectedModelIndex();
    this.syncModelTrigger();
    this.renderModelMenu();
  }

  private getModelMenuItems(): AgentModel[] {
    return [
      { id: "", name: "Runtime default" },
      ...this.models,
    ];
  }

  private getSelectedModelIndex(): number {
    const selected = this.learning.getSession().model ?? "";
    const index = this.getModelMenuItems().findIndex(
      (model) => model.id === selected,
    );
    return index >= 0 ? index : 0;
  }

  private syncModelTrigger(): void {
    if (!this.modelTrigger) return;

    const selected = this.learning.getSession().model ?? "";
    const model = this.getModelMenuItems().find((item) => item.id === selected);
    const label = model?.name ?? "Runtime default";

    this.modelTrigger.empty();
    this.modelTrigger.createSpan({
      cls: "nox-model-trigger-label",
      text: label,
    });
    const chevron = this.modelTrigger.createSpan({
      cls: "nox-model-trigger-chevron",
    });
    setNoxIcon(chevron, "chevron-down");
    this.modelTrigger.setAttribute("aria-expanded", String(this.modelMenuOpen));
    this.modelTrigger.setAttribute("aria-label", `Learning model: ${label}`);
  }

  private openModelMenu(): void {
    this.closePromptMenu();
    this.modelMenuOpen = true;
    this.modelMenuActive = this.getSelectedModelIndex();
    this.syncModelTrigger();
    this.renderModelMenu();
  }

  private closeModelMenu(): void {
    if (!this.modelMenuOpen && this.modelMenuRows.length === 0) return;

    this.modelMenuOpen = false;
    this.modelMenuActive = 0;
    this.modelMenuRows = [];
    this.syncModelTrigger();
    this.renderModelMenu();
  }

  private toggleModelMenu(): void {
    if (this.modelMenuOpen) {
      this.closeModelMenu();
    } else {
      this.openModelMenu();
    }
  }

  private renderModelMenu(): void {
    if (!this.modelMenuEl) return;

    this.modelMenuEl.empty();
    this.modelMenuRows = [];
    this.modelMenuEl.toggleClass("nox-hidden", !this.modelMenuOpen);
    this.syncModelTrigger();

    if (!this.modelMenuOpen) return;

    const selected = this.learning.getSession().model ?? "";
    for (const [index, model] of this.getModelMenuItems().entries()) {
      const row = this.modelMenuEl.createEl("button", {
        cls: `nox-model-menu-row${index === this.modelMenuActive ? " is-active" : ""}`,
        attr: {
          type: "button",
          role: "option",
          "aria-selected": String(model.id === selected),
        },
      });
      row.createSpan({
        cls: "nox-model-menu-name",
        text: model.name,
      });
      const check = row.createSpan({ cls: "nox-model-menu-check" });
      if (model.id === selected) setNoxIcon(check, "check");

      row.addEventListener("mouseenter", () => {
        this.modelMenuActive = index;
        this.syncModelMenuRows();
      });
      row.addEventListener("click", () => this.selectModel(model.id));
      this.modelMenuRows.push(row);
    }

    animateNoxPopover(this.modelMenuEl);
  }

  private syncModelMenuRows(): void {
    const selected = this.learning.getSession().model ?? "";
    this.modelMenuRows.forEach((row, index) => {
      row.toggleClass("is-active", index === this.modelMenuActive);
      row.setAttribute(
        "aria-selected",
        String(this.getModelMenuItems()[index]?.id === selected),
      );
    });
  }

  private selectModel(modelId: string): void {
    this.learning.setModel(modelId || undefined);
    this.closeModelMenu();
    this.modelTrigger.focus();
  }

  private onModelTriggerKey(event: KeyboardEvent): void {
    const items = this.getModelMenuItems();

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!this.modelMenuOpen) {
        this.openModelMenu();
        return;
      }

      const direction = event.key === "ArrowDown" ? 1 : -1;
      this.modelMenuActive =
        (this.modelMenuActive + direction + items.length) % items.length;
      this.syncModelMenuRows();
      return;
    }

    if ((event.key === "Enter" || event.key === " ") && this.modelMenuOpen) {
      event.preventDefault();
      const model = items[this.modelMenuActive];
      if (model) this.selectModel(model.id);
      return;
    }

    if (event.key === "Escape" && this.modelMenuOpen) {
      event.preventDefault();
      this.closeModelMenu();
      return;
    }

    if (event.key === "Tab" && this.modelMenuOpen) {
      this.closeModelMenu();
    }
  }

  private buildComposer(parent: HTMLElement): void {
    this.contextRow = parent.createDiv({ cls: "nox-context-row nox-hidden" });
    this.contextRow.createSpan({
      cls: "nox-context-label",
      text: "Using",
    });

    const chips = this.contextRow.createDiv({ cls: "nox-chips" });

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
    this.promptMenuEl.id = "nox-prompt-menu";
    this.promptMenuEl.setAttribute("role", "listbox");
    this.promptMenuEl.setAttribute("aria-label", "Nox prompt actions");

    this.modelMenuEl = anchor.createDiv({
      cls: "nox-model-menu nox-hidden",
    });
    this.modelMenuEl.id = "nox-model-menu";
    this.modelMenuEl.setAttribute("role", "listbox");
    this.modelMenuEl.setAttribute("aria-label", "Learning models");

    this.registerDomEvent(document, "pointerdown", (event) => {
      const target = event.target;
      if (target instanceof Node && anchor.contains(target)) return;
      this.closePromptMenu();
      this.closeModelMenu();
    });

    const box = anchor.createDiv({ cls: "nox-composer-box" });
    box.addEventListener("click", (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("button")) return;
      this.input.focus();
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
        "aria-controls": "nox-prompt-menu",
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
      this.closeModelMenu();
      this.promptMenu = this.promptMenu === "source" ? null : "source";
      this.promptMenuActive = 0;
      void this.renderPromptMenu();
      this.input.focus();
    });

    const tools = footer.createDiv({ cls: "nox-composer-tools" });

    this.actionMenuBtn = tools.createEl("button", {
      cls: "nox-action-menu-btn",
      attr: {
        type: "button",
        "aria-label": "Show Nox actions",
        "aria-expanded": "false",
      },
    });
    this.actionMenuBtn.createSpan({
      cls: "nox-action-menu-key",
      text: "/",
    });
    this.actionMenuBtn.createSpan({
      text: "Actions",
    });
    this.actionMenuBtn.addEventListener("click", () => {
      this.closeModelMenu();
      this.promptMenu =
        this.promptMenu === "command" ? null : "command";
      this.promptMenuActive = 0;
      void this.renderPromptMenu();
      this.input.focus();
    });

    this.modelTrigger = tools.createEl("button", {
      cls: "nox-model-trigger",
      attr: {
        type: "button",
        "aria-controls": "nox-model-menu",
        "aria-haspopup": "listbox",
        "aria-expanded": "false",
      },
    });
    this.modelTrigger.title = "Choose learning model";
    this.modelTrigger.addEventListener("click", () => {
      this.toggleModelMenu();
    });
    this.modelTrigger.addEventListener("keydown", (event) => {
      this.onModelTriggerKey(event);
    });
    this.syncModelTrigger();

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
        key: command.action,
        name: command.title,
        description: command.description,
        icon: command.icon,
        action: { type: "learning" as const, kind: command.action },
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
    this.syncPromptMenuControls();
    if (!this.promptMenu) {
      this.input.removeAttribute("aria-expanded");
      this.input.removeAttribute("aria-activedescendant");
      return;
    }

    this.input.setAttribute("aria-expanded", "true");

    const token = parsePromptToken(this.input.value);
    const query = token?.kind === this.promptMenu ? token.query : "";
    const rows = await this.getPromptMenuItems();
    if (requestId !== this.promptMenuRequest || !this.promptMenu) return;

    let interactiveIndex = 0;
    for (const item of rows) {
      const menuIndex = item.disabled ? -1 : interactiveIndex++;
      const button = this.promptMenuEl.createEl("button", {
        cls: `nox-prompt-menu-row${menuIndex === this.promptMenuActive ? " is-active" : ""}`,
        attr: {
          type: "button",
          role: "option",
          "aria-selected": String(menuIndex === this.promptMenuActive),
        },
      });
      button.id = `nox-prompt-menu-option-${menuIndex}`;
      button.disabled = Boolean(item.disabled);
      const icon = button.createSpan({ cls: "nox-prompt-menu-icon" });
      setNoxIcon(icon, item.icon);
      button.createSpan({ cls: "nox-prompt-menu-name", text: item.name });
      button.createSpan({ cls: "nox-prompt-menu-description", text: item.description });

      if (!item.disabled) {
        button.addEventListener("mouseenter", () => {
          this.promptMenuActive = menuIndex;
          this.syncPromptMenuRows();
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
    this.syncPromptMenuRows();
    animateNoxPopover(this.promptMenuEl);
  }

  private syncPromptMenuControls(): void {
    const sourceOpen = this.promptMenu === "source";
    const commandOpen = this.promptMenu === "command";

    this.promptPlusBtn?.setAttribute("aria-expanded", String(sourceOpen));
    this.actionMenuBtn?.setAttribute("aria-expanded", String(commandOpen));
  }

  private syncPromptMenuRows(): void {
    this.promptMenuRows.forEach((row, index) => {
      const active = index === this.promptMenuActive;
      row.toggleClass("is-active", active);
      row.setAttribute("aria-selected", String(active));
    });

    const activeRow = this.promptMenuRows[this.promptMenuActive];
    if (activeRow) {
      this.input.setAttribute("aria-activedescendant", activeRow.id);
    } else {
      this.input.removeAttribute("aria-activedescendant");
    }
  }

  private async pickPromptMenuItem(item: PromptMenuItem): Promise<void> {
    const action = item.action;
    if (action.type === "attach") {
      this.input.value = stripPromptToken(this.input.value);
      this.onInput();
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
    this.syncPromptMenuControls();
    void this.renderPromptMenu();
  }

  private setAction(action: LearningActionKind): void {
    this.selectedAction = action;
    this.updatePlaceholder();
    this.renderIntent();
    this.syncCapabilityCards();
  }

  private syncCapabilityCards(): void {
    for (const [kind, card] of this.capabilityCards) {
      const selected = kind === this.selectedAction;
      card.toggleClass("is-selected", selected);
      card.setAttribute("aria-pressed", String(selected));
    }
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
    animateNoxEnter(chip, 3);
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
    this.systemChip.toggleClass(
      "nox-chip--hidden",
      this.systemContextFiles.length === 0,
    );

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

    this.syncContextVisibility();

    this.updatePlaceholder();

    if (
      this.uiState === "EMPTY" &&
      this.thread.querySelector(".nox-empty-slate")
    ) {
      this.showEmpty();
    }
  }

  private syncContextVisibility(): void {
    this.contextRow.toggleClass(
      "nox-hidden",
      !hasInspectableContext({
        hasSelection: Boolean(this.currentContext?.selection),
        hasActiveNote: Boolean(this.currentContext?.activeNote),
        explicitCount: this.extraCtx.length,
        systemCount: this.systemContextFiles.length,
      }),
    );
  }

  private onInput(): void {
    this.closeModelMenu();
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
        this.syncPromptMenuRows();
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
      } else if (this.modelMenuOpen) {
        this.closeModelMenu();
      } else if (this.uiState === "RUNNING") {
        this.cancelBtn.click();
      }
    }
  }

  private async doSend(): Promise<void> {
    const prompt = this.input.value.trim() || "Review the attached context.";
    if (!this.canSend() || this.uiState === "RUNNING") return;

    this.closeModelMenu();
    const request: LearningRequest = {
      prompt,
      action: this.selectedAction,
      explicitContext: [...this.extraCtx],
    };

    this.lastTurnRequest = request;
    await this.runTurn(request, true);
  }

  private async retryLastTurn(): Promise<void> {
    if (!this.lastTurnRequest || this.uiState === "RUNNING") return;

    this.thread
      .querySelectorAll(".nox-inline-status--failed")
      .forEach((status) => status.remove());

    await this.runTurn(this.lastTurnRequest, false);
  }

  private async runTurn(
    request: LearningRequest,
    appendUserMessage: boolean,
  ): Promise<void> {
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
    this.stopLoadingTimer();
    this.turnTerminal = false;

    this.runningAction = request.action;
    if (appendUserMessage) this.appendUserBubble(request.prompt);
    this.setUIState("RUNNING");
    this.ensureAgentBubble();

    try {
      for await (const event of this.learning.run(request)) {
        this.handleLearningEvent(event);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn("[Nox] Unexpected turn failure", message);
      this.terminateTurn(
        "failed",
        "Nox hit an unexpected error. Try again.",
      );
    }
  }

  private handleLearningEvent(event: LearningEvent): void {
    if (event.type === "context-ready") {
      this.currentContext = event.context.resolved;
      this.systemContextFiles = event.context.system.map((item) => item.file);
      this.systemChip.toggleClass("nox-chip--hidden", event.context.system.length === 0);
      this.systemChip.title = this.systemContextFiles.join("\n");
      this.syncContextVisibility();
      return;
    }

    if (event.type === "response-delta") {
      const shouldFollow = this.isNearThreadBottom();
      this.appendToAgentBubble(event.text);
      if (shouldFollow) this.scrollThread("auto");
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
      this.terminateTurn("completed");
      return;
    }

    if (event.type === "cancelled") {
      this.terminateTurn("stopped", "Stopped.");
      return;
    }

    if (event.type === "failed") {
      this.terminateTurn("failed", event.failure.message);
    }
  }

  private terminateTurn(
    outcome: TerminalOutcome,
    message?: string,
  ): void {
    if (this.turnTerminal) return;
    this.turnTerminal = true;

    const action = this.runningAction;
    if (this.uiState === "RUNNING") this.setUIState("ANSWER");

    if (outcome === "completed") {
      this.finishStreamingBubble();
    } else {
      this.finishStreamingBubble(
        outcome === "stopped" ? "Stopped" : "Unable to finish",
      );
      this.appendInlineStatus(
        this.thread,
        outcome,
        message ?? (outcome === "stopped" ? "Stopped." : "Unable to finish."),
        outcome === "failed" ? () => void this.retryLastTurn() : undefined,
      );
      this.setUIState("ANSWER");
    }

    if (action && shouldResetAction(action, outcome)) {
      this.setAction("ask");
    }
    this.runningAction = null;
  }

  private finishStreamingBubble(doneLabel?: string): void {
    const elapsed = this.formatElapsed(Date.now() - this.loadingStartedAt);
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
    this.cancelBtn.disabled = !busy;
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
    this.capabilityCards.clear();

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
          "aria-pressed": String(this.selectedAction === capability.action),
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
      this.capabilityCards.set(capability.action, card);
    }

    this.syncCapabilityCards();

    this.setUIState("EMPTY");
    animateNoxEnter(slate, 5);
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

    const actions = slate.createDiv({ cls: "nox-error-actions" });
    const retry = actions.createEl("button", {
      cls: "nox-retry-btn",
      text: "Retry",
      attr: { type: "button" },
    });
    retry.addEventListener("click", () => {
      retry.disabled = true;
      retry.textContent = "Checking…";
      void this.retryRuntime();
    });

    const configure = actions.createEl("button", {
      cls: "nox-configure-btn",
      text: "Configure Nox",
      attr: { type: "button" },
    });
    configure.addEventListener("click", () => {
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
    animateNoxEnter(bubble, 4);
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
      text:
        ACTIONS.find(
          (action) => action.kind === (this.runningAction ?? this.selectedAction),
        )?.label ?? "Response",
    });
    this.responseTimeEl = meta.createSpan({ cls: "nox-response-time", text: "for 0.0s" });
    this.agentContentEl = this.agentCursorEl.createDiv({
      cls: "nox-bubble-content",
    });
    animateNoxEnter(this.agentCursorEl, 4);
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
    animateNoxEnter(trace, 4);
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

  private appendInlineStatus(
    parent: HTMLElement,
    kind: "stopped" | "failed",
    message: string,
    retry?: () => void,
  ): void {
    const row = parent.createDiv({
      cls: `nox-inline-status nox-inline-status--${kind}`,
    });

    row.createSpan({
      cls: "nox-inline-status-message",
      text: kind === "failed" ? "⚠ " + message : message,
    });

    if (retry) {
      const button = row.createEl("button", {
        cls: "nox-inline-status-retry",
        text: "Retry",
        attr: { type: "button" },
      });
      button.addEventListener("click", retry);
    }

    this.scrollThread();
  }

  private isNearThreadBottom(): boolean {
    const distance =
      this.thread.scrollHeight -
      this.thread.scrollTop -
      this.thread.clientHeight;

    return distance < 48;
  }

  private scrollThread(behavior: ScrollBehavior = "smooth"): void {
    this.thread.scrollTo({
      top: this.thread.scrollHeight,
      behavior,
    });
  }
}
