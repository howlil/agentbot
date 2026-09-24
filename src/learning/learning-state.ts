export interface KnowledgeGap {
  id: string;
  concept: string;
  reason: string;
  evidenceIds: string[];
  status: "open" | "improving" | "resolved";
}

export interface LearningEvidence {
  id: string;
  type: "practice" | "review" | "project";
  concept: string;
  source: string;
  outcome?: string;
  createdAt: number;
}

export interface LearningState {
  version: 1;
  target: string;
  currentTopic?: string;
  gaps: KnowledgeGap[];
  evidence: LearningEvidence[];
}

export const DEFAULT_LEARNING_STATE: LearningState = {
  version: 1,
  target: "Backend Software Engineer",
  gaps: [],
  evidence: [],
};
