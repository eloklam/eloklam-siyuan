import * as dayjs from "dayjs";

export interface ICalendarRange {
    start: dayjs.Dayjs;
    end: dayjs.Dayjs;
}

export interface ICalendarFieldMapping {
    dateFieldID: string;
    recurrenceFieldID?: string;
    exceptionFieldID?: string;
    locationFieldID?: string;
    descriptionFieldID?: string;
    colorFieldID?: string;
    hasDateField: boolean;
}

export interface ICalendarRecurrence {
    freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
    interval?: number;
    count?: number;
    until?: dayjs.Dayjs;
    byDay?: string[];
    raw?: string;
}

export interface ICalendarEventDraft {
    title: string;
    date: string;
    endDate?: string;
    isAllDay: boolean;
    startTime: string;
    endTime: string;
    recurrenceRaw?: string;
    recurrenceExceptionRaw?: string;
    location?: string;
    description?: string;
    color?: string;
    colorContent?: string;
}

export interface ICalendarNormalizedEvent {
    id: string;
    blockID?: string;
    title: string;
    start: dayjs.Dayjs;
    end?: dayjs.Dayjs;
    isAllDay: boolean;
    dateCell?: IAVCell;
    recurrence?: ICalendarRecurrence;
    recurrenceRaw?: string;
    recurrenceExceptionRaw?: string;
    recurrenceExceptions?: string[];
    location?: string;
    description?: string;
    color?: string;
    colorContent?: string;
    sourceCard: IAVGalleryItem;
    isOccurrence?: boolean;
    occurrenceID?: string;
    baseEventID?: string;
}

export const getCellByFieldID = (card: IAVGalleryItem, fieldID?: string): IAVCell | undefined => {
    if (!fieldID) {
        return undefined;
    }
    return card.values.find(item => item.value?.keyID === fieldID || item.id === fieldID);
};

export const getBlockCell = (card: IAVGalleryItem): IAVCell | undefined => {
    return card.values.find(item => item.valueType === "block" || item.value?.type === "block");
};

export const getTextFromCell = (cell?: IAVCell): string => {
    const value = cell?.value;
    if (!value) {
        return "";
    }
    return value.text?.content || value.template?.content || value.block?.content || value.url?.content || "";
};

export const cloneCellValue = (value?: IAVCellValue): IAVCellValue | undefined => {
    if (!value) {
        return undefined;
    }
    return JSON.parse(JSON.stringify(value));
};

export const getFieldByID = (fields: IAVColumn[], fieldID?: string): IAVColumn | undefined => {
    if (!fieldID) {
        return undefined;
    }
    return fields.find(field => field.id === fieldID);
};
