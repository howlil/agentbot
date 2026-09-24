import { App, TFile } from "obsidian";

/**
 * ObsidianContext — resolves context from the active Obsidian workspace.
 *
 * Resolution rules (Spike 2):
 *   1. Selection present → context = [selection]
 *   2. No selection      → context = [current-note]
 *   3. User adds @file   → context = [auto] + [explicit...]
 *
 * Every context item is visible as a chip in the Composer.
 * Nothing is read silently.
 */
export class ObsidianContext {
  constructor(private app: App) {}

  /** Current editor selection, or null. */
  getSelection(): { file: string; content: string } | null {
    // @ts-ignore — MarkdownView exposes .editor
    const editor = this.app.workspace.activeLeaf?.view?.editor;
    if (!editor) return null;
    const sel = editor.getSelection?.() ?? "";
    if (!sel) return null;
    const file = this.app.workspace.getActiveFile();
    return { file: file?.path ?? "untitled", content: sel };
  }

  /** Full content of the active note, or null. */
  async getCurrentNote(): Promise<{ file: string; content: string } | null> {
    const file = this.app.workspace.getActiveFile();
    if (!file || !(file instanceof TFile)) return null;
    const content = await this.app.vault.cachedRead(file);
    return { file: file.path, content };
  }

}
