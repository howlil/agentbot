import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeAgyUserMessage,
  parseAgyLine,
} from "../../src/agent/AgyProtocol";

test("encodes a user prompt for stream-json stdin", () => {
  const line = encodeAgyUserMessage("hello");
  assert.equal(
    line,
    '{"event":"user","message":{"content":"hello"}}\n',
  );
});

test("uses result.response when no text delta was emitted", () => {
  const parsed = parseAgyLine(
    JSON.stringify({
      event: "result",
      result: {
        status: "SUCCESS",
        response: "final answer",
        conversation_id: "conversation-1",
      },
    }),
    { sawText: false },
  );

  assert.deepEqual(parsed.events, [
    { type: "text", content: "final answer" },
    {
      type: "completed",
      conversationId: "conversation-1",
    },
  ]);
  assert.equal(parsed.terminal, true);
});

test("does not duplicate result.response after streamed text", () => {
  const streamed = parseAgyLine(
    JSON.stringify({
      event: "step_update",
      step_update: { text_delta: "streamed" },
    }),
    { sawText: false },
  );

  const completed = parseAgyLine(
    JSON.stringify({
      event: "result",
      result: {
        status: "SUCCESS",
        response: "streamed",
      },
    }),
    streamed.state,
  );

  assert.deepEqual(completed.events, [
    { type: "completed", conversationId: undefined },
  ]);
});

test("maps cancelled terminal states to cancellation", () => {
  const parsed = parseAgyLine(
    JSON.stringify({
      event: "result",
      result: { status: "CANCELED" },
    }),
    { sawText: false },
  );

  assert.deepEqual(parsed.events, [{ type: "cancelled" }]);
});
