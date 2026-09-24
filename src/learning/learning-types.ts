import { AgentContext, EditProposal } from "../types";
import { LearningContext } from "../context/context-types";

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
      type: "mutation-proposed";
      proposal: EditProposal;
    }
  | {
      type: "completed";
    }
  | {
      type: "error";
      message: string;
    };
