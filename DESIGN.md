# Forge Design System

Forge is a native Obsidian AI workspace. Its interface should feel calm,
precise, compact, technical, functional, and AI-native. It should look like a
serious productivity tool, not a marketing surface.

This document is the source of truth for new and refactored UI. Preserve the
existing Learning OS behavior and ownership boundaries while applying this
visual and interaction language.

## Design direction

Use this order when shaping a component:

```text
structure → hierarchy → interaction → decoration
```

Hierarchy should come primarily from spacing, typography, surface contrast,
hairline boundaries, and restrained elevation. Color is secondary. The UI
should remain coherent when viewed almost entirely in grayscale.

### Forge exception

Keep Forge's existing purple accent. It is the Obsidian
`--interactive-accent` token and is reserved for active AI state, intentional
primary actions, focus, and selected context. Do not replace it with blue,
rainbow, gradients, or decorative accent systems.

## Interface graph

The right-sidebar experience is one compact workspace:

```text
Forge sidebar
├── Header
│   ├── Forge identity
│   ├── New session
│   └── Ask / Explain / Practice / Review / Edit modes
├── Thread
│   ├── Empty / context-ready slate
│   ├── User request
│   ├── Thinking trace
│   ├── Streaming response
│   ├── Rendered Markdown answer
│   ├── Edit proposal + approval
│   └── Recoverable error / stopped state
└── Composer
    ├── Context chips
    ├── Attachments
    ├── Prompt input
    ├── Source and slash-command menus
    ├── Model selector
    ├── Dictation
    └── Send / cancel
```

### Primary moves and states

| Move | Visible result | Required meaning |
| --- | --- | --- |
| Open sidebar | Empty, ready, or error slate | Readiness is explicit |
| Resolve note or selection | Context chips | Agent-visible context is inspectable |
| Choose mode | Selected mode tab | Mode changes the learning action |
| Type `@` or `/` | Context or command menu | Advanced controls are progressively disclosed |
| Attach a file | Attachment chip | Imported content is visible and removable |
| Send | User bubble, thinking trace, running state | Work has started |
| Stream response | Progressive text edge | Generation is in progress |
| Complete response | Rendered Markdown + actions | Markdown is content, not raw syntax |
| Receive edit proposal | Reviewable diff and Apply / Reject | Recommendation is not execution |
| Apply | Applied state | Only approved, validated mutation changes notes |
| Stop or fail | Recoverable status + composer | User can understand and retry |

### Meaningful variants

Design and verify these variants without changing the product's ownership:

```text
EMPTY · NO_CONTEXT · READY · THINKING · TOOL_RUNNING
STREAMING · MARKDOWN_ANSWER · PROPOSAL · APPLIED
ERROR · STOPPED · RUNTIME_UNAVAILABLE · STALE_EDIT
menu-open · attachments-present · dictation-listening
mobile/narrow-sidebar · keyboard-focus · reduced-motion
```

### Interaction contract

- Keep keyboard focus visible with a 2px purple outline and 2px offset.
- `@` and `/` menus support ArrowUp/ArrowDown, Enter/Tab selection, and Escape.
- Menus use one moving highlight, not a border around every row.
- Send is disabled until there is prompt content or an attachment.
- Cancel is available while work is running and returns the composer to a
  recoverable state.
- Status text uses `role="status"` or an equivalent accessible live region for
  thinking, streaming, completion, and failure transitions.
- Dictation communicates unsupported, listening, and resolved states without
  requiring animation to understand them.

## Semantic tokens

Components must use semantic Forge tokens rather than hard-coded colors. The
tokens are scoped to `.forge-root` and map to Obsidian so light/dark themes keep
their native hierarchy.

```css
--forge-page       /* application background */
--forge-canvas     /* thread/workspace background */
--forge-surface    /* primary working surface */
--forge-inset      /* lower-emphasis internal region */
--forge-hover      /* quiet hover surface */
--forge-hover-2    /* stronger hover surface */
--forge-ink        /* primary information */
--forge-ink-2      /* secondary information */
--forge-ink-3      /* metadata/supporting information */
--forge-line       /* default hairline */
--forge-line-strong /* focus and structural boundary */
--forge-line-soft  /* low-emphasis divider */
--forge-field      /* input field */
--forge-accent     /* existing purple interactive accent */
--forge-accent-ink /* readable accent foreground */
--forge-accent-tint /* subtle purple state background */
--forge-green      /* success */
--forge-orange     /* warning / needs review */
--forge-red        /* destructive / failure */
```

Use neutral tokens for most content. Semantic colors need a foreground and a
low-chroma tint. Never use saturated color as a large decorative panel.

## Typography

- Interface font: `var(--font-interface, Inter, ui-sans-serif, system-ui,
  sans-serif)`.
- Monospace: `var(--font-monospace, "JetBrains Mono", ui-monospace,
  monospace)`.
- Base text is 13–14px with approximately 1.5 line height and slight negative
  tracking.
- Common compact UI is 12–13px. Metadata is 10–11.5px.
- Use 400, 500, and 600 weights. Prefer weight and spacing over oversized
  headings.
- Use monospace only for code, counters, timestamps, IDs, and technical
  metadata.

## Shape, spacing, and surfaces

Use the following small, systematic scale:

```text
radius: 6px chip · 8px control · 10px card · 14px window · 999px pill
spacing: 4px micro · 6px related · 8px compact · 10px bar · 12px card
         16px grouping · 24px section · 32px major separation
control: 28px icon/action target
```

Prefer one continuous surface with separators and inset regions over nested
cards. Every card must have a clear responsibility. Use crisp 1px borders and
small layered shadows; menus may be raised, but avoid large soft SaaS shadows.

## Component rules

### Header and modes

Keep the header compact. Identity, model/session actions, and mode selection
must remain visually distinct without extra navigation. Mode selection uses a
quiet surface change and purple only for the active AI state.

### Thread and messages

The thread is the canvas. User messages may use the purple accent as a compact
intent marker; agent messages use a neutral surface. Thinking, running,
proposal, applied, and failed states must not look interchangeable.

### Composer

The composer is a first-class workspace control:

```text
context / attachments
prompt input
+  model  dictation  send
```

It grows when text wraps, keeps controls at 28px, and opens menus relative to
its own boundary. Source selection, slash commands, model selection, files,
and dictation are extensions of one input system.

### Markdown responses

Completed AI output must render Markdown rather than expose raw syntax. Keep
headings compact, lists readable, code in an inset monospace surface, links
underlined, and tables as one continuous bordered region. Streaming may show a
temporary progressive edge, then settles into the rendered answer.

### AI state and trust

Use explicit operational copy such as `Reading context`, `Thinking`,
`Generating response`, `Needs review`, and `Applied`. A recommendation or edit
proposal is never styled as a completed mutation. Consequential actions require
explicit Apply / Reject controls.

## Motion and accessibility

Motion should communicate state, hierarchy, spatial relationship, or progress.
Use 100–150ms for feedback, 150–200ms for controls and menus, and 220–300ms
for expansion. Prefer `cubic-bezier(0.23, 1, 0.32, 1)` and small
`translateY(8px) → translateY(0)` entries.

Respect `prefers-reduced-motion: reduce`: collapse transitions and animations to
instant states. No state may depend on animation to be understood.

Responsive behavior changes composition before visual language:

```text
desktop: side-by-side regions when available
mobile/narrow sidebar: stacked content, same type/radius/token language
```

## Avoid

- Purple gradients, glassmorphism, glowing borders, or rainbow status systems.
- Giant shadows, oversized headings, oversized controls, or marketing hero
  composition.
- Cards inside cards without a responsibility boundary.
- Decorative badges, arbitrary radius values, or permanent ambient animation.
- Raw agent protocol, raw Markdown output, or hidden consequential actions.

## Design acceptance test

Before accepting a UI change, check:

1. Can the primary information and next action be identified immediately?
2. Does useful information occupy the available sidebar without feeling cramped?
3. Does every non-neutral color communicate state, action, or focus?
4. Does every container, border, radius, and shadow have a structural reason?
5. Can the user distinguish thinking, running, proposed, completed, and failed?
6. Do keyboard, reduced-motion, narrow-sidebar, and error variants remain clear?
7. Does the component look native beside the existing Forge interface?

The target feel is quiet, precise, sophisticated, technical, compact, and
intentionally designed.
