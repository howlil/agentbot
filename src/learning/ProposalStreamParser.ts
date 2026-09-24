import { EditProposal } from "../types";

export type ProposalStreamEvent =
  | { type: "text"; text: string }
  | { type: "proposal"; proposal: EditProposal }
  | { type: "error"; message: string };

const START_TAG = "```edit-proposal";
const END_TAG = "\n```";

function isEditProposal(value: unknown): value is EditProposal {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;

  return (
    typeof obj.file === "string" &&
    typeof obj.original === "string" &&
    typeof obj.replacement === "string" &&
    (obj.reason === undefined || typeof obj.reason === "string")
  );
}

/**
 * Incrementally removes structured edit-proposal blocks from streamed text.
 * This keeps protocol parsing out of the view while preserving normal token
 * streaming even when the opening/closing fence is split across chunks.
 */
export class ProposalStreamParser {
  private buffer = "";
  private mode: "text" | "proposal" = "text";

  push(chunk: string): ProposalStreamEvent[] {
    this.buffer += chunk;
    return this.drain(false);
  }

  finish(): ProposalStreamEvent[] {
    return this.drain(true);
  }

  private drain(final: boolean): ProposalStreamEvent[] {
    const events: ProposalStreamEvent[] = [];

    while (this.buffer.length > 0) {
      if (this.mode === "text") {
        const start = this.buffer.indexOf(START_TAG);

        if (start >= 0) {
          const visible = this.buffer.slice(0, start);
          if (visible) events.push({ type: "text", text: visible });

          this.buffer = this.buffer.slice(start + START_TAG.length);
          this.mode = "proposal";
          continue;
        }

        if (final) {
          events.push({ type: "text", text: this.buffer });
          this.buffer = "";
          break;
        }

        // Retain enough tail to detect an opening marker split across chunks.
        const keep = Math.min(START_TAG.length - 1, this.buffer.length);
        const emitLength = this.buffer.length - keep;

        if (emitLength > 0) {
          events.push({
            type: "text",
            text: this.buffer.slice(0, emitLength),
          });
          this.buffer = this.buffer.slice(emitLength);
        }
        break;
      }

      const end = this.buffer.indexOf(END_TAG);

      if (end < 0) {
        if (final) {
          events.push({
            type: "error",
            message: "Incomplete edit proposal returned by the agent.",
          });
          this.buffer = "";
          this.mode = "text";
        }
        break;
      }

      const raw = this.buffer.slice(0, end).trim();
      this.buffer = this.buffer.slice(end + END_TAG.length);
      this.mode = "text";

      try {
        const parsed: unknown = JSON.parse(raw);
        if (!isEditProposal(parsed)) {
          events.push({
            type: "error",
            message: "Agent returned an invalid edit proposal.",
          });
          continue;
        }

        events.push({
          type: "proposal",
          proposal: parsed,
        });
      } catch {
        events.push({
          type: "error",
          message: "Could not parse edit proposal returned by the agent.",
        });
      }
    }

    return events;
  }
}
