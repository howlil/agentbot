import assert from "node:assert/strict";
import test from "node:test";
import { ContextResolver } from "../../src/context/ContextResolver";

test("resolves vault-note refs using latest content at turn start", async () => {
  let noteContent = "old";

  const source = {
    getSelection: () => null,
    getCurrentNote: async () => ({
      file: "current.md",
      content: "current",
    }),
    loadNote: async (path: string) => ({
      file: path,
      content: noteContent,
    }),
    searchNotes: () => [],
  };

  const resolver = new ContextResolver(source as never);
  const ref = {
    kind: "vault-note" as const,
    path: "support.md",
  };

  noteContent = "latest";
  const context = await resolver.resolve([ref]);

  assert.equal(context.explicit[0]?.content, "latest");
});

test("selection remains the primary automatic agent context", async () => {
  const source = {
    getSelection: () => ({
      file: "current.md",
      content: "selected",
    }),
    getCurrentNote: async () => ({
      file: "current.md",
      content: "whole note",
    }),
    loadNote: async () => null,
    searchNotes: () => [],
  };

  const resolver = new ContextResolver(source as never);
  const context = await resolver.resolve();
  const agentContext = resolver.toAgentContext(context);

  assert.deepEqual(agentContext, [
    {
      type: "selection",
      file: "current.md",
      content: "selected",
    },
  ]);
});
