# Interaction Spec — Forge Obsidian Plugin v0

> Scope: vertical slice only — `EMPTY → RUNNING → PROPOSAL → APPLIED`.  
> The prompt bar also exposes model selection, explicit text-file context, and
> keyboard-friendly `@` / `/` menus.

---

## 1. Surface

Single `ItemView` mounted in Obsidian right sidebar.  
View type ID: `forge-sidebar`.
Tab icon: robot / sparkle icon from Obsidian's `addRibbonIcon`.

Layout (fixed, non-scrollable shell):

```
┌─────────────────────────────────┐  ← sidebar shell
│ header + mode tabs (fixed)      │
├─────────────────────────────────┤
│ thread (flex-grow, scrollable)  │
├─────────────────────────────────┤
│ composer (fixed bottom)         │
└─────────────────────────────────┘
```

---

## 2. Component tree

```
 ForgeView (ItemView)
 ├── Header
 │    ├── Forge identity + new session
 │    └── ModeTabs [Ask] [Explain] [Practice] [Review] [Edit]
 ├── Thread
 │    ├── EmptySlate        [visible in EMPTY]
 │    ├── MessageBubble[]   [visible in RUNNING / PROPOSAL / APPLIED]
 │    │    ├── UserBubble
 │    │    ├── AgentBubble (word-resolving stream → rendered Markdown + actions)
 │    │    └── ProposalBubble
 │    │         ├── DiffBlock
 │    │         └── ActionRow  [Reject] [Apply]
 │    └── ThinkingTrace      [expandable steps + elapsed timer in RUNNING]
 └── Composer
      ├── ContextChips
      │    ├── SelectionChip   [auto, when selection exists]
      │    └── NoteChip        [auto, always]
      └── ComposerCard
           ├── AttachmentChips
           ├── AddContextMenu      [`@` sources / text files]
           ├── Textarea             [`/` learning actions]
           ├── ModelSelector
           ├── DictationButton      [when supported by the host]
           └── SendButton / StopButton
```

---

## 3. States

### EMPTY

**Visible:**
- EmptySlate: centered text "Ask Forge about this note"
- Composer active, context chips shown
- SelectionChip shown only when editor has a selection

**Inactive / hidden:**
- Thread messages (none)
- StatusLine

**Interaction:**
- User types in Textarea → Send enabled
- Enter or click Send → transition to RUNNING

---

### RUNNING

**Visible:**
- UserBubble with the sent message
- ThinkingTrace: expandable context/policy/response steps, shimmer "Thinking"
  label, and a live elapsed timer
- AgentBubble resolves streamed words from blur with a live cursor

**Inactive / disabled:**
- SendButton disabled
- Textarea disabled (grayed, not focusable)
- ContextChips locked (no add/remove during run)

**Transitions out:**
- Agent runtime emits text tokens → stream into AgentBubble
- Agent runtime emits an edit proposal → append ProposalBubble, transition to PROPOSAL
- Agent runtime emits an error → show inline error in AgentBubble, re-enable Composer

---

### PROPOSAL

**Visible:**
- Full conversation thread (UserBubble + AgentBubble optional prose)
- ProposalBubble:
  ```
  ┌──────────────────────────────┐
  │ Event-driven.md              │  ← file badge
  ├──────────────────────────────┤
  │ - The producer sends data... │  ← red, removed
  │ + The producer emits an...   │  ← green, added
  │ + event without waiting.     │
  ├──────────────────────────────┤
  │ [Reject]          [Apply ✓]  │
  └──────────────────────────────┘
  ```
- Composer re-enabled (user can ask follow-up while reviewing)

**Interaction — Apply:**
1. Button click → call `editor.transaction(replaceRange)`
2. Transition to APPLIED
3. ProposalBubble ActionRow collapses; replaced by applied badge

**Interaction — Reject:**
1. ProposalBubble ActionRow collapses; replaced by rejected badge
2. Stay in PROPOSAL state visually; Composer active
3. No file change

---

### APPLIED

**Visible:**
- ProposalBubble collapses ActionRow → shows "✓ Applied" badge
- Note already reflects the change in editor
- Composer active (user can send next message)

**Invariant:**
- The edit was applied as a **single CM6 transaction**
- Obsidian native Undo (`Ctrl+Z`) reverses it in one step
- Plugin does not manage its own undo stack

---

## 4. Context chips — resolution rules

```
editor.getSelection() returns non-empty string
  → SelectionChip = "@selection"   (auto-added)
  → payload.context.selection = <selected text>

Always
  → NoteChip = "@<active file basename>"
  → payload.context.notePath = <active file path>
  → payload.context.noteContent = <full note content>
```

Chips are display-only in v0. User cannot remove them. No @file mention yet.

---

## 5. Message payload contract (UI → Controller)

```ts
interface SendPayload {
  prompt: string;
  context: {
    notePath: string;          // always
    noteContent: string;       // always, full markdown
    selection: string | null;  // null if no selection
  };
}
```

---

## 6. Agent event contract (Controller ← AgentAdapter)

```ts
type AgentEvent =
  | { type: 'status';   message: string }          // "Reading selection…"
  | { type: 'text';     delta: string }             // streaming token
  | { type: 'proposal'; file: string; before: string; after: string }
  | { type: 'done' }
  | { type: 'error';    message: string };
```

UI renders events in order. Multiple `text` events → append to AgentBubble.
One `proposal` event → render ProposalBubble (only one per turn in v0).

---

## 7. Apply contract (UI → Editor)

```ts
// Called when user clicks Apply
function applyProposal(proposal: EditProposal, editor: Editor): void {
  const content = editor.getValue();
  const idx = content.indexOf(proposal.before);
  if (idx === -1) throw new Error("before text not found");

  const from = editor.offsetToPos(idx);
  const to   = editor.offsetToPos(idx + proposal.before.length);

  // Single CM6 transaction — makes Ctrl+Z work natively
  editor.replaceRange(proposal.after, from, to);
}
```

**Pre-condition:** `proposal.before` must exist verbatim in current note.  
**Post-condition:** editor content updated, undo stack has exactly one new entry.  
**On failure:** show inline error "Could not apply — text may have changed", leave file untouched.

---

## 8. Error states within the slice

| Trigger | Where shown | Recovery |
|---|---|---|
| Agent runtime unavailable | Replaces Thread with ERROR slate | [Configure runtime] button |
| `proposal.before` not found in file | Inline error below ProposalBubble | Diff stays visible; user can Reject |
| Stream interrupted | Inline error in AgentBubble | Composer re-enabled |
| Timeout (>30 s, no event) | Inline error in AgentBubble | Composer re-enabled |

---

## 9. Acceptance criteria (vertical slice)

All must be green before adding any new capability:

```
AC-1  sidebar opens via ribbon icon
AC-2  context chip shows @selection when text is selected
AC-3  context chip shows @<note> always
AC-4  typing and sending triggers RUNNING state
AC-5  ThinkingTrace expands while running and settles into a collapsible
      completed trace with elapsed time
AC-6  streamed words resolve into AgentBubble, then Markdown renders and Copy
      becomes available after completion
AC-7  prompt bar can attach text context, choose `/` actions, and change model
      without bypassing `LearningController`
AC-8  ProposalBubble renders before/after lines with correct colors
AC-9  Apply replaces exact text in editor
AC-10 Ctrl+Z reverts the Applied change in one undo step
AC-11 Reject leaves file unchanged, shows rejected badge
AC-12 ERROR slate appears when the agent runtime is unavailable, sidebar does not crash
AC-13 timeout re-enables composer, shows inline error
```

---

## 10. Out of this spec

- @file manual mention
- Multiple proposals per turn
- Session persistence
- Keyboard shortcut (Ctrl+L)
- Animation / transitions
