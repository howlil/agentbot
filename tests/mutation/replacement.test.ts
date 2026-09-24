import assert from "node:assert/strict";
import test from "node:test";
import { planReplacement } from "../../src/mutation/replacement";

test("plans one exact replacement", () => {
  const result = planReplacement(
    "before target after",
    "target",
    "replacement",
  );

  assert.deepEqual(result, {
    ok: true,
    index: 7,
    next: "before replacement after",
  });
});

test("rejects stale replacements", () => {
  assert.deepEqual(
    planReplacement("current", "missing", "next"),
    { ok: false, reason: "stale" },
  );
});

test("rejects ambiguous replacements", () => {
  assert.deepEqual(
    planReplacement("x target y target", "target", "next"),
    { ok: false, reason: "ambiguous" },
  );
});
