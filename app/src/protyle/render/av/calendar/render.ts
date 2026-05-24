import * as dayjs from "dayjs";
import {Constants} from "../../../../constants";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {fetchSyncPost} from "../../../../util/fetch";
import {hasClosestByAttribute} from "../../../util/hasClosest";
import {transaction} from "../../../wysiwyg/transaction";
import {genTabHeaderHTML} from "../render";
import {getCalendarFieldMapping} from "./mapped-fields";
import {ICalendarEventDraft, ICalendarNormalizedEvent, ICalendarRange} from "./model";
import {eventOverlapsDay, normalizeCalendarEvents, sortCalendarEvents} from "./normalize";
import {openEventDialog} from "./event-dialog";
import {createCalendarEventReplacingOccurrence, updateCalendarEvent} from "./transactions";

interface IRenderCalendarOptions {
    protyle: IProtyle;
    blockElement: HTMLElement;
    cb?: (data: IAV) => void;
    renderAll: boolean;
    data?: IAV;
}

const startOfCalendarWeek = (date: dayjs.Dayjs, weekStart = 0) => {
    const offset = (date.day() - weekStart + 7) % 7;
    return date.subtract(offset, "day").startOf("day");
};

const endOfCalendarWeek = (date: dayjs.Dayjs, weekStart = 0) => startOfCalendarWeek(date, weekStart).add(6, "day").endOf("day");

const getVisibleRange = (anchor: dayjs.Dayjs, viewMode: number, weekStart = 0): ICalendarRange => {
    if (viewMode === 1) {
        return {start: startOfCalendarWeek(anchor, weekStart), end: endOfCalendarWeek(anchor, weekStart)};
    }
    if (viewMode === 2) {
        return {start: anchor.startOf("day"), end: anchor.endOf("day")};
    }
    if (viewMode === 3) {
        return {start: anchor.startOf("day"), end: anchor.add(90, "day").endOf("day")};
    }
    return {start: startOfCalendarWeek(anchor.startOf("month"), weekStart), end: endOfCalendarWeek(anchor.endOf("month"), weekStart)};
};

const getViewModeLabel = (viewMode: number) => {
    const labels = [
        window.siyuan.languages.month || "Month",
        window.siyuan.languages.week || "Week",
        window.siyuan.languages.day || "Day",
        window.siyuan.languages.calendarSchedule || "Schedule",
    ];
    return labels[viewMode] || labels[0];
};

const getCalendarLocale = () => window.siyuan.config.lang.replace("_", "-");

const formatCalendarDate = (date: dayjs.Dayjs, options: Intl.DateTimeFormatOptions) => {
    return new Intl.DateTimeFormat(getCalendarLocale(), options).format(date.toDate());
};

const getWeekdayLabels = (weekStart = 0) => {
    const formatter = new Intl.DateTimeFormat(getCalendarLocale(), {weekday: "short"});
    return [0, 1, 2, 3, 4, 5, 6].map(index => formatter.format(new Date(2020, 5, 7 + ((weekStart + index) % 7))));
};

const getCalendarSearch = (blockElement: HTMLElement) => (blockElement.dataset.calendarSearch || "").trim();

const eventMatchesSearch = (event: ICalendarNormalizedEvent, query: string) => {
    if (!query) {
        return true;
    }
    const haystack = [
        event.title,
        event.location,
        event.description,
        event.colorContent,
        event.recurrenceRaw,
        event.recurrence?.freq,
    ].filter(Boolean).join("\n").toLowerCase();
    return query.toLowerCase().split(/\s+/).every(term => haystack.includes(term));
};

const getNavDate = (anchor: dayjs.Dayjs, viewMode: number, direction: -1 | 1) => {
    if (viewMode === 0) {
        return anchor.add(direction, "month");
    }
    if (viewMode === 1) {
        return anchor.add(direction, "week");
    }
    if (viewMode === 3) {
        return anchor.add(direction * 30, "day");
    }
    return anchor.add(direction, "day");
};

const eventButtonHTML = (event: ICalendarNormalizedEvent, displayDate?: dayjs.Dayjs) => {
    const timePrefix = event.isAllDay ? "" : `${event.start.format("HH:mm")} `;
    const multiDayPrefix = event.end && !event.start.isSame(event.end, "day") ? `${event.start.format("MMM D")} - ${event.end.format("MMM D")} ` : "";
    const colorStyle = event.color ? ` style="background-color:var(--b3-font-background${escapeAttr(event.color)});color:var(--b3-font-color${escapeAttr(event.color)});"` : "";
    return `<button class="av__calendar-event" draggable="true" data-id="${escapeAttr(event.baseEventID || event.id)}" data-occurrence="${escapeAttr(event.occurrenceID || "")}" data-date="${displayDate?.format("YYYY-MM-DD") || event.start.format("YYYY-MM-DD")}"${colorStyle}>
    <span class="av__calendar-event-text">${escapeHtml(`${timePrefix}${multiDayPrefix}${event.title}`)}</span>
    ${event.isAllDay ? "" : `<span class="av__calendar-resize" data-type="calendar-resize" data-delta="-15">-15m</span><span class="av__calendar-resize" data-type="calendar-resize" data-delta="15">+15m</span>`}
</button>`;
};

const renderModeSwitcher = (viewMode: number) => {
    return `<div class="av__calendar-modes">
        ${[0, 1, 2, 3].map(mode => `<button class="b3-button${viewMode === mode ? " b3-button--text" : " b3-button--outline"}" data-type="calendar-mode" data-mode="${mode}">${getViewModeLabel(mode)}</button>`).join("")}
    </div>`;
};

const renderDateFieldSetup = (calendar: IAVCalendar) => {
    const dateFields = calendar.fields.filter(field => field.type === "date");
    if (dateFields.length === 0) {
        return `<div class="av__calendar av__calendar--empty">
    <div class="ft__on-surface">${window.siyuan.languages.calendarNeedDateField || window.siyuan.languages.dateField || "Calendar requires a date field"}</div>
    <button class="b3-button b3-button--text av__calendar-setup" data-type="calendar-create-date-field">${window.siyuan.languages.calendarCreateDateField || window.siyuan.languages.newCol}</button>
</div>`;
    }
    return `<div class="av__calendar av__calendar--empty">
    <label class="ft__on-surface" for="av-calendar-date-field">${window.siyuan.languages.calendarNeedDateField || window.siyuan.languages.dateField || "Calendar requires a date field"}</label>
    <select class="b3-select av__calendar-setup" id="av-calendar-date-field" data-type="calendar-empty-date-field">
        <option value="">${window.siyuan.languages.select || ""}</option>
        ${dateFields.map(field => `<option value="${escapeAttr(field.id)}">${escapeHtml(field.name)}</option>`).join("")}
    </select>
    <button class="b3-button b3-button--text av__calendar-setup" data-type="calendar-create-date-field">${window.siyuan.languages.calendarCreateDateField || window.siyuan.languages.newCol}</button>
</div>`;
};

const renderMonth = (anchor: dayjs.Dayjs, range: ICalendarRange, events: ICalendarNormalizedEvent[], weekStart = 0) => {
    let html = `<div class="av__calendar-weekdays">${getWeekdayLabels(weekStart).map(day => `<div>${escapeHtml(day)}</div>`).join("")}</div><div class="av__calendar-month">`;
    let cursor = range.start;
    while (!cursor.isAfter(range.end, "day")) {
        const dayEvents = sortCalendarEvents(events.filter(event => eventOverlapsDay(event, cursor)));
        html += `<div class="av__calendar-day${cursor.isSame(dayjs(), "day") ? " av__calendar-day--today" : ""}${cursor.month() !== anchor.month() ? " av__calendar-day--muted" : ""}" data-date="${cursor.format("YYYY-MM-DD")}" data-type="calendar-drop-day">
    <button class="av__calendar-daynum" data-type="calendar-new" data-date="${cursor.format("YYYY-MM-DD")}">${cursor.date()}</button>
    <div class="av__calendar-events">${dayEvents.map(event => eventButtonHTML(event, cursor)).join("")}</div>
</div>`;
        cursor = cursor.add(1, "day");
    }
    return `${html}</div>`;
};

const renderWeek = (range: ICalendarRange, events: ICalendarNormalizedEvent[]) => {
    const days: dayjs.Dayjs[] = [];
    let cursor = range.start.startOf("day");
    while (!cursor.isAfter(range.end, "day")) {
        days.push(cursor);
        cursor = cursor.add(1, "day");
    }
    return `<div class="av__calendar-week">
    ${days.map(day => {
        const dayEvents = sortCalendarEvents(events.filter(event => eventOverlapsDay(event, day)));
        const allDayEvents = dayEvents.filter(event => event.isAllDay);
        const timedEvents = dayEvents.filter(event => !event.isAllDay);
        return `<div class="av__calendar-week-day" data-date="${day.format("YYYY-MM-DD")}" data-type="calendar-drop-day">
            <button class="av__calendar-list-title" data-type="calendar-new" data-date="${day.format("YYYY-MM-DD")}">${escapeHtml(`${formatCalendarDate(day, {weekday: "short"})} ${day.date()}`)}</button>
            <div class="av__calendar-all-day">${allDayEvents.map(event => eventButtonHTML(event, day)).join("")}</div>
            <div class="av__calendar-timed">${timedEvents.length > 0 ? timedEvents.map(event => eventButtonHTML(event, day)).join("") : `<span class="ft__on-surface">${window.siyuan.languages.emptyContent}</span>`}</div>
        </div>`;
    }).join("")}
</div>`;
};

const renderDay = (anchor: dayjs.Dayjs, events: ICalendarNormalizedEvent[]) => {
    const dayEvents = sortCalendarEvents(events.filter(event => eventOverlapsDay(event, anchor)));
    const allDayEvents = dayEvents.filter(event => event.isAllDay);
    const timedEvents = dayEvents.filter(event => !event.isAllDay);
    return `<div class="av__calendar-day-view" data-date="${anchor.format("YYYY-MM-DD")}" data-type="calendar-drop-day">
    <button class="av__calendar-list-title" data-type="calendar-new" data-date="${anchor.format("YYYY-MM-DD")}">${escapeHtml(formatCalendarDate(anchor, {weekday: "long", month: "short", day: "numeric"}))}</button>
    <div class="av__calendar-all-day">${allDayEvents.length > 0 ? allDayEvents.map(event => eventButtonHTML(event, anchor)).join("") : `<span class="ft__on-surface">${window.siyuan.languages.emptyContent}</span>`}</div>
    <div class="av__calendar-now">${dayjs().isSame(anchor, "day") ? dayjs().format("HH:mm") : ""}</div>
    <div class="av__calendar-timed">${timedEvents.length > 0 ? timedEvents.map(event => eventButtonHTML(event, anchor)).join("") : `<span class="ft__on-surface">${window.siyuan.languages.emptyContent}</span>`}</div>
</div>`;
};

const renderList = (range: ICalendarRange, events: ICalendarNormalizedEvent[], hideEmpty = false) => {
    let cursor = range.start.startOf("day");
    let html = '<div class="av__calendar-list">';
    while (!cursor.isAfter(range.end, "day")) {
        const dayEvents = sortCalendarEvents(events.filter(event => eventOverlapsDay(event, cursor)));
        if (!hideEmpty || dayEvents.length > 0) {
            html += `<div class="av__calendar-list-day" data-date="${cursor.format("YYYY-MM-DD")}">
    <button class="av__calendar-list-title" data-type="calendar-new" data-date="${cursor.format("YYYY-MM-DD")}">${cursor.format("YYYY-MM-DD")}</button>
    <div class="av__calendar-list-events">${dayEvents.length > 0 ? dayEvents.map(event => eventButtonHTML(event, cursor)).join("") : `<span class="ft__on-surface">${window.siyuan.languages.emptyContent}</span>`}</div>
</div>`;
        }
        cursor = cursor.add(1, "day");
    }
    return `${html}</div>`;
};

const getCalendarHTML = (data: IAV, blockElement: HTMLElement) => {
    const calendar = data.view as IAVCalendar;
    const mapping = getCalendarFieldMapping(calendar);
    if (!mapping.hasDateField) {
        return renderDateFieldSetup(calendar);
    }
    const anchor = dayjs(blockElement.dataset.calendarDate || undefined);
    const safeAnchor = anchor.isValid() ? anchor : dayjs();
    const range = getVisibleRange(safeAnchor, calendar.viewMode || 0, calendar.weekStart || 0);
    const normalized = normalizeCalendarEvents(calendar, mapping, range);
    const search = getCalendarSearch(blockElement);
    const events = normalized.events.filter(event => eventMatchesSearch(event, search));
    const title = calendar.viewMode === 1 ? `${range.start.format("MMM D")} - ${range.end.format("MMM D, YYYY")}` : safeAnchor.format(calendar.viewMode === 2 ? "MMM D, YYYY" : "MMMM YYYY");
    let body = renderMonth(safeAnchor, range, events, calendar.weekStart || 0);
    if (calendar.viewMode === 1) {
        body = renderWeek(range, events);
    } else if (calendar.viewMode === 2) {
        body = renderDay(safeAnchor, events);
    } else if (calendar.viewMode === 3) {
        body = renderList(range, events, true);
    }
    if (search && events.length === 0) {
        body = `<div class="av__calendar-no-results ft__on-surface">${window.siyuan.languages.emptyContent}</div>${body}`;
    }
    blockElement.dataset.baseEvents = JSON.stringify(Array.from(normalized.baseEventsByID.keys()));
    return `<div class="av__calendar" data-view-mode="${calendar.viewMode || 0}">
    <div class="av__calendar-toolbar">
        <button class="block__icon block__icon--show" data-type="calendar-prev"><svg><use xlink:href="#iconLeft"></use></svg></button>
        <button class="b3-button b3-button--outline" data-type="calendar-today">${window.siyuan.languages.today || "Today"}</button>
        <button class="block__icon block__icon--show" data-type="calendar-next"><svg><use xlink:href="#iconRight"></use></svg></button>
        <div class="av__calendar-title">${escapeHtml(title)}</div>
        <input class="b3-text-field av__calendar-search" data-type="calendar-search" placeholder="${window.siyuan.languages.calendarSearch || window.siyuan.languages.search || "Search"}" value="${escapeAttr(search)}">
        ${renderModeSwitcher(calendar.viewMode || 0)}
        <button class="b3-button b3-button--text" data-type="calendar-new" data-date="${safeAnchor.format("YYYY-MM-DD")}">${window.siyuan.languages.newEvent || window.siyuan.languages.newRow}</button>
    </div>
    ${body}
</div>`;
};

const bindCalendarEvents = (options: IRenderCalendarOptions, data: IAV) => {
    const calendarElement = options.blockElement.querySelector(".av__calendar") as HTMLElement;
    const calendar = data.view as IAVCalendar;
    const rerender = (focusSearch = false, useCurrentData = false) => {
        options.blockElement.removeAttribute("data-render");
        renderCalendar({...options, data: useCurrentData ? data : undefined}).then(() => {
            if (!focusSearch) {
                return;
            }
            const searchInput = options.blockElement.querySelector('[data-type="calendar-search"]') as HTMLInputElement;
            searchInput?.focus();
            searchInput?.setSelectionRange(searchInput.value.length, searchInput.value.length);
        });
    };
    calendarElement?.querySelector('[data-type="calendar-prev"]')?.addEventListener("click", () => {
        const anchor = dayjs(options.blockElement.dataset.calendarDate || undefined);
        options.blockElement.dataset.calendarDate = getNavDate(anchor.isValid() ? anchor : dayjs(), calendar.viewMode || 0, -1).format("YYYY-MM-DD");
        rerender();
    });
    calendarElement?.querySelector('[data-type="calendar-next"]')?.addEventListener("click", () => {
        const anchor = dayjs(options.blockElement.dataset.calendarDate || undefined);
        options.blockElement.dataset.calendarDate = getNavDate(anchor.isValid() ? anchor : dayjs(), calendar.viewMode || 0, 1).format("YYYY-MM-DD");
        rerender();
    });
    calendarElement?.querySelector('[data-type="calendar-today"]')?.addEventListener("click", () => {
        options.blockElement.dataset.calendarDate = dayjs().format("YYYY-MM-DD");
        rerender();
    });
    calendarElement?.querySelectorAll('[data-type="calendar-new"]').forEach(item => {
        item.addEventListener("click", () => {
            openEventDialog({protyle: options.protyle, blockElement: options.blockElement, data, date: (item as HTMLElement).dataset.date || dayjs().format("YYYY-MM-DD"), onSave: rerender});
        });
    });
    const searchInput = calendarElement?.querySelector('[data-type="calendar-search"]') as HTMLInputElement;
    searchInput?.addEventListener("input", () => {
        options.blockElement.dataset.calendarSearch = searchInput.value.trim();
        rerender(true, true);
    });
    const emptyDateFieldElement = calendarElement?.querySelector('[data-type="calendar-empty-date-field"]') as HTMLSelectElement;
    emptyDateFieldElement?.addEventListener("change", () => {
        const current = emptyDateFieldElement.value;
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        if (!current || !avID || !blockID) {
            return;
        }
        transaction(options.protyle, [{
            action: "setAttrViewCalendarDateField",
            avID,
            blockID,
            data: current,
            viewID: data.viewID,
        }], [{
            action: "setAttrViewCalendarDateField",
            avID,
            blockID,
            data: calendar.dateFieldID || "",
            viewID: data.viewID,
        }]);
        calendar.dateFieldID = current;
        rerender();
    });
    calendarElement?.querySelector('[data-type="calendar-create-date-field"]')?.addEventListener("click", () => {
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        if (!avID || !blockID) {
            return;
        }
        const keyID = Lute.NewNodeID();
        const keyName = window.siyuan.languages.date || window.siyuan.languages.dateField || "Date";
        transaction(options.protyle, [{
            action: "addAttrViewCol",
            avID,
            id: keyID,
            name: keyName,
            type: "date",
        }, {
            action: "setAttrViewCalendarDateField",
            avID,
            blockID,
            keyID,
            data: keyID,
            viewID: data.viewID,
        }], [{
            action: "setAttrViewCalendarDateField",
            avID,
            blockID,
            keyID: calendar.dateFieldID || "",
            data: calendar.dateFieldID || "",
            viewID: data.viewID,
        }, {
            action: "removeAttrViewCol",
            avID,
            id: keyID,
        }]);
        rerender();
    });
    calendarElement?.querySelectorAll('[data-type="calendar-mode"]').forEach(item => {
        item.addEventListener("click", () => {
            const mode = parseInt((item as HTMLElement).dataset.mode || "0", 10);
            if (mode === calendar.viewMode) {
                return;
            }
            const avID = options.blockElement.getAttribute("data-av-id");
            const blockID = options.blockElement.getAttribute("data-node-id");
            if (!avID || !blockID) {
                return;
            }
            transaction(options.protyle, [{
                action: "setAttrViewCalendarViewMode",
                avID,
                blockID,
                data: mode,
                viewID: data.viewID,
            }], [{
                action: "setAttrViewCalendarViewMode",
                avID,
                blockID,
                data: calendar.viewMode || 0,
                viewID: data.viewID,
            }]);
            calendar.viewMode = mode;
            rerender();
        });
    });
    const anchor = dayjs(options.blockElement.dataset.calendarDate || undefined);
    const range = getVisibleRange(anchor.isValid() ? anchor : dayjs(), calendar.viewMode || 0, calendar.weekStart || 0);
    const mapping = getCalendarFieldMapping(calendar);
    const normalizedForEvents = normalizeCalendarEvents(calendar, mapping, range);
    const baseEvents = normalizedForEvents.baseEventsByID;
    const renderedEvents = new Map<string, ICalendarNormalizedEvent>();
    normalizedForEvents.events.forEach(event => {
        renderedEvents.set(event.occurrenceID || event.id, event);
    });
    const updateEventWithDraft = (sourceEvent: ICalendarNormalizedEvent, draft: ICalendarEventDraft) => {
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        if (!avID || !blockID || !mapping.dateFieldID) {
            return;
        }
        if (sourceEvent.isOccurrence && mapping.exceptionFieldID) {
            createCalendarEventReplacingOccurrence({
                protyle: options.protyle,
                avID,
                blockID,
                dateFieldID: mapping.dateFieldID,
                fields: calendar.fields,
                mapping,
                event: sourceEvent,
                draft,
                occurrenceDate: sourceEvent.start.format("YYYY-MM-DD"),
                previousUpdated: options.blockElement.getAttribute("updated") || "",
            });
            rerender();
            return;
        }
        updateCalendarEvent({
            protyle: options.protyle,
            avID,
            blockID,
            dateFieldID: mapping.dateFieldID,
            fields: calendar.fields,
            mapping,
            event: sourceEvent,
            draft,
            previousUpdated: options.blockElement.getAttribute("updated") || "",
        });
        rerender();
    };
    const buildDraftForDate = (sourceEvent: ICalendarNormalizedEvent, targetDate: string): ICalendarEventDraft => {
        const durationDays = Math.max((sourceEvent.end || sourceEvent.start).startOf("day").diff(sourceEvent.start.startOf("day"), "day"), 0);
        return {
            title: sourceEvent.title,
            date: targetDate,
            endDate: dayjs(targetDate).add(durationDays, "day").format("YYYY-MM-DD"),
            isAllDay: sourceEvent.isAllDay,
            startTime: sourceEvent.start.format("HH:mm"),
            endTime: sourceEvent.end ? sourceEvent.end.format("HH:mm") : sourceEvent.start.add(1, "hour").format("HH:mm"),
            recurrenceRaw: sourceEvent.recurrenceRaw,
            location: sourceEvent.location,
            description: sourceEvent.description,
            colorContent: sourceEvent.colorContent,
        };
    };
    calendarElement?.querySelectorAll(".av__calendar-event").forEach(item => {
        item.addEventListener("click", (event: MouseEvent) => {
            const resizeElement = (event.target as HTMLElement).closest('[data-type="calendar-resize"]') as HTMLElement;
            if (resizeElement) {
                event.preventDefault();
                event.stopPropagation();
                const sourceEvent = renderedEvents.get((item as HTMLElement).dataset.occurrence || "") || baseEvents.get((item as HTMLElement).dataset.id || "");
                if (!sourceEvent || sourceEvent.isAllDay) {
                    return;
                }
                const delta = parseInt(resizeElement.dataset.delta || "0", 10);
                const currentEnd = sourceEvent.end || sourceEvent.start.add(1, "hour");
                const nextEnd = currentEnd.add(delta, "minute");
                if (!nextEnd.isAfter(sourceEvent.start)) {
                    return;
                }
                updateEventWithDraft(sourceEvent, {
                    title: sourceEvent.title,
                    date: sourceEvent.start.format("YYYY-MM-DD"),
                    endDate: nextEnd.format("YYYY-MM-DD"),
                    isAllDay: false,
                    startTime: sourceEvent.start.format("HH:mm"),
                    endTime: nextEnd.format("HH:mm"),
                    recurrenceRaw: sourceEvent.recurrenceRaw,
                    location: sourceEvent.location,
                    description: sourceEvent.description,
                    colorContent: sourceEvent.colorContent,
                });
                return;
            }
            const calendarEvent = renderedEvents.get((item as HTMLElement).dataset.occurrence || "") || baseEvents.get((item as HTMLElement).dataset.id || "");
            if (calendarEvent) {
                openEventDialog({protyle: options.protyle, blockElement: options.blockElement, data, event: calendarEvent, date: calendarEvent.start.format("YYYY-MM-DD"), onSave: rerender, onDelete: rerender});
            }
        });
    });
    calendarElement?.querySelectorAll(".av__calendar-event").forEach(item => {
        item.addEventListener("dragstart", (event: DragEvent) => {
            const eventElement = item as HTMLElement;
            event.dataTransfer?.setData("text/plain", JSON.stringify({
                id: eventElement.dataset.occurrence || eventElement.dataset.id || "",
                displayDate: eventElement.dataset.date || "",
            }));
            event.dataTransfer.effectAllowed = "move";
        });
    });
    calendarElement?.querySelectorAll('[data-type="calendar-drop-day"]').forEach(item => {
        item.addEventListener("dragover", (event: DragEvent) => {
            event.preventDefault();
            (item as HTMLElement).classList.add("av__calendar-day--dragover");
        });
        item.addEventListener("dragleave", () => {
            (item as HTMLElement).classList.remove("av__calendar-day--dragover");
        });
        item.addEventListener("drop", (event: DragEvent) => {
            event.preventDefault();
            (item as HTMLElement).classList.remove("av__calendar-day--dragover");
            const rawDragData = event.dataTransfer?.getData("text/plain") || "";
            const targetDate = (item as HTMLElement).dataset.date;
            let eventID = rawDragData;
            let displayDate = "";
            try {
                const parsed = JSON.parse(rawDragData);
                eventID = parsed.id || "";
                displayDate = parsed.displayDate || "";
            } catch {
                // Older drag payloads were plain event IDs.
            }
            const sourceEvent = renderedEvents.get(eventID) || baseEvents.get(eventID);
            if (!sourceEvent || !targetDate) {
                return;
            }
            const dragOffsetDays = displayDate ? Math.max(dayjs(displayDate).startOf("day").diff(sourceEvent.start.startOf("day"), "day"), 0) : 0;
            const draftDate = dayjs(targetDate).subtract(dragOffsetDays, "day").format("YYYY-MM-DD");
            const draft = buildDraftForDate(sourceEvent, draftDate);
            if (sourceEvent.isAllDay && sourceEvent.end && !sourceEvent.start.isSame(sourceEvent.end, "day")) {
                draft.endTime = sourceEvent.end?.format("HH:mm") || "23:59";
            }
            updateEventWithDraft(sourceEvent, draft);
        });
    });
};

export const renderCalendar = async (options: IRenderCalendarOptions) => {
    const e = options.blockElement;
    let data = options.data;
    if (!data) {
        const response = await fetchSyncPost("/api/av/renderAttributeView", {
            id: e.getAttribute("data-av-id"),
            pageSize: -1,
            viewID: e.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "",
            blockID: e.getAttribute("data-node-id"),
            createIfNotExist: !options.protyle.block.action?.includes(Constants.CB_GET_AV_NO_CREATE),
        });
        data = response.data;
    }
    e.setAttribute("data-render", "true");
    e.setAttribute("data-av-type", "calendar");
    const editable = !options.protyle.disabled && !hasClosestByAttribute(e, "data-type", "NodeBlockQueryEmbed");
    const body = `<div class="av__body" data-page-size="-1">${getCalendarHTML(data, e)}</div>`;
    if (options.renderAll) {
        e.firstElementChild.outerHTML = `<div class="av__container">
    ${genTabHeaderHTML(data, false, editable)}
    <div class="av__scroll">${body}</div>
</div>`;
    } else {
        e.firstElementChild.querySelector(".av__scroll").innerHTML = body;
    }
    bindCalendarEvents(options, data);
    options.cb?.(data);
};
