import * as dayjs from "dayjs";
import {ICalendarNormalizedEvent, ICalendarRange, ICalendarRecurrence} from "./model";

const isValidFreq = (value: string) => ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(value);

export const parseRecurrence = (value: unknown): ICalendarRecurrence | undefined => {
    if (typeof value !== "string") {
        return undefined;
    }
    const raw = value.trim();
    if (!raw) {
        return undefined;
    }
    const str = raw.toUpperCase();
    if (str === "NONE") {
        return undefined;
    }
    if (isValidFreq(str)) {
        return {freq: str as ICalendarRecurrence["freq"]};
    }
    const result: Partial<ICalendarRecurrence> = {};
    str.split(";").forEach(part => {
        const [key, val] = part.split("=");
        if (key === "FREQ" && isValidFreq(val)) {
            result.freq = val as ICalendarRecurrence["freq"];
        } else if (key === "INTERVAL") {
            const interval = parseInt(val, 10);
            if (interval > 0) {
                result.interval = interval;
            }
        } else if (key === "COUNT") {
            const count = parseInt(val, 10);
            if (count > 0) {
                result.count = count;
            }
        } else if (key === "UNTIL") {
            const until = dayjs(val);
            if (until.isValid()) {
                result.until = until.endOf("day");
            }
        }
    });
    return result.freq ? result as ICalendarRecurrence : undefined;
};

const addFreq = (date: dayjs.Dayjs, recurrence: ICalendarRecurrence) => {
    const interval = recurrence.interval || 1;
    if (recurrence.freq === "DAILY") {
        return date.add(interval, "day");
    }
    if (recurrence.freq === "WEEKLY") {
        return date.add(interval, "week");
    }
    if (recurrence.freq === "MONTHLY") {
        return date.add(interval, "month");
    }
    return date.add(interval, "year");
};

export const expandRecurrences = (events: ICalendarNormalizedEvent[], range: ICalendarRange): ICalendarNormalizedEvent[] => {
    const expanded: ICalendarNormalizedEvent[] = [];
    events.forEach(event => {
        if (!event.recurrence) {
            if (!event.end?.isBefore(range.start, "day") && !event.start.isAfter(range.end, "day")) {
                expanded.push(event);
            }
            return;
        }
        const duration = event.end ? event.end.diff(event.start) : 0;
        let occurrenceStart = event.start;
        let index = 0;
        while (!occurrenceStart.isAfter(range.end, "day")) {
            if (event.recurrence.count && index >= event.recurrence.count) {
                break;
            }
            if (event.recurrence.until && occurrenceStart.isAfter(event.recurrence.until)) {
                break;
            }
            if (!occurrenceStart.isBefore(range.start, "day")) {
                expanded.push({
                    ...event,
                    start: occurrenceStart,
                    end: event.end ? occurrenceStart.add(duration, "millisecond") : undefined,
                    isOccurrence: index > 0,
                    occurrenceID: `${event.id}:${occurrenceStart.format("YYYYMMDD")}`,
                    baseEventID: event.id,
                });
            }
            occurrenceStart = addFreq(occurrenceStart, event.recurrence);
            index++;
        }
    });
    return expanded.sort((a, b) => a.start.valueOf() - b.start.valueOf());
};

