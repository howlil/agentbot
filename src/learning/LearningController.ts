import {
  AgentContext,
  ApplyResult,
  AgyModel,
  ChatSession,
  EditProposal,
} from "../types";
import { ContextResolver } from "../context/ContextResolver";
import { LearningContext } from "../context/context-types";
import { PolicyLoader } from "../context/PolicyLoader";
import { MutationService } from "../mutation/MutationService";
import { SessionController } from "../session/SessionController";
import { buildActionInstruction } from "./action-builders";
import { LearningEvent, LearningRequest } from "./learning-types";
import { ProposalStreamParser } from "./ProposalStreamParser";

/**
 * Application boundary for the Learning OS.
 *
 * The view sends user intent here. This controller owns orchestration:
 * context -> policy -> learning instruction -> agent session -> normalized UI
 * events. It deliberately hides AGY transport details from the UI.
 */
export class LearningController {
  constructor(
    private readonly sessions: SessionController,
    private readonly contexts: ContextResolver,
    private readonly policies: PolicyLoader,
    private readonly mutations: MutationService,
  ) {}

  async ping(): Promise<string> {
    return this.sessions.ping();
  }

  getSession(): ChatSession {
    return this.sessions.getSession();
  }

  getModels(): AgyModel[] {
    return this.sessions.getModels();
  }

  setModel(modelId: string): void {
    this.sessions.setModel(modelId);
  }

  async newSession(): Promise<ChatSession> {
    return this.sessions.newSession();
  }

  async resolveContext(
    explicitContext: AgentContext[] = [],
  ): Promise<LearningContext> {
    return this.contexts.resolve(explicitContext);
  }

  async *run(request: LearningRequest): AsyncIterable<LearningEvent> {
    const context = await this.contexts.resolve(request.explicitContext);
    yield {
      type: "context-ready",
      context,
    };

    const policy = await this.policies.load();
    const agentContext = this.contexts.toAgentContext(context);

    if (policy.rawInstructions) {
      const alreadyIncluded = agentContext.some(
        (item) => item.type === "note" && item.file === policy.path,
      );

      if (!alreadyIncluded) {
        agentContext.push({
          type: "note",
          file: policy.path,
          content: policy.rawInstructions,
        });
      }
    }

    const instruction = buildActionInstruction(request.action);
    const preparedPrompt =
      `${instruction}\n\nUser request:\n${request.prompt}`;

    const proposals = new ProposalStreamParser();

    for await (const event of this.sessions.sendTurn(
      preparedPrompt,
      agentContext,
      request.prompt,
    )) {
      if (event.type === "text") {
        for (const parsed of proposals.push(event.content)) {
          if (parsed.type === "text") {
            yield {
              type: "response-delta",
              text: parsed.text,
            };
          } else if (parsed.type === "proposal") {
            yield {
              type: "mutation-proposed",
              proposal: parsed.proposal,
            };
          } else {
            yield {
              type: "error",
              message: parsed.message,
            };
          }
        }
        continue;
      }

      if (event.type === "done") {
        for (const parsed of proposals.finish()) {
          if (parsed.type === "text") {
            yield {
              type: "response-delta",
              text: parsed.text,
            };
          } else if (parsed.type === "proposal") {
            yield {
              type: "mutation-proposed",
              proposal: parsed.proposal,
            };
          } else {
            yield {
              type: "error",
              message: parsed.message,
            };
          }
        }

        yield { type: "completed" };
        continue;
      }

      if (event.type === "error") {
        yield {
          type: "error",
          message: event.error,
        };
      }
    }
  }

  applyProposal(proposal: EditProposal): Promise<ApplyResult> {
    return this.mutations.apply(proposal);
  }

  cancel(): void {
    this.sessions.cancel();
  }

  dispose(): void {
    this.sessions.destroy();
  }
}
