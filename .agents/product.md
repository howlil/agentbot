# Product — Forge Learning OS for Obsidian

Forge keeps understanding, practice, review, and safe AI editing beside the
learning material already stored in Obsidian.

```text
material + explicit context + learning state
→ Forge
→ explain / practice / review / edit
→ understanding + evidence + approved vault change
```

Ask is default. Explain, Review, and Edit are one-shot intents. Practice is a
persistent active-recall session.

Automatic context is selection first, otherwise current note. Explicit context
comes from `@vault-note` or attached text files. System policy/progress remains
separate from user-selected sources.

Only meaningful evidence changes learning state. Practice evaluation and
structured Review can create evidence. A correct answer is not automatic
mastery.

Review emits only material gaps: misconception, missing relationship, factual
error, or weak explanation. Findings can feed Practice or Edit.

Editing is proposal → context authorization → diff → Apply/Reject → exact unique
revalidation → Obsidian mutation. Native Undo remains available.

Current scope: sidebar workspace, streaming Markdown, structured learning
intents, note/selection/explicit context, model choice, practice evaluation,
structured review, evidence-backed progress, safe diff approval, session
persistence, and recoverable runtime states.

Deferred: RAG, embeddings, background indexing, autonomous mutation, multi-agent
orchestration, progress dashboards, course builders, scheduling, and provider
management UI.
