import assert from "node:assert/strict";
import test from "node:test";
import { TFile } from "obsidian";
import { VaultLearningStore } from "../../src/persistence/VaultLearningStore";

class MemoryVault {
  files = new Map<string, string>();
  folders = new Set<string>();

  getFileByPath(path: string) {
    if (!this.files.has(path)) return null;
    return new TFile(path);
  }

  getAbstractFileByPath(path: string) {
    return this.folders.has(path) ? { path } : null;
  }

  async cachedRead(file: TFile) {
    return this.files.get(file.path) ?? "";
  }

  async createFolder(path: string) {
    this.folders.add(path);
  }

  async create(path: string, content: string) {
    this.files.set(path, content);
    return new TFile(path);
  }

  async modify(file: TFile, content: string) {
    this.files.set(file.path, content);
  }
}

function makeStore(vault = new MemoryVault()) {
  const app = { vault };
  return {
    vault,
    store: new VaultLearningStore(app as never),
  };
}

test("rejects malformed nested progress state", async () => {
  const { vault, store } = makeStore();
  vault.folders.add("00-learning-os");
  vault.files.set(
    "00-learning-os/progress.json",
    JSON.stringify({
      version: 1,
      target: null,
      gaps: [{}],
      evidence: [123],
    }),
  );

  await assert.rejects(
    () => store.load(),
    /unsupported shape/,
  );
});

test("review findings are material evidence, not learner gaps", async () => {
  const { store } = makeStore();

  const state = await store.recordReviewFindings({
    source: "note.md",
    findings: [
      {
        kind: "missing-relation",
        concept: "MVCC",
        title: "Missing visibility relationship",
        detail: "The note omits snapshot visibility rules.",
      },
    ],
  });

  assert.equal(state.gaps.length, 0);
  assert.equal(state.evidence.length, 1);
  assert.equal(state.evidence[0]?.type, "review");
  assert.equal(state.evidence[0]?.scope, "material");
});

test("practice misconception creates learner evidence and an open gap", async () => {
  const { store } = makeStore();

  const state = await store.recordPracticeEvaluation({
    source: "indexes.md",
    evaluation: {
      kind: "evaluation",
      concept: "Composite indexes",
      outcome: "partial",
      feedback: "Direction is right.",
      misconceptions: ["Missed left-most prefix"],
    },
  });

  assert.equal(state.evidence[0]?.scope, "learner");
  assert.equal(state.gaps.length, 1);
  assert.equal(state.gaps[0]?.status, "open");
  assert.equal(
    state.gaps[0]?.reason,
    "Missed left-most prefix",
  );
});

test("one correct answer moves an open learner gap to improving", async () => {
  const { store } = makeStore();

  await store.recordPracticeEvaluation({
    source: "indexes.md",
    evaluation: {
      kind: "evaluation",
      concept: "Composite indexes",
      outcome: "partial",
      feedback: "Missing one relationship.",
      misconceptions: ["Missed left-most prefix"],
    },
  });

  const state = await store.recordPracticeEvaluation({
    source: "indexes.md",
    evaluation: {
      kind: "evaluation",
      concept: "Composite indexes",
      outcome: "correct",
      feedback: "Correct.",
      misconceptions: [],
    },
  });

  assert.equal(state.gaps[0]?.status, "improving");
  assert.equal(state.gaps[0]?.evidenceIds.length, 2);
});
