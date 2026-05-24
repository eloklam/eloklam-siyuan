import * as dayjs from "dayjs";
import {expandRecurrences, parseRecurrence} from "./recurrence";
import {getBlockCell, getCellByFieldID, getTextFromCell, ICalendarFieldMapping, ICalendarNormalizedEvent, ICalendarRange} from "./model";
import {getMappedMetadata} from "./mapped-fields";

const normalizeCard = (card: IAVGalleryItem, mapping: ICalendarFieldMapping): ICalendarNormalizedEvent | undefined => {
    const dateCell = getCellByFieldID(card, mapping.dateFieldID);
    const dateValue = dateCell?.value?.date;
    if (!dateValue?.isNotEmpty || !dateValue.content) {
        return undefined;
    }
    const blockCell = getBlockCell(card);
    const blockValue = blockCell?.value?.block;
    const metadata = getMappedMetadata(card, mapping);
    const start = dayjs(dateValue.content);
    if (!start.isValid()) {
        return undefined;
    }
    const rawEnd = dateValue.hasEndDate && dateValue.content2 ? dayjs(dateValue.content2) : undefined;
    const end = rawEnd?.isValid() ? rawEnd : (dateValue.isNotTime === false ? start.add(1, "hour") : start.endOf("day"));
    return {
        id: card.id,
        blockID: blockValue?.id,
        title: blockValue?.content || getTextFromCell(blockCell) || window.siyuan.languages.untitled,
        start,
        end,
        isAllDay: dateValue.isNotTime !== false,
        dateCell,
        recurrence: parseRecurrence(metadata.recurrence),
        recurrenceRaw: metadata.recurrence,
        recurrenceExceptionRaw: metadata.recurrenceException,
        recurrenceExceptions: parseRecurrenceExceptions(metadata.recurrenceException),
        location: metadata.location,
        description: metadata.description,
        color: metadata.color,
        colorContent: metadata.colorContent,
        sourceCard: card,
    };
};

const normalizeExceptionDate = (value: string) => {
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return value;
    }
    if (/^\d{8}$/.test(value)) {
        return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
    }
    const dateTimeMatch = value.match(/^(\d{4})(\d{2})(\d{2})T\d{6}Z?$/);
    if (dateTimeMatch) {
        return `${dateTimeMatch[1]}-${dateTimeMatch[2]}-${dateTimeMatch[3]}`;
    }
    return "";
};

const parseRecurrenceExceptions = (value = "") => {
    return value.split(/[\s,;]+/).map(item => normalizeExceptionDate(item.trim())).filter(Boolean);
};

export const normalizeCalendarEvents = (
    calendarData: IAVCalendar,
    mapping: ICalendarFieldMapping,
    range: ICalendarRange
): { events: ICalendarNormalizedEvent[]; baseEventsByID: Map<string, ICalendarNormalizedEvent> } => {
    if (!mapping.hasDateField || !calendarData.cards) {
        return {events: [], baseEventsByID: new Map()};
    }
    const baseEvents: ICalendarNormalizedEvent[] = [];
    calendarData.cards.forEach(card => {
        const event = normalizeCard(card, mapping);
        if (event) {
            baseEvents.push(event);
        }
    });
    const baseEventsByID = new Map<string, ICalendarNormalizedEvent>();
    baseEvents.forEach(event => baseEventsByID.set(event.id, event));
    return {
        events: sortCalendarEvents(expandRecurrences(baseEvents, range)),
        baseEventsByID,
    };
};

export const eventOverlapsDay = (event: ICalendarNormalizedEvent, day: dayjs.Dayjs) => {
    const dayStart = day.startOf("day");
    const dayEnd = day.endOf("day");
    const eventEnd = event.end || event.start;
    return !eventEnd.isBefore(dayStart) && !event.start.isAfter(dayEnd);
};

export const sortCalendarEvents = (events: ICalendarNormalizedEvent[]) => {
    return [...events].sort((a, b) => {
        if (a.isAllDay !== b.isAllDay) {
            return a.isAllDay ? -1 : 1;
        }
        const startDiff = a.start.valueOf() - b.start.valueOf();
        if (startDiff !== 0) {
            return startDiff;
        }
        const endDiff = (a.end?.valueOf() || a.start.valueOf()) - (b.end?.valueOf() || b.start.valueOf());
        if (endDiff !== 0) {
            return endDiff;
        }
        return a.title.localeCompare(b.title);
    });
};
