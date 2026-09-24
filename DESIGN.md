# Forge Design System

## Design contract

Forge is a compact Learning OS control surface inside Obsidian.

```text
user intent
→ product state
→ information responsibility
→ correct UI primitive
→ interaction
→ visual treatment
```

Target: calm, precise, compact, technical, functional, AI-native, and native
beside Obsidian.

Hierarchy: position → spacing → typography → surface → border → elevation →
accent. Purple is semantic, not decorative.

## Root graph

```text
Forge
├── Header
├── Thread
│   ├── UserBubble
│   ├── StatusTrace
│   ├── PlainResponse
│   ├── PracticeCard
│   ├── PracticeEvaluation
│   ├── ReviewFindingCard
│   ├── ProposalCard
│   └── ErrorRow
└── Composer
    ├── IntentChip?
    ├── AttachmentChip*
    ├── PromptInput
    └── AddContext / Model / Send
```

## Card decision

```text
owns state / lifecycle / action?
├── no  → inline
└── yes
    ├── consequential → ApprovalCard
    └── otherwise     → ContentCard
```

Normal AI explanation is PlainResponse, not a card.

## Intent

Ask is implicit default.

Explain, Review, Edit are one-shot. Practice is persistent until the practice
session completes or the user exits it.

`/` chooses intent, creates an IntentChip, and removes command text from the
actual prompt.

## Context

```text
Primary  = selection or current note
Explicit = @vault-note / attachment
System   = learning policy / progress
```

The composer shows a compact summary such as `@index.md · selection +2`.
Typing `@name` searches vault Markdown notes and adds real context.

## Visual system

Use a deliberate light-mode token ratio:

```text
80% white surfaces
15% soft purple canvas / inset surfaces
5% purple accent for active AI state and primary actions
```

Forge owns these semantic tokens instead of inheriting arbitrary Obsidian
theme colors. Purple means active AI intent, focus, selection, or a primary AI
action. It should not decorate every surface.

Green = correct/success/applied.
Orange = partial/warning/review.
Red = failure/destructive/incorrect.

Typography: 11 / 12 / 12.5 / 13 / 14 / exceptional 21px.
Spacing: 4 / 6 / 8 / 10 / 12 / 16 / 24px.
Radius: 6 chip / 8 control / 10 card / 14 composer-window / pill.
Compact controls: 28px.
Borders: crisp 1px.
Shadows: tiny and structural.

## Thread rules

UserBubble: compact purple tint, max ~84%, no broad shadow.

PlainResponse: transparent outer surface, no border, 13–14px rendered Markdown.

StatusTrace: show real operational facts only. Default `Working · 2.4s`;
completion `Completed in 2.4s`. Do not simulate tool execution with timers.

PracticeCard: neutral card with small purple concept label and inset hint.

PracticeEvaluation: green / orange / red by outcome. Purple never means
correctness.

ReviewFindingCard: one material gap per card. Finding kinds are misconception,
missing relationship, factual error, and weak explanation. Actions: Practice,
Fix.

ProposalCard: proposed → Reject or Apply → applied/stale. Never style a proposal
as already executed.

## Composer

```text
[Intent ×] [attachments...]

Ask anything about this note...

+                              Model ▾   send
```

Composer radius 10px, input 13px, controls 28px. Model is visually secondary.
The plus control owns context and file actions; do not duplicate it with a
separate `No context` or context selector button.

## Motion

100–150ms feedback, 150–200ms menus/controls, 220–300ms expansion. Motion only
communicates state or spatial relation. Respect reduced motion.

## Avoid

No purple gradients, glassmorphism, glowing borders, broad SaaS shadows,
decorative nested cards, giant icons/headings, arbitrary radii, fake thinking
stages, permanent animation, or hidden consequential actions.

## Acceptance

1. Primary information and next action are obvious.
2. Every card owns state/lifecycle/action.
3. Every non-neutral color has meaning.
4. Context is inspectable.
5. Running/proposed/applied/failed/evaluation states are distinct.
6. One-shot intents reset.
7. Practice remains coherent across question → answer → evaluation.
8. Keyboard and reduced motion remain usable.
9. UI feels like Obsidian, not a generic AI dashboard.
