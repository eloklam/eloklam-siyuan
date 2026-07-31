#!/usr/bin/env node
import {readFileSync} from "node:fs";
import path from "node:path";

const root = process.cwd();
const eventDialog = readFileSync(path.join(root, "app/src/protyle/render/av/calendar/event-dialog.ts"), "utf8");
const scss = readFileSync(path.join(root, "app/src/assets/scss/business/_av.scss"), "utf8");

const fail = (message) => {
  console.error(`calendar recurrence scope smoke failed: ${message}`);
  process.exit(1);
};
const assert = (condition, message) => {
  if (!condition) fail(message);
};

assert(eventDialog.includes("type CalendarRecurrenceScope"), "missing explicit recurrence scope type");
assert(eventDialog.includes("openRecurrenceScopeDialog"), "missing reusable recurrence scope dialog");
assert(eventDialog.includes("calendar-scope-${item.scope}"), "missing recurrence scope option data types");
assert(eventDialog.includes('scope: "occurrence"'), "missing occurrence scope option");
assert(eventDialog.includes('scope: "future"'), "missing this-and-future scope option");
assert(eventDialog.includes('scope: "series"'), "missing series scope option");
assert(eventDialog.includes('options.action === "delete" ?') && eventDialog.includes('calendarRecurrenceScopeSeries || "All events"'),
  "edit scope must use All events while delete scope keeps Delete series");
assert(eventDialog.includes("getDisabledRecurrenceScopes"), "missing disabled scope matrix helper");
assert(eventDialog.includes("mapping.exceptionFieldID") && eventDialog.includes("calendarRecurrenceScopeOccurrenceDisabled"), "occurrence scope must require mapped exception field with visible reason");
assert(eventDialog.includes("mapping.recurrenceFieldID") && eventDialog.includes("calendarRecurrenceScopeFutureDisabled"), "future scope must require mapped recurrence field with visible reason");
assert(eventDialog.includes("runRecurringEventAction"), "recurring edit/delete must route through scope selection");
assert(eventDialog.includes("CalendarRecurrenceScope") && eventDialog.includes("saveEventWithScope"), "save flow must accept selected recurrence scope");
assert(eventDialog.includes("deleteEventWithScope"), "delete flow must accept selected recurrence scope");
assert(!/data-type=\"event-save-future\"/.test(eventDialog), "direct this-and-future action should not bypass scope dialog");

const runRecurringEventAction = eventDialog.match(/const runRecurringEventAction[\s\S]*?\n};/);
assert(runRecurringEventAction, "missing recurring action router implementation");
assert(runRecurringEventAction[0].includes("isRecurringSourceEvent"), "root/source recurring event path must be detected before edit/delete");
assert(!runRecurringEventAction[0].includes("if (!options.event?.isOccurrence) {\n        run(\"series\")"), "root/source recurring event must not silently run whole-series edit/delete");
assert(runRecurringEventAction[0].includes("openRecurrenceScopeDialog"), "recurring root/source edit/delete must open the recurrence scope dialog");
assert(eventDialog.includes("calendarRecurrenceScopeRootOccurrenceDisabled"), "root/source recurrence scope dialog must truthfully disable unsupported single-occurrence root edit/delete");
assert(eventDialog.includes("calendarRecurrenceScopeRootFutureDisabled"), "root/source recurrence scope dialog must truthfully disable unsupported this-and-future root edit/delete");

assert(scss.includes("&-scope") && scss.includes("&-scope-option"), "missing recurrence scope dialog styles");

console.log("calendar recurrence scope smoke passed: recurring edit/delete scope matrix present");
