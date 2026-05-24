import {Dialog} from "../../../../dialog";
import {showMessage} from "../../../../dialog/message";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {getCalendarFieldMapping} from "./mapped-fields";
import {ICalendarNormalizedEvent} from "./model";
import {createCalendarEvent, createCalendarEventReplacingOccurrence, deleteCalendarEvent, deleteCalendarOccurrence, updateCalendarEvent, updateCalendarEventThisAndFuture} from "./transactions";

interface IRecurrenceFormValue {
    freq: string;
    interval: string;
    count: string;
    until: string;
    byDay: string[];
    raw: string;
    isAdvanced: boolean;
}

export interface IEventDialogOptions {
    event?: ICalendarNormalizedEvent;
    date: string;
    protyle: IProtyle;
    blockElement: HTMLElement;
    data: IAV;
    onSave?: () => void;
    onDelete?: () => void;
}

const getCalendarLocale = () => window.siyuan.config.lang.replace("_", "-");

const getWeekdayLabels = () => {
    const formatter = new Intl.DateTimeFormat(getCalendarLocale(), {weekday: "short"});
    return [0, 1, 2, 3, 4, 5, 6].map(index => formatter.format(new Date(2020, 5, 7 + index)));
};

const parseRecurrenceFormValue = (value?: string): IRecurrenceFormValue => {
    const raw = (value || "").trim();
    if (!raw || raw.toLowerCase() === "none") {
        return {freq: "", interval: "1", count: "", until: "", byDay: [], raw: "", isAdvanced: false};
    }
    const upper = raw.toUpperCase();
    if (["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(upper)) {
        return {freq: upper, interval: "1", count: "", until: "", byDay: [], raw, isAdvanced: false};
    }
    const result: IRecurrenceFormValue = {freq: "", interval: "1", count: "", until: "", byDay: [], raw, isAdvanced: false};
    const supportedKeys = ["FREQ", "INTERVAL", "COUNT", "UNTIL", "BYDAY"];
    const weekdays = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
    upper.split(";").filter(Boolean).forEach(part => {
        const [key, val] = part.split("=");
        if (!supportedKeys.includes(key)) {
            result.isAdvanced = true;
            return;
        }
        if (key === "FREQ" && ["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(val)) {
            result.freq = val;
        } else if (key === "INTERVAL" && parseInt(val, 10) > 0) {
            result.interval = val;
        } else if (key === "COUNT" && parseInt(val, 10) > 0) {
            result.count = val;
        } else if (key === "UNTIL") {
            result.until = val.slice(0, 10);
        } else if (key === "BYDAY") {
            result.byDay = val.split(",").filter(day => weekdays.includes(day));
        }
    });
    result.isAdvanced = result.isAdvanced || !result.freq || (result.byDay.length > 0 && result.freq !== "WEEKLY");
    return result;
};

const renderRecurrenceFields = (event?: ICalendarNormalizedEvent) => {
    const recurrence = parseRecurrenceFormValue(event?.recurrenceRaw || event?.recurrence?.freq || "");
    const labels = getWeekdayLabels();
    const weekdays = [
        {value: "SU", label: labels[0]},
        {value: "MO", label: labels[1]},
        {value: "TU", label: labels[2]},
        {value: "WE", label: labels[3]},
        {value: "TH", label: labels[4]},
        {value: "FR", label: labels[5]},
        {value: "SA", label: labels[6]},
    ];
    if (recurrence.isAdvanced) {
        return `<input class="b3-text-field fn__block" id="av-event-recurrence-raw" readonly value="${escapeAttr(recurrence.raw)}">
<div class="ft__on-surface ft__smaller">${window.siyuan.languages.calendarRecurringAdvancedReadOnly || "Advanced recurrence is retained (not editable here)."}</div>`;
    }
    return `<div class="av__calendar-recurrence">
    <select class="b3-select" id="av-event-recurrence-freq">
        <option value=""${recurrence.freq ? "" : " selected"}>${window.siyuan.languages.none || "None"}</option>
        <option value="DAILY"${recurrence.freq === "DAILY" ? " selected" : ""}>${window.siyuan.languages.calendarDaily || "Daily"}</option>
        <option value="WEEKLY"${recurrence.freq === "WEEKLY" ? " selected" : ""}>${window.siyuan.languages.calendarWeekly || "Weekly"}</option>
        <option value="MONTHLY"${recurrence.freq === "MONTHLY" ? " selected" : ""}>${window.siyuan.languages.calendarMonthly || "Monthly"}</option>
        <option value="YEARLY"${recurrence.freq === "YEARLY" ? " selected" : ""}>${window.siyuan.languages.calendarYearly || "Yearly"}</option>
    </select>
    <input type="number" min="1" step="1" class="b3-text-field" id="av-event-recurrence-interval" aria-label="${window.siyuan.languages.calendarInterval || "Interval"}" value="${escapeAttr(recurrence.interval || "1")}">
    <input type="number" min="1" step="1" class="b3-text-field" id="av-event-recurrence-count" aria-label="${window.siyuan.languages.calendarCount || "Count"}" placeholder="${window.siyuan.languages.calendarCount || "Count"}" value="${escapeAttr(recurrence.count)}">
    <input type="date" class="b3-text-field" id="av-event-recurrence-until" aria-label="${window.siyuan.languages.calendarUntil || "Until"}" value="${escapeAttr(recurrence.until)}">
    <div class="av__calendar-weekday" data-type="calendar-weekday-row">
        ${weekdays.map(day => `<label class="av__calendar-weekday-item">
            <input type="checkbox" data-type="calendar-recurrence-weekday" value="${day.value}"${recurrence.byDay.includes(day.value) ? " checked" : ""}>
            <span>${escapeHtml(day.label)}</span>
        </label>`).join("")}
    </div>
</div>`;
};

const getRecurrenceFromDialog = (dialog: Dialog) => {
    const rawInput = dialog.element.querySelector("#av-event-recurrence-raw") as HTMLInputElement;
    if (rawInput) {
        return rawInput.value;
    }
    const freq = (dialog.element.querySelector("#av-event-recurrence-freq") as HTMLSelectElement)?.value;
    if (!freq) {
        return "";
    }
    const interval = parseInt((dialog.element.querySelector("#av-event-recurrence-interval") as HTMLInputElement)?.value || "1", 10);
    const count = parseInt((dialog.element.querySelector("#av-event-recurrence-count") as HTMLInputElement)?.value || "", 10);
    const until = (dialog.element.querySelector("#av-event-recurrence-until") as HTMLInputElement)?.value;
    const parts = [`FREQ=${freq}`];
    if (interval > 1) {
        parts.push(`INTERVAL=${interval}`);
    }
    if (count > 0) {
        parts.push(`COUNT=${count}`);
    }
    if (until) {
        parts.push(`UNTIL=${until}`);
    }
    const byDay = Array.from(dialog.element.querySelectorAll('[data-type="calendar-recurrence-weekday"]:checked'))
        .map(item => (item as HTMLInputElement).value)
        .filter(Boolean);
    if (freq === "WEEKLY" && byDay.length > 0) {
        parts.push(`BYDAY=${byDay.join(",")}`);
    }
    return parts.join(";");
};

export const openEventDialog = (options: IEventDialogOptions): Dialog => {
    const {event, date} = options;
    const isEditing = !!event;
    const mapping = getCalendarFieldMapping(options.data.view as IAVCalendar);
    const canEditFuture = !!event?.isOccurrence && !!mapping.recurrenceFieldID;
    const content = `<div class="b3-dialog__content av__calendar-dialog">
    <div class="b3-form__space">
        <input class="b3-text-field fn__block" id="av-event-title" placeholder="${window.siyuan.languages.title || "Title"}" value="${escapeAttr(event?.title || "")}">
    </div>
    <div class="b3-form__space fn__flex">
        <input type="date" class="b3-text-field fn__flex-1" id="av-event-date" aria-label="${window.siyuan.languages.date || "Date"}" value="${event?.start.format("YYYY-MM-DD") || date}">
        <input type="date" class="b3-text-field fn__flex-1" id="av-event-end-date" aria-label="${window.siyuan.languages.endDate || "End date"}" value="${event?.end?.format("YYYY-MM-DD") || event?.start.format("YYYY-MM-DD") || date}">
        <label class="fn__flex-center av__calendar-check">
            <input type="checkbox" id="av-event-allday" ${event?.isAllDay ?? true ? "checked" : ""}>
            <span>${window.siyuan.languages.allDay || "All day"}</span>
        </label>
    </div>
    <div class="b3-form__space fn__flex" id="av-event-time-row" style="${event?.isAllDay ?? true ? "display:none" : ""}">
        <input type="time" class="b3-text-field fn__flex-1" id="av-event-start" value="${event?.start.format("HH:mm") || "09:00"}">
        <span class="av__calendar-time-sep">-</span>
        <input type="time" class="b3-text-field fn__flex-1" id="av-event-end" value="${event?.end?.format("HH:mm") || "10:00"}">
    </div>
    ${mapping.locationFieldID ? `<div class="b3-form__space">
        <input class="b3-text-field fn__block" id="av-event-location" placeholder="${window.siyuan.languages.calendarLocation || "Location"}" value="${escapeAttr(event?.location || "")}">
    </div>` : ""}
    ${mapping.recurrenceFieldID ? `<div class="b3-form__space">
        ${renderRecurrenceFields(event)}
    </div>` : ""}
    ${mapping.descriptionFieldID ? `<div class="b3-form__space">
        <textarea class="b3-text-field fn__block" id="av-event-description" rows="3" placeholder="${window.siyuan.languages.calendarDescription || "Description"}">${escapeHtml(event?.description || "")}</textarea>
    </div>` : ""}
    ${mapping.colorFieldID ? `<div class="b3-form__space">
        <input class="b3-text-field fn__block" id="av-event-color" placeholder="${window.siyuan.languages.color || "Color"}" value="${escapeAttr(event?.colorContent || "")}">
    </div>` : ""}
    <div class="b3-dialog__action">
        <button class="b3-button b3-button--cancel" data-type="event-cancel">${window.siyuan.languages.cancel}</button>
        <span class="fn__space"></span>
        ${isEditing ? `<button class="b3-button b3-button--outline" data-type="event-duplicate">${window.siyuan.languages.duplicate}</button><span class="fn__space"></span><button class="b3-button b3-button--remove" data-type="event-delete">${window.siyuan.languages.delete}</button><span class="fn__space"></span>` : ""}
        ${canEditFuture ? `<button class="b3-button b3-button--outline" data-type="event-save-future">${window.siyuan.languages.calendarThisAndFuture || "This and future"}</button><span class="fn__space"></span>` : ""}
        <button class="b3-button b3-button--text" data-type="event-save">${window.siyuan.languages.save}</button>
    </div>
</div>`;
    const dialog = new Dialog({
        title: isEditing ? (window.siyuan.languages.edit || "Edit") : (window.siyuan.languages.newEvent || "New Event"),
        content,
        width: "480px",
    });
    bindFormEvents(dialog, options);
    return dialog;
};

const bindFormEvents = (dialog: Dialog, options: IEventDialogOptions) => {
    const allDayCheckbox = dialog.element.querySelector("#av-event-allday") as HTMLInputElement;
    const timeRow = dialog.element.querySelector("#av-event-time-row") as HTMLElement;
    allDayCheckbox?.addEventListener("change", () => {
        timeRow.style.display = allDayCheckbox.checked ? "none" : "flex";
    });
    const dateInput = dialog.element.querySelector("#av-event-date") as HTMLInputElement;
    const endDateInput = dialog.element.querySelector("#av-event-end-date") as HTMLInputElement;
    dateInput?.addEventListener("change", () => {
        if (!endDateInput.value || endDateInput.value < dateInput.value) {
            endDateInput.value = dateInput.value;
        }
    });
    const recurrenceFreq = dialog.element.querySelector("#av-event-recurrence-freq") as HTMLSelectElement;
    const weekdayRow = dialog.element.querySelector('[data-type="calendar-weekday-row"]') as HTMLElement;
    const updateWeekdayVisibility = () => {
        if (weekdayRow) {
            weekdayRow.style.display = recurrenceFreq?.value === "WEEKLY" ? "flex" : "none";
        }
    };
    recurrenceFreq?.addEventListener("change", updateWeekdayVisibility);
    updateWeekdayVisibility();
    dialog.element.querySelector('[data-type="event-cancel"]')?.addEventListener("click", () => dialog.destroy());
    dialog.element.querySelector('[data-type="event-save"]')?.addEventListener("click", () => saveEvent(dialog, options));
    dialog.element.querySelector('[data-type="event-save-future"]')?.addEventListener("click", () => saveFutureEvent(dialog, options));
    dialog.element.querySelector('[data-type="event-delete"]')?.addEventListener("click", () => deleteEvent(dialog, options));
    dialog.element.querySelector('[data-type="event-duplicate"]')?.addEventListener("click", () => duplicateEvent(dialog, options));
    dialog.element.querySelector("#av-event-title")?.addEventListener("keydown", (event: KeyboardEvent) => {
        if (event.key === "Enter") {
            event.preventDefault();
            saveEvent(dialog, options);
        }
    });
};

const getDraftFromDialog = (dialog: Dialog) => {
    const date = (dialog.element.querySelector("#av-event-date") as HTMLInputElement).value;
    const endDateInput = (dialog.element.querySelector("#av-event-end-date") as HTMLInputElement).value;
    const endDate = endDateInput && endDateInput >= date ? endDateInput : date;
    return {
        title: (dialog.element.querySelector("#av-event-title") as HTMLInputElement).value.trim(),
        date,
        endDate,
        isAllDay: (dialog.element.querySelector("#av-event-allday") as HTMLInputElement).checked,
        startTime: (dialog.element.querySelector("#av-event-start") as HTMLInputElement).value || "09:00",
        endTime: (dialog.element.querySelector("#av-event-end") as HTMLInputElement).value || "10:00",
        recurrenceRaw: getRecurrenceFromDialog(dialog),
        location: (dialog.element.querySelector("#av-event-location") as HTMLInputElement)?.value,
        description: (dialog.element.querySelector("#av-event-description") as HTMLTextAreaElement)?.value,
        colorContent: (dialog.element.querySelector("#av-event-color") as HTMLInputElement)?.value,
    };
};

const saveEvent = (dialog: Dialog, options: IEventDialogOptions) => {
    const calendarData = options.data.view as IAVCalendar;
    const mapping = getCalendarFieldMapping(calendarData);
    const draft = getDraftFromDialog(dialog);
    const avID = options.blockElement.getAttribute("data-av-id");
    const blockID = options.blockElement.getAttribute("data-node-id");
    if (!draft.title || !draft.date || !avID || !blockID || !mapping.dateFieldID) {
        showMessage(window.siyuan.languages._kernel[29]);
        return;
    }
    if (options.event) {
        if (options.event.isOccurrence && mapping.exceptionFieldID) {
            createCalendarEventReplacingOccurrence({
                protyle: options.protyle,
                avID,
                blockID,
                dateFieldID: mapping.dateFieldID,
                fields: calendarData.fields,
                mapping,
                event: options.event,
                draft,
                occurrenceDate: options.event.start.format("YYYY-MM-DD"),
                previousUpdated: options.blockElement.getAttribute("updated") || "",
            });
            dialog.destroy();
            options.onSave?.();
            return;
        }
        updateCalendarEvent({
            protyle: options.protyle,
            avID,
            blockID,
            dateFieldID: mapping.dateFieldID,
            fields: calendarData.fields,
            mapping,
            event: options.event,
            draft,
            previousUpdated: options.blockElement.getAttribute("updated") || "",
        });
    } else {
        createCalendarEvent({
            protyle: options.protyle,
            avID,
            blockID,
            dateFieldID: mapping.dateFieldID,
            fields: calendarData.fields,
            mapping,
            draft,
            previousUpdated: options.blockElement.getAttribute("updated") || "",
        });
    }
    dialog.destroy();
    options.onSave?.();
};

const saveFutureEvent = (dialog: Dialog, options: IEventDialogOptions) => {
    const calendarData = options.data.view as IAVCalendar;
    const mapping = getCalendarFieldMapping(calendarData);
    const draft = getDraftFromDialog(dialog);
    const avID = options.blockElement.getAttribute("data-av-id");
    const blockID = options.blockElement.getAttribute("data-node-id");
    if (!options.event || !options.event.isOccurrence || !draft.title || !draft.date || !avID || !blockID || !mapping.dateFieldID || !mapping.recurrenceFieldID) {
        showMessage(window.siyuan.languages._kernel[29]);
        return;
    }
    updateCalendarEventThisAndFuture({
        protyle: options.protyle,
        avID,
        blockID,
        dateFieldID: mapping.dateFieldID,
        fields: calendarData.fields,
        mapping,
        event: options.event,
        draft,
        occurrenceDate: options.event.start.format("YYYY-MM-DD"),
        previousUpdated: options.blockElement.getAttribute("updated") || "",
    });
    dialog.destroy();
    options.onSave?.();
};

const duplicateEvent = (dialog: Dialog, options: IEventDialogOptions) => {
    const calendarData = options.data.view as IAVCalendar;
    const mapping = getCalendarFieldMapping(calendarData);
    const draft = getDraftFromDialog(dialog);
    const avID = options.blockElement.getAttribute("data-av-id");
    const blockID = options.blockElement.getAttribute("data-node-id");
    if (!draft.title || !draft.date || !avID || !blockID || !mapping.dateFieldID) {
        showMessage(window.siyuan.languages._kernel[29]);
        return;
    }
    createCalendarEvent({
        protyle: options.protyle,
        avID,
        blockID,
        dateFieldID: mapping.dateFieldID,
        fields: calendarData.fields,
        mapping,
        draft,
        previousUpdated: options.blockElement.getAttribute("updated") || "",
    });
    dialog.destroy();
    options.onSave?.();
};

const deleteEvent = (dialog: Dialog, options: IEventDialogOptions) => {
    const avID = options.blockElement.getAttribute("data-av-id");
    const blockID = options.blockElement.getAttribute("data-node-id");
    if (!options.event || !avID || !blockID) {
        return;
    }
    const calendarData = options.data.view as IAVCalendar;
    const mapping = getCalendarFieldMapping(calendarData);
    if (options.event.isOccurrence && mapping.exceptionFieldID) {
        deleteCalendarOccurrence({
            protyle: options.protyle,
            avID,
            blockID,
            fields: calendarData.fields,
            mapping,
            event: options.event,
            occurrenceDate: options.event.start.format("YYYY-MM-DD"),
            previousUpdated: options.blockElement.getAttribute("updated") || "",
        });
        dialog.destroy();
        options.onDelete?.();
        return;
    }
    deleteCalendarEvent({
        protyle: options.protyle,
        avID,
        blockID,
        event: options.event,
        previousUpdated: options.blockElement.getAttribute("updated") || "",
    });
    dialog.destroy();
    options.onDelete?.();
};
