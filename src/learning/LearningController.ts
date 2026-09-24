import {
  AgentContext,
  AgentFailure,
  AgentHealth,
  ApplyResult,
  AgentModel,
  ChatSession,
  EditProposal,
} from "../types";
import { ContextResolver } from "../context/ContextResolver";
import {
  LearningContext,
  TurnContextSnapshot,
} from "../context/context-types";
import { PolicyLoader } from "../context/PolicyLoader";
import { MutationService } from "../mutation/MutationService";
import { VaultLearningStore } from "../persistence/VaultLearningStore";
import { SessionController } from "../session/SessionController";
import {
  buildActionInstruction,
  buildPracticeEvaluationInstruction,
  buildPracticeQuestionInstruction,
} from "./action-builders";
import {
  LearningEvent,
  LearningRequest,
  ProposedEdit,
} from "./learning-types";
import {
  PracticeEvaluation,
  PracticeQuestion,
  PracticeSession,
} from "./practice-types";
import {
  StructuredStreamEvent,
  StructuredStreamParser,
} from "./StructuredStreamParser";

/**
 * Application boundary for the Learning OS.
 *
 * The view sends user intent here. This controller owns orchestration:
 * context -> policy -> learning state -> action -> agent session -> normalized
 * UI events. It deliberately hides provider transport details from the UI.
 */
export class LearningController {
  private practiceSession: PracticeSession | null = null;
  private activeTurn: {
    controller: AbortController;
    cancelReason?: "user" | "timeout" | "dispose";
  } | null = null;
  private readonly pendingProposals = new Map<
    string,
    { proposal: EditProposal; allowedFiles: readonly string[] }
  >();

  constructor(
    private readonly sessions: SessionController,
    private readonly contexts: ContextResolver,
    private readonly policies: PolicyLoader,
    private readonly mutations: MutationService,
    private readonly learningState: VaultLearningStore,
  ) {}

  checkRuntime(): Promise<AgentHealth> {
    return this.sessions.checkRuntime();
  }

  getSession(): ChatSession {
    return this.sessions.getSession();
  }

  getModels(): AgentModel[] {
    return this.sessions.getModels();
  }

  setModel(modelId?: string): void {
    this.sessions.setModel(modelId);
  }

  async newSession(): Promise<ChatSession> {
    this.practiceSession = null;
    return this.sessions.newSession();
  }

  async resolveContext(
    explicitContext: AgentContext[] = [],
  ): Promise<LearningContext> {
    return this.contexts.resolve(explicitContext);
  }

  searchNotes(
    query: string,
    limit = 8,
  ): Array<{ path: string; name: string }> {
    return this.contexts.searchNotes(query, limit);
  }

  loadNoteContext(path: string): Promise<AgentContext | null> {
    return this.contexts.loadExplicitNote(path);
  }

  async *run(request: LearningRequest): AsyncIterable<LearningEvent> {
    if (this.activeTurn) {
      yield {
        type: "failed",
        failure: { code: "busy", message: "Another Forge turn is still running." },
      };
      return;
    }

    const context = await this.contexts.resolve(request.explicitContext);
    const [policy, state] = await Promise.all([
      this.policies.load(),
      this.learningState.load(),
    ]);

    const visible = this.contexts.toAgentContext(context);
    const system: AgentContext[] = [];

    if (policy.rawInstructions) {
      const alreadyIncluded = visible.some(
        (item) => item.type === "note" && item.file === policy.path,
      );

      if (!alreadyIncluded) {
        system.push({
          type: "note",
          file: policy.path,
          content: policy.rawInstructions,
        });
      }
    }

    system.push({
      type: "note",
      file: "00-learning-os/progress.json",
      content: JSON.stringify(state, null, 2),
    });

    const snapshot: TurnContextSnapshot = {
      resolved: context,
      visible,
      system,
      allowedMutationFiles: Array.from(
        new Set(
          visible
            .filter((item) => !item.file.startsWith("attachment/"))
            .map((item) => item.file),
        ),
      ),
    };
    yield { type: "context-ready", context: snapshot };

    let preparedPrompt: string;

    if (request.action === "practice") {
      const activePractice = this.practiceSession;

      if (
        activePractice?.state === "waiting-answer" &&
        activePractice.currentQuestion
      ) {
        activePractice.state = "evaluating";
        preparedPrompt = buildPracticeEvaluationInstruction({
          question: activePractice.currentQuestion,
          answer: request.prompt,
          concept: activePractice.concept,
        });
      } else {
        this.practiceSession = {
          id: crypto.randomUUID(),
          state: "generating",
          turns: [],
        };

        preparedPrompt = buildPracticeQuestionInstruction(
          request.prompt,
        );
      }
    } else {
      this.practiceSession = null;
      const instruction = buildActionInstruction(request.action);
      preparedPrompt =
        `${instruction}\n\nUser request:\n${request.prompt}`;
    }

    const parser = new StructuredStreamParser();
    const controller = new AbortController();
    const activeTurn = { controller } as {
      controller: AbortController;
      cancelReason?: "user" | "timeout" | "dispose";
    };
    this.activeTurn = activeTurn;
    const timeout = setTimeout(() => {
      activeTurn.cancelReason = "timeout";
      controller.abort();
    }, 60_000);
    let visibleText = "";

    try {
      for await (const event of this.sessions.sendTurn(
        preparedPrompt,
        [...snapshot.visible, ...snapshot.system],
        request.prompt,
        controller.signal,
      )) {
        if (event.type === "text") {
          for await (const mapped of this.mapStructuredEvents(
            parser.push(event.content),
            request,
            snapshot,
          )) {
            if (mapped.type === "response-delta") visibleText += mapped.text;
            if (mapped.type === "mutation-proposed") {
              await this.sessions.recordAssistantMessage(visibleText);
              visibleText = "";
              await this.sessions.recordProposal(
                mapped.edit.id,
                mapped.edit.proposal,
              );
            }
            yield mapped;
          }
          continue;
        }

        if (event.type === "completed") {
          for await (const mapped of this.mapStructuredEvents(
            parser.finish(),
            request,
            snapshot,
          )) {
            if (mapped.type === "response-delta") visibleText += mapped.text;
            if (mapped.type === "mutation-proposed") {
              await this.sessions.recordAssistantMessage(visibleText);
              visibleText = "";
              await this.sessions.recordProposal(
                mapped.edit.id,
                mapped.edit.proposal,
              );
            }
            yield mapped;
          }
          await this.sessions.recordAssistantMessage(visibleText);
          yield { type: "completed" };
          return;
        }

        if (event.type === "failed") {
          yield { type: "failed", failure: event.failure };
          return;
        }

        if (activeTurn.cancelReason === "timeout") {
          yield {
            type: "failed",
            failure: {
              code: "timeout",
              message: "No response after 60 seconds. The agent runtime may be busy.",
            },
          };
        } else {
          yield { type: "cancelled" };
        }
        return;
      }
    } catch (error) {
      const failure: AgentFailure = {
        code: "protocol-invalid",
        message: "Forge could not interpret the agent response.",
        diagnostic: error instanceof Error ? error.message : String(error),
      };
      yield { type: "failed", failure };
    } finally {
      clearTimeout(timeout);
      if (this.activeTurn === activeTurn) this.activeTurn = null;
    }
  }

  async applyProposal(proposalId: string): Promise<ApplyResult> {
    const pending = this.pendingProposals.get(proposalId);
    if (!pending) {
      return {
        ok: false,
        reason: "stale",
        message: "This proposal is no longer active. Regenerate the edit.",
      };
    }

    const result = await this.mutations.apply(
      pending.proposal,
      pending.allowedFiles,
    );
    this.pendingProposals.delete(proposalId);
    await this.sessions.updateProposalState(
      proposalId,
      result.ok ? "applied" : "stale",
    );
    return result;
  }

  async rejectProposal(proposalId: string): Promise<void> {
    this.pendingProposals.delete(proposalId);
    await this.sessions.updateProposalState(proposalId, "rejected");
  }

  cancel(): void {
    if (!this.activeTurn) return;
    this.activeTurn.cancelReason = "user";
    this.activeTurn.controller.abort();
  }

  dispose(): void {
    if (!this.activeTurn) return;
    this.activeTurn.cancelReason = "dispose";
    this.activeTurn.controller.abort();
  }

  private async *mapStructuredEvents(
    events: StructuredStreamEvent[],
    request: LearningRequest,
    context: TurnContextSnapshot,
  ): AsyncIterable<LearningEvent> {
    for (const event of events) {
      if (event.type === "text") {
        if (event.text) {
          yield {
            type: "response-delta",
            text: event.text,
          };
        }
        continue;
      }

      if (event.type === "proposal") {
        if (!context.allowedMutationFiles.includes(event.proposal.file)) {
          throw new Error(
            `Edit target is outside the approved context: ${event.proposal.file}`,
          );
        }
        const edit: ProposedEdit = {
          id: crypto.randomUUID(),
          proposal: event.proposal,
        };
        this.pendingProposals.set(edit.id, {
          proposal: edit.proposal,
          allowedFiles: context.allowedMutationFiles,
        });
        yield {
          type: "mutation-proposed",
          edit,
        };
        continue;
      }

      if (event.type === "practice-question") {
        this.acceptPracticeQuestion(event.question);
        yield {
          type: "practice-question",
          question: event.question,
        };
        continue;
      }

      if (event.type === "review-findings") {
        const source =
          context.resolved.selection?.file ??
          context.resolved.activeNote?.path ??
          "learning-session";

        yield {
          type: "review-findings",
          findings: event.findings,
        };

        const state = await this.learningState.recordReviewFindings({
          findings: event.findings,
          source,
        });

        if (event.findings.length > 0) {
          yield {
            type: "learning-state-updated",
            state,
          };
        }
        continue;
      }

      if (event.type === "practice-evaluation") {
        const evaluation = event.evaluation;
        this.acceptPracticeEvaluation(
          evaluation,
          request.prompt,
        );

        yield {
          type: "practice-evaluation",
          evaluation,
        };

        const source =
          context.resolved.selection?.file ??
          context.resolved.activeNote?.path ??
          "learning-session";

        const state =
          await this.learningState.recordPracticeEvaluation({
            evaluation,
            source,
          });

        yield {
          type: "learning-state-updated",
          state,
        };

        if (evaluation.nextQuestion?.trim()) {
          const next: PracticeQuestion = {
            kind: "question",
            concept: evaluation.concept,
            question: evaluation.nextQuestion.trim(),
          };

          this.acceptPracticeQuestion(next);
          yield {
            type: "practice-question",
            question: next,
          };
        }

        continue;
      }

      throw new Error(event.message);
    }
  }

  private acceptPracticeQuestion(
    question: PracticeQuestion,
  ): void {
    if (!this.practiceSession) {
      this.practiceSession = {
        id: crypto.randomUUID(),
        state: "generating",
        turns: [],
      };
    }

    this.practiceSession.concept = question.concept;
    this.practiceSession.currentQuestion = question.question;
    this.practiceSession.state = "waiting-answer";

    const current =
      this.practiceSession.turns[
        this.practiceSession.turns.length - 1
      ];

    if (
      current &&
      !current.answer &&
      current.question === question.question
    ) {
      return;
    }

    this.practiceSession.turns.push({
      id: crypto.randomUUID(),
      concept: question.concept,
      question: question.question,
    });
  }

  private acceptPracticeEvaluation(
    evaluation: PracticeEvaluation,
    answer: string,
  ): void {
    if (!this.practiceSession) return;

    const current =
      this.practiceSession.turns[
        this.practiceSession.turns.length - 1
      ];

    if (current) {
      current.answer = answer;
      current.evaluation = evaluation;
    }

    this.practiceSession.concept = evaluation.concept;

    if (evaluation.nextQuestion?.trim()) {
      this.practiceSession.state = "waiting-answer";
      this.practiceSession.currentQuestion =
        evaluation.nextQuestion.trim();
    } else {
      this.practiceSession.state = "complete";
      this.practiceSession.currentQuestion = undefined;
    }
  }
}
