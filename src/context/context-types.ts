export interface ContextDocument {
  type: "selection" | "note";
  path: string;
  content: string;
  source: "auto" | "explicit";
}

export interface LearningContext {
  activeNote?: {
    path: string;
    content: string;
  };

  selection?: {
    file: string;
    content: string;
  };

  explicit: ContextDocument[];
}

export interface LearningPolicy {
  path: string;
  rawInstructions: string;
}

export interface TurnContextSnapshot {
  resolved: LearningContext;
  visible: import("../types").AgentContext[];
  system: import("../types").AgentContext[];
  allowedMutationFiles: string[];
}
