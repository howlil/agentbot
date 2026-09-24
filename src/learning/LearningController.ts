import {
  AgentContext,
  ApplyResult,
  AgentModel,
  ChatSession,
  EditProposal,
} from "../types";
import { ContextResolver } from "../context/ContextResolver";
import { LearningContext } from "../context/context-types";
import { PolicyLoader } from "../context/PolicyLoader";
import { MutationService } from "../mutation/MutationService";
import { VaultLearningStore } from "../persistence/VaultLearningStore";
import { SessionController } from "../session/SessionController";
import {
  buildActionInstruction,
  buildPracticeEvaluationInstruction,
  buildPracticeQuestionInstruction,
} from "./action-builders";
import { LearningEvent, LearningRequest } from "./learning-types";
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

  constructor(
    private readonly sessions: SessionController,
    private readonly contexts: ContextResolver,
    private readonly policies: PolicyLoader,
    private readonly mutations: MutationService,
    private readonly learningState: VaultLearningStore,
  ) {}

  async ping(): Promise<string> {
    return this.sessions.ping();
  }

  getSession(): ChatSession {
    return this.sessions.getSession();
  }

  getModels(): AgentModel[] {
    return this.sessions.getModels();
  }

  setModel(modelId: string): void {
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

  async *run(request: LearningRequest): AsyncIterable<LearningEvent> {
    const context = await this.contexts.resolve(request.explicitContext);
    yield {
      type: "context-ready",
      context,
    };

    const [policy, state] = await Promise.all([
      this.policies.load(),
      this.learningState.load(),
    ]);

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

    agentContext.push({
      type: "note",
      file: "00-learning-os/progress.json",
      content: JSON.stringify(state, null, 2),
    });

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

    for await (const event of this.sessions.sendTurn(
      preparedPrompt,
      agentContext,
      request.prompt,
    )) {
      if (event.type === "text") {
        for await (const mapped of this.mapStructuredEvents(
          parser.push(event.content),
          request,
          context,
        )) {
          yield mapped;
        }
        continue;
      }

      if (event.type === "done") {
        for await (const mapped of this.mapStructuredEvents(
          parser.finish(),
          request,
          context,
        )) {
          yield mapped;
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

  private async *mapStructuredEvents(
    events: StructuredStreamEvent[],
    request: LearningRequest,
    context: LearningContext,
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
        yield {
          type: "mutation-proposed",
          proposal: event.proposal,
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
          context.selection?.file ??
          context.activeNote?.path ??
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

      yield {
        type: "error",
        message: event.message,
      };
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
