import { ItemView, WorkspaceLeaf } from "obsidian";
import { SessionController } from "../session/SessionController";
import { ObsidianContext } from "../context/ObsidianContext";
import { EditProposal, AgyModel, AgentContext } from "../types";

export const AGY_VIEW_TYPE = "agy-sidebar";

// ─── State machine ────────────────────────────────────────────────────────────
//
//   EMPTY ──send──► RUNNING ──text──► ANSWER
//                       │                │
//                  proposal          proposal
//                       └──────┬──────────┘
//                              ▼
//                         PROPOSAL
//                          /    \
//                      Reject  Apply
//                        ▼       ▼
//                     ANSWER  APPLIED
//
//   Any state ──agy-not-found──► ERROR
// ─────────────────────────────────────────────────────────────────────────────

type UIState = "EMPTY" | "RUNNING" | "ANSWER" | "PROPOSAL" | "APPLIED" | "ERROR";

export class ChatView extends ItemView {
  private sc: SessionController;
  private ctx: ObsidianContext;

  // Root sections
  private thread!: HTMLElement;
  private composer!: HTMLElement;
  private headerEl!: HTMLElement;

  // Composer refs
  private input!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private selectionChip!: HTMLElement;
  private noteChip!: HTMLElement;
  private cancelBtn!: HTMLButtonElement;
  private modelSelect!: HTMLSelectElement;

  // Thread refs (reset per turn)
  private agyCursorEl: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;

  // State
  private uiState: UIState = "EMPTY";

  // Extra context chips added by user
  private extraCtx: AgentContext[] = [];

  constructor(
    leaf: WorkspaceLeaf,
    sc: SessionController,
    ctx: ObsidianContext,
  ) {
    super(leaf);
    this.sc = sc;
    this.ctx = ctx;
  }

  getViewType()    { return AGY_VIEW_TYPE; }
  getDisplayText() { return "AGY"; }
  getIcon()        { return "sparkles"; }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  async onOpen(): Promise<void> {
    const root = this.contentEl;
    root.empty();
    root.addClass("agy-root");

    this.buildHeader(root);
    this.thread   = root.createDiv({ cls: "agy-thread" });
    this.composer = root.createDiv({ cls: "agy-composer" });
    this.buildComposer(this.composer);

    // Verify AGY is installed at open time
    try {
      await this.sc["adapter"]?.ping?.();
    } catch (err) {
      this.showError((err as Error).message);
      return;
    }

    this.showEmpty();
    this.syncChips();

    // Update chips whenever selection or active file changes
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => this.syncChips())
    );
    this.registerEvent(
      this.app.workspace.on("editor-selection-change" as any, () => this.syncChips())
    );

    // Populate model selector
    this.refreshModelList();
  }

  async onClose(): Promise<void> {
    this.sc.destroy();
  }

  // ─── Header ────────────────────────────────────────────────────────────────

  private buildHeader(root: HTMLElement): void {
    this.headerEl = root.createDiv({ cls: "agy-header" });
    this.headerEl.createSpan({ cls: "agy-header-title", text: "AGY" });

    const right = this.headerEl.createDiv({ cls: "agy-header-right" });

    // Model selector (Spike 5)
    this.modelSelect = right.createEl("select", { cls: "agy-model-select" });
    this.modelSelect.addEventListener("change", () => {
      this.sc.setModel(this.modelSelect.value);
    });
    // Add placeholder option
    const placeholder = this.modelSelect.createEl("option", {
      text: "Loading models…",
      attr: { disabled: "", selected: "" },
    });

    // New chat button
    const newBtn = right.createEl("button", { cls: "agy-new-btn", text: "+" });
    newBtn.title = "New chat";
    newBtn.addEventListener("click", async () => {
      await this.sc.newSession();
      this.extraCtx = [];
      this.showEmpty();
    });
  }

  private async refreshModelList(): Promise<void> {
    const models = this.sc.getModels();
    if (models.length === 0) {
      // Models may not be loaded yet — wait a tick and try once
      await new Promise((r) => setTimeout(r, 1000));
    }
    const fresh = this.sc.getModels();
    if (fresh.length === 0) return;

    this.modelSelect.empty();
    const currentModel = this.sc.getSession().model;
    for (const m of fresh) {
      const opt = this.modelSelect.createEl("option", {
        value: m.id,
        text: m.name,
      });
      if (m.id === currentModel) opt.selected = true;
    }
  }

  // ─── Composer ──────────────────────────────────────────────────────────────

  private buildComposer(parent: HTMLElement): void {
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
      attr: { placeholder: "Ask AGY…", rows: "1" },
    });
    this.input.addEventListener("input",   () => this.onInput());
    this.input.addEventListener("keydown", (e) => this.onKey(e));

    const btnGroup = row.createDiv({ cls: "agy-btn-group" });

    this.cancelBtn = btnGroup.createEl("button", {
      cls: "agy-cancel-btn agy-hidden",
      text: "✕",
    });
    this.cancelBtn.title = "Stop";
    this.cancelBtn.addEventListener("click", () => {
      this.sc.destroy();
      this.setUIState("ANSWER");
      this.appendInlineError(this.thread, "Stopped.");
      this.agyCursorEl?.removeClass("agy-bubble--streaming");
      this.statusEl?.addClass("agy-hidden");
      this.agyCursorEl = null;
      this.statusEl = null;
    });

    this.sendBtn = btnGroup.createEl("button", {
      cls: "agy-send-btn",
      text: "↑",
    });
    this.sendBtn.disabled = true;
    this.sendBtn.addEventListener("click", () => this.doSend());
  }

  private syncChips(): void {
    const file = this.app.workspace.getActiveFile();
    const name = file?.basename ?? "note";
    this.noteChip.querySelector<HTMLElement>(".agy-chip-label")!.textContent = `@${name}`;

    const hasSel = !!this.ctx.getSelection();
    this.selectionChip.toggleClass("agy-chip--hidden", !hasSel);
  }

  private onInput(): void {
    this.sendBtn.disabled = this.input.value.trim() === "" || (this.uiState as UIState) === "RUNNING";
    this.input.style.height = "auto";
    this.input.style.height = Math.min(this.input.scrollHeight, 80) + "px";
  }

  private onKey(e: KeyboardEvent): void {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!this.sendBtn.disabled) this.doSend();
    }
    if (e.key === "Escape" && (this.uiState as UIState) === "RUNNING") {
      this.cancelBtn.click();
    }
  }

  // ─── Send turn ─────────────────────────────────────────────────────────────

  private async doSend(): Promise<void> {
    const prompt = this.input.value.trim();
    if (!prompt || (this.uiState as UIState) === "RUNNING") return;

    this.input.value = "";
    this.input.style.height = "";
    this.sendBtn.disabled = true;

    // Reset per-turn bubble & status refs
    this.agyCursorEl = null;
    this.statusEl = null;

    this.appendUserBubble(prompt);
    this.setUIState("RUNNING");
    this.ensureAgyBubble();

    const TIMEOUT_MS = 60_000;
    const timeout = window.setTimeout(() => {
      this.sc.destroy();
      this.setUIState("ANSWER");
      this.agyCursorEl?.removeClass("agy-bubble--streaming");
      this.statusEl?.addClass("agy-hidden");
      this.agyCursorEl = null;
      this.statusEl = null;
      this.appendInlineError(this.thread, "No response after 60 s. AGY may be busy.");
    }, TIMEOUT_MS);

    try {
      let proposalText = "";
      let inProposalBlock = false;
      let fullText = "";

      for await (const event of this.sc.sendTurn(prompt, this.extraCtx)) {
        if (event.type === "text") {
          fullText += event.content;

          // ── Detect structured edit proposal (Spike 3) ──────────────────
          // AGY is prompted (via system instructions) to emit proposals as
          // a fenced JSON block: ```edit-proposal\n{...}\n```
          // We buffer and detect that block without showing it raw.
          const merged = fullText;
          const startTag = "```edit-proposal";
          const endTag   = "```";

          if (!inProposalBlock && merged.includes(startTag)) {
            inProposalBlock = true;
            // Render text before the block
            const before = merged.slice(0, merged.indexOf(startTag));
            this.appendToAgyBubble(before.replace(fullText.slice(0, fullText.indexOf(startTag)), ""));
          } else if (inProposalBlock) {
            proposalText = merged.slice(merged.indexOf(startTag) + startTag.length);
            const closeIdx = proposalText.indexOf("\n" + endTag);
            if (closeIdx !== -1) {
              // Proposal complete — parse and show proposal bubble
              const json = proposalText.slice(0, closeIdx).trim();
              inProposalBlock = false;
              try {
                const proposal = JSON.parse(json) as EditProposal;
                window.clearTimeout(timeout);
                this.setUIState("PROPOSAL");
                this.appendProposalBubble(proposal);
              } catch {
                this.appendInlineError(this.thread, "Could not parse edit proposal.");
                this.setUIState("ANSWER");
              }
            }
          } else {
            // Normal streaming text
            this.appendToAgyBubble(event.content);
            this.scrollThread();
          }
        }

        if (event.type === "done") {
          window.clearTimeout(timeout);
          if ((this.uiState as UIState) === "RUNNING") this.setUIState("ANSWER");
          this.agyCursorEl?.removeClass("agy-bubble--streaming");
          this.statusEl?.addClass("agy-hidden");
          this.agyCursorEl = null;
          this.statusEl = null;
        }

        if (event.type === "error") {
          window.clearTimeout(timeout);
          this.agyCursorEl?.removeClass("agy-bubble--streaming");
          this.statusEl?.addClass("agy-hidden");
          this.appendInlineError(this.thread, event.error);
          this.setUIState("ANSWER");
          this.agyCursorEl = null;
          this.statusEl = null;
        }
      }
    } catch (err) {
      window.clearTimeout(timeout);
      this.agyCursorEl?.removeClass("agy-bubble--streaming");
      this.statusEl?.addClass("agy-hidden");
      this.agyCursorEl = null;
      this.statusEl = null;
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

  private setUIState(s: UIState): void {
    this.uiState = s;
    const busy = s === "RUNNING";
    this.input.disabled = busy || s === "ERROR";
    this.sendBtn.disabled = busy || s === "ERROR" || this.input.value.trim() === "";
    this.cancelBtn.toggleClass("agy-hidden", !busy);
    this.statusEl?.toggleClass("agy-hidden", !busy);
  }

  // ─── Empty / Error slates ───────────────────────────────────────────────────

  private showEmpty(): void {
    this.thread.empty();
    this.agyCursorEl = null;
    this.statusEl = null;
    const slate = this.thread.createDiv({ cls: "agy-empty-slate" });
    slate.createDiv({ cls: "agy-empty-icon", text: "✦" });
    slate.createDiv({ cls: "agy-empty-label", text: "Ask AGY about this note" });
    this.setUIState("EMPTY");
    this.syncChips();
  }

  private showError(msg: string): void {
    this.thread.empty();
    this.agyCursorEl = null;
    this.statusEl = null;
    const slate = this.thread.createDiv({ cls: "agy-error-slate" });
    slate.createDiv({ cls: "agy-error-icon", text: "⚠" });
    slate.createDiv({ cls: "agy-error-title", text: "AGY unavailable" });
    slate.createDiv({ cls: "agy-error-body", text: msg });
    const btn = slate.createEl("button", {
      cls: "agy-configure-btn",
      text: "Configure AGY →",
    });
    btn.addEventListener("click", () => {
      (this.app as any).setting?.open?.();
    });
    this.setUIState("ERROR");
  }

  // ─── Bubble builders ────────────────────────────────────────────────────────

  private appendUserBubble(text: string): void {
    // Remove empty slate if first message
    this.thread.querySelector(".agy-empty-slate")?.remove();
    const b = this.thread.createDiv({ cls: "agy-bubble agy-bubble--user" });
    b.setText(text);
  }

  private ensureAgyBubble(): void {
    if (this.agyCursorEl) return;

    // Status line
    this.statusEl = this.thread.createDiv({ cls: "agy-status-line" });
    this.statusEl.createDiv({ cls: "agy-spinner" });
    const label = this.statusEl.createSpan();
    const sel = this.ctx.getSelection();
    label.textContent = sel ? "Reading selection…" : "Reading note…";

    // Response bubble
    this.agyCursorEl = this.thread.createDiv({
      cls: "agy-bubble agy-bubble--agy agy-bubble--streaming",
    });
  }

  private appendToAgyBubble(text: string): void {
    if (!this.agyCursorEl) return;
    this.agyCursorEl.appendText(text);
  }

  private appendProposalBubble(proposal: EditProposal): void {
    const wrap = this.thread.createDiv({ cls: "agy-proposal" });

    // File badge
    wrap.createDiv({ cls: "agy-proposal-badge", text: "📄 " + proposal.file });

    // Diff
    if (proposal.reason) {
      wrap.createDiv({ cls: "agy-proposal-reason", text: proposal.reason });
    }
    const diff = wrap.createDiv({ cls: "agy-proposal-diff" });
    proposal.original.split("\n").forEach((line) =>
      diff.createDiv({ cls: "agy-diff-removed", text: "- " + line })
    );
    proposal.replacement.split("\n").forEach((line) =>
      diff.createDiv({ cls: "agy-diff-added",   text: "+ " + line })
    );

    // Actions (Spike 4)
    const actions = wrap.createDiv({ cls: "agy-proposal-actions" });

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

      const result = await this.sc.applyProposal(proposal);
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

  private appendInlineError(parent: HTMLElement, msg: string): void {
    parent.createDiv({ cls: "agy-inline-error", text: "⚠ " + msg });
    this.scrollThread();
  }

  private scrollThread(): void {
    this.thread.scrollTo({ top: this.thread.scrollHeight, behavior: "smooth" });
  }
}
