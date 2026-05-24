# SiYuan Calendar Curated Patch Bundle

## Status

This is a curated patch based recovery bundle for the local SiYuan fork calendar view work.

It is not a clean Git checkout.

Use it with a clean SiYuan baseline and inspect patches before applying.

## Selected targets

1. `kernel/model/attribute_view.go` status `SELECTED` size `200376`
1. `app/src/protyle/render/av/calendar/render.ts` status `SELECTED` size `200376`
1. `app/src/protyle/render/av/calendar/event-dialog.ts` status `SELECTED` size `10676`
1. `app/src/assets/scss/business/_av.scss` status `SELECTED` size `200376`
1. `app/src/protyle/render/av/calendar/mapped-fields.ts` status `SELECTED` size `4803`
1. `app/src/protyle/render/av/calendar/normalize.ts` status `SELECTED` size `1582`
1. `app/src/protyle/render/av/calendar/recurrence.ts` status `SELECTED` size `662`
1. `app/src/protyle/render/av/calendar/transactions.ts` status `SELECTED` size `200376`
1. `app/src/protyle/render/av/layout.ts` status `SELECTED` size `200376`
1. `app/appearance/langs/de_DE.json` status `SELECTED` size `1232`
1. `app/appearance/langs/en_US.json` status `SELECTED` size `1092`
1. `app/appearance/langs/zh_CHT.json` status `SELECTED` size `812`
1. `app/appearance/langs/zh_CN.json` status `SELECTED` size `810`

## Recommended workflow after reboot

1. Clone clean SiYuan baseline.
2. Create a branch such as `recover/calendar-view`.
3. Apply patches one by one from `calendar-patch-curated/patches`.
4. Resolve conflicts manually.
5. Run TypeScript checks for calendar files.
6. Test calendar view in the app.
