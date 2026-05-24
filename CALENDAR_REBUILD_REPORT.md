# SiYuan AV Calendar Rebuild Report

Date: 2026-05-24

## Scope

Rebuilt and strengthened the Attribute View Calendar work from the curated recovery bundle intent. This report covers the current branch state and the automated evidence gathered so far. Raw recovery disks and the note vault were not accessed.

## Applied / Rebuilt Patch Areas

- `kernel/model/attribute_view.go`
- `app/src/protyle/render/av/render.ts`
- `app/src/protyle/render/av/layout.ts`
- `app/src/protyle/render/av/calendar/model.ts`
- `app/src/protyle/render/av/calendar/normalize.ts`
- `app/src/protyle/render/av/calendar/recurrence.ts`
- `app/src/protyle/render/av/calendar/mapped-fields.ts`
- `app/src/protyle/render/av/calendar/transactions.ts`
- `app/src/protyle/render/av/calendar/event-dialog.ts`
- `app/src/protyle/render/av/calendar/render.ts`
- `app/src/assets/scss/business/_av.scss`
- `app/appearance/langs/*.json`
- `kernel/model/attribute_view_calendar_test.go`
- `scripts/calendar-kernel-smoke.mjs`
- `scripts/calendar-recurrence-smoke.mjs`
- `scripts/calendar-transactions-smoke.mjs`
- `scripts/calendar-electron-launch-smoke.mjs`

## Implemented Functionality

- Calendar layout rendering from AV data.
- Responsive Calendar toolbar wrapping for narrow panes.
- Visible focus ring for keyboard navigation on the Calendar surface.
- Calendar region and polite live updates for changing title and event summary.
- Month, week, day, and schedule views.
- Local Calendar view-mode switching in read-only and query-embed contexts without mutating data.
- Today marker in month, week, day, and schedule views.
- Persistent calendar view mode.
- Keyboard navigation for previous/next range, previous/next event, today, view switching, new event, search focus, and search clearing.
- Accessibility shortcut metadata for Calendar keyboard commands.
- Direct jump to a specific calendar date.
- Jump to the previous or next matching event from the current Calendar anchor.
- Previous/next event jumping reports when no matching event exists.
- Configurable date field and week start.
- Empty calendar date-field setup and date-field creation.
- Event create, edit, delete, and duplicate as independent one-off events.
- Event dialog can jump to the source block for existing events.
- Double-click empty calendar day areas to create events.
- Quick-copy events to the next day from the Calendar surface as independent one-off events.
- Event date, end date, all-day, time, title, location, description, recurrence, exception, and color field handling.
- Event tooltip and accessibility label with full date/time and mapped metadata.
- Event tooltip and accessibility label use descriptive occurrence text for recurring occurrences.
- Visible recurring-series and occurrence markers on event pills.
- Drag move and timed resize for calendar events.
- Schedule rows support drag/drop event moves.
- Direct all-day event duration resize by day.
- Search over title, metadata, recurrence, dates, and times.
- Event type filtering for all, timed, all-day, and recurring events.
- Search result count and one-click search clearing.
- Unified result count and clear control for active search/filter state.
- Localized visible-range event summary for total, all-day, and timed events.
- Localized timed-event labels in Calendar summary and filtering controls.
- Localized quick-copy control label on event pills.
- Field mapping for recurrence, exception, location, description, and color.
- Color mapping for `select` and `mSelect` fields.
- Recurrence parsing and expansion for daily, weekly, monthly, and yearly rules.
- Recurrence `INTERVAL`, `COUNT`, `UNTIL`, weekly `BYDAY`, `None`, malformed-rule rejection, and strict date handling.
- Recurrence exceptions and occurrence deletion.
- Single occurrence replacement when exception mapping exists.
- This-and-future split for recurring series.
- Dialog notice when an occurrence edit will affect the whole recurring series.
- Read-only and query-embed guards for calendar mutations.
- Read-only and query-embed events remain inspectable in a read-only dialog with mutation controls hidden.
- Backend validation for calendar date field, view mode, week start, and field mappings.
- Backend add/remove field synchronization for calendar fields and mappings.
- Backend Attribute View layout labels include Calendar in `_attrView` language maps, preventing localized layout switches from panicking.
- Language key coverage for all bundled language JSON files.

## Notable Hardening Commits

- `53db959b5 test(calendar): audit read-only and report guards`
- `43b21036a test(calendar): make audit path independent`
- `cfa92ca0d test(calendar): add static rebuild audit`
- `c4feb1729 docs(calendar): add rebuild audit report`
- `1106a80e1 fix(calendar): disable read-only event buttons`
- `f8b2c299b fix(calendar): report failed direct event updates`
- `ef9a6c37c fix(calendar): show specific dialog validation errors`
- `ab0cf78ee fix(calendar): localize layout name`
- `5712b321c fix(calendar): complete language key coverage`
- `dd4df9624 fix(calendar): reject invalid date field transaction data`
- `26b9f9645 fix(calendar): edit recurrence series when exceptions are unmapped`
- `9afcf0261 fix(calendar): treat unchanged updates as success`
- `709972c44 fix(calendar): skip unchanged cell updates`
- `61fff805c fix(calendar): validate draft times in transactions`

## Automated Verification

Passed:

```sh
git diff --check
cd kernel && go test -vet=off ./av ./model ./sql
cd app && corepack pnpm run build:desktop
node scripts/calendar-audit.mjs
node scripts/calendar-kernel-smoke.mjs
node scripts/calendar-recurrence-smoke.mjs
node scripts/calendar-transactions-smoke.mjs
node scripts/calendar-electron-launch-smoke.mjs
```

Also passed:

- All `app/appearance/langs/*.json` parse as JSON.
- Calendar language keys used by code exist in every language file.
- Calendar timed-event labels are present in every bundled language JSON file.
- Calendar frontend required files exist.
- Static feature precheck covers create/update/delete, source-block jumping, keyboard navigation, keyboard shortcut metadata, live region metadata, today markers, keyboard view switching, read-only local view switching, double-click creation, quick-copy, occurrence replacement, this-and-future split, recurrence, recurring/occurrence event markers, event tooltips, event summary, search, event type filtering, active query result counts, search/filter clearing, direct date jumping, previous/next event jumping, previous/next event keyboard shortcuts, view switching, drag/drop, timed resize, and all-day duration resize terms.
- Backend transaction dispatcher, calendar operation helpers, and calendar backend test names are covered by `scripts/calendar-audit.mjs`.
- Read-only guards, direct update error reporting, event dialog validation feedback, and report/manual-smoke markers are covered by `scripts/calendar-audit.mjs`.
- Calendar SCSS selectors for container, focus-visible ring, responsive toolbar wrapping, event summary, month grid, event pill, recurrence marker, resize controls, recurrence controls, week, day, and list views are covered by `scripts/calendar-audit.mjs`.
- Recurrence and normalization guards for `None`, strict `UNTIL`, duplicate parts, weekly `BYDAY`, count/until limits, exception parsing, and invalid end-date clamping are covered by `scripts/calendar-audit.mjs`.
- Calendar transaction guards for date/time validation, no-op updates, undo snapshots, metadata undo defaults, occurrence exceptions, this-and-future split, delete restore, and occurrence replacement operation ordering are covered by `scripts/calendar-audit.mjs`.
- Calendar field-mapping guards for duplicate metadata fields, allowed field types, stale mapping filtering, partial backend merge, mapping clear, and color mapping type handling are covered by `scripts/calendar-audit.mjs`.
- Calendar render-flow guards for empty date-field setup, date-field creation, month/week/day/schedule modes, today markers, keyboard navigation, keyboard shortcut metadata, live region metadata, keyboard view switching, read-only local view switching, event tooltips, event summary, double-click creation, duplicate/quick-copy one-off behavior, schedule drag/drop targets, search rerendering, event type filtering, active query result count, search/filter clearing, direct date jumping, previous/next event jumping and no-match feedback, week-start range calculation, editable event lookup, and drag/drop date offsets are covered by `scripts/calendar-audit.mjs`.
- Backend `_attrView.calendar` language coverage is checked for every bundled language JSON file.
- `scripts/calendar-kernel-smoke.mjs` builds an isolated FTS5 kernel, creates a temporary notebook/document/AV, switches it to Calendar, maps date/recurrence/exception/location/description/color fields, inserts a timed event with metadata, renders the Calendar API payload, and verifies the event date and mapped metadata values appear.
- `scripts/calendar-recurrence-smoke.mjs` transpiles the Calendar normalization modules into an isolated temporary app directory, runs `getCalendarFieldMapping` and `normalizeCalendarEvents`, and verifies weekly recurrence, weekly `BYDAY`, exception skipping, `None`, occurrence metadata, base exception parsing, and mapped metadata preservation.
- `scripts/calendar-transactions-smoke.mjs` transpiles the Calendar transaction modules with an isolated transaction stub and verifies create, update, delete, single occurrence deletion, single occurrence replacement, this-and-future split, invalid date rejection, invalid end-time clamping, metadata writes, recurrence `None` normalization, exception sorting, split `COUNT` reduction, and undo payloads.
- `scripts/calendar-electron-launch-smoke.mjs` builds or reuses the ignored local desktop kernel binary, starts an isolated kernel on port 6806 with a temporary workspace, maps the desktop build output to Electron's local `/stage/build/app/` dev URL when needed, opens the Electron desktop shell under isolated `HOME` / `XDG_CONFIG_HOME`, and verifies through Chromium remote debugging that the SiYuan app shell exposes `window.siyuan`, layout DOM, and `window.openFileByURL`.

Isolated launch smoke also passed without touching the real note vault:

- Built a local kernel with `CGO_ENABLED=1 go build -tags fts5 -o SiYuan-Kernel .`.
- Started the kernel with `--workspace /tmp/siyuan-calendar-smoke-* --wd app --mode dev --lang zh_CHT`.
- Verified `/api/system/version` returned `3.6.5` and `/api/system/bootProgress` reached `100`.
- Started the desktop Electron shell under `xvfb-run` with isolated `HOME`, isolated `XDG_CONFIG_HOME`, the temporary workspace, and the already-running kernel on `127.0.0.1:6806`.
- Electron remained running until the scripted timeout; no startup crash was observed after applying the local `--no-sandbox --disable-gpu --ozone-platform=x11` smoke flags needed by this Linux sandbox.
- The temporary kernel binary was removed after smoke verification.
- Added repeatable `node scripts/calendar-kernel-smoke.mjs` coverage for the Calendar API setup and mapped metadata path.
- Added repeatable `node scripts/calendar-electron-launch-smoke.mjs` coverage for the isolated Electron desktop launch path.
- A CDP attempt to open a generated Calendar AV document from the isolated Electron shell showed `window.openFileByURL` can request the document and the fixture notebook appears in the file tree, but the editor remained on the built-in user guide in this sandbox. That is not counted as completed Calendar UI interaction coverage.

Known build warnings:

- Webpack reports existing bundle/entrypoint size warnings for the desktop build.

## Unresolved / Manual Verification Required

The following still need an actual SiYuan UI smoke run before marking the rebuild complete:

- Perform the interactive Calendar smoke against an isolated workspace or an explicit throwaway user workspace; do not use `/home/eloklam/SiYuan`.
- Switch Table/Gallery/Kanban to Calendar and confirm no crash.
- Narrow panes keep Calendar toolbar controls usable without incoherent overlap.
- Keyboard focus on the Calendar surface is visibly indicated.
- Calendar without a date field shows setup UI.
- Selecting an existing date field renders events.
- Creating a date field from empty Calendar works and can be undone.
- Creating, editing, duplicating, and deleting events refreshes the Calendar.
- Opening an existing event from the dialog jumps to the source block.
- Double-clicking empty day areas opens a new event dialog for that date.
- Quick-copying an event creates an independent next-day event.
- Editing date, end date, all-day, start/end time, title, location, description, recurrence, and color persists correctly.
- Event hover/accessibility text shows full date/time and mapped metadata.
- Drag move and resize persist correctly.
- Schedule mode day rows accept dropped events.
- Recurring event expansion is visible; `None` does not create recurrence.
- Recurring series and occurrence markers appear on event pills.
- Editing an occurrence without exception mapping warns that the whole series will be edited.
- Deleting a single occurrence writes an exception.
- Editing a single occurrence creates a replacement event.
- This-and-future split truncates the old series and creates the new series.
- Search filters expected events.
- Event type filtering narrows to timed, all-day, and recurring events as expected.
- Search/filter result count and clear button update correctly.
- Event summary reflects current visible/filter result counts.
- Jumping to a specific date updates the visible range.
- Previous/next event controls jump to the nearest matching event date and respect active search/filter state.
- Previous/next event controls show feedback when no matching event exists.
- Keyboard navigation shortcuts update the visible range, jump between events, switch views, open new events, focus search, and clear search.
- Calendar shortcut controls expose `aria-keyshortcuts`.
- Calendar title and event summary update through polite live regions.
- Today is visibly marked in month, week, day, and schedule modes.
- Month, week, day, and schedule modes are usable.
- Week start changes affect visible week ranges.
- Read-only/query embed views do not mutate data, while still allowing local Calendar mode switching.
- Read-only/query embed events can still be opened for inspection without mutation controls.
- Switching back to Table/Gallery/Kanban preserves visible data.

## Next Commands

```sh
cd /home/eloklam/recovered-projects/SiYuan-recovered
git status --short
git diff --check
node scripts/calendar-audit.mjs
node scripts/calendar-kernel-smoke.mjs
node scripts/calendar-recurrence-smoke.mjs
node scripts/calendar-transactions-smoke.mjs
node scripts/calendar-electron-launch-smoke.mjs
cd kernel && go test -vet=off ./av ./model ./sql
cd ../app && corepack pnpm run build:desktop
```

After automated checks, run the manual smoke checklist above in the SiYuan UI.
