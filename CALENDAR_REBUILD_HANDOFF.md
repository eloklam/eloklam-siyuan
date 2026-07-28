# SiYuan AV Calendar Handoff

Date: 2026-07-28
Repository: `/home/eloklam/orca/workspaces/SiYuan-Calender-next/siyuan-claude-merge`
Branch: `eloklam/siyuan-claude-merge`
Base: `calendar-production` at `b50c87f4552df26abaeac10269363869cdee6f0f`

## One-Line State

This integration worktree contains the complete Claude Calendar candidate plus
the recovery branch's proven baseline. It replaces the unsafe two-request
bound-event rename/update sequence with one kernel operation protected by a
persistent old-state journal, preserves page-backed creation across duplicate
and recurrence-split paths, fixes the month overflow boundary, and removes
committed smoke artefacts. The original recovery repo at
`/home/eloklam/Schreibtisch/Apps/SiYuan-Calender` and the original
`calendar-production` worktree remain untouched.

## Hard Rules

- Do not touch `/home/eloklam/SiYuan`; it is the user's real note vault.
- Do not access `/mnt/recoveryssd` or `/media/eloklam/Extreme SSD`.
- Do not read, print, or recover secrets.
- Work only in this worktree; leave the original repo directory unchanged.
- Commit after each successful logical patch group.
- Prefer isolated or throwaway workspaces for all SiYuan smoke runs.

## What Changed Since the 2026-05-25 Rebuild Handoff

- Bound event edits now call `/api/av/updateAttributeViewItem` once. The kernel
  validates the item/document binding, stages the title and all mapped fields,
  writes a persistent old-document/old-AV journal before replacement, restores
  both files on any commit error, and recovers an interrupted commit on startup
  or encrypted-notebook unlock. Encrypted journals use a DEK-derived key.
- Page-backed semantics now survive duplicate-to-next-day, single-occurrence
  replacement, and this-and-future split paths, including the selected default
  new-item template.
- Fixed the four-event month boundary to render three chips plus `+1`.
- Removed nested interactive roles from event-chip buttons and retained the
  commands through the chip and context menu.
- Removed committed `.calendar-tx-smoke-*` artefacts and ignored future runs.
- Fixed an AV snapshot regression exposed by the real backend contract: ordinary
  recurrence replacement/split transactions no longer overwrite their newly
  inserted rows with a stale pre-insert AV snapshot.
- Merged upstream v3.7.3 (~2800 commits): RFC 5646 language files
  (`en.json`, `zh-TW.json`, …), cobra-style kernel CLI (`SiYuan-Kernel serve`),
  Electron 42, reworked AV render pipeline (virtual scroll / locate).
- Note-native UX plan P0 completed and extended:
  - P0.6 gap closed: drag, drop, and resize of recurring items now ask for
    scope (occurrence / this-and-future / series) exactly like dialog edits.
  - `recurrenceRaw: "None"` events no longer trigger the scope dialog.
  - Quick-create reclaims title focus if a global handler drops it.
- P1: overlapping timed events share week/day columns (overlap clusters);
  month cells cap at 3 events with a "+N" day peek; zero-item calendars show
  a create hint.
- P2: stale/retyped field mappings cannot soft-lock settings any more
  (single-key mapping payloads, honest "missing field" dropdown options,
  `getCalendarFieldMapping` refuses unusable date fields, backend prunes
  calendar references on column type change and on missing fields).
  Synthetic "Untitled" titles are placeholders only and never written back.
- P4: clicking a day cell selects the date (ring + jump input) and view
  switches/navigation keep it.
- P5: `aria-current="date"` on today, scope dialog focuses its first enabled
  option, plus the pre-existing keyboard/ARIA coverage.
- i18n: all `calendar*` keys localized in all 21 languages (only zh-TW/zh-CN
  were real translations before; everything else was English placeholder).
- Smokes updated for v3.7.3: `serve` subcommand, dynamic kernel version,
  missing harness stubs, scope-dialog interactions, dynamic event date in the
  document-flow smoke (was hardcoded to May 2026 — a time bomb), and a
  layout-model readiness wait before `openFileByURL`.

## Verification (green as of 2026-07-28)

```sh
cd /home/eloklam/orca/workspaces/SiYuan-Calender-next/siyuan-claude-merge
git diff --check
cd app && ./node_modules/.bin/tsc -p tsconfig.typecheck.json && cd ..
node scripts/calendar-audit.mjs
node scripts/calendar-recurrence-smoke.mjs
node scripts/calendar-transactions-smoke.mjs
node scripts/calendar-time-grid-smoke.mjs
node scripts/calendar-quick-create-smoke.mjs
node scripts/calendar-quick-create-duplicate-submit-smoke.mjs
node scripts/calendar-recurrence-scope-smoke.mjs
node scripts/calendar-safe-edit-smoke.mjs
node scripts/calendar-source-link-smoke.mjs
node scripts/calendar-transaction-feedback-smoke.mjs
node scripts/calendar-transaction-feedback-behavior-smoke.mjs
node scripts/calendar-kernel-smoke.mjs
node scripts/calendar-backend-contract-smoke.mjs
cd kernel && go test ./api ./av && go test -vet=off ./sql && cd ..
cd app && ./node_modules/.bin/webpack --mode production --config webpack.desktop.js && ./node_modules/.bin/webpack --mode production && cd ..
node scripts/calendar-electron-launch-smoke.mjs
node scripts/calendar-electron-document-flow-smoke.mjs
```

Known expected noise:

- Webpack reports pre-existing bundle-size warnings.
- Upstream's Obsidian import tests (`TestAnalyzeObsidianVault` etc.) fail on
  this machine for environment reasons ("Vault path is sensitive"); the files
  are identical to upstream — not calendar-related.
- The direct TypeScript compiler invocation is green in this worktree. The
  `pnpm` wrapper may try to purge the shared `node_modules` in a non-TTY shell;
  direct `tsc` and `webpack` avoid that environment-only bootstrap behaviour.
- Both Electron smokes bind port 6806 — run them sequentially, never in
  parallel. DBus/GPU/network shutdown noise after the "smoke passed" line is
  harmless.
- First run after `pnpm install`: pnpm skips Electron's postinstall; run
  `node app/node_modules/electron/install.js` once to download the binary.

## Remaining / Future (not blocking production use)

- P7 ideas from `.hermes/plans/2026-05-31_223015-siyuan-calendar-note-native-ux.md`
  (daily-note integration, template support, NL date extraction, agenda
  export, large-AV virtualization) remain future work.
- Page-per-entry creation is implemented for normal create, quick create,
  dialog create/duplicate, duplicate-to-next-day, occurrence replacement and
  this-and-future split. Every route carries the configured default document
  template.
- Visual/screenshot regression fixtures (P6 item 6) are not automated.
