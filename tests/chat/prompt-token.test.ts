import assert from "node:assert/strict";
import test from "node:test";
import {
  parsePromptToken,
  stripPromptToken,
} from "../../src/chat/prompt-token";

test("parses source and command tokens at the active prompt tail", () => {
  assert.deepEqual(parsePromptToken("@data"), {
    kind: "source",
    query: "data",
    start: 0,
  });

  assert.deepEqual(parsePromptToken("explain /practice"), {
    kind: "command",
    query: "practice",
    start: 8,
  });

  assert.deepEqual(parsePromptToken("/"), {
    kind: "command",
    query: "",
    start: 0,
  });
});

test("does not treat email or mid-word markers as composer commands", () => {
  assert.equal(parsePromptToken("email@example.com"), null);
  assert.equal(parsePromptToken("mid-word/foo"), null);
});

test("current token contract supports ASCII word and dash queries only", () => {
  assert.equal(parsePromptToken("@catatan-1")?.query, "catatan-1");
  assert.equal(parsePromptToken("@catatan belajar"), null);
  assert.equal(parsePromptToken("@日本語"), null);
});

test("strips only the active prompt token", () => {
  assert.equal(stripPromptToken("Review @note"), "Review ");
  assert.equal(stripPromptToken("/review"), "");
  assert.equal(stripPromptToken("email@example.com"), "email@example.com");
});
