#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const fail = (message) => {
  console.error(`calendar imported-event UX smoke failed: ${message}`);
  process.exit(1);
};
const assert = (condition, message) => {
  if (!condition) fail(message);
};

const timeGrid = read("app/src/protyle/render/av/calendar/time-grid.ts");
const render = read("app/src/protyle/render/av/calendar/render.ts");
const eventChip = read("app/src/protyle/render/av/calendar/event-chip.ts");
const eventDialog = read("app/src/protyle/render/av/calendar/event-dialog.ts");
const scss = read("app/src/assets/scss/business/_av.scss");

assert(timeGrid.includes("isMultiDayTimedEvent"), "timed multi-day events need an explicit classification");
assert(timeGrid.includes("belongsInAllDayLane"), "multi-day timed events must render once in the spanning lane");
assert(timeGrid.includes("!belongsInAllDayLane(event)"), "multi-day timed events must not be repeated in every timed day column");
assert(timeGrid.includes("options.expandAllDay"), "+x more must be able to reveal all hidden all-day lanes");
assert(timeGrid.includes('surface: "timed" | "all-day"'), "the grid must tell chip rendering which surface it occupies");

assert(render.includes('classList.contains("av__calendar-allday-more")'), "+x more needs a dedicated all-day expansion path");
assert(render.includes('dataset.calendarAllDayExpanded = "true"'), "+x more must persist expansion through the rerender");
assert(render.includes('classList.contains("av__calendar-allday-cell")'), "empty all-day cells need a create action");
assert(render.includes("startAllDayCreate"), "all-day empty-space creation must use one explicit entry point");

assert(!eventChip.includes("const recurrenceMarker"), "recurrence O/R tags must not be rendered beside event names");
assert(!eventChip.includes("av__calendar-event-dot"), "event names must not render a leading colour dot");
assert(eventChip.includes("export const getEventTimeLabel"), "event chips need one shared single-day and multi-day time label");
assert(eventChip.includes('!event.start.isSame(end, "day")'), "multi-day timed labels must detect different endpoint days");
assert(eventChip.includes("formatCalendarDate(event.start, dateOptions)"), "multi-day timed labels must include the start date");
assert(eventChip.includes("formatCalendarDate(end, dateOptions)"), "multi-day timed labels must include the end date");
assert(!eventChip.includes("multiDayPrefix"), "multi-day dates must belong to the time range instead of being prefixed to the title");
assert(!eventChip.includes('event.isOccurrence ? "O" : "R"'), "event chips must not expose internal O/R tags");
assert(!scss.includes("&-recurring"), "unused recurrence-tag styling must be removed");

const timedStyle = scss.match(/&--timed \{([\s\S]*?)\n    \}/)?.[1] || "";
assert(timedStyle.includes("background-color: var(--calendar-event-fill, var(--b3-theme-primary));"),
  "timed events must use the same complete colour fill as all-day events");
assert(timedStyle.includes("color: var(--b3-theme-on-primary);"),
  "timed event text must retain contrast on the complete colour fill");
assert(!timedStyle.includes("inset 3px 0 0"), "timed events must not restore the left accent bar");

assert(eventDialog.includes("calendarRecurrenceScopeSeries || \"All events\""), "edit scope needs a non-destructive All events label");
assert(eventDialog.includes('class="av__calendar-dialog-endpoint"'), "event editor must group each date with its matching time");
assert(eventDialog.includes('id="av-event-schedule"'), "event editor needs one endpoint-based schedule group");
assert(eventDialog.includes("av__calendar-dialog-schedule--all-day"), "all-day mode must hide time fields without separating endpoint dates");
assert(!eventDialog.includes('id="av-event-time-row"'), "event editor must not restore a detached time-only row");
assert(!eventDialog.includes('data-type="event-title-hint"'), "bound event titles must not repeat the rename-document hint below an existing title");
assert(eventDialog.includes('window.siyuan.languages.calendarRecurrence || "Recurrence"'), "recurrence row label must use the noun translation");
assert(eventDialog.includes('options.action === "delete" ?'), "delete and edit series labels must be distinct");
assert(eventDialog.includes("preset !== \"custom\""), "recurrence preset must override hidden custom controls");
assert(eventDialog.includes("getRecurrencePresetRule(preset)"), "Does not repeat must save an empty recurrence rule");

const langDir = path.join(root, "app/appearance/langs");
for (const file of fs.readdirSync(langDir).filter((item) => item.endsWith(".json"))) {
  const data = JSON.parse(fs.readFileSync(path.join(langDir, file), "utf8"));
  assert(typeof data.calendarRecurrenceScopeSeries === "string" && data.calendarRecurrenceScopeSeries.length > 0,
    `${file} missing calendarRecurrenceScopeSeries`);
}

console.log("calendar imported-event UX smoke passed");
