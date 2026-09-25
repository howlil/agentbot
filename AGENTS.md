# Nox Engineering Workflow

Nox is an Obsidian Learning OS plugin. Develop it as a product, not as a collection
of files: start from observable behavior, give every rule one owner, change the
smallest complete slice, verify the boundary that can actually fail, then ship.

The product contract lives in `.agents/product.md`.
Interaction states live in `.agents/interaction-spec.md`.
Detailed verification guidance lives in `.agents/testing.md`.
UI work must follow `DESIGN.md`.

## 1. Default workflow

Use this loop for every non-trivial task:

```text
UNDERSTAND
→ MODEL ONLY WHAT MATTERS
→ IMPLEMENT ONE VERTICAL SLICE
→ VERIFY ACTUAL RISK
→ INSPECT DIFF
→ SHIP
```

Do not add ceremony between these steps unless the risk requires it.

### UNDERSTAND

Before editing, identify:

```text
observable outcome
→ caller
→ responsibility
→ state / dependency
→ side effect
→ consumer
```

Answer these questions:

- What behavior must change for the user?
- Who initiates it?
- Which rule decides the result?
- What state is read or changed?
- Which external side effect can happen?
- Who consumes the result?
- What is the highest-risk failure?
- What is the smallest proof that would catch it?

Read only the code and docs needed to answer those questions.

Do not begin with "which files should I refactor?". Begin with behavior.

### MODEL ONLY WHAT MATTERS

For a non-trivial path, reduce it to the smallest useful execution graph:

```text
input / caller
→ application responsibility
→ domain rule
→ state / dependency
→ side effect
→ output / consumer
```

Every business rule must have exactly one canonical owner.

If the same decision exists in UI, controller, persistence, and adapter code,
stop expanding it. Pick the correct owner and route callers through it.

Prefer:

```text
adapter / UI
→ application use case
→ domain rule
→ port
→ infrastructure adapter
```

Avoid:

```text
UI → persistence
UI → provider protocol
store → business policy
adapter → product state transition
multiple modules independently deciding the same rule
```

Existing boundary drift may still exist. Do not rewrite unrelated areas merely
to make the graph ideal. When a task crosses a bad boundary, improve only the
part required to make that slice safe.

## 2. Ownership

These are the target ownership boundaries. Do not introduce new violations.

| Concern | Canonical owner |
| --- | --- |
| Obsidian registration and composition | `src/main.ts` |
| UI rendering and user intent | chat/UI layer |
| Learning-turn orchestration | application/learning use case |
| Practice transition rules | practice domain/state machine |
| Learning evidence and gap transitions | learning-state domain rules |
| Visible and agent context | `ContextResolver` |
| Vault-root learning policy | `PolicyLoader` |
| Structured agent-output parsing | `StructuredStreamParser` |
| Provider process/protocol | `AgentAdapter` implementation |
| Conversation persistence | session/conversation persistence boundary |
| Learning-state persistence | learning-state repository/store |
| Markdown replacement validity | mutation logic |
| Obsidian editor write | Obsidian mutation boundary |

Important distinctions:

```text
business rule ≠ persistence rule
conversation persistence ≠ agent execution
provider protocol ≠ product event
UI state ≠ domain state
```

A type such as `Pick<ConcreteClass, ...>` may reduce the visible API, but it does
not by itself create a real architecture boundary. Prefer explicit ports when a
dependency genuinely needs inversion; do not create interfaces speculatively.

## 3. Implement one vertical slice

A change should be independently understandable, runnable, and verifiable.

Prefer:

```text
one observable behavior
→ minimum ownership correction needed
→ implementation
→ focused proof
→ ship
```

Do not default to horizontal rewrites such as:

```text
create all abstractions
→ move every file
→ migrate every caller
→ finally make behavior work
```

Use compatibility facades when they let a boundary improve incrementally without
forcing a rewrite.

Keep the public surface small. Reuse the existing canonical path before creating
another path. When a new implementation supersedes an old one, remove the old
path unless compatibility is explicitly required.

Do not mix a feature with unrelated cleanup, dependency upgrades, formatting
sweeps, or speculative architecture work.

### Refactor rule

Refactor when it reduces a concrete risk in the current change:

```text
current task
→ duplicated / misplaced rule creates unsafe change
→ correct that ownership
→ complete task
```

File size alone is not a refactor reason.

A large file is a problem when it causes ownership ambiguity, duplicated rules,
unsafe changes, or verification that is too broad.

Do not introduce RAG, embeddings, background autonomy, multi-agent workflows,
or provider proliferation before the core Learning OS loop requires them.

## 4. Tests and verification

Verification follows actual risk, not habit.

During implementation, run the narrowest faithful proof first.

| Change | First proof |
| --- | --- |
| Pure rule / state transition | focused unit test |
| Parser behavior | focused parser regression test, including split-stream boundaries |
| Context precedence | context behavior test |
| Session or learning persistence | repository/store integration proof |
| Agent process / cancellation | adapter/process integration proof |
| Markdown mutation | stale/ambiguous replacement + editor boundary proof |
| UI behavior | affected flow inspection + typecheck/build |
| Packaging | generated artifact / target-path inspection |

Use TDD by default for:

- business rules;
- state transitions;
- validation;
- parser behavior;
- bug regressions.

Do not force TDD for:

- documentation;
- CSS-only changes;
- simple wiring;
- mechanical renames;
- composition-root edits with no behavior change.

Every bug fix should reproduce the old failure before or alongside the fix when
practical.

Do not optimize for coverage percentage. Optimize for proving the changed rule
and the boundary most likely to fail.

### Fast feedback

Use focused tests while iterating.

Before shipping a meaningful code slice, use the repository gate appropriate to
its blast radius. The standard full code gate is:

```powershell
pnpm verify
pnpm lint
git diff --check
```

`pnpm verify` covers typecheck, unit tests, integration tests, production build,
and artifact checks according to the repository scripts.

If lint or another baseline tool cannot run because of repository configuration,
report the exact existing failure. Do not call it green.

Run deeper real-Obsidian/process/filesystem verification only when the changed
boundary requires it. Follow `.agents/testing.md`.

Never treat typecheck or build success as proof of live Obsidian behavior.

## 5. Nox invariants

These rules protect product correctness and override implementation convenience.

### Learning evidence

```text
interaction
→ meaningful evidence?
→ evidence
→ learning-state transition
→ persist
```

A normal question is not mastery evidence. One correct answer must not
automatically mean mastery unless the domain rule explicitly establishes it.

### Practice

```text
generate question
→ wait for answer
→ evaluate
→ record evidence
→ next question or complete
```

The plugin owns practice state transitions. The model supplies content and
evaluation data; it does not own lifecycle state.

### Context

`ContextResolver` is the canonical owner of visible context and context sent to
the agent.

Supporting context may be readable. The current mutable note remains the only
normal mutation target unless the product contract explicitly changes.

### Editing

```text
proposal
→ re-read current document
→ exact unique match
→ user approval
→ one editor transaction
```

Never silently rebase a stale or ambiguous proposal. Use Obsidian APIs so native
undo remains available.

### Agent runtime

- Spawn the configured runtime only when needed.
- Send user-controlled content through structured stdin/input, never shell interpolation.
- Convert provider output into normalized product events before UI consumption.
- Capture stderr and surface malformed/failed streams as recoverable product errors.
- Stop child processes on cancellation, view close, and plugin unload.
- Provider names and raw protocol details must not leak into normal product UI.

## 6. UI work

For UI changes, read `DESIGN.md` before editing.

`AGENTS.md` does not duplicate the design system. `DESIGN.md` is authoritative
for visual tokens, density, hierarchy, interaction composition, and acceptance
criteria.

UI code should render state and capture intent. Do not move context resolution,
practice evaluation, provider parsing, learning-state transitions, note
mutation rules, or persistence policy into the view.

A visual extraction into more files is not an architecture improvement unless
responsibility becomes clearer.

## 7. Repository and delivery discipline

Preserve unrelated work. Before editing an existing working tree, inspect its
state and never reset, clean, overwrite, or force-push unrelated changes.

Generated `dist/` output is not source. Do not edit it manually.

Nox remains runtime-agnostic at the product boundary. The current AGY integration
is one `AgentAdapter` implementation, not the product architecture.

Do not deploy into a user's Obsidian vault unless explicitly requested.

Use lightweight trunk-style development by default:

```text
small coherent slice
→ focused verification
→ full relevant gate
→ inspect diff
→ commit / ship
```

Create extra branches or PR ceremony only when the task, collaboration model, or
risk benefits from them.

## 8. Definition of done

A slice is done when:

```text
requested observable behavior works
+
changed business rule has one canonical owner
+
important failure path is handled
+
actual risky boundary is verified
+
no unnecessary parallel/dead path remains
+
diff contains no unrelated work
=
DONE
```

Before commit or handoff:

1. Re-read the actual diff.
2. Confirm dependency direction and ownership did not get worse.
3. Confirm state has one canonical owner.
4. Run the smallest faithful proofs and the broader gate required by blast radius.
5. Check generated artifacts only when the change affects them.
6. Report what changed, what passed, what could not be verified, and what remains out of scope.

Do not keep polishing after the definition of done is satisfied. Ship the
smallest high-quality slice and continue from real product feedback.
