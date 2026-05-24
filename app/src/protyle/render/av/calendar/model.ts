import * as dayjs from "dayjs";

export interface ICalendarRange {
    start: dayjs.Dayjs;
    end: dayjs.Dayjs;
}

export interface ICalendarFieldMapping {
    dateFieldID: string;
    recurrenceFieldID?: string;
    locationFieldID?: string;
    descriptionFieldID?: string;
    hasDateField: boolean;
}

export interface ICalendarRecurrence {
    freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
    interval?: number;
    count?: number;
    until?: dayjs.Dayjs;
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
    location?: string;
    description?: string;
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

