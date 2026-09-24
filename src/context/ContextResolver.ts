import { AgentContext } from "../types";
import { ObsidianContext } from "./ObsidianContext";
import { ContextDocument, LearningContext } from "./context-types";

/**
 * Single source of truth for the context shown in the UI and sent to the agent.
 *
 * Precedence:
 *   selection -> current note -> no automatic material
 * Explicit refs are additive supporting context.
 */
export class ContextResolver {
  constructor(private readonly obsidian: ObsidianContext) {}

  async resolve(explicit: AgentContext[] = []): Promise<LearningContext> {
    const selection = this.obsidian.getSelection();
    const activeNote = await this.obsidian.getCurrentNote();

    const explicitDocs: ContextDocument[] = explicit.map((item) => ({
      type: item.type,
      path: item.file,
      content: item.content,
      source: "explicit",
    }));

    return {
      selection: selection ?? undefined,
      activeNote: activeNote
        ? { path: activeNote.file, content: activeNote.content }
        : undefined,
      explicit: explicitDocs,
    };
  }

  /**
   * Convert resolved learning context to the existing agent transport shape.
   * Only one automatic primary material is included:
   * selection when present, otherwise the current note.
   */
  toAgentContext(context: LearningContext): AgentContext[] {
    const result: AgentContext[] = [];

    if (context.selection) {
      result.push({
        type: "selection",
        file: context.selection.file,
        content: context.selection.content,
      });
    } else if (context.activeNote) {
      result.push({
        type: "note",
        file: context.activeNote.path,
        content: context.activeNote.content,
      });
    }

    for (const item of context.explicit) {
      const duplicate = result.some(
        (existing) =>
          existing.type === item.type &&
          existing.file === item.path &&
          existing.content === item.content,
      );
      if (duplicate) continue;

      result.push({
        type: item.type,
        file: item.path,
        content: item.content,
      });
    }

    return result;
  }
}
