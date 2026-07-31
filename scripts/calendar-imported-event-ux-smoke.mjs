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

assert(!eventChip.includes("const recurrenceMarker"), "recurrence O/R tags must be removed from event chips");
assert(!eventChip.includes('event.isOccurrence ? "O" : "R"'), "event chips must not expose internal O/R tags");
assert(!scss.includes("&-recurring"), "unused recurrence-tag styling must be removed");

const timedStyle = scss.match(/&--timed \{([\s\S]*?)\n    \}/)?.[1] || "";
assert(timedStyle.includes("background-color: var(--calendar-event-fill, var(--b3-theme-primary));"),
  "timed events must use the same complete colour fill as all-day events");
assert(timedStyle.includes("color: var(--b3-theme-on-primary);"),
  "timed event text must retain contrast on the complete colour fill");
assert(!timedStyle.includes("inset 3px 0 0"), "timed events must not restore the left accent bar");

assert(eventDialog.includes("calendarRecurrenceScopeSeries || \"All events\""), "edit scope needs a non-destructive All events label");
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
