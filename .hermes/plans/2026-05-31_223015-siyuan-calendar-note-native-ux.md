# SiYuan Calendar Note-Native UX Implementation Plan

> **For Hermes:** Use Kanban to execute this plan from `/home/eloklam/Schreibtisch/Apps/SiYuan-Calender`. Default route: one bounded `fixer` implementation card per phase; `oracle` review only after P0 milestone or if a phase touches backend transaction semantics. Do **not** turn this into a Google Calendar clone.

**Goal:** Turn the current SiYuan Calendar from a technically-present AV calendar into a usable note-taking calendar: notes/blocks/AV rows should be easy to place in time, edit safely, and jump back to their source.

**Architecture:** Keep Calendar as a SiYuan-native Attribute View calendar. Use Google Calendar only as an interaction-quality reference for fast time operations, safe edits, recurrence clarity, and rollback feedback. Explicitly avoid team scheduling/productivity-suite features that do not fit a note-taking app.

**Tech Stack:** TypeScript + SCSS under `app/`; Go backend under `kernel/`; current active workspace `/home/eloklam/Schreibtisch/Apps/SiYuan-Calender`; branch `recover/calendar-view-from-recovery`.

---

## 0. Product scope correction

### In scope

SiYuan Calendar should support:

- Date/time view over SiYuan notes, blocks, and AV rows.
- Fast creation of calendar-linked notes/blocks/rows.
- Fast opening of the source note/block from a calendar item.
- Month / Week / Day / Schedule views that are readable and useful.
- Precise Day/Week time placement for timed items.
- All-day and multi-day note-linked items.
- Safe edit flows: no silent discard, clear save/failure feedback, rollback on failed transaction.
- Recurrence only insofar as it helps repeated note-linked calendar items.
- Search/filter over SiYuan content and AV fields.

### Explicitly out of scope

Do **not** implement these unless Enoch explicitly reopens scope:

- Event taxonomy copied from Google Calendar: focus time, OOO, working location, appointment type, etc.
- Guests, RSVP, invitations, attendee side effects, propose new time.
- Privacy/permission systems beyond existing SiYuan/AV read-only constraints.
- Calendar list, subscriptions, external calendars.
- Reminders/notifications.
- Rooms/resources.
- Attachments/conferencing.
- Appointment scheduling / booking pages.

### How to use the Google Calendar UX pack

Use it as a benchmark for **interaction quality**, not feature parity:

- Click/drag time should create the expected time range.
- Editing must be safe and reversible.
- Recurrence actions must explain their scope.
- Dense views must remain readable.
- Save/failure state must be visible.

---

## 1. Current context / assumptions

### Existing implementation areas

Already present from recovery:

- Calendar renderer: `app/src/protyle/render/av/calendar/render.ts`
- Event dialog: `app/src/protyle/render/av/calendar/event-dialog.ts`
- Transactions: `app/src/protyle/render/av/calendar/transactions.ts`
- Normalization: `app/src/protyle/render/av/calendar/normalize.ts`
- Recurrence parser/expander: `app/src/protyle/render/av/calendar/recurrence.ts`
- Mapped fields: `app/src/protyle/render/av/calendar/mapped-fields.ts`
- Calendar model/types: `app/src/protyle/render/av/calendar/model.ts`
- AV layout integration: `app/src/protyle/render/av/layout.ts`
- AV renderer integration: `app/src/protyle/render/av/render.ts`
- Calendar SCSS: `app/src/assets/scss/business/_av.scss`
- Backend AV calendar settings/validation: `kernel/model/attribute_view.go`
- Smoke scripts: `scripts/calendar-*.mjs`

### Known working checks from prior handoff/prep

Already seen passing in this session/handoff context:

```bash
git diff --check
node scripts/calendar-audit.mjs
node scripts/calendar-recurrence-smoke.mjs
node scripts/calendar-transactions-smoke.mjs
```

Heavy checks documented but not freshly rerun in the UX task:

```bash
cd kernel && go test -vet=off ./av ./model ./sql
cd app && corepack pnpm run build:desktop
```

### Important safety rules

- Do not touch `/home/eloklam/SiYuan`.
- Use isolated/throwaway SiYuan workspaces for manual/Electron testing.
- Do not access `/mnt/recoveryssd` or `/media/eloklam/Extreme SSD`.
- Do not read/print secrets or `.env` values.
- No push/merge/deploy/destructive reset without explicit approval.

---

## 2. Proposed approach

Build the note-native UX in small vertical slices, but keep the full roadmap visible so future agents do not "forget" later phases.

Roadmap layers:

1. **P0 Core trust loop:** precise time placement, quick creation, source-note linking, safe edit, rollback, recurrence scope.
2. **P1 Readability and note-native polish:** dense Month/Week/Day/Schedule readability, better empty states, source affordances.
3. **P2 AV mapping and data model polish:** make Date/Time/Title/Description/Color/Recurrence/Source mapping clear and robust.
4. **P3 Note/block creation semantics:** decide and implement whether calendar create makes an AV row, block, document, or chosen target.
5. **P4 Navigation/search/filter:** make Calendar a useful way to find and navigate time-linked notes.
6. **P5 Mobile/keyboard/accessibility:** make the same core flows usable without desktop hover/mouse precision.
7. **P6 Quality gates and visual regression:** automate the note-calendar workflows so future changes do not silently break them.
8. **P7 Optional future polish:** only SiYuan-native extensions that strengthen note-time work; still no Google collaboration clone.

Do not start with advanced Google Calendar features. Delete scope before adding scope.

---

## 3. Step-by-step plan

## Phase P0.1 — Day/Week time grid + slot-time create

**Objective:** In Day and Week views, clicking a visible time slot should create a calendar draft with the exact clicked date/time.

**Files likely to change:**

- Modify: `app/src/protyle/render/av/calendar/render.ts`
- Modify: `app/src/assets/scss/business/_av.scss`
- Possibly modify: `app/src/protyle/render/av/calendar/model.ts`
- Test/extend: `scripts/calendar-electron-document-flow-smoke.mjs` or add a focused script under `scripts/calendar-*.mjs`

### Task 1: Identify existing Day/Week render boundaries

**Objective:** Locate the exact functions rendering Day and Week DOM and their event-binding paths.

**Read-only commands:**

```bash
rtk grep "renderWeek\|renderDay\|bindCalendarEvents\|data-date\|data-start" app/src/protyle/render/av/calendar/render.ts
```

**Expected result:** Names/sections for Week/Day rendering and click/drop handlers are identified.

### Task 2: Add a time-slot helper

**Objective:** Centralise time slot generation so Week and Day views use identical slot semantics.

**Implementation direction:**

Add or embed helper near Calendar render helpers:

```ts
const SLOT_MINUTES = 30;
const DAY_START_HOUR = 0;
const DAY_END_HOUR = 24;

const buildTimeSlots = () => {
  const slots = [];
  for (let minutes = DAY_START_HOUR * 60; minutes < DAY_END_HOUR * 60; minutes += SLOT_MINUTES) {
    slots.push({
      minutes,
      label: formatSlotLabel(minutes),
    });
  }
  return slots;
};
```

Prefer 30-minute slots for first pass. Do not add user preferences yet.

### Task 3: Render Week/Day timed grid rows

**Objective:** Week/Day timed events appear against a visible time grid, not just as loose day cards.

**Implementation direction:**

- Week view: columns = days, rows = time slots.
- Day view: one day column, same rows.
- All-day events stay separate from timed grid.
- Existing all-day/multi-day handling must not regress.
- Add `data-date`, `data-start`, and `data-end` to clickable slots.

Example DOM intent:

```html
<button class="av__calendar-time-slot" data-date="2026-06-01" data-start="14:00" data-end="14:30">
</button>
```

### Task 4: Bind slot click to create draft with exact time

**Objective:** Clicking Tuesday 14:00 opens create surface prefilled with Tuesday 14:00–14:30.

**Implementation direction:**

- In `bindCalendarEvents`, add handler for `.av__calendar-time-slot`.
- Build draft using clicked slot metadata.
- `allDay = false`.
- `start` and `end` reflect clicked slot.
- For now open existing `openEventDialog` if quick-create is not yet implemented.

**Acceptance:** Slot click must not default to generic `09:00` if the slot says `14:00`.

### Task 5: Style grid minimally

**Objective:** Make the grid readable without trying to clone Google Calendar.

**SCSS direction in `_av.scss`:**

- Add clear time labels.
- Add day columns.
- Add subtle horizontal slot lines.
- Add current day highlight if already easy.
- Avoid over-designing.

### Task 6: Add targeted verification

**Objective:** Prove slot click produces exact start/end in the draft.

**Preferred verification:** Extend existing Electron smoke with a CDP click/evaluate check, or add a focused script:

```bash
node scripts/calendar-electron-document-flow-smoke.mjs
```

If adding a new script, name it narrowly:

```text
scripts/calendar-time-grid-smoke.mjs
```

**Expected checks:**

- Switch to Week view.
- Click a known slot.
- Assert create dialog/draft has expected date and start time.

**Commit:**

```bash
git add app/src/protyle/render/av/calendar/render.ts app/src/assets/scss/business/_av.scss scripts/calendar-time-grid-smoke.mjs
git commit -m "feat(calendar): add precise time slots to day and week views"
```

---

## Phase P0.2 — Quick-create popover for note-linked calendar items

**Objective:** Create a fast path for common note-calendar creation: click slot, type title, save.

**Files likely to change:**

- Create: `app/src/protyle/render/av/calendar/quick-create.ts`
- Modify: `app/src/protyle/render/av/calendar/render.ts`
- Modify: `app/src/protyle/render/av/calendar/event-dialog.ts`
- Modify: `app/src/protyle/render/av/calendar/transactions.ts` only if creation payload needs adjustment
- Modify: `app/src/assets/scss/business/_av.scss`

### Task 1: Define quick-create responsibility

**Objective:** Keep quick-create tiny; do not duplicate full editor.

Quick-create fields:

- Title
- Date/start/end inherited from clicked slot
- All-day toggle if invoked from all-day lane/month day
- Save
- Cancel
- More options

Not in quick-create:

- Recurrence editor
- Metadata mapping details
- Advanced fields
- Any guest/reminder/calendar-list feature

### Task 2: Add quick-create module

**Objective:** Encapsulate quick-create DOM and callbacks.

Skeleton direction:

```ts
export interface IQuickCreateOptions {
  target: HTMLElement;
  draft: ICalendarEventDraft;
  onSave: (draft: ICalendarEventDraft) => Promise<void>;
  onMoreOptions: (draft: ICalendarEventDraft) => void;
  onCancel: () => void;
}

export const openQuickCreate = (options: IQuickCreateOptions) => {
  // render popover near slot
  // autofocus title
  // save on Enter / button
  // close on Escape if not dirty, confirm if dirty later if needed
};
```

Use existing naming/style conventions from `event-dialog.ts`.

### Task 3: Wire slot click to quick-create

**Objective:** Slot click opens quick-create instead of full event dialog.

Fallback rule:

- “More options” opens `openEventDialog` with the same draft.
- If quick-create cannot save because required AV date field is missing, show the existing date-field setup state.

### Task 4: Implement title autofocus and keyboard basics

**Objective:** Fast create is keyboard-friendly.

Acceptance:

- After click slot, title input is focused.
- Enter saves when title is non-empty.
- Escape cancels if clean.
- Empty title save is blocked with inline feedback.

### Task 5: Add quick-create styles

**Objective:** Popover feels native to SiYuan, not Google clone.

SCSS direction:

- Small floating panel.
- Clear title input.
- Date/time summary line.
- Save / More options / Cancel buttons.
- Works in narrow panes.

### Task 6: Verification

Manual:

```text
Week view → click 14:00 slot → title focused → type "Meet Prof notes" → Enter → chip appears at 14:00 → open chip → source block/note opens or editor opens with source action.
```

Automated preferred:

```bash
node scripts/calendar-time-grid-smoke.mjs
node scripts/calendar-audit.mjs
```

**Commit:**

```bash
git add app/src/protyle/render/av/calendar/quick-create.ts app/src/protyle/render/av/calendar/render.ts app/src/assets/scss/business/_av.scss scripts/calendar-time-grid-smoke.mjs
git commit -m "feat(calendar): add quick create for note calendar items"
```

---

## Phase P0.3 — Make source note/block linking first-class

**Objective:** Calendar items must clearly belong to SiYuan content, with an obvious way to open the source note/block.

**Files likely to change:**

- Modify: `app/src/protyle/render/av/calendar/render.ts`
- Modify: `app/src/protyle/render/av/calendar/event-dialog.ts`
- Modify: `app/src/protyle/render/av/calendar/model.ts`
- Possibly modify: `app/src/protyle/render/av/calendar/normalize.ts`
- Modify: `app/src/assets/scss/business/_av.scss`

### Task 1: Audit current source metadata

**Objective:** Confirm current event shape exposes `sourceCard`, block ID, and title source.

Read-only command:

```bash
rtk grep "sourceCard\|blockID\|openEventBlock\|openFileByURL" app/src/protyle/render/av/calendar app/src/protyle/render/av/render.ts
```

### Task 2: Add visible “open source” affordance to item/details

**Objective:** User sees that a calendar item is a note/block-backed object.

Implementation direction:

- Event chip may show a small note/block icon when source exists.
- Details popover/dialog has primary or secondary “Open note/block” action.
- Do not bury this behind advanced menu.

### Task 3: Quick-create source behaviour

**Objective:** Decide and implement one MVP source strategy.

Preferred MVP:

- Quick-create creates/updates an AV row or block-backed item using existing transaction path.
- The created item has a source that opens correctly.

If existing AV model cannot create a new note/block directly, MVP alternative:

- Quick-create creates AV item/card and “Open source” opens the created AV/card context.
- Plan a later phase for “create linked document/block”.

Do not invent a separate calendar-only event store.

### Task 4: Verification

Manual:

```text
Create item from slot → click item → click Open source → SiYuan opens the relevant note/block/AV row context.
```

Automated:

- Extend Electron smoke to assert `openFileByURL` or source action exists.

**Commit:**

```bash
git add app/src/protyle/render/av/calendar/render.ts app/src/protyle/render/av/calendar/event-dialog.ts app/src/protyle/render/av/calendar/model.ts app/src/protyle/render/av/calendar/normalize.ts app/src/assets/scss/business/_av.scss
git commit -m "feat(calendar): make source note links first-class"
```

---

## Phase P0.4 — Safe edit and unsaved-change guard

**Objective:** No silent discard. Editing a calendar note item should feel safe.

**Files likely to change:**

- Modify: `app/src/protyle/render/av/calendar/event-dialog.ts`
- Possibly modify: `app/src/protyle/render/av/calendar/quick-create.ts`
- Modify: `app/src/assets/scss/business/_av.scss` if confirmation UI needs styling

### Task 1: Add dirty tracking to full event dialog

**Objective:** Know whether user changed any field after open.

Implementation direction:

- Capture initial serialized draft.
- On input/change, compare current serialized draft.
- Keep it local to dialog.

### Task 2: Guard cancel/close/Escape

**Objective:** If dirty, ask before discarding.

Acceptance:

- Clean cancel closes immediately.
- Dirty cancel asks: discard changes / keep editing.
- Escape follows same rule.

Use existing SiYuan dialog/confirm conventions if present. Do not add browser `confirm()` unless project already uses it for similar UI.

### Task 3: Preserve draft on failed save

**Objective:** Failed save should leave user input intact.

Implementation direction:

- Disable save while pending.
- If save fails, show clear message and keep dialog open.
- Do not reset fields.

### Task 4: Verification

Manual:

```text
Open event → edit title → press Escape → discard confirmation appears → choose keep editing → edited title still there.
Open event → force save failure → message appears → dialog remains with edited values.
```

Automated:

- DOM-level test if available; otherwise Electron smoke extension.

**Commit:**

```bash
git add app/src/protyle/render/av/calendar/event-dialog.ts app/src/protyle/render/av/calendar/quick-create.ts app/src/assets/scss/business/_av.scss
git commit -m "fix(calendar): guard unsaved event edits"
```

---

## Phase P0.5 — Transaction state and rollback feedback

**Objective:** Drag/drop, resize, create, edit, delete should visibly succeed or fail; failed operations should not leave misleading UI state.

**Files likely to change:**

- Modify: `app/src/protyle/render/av/calendar/render.ts`
- Modify: `app/src/protyle/render/av/calendar/event-dialog.ts`
- Modify: `app/src/protyle/render/av/calendar/transactions.ts`
- Modify: `app/src/assets/scss/business/_av.scss`

### Task 1: Inventory transaction call sites

**Objective:** Find every place the UI submits calendar operations.

Read-only command:

```bash
rtk grep "createCalendarEvent\|updateCalendarEvent\|deleteCalendarEvent\|performTransactions\|transaction" app/src/protyle/render/av/calendar
```

### Task 2: Add local pending state for event interactions

**Objective:** Prevent duplicate submit and show operation state.

Implementation direction:

- Disable relevant buttons while saving.
- Add `aria-busy` or class state to affected event/dialog.
- Use SiYuan-style message text for success/failure.

### Task 3: Rollback visible UI on failed drag/resize

**Objective:** User never sees a moved/resized item as saved if transaction failed.

Implementation direction:

- Keep pre-operation event data.
- Only commit UI state after transaction success, or immediately re-render from source on failure.
- Failure message should say what happened: “Move failed; event restored.”

### Task 4: Verification

Manual:

```text
Trigger failed move/edit → old chip position restored → message explains failure → no duplicate submit.
```

Automated:

- Mock/stub transaction failure in smoke or unit-level helper if possible.

**Commit:**

```bash
git add app/src/protyle/render/av/calendar/render.ts app/src/protyle/render/av/calendar/event-dialog.ts app/src/protyle/render/av/calendar/transactions.ts app/src/assets/scss/business/_av.scss
git commit -m "fix(calendar): show transaction state and rollback failed edits"
```

---

## Phase P0.6 — Recurrence scope for note-linked repeated items

**Objective:** If recurrence is supported, every destructive or mutating recurring action must ask the user which scope they mean.

**Files likely to change:**

- Modify: `app/src/protyle/render/av/calendar/event-dialog.ts`
- Modify: `app/src/protyle/render/av/calendar/transactions.ts`
- Modify: `app/src/protyle/render/av/calendar/recurrence.ts` only if required by missing scope semantics
- Modify: `app/src/assets/scss/business/_av.scss`

### Task 1: Define supported scope matrix

**Objective:** Be honest about what current AV fields can support.

Supported target matrix:

| Action | One occurrence | This and following | Entire series |
|---|---:|---:|---:|
| Edit | yes if exception/replacement field exists | yes if split supported | yes |
| Delete | yes if exception field exists | maybe split/delete future | yes |
| Drag/resize | yes if exception/replacement supported | maybe split | yes |

If required mapped field is missing, disable option and explain.

### Task 2: Add a reusable recurrence scope dialog

**Objective:** One UI for edit/delete/drag/resize recurrence scope.

Implementation direction:

```ts
export type CalendarRecurrenceScope = "occurrence" | "future" | "series";

export const openRecurrenceScopeDialog = (options: {
  action: "edit" | "delete" | "move" | "resize";
  disabledScopes?: Partial<Record<CalendarRecurrenceScope, string>>;
  onSelect: (scope: CalendarRecurrenceScope) => void;
}) => { /* ... */ };
```

Can live in `event-dialog.ts` first if small; extract later if it grows.

### Task 3: Route recurring operations through scope dialog

**Objective:** No recurring edit/delete/move happens without explicit scope.

Acceptance:

- Non-recurring item: no scope dialog.
- Recurring item: scope dialog appears.
- Unsupported scope: visible disabled reason.

### Task 4: Verification

Manual:

```text
Create weekly item → edit second occurrence → scope dialog appears.
Choose occurrence → only that occurrence changes.
Choose series → base series changes.
Missing exception field → occurrence option disabled with reason.
```

Automated:

```bash
node scripts/calendar-recurrence-smoke.mjs
node scripts/calendar-transactions-smoke.mjs
```

**Commit:**

```bash
git add app/src/protyle/render/av/calendar/event-dialog.ts app/src/protyle/render/av/calendar/transactions.ts app/src/protyle/render/av/calendar/recurrence.ts app/src/assets/scss/business/_av.scss
git commit -m "feat(calendar): require scope for recurring note edits"
```

---

## Phase P1 — Readability and SiYuan-native polish

**Objective:** After P0 trust flows work, improve dense readability and note-oriented navigation.

**Files likely to change:**

- Modify: `app/src/protyle/render/av/calendar/render.ts`
- Modify: `app/src/protyle/render/av/calendar/normalize.ts`
- Modify: `app/src/assets/scss/business/_av.scss`
- Possibly modify: `app/src/protyle/render/av/calendar/mapped-fields.ts`

### Candidate tasks

1. Improve event chip layout for dense Month view.
2. Improve Week/Day overlap layout enough that items do not hide each other.
3. Add stronger source-note icon/label patterns.
4. Improve empty states:
   - no date field configured
   - no calendar items
   - search/filter no results
5. Improve Schedule view as the best narrow/mobile fallback.
6. Make search/filter SiYuan-native:
   - title/content
   - AV mapped fields
   - recurrence/all-day/timed filters only if they help notes

**Commit examples:**

```bash
git commit -m "style(calendar): improve dense month readability"
git commit -m "feat(calendar): improve schedule view for note navigation"
```

---

## Phase P2 — AV mapping and data model polish

**Objective:** Make Calendar setup understandable and resilient when notes/AV rows use different field names and types.

**Why this matters:** SiYuan users will not think in “event objects”. They will think: “This database has a date column; show it as calendar.” Mapping must be obvious, forgiving, and recoverable.

**Files likely to change:**

- Modify: `app/src/protyle/render/av/calendar/mapped-fields.ts`
- Modify: `app/src/protyle/render/av/calendar/model.ts`
- Modify: `app/src/protyle/render/av/calendar/normalize.ts`
- Modify: `app/src/protyle/render/av/layout.ts`
- Modify: `kernel/model/attribute_view.go` only if backend validation/settings need extension
- Modify: `app/appearance/langs/*.json` if labels/errors change

### P2 tasks

1. **Clarify required vs optional fields**
   - Required: date field.
   - Optional: title source, time/duration if separate, description, location, color, recurrence, exception, source block/document reference.
   - UI should not imply unsupported Google-like fields.

2. **Improve setup empty state**
   - If no date field: show exact next action.
   - If date field exists but no calendar items: explain how notes/rows become calendar items.
   - If mapped field type is invalid: show which field is invalid and what types are accepted.

3. **Validate stale/deleted mappings gracefully**
   - If mapped field disappeared, do not break render.
   - Show a repair affordance in layout settings.
   - Keep existing valid mappings.

4. **Strengthen title/source fallback**
   - Title priority should be predictable: mapped title field if added later → AV card title/block title → fallback “Untitled”.
   - Source action should still work even when title is fallback.

5. **Add mapping smoke coverage**
   - Build mock rows with missing optional fields, stale mapping IDs, invalid field type, and empty title.

**Verification ideas:**

```bash
node scripts/calendar-audit.mjs
node scripts/calendar-transactions-smoke.mjs
```

Manual:

```text
Create AV with date field only → Calendar works.
Delete mapped optional field → Calendar still renders; settings explain stale mapping.
Map invalid recurrence/description/color field → clear error or disabled option.
```

**Commit examples:**

```bash
git commit -m "fix(calendar): make field mapping repairable"
git commit -m "feat(calendar): clarify calendar setup states"
```

---

## Phase P3 — Note/block creation semantics

**Objective:** Decide and implement the core SiYuan-native create behaviour: when user creates from Calendar, what SiYuan object is created or updated?

**Why this matters:** This is the product centre. A note-taking calendar succeeds only if calendar items are meaningful notes/blocks/AV rows, not isolated pseudo-events.

**Files likely to change:**

- Modify: `app/src/protyle/render/av/calendar/quick-create.ts`
- Modify: `app/src/protyle/render/av/calendar/transactions.ts`
- Modify: `app/src/protyle/render/av/calendar/event-dialog.ts`
- Modify: `app/src/protyle/render/av/calendar/model.ts`
- Modify: `app/src/protyle/render/av/calendar/normalize.ts`
- Possibly modify backend AV transaction handling in `kernel/model/attribute_view.go`

### P3 decision options

Pick one MVP, do not implement all at once:

1. **AV-row-first MVP**
   - Calendar create creates an AV row/card in the current database.
   - Best if Calendar is strictly an Attribute View layout.
   - Fastest and least invasive.

2. **Block-first MVP**
   - Calendar create creates a block under a selected/current document and sets AV/date metadata.
   - Better note-native feel, but likely more integration complexity.

3. **Document-first MVP**
   - Calendar create creates a new document with date metadata.
   - Strong for daily/meeting notes, but may be too opinionated.

4. **User-choice later**
   - Quick-create default = AV row.
   - “More options” can later choose block/document target.

### Recommended first choice

Start with **AV-row-first MVP**, then add a clear source-open action. Do not block P0 on document creation design.

### P3 tasks

1. Document current creation behaviour in code comments/tests.
2. Ensure quick-create creates the same kind of source object consistently.
3. Add a post-create action: “Open source”.
4. Add support for optional “create note from item” only after AV-row-first works.
5. Add tests/smoke for create → open source → edit source title/date → calendar updates.

**Manual acceptance:**

```text
From Calendar slot, create “Project meeting notes”.
Open source.
Edit source note/row title/date.
Return Calendar; item reflects source change.
```

**Commit examples:**

```bash
git commit -m "feat(calendar): define av row creation flow"
git commit -m "feat(calendar): open source after calendar create"
```

---

## Phase P4 — Navigation, search, and filters for note workflows

**Objective:** Make Calendar useful as a navigation surface for time-linked notes, not just a display.

**Files likely to change:**

- Modify: `app/src/protyle/render/av/calendar/render.ts`
- Modify: `app/src/protyle/render/av/calendar/normalize.ts`
- Modify: `app/src/protyle/render/av/calendar/mapped-fields.ts`
- Modify: `app/src/assets/scss/business/_av.scss`

### P4 tasks

1. **Search by note title/content-derived title**
   - Search should match visible title and mapped text fields already loaded.
   - Avoid global full-text search unless explicitly scoped later.

2. **Filter by useful note-calendar facets**
   - Timed vs all-day.
   - Recurring vs one-off, if recurrence stays.
   - Has source / missing source, if such state can happen.
   - Mapped color/category only if it already exists in AV fields.

3. **Improve date navigation**
   - Today button must preserve current view.
   - Previous/next should keep selected anchor predictable.
   - Jump date should be keyboard-friendly.

4. **Add selected-date context**
   - When switching Month → Week/Day, keep the date user clicked/selected.
   - Avoid surprising jumps.

5. **Improve Schedule view as “note agenda”**
   - Group by date.
   - Show source note/block affordance.
   - Good fallback for narrow panes/mobile.

**Manual acceptance:**

```text
Search a note title → only matching calendar notes remain.
Click date in Month → switch to Day → same date opens.
Schedule view shows chronological note agenda with source open action.
```

**Commit examples:**

```bash
git commit -m "feat(calendar): improve note calendar search"
git commit -m "feat(calendar): preserve selected date across views"
```

---

## Phase P5 — Mobile, keyboard, and accessibility

**Objective:** Make core note-calendar flows usable without precise mouse/desktop hover.

**Files likely to change:**

- Modify: `app/src/protyle/render/av/calendar/render.ts`
- Modify: `app/src/protyle/render/av/calendar/event-dialog.ts`
- Modify: `app/src/protyle/render/av/calendar/quick-create.ts`
- Modify: `app/src/assets/scss/business/_av.scss`

### P5 tasks

1. **Keyboard navigation baseline**
   - Existing shortcuts should be discoverable and not conflict with editor shortcuts.
   - Add/fix focus states for toolbar, date cells, event chips, quick-create.

2. **Keyboard create/edit**
   - Enter on focused slot/item does expected action.
   - Escape closes popover/dialog with dirty guard.
   - Tab order is sane.

3. **ARIA labels and roles**
   - Calendar cells/slots expose date/time/title enough for screen readers.
   - Event chips/buttons have meaningful labels.

4. **Mobile/narrow layout**
   - Schedule view should be the safest fallback.
   - Quick-create and details should behave like a panel/bottom sheet when narrow.
   - No hover-only actions.

5. **Touch-friendly controls**
   - Minimum hit areas for chips, create buttons, resize/edit controls.
   - Drag optional; buttons/menu fallback required.

**Manual acceptance:**

```text
Narrow pane/mobile width → Schedule usable.
Keyboard only → navigate to slot/item, create/open/cancel safely.
Screen-reader labels are not generic “button button”.
```

**Commit examples:**

```bash
git commit -m "fix(calendar): improve keyboard calendar navigation"
git commit -m "style(calendar): improve narrow schedule layout"
```

---

## Phase P6 — Quality gates, visual regression, and maintainability

**Objective:** Prevent future Calendar changes from silently breaking note-time workflows.

**Files likely to change:**

- Modify/create: `scripts/calendar-*.mjs`
- Possibly create test fixtures under an existing scripts/test fixture location if present
- Modify: `CALENDAR_REBUILD_REPORT.md` only when verified behaviour or commands change

### P6 tasks

1. **Calendar time-grid smoke**
   - Verify Week/Day slot click passes exact date/time into create flow.

2. **Quick-create smoke**
   - Verify title autofocus, Enter save, More options preserves draft.

3. **Source-link smoke**
   - Verify create/open-source flow.

4. **Dirty-guard smoke**
   - Verify changed dialog asks before discard.

5. **Rollback smoke**
   - Simulate/force transaction failure and assert old state remains.

6. **Visual fixtures**
   - Dense Month.
   - Busy Week with overlap.
   - Day with all-day + timed notes.
   - Schedule narrow view.
   - Empty/setup/no-results states.

7. **Documentation update gate**
   - If behaviour changes, update `CALENDAR_REBUILD_REPORT.md` and/or handoff docs.
   - Do not update docs for speculative future work.

**Validation commands:**

```bash
git diff --check
node scripts/calendar-audit.mjs
node scripts/calendar-time-grid-smoke.mjs
node scripts/calendar-electron-document-flow-smoke.mjs
node scripts/calendar-recurrence-smoke.mjs
node scripts/calendar-transactions-smoke.mjs
cd app && corepack pnpm run build:desktop
cd ../kernel && go test -vet=off ./av ./model ./sql
```

**Commit examples:**

```bash
git commit -m "test(calendar): cover time-grid create flow"
git commit -m "test(calendar): cover calendar edit rollback"
```

---

## Phase P7 — Optional future SiYuan-native polish

**Objective:** Capture later ideas so they are not forgotten, while keeping them clearly non-P0 and non-Google-clone.

Only consider after P0-P6 are solid.

### P7 ideas

1. **Daily-note integration**
   - Calendar day click can open/create daily note if user chooses that mode.
   - Must respect existing SiYuan daily note conventions.

2. **Calendar-to-block backlink affordance**
   - Source note could show a backlink/reference to its calendar date metadata.
   - Avoid hidden duplicate state.

3. **Natural-language date extraction from notes**
   - Detect simple date/time text and offer to set calendar date.
   - Keep opt-in; no surprise mutation.

4. **Template support for created calendar notes**
   - Quick-create “new meeting note” can use a selected SiYuan template later.
   - Do not add guest/meeting invitation semantics.

5. **Better recurrence editor for notes**
   - Human-friendly repeat controls for repeated study/gym/admin notes.
   - Still stores in current recurrence mapping; no external calendar protocol.

6. **Timeline/agenda export**
   - Export selected date range of note-linked items to Markdown.
   - Useful for weekly review/study planning.

7. **Performance optimisation for large AVs**
   - Virtualise dense views or cache normalized events if large databases lag.
   - Only after measuring real slowness.

8. **User preference polish**
   - Week start already exists.
   - Later: default view, default timed duration, visible day hours.
   - Avoid adding settings before core flow works.

### Explicitly still out of scope in P7

Even in future polish, do not add:

- Guests/RSVP/invites.
- Room/resource booking.
- Conferencing.
- Appointment booking pages.
- External calendar subscriptions.
- Full privacy/permission system.

---

## 4. Files likely to change summary

Primary frontend:

- `app/src/protyle/render/av/calendar/render.ts`
- `app/src/protyle/render/av/calendar/event-dialog.ts`
- `app/src/protyle/render/av/calendar/transactions.ts`
- `app/src/protyle/render/av/calendar/model.ts`
- `app/src/protyle/render/av/calendar/normalize.ts`
- `app/src/protyle/render/av/calendar/recurrence.ts`
- `app/src/protyle/render/av/calendar/mapped-fields.ts`
- `app/src/assets/scss/business/_av.scss`

Likely new file:

- `app/src/protyle/render/av/calendar/quick-create.ts`

Integration context:

- `app/src/protyle/render/av/render.ts`
- `app/src/protyle/render/av/layout.ts`

Backend only if settings/validation shape changes:

- `kernel/model/attribute_view.go`
- `kernel/model/attribute_view_calendar_test.go`

Verification scripts:

- `scripts/calendar-audit.mjs`
- `scripts/calendar-recurrence-smoke.mjs`
- `scripts/calendar-transactions-smoke.mjs`
- `scripts/calendar-electron-document-flow-smoke.mjs`
- Potential new: `scripts/calendar-time-grid-smoke.mjs`

---

## 5. Tests / validation strategy

### Minimal per-phase validation

Run after any frontend calendar change:

```bash
git diff --check
node scripts/calendar-audit.mjs
```

Run when recurrence/transaction logic changes:

```bash
node scripts/calendar-recurrence-smoke.mjs
node scripts/calendar-transactions-smoke.mjs
```

Run when real renderer/document flow changes:

```bash
node scripts/calendar-electron-document-flow-smoke.mjs
```

Run before final P0 milestone handoff:

```bash
cd app && corepack pnpm run build:desktop
cd ../kernel && go test -vet=off ./av ./model ./sql
```

### Manual acceptance checklist for P0

Use an isolated workspace only.

- Week view: click Tuesday 14:00 → create surface opens with Tuesday 14:00–14:30.
- Quick-create: title input focused; type title; Enter saves; chip appears at correct time.
- More options: quick-create opens full editor without losing draft data.
- Source: click event → clear “open source note/block” action → opens correct SiYuan source.
- Dirty guard: edit title; Escape/cancel/outside close → discard confirmation appears; “keep editing” preserves input.
- Failed save: force transaction failure → clear message; input retained; old event restored.
- Recurrence: weekly repeated item edit/delete/drag → scope dialog appears; unsupported scopes explain why.
- Read-only view: create/drag/edit controls disabled or hidden.
- Dense view: Month/Week/Day readable enough to identify note titles and dates.

---

## 6. Risks, tradeoffs, and open questions

### Risks

- **Time-grid complexity:** Day/Week grid can easily turn into a large layout rewrite. Keep P0 simple: 30-minute rows, no timezone, no overlap perfection yet.
- **AV data model constraints:** Creating a calendar item may mean creating/updating AV rows, not standalone events. Do not invent a separate event database.
- **Recurrence complexity:** Existing parser/transactions support some recurrence semantics, but UI must not expose scopes that storage cannot safely support.
- **Build time:** Electron/manual checks can be slow/noisy. Use targeted scripts during phases, heavy checks at milestone.
- **User scope drift:** Google Calendar pack is tempting; do not add collaboration/calendar SaaS features.

### Tradeoffs

- Start with 30-minute slots instead of configurable granularity. Faster, enough for usability proof.
- Quick-create should be simple and narrow. Full editor remains for recurrence/metadata.
- Use SiYuan-native source linking as the differentiator instead of Google-like guests/reminders.
- Oracle review only after P0 milestone or risky transaction/backend changes, not after every tiny UI step.

### Open questions for Enoch

1. Should quick-create create a new AV row only, or should it optionally create a new document/block immediately?
2. What is the default timed event duration: 30 minutes or 60 minutes?
3. Should Month view create all-day items by default, while Week/Day slots create timed items?
4. Should source note open in current tab, new tab, or follow existing SiYuan behaviour?
5. Should recurrence be kept in P0, or delayed until after basic note-linked time grid feels good?

---

## 7. Recommended first execution card

If executing this plan next, start with one bounded fixer card:

```text
Title: implement P0.1 SiYuan Calendar day/week time-grid slot create
Assignee: fixer
Scope:
- Work only in /home/eloklam/Schreibtisch/Apps/SiYuan-Calender
- Implement Phase P0.1 from .hermes/plans/2026-05-31_223015-siyuan-calendar-note-native-ux.md
- Add precise Day/Week 30-minute slots and slot click -> exact date/time draft
- Avoid quick-create; use existing event dialog for first slice
Allowed:
- Modify render.ts and _av.scss
- Add/update one targeted smoke script if needed
Forbidden:
- No Google Calendar collaboration features
- No /home/eloklam/SiYuan
- No recovery drives
- No push/merge/deploy/destructive reset
Expected evidence:
- Changed paths
- Exact commands run
- Manual or automated proof that Tuesday 14:00 slot opens draft with 14:00 start
- Commit hash/message if committed
```

Suggested commit:

```bash
git commit -m "feat(calendar): add precise time slots to day and week views"
```
