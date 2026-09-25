import assert from "node:assert/strict";
import test from "node:test";
import { NOX_CAPABILITIES } from "../../src/chat/capabilities";

test("empty-state capabilities match the slash-command surface", () => {
  assert.deepEqual(
    NOX_CAPABILITIES.map((item) => ({
      action: item.action,
      title: item.title,
      command: item.command,
    })),
    [
      {
        action: "explain",
        title: "Explain",
        command: "/explain",
      },
      {
        action: "practice",
        title: "Practice",
        command: "/practice",
      },
      {
        action: "review",
        title: "Review",
        command: "/review",
      },
      {
        action: "edit",
        title: "Improve note",
        command: "/edit",
      },
    ],
  );
});

test("capability entry surface has no separate learn mode", () => {
  assert.equal(
    NOX_CAPABILITIES.some(
      (item) =>
        item.action === ("learn" as never) ||
        item.command === "/learn",
    ),
    false,
  );
});

test("capability icons remain the shared visual source of truth", () => {
  assert.deepEqual(
    NOX_CAPABILITIES.map((item) => [item.action, item.icon]),
    [
      ["explain", "circle-help"],
      ["practice", "list-checks"],
      ["review", "search"],
      ["edit", "pencil"],
    ],
  );
});
