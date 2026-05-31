#!/usr/bin/env node
import fs from 'node:fs';

const dialog = fs.readFileSync('app/src/protyle/render/av/calendar/event-dialog.ts', 'utf8');

const checks = [
  [dialog.includes('confirmDialog'), 'uses SiYuan confirmDialog for discard guard'],
  [dialog.includes('getDraftFingerprint'), 'captures serialized draft fingerprint'],
  [dialog.includes('initialDraftFingerprint'), 'stores initial draft after render'],
  [dialog.includes('isEventDialogDirty'), 'has dirty check helper'],
  [dialog.includes('closeEventDialogSafely'), 'cancel/escape route through safe close helper'],
  [dialog.includes('detail === "Escape"'), 'Escape is guarded'],
  [dialog.includes('calendarDiscardChanges'), 'discard copy is localized'],
  [dialog.includes('saveButton.disabled = true') && dialog.includes('saveButton.disabled = false'), 'save disables while pending and restores on failure'],
  [dialog.includes('options.onSave?.()') && dialog.includes('dialog.destroy()'), 'successful save still closes dialog and rerenders'],
];

const failed = checks.filter(([ok]) => !ok);
if (failed.length > 0) {
  console.error('calendar safe-edit smoke failed:');
  for (const [, message] of failed) console.error(`- ${message}`);
  process.exit(1);
}
console.log(`calendar safe-edit smoke passed: ${checks.length} dirty/pending checks`);
