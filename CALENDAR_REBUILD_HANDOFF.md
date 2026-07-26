# SiYuan AV Calendar Handoff

Date: 2026-07-26
Repository: `/home/eloklam/Schreibtisch/Apps/SiYuan-Calender-next` (git worktree)
Branch: `calendar-production`
Base: upstream SiYuan v3.7.3 (merged at `bc0be0c9a`)

## One-Line State

The AV Calendar is merged onto upstream v3.7.3, fully localized in all 21 bundled
languages, hardened per the note-native UX plan (P0–P6), and green across the
whole automated verification suite. The original recovery repo at
`/home/eloklam/Schreibtisch/Apps/SiYuan-Calender` (branch
`recover/calendar-view-from-recovery`, v3.6.5 base) is kept untouched as a
fallback.

## Hard Rules

- Do not touch `/home/eloklam/SiYuan`; it is the user's real note vault.
- Do not access `/mnt/recoveryssd` or `/media/eloklam/Extreme SSD`.
- Do not read, print, or recover secrets.
- Work only in this worktree; leave the original repo directory unchanged.
- Commit after each successful logical patch group.
- Prefer isolated or throwaway workspaces for all SiYuan smoke runs.

## What Changed Since the 2026-05-25 Rebuild Handoff

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

## Verification (all green as of this handoff)

```sh
cd /home/eloklam/Schreibtisch/Apps/SiYuan-Calender-next
git diff --check
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
cd kernel && go test -vet=off ./av ./model ./sql && cd ..
cd app && corepack pnpm run build:desktop && cd ..
node scripts/calendar-electron-launch-smoke.mjs
node scripts/calendar-electron-document-flow-smoke.mjs
```

Known expected noise:

- Webpack reports pre-existing bundle-size warnings.
- Upstream's Obsidian import tests (`TestAnalyzeObsidianVault` etc.) fail on
  this machine for environment reasons ("Vault path is sensitive"); the files
  are identical to upstream — not calendar-related.
- `tsc` shows two pre-existing upstream errors (`newItemTemplate.ts`
  replaceAll lib target; `protyle.d.ts` Background.ts case mismatch on Linux).
- Both Electron smokes bind port 6806 — run them sequentially, never in
  parallel. DBus/GPU/network shutdown noise after the "smoke passed" line is
  harmless.
- First run after `pnpm install`: pnpm skips Electron's postinstall; run
  `node app/node_modules/electron/install.js` once to download the binary.

## Remaining / Future (not blocking production use)

- P7 ideas from `.hermes/plans/2026-05-31_223015-siyuan-calendar-note-native-ux.md`
  (daily-note integration, template support, NL date extraction, agenda
  export, large-AV virtualization) remain future work.
- "Create linked document from calendar item" is intentionally deferred:
  creation is AV-row-first; rows can be bound to documents via the row's own
  context.
- Visual/screenshot regression fixtures (P6 item 6) are not automated.
