# SiYuan AV Calendar Rebuild Handoff

Date: 2026-05-25
Repository: `/home/eloklam/recovered-projects/SiYuan-recovered`
Branch: `recover/calendar-view-from-recovery`

## One-Line State

AV Calendar rebuild is complete in this branch, with automated backend/frontend/Electron smoke evidence committed. The next agent should preserve the current state, rerun verification when needed, and only do short visual acceptance or follow-up product improvements if explicitly requested.

## Hard Rules

- Do not touch `/home/eloklam/SiYuan`; it is the user's real note vault.
- Do not access `/mnt/recoveryssd` or `/media/eloklam/Extreme SSD`.
- Do not search raw recovery files.
- Do not read, print, or recover secrets.
- Do not use OpenClaw or OpenCode.
- Do not do broad rewrites.
- Commit after each successful logical patch group.
- Prefer isolated or throwaway workspaces for all SiYuan smoke runs.

## Current Git State

At handoff time:

- `git status --short` was clean.
- Latest commit: `7caff3b12 docs(calendar): finalize rebuild evidence`
- Important recent commits:
  - `7caff3b12 docs(calendar): finalize rebuild evidence`
  - `7e3a53db8 fix(calendar): support localized document flow`
  - `5eb4368c0 test(calendar): cover render drag move`
  - `a1788aaa2 test(calendar): cover render mutation interactions`
  - `a8baf8f07 test(calendar): cover event dialog in electron smoke`
  - `e8810dd10 test(calendar): cover electron render interactions`
  - `e94f2d399 test(calendar): render calendar in electron smoke`
  - `c2da0b44a test(calendar): verify electron app shell`
  - `c6fd08cfc test(calendar): automate electron launch smoke`
  - `87de53bd3 test(calendar): smoke transaction operations`

## What Was Rebuilt

The Calendar view is implemented across the AV frontend, backend validation, language files, styles, and repeatable smoke scripts.

Key rebuilt areas:

- Calendar rendering and event UI: `app/src/protyle/render/av/calendar/`
- AV entry/layout integration: `app/src/protyle/render/av/render.ts`, `app/src/protyle/render/av/layout.ts`
- Calendar styles: `app/src/assets/scss/business/_av.scss`
- Backend Attribute View validation/transactions: `kernel/model/attribute_view.go`
- Backend calendar tests: `kernel/model/attribute_view_calendar_test.go`
- Language coverage: `app/appearance/langs/*.json`
- Verification scripts: `scripts/calendar-*.mjs`

Implemented behavior includes month/week/day/schedule views, date-field setup, event create/edit/delete/duplicate, recurrence parsing/expansion, occurrence deletion/replacement, this-and-future split, mapped metadata fields, search/filter, drag/drop, resize, read-only/query-embed guards, keyboard navigation, localized labels, and Traditional Chinese desktop document flow.

The authoritative detailed report is `CALENDAR_REBUILD_REPORT.md`.

## Verification Already Passed

These commands passed before this handoff:

```sh
git diff --check
node scripts/calendar-audit.mjs
node scripts/calendar-recurrence-smoke.mjs
node scripts/calendar-transactions-smoke.mjs
node scripts/calendar-kernel-smoke.mjs
cd kernel && go test -vet=off ./av ./model ./sql
cd ../app && corepack pnpm run build:desktop
node scripts/calendar-electron-launch-smoke.mjs
node scripts/calendar-electron-document-flow-smoke.mjs
```

Known expected noise:

- `corepack pnpm run build:desktop` reports existing webpack bundle size warnings.
- Electron smoke scripts may log DBus/GPU/network shutdown messages after success; trust the script exit code and the explicit `... smoke passed` line.
- `scripts/calendar-electron-launch-smoke.mjs` and `scripts/calendar-electron-document-flow-smoke.mjs` both use port `6806`; run them sequentially, not in parallel.

## If You Need To Reverify

Run this from the repository root:

```sh
git status --short
git diff --check
node scripts/calendar-audit.mjs
node scripts/calendar-kernel-smoke.mjs
node scripts/calendar-recurrence-smoke.mjs
node scripts/calendar-transactions-smoke.mjs
node scripts/calendar-electron-launch-smoke.mjs
node scripts/calendar-electron-document-flow-smoke.mjs
cd kernel && go test -vet=off ./av ./model ./sql
cd ../app && corepack pnpm run build:desktop
```

If one Electron smoke fails because port `6806` is already occupied, check for stale processes and rerun the Electron scripts sequentially.

## Remaining Manual Acceptance

No broad manual smoke is required to prove the core Calendar workflow; it is covered by automated smoke. Optional visual acceptance, if requested:

- Open only an isolated workspace or explicit throwaway workspace.
- Visually inspect dense month/week/day/schedule views at normal and narrow pane widths.
- Confirm drag/drop and resize feel acceptable with real pointer movement.
- Switch Calendar back to Table/Gallery/Kanban and confirm the same AV data is still visible.

Do not use `/home/eloklam/SiYuan` for this.

## Good Next Product Improvements

Only pursue these if the user explicitly asks for further Calendar improvement:

- Replace the current text-heavy recurrence controls with a richer recurrence editor.
- Improve timed week/day layout so overlapping timed events are spatially arranged.
- Add stronger visual affordances for drag/resize without cluttering event pills.
- Add timezone and DST-specific recurrence tests.
- Add Playwright screenshot checks for dense month/week/day/schedule visual regressions.
- Turn the Electron document-flow smoke into a reusable fixture helper for future AV view tests.

## If You Change Anything

- Keep changes tightly scoped to Calendar/AV behavior.
- Rerun the relevant smoke script plus `node scripts/calendar-audit.mjs`.
- For frontend/rendering changes, also run `cd app && corepack pnpm run build:desktop`.
- For backend AV transaction changes, also run `cd kernel && go test -vet=off ./av ./model ./sql`.
- Commit with a focused message after each logical group.
- Update `CALENDAR_REBUILD_REPORT.md` if the verified behavior, known warnings, or next commands change.
