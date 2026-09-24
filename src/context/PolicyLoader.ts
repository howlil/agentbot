import { App, TFile } from "obsidian";
import { LearningPolicy } from "./context-types";

/**
 * Loads vault-level learning policy from AGENTS.md.
 *
 * The raw file is intentionally preserved as policy text. We only parse policy
 * into structured fields when application behavior truly needs those fields.
 */
export class PolicyLoader {
  private cached:
    | {
        mtime: number;
        policy: LearningPolicy;
      }
    | undefined;

  constructor(private readonly app: App) {}

  async load(): Promise<LearningPolicy> {
    const file = this.app.vault.getFileByPath("AGENTS.md");

    if (!file || !(file instanceof TFile)) {
      this.cached = undefined;
      return {
        path: "AGENTS.md",
        rawInstructions: "",
      };
    }

    if (this.cached?.mtime === file.stat.mtime) {
      return this.cached.policy;
    }

    const policy: LearningPolicy = {
      path: file.path,
      rawInstructions: await this.app.vault.cachedRead(file),
    };

    this.cached = {
      mtime: file.stat.mtime,
      policy,
    };

    return policy;
  }
}
