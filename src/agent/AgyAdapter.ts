import { spawn, ChildProcess } from "child_process";
import {
  AgentAdapter,
  AgentInput,
  AgentContext,
  AgyStreamEvent,
  AgyModel,
  SendOptions,
} from "../types";

// ─── AGY CLI stream-json protocol ─────────────────────────────────────────────
//
// Invocation:
//   agy --input-format stream-json --output-format stream-json [--model <id>]
//       [--conversation <id>]
//
// stdin (one JSON line per turn):
//   {"role":"user","content":"<prompt>"}
//
// stdout (NDJSON stream):
//   {"event":"init","conversation_id":"<uuid>","init":{...}}
//   {"event":"text","text":"<delta>"}     ← streaming text token
//   {"event":"result","result":{...}}     ← turn complete
//   {"event":"error","error":"<msg>"}
//
// Reference: observed from `agy --help` + live test.
// ──────────────────────────────────────────────────────────────────────────────

export class AgyAdapter implements AgentAdapter {
  private proc: ChildProcess | null = null;

  // ── ping ──────────────────────────────────────────────────────────────────

  async ping(): Promise<string> {
    return new Promise((resolve, reject) => {
      const which = process.platform === "win32" ? "where" : "which";
      const p = spawn(which, ["agy"]);
      let out = "";
      p.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      p.on("close", (code) => {
        if (code === 0 && out.trim()) {
          resolve(out.trim().split(/\r?\n/)[0]);
        } else {
          reject(new Error("AGY CLI not found. Install it and ensure 'agy' is in PATH."));
        }
      });
    });
  }

  // ── send ──────────────────────────────────────────────────────────────────

  async *send(input: AgentInput, opts: SendOptions): AsyncIterable<AgyStreamEvent> {
    const bin = await this.ping();
    const fullPrompt = this.buildFullPrompt(input);
    const args = this.buildArgs(fullPrompt, opts);

    this.proc = spawn(bin, args, { stdio: ["ignore", "pipe", "pipe"] });
    const { proc } = this;

    // Yield events from stdout NDJSON stream
    yield* this.readEvents(proc);
  }

  private buildArgs(prompt: string, opts: SendOptions): string[] {
    const args = [
      "--print", prompt,
      "--output-format", "stream-json",
      "--dangerously-skip-permissions",
    ];
    if (opts.model) {
      args.push("--model", opts.model);
    }
    if (opts.conversationId) {
      args.push("--conversation", opts.conversationId);
    }
    return args;
  }

  /**
   * Format AgentInput with context as a structured preamble before prompt.
   */
  private buildFullPrompt(input: AgentInput): string {
    const contextPreamble = this.formatContext(input.context);
    return contextPreamble
      ? `${contextPreamble}\n\n---\n\n${input.prompt}`
      : input.prompt;
  }

  private formatContext(ctx: AgentContext[]): string {
    if (ctx.length === 0) return "";
    return ctx
      .map((c) => {
        const label =
          c.type === "selection"
            ? `[Selected text from ${c.file}]`
            : `[Note: ${c.file}]`;
        return `${label}\n\`\`\`\n${c.content}\n\`\`\``;
      })
      .join("\n\n");
  }

  // ── stdout reader ─────────────────────────────────────────────────────────

  private async *readEvents(proc: ChildProcess): AsyncIterable<AgyStreamEvent> {
    let buffer = "";
    const queue: string[] = [];
    let notify: (() => void) | null = null;
    let closed = false;

    const push = (line: string) => {
      queue.push(line);
      notify?.();
      notify = null;
    };

    proc.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const parts = buffer.split(/\r?\n/);
      buffer = parts.pop() ?? "";
      for (const part of parts) {
        const line = part.trim();
        if (line) push(line);
      }
    });

    proc.stderr?.on("data", (chunk: Buffer) => {
      const msg = chunk.toString().trim();
      if (msg) console.warn("[AgyAdapter]", msg);
    });

    proc.on("close", () => {
      closed = true;
      notify?.();
      notify = null;
    });

    while (true) {
      if (queue.length > 0) {
        const line = queue.shift()!;
        const event = this.parseLine(line);
        if (event) {
          yield event;
          if (event.type === "done" || event.type === "error") break;
        }
      } else if (closed) {
        break;
      } else {
        await new Promise<void>((res) => { notify = res; });
      }
    }
  }

  /**
   * Parse one NDJSON line from AGY stdout into an AgyStreamEvent.
   *
   * Known AGY output events:
   *   {"event":"init","conversation_id":"..."}
   *   {"event":"text","text":"..."}
   *   {"event":"result","result":{...}}
   *   {"event":"error","error":"..."}
   */
  private parseLine(line: string): AgyStreamEvent | null {
    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(line);
    } catch {
      return null; // non-JSON debug output — skip
    }

    const ev = obj["event"] as string | undefined;

    if (ev === "init") {
      // Extract conversation_id and emit as metadata (ignore in stream)
      const convId =
        (obj["conversation_id"] as string | undefined) ||
        ((obj["init"] as Record<string, unknown> | undefined)?.["conversation_id"] as string | undefined);
      this._lastConversationId = convId;
      return null; // init is not a user-visible event
    }

    // Real AGY stream event: {"event":"step_update","step_update":{"state":"ACTIVE","step_type":"agent_response","text_delta":"..."}}
    if (ev === "step_update") {
      const su = obj["step_update"] as Record<string, unknown> | undefined;
      const delta = su?.["text_delta"] as string | undefined;
      if (delta) {
        return { type: "text", content: delta };
      }
      return null;
    }

    // Fallback if legacy/mock emits "text" event
    if (ev === "text") {
      const text = obj["text"] as string | undefined;
      if (text) return { type: "text", content: text };
      return null;
    }

    if (ev === "result") {
      const res = obj["result"] as Record<string, unknown> | undefined;
      const convId =
        (res?.["conversation_id"] as string | undefined) || this._lastConversationId;
      return { type: "done", conversationId: convId };
    }

    if (ev === "error") {
      return { type: "error", error: String(obj["error"] ?? "Unknown error") };
    }

    return null; // unknown event — skip
  }

  // ── listModels ────────────────────────────────────────────────────────────

  async listModels(): Promise<AgyModel[]> {
    const bin = await this.ping();
    return new Promise((resolve, reject) => {
      const p = spawn(bin, ["models"]);
      let out = "";
      p.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      p.on("close", () => {
        const models: AgyModel[] = out
          .split(/\r?\n/)
          .filter((l) => l.includes("\t"))
          .map((l) => {
            const [id, ...rest] = l.split("\t");
            return { id: id.trim(), name: rest.join("\t").trim() };
          });
        resolve(models);
      });
      p.on("error", reject);
    });
  }

  // ── abort ─────────────────────────────────────────────────────────────────

  abort(): void {
    this.proc?.kill("SIGTERM");
    this.proc = null;
  }

  // ── internal state ────────────────────────────────────────────────────────

  /** Populated from init event; read by caller after turn completes. */
  _lastConversationId: string | undefined;
}
