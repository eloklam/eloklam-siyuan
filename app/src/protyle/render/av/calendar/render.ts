import * as dayjs from "dayjs";
import {Constants} from "../../../../constants";
import {showMessage} from "../../../../dialog/message";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {fetchSyncPost} from "../../../../util/fetch";
import {hasClosestByAttribute, hasClosestByClassName} from "../../../util/hasClosest";
import {focusBlock} from "../../../util/selection";
import {transaction} from "../../../wysiwyg/transaction";
import {avRender, genTabHeaderHTML, updateSearch} from "../render";
import {renderGallery} from "../gallery/render";
import {renderKanban} from "../kanban/render";
import {bindAvSearch} from "../search";
import {beginAVRender, finishAVLocate, getAVLocateParams, isCurrentAVRender, prepareAVLocate} from "../locate";
import {openDatabaseRowByData} from "../openDatabaseRow";
import {getCalendarFieldMapping} from "./mapped-fields";
import {getBlockCell, getCellByFieldID, getEventDocumentID, ICalendarEventDraft, ICalendarNormalizedEvent, ICalendarRange} from "./model";
import {eventOverlapsDay, normalizeCalendarEvents, sortCalendarEvents} from "./normalize";
import {CalendarRecurrenceScope, getDisabledRecurrenceScopes, isRecurringSourceEvent, openEventDialog, openRecurrenceScopeDialog} from "./event-dialog";
import {openQuickCreate} from "./quick-create";
import {createCalendarEvent, createCalendarEventAsDocument, createCalendarEventReplacingOccurrence, ICalendarCreateOptions, updateCalendarEvent, updateCalendarEventThisAndFuture} from "./transactions";

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

/** "each entry is a page": new entries become real SiYuan documents. */
export const CALENDAR_NEW_ITEM_TARGET_DOCUMENT = "document";
export const CALENDAR_NEW_ITEM_TARGET_ROW = "row";

/** The persisted target, read through a cast (see getCalendarNewItemTarget). */
const getPersistedNewItemTarget = (calendar: IAVCalendar) =>
    calendar.newItemTarget || "";

/**
 * The view's new-entry target, as sent by the kernel alongside dateFieldID /
 * viewMode / weekStart (kernel/av/layout_calendar.go Calendar.NewItemTarget).
 *
 * The zero value "" is a view that existed before page-per-entry shipped, and it
 * must keep creating detached rows: only views created (or explicitly switched)
 * after the upgrade create documents, so nobody's existing data habits change
 * underneath them.
 *
 * The block-element override is what the config panel writes when the user flips
 * the setting: "setAttrViewCalendarNewItemTarget" is not in the refresh list of
 * app/src/protyle/wysiwyg/transaction.ts (not our file), so without it the very
 * next create would still use the value this render was fetched with. Same
 * mechanism as data-calendar-view-mode; renderCalendar drops it as soon as the
 * kernel confirms the value.
 *
 * Read through a cast because IAVCalendar in app/src/types/index.d.ts does not
 * declare the field yet - that file belongs to another agent in this change.
 */
export const getCalendarNewItemTarget = (calendar: IAVCalendar, blockElement?: HTMLElement) => {
    const localTarget = blockElement?.dataset.calendarNewItemTarget;
    if (localTarget === CALENDAR_NEW_ITEM_TARGET_DOCUMENT || localTarget === CALENDAR_NEW_ITEM_TARGET_ROW) {
        return localTarget;
    }
    return getPersistedNewItemTarget(calendar);
};

export const calendarCreatesDocuments = (calendar: IAVCalendar, blockElement?: HTMLElement) =>
    getCalendarNewItemTarget(calendar, blockElement) === CALENDAR_NEW_ITEM_TARGET_DOCUMENT;

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

const getCalendarLocale = () => window.siyuan.config.lang;

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


const SLOT_MINUTES = 30;

const formatSlotLabel = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const buildTimeSlots = () => {
    const slots: {minutes: number, start: string, end: string, label: string}[] = [];
    for (let minutes = 0; minutes < 24 * 60; minutes += SLOT_MINUTES) {
        slots.push({
            minutes,
            start: formatSlotLabel(minutes),
            end: minutes + SLOT_MINUTES >= 24 * 60 ? "23:59" : formatSlotLabel(minutes + SLOT_MINUTES),
            label: formatSlotLabel(minutes),
        });
    }
    return slots;
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
        // Bound entries open their page on a plain click, so say so before the click.
        getEventDocumentID(event) ? getOpenPageLabel() : "",
        event.location ? `${window.siyuan.languages.calendarLocation || "Location"}: ${event.location}` : "",
        event.description ? `${window.siyuan.languages.calendarDescription || "Description"}: ${event.description}` : "",
        event.recurrenceRaw ? `${window.siyuan.languages.calendarRecurrence || "Recurrence"}: ${event.recurrenceRaw}` : "",
        event.isOccurrence ? window.siyuan.languages.calendarOccurrence || "Recurring occurrence" : "",
    ].filter(Boolean).join("\n");
};

const getOpenPageLabel = () => {
    if (window.siyuan.languages.openBy && window.siyuan.languages.doc) {
        return `${window.siyuan.languages.openBy} ${window.siyuan.languages.doc}`;
    }
    return window.siyuan.languages.calendarOpenSource || "Open page";
};

const getOpenScheduleLabel = () => {
    const scheduleLabel = window.siyuan.languages.calendarSchedule || "Schedule";
    return window.siyuan.languages.edit ? `${window.siyuan.languages.edit} ${scheduleLabel}` : scheduleLabel;
};

/**
 * Open the page behind a bound entry.
 *
 * Goes through upstream's openDatabaseRowByData (../openDatabaseRow.ts:83-151)
 * rather than a bare openFileById so the calendar behaves like every other
 * database surface: an already open tab for that document is reused instead of
 * spawning duplicates, and the database attribute panel is expanded so Date /
 * Location stay editable on the page itself.
 */
const openCalendarEventSource = (protyle: IProtyle, blockElement: HTMLElement, event: ICalendarNormalizedEvent) => {
    const documentID = getEventDocumentID(event);
    if (!documentID) {
        showMessage(window.siyuan.languages.calendarSourceMissing || "Calendar item has no source block");
        return;
    }
    openDatabaseRowByData(protyle, {
        avID: blockElement.getAttribute("data-av-id") || "",
        databaseBlockID: blockElement.getAttribute("data-node-id") || "",
        notebookID: protyle.notebookId,
        // The item id of the row, never the occurrence id: a generated occurrence
        // has no row of its own and shares the base item's document.
        itemID: event.baseEventID || event.id,
        valueID: getBlockCell(event.sourceCard)?.id || "",
        title: event.title,
        boundBlockID: documentID,
        isDetached: false,
    });
};

const eventButtonHTML = (event: ICalendarNormalizedEvent, displayDate?: dayjs.Dayjs, editable = true) => {
    const timePrefix = event.isAllDay ? "" : `${event.start.format("HH:mm")} `;
    const multiDayPrefix = event.end && !event.start.isSame(event.end, "day") ?
        `${formatCalendarDate(event.start, {month: "short", day: "numeric"})} - ${formatCalendarDate(event.end, {month: "short", day: "numeric"})} ` : "";
    const colorStyle = event.color ? ` style="background-color:var(--b3-font-background${escapeAttr(event.color)});color:var(--b3-font-color${escapeAttr(event.color)});"` : "";
    const eventTooltip = getEventTooltip(event);
    const recurrenceMarker = event.recurrenceRaw || event.recurrence || event.isOccurrence ?
        `<span class="av__calendar-recurring" aria-hidden="true">${event.isOccurrence ? "O" : "R"}</span>` : "";
    const documentID = getEventDocumentID(event);
    const sourceMarker = documentID ?
        `<span class="av__calendar-source" data-type="calendar-open-source" role="button" tabindex="0" title="${escapeAttr(getOpenPageLabel())}" aria-label="${escapeAttr(getOpenPageLabel())}">↗</span>` : "";
    // A bound chip opens its page on click, so the scheduling dialog needs its own
    // labelled entry point: moving an event in time must never require opening the
    // page first. Detached chips still open the dialog on click, so they do not
    // carry this affordance.
    const scheduleLabel = editable ? getOpenScheduleLabel() : (window.siyuan.languages.calendarSchedule || "Schedule");
    const scheduleMarker = documentID ?
        `<span class="av__calendar-schedule" data-type="calendar-open-dialog" role="button" tabindex="0" title="${escapeAttr(scheduleLabel)}" aria-label="${escapeAttr(scheduleLabel)}">◷</span>` : "";
    return `<button class="av__calendar-event${editable ? "" : " av__calendar-event--readonly"}${documentID ? " av__calendar-event--page" : ""}" draggable="${editable ? "true" : "false"}" data-id="${escapeAttr(event.baseEventID || event.id)}" data-occurrence="${escapeAttr(event.occurrenceID || "")}" data-page="${escapeAttr(documentID)}" data-date="${displayDate?.format("YYYY-MM-DD") || event.start.format("YYYY-MM-DD")}" title="${escapeAttr(eventTooltip)}" aria-label="${escapeAttr(eventTooltip)}"${colorStyle}>
    <span class="av__calendar-event-text">${escapeHtml(`${timePrefix}${multiDayPrefix}${event.title}`)}</span>
    ${scheduleMarker}
    ${sourceMarker}
    ${recurrenceMarker}
    ${!editable ? "" : (event.isAllDay ?
        "<span class=\"av__calendar-resize\" data-type=\"calendar-resize\" data-days=\"-1\">-1d</span><span class=\"av__calendar-resize\" data-type=\"calendar-resize\" data-days=\"1\">+1d</span>" :
        "<span class=\"av__calendar-resize\" data-type=\"calendar-resize\" data-delta=\"-15\">-15m</span><span class=\"av__calendar-resize\" data-type=\"calendar-resize\" data-delta=\"15\">+15m</span>")}
    ${editable ? `<span class="av__calendar-resize" data-type="calendar-duplicate-next-day">${window.siyuan.languages.copy || "Copy"}</span>` : ""}
</button>`;
};

const isDateKey = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value || "");

const parseClockMinutes = (value: string) => {
    const match = /^(\d{1,2}):(\d{2})$/.exec(value || "");
    if (!match) {
        return 0;
    }
    return Math.min(Math.max(parseInt(match[1], 10) * 60 + parseInt(match[2], 10), 0), 24 * 60);
};

const buildOptimisticChip = (draft: ICalendarEventDraft) => {
    const label = `${draft.isAllDay ? "" : `${draft.startTime} `}${draft.title}`;
    const chip = document.createElement("div");
    // Not a <button>: this chip has no listeners bound to it (it never went
    // through a render pass), so it must not look or behave clickable.
    chip.className = "av__calendar-event av__calendar-event--pending";
    chip.setAttribute("aria-busy", "true");
    chip.setAttribute("title", label);
    chip.innerHTML = `<span class="av__calendar-event-text">${escapeHtml(label)}</span>`;
    return chip;
};

/**
 * Paint the entry the user just saved before the kernel has answered.
 *
 * Creating a page is much heavier than inserting a detached row (the kernel takes
 * createDocLock and flushes the transaction queue three times), so the quick
 * create popover closes at once and the chip appears immediately. The caller MUST
 * remove the returned node in both the success and the failure path, otherwise a
 * failed create leaves a phantom event on the grid.
 *
 * Returns null when the target day is not on screen (creating from the toolbar
 * while looking at another month, for example); the reconciling rerender is then
 * the only visible feedback, which is correct because there is nothing to paint.
 */
const paintOptimisticEvent = (calendarElement: HTMLElement, draft: ICalendarEventDraft): HTMLElement | null => {
    if (!calendarElement || !isDateKey(draft.date) || !draft.title) {
        return null;
    }
    const chip = buildOptimisticChip(draft);
    if (!draft.isAllDay) {
        const timedLayer = calendarElement.querySelector(`.av__calendar-time-day[data-date="${draft.date}"] .av__calendar-timed-events`);
        if (timedLayer) {
            const startMinutes = parseClockMinutes(draft.startTime);
            const endMinutes = Math.max(parseClockMinutes(draft.endTime), startMinutes + SLOT_MINUTES);
            const wrapper = document.createElement("div");
            wrapper.className = "av__calendar-timed-event";
            wrapper.style.gridRow = `${Math.floor(startMinutes / SLOT_MINUTES) + 1} / span ${Math.max(Math.ceil((endMinutes - startMinutes) / SLOT_MINUTES), 1)}`;
            wrapper.appendChild(chip);
            timedLayer.appendChild(wrapper);
            return wrapper;
        }
    }
    const dayElement = calendarElement.querySelector(`[data-type="calendar-drop-day"][data-date="${draft.date}"]`);
    const container = dayElement?.querySelector(".av__calendar-all-day, .av__calendar-events, .av__calendar-list-events");
    if (!container) {
        return null;
    }
    container.appendChild(chip);
    return chip;
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

const MONTH_DAY_EVENT_LIMIT = 3;

const renderMonth = (anchor: dayjs.Dayjs, range: ICalendarRange, events: ICalendarNormalizedEvent[], weekStart = 0, editable = true) => {
    let html = `<div class="av__calendar-weekdays">${getWeekdayLabels(weekStart).map(day => `<div>${escapeHtml(day)}</div>`).join("")}</div><div class="av__calendar-month">`;
    let cursor = range.start;
    while (!cursor.isAfter(range.end, "day")) {
        const dayEvents = sortCalendarEvents(events.filter(event => eventOverlapsDay(event, cursor)));
        const visibleEvents = dayEvents.length > MONTH_DAY_EVENT_LIMIT + 1 ? dayEvents.slice(0, MONTH_DAY_EVENT_LIMIT) : dayEvents;
        const hiddenCount = dayEvents.length - visibleEvents.length;
        const moreHTML = hiddenCount > 0 ?
            `<button class="av__calendar-more" data-type="calendar-more" data-date="${cursor.format("YYYY-MM-DD")}" aria-label="${escapeAttr(`+${hiddenCount} ${window.siyuan.languages.calendarEvents || "Events"}`)}">+${hiddenCount}</button>` : "";
        html += `<div class="av__calendar-day${cursor.isSame(dayjs(), "day") ? " av__calendar-day--today" : ""}${cursor.isSame(anchor, "day") ? " av__calendar-day--selected" : ""}${cursor.month() !== anchor.month() ? " av__calendar-day--muted" : ""}"${cursor.isSame(dayjs(), "day") ? ' aria-current="date"' : ""} data-date="${cursor.format("YYYY-MM-DD")}" data-type="calendar-drop-day">
    <button class="av__calendar-daynum" data-type="calendar-new" data-date="${cursor.format("YYYY-MM-DD")}"${editable ? "" : " disabled"}>${cursor.date()}</button>
    <div class="av__calendar-events">${visibleEvents.map(event => eventButtonHTML(event, cursor, editable)).join("")}${moreHTML}</div>
</div>`;
        cursor = cursor.add(1, "day");
    }
    return `${html}</div>`;
};


const getTimedEventGridRange = (event: ICalendarNormalizedEvent, day: dayjs.Dayjs) => {
    const dayStart = day.startOf("day");
    const startMinutes = Math.max(event.start.diff(dayStart, "minute"), 0);
    const endMinutes = Math.min((event.end || event.start.add(SLOT_MINUTES, "minute")).diff(dayStart, "minute"), 24 * 60);
    const rowStart = Math.floor(startMinutes / SLOT_MINUTES) + 1;
    const rowSpan = Math.max(Math.ceil((endMinutes - startMinutes) / SLOT_MINUTES), 1);
    return {rowStart, rowSpan};
};

// Partition a day's timed events into overlap clusters and assign each event a
// column inside its cluster, so simultaneous events sit side by side instead of
// hiding each other. Events without overlap span the full day-column width.
const computeTimedEventColumns = (events: ICalendarNormalizedEvent[], day: dayjs.Dayjs) => {
    const items = events.map(event => ({event, range: getTimedEventGridRange(event, day), column: 0, clusterColumns: 1}));
    items.sort((a, b) => a.range.rowStart - b.range.rowStart || b.range.rowSpan - a.range.rowSpan);
    let clusterStart = 0;
    let clusterEndRow = -1;
    let columnEndRows: number[] = [];
    const closeCluster = (endIndex: number) => {
        for (let i = clusterStart; i < endIndex; i++) {
            items[i].clusterColumns = columnEndRows.length;
        }
    };
    items.forEach((item, index) => {
        const rowEnd = item.range.rowStart + item.range.rowSpan;
        if (item.range.rowStart >= clusterEndRow) {
            closeCluster(index);
            clusterStart = index;
            columnEndRows = [];
        }
        let column = columnEndRows.findIndex(end => end <= item.range.rowStart);
        if (column === -1) {
            column = columnEndRows.length;
            columnEndRows.push(rowEnd);
        } else {
            columnEndRows[column] = rowEnd;
        }
        item.column = column;
        clusterEndRow = Math.max(clusterEndRow, rowEnd);
    });
    closeCluster(items.length);
    return {items};
};

const renderTimedEventLayer = (events: ICalendarNormalizedEvent[], day: dayjs.Dayjs, editable = true) => {
    const timedEvents = sortCalendarEvents(events.filter(event => !event.isAllDay));
    const layout = computeTimedEventColumns(timedEvents, day);
    const eventHTML = layout.items.map(item => {
        const overlapStyle = item.clusterColumns > 1 ?
            `;width:calc(${100 / item.clusterColumns}% - 2px);margin-left:${(item.column * 100) / item.clusterColumns}%` : "";
        return `<div class="av__calendar-timed-event" style="grid-row:${item.range.rowStart} / span ${item.range.rowSpan};grid-column:1 / -1${overlapStyle}">${eventButtonHTML(item.event, day, editable)}</div>`;
    }).join("");
    return `<div class="av__calendar-timed-events">${eventHTML}</div>`;
};

const renderTimeSlotsForDay = (day: dayjs.Dayjs, editable = true) => {
    return buildTimeSlots().map(slot => `<button class="av__calendar-time-slot" data-type="calendar-time-slot" data-date="${day.format("YYYY-MM-DD")}" data-start="${slot.start}" data-end="${slot.end}" aria-label="${escapeAttr(`${formatCalendarDate(day, {weekday: "short", month: "short", day: "numeric"})} ${slot.start}`)}"${editable ? "" : " disabled"}></button>`).join("");
};

const renderTimeGrid = (days: dayjs.Dayjs[], events: ICalendarNormalizedEvent[], editable = true) => {
    const slots = buildTimeSlots();
    return `<div class="av__calendar-time-grid" style="--calendar-day-count:${days.length}">
        <div class="av__calendar-time-labels">${slots.map(slot => `<div class="av__calendar-time-label">${escapeHtml(slot.label)}</div>`).join("")}</div>
        ${days.map(day => {
        const dayEvents = events.filter(event => eventOverlapsDay(event, day));
        return `<div class="av__calendar-time-day" data-date="${day.format("YYYY-MM-DD")}" data-type="calendar-drop-day">
                <div class="av__calendar-time-slots">${renderTimeSlotsForDay(day, editable)}</div>
                ${renderTimedEventLayer(dayEvents, day, editable)}
            </div>`;
    }).join("")}
    </div>`;
};

const renderWeek = (range: ICalendarRange, events: ICalendarNormalizedEvent[], editable = true) => {
    const days: dayjs.Dayjs[] = [];
    let cursor = range.start.startOf("day");
    while (!cursor.isAfter(range.end, "day")) {
        days.push(cursor);
        cursor = cursor.add(1, "day");
    }
    return `<div class="av__calendar-week">
    <div class="av__calendar-week-headers">
    ${days.map(day => {
        const dayEvents = sortCalendarEvents(events.filter(event => eventOverlapsDay(event, day)));
        const allDayEvents = dayEvents.filter(event => event.isAllDay);
        return `<div class="av__calendar-week-day${day.isSame(dayjs(), "day") ? " av__calendar-day--today" : ""}"${day.isSame(dayjs(), "day") ? ' aria-current="date"' : ""} data-date="${day.format("YYYY-MM-DD")}" data-type="calendar-drop-day">
            <button class="av__calendar-list-title" data-type="calendar-new" data-date="${day.format("YYYY-MM-DD")}"${editable ? "" : " disabled"}>${escapeHtml(`${formatCalendarDate(day, {weekday: "short"})} ${day.date()}`)}</button>
            <div class="av__calendar-all-day">${allDayEvents.map(event => eventButtonHTML(event, day, editable)).join("")}</div>
        </div>`;
    }).join("")}
    </div>
    ${renderTimeGrid(days, events, editable)}
</div>`;
};

const renderDay = (anchor: dayjs.Dayjs, events: ICalendarNormalizedEvent[], editable = true) => {
    const dayEvents = sortCalendarEvents(events.filter(event => eventOverlapsDay(event, anchor)));
    const allDayEvents = dayEvents.filter(event => event.isAllDay);
    return `<div class="av__calendar-day-view${anchor.isSame(dayjs(), "day") ? " av__calendar-day--today" : ""}"${anchor.isSame(dayjs(), "day") ? ' aria-current="date"' : ""} data-date="${anchor.format("YYYY-MM-DD")}" data-type="calendar-drop-day">
    <button class="av__calendar-list-title" data-type="calendar-new" data-date="${anchor.format("YYYY-MM-DD")}"${editable ? "" : " disabled"}>${escapeHtml(formatCalendarDate(anchor, {weekday: "long", month: "short", day: "numeric"}))}</button>
    <div class="av__calendar-all-day">${allDayEvents.length > 0 ? allDayEvents.map(event => eventButtonHTML(event, anchor, editable)).join("") : `<span class="ft__on-surface">${window.siyuan.languages.emptyContent}</span>`}</div>
    <div class="av__calendar-now">${dayjs().isSame(anchor, "day") ? dayjs().format("HH:mm") : ""}</div>
    ${renderTimeGrid([anchor], events, editable)}
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
            html += `<div class="av__calendar-list-day${cursor.isSame(dayjs(), "day") ? " av__calendar-day--today" : ""}"${cursor.isSame(dayjs(), "day") ? ' aria-current="date"' : ""} data-date="${cursor.format("YYYY-MM-DD")}" data-type="calendar-drop-day">
    <button class="av__calendar-list-title" data-type="calendar-new" data-date="${cursor.format("YYYY-MM-DD")}"${editable ? "" : " disabled"}>${escapeHtml(formatCalendarDate(cursor, {weekday: "short", year: "numeric", month: "short", day: "numeric"}))}</button>
    <div class="av__calendar-list-events">${dayEvents.length > 0 ? dayEvents.map(event => eventButtonHTML(event, cursor, editable)).join("") : `<span class="ft__on-surface">${window.siyuan.languages.emptyContent}</span>`}</div>
</div>`;
        }
        cursor = cursor.add(1, "day");
    }
    if (renderedDays === 0) {
        html += `<div class="av__calendar-no-results ft__on-surface">${window.siyuan.languages.calendarNoMatchingEvent || window.siyuan.languages.emptyContent}</div>`;
    }
    return `${html}</div>`;
};

// databaseQuery 是工具栏放大镜（av-search）里的关键字，已由内核过滤过条目；
// 日历自己的搜索框只在返回结果上再做一次本地细化，两者共用同一个清除入口与提示状态。
const getCalendarHTML = (data: IAV, blockElement: HTMLElement, editable = true, databaseQuery = "") => {
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
    const hasLocalQuery = !!search || filter !== "all";
    const hasActiveQuery = !!search || filter !== "all" || !!databaseQuery;
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
        body = `<div class="av__calendar-no-results ft__on-surface">${window.siyuan.languages.calendarNoMatchingEvent || window.siyuan.languages.emptyContent}</div>${body}`;
    }
    if (!hasActiveQuery && normalized.baseEventsByID.size === 0 && editable) {
        body = `<div class="av__calendar-empty-hint ft__on-surface">${window.siyuan.languages.calendarEmptyHint || "No calendar items yet — click a day or a time slot to create the first one."}</div>${body}`;
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
        ${hasLocalQuery ? `<span class="av__calendar-search-count">${events.length}/${totalEventCount}</span>` : ""}${hasActiveQuery ? `<button class="block__icon block__icon--show" data-type="calendar-clear-search" aria-label="${window.siyuan.languages.clear || "Clear"}" aria-keyshortcuts="Escape"><svg><use xlink:href="#iconClose"></use></svg></button>` : ""}
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
    // "Each entry is a page" is a per-view setting; every creation site in this
    // renderer (time slot, day cell, toolbar button, dialog) branches on this one
    // value so they can never diverge.
    const createsDocuments = calendarCreatesDocuments(calendar, options.blockElement);
    const rerender = (focusSearch = false, useCurrentData = false) => {
        options.blockElement.removeAttribute("data-render");
        renderCalendar({...options, data: useCurrentData ? data : undefined}).then(() => {
            if (!focusSearch) {
                return;
            }
            const searchInput = options.blockElement.querySelector('[data-type="calendar-search"]') as HTMLInputElement;
            searchInput?.focus();
            searchInput?.setSelectionRange(searchInput.value.length, searchInput.value.length);
        }).catch((error) => {
            // 重绘抛错时 data-render 已被摘掉：不恢复标记的话日历会永久停在陈旧画面，
            // 而且用户看不到任何提示（这正是渲染类缺陷难以察觉的原因）。
            options.blockElement.setAttribute("data-render", "true");
            showMessage(window.siyuan.languages._kernel[258]);
            console.error("calendar rerender failed", error);
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
    const withCalendarOperationFeedback = async (operationElement: HTMLElement | null, operationLabel: string, failureMessage: string, callback: () => Promise<boolean>) => {
        if (operationElement?.dataset.calendarOperation === "pending") {
            return false;
        }
        if (operationElement) {
            operationElement.dataset.calendarOperation = "pending";
            operationElement.setAttribute("aria-busy", "true");
            operationElement.classList.add("av__calendar-event--pending");
        }
        try {
            const saved = await callback();
            if (!saved) {
                showMessage(`${failureMessage || window.siyuan.languages._kernel[258]} ${window.siyuan.languages.calendarEventRestored || "Event restored."}`);
                rerender();
                return false;
            }
            return true;
        } catch (error) {
            showMessage(`${failureMessage} ${window.siyuan.languages.calendarEventRestored || "Event restored."}`);
            rerender();
            return false;
        } finally {
            if (operationElement) {
                delete operationElement.dataset.calendarOperation;
                operationElement.removeAttribute("aria-busy");
                operationElement.classList.remove("av__calendar-event--pending");
            }
        }
    };
    // Every dialog entry point in this renderer goes through here, so the
    // "new entries are pages" decision cannot be forgotten at one of them.
    const openCalendarEventDialog = (dialogOptions: {
        date: string;
        event?: ICalendarNormalizedEvent;
        draft?: Partial<ICalendarEventDraft>;
        readOnly?: boolean;
        onSave?: () => void;
        onDelete?: () => void;
    }) => {
        openEventDialog({
            protyle: options.protyle,
            blockElement: options.blockElement,
            data,
            createAsDocument: createsDocuments,
            ...dialogOptions,
        });
    };
    const buildCreateOptions = (draft: ICalendarEventDraft): ICalendarCreateOptions | null => {
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        const createMapping = getCalendarFieldMapping(calendar);
        if (!avID || !blockID || !createMapping.dateFieldID) {
            return null;
        }
        return {
            protyle: options.protyle,
            avID,
            blockID,
            viewID: data.viewID,
            dateFieldID: createMapping.dateFieldID,
            fields: calendar.fields,
            mapping: createMapping,
            draft,
            previousUpdated: options.blockElement.getAttribute("updated") || "",
        };
    };
    /**
     * Optimistic page create: the popover has already closed, the chip is on the
     * grid, and the answer only decides whether the chip is replaced by the real
     * render or removed with the reason shown. The chip is removed on every exit
     * path - a failed create must not leave a phantom event behind.
     */
    const createEventDocumentOptimistically = (createOptions: ICalendarCreateOptions) => {
        const pendingChip = paintOptimisticEvent(calendarElement, createOptions.draft);
        createCalendarEventAsDocument(createOptions).then(created => {
            pendingChip?.remove();
            if (created) {
                rerender();
            }
        }).catch(error => {
            pendingChip?.remove();
            showMessage(window.siyuan.languages.calendarCreateFailed || "Create failed.");
            console.error("calendar page create failed", error);
        });
    };
    const startCalendarQuickCreate = (target: HTMLElement, top: number, draft: ICalendarEventDraft) => {
        openQuickCreate({
            target: target.parentElement || target,
            top,
            draft,
            onSave: async (savedDraft) => {
                const createOptions = buildCreateOptions(savedDraft);
                if (!createOptions) {
                    throw new Error(window.siyuan.languages.calendarCreateFailed || "Create failed.");
                }
                if (createsDocuments) {
                    // Do NOT await: creating a document takes createDocLock and
                    // flushes the transaction queue three times, and the user must
                    // not sit in a blocked popover for that.
                    createEventDocumentOptimistically(createOptions);
                    return;
                }
                if (!await createCalendarEvent(createOptions)) {
                    throw new Error("calendar transaction rejected");
                }
                rerender();
            },
            onMoreOptions: (moreDraft) => openCalendarEventDialog({date: draft.date, draft: moreDraft, onSave: rerender}),
            onCancel: () => undefined,
        });
    };
    const setCalendarViewMode = (mode: number) => {
        const persistedMode = getSafeViewMode(calendar.viewMode);
        const hasLocalOverride = !!options.blockElement.dataset.calendarViewMode;
        if (![0, 1, 2, 3].includes(mode) || (mode === persistedMode && !hasLocalOverride && mode === viewMode)) {
            return;
        }
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        if (!editable || !avID || !blockID) {
            options.blockElement.dataset.calendarViewMode = String(mode);
            rerender(false, true);
            return;
        }
        if (mode === persistedMode) {
            // Leaving a local peek for the persisted mode must not touch av.json.
            delete options.blockElement.dataset.calendarViewMode;
            calendar.viewMode = mode;
            rerender();
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
            data: persistedMode,
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
    calendarElement?.querySelectorAll('[data-type="calendar-drop-day"]').forEach(item => {
        item.addEventListener("click", (event: MouseEvent) => {
            if ((event.target as HTMLElement).closest(".av__calendar-event, .av__calendar-quick-create, button, input, select")) {
                return;
            }
            const date = (item as HTMLElement).dataset.date;
            if (!date || options.blockElement.dataset.calendarDate === date) {
                return;
            }
            if ((item as HTMLElement).classList.contains("av__calendar-day--muted")) {
                // Adjacent-month cells navigate, so the visible month always
                // matches the stored anchor.
                setCalendarAnchor(dayjs(date));
                return;
            }
            // Select without re-rendering so the current view stays put; the
            // anchor is picked up by view switches and prev/next navigation.
            options.blockElement.dataset.calendarDate = date;
            const jumpInput = calendarElement.querySelector('[data-type="calendar-jump-date"]') as HTMLInputElement;
            if (jumpInput) {
                jumpInput.value = date;
            }
            calendarElement.querySelectorAll(".av__calendar-day--selected").forEach(selectedElement => selectedElement.classList.remove("av__calendar-day--selected"));
            (item as HTMLElement).classList.add("av__calendar-day--selected");
        });
    });
    calendarElement?.querySelectorAll('[data-type="calendar-more"]').forEach(item => {
        item.addEventListener("click", (event: MouseEvent) => {
            event.preventDefault();
            event.stopPropagation();
            const date = (item as HTMLElement).dataset.date;
            if (!date) {
                return;
            }
            // Peek at the day locally without persisting the saved view mode.
            options.blockElement.dataset.calendarDate = date;
            options.blockElement.dataset.calendarViewMode = "2";
            rerender(false, true);
        });
    });
    calendarElement?.querySelectorAll('[data-type="calendar-time-slot"]').forEach(item => {
        item.addEventListener("click", () => {
            if (!editable) {
                return;
            }
            const slotElement = item as HTMLElement;
            const date = slotElement.dataset.date || dayjs().format("YYYY-MM-DD");
            const draft: ICalendarEventDraft = {
                title: "",
                date,
                endDate: date,
                isAllDay: false,
                startTime: slotElement.dataset.start || "09:00",
                endTime: slotElement.dataset.end || "09:30",
            };
            startCalendarQuickCreate(slotElement, slotElement.offsetTop, draft);
        });
    });
    calendarElement?.querySelectorAll('[data-type="calendar-new"]').forEach(item => {
        item.addEventListener("click", () => {
            if (!editable) {
                return;
            }
            const newElement = item as HTMLElement;
            const date = newElement.dataset.date || dayjs().format("YYYY-MM-DD");
            const draft: ICalendarEventDraft = {
                title: "",
                date,
                endDate: date,
                isAllDay: true,
                startTime: "09:00",
                endTime: "09:30",
            };
            startCalendarQuickCreate(newElement, newElement.offsetTop + newElement.offsetHeight, draft);
        });
    });
    calendarElement?.querySelectorAll('[data-type="calendar-drop-day"]').forEach(item => {
        item.addEventListener("dblclick", (event: MouseEvent) => {
            if (!editable || (event.target as HTMLElement).closest(".av__calendar-event, [data-type='calendar-new'], [data-type='calendar-time-slot']")) {
                return;
            }
            openCalendarEventDialog({date: (item as HTMLElement).dataset.date || dayjs().format("YYYY-MM-DD"), onSave: rerender});
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
    // 工具栏放大镜的关键字由内核过滤，清除时必须一并清掉并重新取数，
    // 否则用户点了“清除”仍看不到被内核过滤掉的条目。
    const clearDatabaseQuery = () => {
        const headerSearchElement = options.blockElement.querySelector('[data-type="av-search"]') as HTMLElement;
        if (!headerSearchElement?.textContent) {
            return false;
        }
        headerSearchElement.textContent = "";
        options.blockElement.querySelector(".av__views")?.classList.remove("av__views--show");
        return true;
    };
    calendarElement?.querySelector('[data-type="calendar-clear-search"]')?.addEventListener("click", () => {
        const databaseQueryCleared = clearDatabaseQuery();
        delete options.blockElement.dataset.calendarSearch;
        delete options.blockElement.dataset.calendarFilter;
        rerender(true, !databaseQueryCleared);
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
            if (editable && mapping.hasDateField) {
                openCalendarEventDialog({date: getCurrentAnchor().format("YYYY-MM-DD"), onSave: rerender});
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
        } else if (event.key === "Escape" && (getCalendarSearch(options.blockElement) || getCalendarFilter(options.blockElement) !== "all" ||
            !!(options.blockElement.querySelector('[data-type="av-search"]') as HTMLElement)?.textContent)) {
            event.preventDefault();
            clearDatabaseQuery();
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
    const updateEventWithDraft = (sourceEvent: ICalendarNormalizedEvent, draft: ICalendarEventDraft, operationElement: HTMLElement | null, operationLabel: string, failureMessage: string, scope: CalendarRecurrenceScope = "series") => {
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        if (!avID || !blockID || !mapping.dateFieldID) {
            showMessage(`${failureMessage} ${window.siyuan.languages.calendarEventRestored || "Event restored."}`);
            rerender();
            return;
        }
        const transactionOptions = {
            protyle: options.protyle,
            avID,
            blockID,
            dateFieldID: mapping.dateFieldID,
            fields: calendar.fields,
            mapping,
            event: sourceEvent,
            draft,
            previousUpdated: options.blockElement.getAttribute("updated") || "",
        };
        withCalendarOperationFeedback(operationElement, operationLabel, failureMessage, async () => {
            const saved = await (scope === "occurrence" ? createCalendarEventReplacingOccurrence({
                ...transactionOptions,
                occurrenceDate: sourceEvent.start.format("YYYY-MM-DD"),
            }) : scope === "future" ? updateCalendarEventThisAndFuture({
                ...transactionOptions,
                occurrenceDate: sourceEvent.start.format("YYYY-MM-DD"),
            }) : updateCalendarEvent(transactionOptions));
            if (saved) {
                rerender();
            }
            return saved;
        });
    };
    // Direct manipulation (drag move, resize, schedule drop) of a recurring item
    // must ask the user for scope, exactly like dialog edits do (P0.6).
    const applyScopedEventDraft = (sourceEvent: ICalendarNormalizedEvent, buildDraft: (target: ICalendarNormalizedEvent) => ICalendarEventDraft, operationElement: HTMLElement | null, operationLabel: string, failureMessage: string, action: "move" | "resize") => {
        if (!sourceEvent.isOccurrence && !isRecurringSourceEvent(sourceEvent)) {
            updateEventWithDraft(sourceEvent, buildDraft(sourceEvent), operationElement, operationLabel, failureMessage);
            return;
        }
        openRecurrenceScopeDialog({
            action,
            disabledScopes: getDisabledRecurrenceScopes(mapping, "edit", sourceEvent),
            onSelect: (scope) => {
                if (scope === "series") {
                    const baseEvent = baseEvents.get(sourceEvent.baseEventID || sourceEvent.id) || sourceEvent;
                    updateEventWithDraft(baseEvent, buildDraft(baseEvent), operationElement, operationLabel, failureMessage, "series");
                    return;
                }
                updateEventWithDraft(sourceEvent, buildDraft(sourceEvent), operationElement, operationLabel, failureMessage, scope);
            },
        });
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
    const duplicateEventToNextDay = (sourceEvent: ICalendarNormalizedEvent, operationElement: HTMLElement | null) => {
        const avID = options.blockElement.getAttribute("data-av-id");
        const blockID = options.blockElement.getAttribute("data-node-id");
        if (!avID || !blockID || !mapping.dateFieldID) {
            showMessage(window.siyuan.languages.calendarCreateFailed || "Create failed.");
            return;
        }
        const draft = buildDraftForDate(sourceEvent, sourceEvent.start.add(1, "day").format("YYYY-MM-DD"));
        draft.recurrenceRaw = "";
        draft.recurrenceExceptionRaw = "";
        withCalendarOperationFeedback(operationElement, window.siyuan.languages.saved || "Saved", window.siyuan.languages.calendarCreateFailed || "Create failed.", async () => {
            const saved = await createCalendarEvent({
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
            }
            return saved;
        });
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
                    applyScopedEventDraft(sourceEvent, (target) => ({
                        title: target.title,
                        date: target.start.format("YYYY-MM-DD"),
                        endDate: target.start.startOf("day").add(nextDurationDays, "day").format("YYYY-MM-DD"),
                        isAllDay: true,
                        startTime: target.start.format("HH:mm"),
                        endTime: target.end ? target.end.format("HH:mm") : "23:59",
                        recurrenceRaw: target.recurrenceRaw,
                        location: target.location,
                        description: target.description,
                        colorContent: target.colorContent,
                    }), item as HTMLElement, window.siyuan.languages.saved || "Saved", window.siyuan.languages.calendarResizeFailed || "Resize failed.", "resize");
                    return;
                }
                const delta = parseInt(resizeElement.dataset.delta || "0", 10);
                const currentEnd = sourceEvent.end || sourceEvent.start.add(1, "hour");
                const nextEnd = currentEnd.add(delta, "minute");
                if (!nextEnd.isAfter(sourceEvent.start)) {
                    return;
                }
                const nextDuration = nextEnd.diff(sourceEvent.start, "minute");
                applyScopedEventDraft(sourceEvent, (target) => {
                    const targetEnd = target.start.add(nextDuration, "minute");
                    return {
                        title: target.title,
                        date: target.start.format("YYYY-MM-DD"),
                        endDate: targetEnd.format("YYYY-MM-DD"),
                        isAllDay: false,
                        startTime: target.start.format("HH:mm"),
                        endTime: targetEnd.format("HH:mm"),
                        recurrenceRaw: target.recurrenceRaw,
                        location: target.location,
                        description: target.description,
                        colorContent: target.colorContent,
                    };
                }, item as HTMLElement, window.siyuan.languages.saved || "Saved", window.siyuan.languages.calendarResizeFailed || "Resize failed.", "resize");
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
                    duplicateEventToNextDay(sourceEvent, item as HTMLElement);
                }
                return;
            }
            const calendarEvent = renderedEvents.get((item as HTMLElement).dataset.occurrence || "") || baseEvents.get((item as HTMLElement).dataset.id || "");
            const openEventScheduling = () => {
                if (!calendarEvent) {
                    return;
                }
                if (!editable) {
                    openCalendarEventDialog({event: calendarEvent, date: calendarEvent.start.format("YYYY-MM-DD"), readOnly: true});
                    return;
                }
                const eventForDialog = getEditableEvent(calendarEvent);
                openCalendarEventDialog({event: eventForDialog, date: eventForDialog.start.format("YYYY-MM-DD"), onSave: rerender, onDelete: rerender});
            };
            const scheduleElement = (event.target as HTMLElement).closest('[data-type="calendar-open-dialog"]') as HTMLElement;
            if (scheduleElement) {
                event.preventDefault();
                event.stopPropagation();
                openEventScheduling();
                return;
            }
            const sourceElement = (event.target as HTMLElement).closest('[data-type="calendar-open-source"]') as HTMLElement;
            if (sourceElement) {
                event.preventDefault();
                event.stopPropagation();
                if (calendarEvent && getEventDocumentID(calendarEvent)) {
                    openCalendarEventSource(options.protyle, options.blockElement, calendarEvent);
                }
                return;
            }
            // "Each entry is a page": for a bound entry the primary click opens the
            // page, exactly like clicking a row in a table/gallery does. Detached
            // rows have no page to open, so they keep opening the dialog.
            if (calendarEvent && getEventDocumentID(calendarEvent)) {
                openCalendarEventSource(options.protyle, options.blockElement, calendarEvent);
                return;
            }
            openEventScheduling();
        });
    });
    // The chip is a <button>, so Enter/Space on the chip itself already reaches
    // the click handler. The affordances inside it are role="button" spans, which
    // get no native activation - without this, a keyboard user could reach the
    // scheduling dialog of a bound entry only with a mouse.
    calendarElement?.querySelectorAll(".av__calendar-event").forEach(item => {
        item.addEventListener("keydown", (event: KeyboardEvent) => {
            if (event.key !== "Enter" && event.key !== " ") {
                return;
            }
            const affordance = (event.target as HTMLElement).closest('[data-type="calendar-open-dialog"], [data-type="calendar-open-source"]') as HTMLElement;
            if (!affordance || affordance === item) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            affordance.click();
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
            const dragOffsetDays = displayDate ? Math.max(dayjs(displayDate).startOf("day").diff(sourceEvent.start.startOf("day"), "day"), 0) : 0;
            const draftDate = dayjs(targetDate).subtract(dragOffsetDays, "day").format("YYYY-MM-DD");
            const draggedEventElement = calendarElement?.querySelector(`.av__calendar-event[data-occurrence="${eventID}"], .av__calendar-event[data-id="${eventID}"]`) as HTMLElement;
            applyScopedEventDraft(sourceEvent, (target) => {
                const dayDelta = dayjs(draftDate).diff(sourceEvent.start.startOf("day"), "day");
                const targetDraftDate = target === sourceEvent ?
                    draftDate :
                    target.start.startOf("day").add(dayDelta, "day").format("YYYY-MM-DD");
                const draft = buildDraftForDate(target, targetDraftDate);
                if (target.isAllDay && target.end && !target.start.isSame(target.end, "day")) {
                    draft.endTime = target.end?.format("HH:mm") || "23:59";
                }
                return draft;
            }, draggedEventElement, window.siyuan.languages.saved || "Saved", window.siyuan.languages.calendarMoveFailed || "Move failed.", "move");
        });
    });
};

// 重渲染会整块替换 HTML，焦点元素随之消失。用这些属性拼一个可复原的选择器，
// 使新建/移动/缩放事件后焦点仍停在原来的事件或时间格上。
const CALENDAR_FOCUS_ATTRIBUTES = ["data-id", "data-occurrence", "data-date", "data-start", "data-mode"];

const isSelectorSafe = (value: string) => !!value && !/["\\]/.test(value);

const getFocusAttributeSelector = (element: HTMLElement) => {
    let selector = "";
    CALENDAR_FOCUS_ATTRIBUTES.forEach(attribute => {
        const value = element.getAttribute(attribute);
        if (isSelectorSafe(value)) {
            selector += `[${attribute}="${value}"]`;
        }
    });
    return selector;
};

const getCalendarFocusSelector = (blockElement: HTMLElement): {selector: string, fallback: string} => {
    const activeElement = document.activeElement as HTMLElement;
    if (!activeElement || !blockElement.contains(activeElement) || !hasClosestByClassName(activeElement, "av__calendar")) {
        return {selector: "", fallback: ""};
    }
    if (activeElement.classList.contains("av__calendar-event")) {
        const id = activeElement.getAttribute("data-id");
        return {
            selector: `.av__calendar-event${getFocusAttributeSelector(activeElement)}`,
            // 移动/缩放后事件可能落到别的日期格，此时按条目 ID 兜底
            fallback: isSelectorSafe(id) ? `.av__calendar-event[data-id="${id}"]` : "",
        };
    }
    const type = activeElement.getAttribute("data-type");
    if (!isSelectorSafe(type)) {
        return {selector: "", fallback: ""};
    }
    // 时间格等控件只有连同日期/时刻才能唯一定位，不做只按 data-type 的兜底
    return {selector: `[data-type="${type}"]${getFocusAttributeSelector(activeElement)}`, fallback: ""};
};

const restoreCalendarFocus = (blockElement: HTMLElement, focus: {selector: string, fallback: string}) => {
    if (!focus.selector) {
        return;
    }
    const targetElement = (blockElement.querySelector(focus.selector) ||
        (focus.fallback ? blockElement.querySelector(focus.fallback) : null)) as HTMLElement;
    if (!targetElement) {
        return;
    }
    // preventScroll：滚动位置已单独恢复，聚焦不能再把网格拉走
    targetElement.focus({preventScroll: true});
    if (targetElement instanceof HTMLInputElement && ["text", "search"].includes(targetElement.type)) {
        targetElement.setSelectionRange(targetElement.value.length, targetElement.value.length);
    }
};

// 定位请求（siyuan://blocks/<id>?avViewID=&avItemID=）指向的条目可能不在当前可见日期范围内，
// 先把锚定日期挪到该条目的开始日期，事件才会被渲染出来供 finishAVLocate 高亮。
const anchorCalendarOnLocateTarget = (data: IAV, blockElement: HTMLElement) => {
    const itemID = data.target?.itemID;
    if (!itemID) {
        return;
    }
    const calendar = data.view as IAVCalendar;
    const mapping = getCalendarFieldMapping(calendar);
    if (!mapping.hasDateField) {
        return;
    }
    const card = calendar.cards?.find(item => item.id === itemID);
    if (!card) {
        return;
    }
    const content = getCellByFieldID(card, mapping.dateFieldID)?.value?.date?.content;
    if (!content) {
        return;
    }
    const start = dayjs(content);
    if (start.isValid()) {
        blockElement.dataset.calendarDate = start.format("YYYY-MM-DD");
    }
};

export const renderCalendar = async (options: IRenderCalendarOptions) => {
    const e = options.blockElement;
    const renderToken = beginAVRender(e);
    const searchInputElement = e.querySelector('[data-type="av-search"]');
    const timeGridElement = e.querySelector(".av__calendar-time-grid") as HTMLElement;
    const resetData = {
        isSearching: !!searchInputElement && document.activeElement === searchInputElement,
        query: searchInputElement?.textContent || "",
        oldOffset: options.protyle.contentElement?.scrollTop,
        scrollLeft: (e.querySelector(".av__scroll") as HTMLElement)?.scrollLeft || 0,
        gridScrollTop: timeGridElement?.scrollTop || 0,
        gridScrollLeft: timeGridElement?.scrollLeft || 0,
        focusTarget: getCalendarFocusSelector(e),
        virtualData: {} as { [key: string]: IAVVirtualData },
    };
    let data = options.data;
    if (!data) {
        const created = options.protyle.options.history?.created;
        const snapshot = options.protyle.options.history?.snapshot;
        const locateParams = getAVLocateParams(e, !created && !snapshot);
        const response = await fetchSyncPost(created ? "/api/av/renderHistoryAttributeView" : (snapshot ? "/api/av/renderSnapshotAttributeView" : "/api/av/renderAttributeView"), {
            id: e.getAttribute("data-av-id"),
            created,
            snapshot,
            // 日历目前不分页：内核的日历渲染路径只回填 CardCount/PageSize 而不切片，
            // 所以整库条目都会被传回并归一化（payload 无上界），配置面板里的“条目数”
            // 设置对日历没有任何作用（应在 av/layout.ts 里对日历隐藏该行）。
            // 未来的正解是按可见日期范围在服务端分页，而不是在前端补虚拟滚动。
            pageSize: -1,
            viewID: locateParams?.viewID || e.getAttribute(Constants.CUSTOM_SY_AV_VIEW) || "",
            query: resetData.query.trim(),
            blockID: e.getAttribute("data-node-id"),
            // 浏览历史/快照时不能创建数据
            createIfNotExist: !created && !snapshot && !options.protyle.block.action?.includes(Constants.CB_GET_AV_NO_CREATE),
            targetItemID: locateParams?.targetItemID || "",
            targetGroupID: locateParams?.targetGroupID || "",
        });
        data = response.data;
    }
    // 取数期间可能已有更新的渲染开始（或视图被切走），陈旧结果不能覆盖新结果
    if (!isCurrentAVRender(e, renderToken)) {
        return;
    }
    if (!data) {
        return;
    }
    prepareAVLocate(e, data, resetData);
    // data-av-type 可能是陈旧值（视图布局在别处被改过），此时必须转交给对应的渲染器
    if (data.viewType === "table") {
        e.setAttribute("data-av-type", data.viewType);
        await avRender(e, options.protyle, options.cb, options.renderAll, data);
        return;
    }
    if (data.viewType === "gallery") {
        e.setAttribute("data-av-type", data.viewType);
        await renderGallery({
            blockElement: e,
            protyle: options.protyle,
            cb: options.cb,
            renderAll: options.renderAll,
            data
        });
        return;
    }
    if (data.viewType === "kanban") {
        e.setAttribute("data-av-type", data.viewType);
        await renderKanban({
            blockElement: e,
            protyle: options.protyle,
            cb: options.cb,
            renderAll: options.renderAll,
            data
        });
        return;
    }
    e.setAttribute("data-av-type", "calendar");
    // The local new-entry target has served its purpose once the kernel reports
    // the same value; keeping it would silently outrank a change made elsewhere
    // (another view of the same database, another window).
    if (e.dataset.calendarNewItemTarget &&
        e.dataset.calendarNewItemTarget === (getPersistedNewItemTarget(data.view as IAVCalendar) || CALENDAR_NEW_ITEM_TARGET_ROW)) {
        delete e.dataset.calendarNewItemTarget;
    }
    anchorCalendarOnLocateTarget(data, e);
    const editable = !options.protyle.disabled && !hasClosestByAttribute(e, "data-type", "NodeBlockQueryEmbed");
    const body = `<div class="av__body" data-page-size="-1">${getCalendarHTML(data, e, editable, resetData.query)}</div>`;
    // 上一次渲染可能是别的布局（没有 av__scroll），此时必须整体重建容器
    const scrollElement = options.renderAll ? null : e.firstElementChild?.querySelector(".av__scroll");
    if (scrollElement) {
        scrollElement.innerHTML = body;
    } else {
        e.firstElementChild.outerHTML = `<div class="av__container">
    ${genTabHeaderHTML(data, resetData.isSearching || !!resetData.query, editable)}
    <div class="av__scroll">${body}</div>
</div>`;
    }
    // HTML 已在 DOM 中后才置 data-render，避免中途失败留下“已渲染”的空壳
    e.setAttribute("data-render", "true");
    // 模板新建的条目在日历日期字段上没有值（不可见），日历用工具栏里的新建入口替代
    e.querySelector('[data-type="av-add-template"]')?.remove();
    bindCalendarEvents(options, data);
    if (!scrollElement) {
        bindAvSearch({
            blockElement: e,
            query: resetData.query,
            isSearching: resetData.isSearching,
            onChange: () => updateSearch(e, options.protyle),
        });
    }
    if (typeof resetData.oldOffset === "number" && options.protyle.contentElement) {
        options.protyle.contentElement.scrollTop = resetData.oldOffset;
    }
    if (e.getAttribute("data-need-focus") === "true") {
        focusBlock(e);
        e.removeAttribute("data-need-focus");
    }
    const newScrollElement = e.querySelector(".av__scroll") as HTMLElement;
    if (newScrollElement && resetData.scrollLeft) {
        newScrollElement.scrollLeft = resetData.scrollLeft;
    }
    const newTimeGridElement = e.querySelector(".av__calendar-time-grid") as HTMLElement;
    if (newTimeGridElement) {
        newTimeGridElement.scrollTop = resetData.gridScrollTop;
        newTimeGridElement.scrollLeft = resetData.gridScrollLeft;
    }
    restoreCalendarFocus(e, resetData.focusTarget);
    options.cb?.(data);
    finishAVLocate(e, options.protyle, data);
};
