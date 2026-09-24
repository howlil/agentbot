# Product — AGY Obsidian Plugin

## Problem

**Actor:** Knowledge worker writing or studying inside Obsidian.  
**Trigger:** User wants to understand or improve text in the current note without leaving it.  
**Current behavior:** User switches to a browser or separate AI tool, copies text, pastes it, reads the answer, manually edits back. Flow breaks.  
**Problem:** Switching context to an external AI tool interrupts writing flow, loses the spatial relationship between the question and the text, and makes applying AI suggestions a manual copy-paste step with no undo guarantee.  
**Desired outcome:** Ask a question about the current note and receive a readable explanation *or* a diff-based edit proposal, inline in Obsidian, without leaving the editor — and be able to Apply the change as a single undoable transaction.

---

## Behavior

### Happy path — Ask

```
Note open in editor
  ↓ user selects paragraph (optional)
  ↓ opens AGY sidebar (Ctrl+L or icon)
EMPTY state → "Ask AGY about this note"
  ↓ user types prompt, sends
THINKING state → "AGY working… Reading <note name>"
  ↓ AGY streams response
ANSWER state → streamed markdown in conversation
  ↓ job complete
```

### Happy path — Edit

```
ANSWER or EMPTY state
  ↓ user sends prompt requesting a change
THINKING state
  ↓ AGY proposes patch
DIFF state → diff preview rendered in conversation bubble
              - old line
              + new line
              [Reject]   [Apply]
  ↓ user clicks Apply
APPLIED state → "✓ Updated <note name>"
  ↓ Obsidian editor reflects change
  ↓ Ctrl+Z reverses it (single editor transaction)
  ↓ job complete
```

### Context resolution (automatic, transparent)

```
Text selected in editor
  → context = @selection   (shown in composer chip)

No selection
  → context = @current-note (shown in composer chip)

User types @<name>
  → additional context appended to request
```

### Failure state

```
AGY CLI not found or unreachable
  → sidebar shows: "AGY unavailable — AGY CLI was not found"
  → [Configure AGY] button
  → all other sidebar elements disabled
```

---

## States

| State     | What the user sees                                             |
|-----------|----------------------------------------------------------------|
| EMPTY     | Placeholder "Ask AGY about this note", context chip visible   |
| THINKING  | Spinner + "Reading \<note\>" status line, input disabled        |
| ANSWER    | Streamed markdown response in conversation                     |
| DIFF      | Diff block inside conversation bubble + Reject / Apply buttons |
| APPLIED   | "✓ Updated \<note\>" confirmation, note already changed        |
| ERROR     | "AGY unavailable" + Configure button                          |

State transitions:

```
EMPTY ──send──→ THINKING ──stream──→ ANSWER
                                      │
                              edit proposed
                                      ↓
                                    DIFF
                                   /    \
                             Reject    Apply
                               ↓         ↓
                            ANSWER    APPLIED
```

---

## Constraints

- **No magic context.** Every file the AI can read must be visible as a chip in the composer. No background vault indexing, embeddings, or implicit file reading.
- **Edits are atomic.** Apply must use a single Obsidian editor transaction so native Undo works without special handling.
- **Sidebar only.** AGY lives in the Obsidian right sidebar. No separate dashboard, history page, or workspace page.
- **Local CLI dependency.** AGY CLI must be installed and accessible. The plugin does not bundle or proxy the AI itself.
- **Obsidian platform.** All UI must be a standard Obsidian ItemView. No external browser window or full-page takeover.
- **Minimal UI surface.** No toolbar heavy with mode switches, token counters, agent status panels, or settings embedded in the sidebar chat.

---

## Scope

**In v0:**
- Right sidebar chat panel
- Streaming AGY response (ANSWER state)
- Model selector (single dropdown in header)
- `@current-note` context (auto, shown as chip)
- `@selection` context (auto when text selected, shown as chip)
- `@<file>` manual context via mention
- Markdown diff proposal (DIFF state) with Apply / Reject
- Apply as single editor transaction (Undo-safe)
- ERROR / unavailable state with Configure action

**Out of v0 (explicitly deferred):**
- Agent mode (multi-step, multi-file, terminal)
- Background vault indexing / RAG / embeddings
- Multi-agent or Codex / Claude CLI support
- Chat history browser or branching
- Prompt marketplace
- MCP manager UI
- Complex session manager
- Automatic file mutation without diff preview

---

## Proof

```
Given: note open in editor, paragraph selected
When:  user opens AGY sidebar and types "perbaiki penjelasan ini"
Then:  THINKING state shows "Reading <selection>"
       DIFF state renders before/after lines
       clicking Apply changes the note text immediately
       Ctrl+Z reverses the change in one step
       no browser tab or external window was opened
```

```
Given: AGY CLI is not installed
When:  user opens the AGY sidebar
Then:  ERROR state is shown with "AGY CLI was not found"
       [Configure AGY] is the only actionable element
       no crash, no blank panel
```

```
Given: no text selected, note open
When:  user sends any message
Then:  context chip shows "@current-note"
       AGY response references the current note, not vault-wide content
```

---

## Assumptions

- AGY CLI is invocable from a Node.js child process spawned by the plugin.
- Diff format from AGY is line-level (unified diff or equivalent) and can be rendered without a full LSP.
- Obsidian's editor API (CodeMirror 6) supports atomic multi-line replacement via a single transaction.
