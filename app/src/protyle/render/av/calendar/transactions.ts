import * as dayjs from "dayjs";
import {transaction} from "../../../wysiwyg/transaction";
import {ICalendarFieldMapping, ICalendarNormalizedEvent} from "./model";
import {buildTextCellUpdate} from "./mapped-fields";

const buildDateValue = (date: string, isAllDay: boolean, startTime: string, endTime: string): IAVCellValue => {
    const start = isAllDay ? dayjs(date).startOf("day") : dayjs(`${date}T${startTime}`);
    const end = isAllDay ? dayjs(date).endOf("day") : dayjs(`${date}T${endTime}`);
    return {
        type: "date",
        date: {
            content: start.valueOf(),
            isNotEmpty: true,
            content2: end.valueOf(),
            isNotEmpty2: true,
            hasEndDate: true,
            isNotTime: isAllDay,
        },
    };
};

export const createCalendarEvent = (options: {
    protyle: IProtyle;
    avID: string;
    blockID: string;
    dateFieldID: string;
    title: string;
    date: string;
    isAllDay: boolean;
    startTime: string;
    endTime: string;
}) => {
    const newNodeID = Lute.NewNodeID();
    const itemID = Lute.NewNodeID();
    transaction(options.protyle, [{
        action: "insertAttrViewBlock",
        avID: options.avID,
        previousID: "",
        srcs: [{itemID, id: newNodeID, isDetached: true, content: options.title}],
        blockID: options.blockID,
        context: {ignoreTip: "true"},
    }, {
        action: "updateAttrViewCell",
        id: itemID,
        avID: options.avID,
        keyID: options.dateFieldID,
        rowID: newNodeID,
        data: buildDateValue(options.date, options.isAllDay, options.startTime, options.endTime),
    }], [{
        action: "removeAttrViewBlock",
        srcIDs: [newNodeID],
        avID: options.avID,
    }]);
};

export const updateCalendarEvent = (options: {
    protyle: IProtyle;
    avID: string;
    dateFieldID: string;
    event: ICalendarNormalizedEvent;
    title: string;
    date: string;
    isAllDay: boolean;
    startTime: string;
    endTime: string;
    mapping: ICalendarFieldMapping;
    recurrence?: string;
    location?: string;
    description?: string;
}) => {
    const doOps: IOperation[] = [];
    const undoOps: IOperation[] = [];
    if (options.event.dateCell?.id) {
        doOps.push({
            action: "updateAttrViewCell",
            id: options.event.dateCell.id,
            avID: options.avID,
            keyID: options.dateFieldID,
            rowID: options.event.id,
            data: buildDateValue(options.date, options.isAllDay, options.startTime, options.endTime),
        });
        undoOps.push({
            action: "updateAttrViewCell",
            id: options.event.dateCell.id,
            avID: options.avID,
            keyID: options.dateFieldID,
            rowID: options.event.id,
            data: options.event.dateCell.value,
        });
    }
    [
        {fieldID: options.mapping.recurrenceFieldID, value: options.recurrence, oldValue: options.event.recurrence?.freq || ""},
        {fieldID: options.mapping.locationFieldID, value: options.location, oldValue: options.event.location || ""},
        {fieldID: options.mapping.descriptionFieldID, value: options.description, oldValue: options.event.description || ""},
    ].forEach(item => {
        if (item.value === undefined) {
            return;
        }
        const update = buildTextCellUpdate({
            avID: options.avID,
            event: options.event,
            fieldID: item.fieldID,
            value: item.value.trim().toLowerCase() === "none" ? "" : item.value,
            oldValue: item.oldValue,
        });
        if (update) {
            doOps.push(update.doOp);
            undoOps.push(update.undoOp);
        }
    });
    if (doOps.length > 0) {
        transaction(options.protyle, doOps, undoOps);
    }
};

export const deleteCalendarEvent = (options: {
    protyle: IProtyle;
    avID: string;
    blockID: string;
    event: ICalendarNormalizedEvent;
}) => {
    const blockCell = options.event.sourceCard.values.find(v => v.valueType === "block" || v.value?.type === "block");
    const blockValue = blockCell?.value;
    transaction(options.protyle, [{
        action: "removeAttrViewBlock",
        avID: options.avID,
        srcIDs: [options.event.id],
    }], [{
        action: "insertAttrViewBlock",
        avID: options.avID,
        blockID: options.blockID,
        previousID: "",
        srcs: [{
            itemID: options.event.id,
            id: blockValue?.block?.id || options.event.blockID || options.event.id,
            isDetached: blockValue?.isDetached ?? true,
            content: blockValue?.block?.content || options.event.title || "",
        }],
    }]);
};

