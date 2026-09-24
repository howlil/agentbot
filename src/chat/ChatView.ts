import { ItemView, WorkspaceLeaf } from "obsidian";
import { LearningController } from "../learning/LearningController";
import {
  LearningActionKind,
  LearningEvent,
} from "../learning/learning-types";
import { LearningContext } from "../context/context-types";
import { AgentContext, EditProposal } from "../types";

export const AGY_VIEW_TYPE = "agy-sidebar";

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

  private agyCursorEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;

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
    return AGY_VIEW_TYPE;
  }

  getDisplayText() {
    return "Learning Agent";
  }

  getIcon() {
    return "sparkles";
  }

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("agy-root");

    this.buildHeader(root);
    this.thread = root.createDiv({ cls: "agy-thread" });
    this.composer = root.createDiv({ cls: "agy-composer" });
    this.buildComposer(this.composer);

    try {
      await this.learning.ping();
    } catch (err) {
      this.showError((err as Error).message);
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
  }

  private buildHeader(root: HTMLElement): void {
    this.headerEl = root.createDiv({ cls: "agy-header" });
    this.headerEl.createSpan({
      cls: "agy-header-title",
      text: "Learning Agent",
    });

    const right = this.headerEl.createDiv({ cls: "agy-header-right" });

    this.modelSelect = right.createEl("select", {
      cls: "agy-model-select",
    });
    this.modelSelect.addEventListener("change", () => {
      this.learning.setModel(this.modelSelect.value);
    });

    this.modelSelect.createEl("option", {
      text: "Loading models…",
      attr: {
        disabled: "",
        selected: "",
      },
    });

    const newBtn = right.createEl("button", {
      cls: "agy-new-btn",
      text: "+",
    });
    newBtn.title = "New learning session";
    newBtn.addEventListener("click", async () => {
      await this.learning.newSession();
      this.extraCtx = [];
      this.selectedAction = "ask";
      this.syncActionButtons();
      await this.syncChips();
      this.showEmpty();
    });
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
    const actionRow = parent.createDiv({
      cls: "agy-learning-actions",
    });

    for (const action of ACTIONS) {
      const button = actionRow.createEl("button", {
        cls: "agy-action-btn",
        text: action.label,
      });
      button.type = "button";
      button.setAttribute(
        "aria-pressed",
        String(action.kind === this.selectedAction),
      );
      button.addEventListener("click", () => {
        this.selectedAction = action.kind;
        this.syncActionButtons();
        this.updatePlaceholder();
      });
      this.actionButtons.set(action.kind, button);
    }

    this.syncActionButtons();

    const chips = parent.createDiv({ cls: "agy-chips" });

    this.selectionChip = chips.createSpan({
      cls: "agy-chip agy-chip--hidden",
    });
    this.selectionChip.createSpan({ cls: "agy-chip-dot" });
    this.selectionChip.createSpan({
      cls: "agy-chip-label",
      text: "@selection",
    });

    this.noteChip = chips.createSpan({
      cls: "agy-chip agy-chip--hidden",
    });
    this.noteChip.createSpan({ cls: "agy-chip-dot" });
    this.noteChip.createSpan({
      cls: "agy-chip-label",
      text: "@note",
    });

    const row = parent.createDiv({ cls: "agy-composer-row" });

    this.input = row.createEl("textarea", {
      cls: "agy-input",
      attr: {
        placeholder: "Ask about what you're learning…",
        rows: "1",
      },
    });
    this.input.addEventListener("input", () => this.onInput());
    this.input.addEventListener("keydown", (event) => this.onKey(event));

    const btnGroup = row.createDiv({ cls: "agy-btn-group" });

    this.cancelBtn = btnGroup.createEl("button", {
      cls: "agy-cancel-btn agy-hidden",
      text: "✕",
    });
    this.cancelBtn.title = "Stop";
    this.cancelBtn.addEventListener("click", () => {
      this.learning.cancel();
      this.setUIState("ANSWER");
      this.appendInlineError(this.thread, "Stopped.");
      this.finishStreamingBubble();
    });

    this.sendBtn = btnGroup.createEl("button", {
      cls: "agy-send-btn",
      text: "↑",
    });
    this.sendBtn.disabled = true;
    this.sendBtn.addEventListener("click", () => {
      void this.doSend();
    });
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
      this.input.value.trim() === "" || this.uiState === "RUNNING";

    this.input.style.height = "auto";
    this.input.style.height =
      Math.min(this.input.scrollHeight, 80) + "px";
  }

  private onKey(event: KeyboardEvent): void {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!this.sendBtn.disabled) void this.doSend();
    }

    if (event.key === "Escape" && this.uiState === "RUNNING") {
      this.cancelBtn.click();
    }
  }

  private async doSend(): Promise<void> {
    const prompt = this.input.value.trim();
    if (!prompt || this.uiState === "RUNNING") return;

    this.input.value = "";
    this.input.style.height = "";
    this.sendBtn.disabled = true;

    this.agyCursorEl = null;
    this.statusEl = null;

    this.appendUserBubble(prompt);
    this.setUIState("RUNNING");
    this.ensureAgyBubble();

    const timeout = window.setTimeout(() => {
      this.learning.cancel();
      this.setUIState("ANSWER");
      this.finishStreamingBubble();
      this.appendInlineError(
        this.thread,
        "No response after 60 s. AGY may be busy.",
      );
    }, 60_000);

    try {
      for await (const event of this.learning.run({
        prompt,
        action: this.selectedAction,
        explicitContext: this.extraCtx,
      })) {
        this.handleLearningEvent(event, timeout);
      }
    } catch (err) {
      window.clearTimeout(timeout);
      this.finishStreamingBubble();

      const message =
        err instanceof Error ? err.message : String(err);

      if (message.includes("not found") || message.includes("ENOENT")) {
        this.showError("AGY CLI not found. Make sure 'agy' is in PATH.");
      } else {
        this.appendInlineError(this.thread, message);
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
      this.appendToAgyBubble(event.text);
      this.scrollThread();
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
      this.finishStreamingBubble();
      this.appendInlineError(this.thread, event.message);
      this.setUIState("ANSWER");
    }
  }

  private finishStreamingBubble(): void {
    this.agyCursorEl?.removeClass("agy-bubble--streaming");
    this.statusEl?.addClass("agy-hidden");
    this.agyCursorEl = null;
    this.statusEl = null;
  }

  private setUIState(state: UIState): void {
    this.uiState = state;

    const busy = state === "RUNNING";
    this.input.disabled = busy || state === "ERROR";
    this.sendBtn.disabled =
      busy || state === "ERROR" || this.input.value.trim() === "";
    this.cancelBtn.toggleClass("agy-hidden", !busy);
    this.statusEl?.toggleClass("agy-hidden", !busy);
  }

  private showEmpty(): void {
    this.thread.empty();
    this.agyCursorEl = null;
    this.statusEl = null;

    const slate = this.thread.createDiv({
      cls: "agy-empty-slate",
    });
    slate.createDiv({
      cls: "agy-empty-icon",
      text: "✦",
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
      cls: "agy-empty-label",
      text: label,
    });

    this.setUIState("EMPTY");
  }

  private showError(message: string): void {
    this.thread.empty();
    this.agyCursorEl = null;
    this.statusEl = null;

    const slate = this.thread.createDiv({
      cls: "agy-error-slate",
    });
    slate.createDiv({
      cls: "agy-error-icon",
      text: "⚠",
    });
    slate.createDiv({
      cls: "agy-error-title",
      text: "AGY unavailable",
    });
    slate.createDiv({
      cls: "agy-error-body",
      text: message,
    });

    const button = slate.createEl("button", {
      cls: "agy-configure-btn",
      text: "Configure AGY →",
    });
    button.addEventListener("click", () => {
      (this.app as any).setting?.open?.();
    });

    this.setUIState("ERROR");
  }

  private appendUserBubble(text: string): void {
    this.thread.querySelector(".agy-empty-slate")?.remove();
    const bubble = this.thread.createDiv({
      cls: "agy-bubble agy-bubble--user",
    });
    bubble.setText(text);
  }

  private ensureAgyBubble(): void {
    if (this.agyCursorEl) return;

    this.statusEl = this.thread.createDiv({
      cls: "agy-status-line",
    });
    this.statusEl.createDiv({
      cls: "agy-spinner",
    });

    const label = this.statusEl.createSpan();
    label.textContent = this.currentContext?.selection
      ? "Reading selection…"
      : this.currentContext?.activeNote
        ? "Reading note…"
        : "Thinking…";

    this.agyCursorEl = this.thread.createDiv({
      cls: "agy-bubble agy-bubble--agy agy-bubble--streaming",
    });
  }

  private appendToAgyBubble(text: string): void {
    if (!this.agyCursorEl) return;
    this.agyCursorEl.appendText(text);
  }

  private appendProposalBubble(proposal: EditProposal): void {
    const wrap = this.thread.createDiv({
      cls: "agy-proposal",
    });

    wrap.createDiv({
      cls: "agy-proposal-badge",
      text: "📄 " + proposal.file,
    });

    if (proposal.reason) {
      wrap.createDiv({
        cls: "agy-proposal-reason",
        text: proposal.reason,
      });
    }

    const diff = wrap.createDiv({
      cls: "agy-proposal-diff",
    });

    proposal.original.split("\n").forEach((line) => {
      diff.createDiv({
        cls: "agy-diff-removed",
        text: "- " + line,
      });
    });

    proposal.replacement.split("\n").forEach((line) => {
      diff.createDiv({
        cls: "agy-diff-added",
        text: "+ " + line,
      });
    });

    const actions = wrap.createDiv({
      cls: "agy-proposal-actions",
    });

    const rejectBtn = actions.createEl("button", {
      cls: "agy-btn-reject",
      text: "Reject",
    });

    const applyBtn = actions.createEl("button", {
      cls: "agy-btn-apply",
      text: "Apply ✓",
    });

    rejectBtn.addEventListener("click", () => {
      actions.remove();
      wrap.createDiv({
        cls: "agy-result-badge agy-badge--rejected",
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
          cls: "agy-result-badge agy-badge--applied",
          text: "✓ Applied to " + proposal.file,
        });
        this.setUIState("APPLIED");
      } else {
        wrap.createDiv({
          cls: "agy-result-badge agy-badge--stale",
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
      cls: "agy-inline-error",
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
