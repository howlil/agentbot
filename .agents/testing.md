# Nox Testing Contract

## Purpose

Nox tests follow product risk, not coverage percentage.

```text
pure transformation
→ unit test

state transition
→ behavioral state test

multiple Nox modules
→ service integration

process / Obsidian / filesystem
→ boundary integration

actual plugin interaction
→ real Obsidian smoke
```

The smallest faithful proof wins. Do not mock a boundary so deeply that the
test only restates implementation details.

## Automated gates

```text
pnpm typecheck
→ pnpm test:unit
→ pnpm test:integration
→ pnpm build
→ pnpm test:artifacts
```

`pnpm verify` runs the complete automated gate.

## Module proof map

| Module | Required proof |
| --- | --- |
| `AgyProtocol` | event/status/error matrix |
| `AgyAdapter` | argv/stdin/stream/cancel process boundary |
| `ContextResolver` | precedence, refs, missing explicit context |
| `ObsidianContext` | focus retention and live editor buffer |
| `PolicyLoader` | mtime cache invalidation |
| `StructuredStreamParser` | every split boundary and invalid schema |
| `PracticeStateMachine` | every state transition and rollback |
| `LearningController` | orchestration, failure, proposal lifecycle |
| `VaultLearningStore` | schema, migration, evidence/gap transitions |
| `MutationService` | authorization, stale, ambiguous, editor-only apply |
| `SessionStore` | decoding, legacy load, deterministic CRUD |
| `SessionController` | display prompt and conversation persistence |
| `NoxSettings` | field-level decoding and merge-safe save |
| composer token logic | source/command parsing |
| deploy | disposable filesystem integration |
| build | Nox artifact identity |

## High-risk invariants

### Practice

```text
question
→ waiting-answer
→ evaluating
├─ failure/cancel/timeout → waiting-answer
└─ evaluation
   ├─ next question → waiting-answer
   └─ no next question → complete
```

A failed evaluation must never destroy the active question.

### Learning evidence

```text
practice evidence → learner scope → may affect learner gap
review finding    → material scope → must not imply learner weakness
```

One correct answer can move an open gap to improving. It is not proof of
mastery.

### Editing

```text
primary mutable note
→ exact unique replacement
→ open Markdown editor
→ replaceRange
```

Supporting context is read-only. Automated tests must prevent fallback to
`vault.modify`.

### Agent transport

```text
argv → runtime options only
stdin → prompt + context
```

A large/user-controlled prompt must never be placed in argv.

## Real Obsidian smoke

These checks remain release-level because a Node fake cannot prove Obsidian
editor/history behavior.

1. Select text in a Markdown note.
2. Focus Nox and Explain; the original selection must remain the turn context.
3. Start Practice, answer, stop/fail one evaluation, retry; the same question
   must be evaluated.
4. Create an edit proposal for the active note, Apply, then Ctrl/Cmd+Z; exact
   original content must return.
5. Add an explicit supporting note; Nox may read it but must refuse to mutate it.
6. Restart Obsidian; pending proposals must restore as expired/stale.
7. Exercise runtime unavailable, cancel, and malformed response paths; composer
   must return to a usable state.

Do not claim these behaviors are verified from typecheck/build alone.
