"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.deleteCalendarOccurrence = exports.deleteCalendarEvent = exports.updateCalendarEventThisAndFuture = exports.updateCalendarEvent = exports.createCalendarEventReplacingOccurrence = exports.createCalendarEvent = exports.buildDeleteEventOperations = exports.buildUpdateEventOperations = exports.buildCreateEventOperations = exports.buildSplitSeriesOperations = exports.buildOccurrenceExceptionOperations = void 0;
const dayjs = require("dayjs");
const constants_1 = require("../../../../constants");
const fetch_1 = require("../../../../util/fetch");
const model_1 = require("./model");
const clone = (value) => JSON.parse(JSON.stringify(value));
const normalizeRecurrenceValue = (value) => {
    const trimmed = (value || "").trim();
    return trimmed.toLowerCase() === "none" ? "" : trimmed;
};
const recurrenceWithUntil = (value, untilDate) => {
    const normalized = normalizeRecurrenceValue(value);
    if (!normalized) {
        return "";
    }
    const upper = normalized.toUpperCase();
    const parts = upper.includes("=") ? upper.split(";").filter(Boolean) : [`FREQ=${upper}`];
    let hasUntil = false;
    const nextParts = parts.map((part) => {
        if (part.startsWith("UNTIL=")) {
            hasUntil = true;
            return `UNTIL=${untilDate}`;
        }
        return part;
    });
    if (!hasUntil) {
        nextParts.push(`UNTIL=${untilDate}`);
    }
    return nextParts.join(";");
};
const getEventRecurrenceRaw = (event) => event.recurrenceRaw || event.recurrence?.raw || event.recurrence?.freq || "";
const weekdayMap = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };
const addRecurringStep = (date, event) => {
    const interval = event.recurrence?.interval || 1;
    if (event.recurrence?.freq === "DAILY") {
        return date.add(interval, "day");
    }
    if (event.recurrence?.freq === "WEEKLY") {
        return date.add(interval, "week");
    }
    if (event.recurrence?.freq === "MONTHLY") {
        return date.add(interval, "month");
    }
    return date.add(interval, "year");
};
const countOccurrencesBefore = (event, occurrenceDate) => {
    if (!event.recurrence) {
        return 0;
    }
    const splitStart = dayjs(occurrenceDate).startOf("day");
    let count = 0;
    let generated = 0;
    const limit = event.recurrence.count || 10000;
    if (event.recurrence.freq === "WEEKLY" && event.recurrence.byDay?.length > 0) {
        let weekCursor = event.start.startOf("week");
        while (generated < limit && !weekCursor.isAfter(splitStart, "day")) {
            const weeksFromStart = weekCursor.diff(event.start.startOf("week"), "week");
            if (weeksFromStart >= 0 && weeksFromStart % (event.recurrence.interval || 1) === 0) {
                for (const byDay of event.recurrence.byDay) {
                    const occurrenceStart = weekCursor.day(weekdayMap[byDay])
                        .hour(event.start.hour())
                        .minute(event.start.minute())
                        .second(event.start.second())
                        .millisecond(event.start.millisecond());
                    if (occurrenceStart.isBefore(event.start)) {
                        continue;
                    }
                    if (event.recurrence.until && occurrenceStart.isAfter(event.recurrence.until)) {
                        return count;
                    }
                    if (!occurrenceStart.isBefore(splitStart, "day")) {
                        return count;
                    }
                    count++;
                    generated++;
                    if (generated >= limit) {
                        return count;
                    }
                }
            }
            weekCursor = weekCursor.add(1, "week");
        }
        return count;
    }
    let cursor = event.start;
    while (generated < limit && cursor.isBefore(splitStart, "day")) {
        if (event.recurrence.until && cursor.isAfter(event.recurrence.until)) {
            break;
        }
        count++;
        generated++;
        cursor = addRecurringStep(cursor, event);
    }
    return count;
};
const recurrenceCount = (value) => {
    const countPart = value.toUpperCase().split(";").find(part => part.startsWith("COUNT="));
    if (!countPart) {
        return undefined;
    }
    const countValue = countPart.slice("COUNT=".length);
    if (!/^\d+$/.test(countValue)) {
        return undefined;
    }
    const count = parseInt(countValue, 10);
    return count > 0 ? count : undefined;
};
const recurrenceWithCount = (value, count) => {
    const upper = value.toUpperCase();
    if (!upper.includes("COUNT=")) {
        return value;
    }
    return upper.split(";").filter(Boolean).map(part => part.startsWith("COUNT=") ? `COUNT=${count}` : part).join(";");
};
const recurrenceForSplitFuture = (value, event, occurrenceDate, originalValue) => {
    const count = recurrenceCount(value);
    if (!count || value.toUpperCase() !== originalValue.toUpperCase()) {
        return value;
    }
    return recurrenceWithCount(value, Math.max(count - countOccurrencesBefore(event, occurrenceDate), 1));
};
const isRealDateInputValue = (value) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }
    const parsed = dayjs(value);
    return parsed.isValid() && parsed.format("YYYY-MM-DD") === value;
};
const getTimeInputValue = (value, fallback) => {
    if (!value || !/^\d{2}:\d{2}$/.test(value)) {
        return fallback;
    }
    const [hour, minute] = value.split(":").map(item => parseInt(item, 10));
    return hour >= 0 && hour < 24 && minute >= 0 && minute < 60 ? value : fallback;
};
const buildDateValue = (draft) => {
    if (!isRealDateInputValue(draft.date)) {
        return undefined;
    }
    const startTime = getTimeInputValue(draft.startTime, "09:00");
    const endTime = getTimeInputValue(draft.endTime, "10:00");
    const start = draft.isAllDay ? dayjs(draft.date).startOf("day") : dayjs(`${draft.date}T${startTime}`);
    const endDate = draft.endDate && isRealDateInputValue(draft.endDate) && dayjs(draft.endDate).isAfter(dayjs(draft.date), "day") ? draft.endDate : draft.date;
    let end = draft.isAllDay ? dayjs(endDate).endOf("day") : dayjs(`${endDate}T${endTime}`);
    if (!draft.isAllDay && !end.isAfter(start)) {
        end = start.add(1, "hour");
    }
    return {
        type: "date",
        date: {
            content: start.valueOf(),
            isNotEmpty: true,
            content2: end.valueOf(),
            isNotEmpty2: true,
            hasEndDate: true,
            isNotTime: draft.isAllDay,
        },
    };
};
// Template cells are computed by the kernel (fillAttributeViewBaseValue replaces the
// stored value with the field's expression on every render), so calendar metadata is
// only ever written into text fields.
const buildTextLikeValue = (field, value, oldValue) => {
    const base = oldValue ? clone(oldValue) : { type: "text", keyID: field.id };
    base.type = "text";
    base.keyID = field.id;
    base.text = { content: value };
    delete base.template;
    return base;
};
const buildEmptyTextLikeValue = (field) => buildTextLikeValue(field, "");
const buildSelectValue = (field, value, oldValue) => {
    const content = (value || "").trim();
    if (!content) {
        return oldValue ? {
            ...clone(oldValue),
            type: field.type,
            keyID: field.id,
            mSelect: [],
        } : undefined;
    }
    const option = field.options?.find(item => item.name === content);
    if (!option) {
        return undefined;
    }
    const selectValue = {
        content,
        color: option.color || "1",
    };
    const base = oldValue ? clone(oldValue) : { type: field.type, keyID: field.id };
    base.type = field.type;
    base.keyID = field.id;
    base.mSelect = field.type === "mSelect" ? [selectValue] : [selectValue];
    return base;
};
const buildEmptySelectValue = (field) => ({
    type: field.type,
    keyID: field.id,
    mSelect: [],
});
const buildBlockValue = (event, title) => {
    const blockCell = (0, model_1.getBlockCell)(event.sourceCard);
    if (!blockCell?.value) {
        return undefined;
    }
    const value = clone(blockCell.value);
    value.type = "block";
    value.keyID = blockCell.value.keyID;
    value.block = {
        ...(value.block || {}),
        content: title,
    };
    return value;
};
const pushUpdate = (ops, options) => {
    if (!options.keyID || !options.newValue) {
        return;
    }
    if (options.oldValue && JSON.stringify(options.oldValue) === JSON.stringify(options.newValue)) {
        return;
    }
    ops.doOperations.push({
        action: "updateAttrViewCell",
        avID: options.avID,
        keyID: options.keyID,
        rowID: options.rowID,
        data: options.newValue,
    });
    if (options.oldValue) {
        ops.undoOperations.unshift({
            action: "updateAttrViewCell",
            avID: options.avID,
            keyID: options.keyID,
            rowID: options.rowID,
            data: options.oldValue,
        });
    }
};
const pushUpdated = (ops, blockID, previousUpdated = "") => {
    const newUpdated = dayjs().format("YYYYMMDDHHmmss");
    ops.doOperations.push({ action: "doUpdateUpdated", id: blockID, data: newUpdated });
    ops.undoOperations.push({ action: "doUpdateUpdated", id: blockID, data: previousUpdated });
};
const findCardByID = (cards, rowID) => cards.find(card => card.id === rowID);
const getCardCellValue = (card, keyID) => card.values?.find(cell => cell.value?.keyID === keyID)?.value;
const getCardTextContent = (card, keyID) => {
    const value = getCardCellValue(card, keyID);
    return value?.text?.content ?? value?.template?.content ?? "";
};
const buildWriteChecks = (doOperations) => {
    const checks = [];
    const removedIDs = new Set();
    doOperations.forEach(operation => {
        if (operation.action === "removeAttrViewBlock") {
            (operation.srcIDs || []).forEach(srcID => removedIDs.add(srcID));
        }
    });
    doOperations.forEach(operation => {
        if (operation.action === "insertAttrViewBlock") {
            (operation.srcs || []).forEach(src => {
                const itemID = src.itemID;
                if (!itemID || removedIDs.has(itemID)) {
                    return;
                }
                checks.push((cards, mayHideItems) => !!findCardByID(cards, itemID) || mayHideItems);
            });
            return;
        }
        if (operation.action === "removeAttrViewBlock") {
            (operation.srcIDs || []).forEach(srcID => {
                checks.push((cards) => !findCardByID(cards, srcID));
            });
            return;
        }
        if (operation.action !== "updateAttrViewCell" || !operation.rowID || !operation.keyID || removedIDs.has(operation.rowID)) {
            return;
        }
        const data = operation.data;
        const rowID = operation.rowID;
        const keyID = operation.keyID;
        if (data?.type === "date" && data.date) {
            const expected = data.date;
            checks.push((cards, mayHideItems) => {
                const card = findCardByID(cards, rowID);
                if (!card) {
                    return mayHideItems;
                }
                const date = getCardCellValue(card, keyID)?.date;
                return !!date && date.isNotEmpty === expected.isNotEmpty && date.content === expected.content;
            });
            return;
        }
        if (data?.type === "text" && data.text) {
            const expected = data.text.content || "";
            checks.push((cards, mayHideItems) => {
                const card = findCardByID(cards, rowID);
                if (!card) {
                    return mayHideItems;
                }
                return getCardTextContent(card, keyID) === expected;
            });
        }
    });
    return checks;
};
const readCalendarCards = async (target) => {
    const response = await (0, fetch_1.fetchSyncPost)("/api/av/renderAttributeView", {
        id: target.avID,
        blockID: target.blockID,
        viewID: target.viewID || "",
        pageSize: -1,
        createIfNotExist: false,
    });
    if (response?.code !== 0) {
        return undefined;
    }
    const view = response.data?.view;
    if (!view || !Array.isArray(view.cards)) {
        return undefined;
    }
    const cards = [...view.cards];
    (view.groups || []).forEach(group => {
        (group.cards || []).forEach(card => cards.push(card));
    });
    return {
        cards,
        mayHideItems: (view.filters || []).length > 0 || (view.groups || []).length > 0,
    };
};
const verifyCalendarWrite = async (target, doOperations) => {
    const checks = buildWriteChecks(doOperations);
    if (checks.length === 0) {
        return true;
    }
    const readBack = await readCalendarCards(target);
    if (!readBack) {
        return true;
    }
    return checks.every(check => check(readBack.cards, readBack.mayHideItems));
};
const executeCalendarOperations = async (protyle, ops, target) => {
    if (ops.doOperations.length === 0) {
        return false;
    }
    const response = await (0, fetch_1.fetchSyncPost)("/api/transactions", {
        session: protyle?.id || constants_1.Constants.SIYUAN_APPID,
        app: constants_1.Constants.SIYUAN_APPID,
        transactions: [{
                doOperations: ops.doOperations,
                undoOperations: ops.undoOperations,
            }],
    });
    if (response?.code !== 0) {
        return false;
    }
    if (target && !await verifyCalendarWrite(target, ops.doOperations)) {
        // The kernel dropped at least part of the transaction; never report a
        // success the persisted data does not back, and do not register an undo
        // step for a write that did not happen.
        return false;
    }
    if (protyle && ops.undoOperations.length > 0) {
        if (window.siyuan.config.fileTree.openFilesUseCurrentTab && protyle.model) {
            protyle.model.headElement.classList.remove("item--unupdate");
        }
        protyle.updated = true;
        protyle.undo?.add(ops.doOperations, ops.undoOperations, protyle);
    }
    return true;
};
const addMetadataUpdate = (ops, options) => {
    if (!options.fieldID || options.value === undefined) {
        return;
    }
    const field = (0, model_1.getFieldByID)(options.fields, options.fieldID);
    if (!field || field.type !== "text") {
        return;
    }
    const oldValue = (0, model_1.cloneCellValue)(options.oldCell?.value) || (options.undoEmptyWhenMissing ? buildEmptyTextLikeValue(field) : undefined);
    const newValue = buildTextLikeValue(field, options.value, oldValue);
    pushUpdate(ops, {
        avID: options.avID,
        rowID: options.rowID,
        keyID: options.fieldID,
        oldValue,
        newValue,
    });
};
const buildOccurrenceExceptionOperations = (options) => {
    const ops = { doOperations: [], undoOperations: [] };
    const oldCell = (0, model_1.getCellByFieldID)(options.event.sourceCard, options.mapping.exceptionFieldID);
    const existing = (options.event.recurrenceExceptions || []).filter(item => item !== options.occurrenceDate);
    existing.push(options.occurrenceDate);
    existing.sort();
    addMetadataUpdate(ops, {
        avID: options.avID,
        rowID: options.event.id,
        fields: options.fields,
        fieldID: options.mapping.exceptionFieldID,
        value: existing.join(","),
        oldCell,
        undoEmptyWhenMissing: true,
    });
    if (ops.doOperations.length > 0) {
        pushUpdated(ops, options.blockID, options.previousUpdated);
    }
    return ops;
};
exports.buildOccurrenceExceptionOperations = buildOccurrenceExceptionOperations;
const buildSplitSeriesOperations = (options) => {
    if (!isRealDateInputValue(options.draft.date)) {
        return { doOperations: [], undoOperations: [] };
    }
    const recurrenceRaw = getEventRecurrenceRaw(options.event);
    const untilDate = dayjs(options.occurrenceDate).subtract(1, "day").format("YYYY-MM-DD");
    const truncatedRecurrence = recurrenceWithUntil(recurrenceRaw, untilDate);
    const truncateOps = { doOperations: [], undoOperations: [] };
    addMetadataUpdate(truncateOps, {
        avID: options.avID,
        rowID: options.event.id,
        fields: options.fields,
        fieldID: options.mapping.recurrenceFieldID,
        value: truncatedRecurrence,
        oldCell: (0, model_1.getCellByFieldID)(options.event.sourceCard, options.mapping.recurrenceFieldID),
        undoEmptyWhenMissing: true,
    });
    if (truncateOps.doOperations.length > 0) {
        pushUpdated(truncateOps, options.blockID, options.previousUpdated);
    }
    const createOps = (0, exports.buildCreateEventOperations)({
        avID: options.avID,
        blockID: options.blockID,
        dateFieldID: options.dateFieldID,
        fields: options.fields,
        mapping: options.mapping,
        draft: {
            ...options.draft,
            recurrenceRaw: recurrenceForSplitFuture(normalizeRecurrenceValue(options.draft.recurrenceRaw) || recurrenceRaw, options.event, options.occurrenceDate, recurrenceRaw),
            recurrenceExceptionRaw: "",
        },
        previousUpdated: options.previousUpdated,
    });
    return {
        doOperations: [...truncateOps.doOperations, ...createOps.doOperations],
        undoOperations: [...createOps.undoOperations, ...truncateOps.undoOperations],
    };
};
exports.buildSplitSeriesOperations = buildSplitSeriesOperations;
const addColorUpdate = (ops, options) => {
    if (!options.fieldID || options.value === undefined) {
        return;
    }
    const field = (0, model_1.getFieldByID)(options.fields, options.fieldID);
    if (!field || !["select", "mSelect"].includes(field.type)) {
        return;
    }
    const oldValue = (0, model_1.cloneCellValue)(options.oldCell?.value) || (options.undoEmptyWhenMissing ? buildEmptySelectValue(field) : undefined);
    const newValue = buildSelectValue(field, options.value, oldValue);
    pushUpdate(ops, {
        avID: options.avID,
        rowID: options.rowID,
        keyID: options.fieldID,
        oldValue,
        newValue,
    });
};
const buildCreateEventOperations = (options) => {
    const dateValue = buildDateValue(options.draft);
    if (!dateValue) {
        return { doOperations: [], undoOperations: [] };
    }
    // ONE id only: AddAttributeViewBlock() in kernel/model/attribute_view.go
    // creates the item under srcs[].itemID and only reads srcs[].id as the bound
    // block id (ignored for detached rows). Minting a second id here would make
    // every updateAttrViewCell below address a row that does not exist, and the
    // kernel would silently store those values as orphans.
    const rowID = Lute.NewNodeID();
    const ops = { doOperations: [], undoOperations: [] };
    ops.doOperations.push({
        action: "insertAttrViewBlock",
        avID: options.avID,
        previousID: "",
        srcs: [{ itemID: rowID, id: rowID, isDetached: true, content: options.draft.title }],
        blockID: options.blockID,
        context: { ignoreTip: "true" },
    });
    pushUpdate(ops, {
        avID: options.avID,
        rowID,
        keyID: options.dateFieldID,
        newValue: dateValue,
    });
    addMetadataUpdate(ops, {
        avID: options.avID,
        rowID,
        fields: options.fields,
        fieldID: options.mapping.recurrenceFieldID,
        value: normalizeRecurrenceValue(options.draft.recurrenceRaw),
    });
    addMetadataUpdate(ops, {
        avID: options.avID,
        rowID,
        fields: options.fields,
        fieldID: options.mapping.exceptionFieldID,
        value: options.draft.recurrenceExceptionRaw,
    });
    addMetadataUpdate(ops, {
        avID: options.avID,
        rowID,
        fields: options.fields,
        fieldID: options.mapping.locationFieldID,
        value: options.draft.location,
    });
    addMetadataUpdate(ops, {
        avID: options.avID,
        rowID,
        fields: options.fields,
        fieldID: options.mapping.descriptionFieldID,
        value: options.draft.description,
    });
    addColorUpdate(ops, {
        avID: options.avID,
        rowID,
        fields: options.fields,
        fieldID: options.mapping.colorFieldID,
        value: options.draft.colorContent,
    });
    ops.undoOperations.push({ action: "removeAttrViewBlock", srcIDs: [rowID], avID: options.avID });
    pushUpdated(ops, options.blockID, options.previousUpdated);
    return ops;
};
exports.buildCreateEventOperations = buildCreateEventOperations;
const buildUpdateEventOperations = (options) => {
    const dateValue = buildDateValue(options.draft);
    if (!dateValue) {
        return { doOperations: [], undoOperations: [] };
    }
    const ops = { doOperations: [], undoOperations: [] };
    const blockCell = (0, model_1.getBlockCell)(options.event.sourceCard);
    pushUpdate(ops, {
        avID: options.avID,
        rowID: options.event.id,
        keyID: blockCell?.value?.keyID,
        oldValue: (0, model_1.cloneCellValue)(blockCell?.value),
        newValue: buildBlockValue(options.event, options.draft.title),
    });
    pushUpdate(ops, {
        avID: options.avID,
        rowID: options.event.id,
        keyID: options.dateFieldID,
        oldValue: (0, model_1.cloneCellValue)(options.event.dateCell?.value),
        newValue: dateValue,
    });
    addMetadataUpdate(ops, {
        avID: options.avID,
        rowID: options.event.id,
        fields: options.fields,
        fieldID: options.mapping.recurrenceFieldID,
        value: normalizeRecurrenceValue(options.draft.recurrenceRaw),
        oldCell: (0, model_1.getCellByFieldID)(options.event.sourceCard, options.mapping.recurrenceFieldID),
        undoEmptyWhenMissing: true,
    });
    addMetadataUpdate(ops, {
        avID: options.avID,
        rowID: options.event.id,
        fields: options.fields,
        fieldID: options.mapping.locationFieldID,
        value: options.draft.location,
        oldCell: (0, model_1.getCellByFieldID)(options.event.sourceCard, options.mapping.locationFieldID),
        undoEmptyWhenMissing: true,
    });
    addMetadataUpdate(ops, {
        avID: options.avID,
        rowID: options.event.id,
        fields: options.fields,
        fieldID: options.mapping.descriptionFieldID,
        value: options.draft.description,
        oldCell: (0, model_1.getCellByFieldID)(options.event.sourceCard, options.mapping.descriptionFieldID),
        undoEmptyWhenMissing: true,
    });
    addColorUpdate(ops, {
        avID: options.avID,
        rowID: options.event.id,
        fields: options.fields,
        fieldID: options.mapping.colorFieldID,
        value: options.draft.colorContent,
        oldCell: (0, model_1.getCellByFieldID)(options.event.sourceCard, options.mapping.colorFieldID),
        undoEmptyWhenMissing: true,
    });
    if (ops.doOperations.length > 0) {
        pushUpdated(ops, options.blockID, options.previousUpdated);
    }
    return ops;
};
exports.buildUpdateEventOperations = buildUpdateEventOperations;
const buildDeleteEventOperations = (options) => {
    const ops = { doOperations: [], undoOperations: [] };
    const blockCell = (0, model_1.getBlockCell)(options.event.sourceCard);
    const blockValue = blockCell?.value;
    const cellSnapshots = options.event.sourceCard.values
        .map(cell => ({ keyID: cell.value?.keyID, value: (0, model_1.cloneCellValue)(cell.value) }))
        .filter(item => item.keyID && item.value);
    const isDetached = blockValue?.isDetached ?? true;
    ops.doOperations.push({ action: "removeAttrViewBlock", avID: options.avID, srcIDs: [options.event.id] });
    ops.undoOperations.push({
        action: "insertAttrViewBlock",
        avID: options.avID,
        blockID: options.blockID,
        previousID: "",
        srcs: [{
                // itemID is the ITEM id the kernel restores the row under, so it must
                // be the deleted event's own id - a freshly minted one would leave a
                // phantom duplicate row behind after every Ctrl+Z. srcs[].id is the
                // BOUND BLOCK id: keep the real block for bound rows, and fall back to
                // the item id for detached rows where the kernel ignores it anyway.
                itemID: options.event.id,
                id: (!isDetached && blockValue?.block?.id) || options.event.id,
                isDetached,
                content: blockValue?.block?.content || options.event.title || "",
            }],
    });
    cellSnapshots.forEach(item => {
        ops.undoOperations.push({
            action: "updateAttrViewCell",
            avID: options.avID,
            keyID: item.keyID,
            rowID: options.event.id,
            data: item.value,
        });
    });
    pushUpdated(ops, options.blockID, options.previousUpdated);
    return ops;
};
exports.buildDeleteEventOperations = buildDeleteEventOperations;
const createCalendarEvent = async (options) => {
    return executeCalendarOperations(options.protyle, (0, exports.buildCreateEventOperations)(options), options);
};
exports.createCalendarEvent = createCalendarEvent;
const createCalendarEventReplacingOccurrence = async (options) => {
    const exceptionOps = (0, exports.buildOccurrenceExceptionOperations)({
        avID: options.avID,
        blockID: options.blockID,
        fields: options.fields,
        mapping: options.mapping,
        event: options.event,
        occurrenceDate: options.occurrenceDate,
        previousUpdated: options.previousUpdated,
    });
    const createOps = (0, exports.buildCreateEventOperations)({
        avID: options.avID,
        blockID: options.blockID,
        dateFieldID: options.dateFieldID,
        fields: options.fields,
        mapping: options.mapping,
        draft: {
            ...options.draft,
            recurrenceRaw: "",
            recurrenceExceptionRaw: "",
        },
        previousUpdated: options.previousUpdated,
    });
    if (exceptionOps.doOperations.length === 0 || createOps.doOperations.length === 0) {
        return false;
    }
    return executeCalendarOperations(options.protyle, {
        doOperations: [...exceptionOps.doOperations, ...createOps.doOperations],
        undoOperations: [...createOps.undoOperations, ...exceptionOps.undoOperations],
    }, options);
};
exports.createCalendarEventReplacingOccurrence = createCalendarEventReplacingOccurrence;
const updateCalendarEvent = async (options) => {
    if (!isRealDateInputValue(options.draft.date)) {
        return false;
    }
    const ops = (0, exports.buildUpdateEventOperations)(options);
    if (ops.doOperations.length > 0) {
        return executeCalendarOperations(options.protyle, ops, options);
    }
    return true;
};
exports.updateCalendarEvent = updateCalendarEvent;
const updateCalendarEventThisAndFuture = async (options) => {
    if (!isRealDateInputValue(options.draft.date)) {
        return false;
    }
    const ops = (0, exports.buildSplitSeriesOperations)(options);
    if (ops.doOperations.length > 0) {
        return executeCalendarOperations(options.protyle, ops, options);
    }
    return true;
};
exports.updateCalendarEventThisAndFuture = updateCalendarEventThisAndFuture;
const deleteCalendarEvent = async (options) => {
    return executeCalendarOperations(options.protyle, (0, exports.buildDeleteEventOperations)(options), options);
};
exports.deleteCalendarEvent = deleteCalendarEvent;
const deleteCalendarOccurrence = async (options) => {
    const ops = (0, exports.buildOccurrenceExceptionOperations)(options);
    if (ops.doOperations.length > 0) {
        return executeCalendarOperations(options.protyle, ops, options);
    }
    return false;
};
exports.deleteCalendarOccurrence = deleteCalendarOccurrence;
