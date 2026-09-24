import {
  App,
  MarkdownView,
  Plugin,
  TFile,
} from "obsidian";

/**
 * Resolves learning context from the most recent Markdown editor rather than
 * blindly trusting workspace.activeLeaf. The Forge sidebar can own focus
 * without losing the learner's note/selection.
 */
export class ObsidianContext {
  private lastMarkdownView: MarkdownView | null = null;

  constructor(
    private readonly app: App,
    plugin: Plugin,
  ) {
    this.captureCurrentMarkdownView();

    plugin.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (leaf?.view instanceof MarkdownView) {
          this.lastMarkdownView = leaf.view;
        }
      }),
    );

    plugin.registerEvent(
      this.app.workspace.on("file-open", () => {
        this.captureCurrentMarkdownView();
      }),
    );
  }

  getSelection(): { file: string; content: string } | null {
    const view = this.getRelevantMarkdownView();
    const file = view?.file;
    const selection = view?.editor.getSelection() ?? "";

    if (!file || !selection) return null;

    return {
      file: file.path,
      content: selection,
    };
  }

  async getCurrentNote(): Promise<{ file: string; content: string } | null> {
    const view = this.getRelevantMarkdownView();

    if (view?.file) {
      return {
        file: view.file.path,
        content: view.editor.getValue(),
      };
    }

    const file = this.app.workspace.getActiveFile();
    if (!file || !(file instanceof TFile)) return null;

    return {
      file: file.path,
      content: await this.app.vault.cachedRead(file),
    };
  }

  searchNotes(
    query: string,
    limit = 8,
  ): Array<{ path: string; name: string }> {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return [];

    return this.app.vault
      .getMarkdownFiles()
      .map((file) => ({
        path: file.path,
        name: file.basename,
        score:
          file.basename.toLowerCase().startsWith(normalized)
            ? 0
            : file.path.toLowerCase().includes(normalized)
              ? 1
              : 2,
      }))
      .filter(
        (item) =>
          item.name.toLowerCase().includes(normalized) ||
          item.path.toLowerCase().includes(normalized),
      )
      .sort(
        (a, b) =>
          a.score - b.score || a.path.localeCompare(b.path),
      )
      .slice(0, limit)
      .map(({ path, name }) => ({ path, name }));
  }

  async loadNote(
    path: string,
  ): Promise<{ file: string; content: string } | null> {
    for (const leaf of this.app.workspace.getLeavesOfType("markdown")) {
      if (
        leaf.view instanceof MarkdownView &&
        leaf.view.file?.path === path
      ) {
        return {
          file: path,
          content: leaf.view.editor.getValue(),
        };
      }
    }

    const file = this.app.vault.getFileByPath(path);
    if (!file || !(file instanceof TFile)) return null;

    return {
      file: file.path,
      content: await this.app.vault.cachedRead(file),
    };
  }

  private captureCurrentMarkdownView(): void {
    const active =
      this.app.workspace.getActiveViewOfType(MarkdownView);

    if (active) {
      this.lastMarkdownView = active;
    }
  }

  private getRelevantMarkdownView(): MarkdownView | null {
    const active =
      this.app.workspace.getActiveViewOfType(MarkdownView);

    if (active) {
      this.lastMarkdownView = active;
      return active;
    }

    if (
      this.lastMarkdownView?.file &&
      this.app.workspace
        .getLeavesOfType("markdown")
        .some((leaf) => leaf.view === this.lastMarkdownView)
    ) {
      return this.lastMarkdownView;
    }

    this.lastMarkdownView = null;
    return null;
  }
}
