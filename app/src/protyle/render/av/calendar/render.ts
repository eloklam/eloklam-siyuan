import * as dayjs from "dayjs";
import {Constants} from "../../../../constants";
import {showMessage} from "../../../../dialog/message";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {fetchSyncPost} from "../../../../util/fetch";
import {hasClosestByAttribute} from "../../../util/hasClosest";
import {transaction} from "../../../wysiwyg/transaction";
import {genTabHeaderHTML} from "../render";
import {getCalendarFieldMapping} from "./mapped-fields";
import {ICalendarEventDraft, ICalendarNormalizedEvent, ICalendarRange} from "./model";
import {eventOverlapsDay, normalizeCalendarEvents, sortCalendarEvents} from "./normalize";
import {openEventDialog} from "./event-dialog";
import {createCalendarEvent, createCalendarEventReplacingOccurrence, updateCalendarEvent} from "./transactions";

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

const getSafeViewMode = (viewMode?: number) => [0, 1, 2, 3].includes(viewMode || 0) ? viewMode || 0 : 0;

const getCalendarViewMode = (calendar: IAVCalendar, blockElement: HTMLElement) => {
    const localViewMode = blockElement.dataset.calendarViewMode;
    if (localViewMode && /^[0-3]$/.test(localViewMode)) {
        return parseInt(localViewMode, 10);
    }
    return getSafeViewMode(calendar.viewMode);
};

const getSafeWeekStart = (weekStart?: number) => weekStart === 1 ? 1 : 0;

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

const getCalendarTitle = (anchor: dayjs.Dayjs, range: ICalendarRange, viewMode: number) => {
    if (viewMode === 1 || viewMode === 3) {
        return `${formatCalendarDate(range.start, {year: "numeric", month: "short", day: "numeric"})} - ${formatCalendarDate(range.end, {year: "numeric", month: "short", day: "numeric"})}`;
    }
    if (viewMode === 2) {
        return formatCalendarDate(anchor, {year: "numeric", month: "short", day: "numeric"});
    }
    return formatCalendarDate(anchor, {year: "numeric", month: "long"});
};

const getWeekdayLabels = (weekStart = 0) => {
    const formatter = new Intl.DateTimeFormat(getCalendarLocale(), {weekday: "short"});
    return [0, 1, 2, 3, 4, 5, 6].map(index => formatter.format(new Date(2020, 5, 7 + ((weekStart + index) % 7))));
};

const getCalendarSearch = (blockElement: HTMLElement) => (blockElement.dataset.calendarSearch || "").trim();

const getCalendarFilter = (blockElement: HTMLElement) => {
    const filter = blockElement.dataset.calendarFilter || "all";
    return ["all", "timed", "all-day", "recurring"].includes(filter) ? filter : "all";
};

const eventMatchesSearch = (event: ICalendarNormalizedEvent, query: string) => {
    if (!query) {
        return true;
    }
    const haystack = [
        event.title,
        event.start.format("YYYY-MM-DD"),
        event.start.format("HH:mm"),
        event.end?.format("YYYY-MM-DD"),
        event.end?.format("HH:mm"),
        event.location,
        event.description,
        event.colorContent,
        event.recurrenceRaw,
        event.recurrence?.freq,
    ].filter(Boolean).join("\n").toLowerCase();
    return query.toLowerCase().split(/\s+/).every(term => haystack.includes(term));
};

const eventMatchesCalendarFilter = (event: ICalendarNormalizedEvent, filter: string) => {
    if (filter === "timed") {
        return !event.isAllDay;
    }
    if (filter === "all-day") {
        return event.isAllDay;
    }
    if (filter === "recurring") {
        return !!(event.recurrenceRaw || event.recurrence || event.isOccurrence);
    }
    return true;
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

const getEventSeekRange = (anchor: dayjs.Dayjs): ICalendarRange => ({
    start: anchor.subtract(1, "year").startOf("day"),
    end: anchor.add(1, "year").endOf("day"),
});

const getEventDateLabel = (event: ICalendarNormalizedEvent) => {
    if (event.isAllDay) {
        return event.end && !event.start.isSame(event.end, "day") ?
            `${formatCalendarDate(event.start, {year: "numeric", month: "short", day: "numeric"})} - ${formatCalendarDate(event.end, {year: "numeric", month: "short", day: "numeric"})}` :
            formatCalendarDate(event.start, {year: "numeric", month: "short", day: "numeric"});
    }
    const dateLabel = event.end && !event.start.isSame(event.end, "day") ?
        `${formatCalendarDate(event.start, {year: "numeric", month: "short", day: "numeric"})} ${event.start.format("HH:mm")} - ${formatCalendarDate(event.end, {year: "numeric", month: "short", day: "numeric"})} ${event.end.format("HH:mm")}` :
        `${formatCalendarDate(event.start, {year: "numeric", month: "short", day: "numeric"})} ${event.start.format("HH:mm")} - ${(event.end || event.start.add(1, "hour")).format("HH:mm")}`;
    return dateLabel;
};

const getEventTooltip = (event: ICalendarNormalizedEvent) => {
    return [
        event.title,
        getEventDateLabel(event),
        event.location ? `${window.siyuan.languages.calendarLocation || "Location"}: ${event.location}` : "",
        event.description ? `${window.siyuan.languages.calendarDescription || "Description"}: ${event.description}` : "",
        event.recurrenceRaw ? `${window.siyuan.languages.calendarRecurrence || "Recurrence"}: ${event.recurrenceRaw}` : "",
        event.isOccurrence ? window.siyuan.languages.calendarDeleteOccurrence || "Recurring occurrence" : "",
    ].filter(Boolean).join("\n");
};

const eventButtonHTML = (event: ICalendarNormalizedEvent, displayDate?: dayjs.Dayjs, editable = true) => {
    const timePrefix = event.isAllDay ? "" : `${event.start.format("HH:mm")} `;
    const multiDayPrefix = event.end && !event.start.isSame(event.end, "day") ?
        `${formatCalendarDate(event.start, {month: "short", day: "numeric"})} - ${formatCalendarDate(event.end, {month: "short", day: "numeric"})} ` : "";
    const colorStyle = event.color ? ` style="background-color:var(--b3-font-background${escapeAttr(event.color)});color:var(--b3-font-color${escapeAttr(event.color)});"` : "";
    const eventTooltip = getEventTooltip(event);
    const recurrenceMarker = event.recurrenceRaw || event.recurrence || event.isOccurrence ?
        `<span class="av__calendar-recurring" aria-hidden="true">${event.isOccurrence ? "O" : "R"}</span>` : "";
    return `<button class="av__calendar-event" draggable="${editable ? "true" : "false"}" data-id="${escapeAttr(event.baseEventID || event.id)}" data-occurrence="${escapeAttr(event.occurrenceID || "")}" data-date="${displayDate?.format("YYYY-MM-DD") || event.start.format("YYYY-MM-DD")}" title="${escapeAttr(eventTooltip)}" aria-label="${escapeAttr(eventTooltip)}"${editable ? "" : " disabled"}${colorStyle}>
    <span class="av__calendar-event-text">${escapeHtml(`${timePrefix}${multiDayPrefix}${event.title}`)}</span>
    ${recurrenceMarker}
    ${!editable ? "" : (event.isAllDay ?
        `<span class="av__calendar-resize" data-type="calendar-resize" data-days="-1">-1d</span><span class="av__calendar-resize" data-type="calendar-resize" data-days="1">+1d</span>` :
        `<span class="av__calendar-resize" data-type="calendar-resize" data-delta="-15">-15m</span><span class="av__calendar-resize" data-type="calendar-resize" data-delta="15">+15m</span>`)}
    ${editable ? `<span class="av__calendar-resize" data-type="calendar-duplicate-next-day">copy</span>` : ""}
</button>`;
};

const renderModeSwitcher = (viewMode: number) => {
    return `<div class="av__calendar-modes">
        ${[0, 1, 2, 3].map(mode => `<button class="b3-button${viewMode === mode ? " b3-button--text" : " b3-button--outline"}" data-type="calendar-mode" data-mode="${mode}" aria-keyshortcuts="${mode + 1}">${getViewModeLabel(mode)}</button>`).join("")}
    </div>`;
};

const renderEventSummary = (events: ICalendarNormalizedEvent[]) => {
    const allDayCount = events.filter(event => event.isAllDay).length;
    const timedCount = events.length - allDayCount;
    const eventsLabel = window.siyuan.languages.calendarEvents || "Events";
    const timedLabel = window.siyuan.languages.calendarTimed || "Timed";
    return `<div class="av__calendar-summary" aria-live="polite" aria-label="${escapeAttr(`${events.length} ${eventsLabel}, ${allDayCount} ${window.siyuan.languages.allDay || "All day"}, ${timedCount} ${timedLabel}`)}">
        <span>${events.length}</span>
        <span>${window.siyuan.languages.allDay || "All day"} ${allDayCount}</span>
        <span>${timedLabel} ${timedCount}</span>
    </div>`;
};

const renderCalendarFilter = (filter: string) => {
    return `<select class="b3-select av__calendar-filter" data-type="calendar-filter" aria-label="${window.siyuan.languages.filter || "Filter"}">
        <option value="all"${filter === "all" ? " selected" : ""}>${window.siyuan.languages.all || "All"}</option>
        <option value="timed"${filter === "timed" ? " selected" : ""}>${window.siyuan.languages.calendarTimed || "Timed"}</option>
        <option value="all-day"${filter === "all-day" ? " selected" : ""}>${window.siyuan.languages.allDay || "All day"}</option>
        <option value="recurring"${filter === "recurring" ? " selected" : ""}>${window.siyuan.languages.calendarRecurrence || "Recurring"}</option>
    </select>`;
};

const renderDateFieldSetup = (calendar: IAVCalendar, editable = true) => {
    const dateFields = calendar.fields.filter(field => field.type === "date");
    if (dateFields.length === 0) {
        return `<div class="av__calendar av__calendar--empty">
    <div class="ft__on-surface">${window.siyuan.languages.calendarNeedDateField || window.siyuan.languages.dateField || "Calendar requires a date field"}</div>
    ${editable ? `<button class="b3-button b3-button--text av__calendar-setup" data-type="calendar-create-date-field">${window.siyuan.languages.calendarCreateDateField || window.siyuan.languages.newCol}</button>` : ""}
</div>`;
    }
    return `<div class="av__calendar av__calendar--empty">
    <label class="ft__on-surface" for="av-calendar-date-field">${window.siyuan.languages.calendarNeedDateField || window.siyuan.languages.dateField || "Calendar requires a date field"}</label>
    <select class="b3-select av__calendar-setup" id="av-calendar-date-field" data-type="calendar-empty-date-field"${editable ? "" : " disabled"}>
        <option value="">${window.siyuan.languages.select || ""}</option>
        ${dateFields.map(field => `<option value="${escapeAttr(field.id)}">${escapeHtml(field.name)}</option>`).join("")}
    </select>
    ${editable ? `<button class="b3-button b3-button--text av__calendar-setup" data-type="calendar-create-date-field">${window.siyuan.languages.calendarCreateDateField || window.siyuan.languages.newCol}</button>` : ""}
</div>`;
};

const renderMonth = (anchor: dayjs.Dayjs, range: ICalendarRange, events: ICalendarNormalizedEvent[], weekStart = 0, editable = true) => {
    let html = `<div class="av__calendar-weekdays">${getWeekdayLabels(weekStart).map(day => `<div>${escapeHtml(day)}</div>`).join("")}</div><div class="av__calendar-month">`;
    let cursor = range.start;
    while (!cursor.isAfter(range.end, "day")) {
        const dayEvents = sortCalendarEvents(events.filter(event => eventOverlapsDay(event, cursor)));
        html += `<div class="av__calendar-day${cursor.isSame(dayjs(), "day") ? " av__calendar-day--today" : ""}${cursor.month() !== anchor.month() ? " av__calendar-day--muted" : ""}" data-date="${cursor.format("YYYY-MM-DD")}" data-type="calendar-drop-day">
    <button class="av__calendar-daynum" data-type="calendar-new" data-date="${cursor.format("YYYY-MM-DD")}"${editable ? "" : " disabled"}>${cursor.date()}</button>
    <div class="av__calendar-events">${dayEvents.map(event => eventButtonHTML(event, cursor, editable)).join("")}</div>
</div>`;
        cursor = cursor.add(1, "day");
    }
    return `${html}</div>`;
};

const renderWeek = (range: ICalendarRange, events: ICalendarNormalizedEvent[], editable = true) => {
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
        return `<div class="av__calendar-week-day${day.isSame(dayjs(), "day") ? " av__calendar-day--today" : ""}" data-date="${day.format("YYYY-MM-DD")}" data-type="calendar-drop-day">
            <button class="av__calendar-list-title" data-type="calendar-new" data-date="${day.format("YYYY-MM-DD")}"${editable ? "" : " disabled"}>${escapeHtml(`${formatCalendarDate(day, {weekday: "short"})} ${day.date()}`)}</button>
            <div class="av__calendar-all-day">${allDayEvents.map(event => eventButtonHTML(event, day, editable)).join("")}</div>
            <div class="av__calendar-timed">${timedEvents.length > 0 ? timedEvents.map(event => eventButtonHTML(event, day, editable)).join("") : `<span class="ft__on-surface">${window.siyuan.languages.emptyContent}</span>`}</div>
        </div>`;
    }).join("")}
</div>`;
};

const renderDay = (anchor: dayjs.Dayjs, events: ICalendarNormalizedEvent[], editable = true) => {
    const dayEvents = sortCalendarEvents(events.filter(event => eventOverlapsDay(event, anchor)));
    const allDayEvents = dayEvents.filter(event => event.isAllDay);
    const timedEvents = dayEvents.filter(event => !event.isAllDay);
    return `<div class="av__calendar-day-view${anchor.isSame(dayjs(), "day") ? " av__calendar-day--today" : ""}" data-date="${anchor.format("YYYY-MM-DD")}" data-type="calendar-drop-day">
    <button class="av__calendar-list-title" data-type="calendar-new" data-date="${anchor.format("YYYY-MM-DD")}"${editable ? "" : " disabled"}>${escapeHtml(formatCalendarDate(anchor, {weekday: "long", month: "short", day: "numeric"}))}</button>
    <div class="av__calendar-all-day">${allDayEvents.length > 0 ? allDayEvents.map(event => eventButtonHTML(event, anchor, editable)).join("") : `<span class="ft__on-surface">${window.siyuan.languages.emptyContent}</span>`}</div>
    <div class="av__calendar-now">${dayjs().isSame(anchor, "day") ? dayjs().format("HH:mm") : ""}</div>
    <div class="av__calendar-timed">${timedEvents.length > 0 ? timedEvents.map(event => eventButtonHTML(event, anchor, editable)).join("") : `<span class="ft__on-surface">${window.siyuan.languages.emptyContent}</span>`}</div>
</div>`;
};

const renderList = (range: ICalendarRange, events: ICalendarNormalizedEvent[], hideEmpty = false, editable = true) => {
    let cursor = range.start.startOf("day");
    let html = '<div class="av__calendar-list">';
    let renderedDays = 0;
    while (!cursor.isAfter(range.end, "day")) {
        const dayEvents = sortCalendarEvents(events.filter(event => eventOverlapsDay(event, cursor)));
        if (!hideEmpty || dayEvents.length > 0) {
            renderedDays++;
            html += `<div class="av__calendar-list-day${cursor.isSame(dayjs(), "day") ? " av__calendar-day--today" : ""}" data-date="${cursor.format("YYYY-MM-DD")}" data-type="calendar-drop-day">
    <button class="av__calendar-list-title" data-type="calendar-new" data-date="${cursor.format("YYYY-MM-DD")}"${editable ? "" : " disabled"}>${escapeHtml(formatCalendarDate(cursor, {weekday: "short", year: "numeric", month: "short", day: "numeric"}))}</button>
    <div class="av__calendar-list-events">${dayEvents.length > 0 ? dayEvents.map(event => eventButtonHTML(event, cursor, editable)).join("") : `<span class="ft__on-surface">${window.siyuan.languages.emptyContent}</span>`}</div>
</div>`;
        }
        cursor = cursor.add(1, "day");
    }
    if (renderedDays === 0) {
        html += `<div class="av__calendar-no-results ft__on-surface">${window.siyuan.languages.emptyContent}</div>`;
    }
    return `${html}</div>`;
};

const getCalendarHTML = (data: IAV, blockElement: HTMLElement, editable = true) => {
    const calendar = data.view as IAVCalendar;
    const viewMode = getCalendarViewMode(calendar, blockElement);
    const weekStart = getSafeWeekStart(calendar.weekStart);
    const mapping = getCalendarFieldMapping(calendar);
    if (!mapping.hasDateField) {
        return renderDateFieldSetup(calendar, editable);
    }
    const anchor = dayjs(blockElement.dataset.calendarDate || undefined);
    const safeAnchor = anchor.isValid() ? anchor : dayjs();
    const range = getVisibleRange(safeAnchor, viewMode, weekStart);
    const normalized = normalizeCalendarEvents(calendar, mapping, range);
    const search = getCalendarSearch(blockElement);
    const filter = getCalendarFilter(blockElement);
    const filteredEvents = normalized.events.filter(event => eventMatchesCalendarFilter(event, filter));
    const totalEventCount = normalized.events.length;
    const events = filteredEvents.filter(event => eventMatchesSearch(event, search));
    const hasActiveQuery = !!search || filter !== "all";
    const title = getCalendarTitle(safeAnchor, range, viewMode);
    let body = renderMonth(safeAnchor, range, events, weekStart, editable);
    if (viewMode === 1) {
        body = renderWeek(range, events, editable);
    } else if (viewMode === 2) {
        body = renderDay(safeAnchor, events, editable);
    } else if (viewMode === 3) {
        body = renderList(range, events, true, editable);
    }
    if (hasActiveQuery && events.length === 0 && viewMode !== 3) {
        body = `<div class="av__calendar-no-results ft__on-surface">${window.siyuan.languages.emptyContent}</div>${body}`;
    }
    blockElement.dataset.baseEvents = JSON.stringify(Array.from(normalized.baseEventsByID.keys()));
    return `<div class="av__calendar" data-view-mode="${viewMode}" tabindex="0" role="region" aria-label="${escapeAttr(`${window.siyuan.languages.calendar || "Calendar"} ${title}`)}" aria-keyshortcuts="ArrowLeft ArrowRight [ ] T N / Escape 1 2 3 4">
    <div class="av__calendar-toolbar">
        <button class="block__icon block__icon--show" data-type="calendar-prev" aria-keyshortcuts="ArrowLeft"><svg><use xlink:href="#iconLeft"></use></svg></button>
        <button class="b3-button b3-button--outline" data-type="calendar-today" aria-keyshortcuts="T">${window.siyuan.languages.today || "Today"}</button>
        <button class="block__icon block__icon--show" data-type="calendar-next" aria-keyshortcuts="ArrowRight"><svg><use xlink:href="#iconRight"></use></svg></button>
        <button class="block__icon block__icon--show" data-type="calendar-prev-event" aria-label="${window.siyuan.languages.calendarPreviousEvent || "Previous event"}" aria-keyshortcuts="["><svg><use xlink:href="#iconUp"></use></svg></button>
        <button class="block__icon block__icon--show" data-type="calendar-next-event" aria-label="${window.siyuan.languages.calendarNextEvent || "Next event"}" aria-keyshortcuts="]"><svg><use xlink:href="#iconDown"></use></svg></button>
        <input class="b3-text-field av__calendar-jump" type="date" data-type="calendar-jump-date" value="${safeAnchor.format("YYYY-MM-DD")}">
        <div class="av__calendar-title" aria-live="polite">${escapeHtml(title)}</div>
        <input class="b3-text-field av__calendar-search" data-type="calendar-search" aria-keyshortcuts="/" placeholder="${window.siyuan.languages.calendarSearch || window.siyuan.languages.search || "Search"}" value="${escapeAttr(search)}">
        ${renderCalendarFilter(filter)}
        ${hasActiveQuery ? `<span class="av__calendar-search-count">${events.length}/${totalEventCount}</span><button class="block__icon block__icon--show" data-type="calendar-clear-search" aria-label="${window.siyuan.languages.clear || "Clear"}" aria-keyshortcuts="Escape"><svg><use xlink:href="#iconClose"></use></svg></button>` : ""}
        ${renderEventSummary(events)}
        ${renderModeSwitcher(viewMode)}
        ${editable ? `<button class="b3-button b3-button--text" data-type="calendar-new" aria-keyshortcuts="N" data-date="${safeAnchor.format("YYYY-MM-DD")}">${window.siyuan.languages.newEvent || window.siyuan.languages.newRow}</button>` : ""}
    </div>
    ${body}
</div>`;
};

const bindCalendarEvents = (options: IRenderCalendarOptions, data: IAV) => {
    const calendarElement = options.blockElement.querySelector(".av__calendar") as HTMLElement;
    const calendar = data.view as IAVCalendar;
    const viewMode = getCalendarViewMode(calendar, options.blockElement);
    const weekStart = getSafeWeekStart(calendar.weekStart);
    const editable = !options.protyle.disabled && !hasClosestByAttribute(options.blockElement, "data-type", "NodeBlockQueryEmbed");
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
    const setCalendarAnchor = (date: dayjs.Dayjs) => {
        options.blockElement.dataset.calendarDate = date.format("YYYY-MM-DD");
        rerender();
    };
    const getCurrentAnchor = () => {
        const anchor = dayjs(options.blockElement.dataset.calendarDate || undefined);
        return anchor.isValid() ? anchor : dayjs();
    };
    const seekEvent = (direction: -1 | 1) => {
        const mapping = getCalendarFieldMapping(calendar);
        if (!mapping.hasDateField) {
            return;
        }
        const anchor = getCurrentAnchor();
        const search = getCalendarSearch(options.blockElement);
        const filter = getCalendarFilter(options.blockElement);
        const events = normalizeCalendarEvents(calendar, mapping, getEventSeekRange(anchor)).events
            .filter(event => eventMatchesCalendarFilter(event, filter))
            .filter(event => eventMatchesSearch(event, search))
            .filter(event => direction > 0 ? event.start.isAfter(anchor, "day") : event.start.isBefore(anchor, "day"));
        const target = direction > 0 ? sortCalendarEvents(events)[0] : sortCalendarEvents(events).reverse()[0];
        if (target) {
            setCalendarAnchor(target.start);
        } else {
            showMessage(window.siyuan.languages.calendarNoMatchingEvent || window.siyuan.languages.emptyContent || "No matching event");
        }
    };
    const setCalendarViewMode = (mode: number) => {
        if (mode === viewMode || ![0, 1, 2, 3].includes(mode)) {
            return;
        }
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        if (!editable || !avID || !blockID) {
            options.blockElement.dataset.calendarViewMode = String(mode);
            rerender(false, true);
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
            data: viewMode,
            viewID: data.viewID,
        }]);
        delete options.blockElement.dataset.calendarViewMode;
        calendar.viewMode = mode;
        rerender();
    };
    calendarElement?.querySelector('[data-type="calendar-prev"]')?.addEventListener("click", () => {
        setCalendarAnchor(getNavDate(getCurrentAnchor(), viewMode, -1));
    });
    calendarElement?.querySelector('[data-type="calendar-next"]')?.addEventListener("click", () => {
        setCalendarAnchor(getNavDate(getCurrentAnchor(), viewMode, 1));
    });
    calendarElement?.querySelector('[data-type="calendar-prev-event"]')?.addEventListener("click", () => seekEvent(-1));
    calendarElement?.querySelector('[data-type="calendar-next-event"]')?.addEventListener("click", () => seekEvent(1));
    calendarElement?.querySelector('[data-type="calendar-today"]')?.addEventListener("click", () => {
        setCalendarAnchor(dayjs());
    });
    const jumpDateInput = calendarElement?.querySelector('[data-type="calendar-jump-date"]') as HTMLInputElement;
    jumpDateInput?.addEventListener("change", () => {
        const nextDate = dayjs(jumpDateInput.value);
        if (!nextDate.isValid() || nextDate.format("YYYY-MM-DD") !== jumpDateInput.value) {
            jumpDateInput.value = (options.blockElement.dataset.calendarDate || dayjs().format("YYYY-MM-DD"));
            return;
        }
        options.blockElement.dataset.calendarDate = jumpDateInput.value;
        rerender();
    });
    calendarElement?.querySelectorAll('[data-type="calendar-new"]').forEach(item => {
        item.addEventListener("click", () => {
            if (!editable) {
                return;
            }
            openEventDialog({protyle: options.protyle, blockElement: options.blockElement, data, date: (item as HTMLElement).dataset.date || dayjs().format("YYYY-MM-DD"), onSave: rerender});
        });
    });
    calendarElement?.querySelectorAll('[data-type="calendar-drop-day"]').forEach(item => {
        item.addEventListener("dblclick", (event: MouseEvent) => {
            if (!editable || (event.target as HTMLElement).closest(".av__calendar-event, [data-type='calendar-new']")) {
                return;
            }
            openEventDialog({protyle: options.protyle, blockElement: options.blockElement, data, date: (item as HTMLElement).dataset.date || dayjs().format("YYYY-MM-DD"), onSave: rerender});
        });
    });
    const searchInput = calendarElement?.querySelector('[data-type="calendar-search"]') as HTMLInputElement;
    searchInput?.addEventListener("input", () => {
        options.blockElement.dataset.calendarSearch = searchInput.value.trim();
        rerender(true, true);
    });
    const filterSelect = calendarElement?.querySelector('[data-type="calendar-filter"]') as HTMLSelectElement;
    filterSelect?.addEventListener("change", () => {
        if (filterSelect.value === "all") {
            delete options.blockElement.dataset.calendarFilter;
        } else {
            options.blockElement.dataset.calendarFilter = filterSelect.value;
        }
        rerender(false, true);
    });
    calendarElement?.querySelector('[data-type="calendar-clear-search"]')?.addEventListener("click", () => {
        delete options.blockElement.dataset.calendarSearch;
        delete options.blockElement.dataset.calendarFilter;
        rerender(true, true);
    });
    calendarElement?.addEventListener("keydown", (event: KeyboardEvent) => {
        if (["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes((event.target as HTMLElement).tagName)) {
            return;
        }
        if (event.key === "ArrowLeft") {
            event.preventDefault();
            setCalendarAnchor(getNavDate(getCurrentAnchor(), viewMode, -1));
        } else if (event.key === "ArrowRight") {
            event.preventDefault();
            setCalendarAnchor(getNavDate(getCurrentAnchor(), viewMode, 1));
        } else if (event.key.toLowerCase() === "t") {
            event.preventDefault();
            setCalendarAnchor(dayjs());
        } else if (event.key.toLowerCase() === "n") {
            event.preventDefault();
            if (editable) {
                openEventDialog({protyle: options.protyle, blockElement: options.blockElement, data, date: getCurrentAnchor().format("YYYY-MM-DD"), onSave: rerender});
            }
        } else if (event.key === "/") {
            event.preventDefault();
            (calendarElement.querySelector('[data-type="calendar-search"]') as HTMLInputElement)?.focus();
        } else if (event.key === "[") {
            event.preventDefault();
            seekEvent(-1);
        } else if (event.key === "]") {
            event.preventDefault();
            seekEvent(1);
        } else if (event.key === "Escape" && (getCalendarSearch(options.blockElement) || getCalendarFilter(options.blockElement) !== "all")) {
            event.preventDefault();
            delete options.blockElement.dataset.calendarSearch;
            delete options.blockElement.dataset.calendarFilter;
            rerender();
        } else if (/^[1-4]$/.test(event.key)) {
            event.preventDefault();
            setCalendarViewMode(parseInt(event.key, 10) - 1);
        }
    });
    const emptyDateFieldElement = calendarElement?.querySelector('[data-type="calendar-empty-date-field"]') as HTMLSelectElement;
    emptyDateFieldElement?.addEventListener("change", () => {
        if (!editable) {
            emptyDateFieldElement.value = "";
            return;
        }
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
        if (!editable) {
            return;
        }
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
            setCalendarViewMode(mode);
        });
    });
    const anchor = dayjs(options.blockElement.dataset.calendarDate || undefined);
    const range = getVisibleRange(anchor.isValid() ? anchor : dayjs(), viewMode, weekStart);
    const mapping = getCalendarFieldMapping(calendar);
    const normalizedForEvents = normalizeCalendarEvents(calendar, mapping, range);
    const baseEvents = normalizedForEvents.baseEventsByID;
    const renderedEvents = new Map<string, ICalendarNormalizedEvent>();
    normalizedForEvents.events.forEach(event => {
        renderedEvents.set(event.occurrenceID || event.id, event);
    });
    const getEditableEvent = (sourceEvent: ICalendarNormalizedEvent) => {
        if (!sourceEvent.isOccurrence || mapping.exceptionFieldID) {
            return sourceEvent;
        }
        return baseEvents.get(sourceEvent.baseEventID || sourceEvent.id) || sourceEvent;
    };
    const updateEventWithDraft = (sourceEvent: ICalendarNormalizedEvent, draft: ICalendarEventDraft) => {
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        if (!avID || !blockID || !mapping.dateFieldID) {
            return;
        }
        if (sourceEvent.isOccurrence && mapping.exceptionFieldID) {
            const saved = createCalendarEventReplacingOccurrence({
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
            if (saved) {
                rerender();
            }
            return;
        }
        const saved = updateCalendarEvent({
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
        if (saved) {
            rerender();
        } else {
            showMessage(window.siyuan.languages._kernel[29]);
        }
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
    const duplicateEventToNextDay = (sourceEvent: ICalendarNormalizedEvent) => {
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        if (!avID || !blockID || !mapping.dateFieldID) {
            return;
        }
        const draft = buildDraftForDate(sourceEvent, sourceEvent.start.add(1, "day").format("YYYY-MM-DD"));
        draft.recurrenceRaw = "";
        draft.recurrenceExceptionRaw = "";
        const saved = createCalendarEvent({
            protyle: options.protyle,
            avID,
            blockID,
            dateFieldID: mapping.dateFieldID,
            fields: calendar.fields,
            mapping,
            draft,
            previousUpdated: options.blockElement.getAttribute("updated") || "",
        });
        if (saved) {
            rerender();
        } else {
            showMessage(window.siyuan.languages._kernel[29]);
        }
    };
    calendarElement?.querySelectorAll(".av__calendar-event").forEach(item => {
        item.addEventListener("click", (event: MouseEvent) => {
            const resizeElement = (event.target as HTMLElement).closest('[data-type="calendar-resize"]') as HTMLElement;
            if (resizeElement) {
                event.preventDefault();
                event.stopPropagation();
                if (!editable) {
                    return;
                }
                const sourceEvent = renderedEvents.get((item as HTMLElement).dataset.occurrence || "") || baseEvents.get((item as HTMLElement).dataset.id || "");
                if (!sourceEvent) {
                    return;
                }
                const targetEvent = getEditableEvent(sourceEvent);
                if (sourceEvent.isAllDay) {
                    const deltaDays = parseInt(resizeElement.dataset.days || "0", 10);
                    if (!deltaDays) {
                        return;
                    }
                    const sourceEnd = (sourceEvent.end || sourceEvent.start.endOf("day")).add(deltaDays, "day");
                    if (sourceEnd.isBefore(sourceEvent.start, "day")) {
                        return;
                    }
                    const nextDurationDays = Math.max(sourceEnd.startOf("day").diff(sourceEvent.start.startOf("day"), "day"), 0);
                    const targetEnd = targetEvent.start.startOf("day").add(nextDurationDays, "day");
                    updateEventWithDraft(targetEvent, {
                        title: targetEvent.title,
                        date: targetEvent.start.format("YYYY-MM-DD"),
                        endDate: targetEnd.format("YYYY-MM-DD"),
                        isAllDay: true,
                        startTime: targetEvent.start.format("HH:mm"),
                        endTime: targetEvent.end ? targetEvent.end.format("HH:mm") : "23:59",
                        recurrenceRaw: targetEvent.recurrenceRaw,
                        location: targetEvent.location,
                        description: targetEvent.description,
                        colorContent: targetEvent.colorContent,
                    });
                    return;
                }
                const delta = parseInt(resizeElement.dataset.delta || "0", 10);
                const currentEnd = sourceEvent.end || sourceEvent.start.add(1, "hour");
                const nextEnd = currentEnd.add(delta, "minute");
                if (!nextEnd.isAfter(sourceEvent.start)) {
                    return;
                }
                const nextDuration = nextEnd.diff(sourceEvent.start, "minute");
                const targetEnd = targetEvent.start.add(nextDuration, "minute");
                updateEventWithDraft(targetEvent, {
                    title: targetEvent.title,
                    date: targetEvent.start.format("YYYY-MM-DD"),
                    endDate: targetEnd.format("YYYY-MM-DD"),
                    isAllDay: false,
                    startTime: targetEvent.start.format("HH:mm"),
                    endTime: targetEnd.format("HH:mm"),
                    recurrenceRaw: targetEvent.recurrenceRaw,
                    location: targetEvent.location,
                    description: targetEvent.description,
                    colorContent: targetEvent.colorContent,
                });
                return;
            }
            const duplicateElement = (event.target as HTMLElement).closest('[data-type="calendar-duplicate-next-day"]') as HTMLElement;
            if (duplicateElement) {
                event.preventDefault();
                event.stopPropagation();
                if (!editable) {
                    return;
                }
                const sourceEvent = renderedEvents.get((item as HTMLElement).dataset.occurrence || "") || baseEvents.get((item as HTMLElement).dataset.id || "");
                if (sourceEvent) {
                    duplicateEventToNextDay(sourceEvent);
                }
                return;
            }
            const calendarEvent = renderedEvents.get((item as HTMLElement).dataset.occurrence || "") || baseEvents.get((item as HTMLElement).dataset.id || "");
            if (calendarEvent && editable) {
                const eventForDialog = getEditableEvent(calendarEvent);
                openEventDialog({protyle: options.protyle, blockElement: options.blockElement, data, event: eventForDialog, date: eventForDialog.start.format("YYYY-MM-DD"), onSave: rerender, onDelete: rerender});
            }
        });
    });
    calendarElement?.querySelectorAll(".av__calendar-event").forEach(item => {
        item.addEventListener("dragstart", (event: DragEvent) => {
            if (!editable) {
                event.preventDefault();
                return;
            }
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
            if (!editable) {
                return;
            }
            event.preventDefault();
            (item as HTMLElement).classList.add("av__calendar-day--dragover");
        });
        item.addEventListener("dragleave", () => {
            (item as HTMLElement).classList.remove("av__calendar-day--dragover");
        });
        item.addEventListener("drop", (event: DragEvent) => {
            event.preventDefault();
            (item as HTMLElement).classList.remove("av__calendar-day--dragover");
            if (!editable) {
                return;
            }
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
            const targetEvent = getEditableEvent(sourceEvent);
            const dragOffsetDays = displayDate ? Math.max(dayjs(displayDate).startOf("day").diff(sourceEvent.start.startOf("day"), "day"), 0) : 0;
            const draftDate = dayjs(targetDate).subtract(dragOffsetDays, "day").format("YYYY-MM-DD");
            const targetDraftDate = targetEvent === sourceEvent ?
                draftDate :
                targetEvent.start.add(dayjs(draftDate).diff(sourceEvent.start, "day"), "day").format("YYYY-MM-DD");
            const draft = buildDraftForDate(targetEvent, targetDraftDate);
            if (targetEvent.isAllDay && targetEvent.end && !targetEvent.start.isSame(targetEvent.end, "day")) {
                draft.endTime = targetEvent.end?.format("HH:mm") || "23:59";
            }
            updateEventWithDraft(targetEvent, draft);
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
    const body = `<div class="av__body" data-page-size="-1">${getCalendarHTML(data, e, editable)}</div>`;
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
