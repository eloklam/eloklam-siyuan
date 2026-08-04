# SiYuan Calendar Recovery Rebuild

This repository is a clean SiYuan upstream baseline plus recovered patch evidence.

Goal:

Rebuild the user's lost local SiYuan fork calendar view work using only the recovered patch bundle.

Recovered patch bundle:

`RECOVERY-calendar-patch-curated`

Important recovered areas:

1. `kernel/model/attribute_view.go`
2. `app/src/protyle/render/av/calendar/render.ts`
3. `app/src/protyle/render/av/calendar/event-dialog.ts`
4. `app/src/assets/scss/business/_av.scss`
5. `app/src/protyle/render/av/calendar/mapped-fields.ts`
6. `app/src/protyle/render/av/calendar/normalize.ts`
7. `app/src/protyle/render/av/calendar/recurrence.ts`
8. `app/src/protyle/render/av/calendar/transactions.ts`
9. `app/src/protyle/render/av/layout.ts`
10. language files under `app/appearance/langs`

Rules:

1. Do not access `/mnt/recoveryssd` or `/media/eloklam/Extreme SSD` except to read already copied recovery summaries if absolutely necessary.
2. Do not search raw recovery files.
3. Do not read, print, or recover secrets.
4. Before using `/home/eloklam/SiYuan` (the note vault), ask the user for explicit approval first.
5. Use Hermes via Orca for execution. Orca implementation terminals must launch `hermes --profile fixer`; review terminals must launch `hermes --profile reviewer`.
6. Do not launch Claude, Claude Code, Codex, OpenClaw, OpenCode CLI, or another external coding-agent CLI. A model provider used inside a Hermes profile remains a Hermes execution lane.
7. Do not do broad rewrites.
8. Apply recovered patches one by one.
9. If a patch does not apply cleanly, inspect it and manually port the intended change.
10. Commit after each logical successful patch group.
11. End with a rebuild report listing applied patches, conflicts, unresolved files, and next commands.

Recommended order:

1. language files
2. `app/src/protyle/render/av/layout.ts`
3. `kernel/model/attribute_view.go`
4. calendar helper files
5. `event-dialog.ts`
6. `_av.scss`
7. `render.ts`
8. typecheck or build checks
