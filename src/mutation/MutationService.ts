import { App, MarkdownView, TFile } from "obsidian";
import { ApplyResult, EditProposal } from "../types";

function findOccurrences(content: string, needle: string): number[] {
  if (!needle) return [];

  const matches: number[] = [];
  let cursor = 0;

  while (cursor <= content.length - needle.length) {
    const index = content.indexOf(needle, cursor);
    if (index === -1) break;

    matches.push(index);
    cursor = index + needle.length;
  }

  return matches;
}

/**
 * Owns user-approved Markdown mutations.
 *
 * Agent output is only a proposal. This service revalidates the target at
 * apply-time and refuses stale or ambiguous replacements.
 */
export class MutationService {
  constructor(private readonly app: App) {}

  async apply(proposal: EditProposal): Promise<ApplyResult> {
    const file = this.app.vault.getFileByPath(proposal.file);

    if (!file || !(file instanceof TFile)) {
      return {
        ok: false,
        reason: "missing-file",
        message: `Target note not found: ${proposal.file}`,
      };
    }

    try {
      const activeFile = this.app.workspace.getActiveFile();
      const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);

      if (activeFile?.path === file.path && activeView?.editor) {
        const editor = activeView.editor;
        const content = editor.getValue();
        const matches = findOccurrences(content, proposal.original);

        if (matches.length === 0) {
          return {
            ok: false,
            reason: "stale",
            message: "Note changed since the proposal was made. Regenerate the edit.",
          };
        }

        if (matches.length > 1) {
          return {
            ok: false,
            reason: "ambiguous",
            message: "The original text occurs more than once. Regenerate with a more specific selection.",
          };
        }

        const index = matches[0];
        const from = editor.offsetToPos(index);
        const to = editor.offsetToPos(index + proposal.original.length);

        editor.replaceRange(proposal.replacement, from, to);
        return { ok: true };
      }

      const content = await this.app.vault.cachedRead(file);
      const matches = findOccurrences(content, proposal.original);

      if (matches.length === 0) {
        return {
          ok: false,
          reason: "stale",
          message: "Note changed since the proposal was made. Regenerate the edit.",
        };
      }

      if (matches.length > 1) {
        return {
          ok: false,
          reason: "ambiguous",
          message: "The original text occurs more than once. Regenerate with a more specific selection.",
        };
      }

      const index = matches[0];
      const next =
        content.slice(0, index) +
        proposal.replacement +
        content.slice(index + proposal.original.length);

      await this.app.vault.modify(file, next);
      return { ok: true };
    } catch (err) {
      return {
        ok: false,
        reason: "error",
        message: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
