import { Plugin } from "obsidian";
import { AgyAdapter } from "./agent/AgyAdapter";
import { ObsidianContext } from "./context/ObsidianContext";
import { SessionStore } from "./session/SessionStore";
import { SessionController } from "./session/SessionController";
import { ChatView, AGY_VIEW_TYPE } from "./chat/ChatView";

/**
 * AgyPlugin — entry point.
 *
 * Wires together:
 *   AgyAdapter ← SessionController ← ChatView
 *                     ↑
 *               SessionStore + ObsidianContext
 *
 * Lifecycle:
 *   onload  → register view + ribbon + commands, init SessionController
 *   onunload → detach leaves (kills any running process via ChatView.onClose)
 */
export default class AgyPlugin extends Plugin {
  private adapter!: AgyAdapter;
  private store!: SessionStore;
  private ctx!: ObsidianContext;
  private sc!: SessionController;

  async onload(): Promise<void> {
    // Build core services
    this.adapter = new AgyAdapter();
    this.store   = new SessionStore();
    this.ctx     = new ObsidianContext(this.app);
    this.sc      = new SessionController(this, this.store, this.adapter, this.ctx);

    // Init session (loads persisted data, fetches models)
    await this.sc.init();

    // Register sidebar view
    this.registerView(
      AGY_VIEW_TYPE,
      (leaf) => new ChatView(leaf, this.sc, this.ctx)
    );

    // Ribbon icon
    this.addRibbonIcon("sparkles", "Open AGY", () => this.activateView());

    // Command palette
    this.addCommand({
      id: "open-agy-sidebar",
      name: "Open AGY sidebar",
      callback: () => this.activateView(),
    });

    // Keyboard shortcut: Ctrl/Cmd+L
    this.addCommand({
      id: "focus-agy-composer",
      name: "Focus AGY composer",
      hotkeys: [{ modifiers: ["Mod"], key: "l" }],
      callback: async () => {
        await this.activateView();
        // Give the leaf time to open, then focus the input
        setTimeout(() => {
          const leaves = this.app.workspace.getLeavesOfType(AGY_VIEW_TYPE);
          const view = leaves[0]?.view as ChatView | undefined;
          (view as any)?.input?.focus?.();
        }, 100);
      },
    });
  }

  async onunload(): Promise<void> {
    // Kills any running AGY process via ChatView.onClose → sc.destroy()
    this.app.workspace.detachLeavesOfType(AGY_VIEW_TYPE);
  }

  private async activateView(): Promise<void> {
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
}
