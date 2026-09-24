import { AgentContext, AgentFailure, EditProposal } from "../types";
import { TurnContextSnapshot } from "../context/context-types";
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

export interface ProposedEdit {
  id: string;
  proposal: EditProposal;
}

export type LearningEvent =
  | {
      type: "context-ready";
      context: TurnContextSnapshot;
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
      edit: ProposedEdit;
    }
  | {
      type: "learning-state-updated";
      state: LearningState;
    }
  | {
      type: "completed";
    }
  | {
      type: "failed";
      failure: AgentFailure | { code: "timeout" | "busy"; message: string };
    }
  | {
      type: "cancelled";
    };
