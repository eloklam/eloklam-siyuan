import * as dayjs from "dayjs";
import {ICalendarNormalizedEvent, ICalendarRange, ICalendarRecurrence} from "./model";

const isValidFreq = (value: string) => ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(value);
const weekdayMap: { [key: string]: number } = {SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6};

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
    const result: Partial<ICalendarRecurrence> = {raw};
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
        } else if (key === "BYDAY") {
            const byDay = val.split(",").filter(day => weekdayMap[day] !== undefined);
            if (byDay.length > 0) {
                result.byDay = byDay;
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
        if (event.recurrence.freq === "WEEKLY" && event.recurrence.byDay?.length > 0) {
            let weekCursor = event.start.startOf("week");
            let index = 0;
            while (!weekCursor.isAfter(range.end, "day")) {
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
                        if (event.recurrence.count && index >= event.recurrence.count) {
                            break;
                        }
                        if (event.recurrence.until && occurrenceStart.isAfter(event.recurrence.until)) {
                            break;
                        }
                        if (!occurrenceStart.isAfter(range.end, "day") &&
                            !(event.end ? occurrenceStart.add(duration, "millisecond").isBefore(range.start, "day") : occurrenceStart.isBefore(range.start, "day"))) {
                            expanded.push({
                                ...event,
                                start: occurrenceStart,
                                end: event.end ? occurrenceStart.add(duration, "millisecond") : undefined,
                                isOccurrence: index > 0 || !occurrenceStart.isSame(event.start),
                                occurrenceID: `${event.id}:${occurrenceStart.format("YYYYMMDD")}`,
                                baseEventID: event.id,
                            });
                        }
                        index++;
                    }
                }
                if (event.recurrence.count && index >= event.recurrence.count) {
                    break;
                }
                weekCursor = weekCursor.add(1, "week");
            }
            return;
        }
        let occurrenceStart = event.start;
        let index = 0;
        while (!occurrenceStart.isAfter(range.end, "day")) {
            if (event.recurrence.count && index >= event.recurrence.count) {
                break;
            }
            if (event.recurrence.until && occurrenceStart.isAfter(event.recurrence.until)) {
                break;
            }
            if (!(event.end ? occurrenceStart.add(duration, "millisecond").isBefore(range.start, "day") : occurrenceStart.isBefore(range.start, "day"))) {
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
