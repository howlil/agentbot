import { App, TFile } from "obsidian";
import {
  DEFAULT_LEARNING_STATE,
  LearningEvidence,
  LearningState,
} from "../learning/learning-state";
import { PracticeEvaluation } from "../learning/practice-types";

const ROOT = "00-learning-os";
const PROGRESS_PATH = `${ROOT}/progress.json`;

function cloneDefaultState(): LearningState {
  return {
    ...DEFAULT_LEARNING_STATE,
    gaps: [],
    evidence: [],
  };
}

function isLearningState(value: unknown): value is LearningState {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;

  return (
    obj.version === 1 &&
    typeof obj.target === "string" &&
    Array.isArray(obj.gaps) &&
    Array.isArray(obj.evidence)
  );
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Durable Learning OS state stored inside the vault so progress travels with
 * the vault instead of being trapped in Obsidian plugin data.
 */
export class VaultLearningStore {
  constructor(private readonly app: App) {}

  async load(): Promise<LearningState> {
    const file = this.app.vault.getFileByPath(PROGRESS_PATH);
    if (!file || !(file instanceof TFile)) {
      return cloneDefaultState();
    }

    const raw = await this.app.vault.cachedRead(file);

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new Error(
        `Learning state is invalid JSON: ${PROGRESS_PATH}`,
      );
    }

    if (!isLearningState(parsed)) {
      throw new Error(
        `Learning state has an unsupported shape: ${PROGRESS_PATH}`,
      );
    }

    return parsed;
  }

  async save(state: LearningState): Promise<void> {
    await this.ensureRoot();

    const content = JSON.stringify(state, null, 2) + "\n";
    const file = this.app.vault.getFileByPath(PROGRESS_PATH);

    if (file && file instanceof TFile) {
      await this.app.vault.modify(file, content);
      return;
    }

    await this.app.vault.create(PROGRESS_PATH, content);
  }

  async recordPracticeEvaluation(input: {
    evaluation: PracticeEvaluation;
    source: string;
  }): Promise<LearningState> {
    const state = await this.load();

    const evidence: LearningEvidence = {
      id: crypto.randomUUID(),
      type: "practice",
      concept: input.evaluation.concept,
      source: input.source,
      outcome: input.evaluation.outcome,
      createdAt: Date.now(),
    };

    state.evidence.push(evidence);
    state.currentTopic = input.evaluation.concept;

    for (const misconception of input.evaluation.misconceptions) {
      const existing = state.gaps.find(
        (gap) =>
          normalize(gap.concept) === normalize(input.evaluation.concept) &&
          normalize(gap.reason) === normalize(misconception),
      );

      if (existing) {
        if (!existing.evidenceIds.includes(evidence.id)) {
          existing.evidenceIds.push(evidence.id);
        }
        existing.status = "open";
      } else {
        state.gaps.push({
          id: crypto.randomUUID(),
          concept: input.evaluation.concept,
          reason: misconception,
          evidenceIds: [evidence.id],
          status: "open",
        });
      }
    }

    if (
      input.evaluation.outcome === "correct" &&
      input.evaluation.misconceptions.length === 0
    ) {
      for (const gap of state.gaps) {
        if (
          normalize(gap.concept) ===
            normalize(input.evaluation.concept) &&
          gap.status === "open"
        ) {
          // One good answer is evidence of improvement, not proof of mastery.
          gap.status = "improving";
          gap.evidenceIds.push(evidence.id);
        }
      }
    }

    await this.save(state);
    return state;
  }

  private async ensureRoot(): Promise<void> {
    const existing = this.app.vault.getAbstractFileByPath(ROOT);
    if (existing) return;

    await this.app.vault.createFolder(ROOT);
  }
}
