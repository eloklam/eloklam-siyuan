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
4. Do not touch `/home/eloklam/SiYuan`, because that is the note vault and is backed up elsewhere.
5. Do not use OpenClaw or OpenCode.
6. Do not do broad rewrites.
7. Apply recovered patches one by one.
8. If a patch does not apply cleanly, inspect it and manually port the intended change.
9. Commit after each logical successful patch group.
10. End with a rebuild report listing applied patches, conflicts, unresolved files, and next commands.

Recommended order:

1. language files
2. `app/src/protyle/render/av/layout.ts`
3. `kernel/model/attribute_view.go`
4. calendar helper files
5. `event-dialog.ts`
6. `_av.scss`
7. `render.ts`
8. typecheck or build checks
