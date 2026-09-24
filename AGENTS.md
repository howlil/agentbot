# Nox Development Workflow

This repository builds Nox, an Obsidian plugin for a Learning OS. Keep
changes small, behavior-first, and releasable. Nox is agent-runtime agnostic;
the current provider integration is an implementation detail behind
`AgentAdapter`.

The durable product contract lives in `.agents/product.md`. The interface
states and interaction contract live in `.agents/interaction-spec.md`. This
file defines how to develop and verify the product.

## 1. Working principles

Optimize for:

```text
correct behavior
+ clear ownership
+ explicit boundaries
+ maintainable structure
+ fast feedback
+ small releasable changes
```

Prefer the smallest correct change. Do not optimize for abstraction count,
coverage percentage, ceremony, or speculative scale.

Preserve existing dirty work. Inspect the worktree before editing, do not
overwrite unrelated files, and never reset, clean, or force-push without an
explicit request.

## 2. Repository map

| Area | Responsibility |
| --- | --- |
| `src/main.ts` | Composition root, Obsidian registration, lifecycle |
| `src/chat/ChatView.ts` | Rendering and capturing user intent only |
| `src/learning/LearningController.ts` | Learning orchestration and normalized events |
| `src/context/` | Current note, selection, and policy context |
| `src/mutation/MutationService.ts` | Validated, user-approved Markdown mutations |
| `src/persistence/VaultLearningStore.ts` | Durable evidence-backed learning progress |
| `src/session/` | Conversation and model persistence |
| `src/agent/AgyAdapter.ts` | Current provider process/protocol adapter behind `AgentAdapter` |
| `public/nox.png` | Canonical Nox brand asset used by product surfaces |
| `styles.css` | Tailwind v4 CSS entry with theme-aware Nox styles |
| `DESIGN.md` | Nox interface graph, semantic tokens, and design acceptance gates |
| `dist/` | Generated build artifacts; never edit directly |
| `scripts/deploy.mjs` | Copies `dist/` into an Obsidian vault |

## 3. Ownership boundaries

The dependency direction is:

```text
ChatView
  ↓
LearningController
  ├─ ContextResolver
  ├─ PolicyLoader
  ├─ VaultLearningStore
  ├─ MutationService
  └─ SessionController
         ↓
      AgentAdapter
         ↓
      provider adapter
         ↓
      configured agent runtime
```

- `ChatView` renders state and captures intent. It must not parse provider protocol,
  resolve context, evaluate practice answers, mutate notes, or persist progress.
- `LearningController` owns learning actions, state transitions, and normalized
  learning events.
- `ContextResolver` is the single source of truth for visible context and
  context sent to the agent.
- `PolicyLoader` loads vault-root `AGENTS.md` as Learning OS policy.
- `VaultLearningStore` persists only meaningful, evidence-backed progress.
- `MutationService` is the normal path for approved Markdown changes and must
  reject stale or ambiguous replacements.
- `SessionController` owns conversation/model persistence only.
- The provider adapter owns child-process and provider protocol behavior. Upper
  layers must depend only on `AgentAdapter` and normalized agent events.

Do not introduce RAG, embeddings, background autonomy, multi-agent workflows,
or provider proliferation before the Learning OS loop is reliable.

## 4. Standard development loop

Use this loop for every non-trivial change:

```text
inspect → classify → define one slice → implement → verify → inspect diff
```

### Inspect

Start with:

```powershell
git status --short
git diff --stat
git diff
```

Read the relevant source, nearby types, product contract, and existing tests
before editing. Check the current plugin identity and build path when a change
touches packaging or deployment.

### Classify

- **Mechanical** — formatting, renames, generated output: make the smallest
  direct change and run the existing gate.
- **Local behavior** — validation, transformation, state rule, or bug: add a
  failing behavioral proof when practical, then implement the minimum fix.
- **Boundary/state** — persistence, process lifecycle, editor mutation, or
  external integration: model the contract and verify at the real boundary.
- **High risk** — authorization, destructive data, concurrency, migrations, or
  uncertain external effects: state the invariant and use deeper verification.

### Define one slice

Keep one change independently understandable and verifiable. Do not combine
feature work with unrelated cleanup, dependency upgrades, or architecture
refactors. If a refactor is required, make it behavior-preserving and separate
from the feature when possible.

### Implement

Keep the public surface small and preserve dependency direction. Remove a
superseded path instead of leaving old and new implementations active without
a compatibility reason.

For UI work, preserve native Obsidian behavior, visible context, compact
density, keyboard access, and clear loading/error/empty states. Do not add
dashboard-like surfaces or decorative complexity.

Read `DESIGN.md` before changing UI. Use its interface graph, semantic tokens,
radius/spacing scale, and acceptance test as the default design contract. Keep
the existing purple `--interactive-accent`; do not introduce hard-coded visual
tokens, decorative gradients, or unrelated component variants. Treat a
reference screenshot as a composition reference, not permission to enlarge
the UI beyond the design system.

### Compact visual contract

Every UI change must remain inside the visual rules in `DESIGN.md`:

- Use `6px / 8px / 10px / 14px / pill` for radii; do not invent larger
  everyday card or control radii.
- Use `4px / 6px / 8px / 10px / 12px / 16px / 24px` spacing steps.
- Keep normal UI at `12–14px`, major headings near `21px`, and controls at
  approximately `28px` high.
- Prefer semantic Nox tokens and hairline borders. Purple communicates
  active AI state, focus, selection, or an intentional primary action.
- Reject gradients, oversized hero composition, giant controls, broad shadows,
  decorative badges, and cards without a responsibility boundary.
- Use `public/nox.png` for Nox brand marks. Do not recreate the logo with
  text glyphs, unrelated Lucide icons, or a second inline artwork variant.
- Before finishing, compare the changed surface against the `DESIGN.md`
  acceptance test and run the UI verification gate.

If a requested visual reference conflicts with these rules, preserve the
compact Nox system and extract only the reference's hierarchy and interaction
behavior. If a new interaction or AI state is consequential, update the graph
and verify that state at the same boundary.

## 5. Verification gates

Run gates sequentially to avoid pnpm workspace-state races:

```powershell
pnpm typecheck
pnpm test:unit
pnpm test:integration
pnpm lint
pnpm build
git diff --check
```

For the normal fast gate, `pnpm verify` runs typecheck, unit tests,
integration tests, and the production build.

`pnpm build` writes `dist/main.js` and compiles the root `styles.css` entry with
the local Tailwind v4 CLI into `dist/styles.css`. The root `styles.css` is the
source asset; `dist/` is the artifact directory. Do not edit generated
artifacts directly.

`pnpm lint` is required when its ESLint configuration is available. If the
repository tooling prevents it from running, report the exact baseline error
instead of treating lint as green.

Use behavior-first tests rather than coverage-driven tests:

- Pure transformations use focused unit tests.
- State transitions test every changed edge, including rollback/failure edges.
- Boundary changes prove success, failure, and cancellation where applicable.
- Every bug fix gets a regression test that reproduces the old failure.
- Obsidian/process/filesystem behavior uses the narrowest faithful integration
  boundary instead of mocks that merely restate implementation details.

Do not use a global coverage percentage as a merge gate.

Use risk-proportional verification:

| Changed area | Minimum faithful proof |
| --- | --- |
| Pure learning rule or parser | Focused unit/regression test; streamed parsers test split boundaries |
| Context resolution | Selection/current-note behavior proof |
| Agent stream or process lifecycle | Adapter/process integration proof |
| Markdown mutation | Stale/ambiguous replacement and editor undo proof |
| Learning progress | Evidence, gap transition, and persistence proof |
| UI state or styling | Typecheck/build plus affected flow inspection |
| Packaging or deployment | Generated artifact and target-path inspection |

Source, typecheck, and build proof do not prove live Obsidian rendering or
deployment. State those gaps honestly.

## 6. Plugin identity and delivery

The current plugin identity is:

```text
package name: nox-obsidian
view type: nox-sidebar
artifact: dist/main.js
styles: dist/styles.css
deployment target: .obsidian/plugins/nox-obsidian
```

Use:

```powershell
pnpm build
pnpm deploy "C:\Path\To\Vault"
```

Deployment copies the contents of `dist/` and may update the target vault's
`community-plugins.json`. Do not deploy or modify a user's vault unless the
user explicitly asks for it. A plugin ID change creates a new Obsidian plugin
identity; do not silently delete the previous plugin directory or settings.

Nox is the only user-facing product name. Provider names may appear only in
the adapter implementation, provider-specific diagnostics, and integration
notes; never in UI labels, product copy, or normalized contracts.

## 7. High-risk invariants

### Learning state

```text
interaction → meaningful evidence? → evidence → gap/state transition → persist
```

A normal question is not proof of mastery. Practice evaluation may create
evidence, but one correct answer must not automatically mark an existing gap as
mastered.

### Practice

```text
generate question → wait for answer → evaluate → persist evidence
→ next question or complete
```

The plugin owns the practice transition. The model generates questions and
evaluations.

### Editing

```text
proposal → re-read current document → exact unique match → user approval
→ one editor transaction
```

Never silently rebase a stale or ambiguous proposal. Apply through Obsidian
APIs so native undo remains available.

### Process lifecycle

- Spawn the configured agent runtime only when needed.
- Pass user content through provider-supported structured stdin/input, never through shell interpolation or oversized argv payloads.
- Capture stderr and convert malformed or failed streams into recoverable UI
  errors.
- Cancel and dispose child processes on stop, view close, and plugin unload.
- Never expose raw provider protocol events in the UI.

## 8. Final review

Before declaring a slice complete:

1. Confirm the requested observable behavior works.
2. Re-read the actual diff, including untracked files relevant to the change.
3. Check ownership, dependency direction, stale paths, and failure propagation.
4. Run the smallest relevant gates, then the repository fast gate.
5. Confirm generated artifacts are current and unrelated dirty work is intact.
6. Report what changed, what passed, what was not runnable, and what remains out
   of scope.

Do not commit, push, create branches, or deploy unless explicitly requested.
