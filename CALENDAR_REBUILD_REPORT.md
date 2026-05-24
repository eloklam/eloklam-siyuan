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

## Implemented Functionality

- Calendar layout rendering from AV data.
- Month, week, day, and schedule views.
- Persistent calendar view mode.
- Configurable date field and week start.
- Empty calendar date-field setup and date-field creation.
- Event create, edit, delete, duplicate.
- Event date, end date, all-day, time, title, location, description, recurrence, exception, and color field handling.
- Drag move and timed resize for calendar events.
- Search over title, metadata, recurrence, dates, and times.
- Field mapping for recurrence, exception, location, description, and color.
- Color mapping for `select` and `mSelect` fields.
- Recurrence parsing and expansion for daily, weekly, monthly, and yearly rules.
- Recurrence `INTERVAL`, `COUNT`, `UNTIL`, weekly `BYDAY`, `None`, malformed-rule rejection, and strict date handling.
- Recurrence exceptions and occurrence deletion.
- Single occurrence replacement when exception mapping exists.
- This-and-future split for recurring series.
- Read-only and query-embed guards for calendar mutations.
- Backend validation for calendar date field, view mode, week start, and field mappings.
- Backend add/remove field synchronization for calendar fields and mappings.
- Language key coverage for all bundled language JSON files.

## Notable Hardening Commits

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
```

Also passed:

- All `app/appearance/langs/*.json` parse as JSON.
- Calendar language keys used by code exist in every language file.
- Calendar frontend required files exist.
- Static feature precheck covers create/update/delete, occurrence replacement, this-and-future split, recurrence, search, view switching, drag/drop, and resize terms.
- Backend transaction dispatcher, calendar operation helpers, and calendar backend test names are covered by `scripts/calendar-audit.mjs`.

Known build warnings:

- Webpack reports existing bundle/entrypoint size warnings for the desktop build.

## Unresolved / Manual Verification Required

The following still need an actual SiYuan UI smoke run before marking the rebuild complete:

- Switch Table/Gallery/Kanban to Calendar and confirm no crash.
- Calendar without a date field shows setup UI.
- Selecting an existing date field renders events.
- Creating a date field from empty Calendar works and can be undone.
- Creating, editing, duplicating, and deleting events refreshes the Calendar.
- Editing date, end date, all-day, start/end time, title, location, description, recurrence, and color persists correctly.
- Drag move and resize persist correctly.
- Recurring event expansion is visible; `None` does not create recurrence.
- Deleting a single occurrence writes an exception.
- Editing a single occurrence creates a replacement event.
- This-and-future split truncates the old series and creates the new series.
- Search filters expected events.
- Month, week, day, and schedule modes are usable.
- Week start changes affect visible week ranges.
- Read-only/query embed views do not mutate data.
- Switching back to Table/Gallery/Kanban preserves visible data.

## Next Commands

```sh
cd /home/eloklam/recovered-projects/SiYuan-recovered
git status --short
git diff --check
node scripts/calendar-audit.mjs
cd kernel && go test -vet=off ./av ./model ./sql
cd ../app && corepack pnpm run build:desktop
```

After automated checks, run the manual smoke checklist above in the SiYuan UI.
