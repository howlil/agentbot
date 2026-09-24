import assert from "node:assert/strict";
import test from "node:test";
import { StructuredStreamParser } from "../../src/learning/StructuredStreamParser";

test("parses a practice block split across chunks", () => {
  const parser = new StructuredStreamParser();

  const events = [
    ...parser.push("before\n\`\`\`learning-prac"),
    ...parser.push(
      'tice\n{"kind":"question","concept":"indexes","question":"Why?"}\n\`\`\`',
    ),
    ...parser.finish(),
  ];

  assert.equal(
    events
      .filter(
        (event): event is { type: "text"; text: string } =>
          event.type === "text",
      )
      .map((event) => event.text)
      .join(""),
    "before\n",
  );

  assert.deepEqual(
    events.find((event) => event.type === "practice-question"),
    {
      type: "practice-question",
      question: {
        kind: "question",
        concept: "indexes",
        question: "Why?",
      },
    },
  );
});

test("reports malformed structured payloads", () => {
  const parser = new StructuredStreamParser();
  const events = parser.push(
    "\`\`\`learning-practice\n{bad json}\n\`\`\`",
  );

  assert.equal(events[0]?.type, "error");
});
