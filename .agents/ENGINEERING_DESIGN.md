# Nox — Engineering Design

Status: **Canonical target architecture with incremental migration**
Depends on: `PRODUCT_DESIGN.md`, `../DESIGN.md`
Scope: Obsidian plugin runtime, learning orchestration, context, agent adapter,
persistence, mutation, testing, and delivery
Last updated: 2026-09-25

---

## 1. Engineering goal

Implement the Nox product without allowing framework, provider, persistence, or
UI details to own learning rules.

The engineering system must preserve these contracts:

1. one business rule has one canonical owner;
2. UI captures intent and renders product state;
3. application use cases orchestrate work but do not become domain rule stores;
4. learning and practice transitions are independently testable;
5. context resolution has one source of truth;
6. provider process/protocol details stay behind `AgentAdapter`;
7. persistence stores state but does not decide learning policy;
8. approved Markdown changes go through a safe Obsidian mutation boundary;
9. failure, cancellation, and timeout are explicit state transitions;
10. verification targets the real changed boundary.

Primary target graph:

```text
Obsidian UI
   ↓
application use case
   ↓
domain transition / policy
   ↓
port
   ↓
Obsidian / vault / runtime adapter
```

Provider path:

```text
application use case
→ AgentRuntime port
→ AgentAdapter
→ configured runtime
→ normalized agent events
```

---

## 2. Current architecture and migration direction

Current implementation is already separated into modules, but some
responsibilities are wider than their names imply.

Observed current path:

```text
ChatView
  ↓
LearningController
  ├── ContextResolver
  ├── PolicyLoader
  ├── VaultLearningStore
  ├── MutationService
  ├── PracticeStateMachine
  ├── StructuredStreamParser
  └── SessionController
          ↓
       AgentAdapter
```

Known boundary drift:

- `LearningController` currently combines turn orchestration, practice
  coordination, structured-event handling, proposal lifecycle, persistence
  triggers, cancellation, timeout, and UI event projection.
- `VaultLearningStore` currently contains both persistence and learning-state
  transition policy.
- `SessionController` currently handles conversation persistence and agent
  execution responsibilities.
- `ChatView` contains substantial presentation/workflow coordination in
  addition to rendering.

These are migration targets, not reasons for a rewrite.

Refactor only when a concrete slice crosses one of these boundaries.

---

## 3. Target repository shape

Nox can stay a single package.

Recommended direction:

```text
src/
├── application/
│   ├── RunLearningTurn.ts
│   ├── ApplyProposal.ts
│   ├── ChangeSession.ts
│   └── ports.ts
├── domain/
│   ├── learning-state/
│   │   ├── types.ts
│   │   └── transitions.ts
│   ├── practice/
│   │   ├── types.ts
│   │   └── PracticeStateMachine.ts
│   └── proposal/
│       └── types.ts
├── agent/
│   ├── AgentAdapter.ts
│   ├── StructuredStreamParser.ts
│   └── AgyAdapter.ts
├── context/
├── persistence/
│   ├── LearningStateRepository.ts
│   └── SessionRepository.ts
├── mutation/
├── chat/
├── ui/
├── settings/
└── main.ts
```

This is a dependency/ownership target, not a required bulk file move.

A compatibility `LearningController` facade may remain while use cases migrate
behind it.

---

## 4. Dependency direction

Allowed direction:

```text
UI / Obsidian adapter
        ↓
application use case
        ↓
domain rules
        ↓
ports
        ↓
infrastructure implementation
```

Domain code must not depend on:

- Obsidian view classes;
- DOM;
- child-process APIs;
- provider-specific event shapes;
- plugin data APIs;
- editor instances.

Persistence adapters may serialize domain state. They do not decide domain
transitions.

UI may project domain/application state. It does not recreate business rules.

---

## 5. Ownership map

| Concern | Canonical owner |
| --- | --- |
| Plugin composition | `main.ts` |
| User intent + rendering | UI/chat layer |
| Turn orchestration | `RunLearningTurn` application use case |
| Session switching | `ChangeSession` application use case |
| Proposal application | `ApplyProposal` application use case |
| Practice lifecycle | practice domain/state machine |
| Evidence/gap transition | learning-state domain |
| Turn context | `ContextResolver` |
| Vault policy | `PolicyLoader` |
| Structured model blocks | `StructuredStreamParser` |
| Runtime/process protocol | `AgentAdapter` implementation |
| Conversation storage | session repository |
| Learning-state storage | learning-state repository |
| Replacement validity | mutation logic |
| Obsidian editor write | Obsidian mutation adapter |

Rule:

```text
one decision
→ one owner
→ all callers route through it
```

---

## 6. Learning-turn application boundary

Target use case:

```text
LearningRequest
→ prepare turn
→ resolve context + policy + learning state
→ build agent request
→ execute runtime
→ normalize structured events
→ apply domain transitions
→ persist effects
→ emit LearningEvent
```

The application layer coordinates order and transaction-like behavior.

It should not contain the detailed rule for whether a learning gap moves from
`open` to `improving`; that belongs to the learning-state domain.

Recommended conceptual interface:

```ts
runLearningTurn(request)
  -> AsyncIterable<LearningEvent>
```

Internal stages may be extracted only when they establish useful ownership or
test boundaries.

---

## 7. Context boundary

`ContextResolver` is the single source of truth for product context.

Resolution:

```text
selection
→ current note fallback
+ explicit note/file context
+ system policy/progress
→ agent context
```

Important distinction:

```text
readable source
≠
mutable source
```

Supporting context is readable.

The authorized current Markdown note is the normal mutation target.

Context resolution tests should prove precedence and the actual source content
sent to the agent.

---

## 8. Agent runtime boundary

Upper layers depend on normalized runtime contracts.

```text
application
→ AgentRuntime / AgentAdapter
→ provider adapter
→ process
```

The provider adapter owns:

- executable discovery;
- argv construction;
- stdin/input transport;
- child-process lifecycle;
- provider stream parsing;
- stderr capture;
- provider-specific model listing;
- low-level cancellation.

It must emit normalized agent events.

User prompt/context must not be shell-interpolated.

Large user-controlled input belongs in stdin or the runtime's structured input
channel, not argv.

Do not refactor `AgyAdapter` merely because it is large; refactor it when
process/protocol ownership actually becomes ambiguous or unsafe.

---

## 9. Structured response parsing

`StructuredStreamParser` owns incremental parsing of structured model blocks.

Current structured product events include concepts such as:

- edit proposal;
- practice question/evaluation;
- review findings.

Parser responsibilities:

```text
raw normalized text stream
→ recognize complete structured block
→ validate shape
→ emit structured parser event
```

It does not persist learning state or decide UI rendering.

Test every meaningful split boundary and malformed/invalid schema path.

---

## 10. Practice domain

Practice is a state machine, not a UI mode flag.

Canonical lifecycle:

```text
idle
→ waiting-answer
→ evaluating
├─ failure/cancel/timeout → waiting-answer
├─ next question → waiting-answer
└─ no next question → complete
```

The state machine owns transition validity.

The application layer owns when to call the model and when to persist resulting
evidence.

The UI owns presentation.

Session ownership must be explicit. Because conversations are durable,
practice state should not accidentally become a process-global singleton.
Migration should move toward session-scoped/restorable practice semantics where
the product contract requires continuity.

---

## 11. Learning-state domain

Learning-state rules must be pure where practical.

Target:

```text
current LearningState
+ LearningEvidence
→ transitionLearningState(...)
→ next LearningState
```

Examples of policy that belong here:

- evidence creation semantics;
- matching evidence to an existing gap;
- allowed gap-state transitions;
- current-topic update semantics.

The repository/store then performs:

```text
load
→ domain transition called by application layer
→ save
```

It must not independently decide the learning policy.

This is the highest-value first boundary correction in the current codebase.

---

## 12. Review evidence semantics

Keep learner evidence separate from material findings.

```text
practice evaluation
→ learner evidence
→ may affect learner gap

review finding
→ material evidence
→ must not automatically imply learner weakness
```

If future product behavior intentionally connects a review finding to learner
state, that transition must be explicit and product-approved.

---

## 13. Proposal and mutation lifecycle

Canonical lifecycle:

```text
structured proposal
→ persist/display pending state
→ user Apply / Reject
→ re-read current note
→ exact unique validation
→ editor transaction
→ applied / stale / rejected
```

Avoid split canonical ownership between an in-memory proposal map and persisted
conversation state.

Migration target:

```text
one proposal record/state
→ one lifecycle owner
→ UI projects it
```

`MutationService` or its successor owns replacement safety and Obsidian write
mechanics, not proposal business history.

Never fall back to blind `vault.modify` when editor semantics and native Undo
are required.

---

## 14. Conversation and runtime separation

Conversation persistence and agent execution are distinct responsibilities.

Target:

```text
ConversationRepository
├── load/list/select/save history
└── proposal/session metadata

AgentRuntime
├── runtime health
├── model discovery
├── execute turn
└── cancel
```

Application use cases compose them.

Do not make the conversation repository aware of provider protocol.

Do not make the runtime own product session history.

---

## 15. State ownership

Nox has several legitimate state machines. They must not collapse into one
global state object.

```text
UI presentation state
→ UI

active turn/cancellation
→ application turn use case

practice lifecycle
→ practice domain/session

conversation history
→ session persistence

learning progress
→ learning-state domain + repository

proposal lifecycle
→ application/session proposal model
```

Each state should answer:

- who may transition it?
- whether it is durable;
- what restores it;
- what invalidates it;
- what consumer observes it.

---

## 16. Normalized product events

The UI consumes Nox events, not provider events.

Conceptual boundary:

```text
provider stream
→ adapter normalization
→ structured parser
→ application/domain effects
→ LearningEvent
→ UI
```

Examples:

- response delta;
- context ready;
- practice question;
- practice evaluation;
- review findings;
- mutation proposed;
- learning state updated;
- completed;
- recoverable failure.

Do not expose provider JSON or protocol names as rendering contracts.

---

## 17. Error and cancellation model

Failures must preserve a usable product state.

Categories may include:

- runtime unavailable;
- protocol malformed;
- timeout;
- cancelled;
- context missing;
- stale proposal;
- ambiguous replacement;
- persistence failure.

Cancellation path:

```text
user stop / view close / unload
→ abort active use case
→ cancel runtime
→ rollback transient transition where required
→ emit recoverable terminal state
```

A failed practice evaluation returns to the same answerable question.

A malformed structured response must not partially mutate durable state.

---

## 18. Persistence boundaries

Current durable state includes:

- conversation/session data in plugin data;
- learning state in the vault;
- note content through Obsidian Markdown/editor APIs.

Principles:

```text
domain decides meaning
repository decides serialization/storage
application decides when effects occur
```

Persistence formats must be decoded defensively.

Legacy state should either migrate explicitly or degrade safely.

Pending mutations restored after restart should default to stale/expired unless
fresh validity can be proven.

---

## 19. Security and process boundaries

- Never shell-interpolate user content.
- Keep provider executable configuration explicit.
- Treat runtime output as untrusted until normalized/validated.
- Do not mutate files outside the user-authorized note path.
- Do not log sensitive note/context content unnecessarily.
- Dispose spawned processes on plugin unload.
- Do not add background autonomous mutation.

---

## 20. Testing strategy

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

The smallest faithful proof wins.

Do not mock a boundary so deeply that the test merely restates implementation.

### 20.1 Automated gate

```text
pnpm typecheck
→ pnpm test:unit
→ pnpm test:integration
→ pnpm build
→ pnpm test:artifacts
```

`pnpm verify` runs the repository's complete automated verification gate.

### 20.2 Module proof map

| Module / boundary | Required proof |
| --- | --- |
| Agent protocol normalization | event/status/error matrix |
| `AgyAdapter` | argv/stdin/stream/cancel process boundary |
| `ContextResolver` | precedence, refs, missing explicit context |
| Obsidian selection context | focus retention + live editor buffer |
| `PolicyLoader` | cache invalidation |
| `StructuredStreamParser` | split boundaries + invalid schema |
| practice domain | every changed transition + rollback |
| learning-turn use case | orchestration + terminal failure paths |
| learning-state domain | evidence/gap transition rules |
| learning-state repository | schema/decode/persistence |
| mutation boundary | authorization, stale, ambiguous, editor-only apply |
| session repository | decoding, legacy load, deterministic CRUD |
| composer token logic | source/command parsing |
| deployment | disposable filesystem integration |
| build | plugin identity + artifact contents |

### 20.3 High-risk proofs

Practice:

```text
question
→ evaluating
├─ failure/cancel/timeout → same question
└─ evaluation → next / complete
```

Learning evidence:

```text
learner evidence
≠
material review finding
```

Editing:

```text
primary mutable note
→ exact unique replacement
→ open Markdown editor
→ replaceRange
→ native Undo
```

Agent transport:

```text
argv → runtime options only
stdin → prompt + context
```

### 20.4 Real Obsidian smoke

Keep these as release-level checks because Node tests cannot prove native
editor/history behavior:

1. select text in a Markdown note;
2. focus Nox and Explain; original selection remains turn context;
3. start Practice, fail/cancel one evaluation, retry; the same question remains;
4. create an edit proposal, Apply, then Undo; original content returns;
5. add a supporting note; Nox may read it but refuses to mutate it;
6. restart Obsidian; pending proposals restore safely as stale/expired;
7. exercise unavailable runtime, cancel, and malformed response; composer returns usable.

Do not claim these behaviors are verified from typecheck/build alone.

---

## 21. Build and delivery

Source inputs:

- TypeScript source;
- root `styles.css`;
- plugin manifest/assets.

Generated output:

```text
dist/main.js
dist/styles.css
...
```

Do not edit `dist/` manually.

Deployment targets:

```text
.obsidian/plugins/nox-obsidian
```

Do not deploy without explicit user intent.

Plugin identity changes are migrations, not cosmetic renames.

---

## 22. Incremental migration sequence

Do not rewrite the architecture in one pass.

Preferred order:

### Slice 1 — learning-state ownership

```text
VaultLearningStore policy
→ pure learning-state transition
→ store becomes persistence-focused
```

Preserve current public behavior while moving the rule.

### Slice 2 — conversation vs runtime

```text
SessionController
→ conversation/session responsibility
+ runtime responsibility
```

Separate only at the boundary needed by current callers.

### Slice 3 — learning use cases

Keep a compatibility facade:

```text
ChatView
→ LearningController facade
   ├── RunLearningTurn
   ├── ApplyProposal
   └── ChangeSession
```

Move orchestration by behavior slice.

### Slice 4 — proposal ownership

Remove duplicate canonical state between transient maps and persisted proposal
history.

### Slice 5 — practice session ownership

Make lifecycle ownership explicit and restorable according to product behavior.

### Slice 6 — UI responsibility

Only after application/domain boundaries exist, reduce `ChatView` workflow
coordination. Do not merely split the file into smaller files.

---

## 23. What not to refactor first

The following boundaries are currently coherent enough and should not be
rewritten without a concrete task:

- `ContextResolver`;
- `StructuredStreamParser`;
- `AgyAdapter` process/protocol boundary;
- replacement planning / mutation validation;
- `PracticeStateMachine` transition logic;
- `main.ts` composition root;
- recently extracted generic UI primitives.

Large size alone does not change this rule.

---

## 24. Primary engineering risks

### Risk 1 — business rules in persistence

Effect:

```text
storage change
→ learning behavior changes
→ broad regression surface
```

Mitigation: pure learning-state transitions.

### Risk 2 — orchestration becomes a god object

Effect:

```text
one feature change
→ context + session + practice + parser + persistence all touched
```

Mitigation: application use cases by observable behavior.

### Risk 3 — duplicated transient and durable state

Effect:

```text
restart / session switch
→ two sources disagree
```

Mitigation: one canonical lifecycle owner.

### Risk 4 — provider leakage

Effect:

```text
runtime protocol
→ controller/UI contracts
→ runtime replacement becomes product rewrite
```

Mitigation: normalize at adapter boundary.

### Risk 5 — fake confidence from tests

Effect:

```text
green unit suite
→ native Obsidian behavior still broken
```

Mitigation: prove the actual boundary and retain release-level smoke tests.

---

## 25. Engineering acceptance criteria

### Boundaries

- each changed business rule has one owner;
- domain transitions do not depend on Obsidian/provider APIs;
- persistence does not independently decide learning policy;
- provider-specific protocol remains below `AgentAdapter`;
- UI does not recreate learning rules.

### Learning

- learner evidence and material review findings remain semantically distinct;
- practice rollback preserves the active question;
- learning-state transitions are independently testable.

### Editing

- supporting context remains read-only;
- stale/ambiguous replacements fail explicitly;
- approved edits use the Obsidian editor path and preserve Undo.

### Runtime

- prompt/context travel through structured input rather than shell interpolation;
- cancellation terminates process work and restores usable product state;
- malformed structured output cannot partially mutate durable state.

### Testing

- the changed rule has a focused behavioral proof;
- the changed external boundary has a faithful integration proof when needed;
- broader gates match blast radius;
- real Obsidian claims are not inferred from Node/build tests.

### Delivery

- no parallel/dead implementation path remains without a compatibility reason;
- generated artifacts are current when affected;
- canonical product/engineering docs change with their contracts;
- final diff contains no unrelated work.

---

## 26. Final engineering model

The system should be explainable with this graph:

```text
user intent
→ UI
→ application use case
→ domain decision
→ infrastructure effect
→ normalized result
→ UI

                 domain decision
                       ↓
                durable state
```

The goal is not more layers.

The goal is:

```text
one rule → one owner
small slice → small blast radius
real risk → faithful proof
clear done → ship
```
