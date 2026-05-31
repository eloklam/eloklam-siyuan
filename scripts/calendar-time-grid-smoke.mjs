#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import {fileURLToPath} from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const fail = (message) => {
  console.error(`calendar time-grid smoke failed: ${message}`);
  process.exit(1);
};

const render = read("app/src/protyle/render/av/calendar/render.ts");
const scss = read("app/src/assets/scss/business/_av.scss");

for (const term of [
  "const SLOT_MINUTES = 30",
  "const buildTimeSlots = ()",
  "formatSlotLabel(minutes)",
  "av__calendar-time-grid",
  "av__calendar-time-slot",
  "data-type=\"calendar-time-slot\"",
  "data-start=\"${slot.start}\"",
  "data-end=\"${slot.end}\"",
  "isAllDay: false",
  "startTime: slotElement.dataset.start || \"09:00\"",
  "endTime: slotElement.dataset.end || \"09:30\"",
]) {
  if (!render.includes(term)) {
    fail(`render.ts missing ${term}`);
  }
}

if (!/const renderTimedEventLayer = \([^)]*events[^)]*day[^)]*editable/.test(render)) {
  fail("render.ts missing shared timed event layer for day/week grid");
}

if (!render.includes("timedEvents.map(event => renderTimedEventInGrid(event, day, editable)).join(\"\")")) {
  fail("week/day timed events are not rendered through the shared grid layer");
}

for (const term of [
  "&-time-grid",
  "&-time-labels",
  "&-time-slot",
  "&-timed-events",
  "grid-template-rows: repeat(48, minmax(24px, auto))",
]) {
  if (!scss.includes(term)) {
    fail(`_av.scss missing ${term}`);
  }
}

console.log("calendar time-grid smoke passed");
