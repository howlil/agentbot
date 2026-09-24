import { App, TFile } from "obsidian";
import { AgentContext } from "../types";

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

  /**
   * Resolve the automatic context for a new turn.
   * Returns [selection] if present, else [current-note].
   */
  async resolveAuto(): Promise<AgentContext[]> {
    const sel = this.getSelection();
    if (sel) {
      return [{ type: "selection", file: sel.file, content: sel.content }];
    }
    const note = await this.getCurrentNote();
    if (note) {
      return [{ type: "note", file: note.file, content: note.content }];
    }
    return [];
  }

  /**
   * Load a specific file by path for @mention context.
   * Returns null if file does not exist.
   */
  async loadFile(path: string): Promise<AgentContext | null> {
    const file = this.app.vault.getFileByPath(path);
    if (!file || !(file instanceof TFile)) return null;
    const content = await this.app.vault.cachedRead(file);
    return { type: "note", file: path, content };
  }

  /**
   * Verify that `original` still exists verbatim in the active file.
   * Used before Apply to detect stale proposals.
   */
  async verifyOriginal(filePath: string, original: string): Promise<boolean> {
    const file = this.app.vault.getFileByPath(filePath);
    if (!file || !(file instanceof TFile)) return false;
    const content = await this.app.vault.cachedRead(file);
    return content.includes(original);
  }
}
