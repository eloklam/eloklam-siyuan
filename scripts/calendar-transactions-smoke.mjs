#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const appDir = path.join(root, "app");
const requireFromApp = createRequire(path.join(appDir, "package.json"));
const ts = requireFromApp("typescript");

const fail = (message) => {
  console.error(`calendar transactions smoke failed: ${message}`);
  process.exit(1);
};

const tempDir = fs.mkdtempSync(path.join(appDir, ".calendar-tx-smoke-"));
const tempCalendarDir = path.join(tempDir, "src/protyle/render/av/calendar");
const tempTransactionDir = path.join(tempDir, "src/protyle/wysiwyg");
const sourceDir = path.join(root, "app/src/protyle/render/av/calendar");

const compile = (file) => {
  const source = fs.readFileSync(path.join(sourceDir, file), "utf8");
  const result = ts.transpileModule(source, {
    compilerOptions: {
      esModuleInterop: false,
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
    },
    fileName: file,
  });
  fs.writeFileSync(path.join(tempCalendarDir, file.replace(/\.ts$/, ".js")), result.outputText);
};

const assert = (condition, message) => {
  if (!condition) {
    fail(message);
  }
};

const timestamp = (value) => new Date(value).getTime();

const field = (id, type, extra = {}) => ({
  id,
  type,
  name: id,
  desc: "",
  width: "",
  icon: "",
  wrap: false,
  pin: false,
  hidden: false,
  numberFormat: "",
  template: "",
  calc: {},
  ...extra,
});

const cell = (rowID, keyID, type, value) => ({
  id: `${rowID}-${keyID}`,
  valueType: type,
  color: "",
  bgColor: "",
  value: {
    id: `${rowID}-${keyID}`,
    keyID,
    type,
    ...value,
  },
});

const makeEvent = (overrides = {}) => {
  const rowID = overrides.id || "row-event";
  const start = overrides.start || requireFromApp("dayjs")("2026-05-24T09:00:00");
  const end = overrides.end || requireFromApp("dayjs")("2026-05-24T10:00:00");
  const sourceCard = {
    id: rowID,
    values: [
      cell(rowID, "block", "block", {block: {id: "block-row-event", content: "Original title"}, isDetached: true}),
      cell(rowID, "date", "date", {
        date: {
          content: start.valueOf(),
          isNotEmpty: true,
          content2: end.valueOf(),
          isNotEmpty2: true,
          hasEndDate: true,
          isNotTime: false,
        },
      }),
      cell(rowID, "recurrence", "text", {text: {content: "FREQ=WEEKLY;COUNT=5"}}),
      cell(rowID, "exception", "text", {text: {content: "2026-05-31"}}),
      cell(rowID, "location", "text", {text: {content: "Old room"}}),
      cell(rowID, "description", "template", {template: {content: "Old notes"}}),
      cell(rowID, "color", "select", {mSelect: [{content: "Focus", color: "1"}]}),
    ],
  };
  return {
    id: rowID,
    blockID: "block-row-event",
    title: "Original title",
    start,
    end,
    isAllDay: false,
    dateCell: sourceCard.values[1],
    recurrenceRaw: "FREQ=WEEKLY;COUNT=5",
    recurrence: {freq: "WEEKLY", count: 5},
    recurrenceExceptionRaw: "2026-05-31",
    recurrenceExceptions: ["2026-05-31"],
    location: "Old room",
    description: "Old notes",
    color: "1",
    colorContent: "Focus",
    sourceCard,
    ...overrides,
  };
};

const mapping = {
  dateFieldID: "date",
  recurrenceFieldID: "recurrence",
  exceptionFieldID: "exception",
  locationFieldID: "location",
  descriptionFieldID: "description",
  colorFieldID: "color",
  hasDateField: true,
};

const fields = [
  field("date", "date"),
  field("recurrence", "text"),
  field("exception", "text"),
  field("location", "text"),
  field("description", "template"),
  field("color", "select", {options: [{name: "Focus", color: "1"}, {name: "Travel", color: "2"}]}),
];

const draft = {
  title: "Updated title",
  date: "2026-06-07",
  endDate: "2026-06-07",
  isAllDay: false,
  startTime: "11:30",
  endTime: "11:00",
  recurrenceRaw: "None",
  recurrenceExceptionRaw: "",
  location: "New room",
  description: "New notes",
  colorContent: "Travel",
};

try {
  fs.mkdirSync(tempCalendarDir, {recursive: true});
  fs.mkdirSync(tempTransactionDir, {recursive: true});
  fs.writeFileSync(path.join(tempTransactionDir, "transaction.js"), `
const calls = [];
exports.transaction = (_protyle, doOperations, undoOperations) => calls.push({doOperations, undoOperations});
exports.__calendarTransactionCalls = calls;
`);
  for (const file of ["model.ts", "transactions.ts"]) {
    compile(file);
  }

  let nodeCounter = 0;
  global.Lute = {NewNodeID: () => `20260524000000-smoke${String(++nodeCounter).padStart(2, "0")}`};

  const transactionsModule = await import(path.join(tempCalendarDir, "transactions.js"));
  const transactionStub = await import(path.join(tempTransactionDir, "transaction.js"));
  const calls = transactionStub.__calendarTransactionCalls;
  const baseOptions = {
    protyle: {},
    avID: "av-smoke",
    blockID: "block-smoke",
    dateFieldID: "date",
    fields,
    mapping,
    previousUpdated: "20260523000000",
  };

  assert(transactionsModule.createCalendarEvent({...baseOptions, draft: {...draft, date: "2026-02-31"}}) === false,
    "create should reject impossible dates");
  assert(calls.length === 0, "invalid create should not call transaction");

  assert(transactionsModule.createCalendarEvent({...baseOptions, draft}) === true, "valid create should succeed");
  const createCall = calls.pop();
  assert(createCall.doOperations[0].action === "insertAttrViewBlock", "create should insert an AV block first");
  assert(createCall.doOperations.some((op) => op.action === "updateAttrViewCell" && op.keyID === "date" &&
    op.data.date.content === timestamp("2026-06-07T11:30:00") &&
    op.data.date.content2 === timestamp("2026-06-07T12:30:00")), "create should clamp invalid end time to one hour after start");
  assert(createCall.doOperations.some((op) => op.keyID === "recurrence" && op.data.text?.content === ""),
    "create should normalize recurrence None to an empty recurrence cell");
  assert(createCall.doOperations.some((op) => op.keyID === "description" && op.data.template?.content === "New notes"),
    "create should write mapped template descriptions");
  assert(createCall.doOperations.some((op) => op.keyID === "color" && op.data.mSelect?.[0]?.content === "Travel" && op.data.mSelect?.[0]?.color === "2"),
    "create should write mapped select color values");
  assert(createCall.undoOperations.some((op) => op.action === "removeAttrViewBlock"), "create should be undoable by removing the inserted row");

  const event = makeEvent();
  assert(transactionsModule.updateCalendarEvent({...baseOptions, event, draft: {...draft, date: "invalid"}}) === false,
    "update should reject invalid dates");
  assert(calls.length === 0, "invalid update should not call transaction");

  assert(transactionsModule.updateCalendarEvent({...baseOptions, event, draft}) === true, "valid update should succeed");
  const updateCall = calls.pop();
  assert(updateCall.doOperations.some((op) => op.keyID === "block" && op.data.block?.content === "Updated title"),
    "update should rename the source block cell");
  assert(updateCall.doOperations.some((op) => op.keyID === "date" && op.data.date.content2 === timestamp("2026-06-07T12:30:00")),
    "update should clamp invalid end time");
  assert(updateCall.undoOperations.some((op) => op.keyID === "date" && op.data.date.content === timestamp("2026-05-24T09:00:00")),
    "update should retain undo snapshot for the old date value");

  assert(transactionsModule.deleteCalendarOccurrence({
    protyle: {},
    avID: "av-smoke",
    blockID: "block-smoke",
    fields,
    mapping,
    event,
    occurrenceDate: "2026-06-07",
    previousUpdated: "20260523000000",
  }) === true, "delete occurrence should write an exception");
  const occurrenceDeleteCall = calls.pop();
  assert(occurrenceDeleteCall.doOperations.some((op) => op.keyID === "exception" && op.data.text?.content === "2026-05-31,2026-06-07"),
    "delete occurrence should merge and sort exceptions");

  const occurrence = makeEvent({
    isOccurrence: true,
    occurrenceID: "row-event:20260607",
    baseEventID: "row-event",
    start: requireFromApp("dayjs")("2026-06-07T09:00:00"),
    end: requireFromApp("dayjs")("2026-06-07T10:00:00"),
  });
  assert(transactionsModule.createCalendarEventReplacingOccurrence({
    ...baseOptions,
    event: occurrence,
    draft: {...draft, recurrenceRaw: "FREQ=DAILY;COUNT=9", recurrenceExceptionRaw: "2026-06-08"},
    occurrenceDate: "2026-06-07",
  }) === true, "replacing one occurrence should succeed");
  const replaceCall = calls.pop();
  assert(replaceCall.doOperations[0].keyID === "exception", "replacement should first hide the original occurrence");
  assert(replaceCall.doOperations.some((op) => op.action === "insertAttrViewBlock"), "replacement should create a new one-off row");
  assert(!replaceCall.doOperations.some((op) => op.keyID === "recurrence" && op.data.text?.content === "FREQ=DAILY;COUNT=9"),
    "replacement should not copy recurrence rules into the one-off event");
  assert(!replaceCall.doOperations.some((op) => op.keyID === "exception" && op.rowID !== event.id && op.data.text?.content),
    "replacement should not copy exception values into the one-off event");

  assert(transactionsModule.updateCalendarEventThisAndFuture({
    ...baseOptions,
    event,
    draft: {...draft, recurrenceRaw: "FREQ=WEEKLY;COUNT=5"},
    occurrenceDate: "2026-06-07",
  }) === true, "this-and-future split should succeed");
  const splitCall = calls.pop();
  assert(splitCall.doOperations.some((op) => op.rowID === event.id && op.keyID === "recurrence" &&
    op.data.text?.content === "FREQ=WEEKLY;COUNT=5;UNTIL=2026-06-06"), "split should truncate the original series before the edited occurrence");
  assert(splitCall.doOperations.some((op) => op.action === "insertAttrViewBlock"), "split should create the future series row");
  assert(splitCall.doOperations.some((op) => op.rowID !== event.id && op.keyID === "recurrence" &&
    op.data.text?.content === "FREQ=WEEKLY;COUNT=3"), "split should reduce COUNT for the new future series");

  assert(transactionsModule.deleteCalendarEvent({
    protyle: {},
    avID: "av-smoke",
    blockID: "block-smoke",
    event,
    previousUpdated: "20260523000000",
  }) === true, "delete event should succeed");
  const deleteCall = calls.pop();
  assert(deleteCall.doOperations.some((op) => op.action === "removeAttrViewBlock" && op.srcIDs?.[0] === event.id),
    "delete should remove the event row");
  assert(deleteCall.undoOperations.some((op) => op.action === "insertAttrViewBlock" && op.srcs?.[0]?.id === event.id),
    "delete undo should restore the event row");
  assert(deleteCall.undoOperations.some((op) => op.action === "updateAttrViewCell" && op.keyID === "recurrence"),
    "delete undo should restore metadata cells");

  console.log("calendar transactions smoke passed: create/update/delete/occurrence replacement/split operations");
} finally {
  fs.rmSync(tempDir, {recursive: true, force: true, maxRetries: 3});
}
