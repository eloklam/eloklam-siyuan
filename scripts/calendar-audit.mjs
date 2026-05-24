#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const fail = (message) => {
  console.error(`calendar audit failed: ${message}`);
  process.exit(1);
};

const requiredFiles = [
  "app/src/protyle/render/av/calendar/model.ts",
  "app/src/protyle/render/av/calendar/normalize.ts",
  "app/src/protyle/render/av/calendar/recurrence.ts",
  "app/src/protyle/render/av/calendar/mapped-fields.ts",
  "app/src/protyle/render/av/calendar/transactions.ts",
  "app/src/protyle/render/av/calendar/render.ts",
  "app/src/protyle/render/av/calendar/event-dialog.ts",
];

for (const file of requiredFiles) {
  if (!exists(file)) {
    fail(`missing required file ${file}`);
  }
}

const frontendCode = Object.fromEntries(requiredFiles.map((file) => [file, read(file)]));
const joinedFrontendCode = Object.values(frontendCode).join("\n");

const expectedFeatureTerms = [
  "createCalendarEvent",
  "updateCalendarEvent",
  "deleteCalendarEvent",
  "createCalendarEventReplacingOccurrence",
  "updateCalendarEventThisAndFuture",
  "deleteCalendarOccurrence",
  "expandRecurrences",
  "parseRecurrence",
  "calendar-search",
  "calendar-mode",
  "calendar-drop-day",
  "calendar-resize",
];

const missingFeatureTerms = expectedFeatureTerms.filter((term) => !joinedFrontendCode.includes(term));
if (missingFeatureTerms.length > 0) {
  fail(`missing feature terms: ${missingFeatureTerms.join(", ")}`);
}

const languageCodeFiles = [
  "app/src/protyle/render/av/calendar/render.ts",
  "app/src/protyle/render/av/calendar/event-dialog.ts",
  "app/src/protyle/render/av/layout.ts",
];
const calendarLanguageKeys = new Set();
for (const file of languageCodeFiles) {
  const text = read(file);
  for (const match of text.matchAll(/window\.siyuan\.languages\.([A-Za-z0-9_]+)/g)) {
    if (match[1].startsWith("calendar")) {
      calendarLanguageKeys.add(match[1]);
    }
  }
}

const langDir = path.join(root, "app/appearance/langs");
for (const file of fs.readdirSync(langDir).filter((item) => item.endsWith(".json")).sort()) {
  const langPath = path.join(langDir, file);
  let data;
  try {
    data = JSON.parse(fs.readFileSync(langPath, "utf8"));
  } catch (error) {
    fail(`${file} is not valid JSON: ${error.message}`);
  }
  const missing = [...calendarLanguageKeys].filter((key) => !(key in data));
  if (missing.length > 0) {
    fail(`${file} missing language keys: ${missing.join(", ")}`);
  }
}

const renderEntry = read("app/src/protyle/render/av/render.ts");
if (!renderEntry.includes("renderCalendar") || !renderEntry.includes('data.viewType === "calendar"')) {
  fail("AV render entry does not dispatch calendar rendering");
}

const calendarRender = read("app/src/protyle/render/av/calendar/render.ts");
for (const term of [
  "hasClosestByAttribute(options.blockElement, \"data-type\", \"NodeBlockQueryEmbed\")",
  "hasClosestByAttribute(e, \"data-type\", \"NodeBlockQueryEmbed\")",
  "draggable=\"${editable ? \"true\" : \"false\"}\"",
  "${editable ? \"\" : \" disabled\"}",
  "showMessage(window.siyuan.languages._kernel[29])",
]) {
  if (!calendarRender.includes(term)) {
    fail(`calendar render missing read-only/error guard term: ${term}`);
  }
}

for (const term of [
  "renderDateFieldSetup",
  "calendar-empty-date-field",
  "calendar-create-date-field",
  "setAttrViewCalendarDateField",
  "addAttrViewCol",
  "renderMonth",
  "renderWeek",
  "renderDay",
  "renderList",
  "getSafeViewMode",
  "getVisibleRange",
  "getCalendarTitle",
  "eventMatchesSearch",
  "getCalendarSearch",
  "calendarSearch",
  "rerender(true, true)",
  "getSafeWeekStart",
  "startOfCalendarWeek",
  "weekStart",
  "dragOffsetDays",
  "displayDate",
  "buildDraftForDate",
  "getEditableEvent",
]) {
  if (!calendarRender.includes(term)) {
    fail(`calendar render flow missing ${term}`);
  }
}

const eventDialog = read("app/src/protyle/render/av/calendar/event-dialog.ts");
for (const term of [
  "showInvalidDraftMessage",
  "window.siyuan.languages.calendarNeedDateField",
  "window.siyuan.languages.invalid",
]) {
  if (!eventDialog.includes(term)) {
    fail(`event dialog missing validation feedback term: ${term}`);
  }
}

const recurrenceCode = read("app/src/protyle/render/av/calendar/recurrence.ts");
for (const term of [
  "str === \"NONE\"",
  "const supportedKeys = [\"FREQ\", \"INTERVAL\", \"COUNT\", \"UNTIL\", \"BYDAY\"]",
  "seenKeys.has(key)",
  "parseDateStrict",
  "until.endOf(\"day\")",
  "new Set(byDay).size !== byDay.length",
  "result.byDay?.length && result.freq !== \"WEEKLY\"",
  "event.recurrence.count && index >= event.recurrence.count",
  "event.recurrence.until && occurrenceStart.isAfter(event.recurrence.until)",
  "event.recurrenceExceptions?.includes(date.format(\"YYYY-MM-DD\"))",
]) {
  if (!recurrenceCode.includes(term)) {
    fail(`recurrence support missing ${term}`);
  }
}

const normalizeCode = read("app/src/protyle/render/av/calendar/normalize.ts");
for (const term of [
  "parseRecurrenceExceptions",
  "normalizeExceptionDate",
  "Array.from(new Set",
  "dateTimeMatch",
  "end.isBefore(start)",
]) {
  if (!normalizeCode.includes(term)) {
    fail(`calendar normalization missing ${term}`);
  }
}

const transactionsCode = read("app/src/protyle/render/av/calendar/transactions.ts");
for (const term of [
  "isRealDateInputValue(options.draft.date)",
  "getTimeInputValue",
  "end = start.add(1, \"hour\")",
  "JSON.stringify(options.oldValue) === JSON.stringify(options.newValue)",
  "undoEmptyWhenMissing",
  "buildOccurrenceExceptionOperations",
  "existing.sort()",
  "recurrenceWithUntil",
  "recurrenceForSplitFuture",
  "buildCreateEventOperations",
  "buildUpdateEventOperations",
  "buildDeleteEventOperations",
  "createCalendarEventReplacingOccurrence",
  "[...exceptionOps.doOperations, ...createOps.doOperations]",
  "[...createOps.undoOperations, ...exceptionOps.undoOperations]",
  "return true;",
]) {
  if (!transactionsCode.includes(term)) {
    fail(`calendar transactions missing ${term}`);
  }
}

const layoutCode = read("app/src/protyle/render/av/layout.ts");
for (const term of ["setAttrViewCalendarDateField", "setAttrViewCalendarWeekStart", "setAttrViewCalendarFieldMapping"]) {
  if (!layoutCode.includes(term)) {
    fail(`layout menu missing ${term}`);
  }
}
for (const term of [
  "validateCalendarMetadataMapping",
  "calendarDuplicateMetadataField",
  "buildOptions([\"text\", \"template\"], mapping.recurrenceFieldID)",
  "buildOptions([\"select\", \"mSelect\"], mapping.colorFieldID)",
  "item.value = previous[item.dataset.field",
]) {
  if (!layoutCode.includes(term)) {
    fail(`layout mapping guard missing ${term}`);
  }
}

const mappedFieldsCode = read("app/src/protyle/render/av/calendar/mapped-fields.ts");
for (const term of [
  "getMappedFieldID",
  "allowedTypes.includes(field.type)",
  "getMappedFieldID(calendarData, persisted.recurrenceFieldID, [\"text\", \"template\"])",
  "getMappedFieldID(calendarData, persisted.colorFieldID, [\"select\", \"mSelect\"])",
  "hasDateField: !!dateFieldID && calendarData.fields.some(field => field.id === dateFieldID && field.type === \"date\")",
]) {
  if (!mappedFieldsCode.includes(term)) {
    fail(`mapped field guard missing ${term}`);
  }
}

const transactionDispatcher = read("kernel/model/transaction.go");
for (const term of [
  "setAttrViewCalendarDateField",
  "setAttrViewCalendarViewMode",
  "setAttrViewCalendarWeekStart",
  "setAttrViewCalendarFieldMapping",
]) {
  if (!transactionDispatcher.includes(term)) {
    fail(`transaction dispatcher missing ${term}`);
  }
}

const backendCalendar = read("kernel/model/attribute_view.go");
for (const term of [
  "calendarDateFieldFromOperationData",
  "calendarViewModeFromOperationData",
  "calendarWeekStartFromOperationData",
  "calendarFieldMappingFromOperationData",
  "validateCalendarFieldMappingUnique",
  "validateCalendarMappingField",
  "av.KeyTypeSelect, av.KeyTypeMSelect",
  "removeCalendarFieldReferences",
]) {
  if (!backendCalendar.includes(term)) {
    fail(`backend calendar support missing ${term}`);
  }
}

const backendTests = read("kernel/model/attribute_view_calendar_test.go");
for (const term of [
  "TestCalendarDateFieldFromOperationData",
  "TestCalendarWeekStartFromOperationData",
  "TestCalendarViewModeFromOperationData",
  "TestCalendarFieldMappingFromOperationDataMergesExisting",
  "TestRemoveCalendarFieldReferences",
  "duplicate text metadata fields should be rejected",
  "color mapping may reuse text metadata field IDs",
  "empty update should clear only requested mapping",
]) {
  if (!backendTests.includes(term)) {
    fail(`backend calendar test missing ${term}`);
  }
}

const avStyles = read("app/src/assets/scss/business/_av.scss");
for (const term of [
  ".av__calendar",
  "&-toolbar",
  "&-month",
  "&-event",
  "&-resize",
  "&-recurrence",
  "&-week",
  "&-day-view",
  "&-list",
]) {
  if (!avStyles.includes(term)) {
    fail(`calendar styles missing ${term}`);
  }
}

const report = read("CALENDAR_REBUILD_REPORT.md");
for (const term of [
  "Unresolved / Manual Verification Required",
  "Switch Table/Gallery/Kanban to Calendar and confirm no crash.",
  "Read-only/query embed views do not mutate data.",
  "After automated checks, run the manual smoke checklist above in the SiYuan UI.",
]) {
  if (!report.includes(term)) {
    fail(`rebuild report missing manual verification term: ${term}`);
  }
}

console.log(`calendar audit passed: ${requiredFiles.length} frontend files, ${calendarLanguageKeys.size} language keys, ${expectedFeatureTerms.length} feature terms`);
