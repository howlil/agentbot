import assert from "node:assert/strict";
import test from "node:test";
import {
  hasInspectableContext,
  shouldResetAction,
} from "../../src/chat/chat-state";

test("context is inspectable when any context category exists", () => {
  assert.equal(
    hasInspectableContext({
      hasSelection: false,
      hasActiveNote: false,
      explicitCount: 0,
      systemCount: 1,
    }),
    true,
  );

  assert.equal(
    hasInspectableContext({
      hasSelection: false,
      hasActiveNote: false,
      explicitCount: 0,
      systemCount: 0,
    }),
    false,
  );
});

test("one-shot actions reset after every terminal outcome", () => {
  for (const outcome of ["completed", "stopped", "failed"] as const) {
    assert.equal(shouldResetAction("explain", outcome), true);
    assert.equal(shouldResetAction("review", outcome), true);
    assert.equal(shouldResetAction("edit", outcome), true);
  }
});

test("practice remains selected while another question is available", () => {
  assert.equal(shouldResetAction("practice", "completed", true), false);
  assert.equal(shouldResetAction("practice", "completed", false), true);
  assert.equal(shouldResetAction("practice", "failed"), false);
});
