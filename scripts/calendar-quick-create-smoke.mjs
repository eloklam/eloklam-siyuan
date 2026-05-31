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
  console.error(`calendar quick-create smoke failed: ${message}`);
  process.exit(1);
};

if (!exists("app/src/protyle/render/av/calendar/quick-create.ts")) {
  fail("missing quick-create.ts");
}

const quickCreate = read("app/src/protyle/render/av/calendar/quick-create.ts");
const render = read("app/src/protyle/render/av/calendar/render.ts");
const scss = read("app/src/assets/scss/business/_av.scss");

for (const term of [
  "export interface IQuickCreateOptions",
  "export const openQuickCreate",
  "av__calendar-quick-create",
  "data-type=\"calendar-quick-create-title\"",
  "data-type=\"calendar-quick-create-save\"",
  "data-type=\"calendar-quick-create-more\"",
  "data-type=\"calendar-quick-create-cancel\"",
  "titleInput.focus()",
  "event.key === \"Enter\"",
  "event.key === \"Escape\"",
  "onMoreOptions({...draft, title: titleInput.value.trim()})",
]) {
  if (!quickCreate.includes(term)) {
    fail(`quick-create.ts missing ${term}`);
  }
}

for (const term of [
  "import {openQuickCreate} from \"./quick-create\";",
  "openQuickCreate({",
  "onSave: (savedDraft) => {",
  "createCalendarEvent({",
  "onMoreOptions: (moreDraft) => openEventDialog({",
]) {
  if (!render.includes(term)) {
    fail(`render.ts missing quick-create wiring ${term}`);
  }
}

for (const term of [
  "&-quick-create",
  "&-quick-create-title",
  "&-quick-create-summary",
  "&-quick-create-actions",
]) {
  if (!scss.includes(term)) {
    fail(`_av.scss missing ${term}`);
  }
}

console.log("calendar quick-create smoke passed");
