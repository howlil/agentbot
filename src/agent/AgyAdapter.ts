import { ChildProcess, spawn } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  AgentAdapter,
  AgentInput,
  AgentContext,
  AgyStreamEvent,
  AgyModel,
  SendOptions,
} from "../types";

// AGY print-mode protocol used by this adapter:
//
//   agy --print <prompt> --output-format stream-json [--model <id>]
//       [--conversation <id>]
//
// stdout is NDJSON:
//   {"event":"init", ...}
//   {"event":"step_update","step_update":{"step_type":"agent_response","text_delta":"..."}}
//   {"event":"result","result":{"status":"SUCCESS|ERROR|...","response":"...","error":"..."}}
//
// Each send() starts one print-mode process. Conversation continuity is restored
// with --conversation <id>. The UI only sees normalized AgyStreamEvent values.

export class AgyAdapter implements AgentAdapter {
  private proc: ChildProcess | null = null;

  constructor(private readonly cwd?: string) {}

  // ── binary resolution ─────────────────────────────────────────────────────

  async ping(): Promise<string> {
    const configured = process.env.AGY_PATH?.trim();
    const candidates = [
      configured,
      ...(process.platform === "win32"
        ? [
            process.env.LOCALAPPDATA
              ? join(process.env.LOCALAPPDATA, "agy", "bin", "agy.exe")
              : undefined,
            process.env.ProgramFiles
              ? join(process.env.ProgramFiles, "Google", "antigravity-cli", "agy.exe")
              : undefined,
          ]
        : [join(homedir(), ".local", "bin", "agy")]),
    ].filter((value): value is string => Boolean(value));

    for (const candidate of candidates) {
      if (existsSync(candidate)) return candidate;
    }

    return new Promise((resolve, reject) => {
      const locator = process.platform === "win32" ? "where" : "which";
      const p = spawn(locator, ["agy"]);
      let out = "";
      let settled = false;

      const fail = () => {
        if (settled) return;
        settled = true;
        reject(
          new Error(
            "AGY CLI not found. Install it, restart Obsidian after changing PATH, or set AGY_PATH to the AGY executable.",
          ),
        );
      };

      p.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      p.on("error", fail);
      p.on("close", (code) => {
        if (settled) return;
        if (code === 0 && out.trim()) {
          settled = true;
          resolve(out.trim().split(/\r?\n/)[0]);
          return;
        }
        fail();
      });
    });
  }

  // ── send ──────────────────────────────────────────────────────────────────

  async *send(input: AgentInput, opts: SendOptions): AsyncIterable<AgyStreamEvent> {
    const bin = await this.ping();
    const fullPrompt = this.buildFullPrompt(input);
    const args = this.buildArgs(fullPrompt, opts);

    const proc = spawn(bin, args, {
      cwd: this.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    this.proc = proc;
    proc.once("close", () => {
      if (this.proc === proc) this.proc = null;
    });

    yield* this.readEvents(proc);
  }

  private buildArgs(prompt: string, opts: SendOptions): string[] {
    const args = [
      "--print",
      prompt,
      "--output-format",
      "stream-json",
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
    let stderr = "";
    let exitCode: number | null = null;
    let spawnError: Error | null = null;
    let closed = false;
    let sawTerminalEvent = false;

    const queue: string[] = [];
    let notify: (() => void) | null = null;

    const wake = () => {
      notify?.();
      notify = null;
    };

    const push = (line: string) => {
      queue.push(line);
      wake();
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
      const msg = chunk.toString();
      stderr += msg;
      const trimmed = msg.trim();
      if (trimmed) console.warn("[AgyAdapter]", trimmed);
    });

    proc.on("error", (err) => {
      spawnError = err;
      wake();
    });

    proc.on("close", (code) => {
      exitCode = code;
      const finalLine = buffer.trim();
      buffer = "";
      if (finalLine) queue.push(finalLine);
      closed = true;
      wake();
    });

    while (true) {
      if (queue.length > 0) {
        const line = queue.shift()!;
        const event = this.parseLine(line);

        if (!event) continue;

        yield event;

        if (event.type === "done" || event.type === "error") {
          sawTerminalEvent = true;
          break;
        }

        continue;
      }

      if (closed) {
        if (!sawTerminalEvent) {
          const detail =
            spawnError?.message ||
            stderr.trim() ||
            (exitCode !== 0
              ? `AGY exited with code ${exitCode ?? "unknown"} before returning a result.`
              : "AGY exited without returning a result.");

          yield { type: "error", error: detail };
        }
        break;
      }

      if (spawnError) {
        yield { type: "error", error: spawnError.message };
        break;
      }

      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
  }

  /**
   * Parse one AGY NDJSON line into a normalized event.
   */
  private parseLine(line: string): AgyStreamEvent | null {
    let obj: Record<string, unknown>;

    try {
      obj = JSON.parse(line);
    } catch {
      // stdout should be machine-readable in stream-json mode. Ignore an
      // unexpected diagnostic line here; stderr/exit handling will still
      // surface a failed run to the UI.
      return null;
    }

    const ev = obj["event"] as string | undefined;

    if (ev === "init") {
      const convId =
        (obj["conversation_id"] as string | undefined) ||
        ((obj["init"] as Record<string, unknown> | undefined)?.[
          "conversation_id"
        ] as string | undefined);

      if (convId) this._lastConversationId = convId;
      return null;
    }

    if (ev === "step_update") {
      const su = obj["step_update"] as Record<string, unknown> | undefined;
      const delta = su?.["text_delta"] as string | undefined;

      if (delta) return { type: "text", content: delta };
      return null;
    }

    // Compatibility with older mocks/protocol experiments.
    if (ev === "text") {
      const text = obj["text"] as string | undefined;
      if (text) return { type: "text", content: text };
      return null;
    }

    if (ev === "result") {
      const result = obj["result"] as Record<string, unknown> | undefined;
      const status = String(result?.["status"] ?? "").toUpperCase();
      const convId =
        (result?.["conversation_id"] as string | undefined) ||
        this._lastConversationId;

      if (convId) this._lastConversationId = convId;

      // AGY reports print-mode failures inside the terminal result envelope.
      // Treat every explicit non-SUCCESS terminal state as an error instead
      // of silently converting it to "done".
      if (status && status !== "SUCCESS") {
        const message = String(
          result?.["error"] ??
            `AGY finished with status ${status} without an error message.`,
        );

        return { type: "error", error: message };
      }

      return { type: "done", conversationId: convId };
    }

    if (ev === "error") {
      return {
        type: "error",
        error: String(obj["error"] ?? "Unknown AGY error"),
      };
    }

    return null;
  }

  // ── listModels ────────────────────────────────────────────────────────────

  async listModels(): Promise<AgyModel[]> {
    const bin = await this.ping();

    return new Promise((resolve, reject) => {
      const p = spawn(bin, ["models"], {
        cwd: this.cwd,
        windowsHide: true,
      });
      let out = "";
      let err = "";

      p.stdout?.on("data", (d: Buffer) => (out += d.toString()));
      p.stderr?.on("data", (d: Buffer) => (err += d.toString()));
      p.on("error", reject);
      p.on("close", (code) => {
        if (code !== 0) {
          reject(
            new Error(
              err.trim() || `Failed to list AGY models (exit ${code ?? "unknown"}).`,
            ),
          );
          return;
        }

        const models: AgyModel[] = out
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean)
          .map((line) => {
            // Current human-readable output is column-oriented. Accept tabs
            // and 2+ spaces so the selector still works across CLI versions.
            const columns = line.split(/\t+|\s{2,}/).filter(Boolean);
            if (columns.length < 2) return null;
            return {
              id: columns[0].trim(),
              name: columns.slice(1).join(" ").trim(),
            };
          })
          .filter((model): model is AgyModel => model !== null);

        resolve(models);
      });
    });
  }

  // ── abort ─────────────────────────────────────────────────────────────────

  abort(): void {
    const proc = this.proc;
    this.proc = null;

    if (proc && proc.exitCode === null && !proc.killed) {
      proc.kill("SIGTERM");
    }
  }

  // ── internal state ────────────────────────────────────────────────────────

  /** Populated from AGY init/result events; used to resume the next turn. */
  _lastConversationId: string | undefined;
}
