#!/usr/bin/env node
import fs from 'node:fs';

const render = fs.readFileSync('app/src/protyle/render/av/calendar/render.ts', 'utf8');
const dialog = fs.readFileSync('app/src/protyle/render/av/calendar/event-dialog.ts', 'utf8');
const normalize = fs.readFileSync('app/src/protyle/render/av/calendar/normalize.ts', 'utf8');
const layout = fs.readFileSync('app/src/protyle/render/av/layout.ts', 'utf8');
const scss = fs.readFileSync('app/src/assets/scss/business/_av.scss', 'utf8');

const checks = [
  [normalize.includes('sourceCard: card'), 'normalize keeps sourceCard on events'],
  // The bound document id is derived from the block VALUE id, never from
  // value.isDetached (omitempty, so absent on bound rows) - see getBoundBlockID.
  [normalize.includes('blockID: getBoundBlockID(card)'), 'normalize keeps the bound document id on events'],
  [render.includes('calendar-open-source'), 'event chips expose first-class open-source affordance'],
  [render.includes('openCalendarEventSource'), 'renderer can open source directly from chip'],
  [render.includes('getEventDocumentID(calendarEvent)') && render.includes('event.stopPropagation()'), 'source affordance stops chip dialog and opens source'],
  [render.includes('calendarOpenSource') || render.includes('Source'), 'event chip labels source affordance'],
  [dialog.includes('calendarSource') && dialog.includes('event-source'), 'dialog shows explicit source note/block context'],
  [dialog.includes('event-open-block') && dialog.includes('calendarOpenSource'), 'dialog has obvious Open source action'],
  [scss.includes('&-source') && scss.includes('&-event-source'), 'source affordance styled in calendar SCSS'],

  // Page-per-entry: a BOUND chip opens its page on a plain click, through
  // upstream's openDatabaseRowByData (tab reuse + expanded attribute panel),
  // and keeps a separate labelled way into the scheduling dialog.
  [render.includes('import {openDatabaseRowByData} from "../openDatabaseRow";'), 'calendar opens pages through the shared database-row opener'],
  [render.includes('openDatabaseRowByData(protyle, {') && render.includes('boundBlockID: documentID') && render.includes('isDetached: false'), 'bound entries open as a real database row/page'],
  [/if \(calendarEvent && getEventDocumentID\(calendarEvent\)\) \{\s*\n\s*openCalendarEventSource/.test(render), 'primary chip click opens the page for bound entries'],
  [render.includes('calendar-open-dialog') && render.includes('av__calendar-schedule'), 'bound chips keep a labelled scheduling-dialog affordance'],
  [scss.includes('&-schedule {'), 'scheduling affordance styled in calendar SCSS'],
  [!/openFileById\(/.test(render) && !/openMobileFileById\(/.test(render), 'calendar no longer bypasses the database-row opener with a bare openFileById'],

  // The per-view "new entries" target that decides whether a page exists at all.
  [layout.includes('data-type="calendar-new-item-target"'), 'layout panel exposes the new-entry target'],
  [layout.includes('setAttrViewCalendarNewItemTarget') && /action: "setAttrViewCalendarNewItemTarget",[\s\S]{0,120}viewID/.test(layout), 'new-entry target setter is emitted per view'],
  [scss.includes('&-config-row') && scss.includes('&-new-item-target'), 'new-entry config row styled in calendar SCSS'],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length > 0) {
  console.error('calendar source-link smoke failed:');
  for (const [, message] of failed) console.error(`- ${message}`);
  process.exit(1);
}
console.log(`calendar source-link smoke passed: ${checks.length} source-link checks`);
