import * as dayjs from "dayjs";
import {ICalendarNormalizedEvent, ICalendarRange, ICalendarRecurrence} from "./model";

const isValidFreq = (value: string) => ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(value);
const weekdayMap: { [key: string]: number } = {SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6};

const parseUntil = (value: string) => {
    if (/^\d{8}$/.test(value)) {
        return dayjs(`${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`);
    }
    const dateTimeMatch = value.match(/^(\d{4})(\d{2})(\d{2})T\d{6}Z?$/);
    if (dateTimeMatch) {
        return dayjs(`${dateTimeMatch[1]}-${dateTimeMatch[2]}-${dateTimeMatch[3]}`);
    }
    return dayjs(value);
};

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
        if (!val) {
            return;
        }
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
            const until = parseUntil(val);
            if (until.isValid()) {
                result.until = until.endOf("day");
            }
        } else if (key === "BYDAY") {
            const byDay = val.split(",").filter(day => weekdayMap[day] !== undefined).sort((a, b) => weekdayMap[a] - weekdayMap[b]);
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

const getExpansionStart = (range: ICalendarRange, duration: number) => range.start.subtract(Math.max(duration, 0), "millisecond");

const getAlignedRecurringStart = (event: ICalendarNormalizedEvent, expansionStart: dayjs.Dayjs) => {
    if (!event.recurrence || event.recurrence.count || !event.start.isBefore(expansionStart)) {
        return {occurrenceStart: event.start, index: 0};
    }
    const interval = event.recurrence.interval || 1;
    const unit = event.recurrence.freq === "DAILY" ? "day" : (event.recurrence.freq === "WEEKLY" ? "week" : (event.recurrence.freq === "MONTHLY" ? "month" : "year"));
    const diff = Math.max(expansionStart.diff(event.start, unit), 0);
    let index = Math.max(Math.floor(diff / interval), 0);
    let occurrenceStart = event.start.add(index * interval, unit);
    while (occurrenceStart.isBefore(expansionStart)) {
        occurrenceStart = occurrenceStart.add(interval, unit);
        index++;
    }
    return {occurrenceStart, index};
};

const getAlignedRecurringWeekStart = (event: ICalendarNormalizedEvent, expansionStart: dayjs.Dayjs) => {
    let weekCursor = event.start.startOf("week");
    if (event.recurrence?.count || !weekCursor.isBefore(expansionStart, "week")) {
        return weekCursor;
    }
    const interval = event.recurrence?.interval || 1;
    const diff = Math.max(expansionStart.startOf("week").diff(event.start.startOf("week"), "week"), 0);
    const skipped = Math.max(Math.floor(diff / interval), 0);
    weekCursor = weekCursor.add(skipped * interval, "week");
    while (weekCursor.isBefore(expansionStart, "week")) {
        weekCursor = weekCursor.add(interval, "week");
    }
    return weekCursor;
};

export const expandRecurrences = (events: ICalendarNormalizedEvent[], range: ICalendarRange): ICalendarNormalizedEvent[] => {
    const expanded: ICalendarNormalizedEvent[] = [];
    events.forEach(event => {
        const isException = (date: dayjs.Dayjs) => event.recurrenceExceptions?.includes(date.format("YYYY-MM-DD"));
        if (!event.recurrence) {
            if (!event.end?.isBefore(range.start, "day") && !event.start.isAfter(range.end, "day")) {
                expanded.push(event);
            }
            return;
        }
        const duration = event.end ? event.end.diff(event.start) : 0;
        const expansionStart = getExpansionStart(range, duration);
        if (event.recurrence.freq === "WEEKLY" && event.recurrence.byDay?.length > 0) {
            let weekCursor = getAlignedRecurringWeekStart(event, expansionStart);
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
                        if (!isException(occurrenceStart) &&
                            !occurrenceStart.isAfter(range.end, "day") &&
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
        let {occurrenceStart, index} = getAlignedRecurringStart(event, expansionStart);
        while (!occurrenceStart.isAfter(range.end, "day")) {
            if (event.recurrence.count && index >= event.recurrence.count) {
                break;
            }
            if (event.recurrence.until && occurrenceStart.isAfter(event.recurrence.until)) {
                break;
            }
            if (!isException(occurrenceStart) &&
                !(event.end ? occurrenceStart.add(duration, "millisecond").isBefore(range.start, "day") : occurrenceStart.isBefore(range.start, "day"))) {
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
