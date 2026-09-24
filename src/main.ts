import { FileSystemAdapter, Plugin } from "obsidian";
import { AgyAdapter } from "./agent/AgyAdapter";
import { ChatView, AGY_VIEW_TYPE } from "./chat/ChatView";
import { ContextResolver } from "./context/ContextResolver";
import { ObsidianContext } from "./context/ObsidianContext";
import { PolicyLoader } from "./context/PolicyLoader";
import { LearningController } from "./learning/LearningController";
import { MutationService } from "./mutation/MutationService";
import { SessionController } from "./session/SessionController";
import { SessionStore } from "./session/SessionStore";

/**
 * Composition root.
 *
 * Business behavior belongs in LearningController/services; this file only
 * constructs dependencies, registers Obsidian surfaces, and disposes runtime
 * resources.
 */
export default class AgyPlugin extends Plugin {
  private learning!: LearningController;

  async onload(): Promise<void> {
    const vaultAdapter = this.app.vault.adapter;
    const vaultPath =
      vaultAdapter instanceof FileSystemAdapter
        ? vaultAdapter.getBasePath()
        : undefined;

    const adapter = new AgyAdapter(vaultPath);
    const sessionStore = new SessionStore();
    const sessions = new SessionController(
      this,
      sessionStore,
      adapter,
    );

    await sessions.init();

    const obsidianContext = new ObsidianContext(this.app);
    const contexts = new ContextResolver(obsidianContext);
    const policies = new PolicyLoader(this.app);
    const mutations = new MutationService(this.app);

    this.learning = new LearningController(
      sessions,
      contexts,
      policies,
      mutations,
    );

    this.registerView(
      AGY_VIEW_TYPE,
      (leaf) => new ChatView(leaf, this.learning),
    );

    this.addRibbonIcon(
      "sparkles",
      "Open Learning Agent",
      () => this.activateView(),
    );

    this.addCommand({
      id: "open-agy-sidebar",
      name: "Open Learning Agent sidebar",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "focus-agy-composer",
      name: "Focus Learning Agent composer",
      hotkeys: [{ modifiers: ["Mod"], key: "l" }],
      callback: async () => {
        await this.activateView();

        setTimeout(() => {
          const leaves = this.app.workspace.getLeavesOfType(AGY_VIEW_TYPE);
          const view = leaves[0]?.view as ChatView | undefined;
          (view as any)?.input?.focus?.();
        }, 100);
      },
    });
  }

  async onunload(): Promise<void> {
    this.app.workspace.detachLeavesOfType(AGY_VIEW_TYPE);
    this.learning?.dispose();
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

    await leaf.setViewState({
      type: AGY_VIEW_TYPE,
      active: true,
    });
    workspace.revealLeaf(leaf);
  }
}
