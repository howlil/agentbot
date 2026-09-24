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

test("uses the active note when there is no selection", async () => {
  const source = {
    getSelection: () => null,
    getCurrentNote: async () => ({
      file: "current.md",
      content: "whole note",
    }),
    loadNote: async () => null,
    searchNotes: () => [],
  };

  const resolver = new ContextResolver(source as never);
  const context = await resolver.resolve();

  assert.deepEqual(resolver.toAgentContext(context), [
    {
      type: "note",
      file: "current.md",
      content: "whole note",
    },
  ]);
});

test("supports attachment context and preserves explicit order", async () => {
  const source = {
    getSelection: () => null,
    getCurrentNote: async () => null,
    loadNote: async (path: string) => ({
      file: path,
      content: "vault content",
    }),
    searchNotes: () => [],
  };

  const resolver = new ContextResolver(source as never);
  const refs = [
    {
      kind: "attachment" as const,
      name: "notes.txt",
      content: "attachment content",
    },
    {
      kind: "vault-note" as const,
      path: "support.md",
    },
  ];

  const context = await resolver.resolve(refs);

  assert.deepEqual(
    context.explicit.map((item) => item.path),
    ["attachment/notes.txt", "support.md"],
  );
  assert.deepEqual(refs, [
    {
      kind: "attachment",
      name: "notes.txt",
      content: "attachment content",
    },
    {
      kind: "vault-note",
      path: "support.md",
    },
  ]);
});

test("fails explicitly when a requested vault note disappears", async () => {
  const source = {
    getSelection: () => null,
    getCurrentNote: async () => null,
    loadNote: async () => null,
    searchNotes: () => [],
  };

  const resolver = new ContextResolver(source as never);

  await assert.rejects(
    () =>
      resolver.resolve([
        {
          kind: "vault-note",
          path: "missing.md",
        },
      ]),
    /no longer exists/,
  );
});

test("deduplicates explicit context identical to the primary context", async () => {
  const source = {
    getSelection: () => null,
    getCurrentNote: async () => ({
      file: "current.md",
      content: "same",
    }),
    loadNote: async () => ({
      file: "current.md",
      content: "same",
    }),
    searchNotes: () => [],
  };

  const resolver = new ContextResolver(source as never);
  const context = await resolver.resolve([
    {
      kind: "vault-note",
      path: "current.md",
    },
  ]);

  assert.deepEqual(resolver.toAgentContext(context), [
    {
      type: "note",
      file: "current.md",
      content: "same",
    },
  ]);
});
