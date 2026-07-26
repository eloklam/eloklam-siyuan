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
  "scripts/calendar-kernel-smoke.mjs",
  "scripts/calendar-recurrence-smoke.mjs",
  "scripts/calendar-transactions-smoke.mjs",
  "scripts/calendar-electron-launch-smoke.mjs",
  "scripts/calendar-electron-document-flow-smoke.mjs",
];

for (const file of requiredFiles) {
  if (!exists(file)) {
    fail(`missing required file ${file}`);
  }
}

const frontendCode = Object.fromEntries(requiredFiles.map((file) => [file, read(file)]));
const joinedFrontendCode = requiredFiles
  .filter((file) => file.startsWith("app/src/"))
  .map((file) => frontendCode[file])
  .join("\n");

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
  "calendar-filter",
  "calendar-clear-search",
  "calendar-jump-date",
  "calendar-prev-event",
  "calendar-next-event",
  "av__calendar-summary",
  "tabindex=\"0\"",
  "aria-keyshortcuts=\"ArrowLeft ArrowRight [ ] T N / Escape 1 2 3 4\"",
  "role=\"region\"",
  "calendar-mode",
  "calendar-drop-day",
  "dblclick",
  "calendar-resize",
  "calendar-duplicate-next-day",
  "event-open-block",
  "openEventBlock",
  "getEventTooltip",
  "av__calendar-recurring",
  "data-days",
  "computeTimedEventColumns",
  "calendar-more",
  "av__calendar-empty-hint",
  "isTitleFallback",
  "av__calendar-day--selected",
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
  if (!data._attrView || data._attrView.calendar !== data.calendar) {
    fail(`${file} missing _attrView.calendar backend layout label`);
  }
}

const renderEntry = read("app/src/protyle/render/av/render.ts");
if (!renderEntry.includes("renderCalendar") || !renderEntry.includes('data.viewType === "calendar"')) {
  fail("AV render entry does not dispatch calendar rendering");
}

const calendarRender = read("app/src/protyle/render/av/calendar/render.ts");
if (/if \(sourceEvent\.isOccurrence\)\s*{\s*draft\.recurrenceRaw = ""/.test(calendarRender)) {
  fail("quick-copy should always clear recurrence data, not only copied occurrences");
}
for (const term of [
  "hasClosestByAttribute(options.blockElement, \"data-type\", \"NodeBlockQueryEmbed\")",
  "hasClosestByAttribute(e, \"data-type\", \"NodeBlockQueryEmbed\")",
  "draggable=\"${editable ? \"true\" : \"false\"}\"",
  "av__calendar-event--readonly",
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
  "av__calendar-week-day${day.isSame(dayjs(), \"day\") ? \" av__calendar-day--today\" : \"\"}",
  "av__calendar-day-view${anchor.isSame(dayjs(), \"day\") ? \" av__calendar-day--today\" : \"\"}",
  "av__calendar-list-day${cursor.isSame(dayjs(), \"day\") ? \" av__calendar-day--today\" : \"\"}",
  "renderEventSummary",
  "data-date=\"${cursor.format(\"YYYY-MM-DD\")}\" data-type=\"calendar-drop-day\"",
  "getSafeViewMode",
  "getCalendarViewMode",
  "blockElement.dataset.calendarViewMode",
  "getVisibleRange",
  "getCalendarTitle",
  "getEventSeekRange",
  "seekEvent",
  "normalizeCalendarEvents(calendar, mapping, getEventSeekRange(anchor)).events",
  "event.start.isAfter(anchor, \"day\")",
  "event.start.isBefore(anchor, \"day\")",
  "showMessage(window.siyuan.languages.calendarNoMatchingEvent",
  "getEventDateLabel",
  "title=\"${escapeAttr(eventTooltip)}\"",
  "aria-label=\"${escapeAttr(eventTooltip)}\"",
  "window.siyuan.languages.calendarOccurrence || \"Recurring occurrence\"",
  "const recurrenceMarker = event.recurrenceRaw || event.recurrence || event.isOccurrence",
  "event.isOccurrence ? \"O\" : \"R\"",
  "${recurrenceMarker}",
  "jumpDateInput",
  "setCalendarAnchor",
  "getCurrentAnchor",
  "setCalendarViewMode",
  "options.blockElement.dataset.calendarViewMode = String(mode)",
  "delete options.blockElement.dataset.calendarViewMode",
  "aria-keyshortcuts=\"${mode + 1}\"",
  "aria-keyshortcuts=\"ArrowLeft\"",
  "aria-keyshortcuts=\"ArrowRight\"",
  "aria-keyshortcuts=\"[\"",
  "aria-keyshortcuts=\"]\"",
  "aria-keyshortcuts=\"T\"",
  "aria-keyshortcuts=\"N\"",
  "aria-keyshortcuts=\"/\"",
  "aria-keyshortcuts=\"Escape\"",
  "aria-label=\"${escapeAttr(`${window.siyuan.languages.calendar || \"Calendar\"} ${title}`)}\"",
  "av__calendar-title\" aria-live=\"polite\"",
  "av__calendar-summary\" aria-live=\"polite\"",
  "calendarElement?.addEventListener(\"keydown\"",
  "event.key === \"ArrowLeft\"",
  "event.key === \"ArrowRight\"",
  "event.key === \"[\"",
  "event.key === \"]\"",
  "event.key.toLowerCase() === \"t\"",
  "event.key.toLowerCase() === \"n\"",
  "event.key === \"/\"",
  "event.key === \"Escape\"",
  "/^[1-4]$/.test(event.key)",
  "setCalendarViewMode(parseInt(event.key, 10) - 1)",
  "eventMatchesSearch",
  "getCalendarSearch",
  "getCalendarFilter",
  "eventMatchesCalendarFilter",
  "const filteredEvents = normalized.events.filter(event => eventMatchesCalendarFilter(event, filter))",
  "const totalEventCount = normalized.events.length",
  "const hasActiveQuery = !!search || filter !== \"all\"",
  "renderCalendarFilter(filter)",
  "options.blockElement.dataset.calendarFilter = filterSelect.value",
  "delete options.blockElement.dataset.calendarFilter",
  "av__calendar-search-count",
  "const allDayCount = events.filter(event => event.isAllDay).length",
  "const timedCount = events.length - allDayCount",
  "const eventsLabel = window.siyuan.languages.calendarEvents || \"Events\"",
  "const timedLabel = window.siyuan.languages.calendarTimed || \"Timed\"",
  "${renderEventSummary(events)}",
  "delete options.blockElement.dataset.calendarSearch",
  "rerender(true, true)",
  "calendarSearch",
  "getSafeWeekStart",
  "startOfCalendarWeek",
  "weekStart",
  "dragOffsetDays",
  "deltaDays",
  "displayDate",
  "buildDraftForDate",
  "duplicateEventToNextDay",
  "draft.recurrenceRaw = \"\"",
  "draft.recurrenceExceptionRaw = \"\"",
  "window.siyuan.languages.copy || \"Copy\"",
  "createCalendarEvent({",
  "getEditableEvent",
  "readOnly: true",
  ".av__calendar-event, [data-type='calendar-new']",
]) {
  if (!calendarRender.includes(term)) {
    fail(`calendar render flow missing ${term}`);
  }
}

const eventDialog = read("app/src/protyle/render/av/calendar/event-dialog.ts");
if (/recurrenceRaw:\s*options\.event\?\.isOccurrence\s*\?/.test(eventDialog)) {
  fail("dialog duplicate should always clear recurrence data");
}
for (const term of [
  "showInvalidDraftMessage",
  "window.siyuan.languages.calendarNeedDateField",
  "window.siyuan.languages.invalid",
  "recurrenceRaw: \"\"",
  "recurrenceExceptionRaw: \"\"",
  "const editsSeries = !!event?.isOccurrence && !mapping.exceptionFieldID",
  "window.siyuan.languages.calendarEditSeriesNotice",
  "event?.blockID ? `<button class=\"b3-button b3-button--outline\" data-type=\"event-open-block\"",
  "readOnly?: boolean",
  "const readOnly = !!options.readOnly",
  "isEditing && !readOnly",
  "if (options.readOnly)",
  "openFileById({",
  "openMobileFileById(options.protyle.app, blockID, [Constants.CB_GET_FOCUS])",
  "dialog.destroy();",
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
  "const hasDateField = !!persistedDateFieldID && calendarData.fields.some(field => field.id === persistedDateFieldID && field.type === \"date\")",
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
  "min-width: 320px",
  "&:focus-visible",
  "outline: 2px solid var(--b3-theme-primary)",
  "&-toolbar",
  "flex-wrap: wrap",
  "&-jump",
  "&-summary",
  "flex: 1 1 180px",
  "&-search-count",
  "&-filter",
  "&-month",
  "&-event",
  "&--readonly",
  "&-resize",
  "&-recurring",
  "&-recurrence",
  "&-week",
  "&-day-view",
  "&-list",
]) {
  if (!avStyles.includes(term)) {
    fail(`calendar styles missing ${term}`);
  }
}

const kernelSmoke = read("scripts/calendar-kernel-smoke.mjs");
for (const term of [
  "go\", [\"build\", \"-tags\", \"fts5\"",
  "\"/api/notebook/createNotebook\"",
  "\"/api/filetree/createDocWithMd\"",
  "\"/api/av/changeAttrViewLayout\"",
  "\"setAttrViewCalendarDateField\"",
  "\"setAttrViewCalendarFieldMapping\"",
  "recurrenceFieldID",
  "exceptionFieldID",
  "locationFieldID",
  "descriptionFieldID",
  "colorFieldID",
  "selectCellValue",
  "calendar kernel smoke passed",
  "SIYUAN_CALENDAR_KEEP_SMOKE_WORKSPACE",
]) {
  if (!kernelSmoke.includes(term)) {
    fail(`calendar kernel smoke missing ${term}`);
  }
}

const report = read("CALENDAR_REBUILD_REPORT.md");
for (const term of [
  "Completion Evidence / Manual Acceptance",
  "Switching the AV renderer to Calendar without crashing.",
  "Read-only/query-embed mutation guards, while still allowing event inspection and local view-mode switching.",
  "Isolated launch smoke also passed without touching the real note vault:",
  "CGO_ENABLED=1 go build -tags fts5 -o SiYuan-Kernel .",
  "node scripts/calendar-kernel-smoke.mjs",
  "node scripts/calendar-electron-document-flow-smoke.mjs",
  "Backend `_attrView.calendar` language coverage is checked for every bundled language JSON file.",
  "Calendar API setup and mapped metadata path.",
  "Open an isolated workspace or explicit throwaway user workspace; do not use `/home/eloklam/SiYuan`.",
  "After automated checks, only the short manual acceptance list above remains recommended for visual confidence.",
]) {
  if (!report.includes(term)) {
    fail(`rebuild report missing completion evidence term: ${term}`);
  }
}

const recurrenceSmoke = read("scripts/calendar-recurrence-smoke.mjs");
for (const term of [
  "normalizeCalendarEvents(calendar, mapping, range)",
  "getCalendarFieldMapping(calendar)",
  "FREQ=WEEKLY;COUNT=3",
  "FREQ=WEEKLY;COUNT=4;BYDAY=MO,WE",
  "recurrence: \"None\"",
  "weekly recurrence dates",
  "weekly BYDAY recurrence dates",
  "expanded recurrence did not preserve mapped metadata",
  "base event did not retain parsed recurrence exceptions",
]) {
  if (!recurrenceSmoke.includes(term)) {
    fail(`calendar recurrence smoke missing ${term}`);
  }
}

const transactionsSmoke = read("scripts/calendar-transactions-smoke.mjs");
for (const term of [
  "createCalendarEvent({...baseOptions, draft})",
  "updateCalendarEvent({...baseOptions, event, draft})",
  "deleteCalendarEvent({",
  "deleteCalendarOccurrence({",
  "createCalendarEventReplacingOccurrence({",
  "updateCalendarEventThisAndFuture({",
  "create should clamp invalid end time",
  "delete occurrence should merge and sort exceptions",
  "replacement should not copy recurrence rules into the one-off event",
  "split should reduce COUNT for the new future series",
  "delete undo should restore metadata cells",
]) {
  if (!transactionsSmoke.includes(term)) {
    fail(`calendar transactions smoke missing ${term}`);
  }
}

const electronLaunchSmoke = read("scripts/calendar-electron-launch-smoke.mjs");
for (const term of [
  "\"--workspace\", workspace",
  "\"--port\", String(kernelPort)",
  "`--workspace=${workspace}`",
  "`--remote-debugging-port=${debugPort}`",
  "\"--no-sandbox\"",
  "desktopBuildDir",
  "fs.symlinkSync(desktopBuildDir, appBuildDir, \"dir\")",
  "workspace.json",
  "waitForKernelBoot(baseURL)",
  "waitForElectronDebug(debugPort)",
  "waitForAppShell(debugPort)",
  "compileCalendarRenderHarness",
  "compileCalendarDialogHarness",
  "runCalendarRenderSmoke(debugPort, renderHarness.renderModule)",
  "runCalendarDialogSmoke(debugPort, dialogHarness.dialogModule)",
  "renderModule.renderCalendar",
  "dialogModule.openEventDialog",
  "Calendar UI render smoke event",
  "Calendar none smoke event",
  "Dialog smoke event",
  "__calendarRenderTxCalls",
  "__calendarRenderDialogs",
  "toolbarNewDate",
  "dayNewDate",
  "duplicateDraft",
  "resizeDraft",
  "dragDraft",
  "persistedModeOperation",
  "setupOperationAction",
  "createFieldOperations",
  "calendar-scope-future",
  "futureDraft",
  "delete-occurrence",
  "av-event-recurrence-raw",
  "FREQ=WEEKLY;INTERVAL=2;COUNT=3;UNTIL=2026-06-01;BYDAY=MO,WE",
  "search.dispatchEvent(new Event('input'",
  "calendar-prev-event",
  "calendar-next-event",
  "calendar-clear-search",
  "readOnlyDraggable",
  "readOnlyLocalMode",
  "readOnlyRenderedMode",
  "weekMode",
  "scheduleMode",
  "renderedEvents=${renderState.eventCount}",
  "dialogSaves=${dialogState.saves}",
  "hasOpenFileByURL",
  "hasSiYuanTarget",
  "stopProcessGroup(electron)",
  "SIYUAN_CALENDAR_KEEP_SMOKE_WORKSPACE",
  "calendar electron launch smoke passed",
]) {
  if (!electronLaunchSmoke.includes(term)) {
    fail(`calendar electron launch smoke missing ${term}`);
  }
}

const electronDocumentFlowSmoke = read("scripts/calendar-electron-document-flow-smoke.mjs");
for (const term of [
  "createCalendarFixture(baseURL)",
  "\"/api/filetree/createDocWithMd\"",
  "\"/api/av/changeAttrViewLayout\"",
  "\"/api/attr/setBlockAttrs\"",
  "\"custom-sy-av-view\"",
  "window.openFileByURL",
  "siyuan://blocks/${fixture.docID}",
  "siyuan://blocks/${fixture.avBlockID}?focus=1",
  "__calendarDocFlowFetches",
  "__calendarDocFlowErrors",
  ".av__calendar-event",
  "Calendar document flow event",
  "calendar electron document flow smoke passed",
]) {
  if (!electronDocumentFlowSmoke.includes(term)) {
    fail(`calendar electron document flow smoke missing ${term}`);
  }
}

for (const [file, term] of [
  ["app/src/protyle/render/av/layout.ts", "calendarStaleMapping"],
  ["app/src/protyle/render/av/calendar/mapped-fields.ts", "dateFieldID: hasDateField ?"],
  ["app/src/protyle/render/av/calendar/render.ts", "editable && mapping.hasDateField"],
]) {
  if (!read(file).includes(term)) {
    fail(`${file} missing mapping-robustness guard: ${term}`);
  }
}

for (const [file, term] of [
  ["app/src/protyle/render/av/calendar/render.ts", "const getCalendarLocale = () => window.siyuan.config.lang;"],
  ["app/src/protyle/render/av/calendar/event-dialog.ts", "const getCalendarLocale = () => window.siyuan.config.lang;"],
  ["app/src/protyle/render/av/layout.ts", "const getCalendarLocale = () => window.siyuan.config.lang;"],
]) {
  if (!read(file).includes(term)) {
    fail(`${file} missing BCP 47 calendar locale accessor`);
  }
}

console.log(`calendar audit passed: 7 frontend files, ${calendarLanguageKeys.size} language keys, ${expectedFeatureTerms.length} feature terms, kernel/recurrence/transactions/electron render+dialog/document smoke scripts`);
