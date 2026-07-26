import {ICalendarFieldMapping, getCellByFieldID, getTextFromCell} from "./model";

const getMappedFieldID = (calendarData: IAVCalendar, fieldID: string | undefined, allowedTypes: TAVCol[]) => {
    if (!fieldID) {
        return undefined;
    }
    return calendarData.fields.some(field => field.id === fieldID && allowedTypes.includes(field.type)) ? fieldID : undefined;
};

export const getCalendarFieldMapping = (calendarData: IAVCalendar): ICalendarFieldMapping => {
    const persistedDateFieldID = calendarData.dateFieldID || "";
    const persisted = calendarData.fieldMapping || {};
    const hasDateField = !!persistedDateFieldID && calendarData.fields.some(field => field.id === persistedDateFieldID && field.type === "date");
    return {
        // A stale or wrong-typed persisted date field must not satisfy the
        // write-path guards, so only expose it when it is actually usable.
        dateFieldID: hasDateField ? persistedDateFieldID : "",
        recurrenceFieldID: getMappedFieldID(calendarData, persisted.recurrenceFieldID, ["text", "template"]),
        exceptionFieldID: getMappedFieldID(calendarData, persisted.exceptionFieldID, ["text", "template"]),
        locationFieldID: getMappedFieldID(calendarData, persisted.locationFieldID, ["text", "template"]),
        descriptionFieldID: getMappedFieldID(calendarData, persisted.descriptionFieldID, ["text", "template"]),
        colorFieldID: getMappedFieldID(calendarData, persisted.colorFieldID, ["select", "mSelect"]),
        hasDateField,
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

