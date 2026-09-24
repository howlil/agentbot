# AGENTS.md

## Purpose

Build an Obsidian desktop plugin that provides a native AI chat sidebar backed by **AGY CLI**.

The product is not a terminal embedded in Obsidian. The product is:

> A native Obsidian AI companion that can understand the current note/selection, chat through AGY, propose Markdown edits, and apply approved changes safely.

The implementation must stay **agent-agnostic at the UI/application boundary** so AGY can later be replaced or complemented by Codex, Claude CLI, or another agent runtime without rewriting the product.

---

## Product Goal

The primary user flow is:

```text
open note
  ↓
select text (optional)
  ↓
open AI sidebar
  ↓
ask a question or request an edit
  ↓
agent reads explicit context
  ↓
response streams into sidebar
  ↓
if edit requested: show diff
  ↓
user chooses Apply / Reject
  ↓
Markdown changes through Obsidian APIs
  ↓
Ctrl/Cmd+Z can undo
```

Optimize everything around making this flow reliable, fast, and predictable.

---

## Product Principles

1. **Obsidian remains the workspace**
   - Main editor = notes.
   - Right sidebar = AI interaction.
   - Do not create a separate AI dashboard unless a real need appears.

2. **Context must be visible**
   - The user should know what the agent can see.
   - Prefer explicit context chips such as:
     - `@selection`
     - `@current-note`
     - `@Some Note.md`
     - later: `@folder`

3. **AI proposes; the plugin controls mutations**
   - AGY must not directly overwrite Markdown through uncontrolled shell/file operations for normal edit flows.
   - The application layer validates proposed edits before applying them.

4. **Safe by default**
   - Read/chat operations should not require dangerous permissions.
   - Do not default to unrestricted AGY execution.
   - User-approved edit operations go through Obsidian APIs.

5. **No speculative architecture**
   - Build only abstractions required by the current product.
   - Keep boundaries clear but small.
   - Prefer concrete modules over generic frameworks.

6. **Agent-runtime agnostic**
   - UI code must not depend directly on AGY-specific events or commands.
   - AGY-specific behavior belongs inside `AgyAdapter`.

---

# Target v0.1

v0.1 is complete when the user can:

```text
selection/current note
        ↓
chat with AGY
        ↓
receive streamed response
        ↓
receive edit proposal
        ↓
review diff
        ↓
Apply / Reject
        ↓
Undo applied edit
```

Also required:

- AGY executable detection.
- Model selection.
- Session persistence.
- Graceful error states.
- Correct process cleanup.

Do not expand scope until this works end-to-end.

---

# Non-Goals for v0.1

Do not implement these unless explicitly requested:

- RAG / embeddings.
- Automatic vault indexing.
- Multi-agent orchestration.
- MCP management UI.
- Agent marketplace.
- Prompt marketplace.
- Chat branching.
- AI dashboard.
- Background autonomous agents.
- Terminal emulator.
- Complex file history/versioning.
- Custom diff engine if a simple implementation works.
- Provider abstraction beyond what is necessary for `AgentAdapter`.

---

# Architecture

Use this dependency direction:

```text
Obsidian UI
    ↓
Application / Controllers
    ↓
Domain contracts
    ↓
Infrastructure adapters
    ├── AgyAdapter
    └── Obsidian APIs
```

Concrete shape:

```text
ChatView
   ↓
ChatController
   ├── ContextService
   ├── SessionStore
   ├── EditService
   └── AgentAdapter
          ↓
       AgyAdapter
          ↓
        AGY CLI
```

Rules:

- UI must not spawn processes directly.
- UI must not parse AGY stream JSON directly.
- `AgyAdapter` must not manipulate Obsidian editor state.
- `EditService` owns applying validated edits.
- `ContextService` owns resolving Obsidian context.
- `SessionStore` owns persisted chat/session metadata.

---

# Suggested File Structure

Keep the repository structure small.

```text
src/
├── main.ts
│
├── chat/
│   ├── ChatView.ts
│   ├── ChatController.ts
│   ├── ChatComposer.ts
│   └── MessageRenderer.ts
│
├── agent/
│   ├── AgentAdapter.ts
│   ├── AgentEvents.ts
│   └── agy/
│       ├── AgyAdapter.ts
│       └── AgyProtocol.ts
│
├── context/
│   ├── ContextService.ts
│   └── context-types.ts
│
├── editing/
│   ├── EditService.ts
│   ├── EditProposal.ts
│   └── DiffView.ts
│
├── sessions/
│   ├── SessionStore.ts
│   └── session-types.ts
│
└── settings/
    └── SettingsTab.ts
```

Do not create more layers unless the code has a concrete responsibility that cannot fit cleanly here.

---

# Core Contracts

## Agent Adapter

All agent runtimes must eventually fit this boundary.

```ts
export interface AgentAdapter {
  start(config: AgentConfig): Promise<void>;

  send(input: AgentInput): AsyncIterable<AgentEvent>;

  stop(): Promise<void>;

  listModels?(): Promise<AgentModel[]>;

  resume?(conversationId: string): Promise<void>;
}
```

Example input:

```ts
export type AgentInput = {
  prompt: string;
  context: AgentContext[];
};
```

Normalized events:

```ts
export type AgentEvent =
  | { type: "started" }
  | { type: "text-delta"; text: string }
  | { type: "tool"; name: string; detail?: string }
  | { type: "edit-proposal"; proposal: EditProposal }
  | { type: "completed"; conversationId?: string }
  | { type: "error"; message: string };
```

AGY-specific JSON must be converted into these events inside `AgyAdapter`.

---

# AGY Integration

Use AGY as a persistent child process when practical.

Expected mode:

```text
agy
  --input-format stream-json
  --output-format stream-json
```

Do not render raw AGY protocol data in the UI.

Normalize:

```text
AGY stream event
      ↓
AgyAdapter
      ↓
AgentEvent
      ↓
ChatController
      ↓
ChatView
```

Process lifecycle requirements:

- Spawn only when needed.
- Detect missing executable.
- Capture stderr.
- Handle malformed JSON without crashing Obsidian.
- Support cancellation.
- Stop child processes during plugin unload/reload.
- Never leave orphan/zombie AGY processes.

Do not use shell interpolation for user-controlled content.

Prefer argument arrays with `spawn()` over shell strings.

---

# Context Rules

Context must be deterministic.

Default behavior:

```text
if selection exists
    → use @selection

else
    → use @current-note
```

Explicit user context may add notes later.

Minimum domain type:

```ts
export type AgentContext =
  | {
      type: "selection";
      file: string;
      content: string;
    }
  | {
      type: "note";
      file: string;
      content: string;
    };
```

Rules:

- Include source filename.
- Context visible in UI.
- User can remove context.
- Resolve context at send time.
- Do not reuse stale selection from an earlier note.
- Do not automatically dump the entire vault into prompts.
- AGY may operate with the vault directory as working directory when appropriate.

---

# Editing Model

Normal edit flow:

```text
user instruction
      ↓
agent reasoning
      ↓
EditProposal
      ↓
validate current document
      ↓
show diff
      ↓
Apply / Reject
```

Minimum proposal:

```ts
export type EditProposal = {
  file: string;
  original: string;
  replacement: string;
  reason?: string;
};
```

The proposal is not permission to write.

Before Apply:

1. Confirm the target file still exists.
2. Read current content.
3. Confirm `original` still matches.
4. Detect stale proposals.
5. Only then apply.

If the document changed and the proposal is no longer safe:

```text
proposal stale
   ↓
do not apply
   ↓
ask user to regenerate
```

Do not silently rebase an ambiguous edit.

---

# Applying Markdown Changes

For an active/open note, prefer Obsidian editor APIs so:

- cursor behavior remains correct;
- editor state remains synchronized;
- Undo works naturally.

Desired invariant:

```text
one Apply
   =
one logical editor history operation
```

For non-active files, use Obsidian Vault APIs rather than arbitrary filesystem writes when possible.

Never overwrite an entire note when a precise edit is sufficient.

---

# Session Model

Minimum session:

```ts
export type ChatSession = {
  id: string;
  model?: string;
  conversationId?: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
};
```

Required behavior:

- New Chat creates a clean session.
- Sessions do not leak context between each other.
- Persist enough state to restore the latest conversation after Obsidian restarts.
- Store AGY `conversationId` when available.
- If resume fails, show a clear recoverable state rather than crashing.

Avoid building a complex chat-history product in v0.1.

---

# UI

The AI interface lives in an Obsidian right-sidebar `ItemView`.

Conceptual UI:

```text
┌─────────────────────────────┐
│ AGY             Model ▾   + │
├─────────────────────────────┤
│                             │
│ conversation                │
│                             │
│ proposed edit               │
│ - old                       │
│ + new                       │
│                             │
│ [Reject]          [Apply]   │
│                             │
├─────────────────────────────┤
│ @selection @current-note    │
│                             │
│ Ask AGY...               ↑  │
└─────────────────────────────┘
```

Keep it visually native to Obsidian.

Avoid:

- excessive cards;
- dashboard-like layouts;
- large hero elements;
- unnecessary navigation;
- visual noise;
- exposing protocol/debug data in the default UI.

---

# Product States

Design explicitly for these states:

```text
EMPTY
  ↓ send
RUNNING
  ├─ cancel
  ├─ error
  └─ success
       ↓
ANSWER
  ↓ edit proposal
PROPOSAL
  ├─ reject
  └─ apply
       ↓
APPLIED
```

Also support:

```text
AGY_NOT_FOUND
AGY_CRASHED
INVALID_STREAM
STALE_EDIT
RESUME_FAILED
```

Failures must be understandable and recoverable.

---

# Implementation Order

Follow this order unless existing code materially changes the dependency graph.

## Spike 1 — Chat Transport

Build:

```text
Obsidian ItemView
  ↓
selection
  ↓
AGY
  ↓
streamed response
```

Acceptance:

- sidebar opens;
- AGY detected;
- prompt sends;
- output streams;
- cancel works;
- unload kills process.

---

## Spike 2 — Context

Build:

- `ContextService`
- selection context
- current-note fallback
- visible context chips

Acceptance:

- correct note/selection is sent;
- context updates when active note changes;
- stale selection is never reused.

---

## Spike 3 — Edit Proposal

Build:

- structured `EditProposal`;
- proposal parser;
- validation;
- diff preview;
- Reject action.

Do not write files yet.

---

## Spike 4 — Apply + Undo

Build:

- final validation at Apply time;
- safe range replacement;
- editor transaction;
- Undo support.

Acceptance:

- correct Markdown changes;
- stale proposal rejected;
- Ctrl/Cmd+Z restores previous state.

At this point the core MVP exists.

---

## Spike 5 — Session + Model UX

Build:

- model selector;
- `agy models` discovery if supported;
- new chat;
- persistent session;
- conversation resume.

Avoid hard-coding provider model lists if AGY can provide them.

---

## Spike 6 — Hardening + Packaging

Build:

- process cleanup;
- error recovery;
- permissions UX;
- keyboard shortcuts;
- manifest/build packaging;
- installation test.

Then release v0.1.

---

# Definition of Done for v0.1

All must pass:

```text
Open note
  ↓
select paragraph
  ↓
open AI sidebar
  ↓
ask AGY
  ↓
stream answer
  ↓
request edit
  ↓
see diff
  ↓
Apply
  ↓
note updates correctly
  ↓
Ctrl/Cmd+Z restores original text
```

And:

- no orphan processes;
- plugin survives reload/restart;
- missing AGY shows actionable error;
- AGY crash does not crash Obsidian;
- stale edits cannot overwrite newer user changes;
- current context is visible;
- model/session state behaves predictably.

---

# Engineering Rules

## Keep boundaries explicit

Ask for each module:

```text
What data does it own?
What behavior does it own?
What external dependency does it wrap?
Why would this file change?
```

If two responsibilities change for different reasons, split them.

If two files always change together and represent one responsibility, consider colocating them.

---

## Dependency direction

Allowed:

```text
UI → application → contracts → adapters
```

Avoid:

```text
AgyAdapter → ChatView
EditService → UI components
ContextService → process spawning
```

No circular dependencies.

---

## KISS

Prefer:

- functions before classes when lifecycle/state does not require a class;
- explicit types;
- small modules;
- direct Obsidian APIs;
- direct Node process APIs;
- simple state machines.

Avoid:

- DI containers;
- event buses without demonstrated need;
- generic repositories;
- abstract factories;
- unnecessary wrapper layers;
- home-grown framework code.

---

## DRY

Deduplicate only when code represents the same concept and should evolve together.

Do not abstract code only because it looks similar.

---

## Changes

When modifying existing code:

1. Inspect the relevant implementation first.
2. Understand existing conventions.
3. Change the smallest coherent surface.
4. Remove superseded code.
5. Do not leave old and new implementations running in parallel without a compatibility reason.
6. Verify the actual user flow, not only unit-level behavior.

---

# Testing Strategy

Test the highest-risk boundaries.

Priority:

```text
1. AGY protocol parsing
2. process lifecycle
3. context resolution
4. stale edit detection
5. Apply / Undo
6. session restore
```

Use unit tests where logic is deterministic.

Use integration/E2E tests for:

```text
Obsidian editor
    ↕
plugin
    ↕
AGY process
```

Do not chase coverage percentage.

Test behavior that would hurt the user if broken.

---

# Verification Before Finishing a Task

Before claiming completion:

1. Run typecheck.
2. Run lint if configured.
3. Run relevant tests.
4. Build the plugin.
5. Exercise the changed user flow.
6. Check plugin unload/reload if process behavior changed.
7. Check Undo if editing behavior changed.
8. Verify no unexpected files/processes remain.

Report:

```text
what changed
what was verified
what remains intentionally out of scope
```

Do not report a feature as complete if only the UI mock exists and the underlying behavior is not wired.

---

# Decision Rule

When uncertain between two designs, choose the one that makes this graph simpler:

```text
user intent
   ↓
explicit context
   ↓
agent
   ↓
normalized result
   ↓
user-approved mutation
```

The product should feel like Obsidian gained an AI collaborator, not like a separate AI application was embedded inside it.
