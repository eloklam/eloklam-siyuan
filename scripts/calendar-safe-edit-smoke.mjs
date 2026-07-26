#!/usr/bin/env node
import fs from 'node:fs';

const dialog = fs.readFileSync('app/src/protyle/render/av/calendar/event-dialog.ts', 'utf8');
const baseDialog = fs.readFileSync('app/src/dialog/index.ts', 'utf8');

const checks = [
  [dialog.includes('confirmDialog'), 'uses SiYuan confirmDialog for discard guard'],
  [dialog.includes('getDraftFingerprint'), 'captures serialized draft fingerprint'],
  [dialog.includes('initialDraftFingerprint'), 'stores initial draft after render'],
  [dialog.includes('isEventDialogDirty'), 'has dirty check helper'],
  [dialog.includes('closeEventDialogSafely'), 'cancel/escape route through safe close helper'],
  [dialog.includes('calendarDiscardChanges'), 'discard copy is localized'],
  [((dialog.includes('saveButton.disabled = true') && dialog.includes('saveButton.disabled = false')) || (dialog.includes('actionButton.disabled = true') && dialog.includes('actionButton.disabled = false'))), 'save disables while pending and restores on failure'],
  [dialog.includes('options.onSave?.()') && dialog.includes('dialog.destroy()'), 'successful save still closes dialog and rerenders'],
  [dialog.includes('disableClose: true'), 'base scrim and close icon cannot destroy event dialog directly'],
  [dialog.includes('bindGuardedEventDialogClose'), 'installs guarded close behavior for Escape/close controls'],
  [dialog.includes('event.key !== "Escape"') && dialog.includes('addEventListener("keydown"') && dialog.includes('true'), 'Escape is captured before global dialog destroy'],
  [dialog.includes('event.stopPropagation()') && dialog.includes('event.preventDefault()'), 'guarded Escape prevents global silent destroy'],
  [dialog.includes('data-type="event-close"') && dialog.includes('[data-type="event-close"]'), 'event dialog owns visible X close control'],
  [dialog.includes('[data-type="event-close"') && dialog.includes('closeEventDialogSafely(dialog)'), 'owned X close routes through dirty guard'],
  [dialog.includes('destroyCallback') && dialog.includes('removeEventListener("keydown"'), 'Escape guard is removed when dialog is destroyed'],
  [baseDialog.includes('disableClose') && baseDialog.includes('this.destroy();'), 'base dialog normally destroys on scrim/close, proving event dialog must opt out'],
  // The calendar's undo can restore a row but never a document, so removing the
  // page must stay a separate, confirmed, non-default action.
  [dialog.includes('data-type="event-delete-page"'), 'removing the page is a separate explicit action, not the default delete'],
  [/const confirmDeleteEventPage[\s\S]*?confirmDialog\(/.test(dialog), 'page removal is confirm gated'],
  [/const deleteEventWithPage[\s\S]*?if \(!await deleteEvent\([\s\S]*?deleteCalendarEventDocument/.test(dialog), 'page removal only runs after the row removal succeeded'],
  [!/deleteCalendarEventDocument/.test(dialog.match(/const deleteEvent = async[\s\S]*?\n};/)?.[0] || 'deleteCalendarEventDocument'), 'the plain delete removes the row only and never touches the page'],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length > 0) {
  console.error('calendar safe-edit smoke failed:');
  for (const [, message] of failed) console.error(`- ${message}`);
  process.exit(1);
}
console.log(`calendar safe-edit smoke passed: ${checks.length} guarded dirty-close/pending checks`);
