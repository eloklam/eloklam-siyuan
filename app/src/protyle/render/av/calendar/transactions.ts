import * as dayjs from "dayjs";
import {transaction} from "../../../wysiwyg/transaction";
import {cloneCellValue, getBlockCell, getCellByFieldID, getFieldByID, ICalendarEventDraft, ICalendarFieldMapping, ICalendarNormalizedEvent} from "./model";

export interface ICalendarOperationSet {
    doOperations: IOperation[];
    undoOperations: IOperation[];
}

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const normalizeRecurrenceValue = (value?: string) => {
    const trimmed = (value || "").trim();
    return trimmed.toLowerCase() === "none" ? "" : trimmed;
};

const recurrenceWithUntil = (value: string | undefined, untilDate: string) => {
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

const getEventRecurrenceRaw = (event: ICalendarNormalizedEvent) => event.recurrenceRaw || event.recurrence?.raw || event.recurrence?.freq || "";

const weekdayMap: { [key: string]: number } = {SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6};

const addRecurringStep = (date: dayjs.Dayjs, event: ICalendarNormalizedEvent) => {
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

const countOccurrencesBefore = (event: ICalendarNormalizedEvent, occurrenceDate: string) => {
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

const recurrenceCount = (value: string) => {
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

const recurrenceWithCount = (value: string, count: number) => {
    const upper = value.toUpperCase();
    if (!upper.includes("COUNT=")) {
        return value;
    }
    return upper.split(";").filter(Boolean).map(part => part.startsWith("COUNT=") ? `COUNT=${count}` : part).join(";");
};

const recurrenceForSplitFuture = (value: string, event: ICalendarNormalizedEvent, occurrenceDate: string, originalValue: string) => {
    const count = recurrenceCount(value);
    if (!count || value.toUpperCase() !== originalValue.toUpperCase()) {
        return value;
    }
    return recurrenceWithCount(value, Math.max(count - countOccurrencesBefore(event, occurrenceDate), 1));
};

const isRealDateInputValue = (value?: string) => {
    if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }
    const parsed = dayjs(value);
    return parsed.isValid() && parsed.format("YYYY-MM-DD") === value;
};

const getTimeInputValue = (value: string | undefined, fallback: string) => {
    return value && /^\d{2}:\d{2}$/.test(value) ? value : fallback;
};

const buildDateValue = (draft: ICalendarEventDraft): IAVCellValue | undefined => {
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

const buildTextLikeValue = (field: IAVColumn, value: string, oldValue?: IAVCellValue): IAVCellValue => {
    const type = field.type === "template" ? "template" : "text";
    const base = oldValue ? clone(oldValue) : {type, keyID: field.id} as IAVCellValue;
    base.type = type;
    base.keyID = field.id;
    if (type === "template") {
        base.template = {content: value};
        delete base.text;
    } else {
        base.text = {content: value};
        delete base.template;
    }
    return base;
};

const buildEmptyTextLikeValue = (field: IAVColumn) => buildTextLikeValue(field, "");

const buildSelectValue = (field: IAVColumn, value?: string, oldValue?: IAVCellValue): IAVCellValue | undefined => {
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
    const base = oldValue ? clone(oldValue) : {type: field.type, keyID: field.id} as IAVCellValue;
    base.type = field.type;
    base.keyID = field.id;
    base.mSelect = field.type === "mSelect" ? [selectValue] : [selectValue];
    return base;
};

const buildEmptySelectValue = (field: IAVColumn): IAVCellValue => ({
    type: field.type,
    keyID: field.id,
    mSelect: [],
} as IAVCellValue);

const buildBlockValue = (event: ICalendarNormalizedEvent, title: string): IAVCellValue | undefined => {
    const blockCell = getBlockCell(event.sourceCard);
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

const pushUpdate = (ops: ICalendarOperationSet, options: {
    avID: string;
    rowID: string;
    keyID?: string;
    oldValue?: IAVCellValue;
    newValue?: IAVCellValue;
}) => {
    if (!options.keyID || !options.newValue) {
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

const pushUpdated = (ops: ICalendarOperationSet, blockID: string, previousUpdated = "") => {
    const newUpdated = dayjs().format("YYYYMMDDHHmmss");
    ops.doOperations.push({action: "doUpdateUpdated", id: blockID, data: newUpdated});
    ops.undoOperations.push({action: "doUpdateUpdated", id: blockID, data: previousUpdated});
};

const addMetadataUpdate = (ops: ICalendarOperationSet, options: {
    avID: string;
    rowID: string;
    fields: IAVColumn[];
    fieldID?: string;
    value?: string;
    oldCell?: IAVCell;
    undoEmptyWhenMissing?: boolean;
}) => {
    if (!options.fieldID || options.value === undefined) {
        return;
    }
    const field = getFieldByID(options.fields, options.fieldID);
    if (!field || !["text", "template"].includes(field.type)) {
        return;
    }
    const oldValue = cloneCellValue(options.oldCell?.value) || (options.undoEmptyWhenMissing ? buildEmptyTextLikeValue(field) : undefined);
    const newValue = buildTextLikeValue(field, options.value, oldValue);
    pushUpdate(ops, {
        avID: options.avID,
        rowID: options.rowID,
        keyID: options.fieldID,
        oldValue,
        newValue,
    });
};

export const buildOccurrenceExceptionOperations = (options: {
    avID: string;
    blockID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    event: ICalendarNormalizedEvent;
    occurrenceDate: string;
    previousUpdated?: string;
}): ICalendarOperationSet => {
    const ops: ICalendarOperationSet = {doOperations: [], undoOperations: []};
    const oldCell = getCellByFieldID(options.event.sourceCard, options.mapping.exceptionFieldID);
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

export const buildSplitSeriesOperations = (options: {
    avID: string;
    blockID: string;
    dateFieldID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    event: ICalendarNormalizedEvent;
    draft: ICalendarEventDraft;
    occurrenceDate: string;
    previousUpdated?: string;
}): ICalendarOperationSet => {
    if (!isRealDateInputValue(options.draft.date)) {
        return {doOperations: [], undoOperations: []};
    }
    const recurrenceRaw = getEventRecurrenceRaw(options.event);
    const untilDate = dayjs(options.occurrenceDate).subtract(1, "day").format("YYYY-MM-DD");
    const truncatedRecurrence = recurrenceWithUntil(recurrenceRaw, untilDate);
    const truncateOps: ICalendarOperationSet = {doOperations: [], undoOperations: []};
    addMetadataUpdate(truncateOps, {
        avID: options.avID,
        rowID: options.event.id,
        fields: options.fields,
        fieldID: options.mapping.recurrenceFieldID,
        value: truncatedRecurrence,
        oldCell: getCellByFieldID(options.event.sourceCard, options.mapping.recurrenceFieldID),
        undoEmptyWhenMissing: true,
    });
    if (truncateOps.doOperations.length > 0) {
        pushUpdated(truncateOps, options.blockID, options.previousUpdated);
    }
    const createOps = buildCreateEventOperations({
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

const addColorUpdate = (ops: ICalendarOperationSet, options: {
    avID: string;
    rowID: string;
    fields: IAVColumn[];
    fieldID?: string;
    value?: string;
    oldCell?: IAVCell;
    undoEmptyWhenMissing?: boolean;
}) => {
    if (!options.fieldID || options.value === undefined) {
        return;
    }
    const field = getFieldByID(options.fields, options.fieldID);
    if (!field || !["select", "mSelect"].includes(field.type)) {
        return;
    }
    const oldValue = cloneCellValue(options.oldCell?.value) || (options.undoEmptyWhenMissing ? buildEmptySelectValue(field) : undefined);
    const newValue = buildSelectValue(field, options.value, oldValue);
    pushUpdate(ops, {
        avID: options.avID,
        rowID: options.rowID,
        keyID: options.fieldID,
        oldValue,
        newValue,
    });
};

export const buildCreateEventOperations = (options: {
    avID: string;
    blockID: string;
    dateFieldID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    draft: ICalendarEventDraft;
    previousUpdated?: string;
}): ICalendarOperationSet => {
    const dateValue = buildDateValue(options.draft);
    if (!dateValue) {
        return {doOperations: [], undoOperations: []};
    }
    const rowID = Lute.NewNodeID();
    const itemID = Lute.NewNodeID();
    const ops: ICalendarOperationSet = {doOperations: [], undoOperations: []};
    ops.doOperations.push({
        action: "insertAttrViewBlock",
        avID: options.avID,
        previousID: "",
        srcs: [{itemID, id: rowID, isDetached: true, content: options.draft.title}],
        blockID: options.blockID,
        context: {ignoreTip: "true"},
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
    ops.undoOperations.push({action: "removeAttrViewBlock", srcIDs: [rowID], avID: options.avID});
    pushUpdated(ops, options.blockID, options.previousUpdated);
    return ops;
};

export const buildUpdateEventOperations = (options: {
    avID: string;
    blockID: string;
    dateFieldID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    event: ICalendarNormalizedEvent;
    draft: ICalendarEventDraft;
    previousUpdated?: string;
}): ICalendarOperationSet => {
    const dateValue = buildDateValue(options.draft);
    if (!dateValue) {
        return {doOperations: [], undoOperations: []};
    }
    const ops: ICalendarOperationSet = {doOperations: [], undoOperations: []};
    const blockCell = getBlockCell(options.event.sourceCard);
    pushUpdate(ops, {
        avID: options.avID,
        rowID: options.event.id,
        keyID: blockCell?.value?.keyID,
        oldValue: cloneCellValue(blockCell?.value),
        newValue: buildBlockValue(options.event, options.draft.title),
    });
    pushUpdate(ops, {
        avID: options.avID,
        rowID: options.event.id,
        keyID: options.dateFieldID,
        oldValue: cloneCellValue(options.event.dateCell?.value),
        newValue: dateValue,
    });
    addMetadataUpdate(ops, {
        avID: options.avID,
        rowID: options.event.id,
        fields: options.fields,
        fieldID: options.mapping.recurrenceFieldID,
        value: normalizeRecurrenceValue(options.draft.recurrenceRaw),
        oldCell: getCellByFieldID(options.event.sourceCard, options.mapping.recurrenceFieldID),
        undoEmptyWhenMissing: true,
    });
    addMetadataUpdate(ops, {
        avID: options.avID,
        rowID: options.event.id,
        fields: options.fields,
        fieldID: options.mapping.locationFieldID,
        value: options.draft.location,
        oldCell: getCellByFieldID(options.event.sourceCard, options.mapping.locationFieldID),
        undoEmptyWhenMissing: true,
    });
    addMetadataUpdate(ops, {
        avID: options.avID,
        rowID: options.event.id,
        fields: options.fields,
        fieldID: options.mapping.descriptionFieldID,
        value: options.draft.description,
        oldCell: getCellByFieldID(options.event.sourceCard, options.mapping.descriptionFieldID),
        undoEmptyWhenMissing: true,
    });
    addColorUpdate(ops, {
        avID: options.avID,
        rowID: options.event.id,
        fields: options.fields,
        fieldID: options.mapping.colorFieldID,
        value: options.draft.colorContent,
        oldCell: getCellByFieldID(options.event.sourceCard, options.mapping.colorFieldID),
        undoEmptyWhenMissing: true,
    });
    if (ops.doOperations.length > 0) {
        pushUpdated(ops, options.blockID, options.previousUpdated);
    }
    return ops;
};

export const buildDeleteEventOperations = (options: {
    avID: string;
    blockID: string;
    event: ICalendarNormalizedEvent;
    previousUpdated?: string;
}): ICalendarOperationSet => {
    const ops: ICalendarOperationSet = {doOperations: [], undoOperations: []};
    const blockCell = getBlockCell(options.event.sourceCard);
    const blockValue = blockCell?.value;
    const cellSnapshots = options.event.sourceCard.values
        .map(cell => ({keyID: cell.value?.keyID, value: cloneCellValue(cell.value)}))
        .filter(item => item.keyID && item.value);
    ops.doOperations.push({action: "removeAttrViewBlock", avID: options.avID, srcIDs: [options.event.id]});
    ops.undoOperations.push({
        action: "insertAttrViewBlock",
        avID: options.avID,
        blockID: options.blockID,
        previousID: "",
        srcs: [{
            itemID: Lute.NewNodeID(),
            id: options.event.id,
            isDetached: blockValue?.isDetached ?? true,
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

export const createCalendarEvent = (options: {
    protyle: IProtyle;
    avID: string;
    blockID: string;
    dateFieldID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    draft: ICalendarEventDraft;
    previousUpdated?: string;
}) => {
    const ops = buildCreateEventOperations(options);
    if (ops.doOperations.length === 0) {
        return false;
    }
    transaction(options.protyle, ops.doOperations, ops.undoOperations);
    return true;
};

export const createCalendarEventReplacingOccurrence = (options: {
    protyle: IProtyle;
    avID: string;
    blockID: string;
    dateFieldID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    event: ICalendarNormalizedEvent;
    draft: ICalendarEventDraft;
    occurrenceDate: string;
    previousUpdated?: string;
}) => {
    const exceptionOps = buildOccurrenceExceptionOperations({
        avID: options.avID,
        blockID: options.blockID,
        fields: options.fields,
        mapping: options.mapping,
        event: options.event,
        occurrenceDate: options.occurrenceDate,
        previousUpdated: options.previousUpdated,
    });
    const createOps = buildCreateEventOperations({
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
    transaction(options.protyle, [...exceptionOps.doOperations, ...createOps.doOperations], [...createOps.undoOperations, ...exceptionOps.undoOperations]);
    return true;
};

export const updateCalendarEvent = (options: {
    protyle: IProtyle;
    avID: string;
    blockID: string;
    dateFieldID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    event: ICalendarNormalizedEvent;
    draft: ICalendarEventDraft;
    previousUpdated?: string;
}) => {
    const ops = buildUpdateEventOperations(options);
    if (ops.doOperations.length > 0) {
        transaction(options.protyle, ops.doOperations, ops.undoOperations);
        return true;
    }
    return false;
};

export const updateCalendarEventThisAndFuture = (options: {
    protyle: IProtyle;
    avID: string;
    blockID: string;
    dateFieldID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    event: ICalendarNormalizedEvent;
    draft: ICalendarEventDraft;
    occurrenceDate: string;
    previousUpdated?: string;
}) => {
    const ops = buildSplitSeriesOperations(options);
    if (ops.doOperations.length > 0) {
        transaction(options.protyle, ops.doOperations, ops.undoOperations);
        return true;
    }
    return false;
};

export const deleteCalendarEvent = (options: {
    protyle: IProtyle;
    avID: string;
    blockID: string;
    event: ICalendarNormalizedEvent;
    previousUpdated?: string;
}) => {
    const ops = buildDeleteEventOperations(options);
    transaction(options.protyle, ops.doOperations, ops.undoOperations);
    return true;
};

export const deleteCalendarOccurrence = (options: {
    protyle: IProtyle;
    avID: string;
    blockID: string;
    fields: IAVColumn[];
    mapping: ICalendarFieldMapping;
    event: ICalendarNormalizedEvent;
    occurrenceDate: string;
    previousUpdated?: string;
}) => {
    const ops = buildOccurrenceExceptionOperations(options);
    if (ops.doOperations.length > 0) {
        transaction(options.protyle, ops.doOperations, ops.undoOperations);
        return true;
    }
    return false;
};
