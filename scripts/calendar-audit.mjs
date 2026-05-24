#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
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

const layoutCode = read("app/src/protyle/render/av/layout.ts");
for (const term of ["setAttrViewCalendarDateField", "setAttrViewCalendarWeekStart", "setAttrViewCalendarFieldMapping"]) {
  if (!layoutCode.includes(term)) {
    fail(`layout menu missing ${term}`);
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
]) {
  if (!backendTests.includes(term)) {
    fail(`backend calendar test missing ${term}`);
  }
}

console.log(`calendar audit passed: ${requiredFiles.length} frontend files, ${calendarLanguageKeys.size} language keys, ${expectedFeatureTerms.length} feature terms`);
