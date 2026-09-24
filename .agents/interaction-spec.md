# Forge Interaction Spec

One Obsidian right-sidebar ItemView:

```text
Header
↓
Thread
↓
Composer
```

Thread primitives: UserBubble, PlainResponse, StatusTrace, PracticeCard,
PracticeEvaluation, ReviewFindingCard, ProposalCard, ErrorRow. Normal AI prose
is inline, not a generic card.

Ask is implicit default. Explain/Review/Edit last one turn. Practice persists
while practice is active. Slash selection creates an intent chip and removes the
slash token from user content.

The composer shows compact context. Typing `@name` searches vault Markdown
notes; selecting one adds actual note content and removes the token.

Running state shows operational status and elapsed time. No timer-driven fake
execution steps.

Practice: question → answer in main composer → evaluation → evidence → next
question or Ask.

Review: structured findings → one card per material gap → Practice or Fix →
review evidence → Ask.

Edit: proposal → Reject/Apply → applied or stale → Ask.

Keyboard: Enter send, Shift+Enter newline, @ source menu, / command menu, arrows
navigate, Enter/Tab select, Escape closes/stops.

Acceptance: Ask works without mode selection; one-shot intents reset; Practice
persists only during its session; command tokens are not sent; @note adds real
context; plain responses are inline; Practice/Review are structured cards;
running UI does not claim fake steps; proposals remain pending until Apply;
applied edits are Undo-safe; cancel/failure restores a usable composer.
