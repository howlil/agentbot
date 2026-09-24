import { AgentContext, EditProposal } from "../types";
import { LearningContext } from "../context/context-types";
import { LearningState } from "./learning-state";
import {
  PracticeEvaluation,
  PracticeQuestion,
} from "./practice-types";

export type LearningActionKind =
  | "ask"
  | "explain"
  | "practice"
  | "review"
  | "edit";

export interface LearningRequest {
  prompt: string;
  action: LearningActionKind;
  explicitContext: AgentContext[];
}

export type LearningEvent =
  | {
      type: "context-ready";
      context: LearningContext;
    }
  | {
      type: "response-delta";
      text: string;
    }
  | {
      type: "practice-question";
      question: PracticeQuestion;
    }
  | {
      type: "practice-evaluation";
      evaluation: PracticeEvaluation;
    }
  | {
      type: "mutation-proposed";
      proposal: EditProposal;
    }
  | {
      type: "learning-state-updated";
      state: LearningState;
    }
  | {
      type: "completed";
    }
  | {
      type: "error";
      message: string;
    };
