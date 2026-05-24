import {ICalendarFieldMapping, ICalendarNormalizedEvent, getCellByFieldID, getTextFromCell} from "./model";

const getMappedFieldID = (calendarData: IAVCalendar, fieldID: string | undefined, allowedTypes: TAVCol[]) => {
    if (!fieldID) {
        return undefined;
    }
    return calendarData.fields.some(field => field.id === fieldID && allowedTypes.includes(field.type)) ? fieldID : undefined;
};

export const getCalendarFieldMapping = (calendarData: IAVCalendar): ICalendarFieldMapping => {
    const dateFieldID = calendarData.dateFieldID || "";
    const persisted = calendarData.fieldMapping || {};
    return {
        dateFieldID,
        recurrenceFieldID: getMappedFieldID(calendarData, persisted.recurrenceFieldID, ["text", "template"]),
        exceptionFieldID: getMappedFieldID(calendarData, persisted.exceptionFieldID, ["text", "template"]),
        locationFieldID: getMappedFieldID(calendarData, persisted.locationFieldID, ["text", "template"]),
        descriptionFieldID: getMappedFieldID(calendarData, persisted.descriptionFieldID, ["text", "template"]),
        colorFieldID: getMappedFieldID(calendarData, persisted.colorFieldID, ["select", "mSelect"]),
        hasDateField: !!dateFieldID && calendarData.fields.some(field => field.id === dateFieldID && field.type === "date"),
    };
};

const getSelectColor = (cell?: IAVCell) => {
    const item = cell?.value?.mSelect?.[0];
    if (!item) {
        return {};
    }
    return {
        color: item.color,
        colorContent: item.content,
    };
};

export const getMappedMetadata = (card: IAVGalleryItem, mapping: ICalendarFieldMapping) => {
    const color = getSelectColor(getCellByFieldID(card, mapping.colorFieldID));
    return {
        recurrence: getTextFromCell(getCellByFieldID(card, mapping.recurrenceFieldID)),
        recurrenceException: getTextFromCell(getCellByFieldID(card, mapping.exceptionFieldID)),
        location: getTextFromCell(getCellByFieldID(card, mapping.locationFieldID)),
        description: getTextFromCell(getCellByFieldID(card, mapping.descriptionFieldID)),
        color: color.color,
        colorContent: color.colorContent,
    };
};

export const findExistingCell = (event: ICalendarNormalizedEvent, fieldID?: string): IAVCell | undefined => {
    return getCellByFieldID(event.sourceCard, fieldID);
};

export const buildTextCellUpdate = (options: {
    avID: string;
    event: ICalendarNormalizedEvent;
    fieldID?: string;
    value?: string;
    oldValue?: string;
}): { doOp: IOperation; undoOp: IOperation } | null => {
    const {avID, event, fieldID, value = "", oldValue = ""} = options;
    const cell = findExistingCell(event, fieldID);
    if (!fieldID || !cell?.id) {
        return null;
    }
    const oldCellValue: IAVCellValue = cell.value ? JSON.parse(JSON.stringify(cell.value)) : {
        type: "text",
        id: cell.id,
        keyID: fieldID,
        text: {content: oldValue},
    };
    const newCellValue: IAVCellValue = {
        ...JSON.parse(JSON.stringify(oldCellValue)),
        type: oldCellValue.type === "template" ? "template" : "text",
        id: cell.id,
        keyID: fieldID,
    };
    if (newCellValue.type === "template") {
        newCellValue.template = {content: value};
        delete newCellValue.text;
    } else {
        newCellValue.text = {content: value};
        delete newCellValue.template;
    }
    return {
        doOp: {action: "updateAttrViewCell", id: cell.id, avID, keyID: fieldID, rowID: event.id, data: newCellValue},
        undoOp: {action: "updateAttrViewCell", id: cell.id, avID, keyID: fieldID, rowID: event.id, data: oldCellValue},
    };
};
