#!/usr/bin/env node
import fs from 'node:fs';

const render = fs.readFileSync('app/src/protyle/render/av/calendar/render.ts', 'utf8');
const dialog = fs.readFileSync('app/src/protyle/render/av/calendar/event-dialog.ts', 'utf8');
const normalize = fs.readFileSync('app/src/protyle/render/av/calendar/normalize.ts', 'utf8');
const scss = fs.readFileSync('app/src/assets/scss/business/_av.scss', 'utf8');

const checks = [
  [normalize.includes('sourceCard: card'), 'normalize keeps sourceCard on events'],
  [normalize.includes('blockID: blockValue?.id'), 'normalize keeps blockID on events'],
  [render.includes('calendar-open-source'), 'event chips expose first-class open-source affordance'],
  [render.includes('openCalendarEventSource'), 'renderer can open source directly from chip'],
  [render.includes('calendarEvent?.blockID') && render.includes('event.stopPropagation()'), 'source affordance stops chip dialog and opens source'],
  [render.includes('calendarOpenSource') || render.includes('Source'), 'event chip labels source affordance'],
  [dialog.includes('calendarSource') && dialog.includes('event-source'), 'dialog shows explicit source note/block context'],
  [dialog.includes('event-open-block') && dialog.includes('calendarOpenSource'), 'dialog has obvious Open source action'],
  [scss.includes('&-source') && scss.includes('&-event-source'), 'source affordance styled in calendar SCSS'],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length > 0) {
  console.error('calendar source-link smoke failed:');
  for (const [, message] of failed) console.error(`- ${message}`);
  process.exit(1);
}
console.log(`calendar source-link smoke passed: ${checks.length} source-link checks`);
