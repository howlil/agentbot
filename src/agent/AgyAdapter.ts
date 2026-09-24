import { ChildProcess, spawn } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import {
  AgentAdapter,
  AgentInput,
  AgentContext,
  AgentStreamEvent,
  AgentModel,
  AgentFailure,
  AgentHealth,
  AgentRuntimeConfig,
  SendOptions,
} from "../types";

function escapeAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

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
// with --conversation <id>. The UI only sees normalized AgentStreamEvent values.

export class AgyAdapter implements AgentAdapter {
  constructor(
    private readonly cwd?: string,
    private readonly getConfig: () => AgentRuntimeConfig = () => ({}),
  ) {}

  // ── binary resolution ─────────────────────────────────────────────────────

  async check(): Promise<AgentHealth> {
    try {
      await this.resolveBinary();
      return { status: "ready" };
    } catch (error) {
      const configured = this.getConfig().executablePath?.trim();
      return {
        status: configured ? "misconfigured" : "unavailable",
        failure: this.failureFrom(error, "runtime-unavailable"),
      };
    }
  }

  private async resolveBinary(): Promise<string> {
    const configured =
      this.getConfig().executablePath?.trim() ||
      process.env.AGY_PATH?.trim();
    if (configured && !existsSync(configured)) {
      throw new Error(`Configured agent executable does not exist: ${configured}`);
    }
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

  async *send(
    input: AgentInput,
    opts: SendOptions,
    signal: AbortSignal,
  ): AsyncIterable<AgentStreamEvent> {
    if (signal.aborted) {
      yield { type: "cancelled" };
      return;
    }

    let bin: string;
    try {
      bin = await this.resolveBinary();
    } catch (error) {
      yield {
        type: "failed",
        failure: this.failureFrom(error, "runtime-unavailable"),
      };
      return;
    }
    const fullPrompt = this.buildFullPrompt(input);
    const args = this.buildArgs(fullPrompt, opts);

    const proc = spawn(bin, args, {
      cwd: this.cwd,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });

    const abort = () => {
      if (proc.exitCode === null && !proc.killed) proc.kill("SIGTERM");
    };
    signal.addEventListener("abort", abort, { once: true });

    try {
      yield* this.readEvents(proc, signal);
    } finally {
      signal.removeEventListener("abort", abort);
      abort();
    }
  }

  private buildArgs(prompt: string, opts: SendOptions): string[] {
    const args = [
      "--print",
      prompt,
      "--output-format",
      "stream-json",
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
      .map((c, index) => {
        const type = c.type === "selection" ? "selection" : "note";
        const header = `<obsidian-context index="${index + 1}" type="${type}" file="${escapeAttribute(c.file)}">`;

        return `${header}\n${c.content}\n</obsidian-context>`;
      })
      .join("\n\n");
  }

  // ── stdout reader ─────────────────────────────────────────────────────────

  private async *readEvents(
    proc: ChildProcess,
    signal: AbortSignal,
  ): AsyncIterable<AgentStreamEvent> {
    let buffer = "";
    let stderr = "";
    let exitCode: number | null = null;
    const processState: { spawnError?: Error } = {};
    let closed = false;
    let sawTerminalEvent = false;
    let conversationId: string | undefined;

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
      if (trimmed) console.warn("[Forge agent provider]", trimmed);
    });

    proc.on("error", (err) => {
      processState.spawnError = err;
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
      if (signal.aborted) {
        yield { type: "cancelled" };
        break;
      }

      if (queue.length > 0) {
        const line = queue.shift()!;
        conversationId = this.readConversationId(line) ?? conversationId;
        const event = this.parseLine(line, conversationId);

        if (!event) continue;

        yield event;

        if (event.type === "completed" || event.type === "failed") {
          sawTerminalEvent = true;
          break;
        }

        continue;
      }

      if (closed) {
        if (!sawTerminalEvent) {
          if (signal.aborted) {
            yield { type: "cancelled" };
            break;
          }
          const detail =
            processState.spawnError?.message ||
            stderr.trim() ||
            (exitCode !== 0
              ? `AGY exited with code ${exitCode ?? "unknown"} before returning a result.`
              : "AGY exited without returning a result.");

          yield {
            type: "failed",
            failure: this.failureFrom(detail, "process-failed"),
          };
        }
        break;
      }

      if (processState.spawnError) {
        yield {
          type: "failed",
          failure: this.failureFrom(processState.spawnError, "process-failed"),
        };
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
  private parseLine(
    line: string,
    conversationId?: string,
  ): AgentStreamEvent | null {
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
        (result?.["conversation_id"] as string | undefined) || conversationId;

      // AGY reports print-mode failures inside the terminal result envelope.
      // Treat every explicit non-SUCCESS terminal state as an error instead
      // of silently converting it to "done".
      if (status && status !== "SUCCESS") {
        const message = String(
          result?.["error"] ??
            `AGY finished with status ${status} without an error message.`,
        );

        return {
          type: "failed",
          failure: this.failureFrom(message, this.classifyFailure(message)),
        };
      }

      return { type: "completed", conversationId: convId };
    }

    if (ev === "error") {
      return {
        type: "failed",
        failure: this.failureFrom(
          String(obj["error"] ?? "Unknown agent runtime error"),
          "process-failed",
        ),
      };
    }

    return null;
  }

  private readConversationId(line: string): string | undefined {
    try {
      const value = JSON.parse(line) as Record<string, unknown>;
      if (value["event"] !== "init") return undefined;
      return (
        (value["conversation_id"] as string | undefined) ||
        ((value["init"] as Record<string, unknown> | undefined)?.[
          "conversation_id"
        ] as string | undefined)
      );
    } catch {
      return undefined;
    }
  }

  // ── listModels ────────────────────────────────────────────────────────────

  async listModels(): Promise<AgentModel[]> {
    const bin = await this.resolveBinary();

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

        const models: AgentModel[] = out
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
          .filter((model): model is AgentModel => model !== null);

        resolve(models);
      });
    });
  }

  private classifyFailure(message: string): AgentFailure["code"] {
    const normalized = message.toLowerCase();
    if (normalized.includes("permission") || normalized.includes("approval")) {
      return "permission-required";
    }
    if (normalized.includes("json") || normalized.includes("protocol")) {
      return "protocol-invalid";
    }
    return "process-failed";
  }

  private failureFrom(
    error: unknown,
    code: AgentFailure["code"],
  ): AgentFailure {
    const diagnostic = error instanceof Error ? error.message : String(error);
    const message =
      code === "runtime-unavailable"
        ? "Agent runtime is unavailable. Configure its executable path and try again."
        : code === "permission-required"
          ? "The agent runtime requires approval before it can continue."
          : code === "protocol-invalid"
            ? "The agent runtime returned an invalid response."
            : "The agent runtime could not complete the request.";

    return { code, message, diagnostic };
  }
}
