import * as dayjs from "dayjs";
import {Constants} from "../../../../constants";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {fetchSyncPost} from "../../../../util/fetch";
import {hasClosestByAttribute} from "../../../util/hasClosest";
import {transaction} from "../../../wysiwyg/transaction";
import {genTabHeaderHTML} from "../render";
import {getCalendarFieldMapping} from "./mapped-fields";
import {ICalendarNormalizedEvent, ICalendarRange} from "./model";
import {eventOverlapsDay, normalizeCalendarEvents, sortCalendarEvents} from "./normalize";
import {openEventDialog} from "./event-dialog";

interface IRenderCalendarOptions {
    protyle: IProtyle;
    blockElement: HTMLElement;
    cb?: (data: IAV) => void;
    renderAll: boolean;
    data?: IAV;
}

const getVisibleRange = (anchor: dayjs.Dayjs, viewMode: number): ICalendarRange => {
    if (viewMode === 1) {
        return {start: anchor.startOf("week"), end: anchor.endOf("week")};
    }
    if (viewMode === 2) {
        return {start: anchor.startOf("day"), end: anchor.endOf("day")};
    }
    if (viewMode === 3) {
        return {start: anchor.startOf("day"), end: anchor.add(90, "day").endOf("day")};
    }
    return {start: anchor.startOf("month").startOf("week"), end: anchor.endOf("month").endOf("week")};
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

const eventButtonHTML = (event: ICalendarNormalizedEvent) => {
    const timePrefix = event.isAllDay ? "" : `${event.start.format("HH:mm")} `;
    const multiDayPrefix = event.end && !event.start.isSame(event.end, "day") ? `${event.start.format("MMM D")} - ${event.end.format("MMM D")} ` : "";
    return `<button class="av__calendar-event" data-id="${escapeAttr(event.baseEventID || event.id)}" data-occurrence="${escapeAttr(event.occurrenceID || "")}">
    <span>${escapeHtml(`${timePrefix}${multiDayPrefix}${event.title}`)}</span>
</button>`;
};

const renderModeSwitcher = (viewMode: number) => {
    return `<div class="av__calendar-modes">
        ${[0, 1, 2, 3].map(mode => `<button class="b3-button${viewMode === mode ? " b3-button--text" : " b3-button--outline"}" data-type="calendar-mode" data-mode="${mode}">${getViewModeLabel(mode)}</button>`).join("")}
    </div>`;
};

const renderMonth = (anchor: dayjs.Dayjs, range: ICalendarRange, events: ICalendarNormalizedEvent[]) => {
    let html = `<div class="av__calendar-weekdays">${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map(day => `<div>${day}</div>`).join("")}</div><div class="av__calendar-month">`;
    let cursor = range.start;
    while (!cursor.isAfter(range.end, "day")) {
        const dayEvents = sortCalendarEvents(events.filter(event => eventOverlapsDay(event, cursor)));
        html += `<div class="av__calendar-day${cursor.isSame(dayjs(), "day") ? " av__calendar-day--today" : ""}${cursor.month() !== anchor.month() ? " av__calendar-day--muted" : ""}" data-date="${cursor.format("YYYY-MM-DD")}">
    <button class="av__calendar-daynum" data-type="calendar-new" data-date="${cursor.format("YYYY-MM-DD")}">${cursor.date()}</button>
    <div class="av__calendar-events">${dayEvents.map(eventButtonHTML).join("")}</div>
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
        return `<div class="av__calendar-week-day" data-date="${day.format("YYYY-MM-DD")}">
            <button class="av__calendar-list-title" data-type="calendar-new" data-date="${day.format("YYYY-MM-DD")}">${day.format("ddd D")}</button>
            <div class="av__calendar-all-day">${allDayEvents.map(eventButtonHTML).join("")}</div>
            <div class="av__calendar-timed">${timedEvents.length > 0 ? timedEvents.map(eventButtonHTML).join("") : `<span class="ft__on-surface">${window.siyuan.languages.emptyContent}</span>`}</div>
        </div>`;
    }).join("")}
</div>`;
};

const renderDay = (anchor: dayjs.Dayjs, events: ICalendarNormalizedEvent[]) => {
    const dayEvents = sortCalendarEvents(events.filter(event => eventOverlapsDay(event, anchor)));
    const allDayEvents = dayEvents.filter(event => event.isAllDay);
    const timedEvents = dayEvents.filter(event => !event.isAllDay);
    return `<div class="av__calendar-day-view" data-date="${anchor.format("YYYY-MM-DD")}">
    <button class="av__calendar-list-title" data-type="calendar-new" data-date="${anchor.format("YYYY-MM-DD")}">${anchor.format("dddd, MMM D")}</button>
    <div class="av__calendar-all-day">${allDayEvents.length > 0 ? allDayEvents.map(eventButtonHTML).join("") : `<span class="ft__on-surface">${window.siyuan.languages.emptyContent}</span>`}</div>
    <div class="av__calendar-now">${dayjs().isSame(anchor, "day") ? dayjs().format("HH:mm") : ""}</div>
    <div class="av__calendar-timed">${timedEvents.length > 0 ? timedEvents.map(eventButtonHTML).join("") : `<span class="ft__on-surface">${window.siyuan.languages.emptyContent}</span>`}</div>
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
    <div class="av__calendar-list-events">${dayEvents.length > 0 ? dayEvents.map(eventButtonHTML).join("") : `<span class="ft__on-surface">${window.siyuan.languages.emptyContent}</span>`}</div>
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
        return `<div class="av__calendar av__calendar--empty">
    <div class="ft__on-surface">${window.siyuan.languages.dateField || "Date Field"}</div>
</div>`;
    }
    const anchor = dayjs(blockElement.dataset.calendarDate || undefined);
    const safeAnchor = anchor.isValid() ? anchor : dayjs();
    const range = getVisibleRange(safeAnchor, calendar.viewMode || 0);
    const normalized = normalizeCalendarEvents(calendar, mapping, range);
    const title = calendar.viewMode === 1 ? `${range.start.format("MMM D")} - ${range.end.format("MMM D, YYYY")}` : safeAnchor.format(calendar.viewMode === 2 ? "MMM D, YYYY" : "MMMM YYYY");
    let body = renderMonth(safeAnchor, range, normalized.events);
    if (calendar.viewMode === 1) {
        body = renderWeek(range, normalized.events);
    } else if (calendar.viewMode === 2) {
        body = renderDay(safeAnchor, normalized.events);
    } else if (calendar.viewMode === 3) {
        body = renderList(range, normalized.events, true);
    }
    blockElement.dataset.baseEvents = JSON.stringify(Array.from(normalized.baseEventsByID.keys()));
    return `<div class="av__calendar" data-view-mode="${calendar.viewMode || 0}">
    <div class="av__calendar-toolbar">
        <button class="block__icon block__icon--show" data-type="calendar-prev"><svg><use xlink:href="#iconLeft"></use></svg></button>
        <button class="b3-button b3-button--outline" data-type="calendar-today">${window.siyuan.languages.today || "Today"}</button>
        <button class="block__icon block__icon--show" data-type="calendar-next"><svg><use xlink:href="#iconRight"></use></svg></button>
        <div class="av__calendar-title">${escapeHtml(title)}</div>
        ${renderModeSwitcher(calendar.viewMode || 0)}
        <button class="b3-button b3-button--text" data-type="calendar-new" data-date="${safeAnchor.format("YYYY-MM-DD")}">${window.siyuan.languages.newEvent || window.siyuan.languages.newRow}</button>
    </div>
    ${body}
</div>`;
};

const bindCalendarEvents = (options: IRenderCalendarOptions, data: IAV) => {
    const calendarElement = options.blockElement.querySelector(".av__calendar") as HTMLElement;
    const calendar = data.view as IAVCalendar;
    const rerender = () => {
        options.blockElement.removeAttribute("data-render");
        renderCalendar({...options, data: undefined});
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
    const range = getVisibleRange(dayjs(options.blockElement.dataset.calendarDate || undefined), calendar.viewMode || 0);
    const mapping = getCalendarFieldMapping(calendar);
    const baseEvents = normalizeCalendarEvents(calendar, mapping, range).baseEventsByID;
    calendarElement?.querySelectorAll(".av__calendar-event").forEach(item => {
        item.addEventListener("click", () => {
            const event = baseEvents.get((item as HTMLElement).dataset.id || "");
            if (event) {
                openEventDialog({protyle: options.protyle, blockElement: options.blockElement, data, event, date: event.start.format("YYYY-MM-DD"), onSave: rerender, onDelete: rerender});
            }
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
