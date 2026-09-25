import assert from "node:assert/strict";
import test from "node:test";
import { SessionStore } from "../../src/session/SessionStore";

test("creates deterministic sessions and orders newest first", () => {
  let now = 100;
  let id = 0;
  const store = new SessionStore({
    now: () => now,
    uuid: () => "session-" + ++id,
  });

  const first = store.createSession("model-a");
  now = 200;
  const second = store.createSession("model-b");

  assert.equal(first.id, "session-1");
  assert.equal(first.createdAt, 100);
  assert.equal(second.id, "session-2");
  assert.deepEqual(
    store.listSessions().map((session) => session.id),
    ["session-2", "session-1"],
  );
});

test("loads legacy storage and expires pending proposals", async () => {
  const store = new SessionStore();

  await store.load({
    "agy-sessions": {
      currentSessionId: "legacy",
      sessions: {
        legacy: {
          id: "legacy",
          messages: [
            {
              role: "assistant",
              content: "",
              proposalId: "proposal-1",
              proposal: {
                file: "note.md",
                original: "a",
                replacement: "b",
              },
              proposalState: "pending",
            },
          ],
          createdAt: 1,
          updatedAt: 2,
        },
      },
      defaultModel: "model-a",
    },
  });

  const session = store.getCurrentSession();
  assert.equal(session?.id, "legacy");
  assert.equal(
    session?.messages[0]?.proposalState,
    "stale",
  );
  assert.equal(store.getDefaultModel(), "model-a");
});

test("nox storage wins when both new and legacy keys exist", async () => {
  const store = new SessionStore();

  await store.load({
    "nox-sessions": {
      currentSessionId: "new",
      sessions: {
        new: {
          id: "new",
          messages: [],
          createdAt: 3,
          updatedAt: 4,
        },
      },
    },
    "agy-sessions": {
      currentSessionId: "legacy",
      sessions: {
        legacy: {
          id: "legacy",
          messages: [],
          createdAt: 1,
          updatedAt: 2,
        },
      },
    },
  });

  assert.equal(store.getCurrentSession()?.id, "new");
});

test("invalid sessions are skipped during decoding", async () => {
  const store = new SessionStore();

  await store.load({
    "nox-sessions": {
      currentSessionId: "bad",
      sessions: {
        bad: { id: "bad", messages: "nope" },
      },
    },
  });

  assert.equal(store.getCurrentSession(), null);
  assert.deepEqual(store.listSessions(), []);
});
