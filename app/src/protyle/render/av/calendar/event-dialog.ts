import {Dialog} from "../../../../dialog";
import {showMessage} from "../../../../dialog/message";
import {escapeAttr, escapeHtml} from "../../../../util/escape";
import {getCalendarFieldMapping} from "./mapped-fields";
import {ICalendarNormalizedEvent} from "./model";
import {createCalendarEvent, deleteCalendarEvent, updateCalendarEvent} from "./transactions";

export interface IEventDialogOptions {
    event?: ICalendarNormalizedEvent;
    date: string;
    protyle: IProtyle;
    blockElement: HTMLElement;
    data: IAV;
    onSave?: () => void;
    onDelete?: () => void;
}

export const openEventDialog = (options: IEventDialogOptions): Dialog => {
    const {event, date} = options;
    const isEditing = !!event;
    const content = `<div class="b3-dialog__content av__calendar-dialog">
    <div class="b3-form__space">
        <input class="b3-text-field fn__block" id="av-event-title" placeholder="${window.siyuan.languages.title || "Title"}" value="${escapeAttr(event?.title || "")}">
    </div>
    <div class="b3-form__space fn__flex">
        <input type="date" class="b3-text-field fn__flex-1" id="av-event-date" value="${event?.start.format("YYYY-MM-DD") || date}">
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
    <div class="b3-form__space">
        <input class="b3-text-field fn__block" id="av-event-location" placeholder="${window.siyuan.languages.calendarLocation || "Location"}" value="${escapeAttr(event?.location || "")}">
    </div>
    <div class="b3-form__space">
        <input class="b3-text-field fn__block" id="av-event-recurrence" placeholder="${window.siyuan.languages.calendarRecurrence || "Recurrence"}" value="${escapeAttr(event?.recurrenceRaw || event?.recurrence?.freq || "")}">
    </div>
    <div class="b3-form__space">
        <textarea class="b3-text-field fn__block" id="av-event-description" rows="3" placeholder="${window.siyuan.languages.calendarDescription || "Description"}">${escapeHtml(event?.description || "")}</textarea>
    </div>
    <div class="b3-dialog__action">
        <button class="b3-button b3-button--cancel" data-type="event-cancel">${window.siyuan.languages.cancel}</button>
        <span class="fn__space"></span>
        ${isEditing ? `<button class="b3-button b3-button--outline" data-type="event-duplicate">${window.siyuan.languages.duplicate}</button><span class="fn__space"></span><button class="b3-button b3-button--remove" data-type="event-delete">${window.siyuan.languages.delete}</button><span class="fn__space"></span>` : ""}
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
    dialog.element.querySelector('[data-type="event-cancel"]')?.addEventListener("click", () => dialog.destroy());
    dialog.element.querySelector('[data-type="event-save"]')?.addEventListener("click", () => saveEvent(dialog, options));
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
    return {
        title: (dialog.element.querySelector("#av-event-title") as HTMLInputElement).value.trim(),
        date: (dialog.element.querySelector("#av-event-date") as HTMLInputElement).value,
        isAllDay: (dialog.element.querySelector("#av-event-allday") as HTMLInputElement).checked,
        startTime: (dialog.element.querySelector("#av-event-start") as HTMLInputElement).value || "09:00",
        endTime: (dialog.element.querySelector("#av-event-end") as HTMLInputElement).value || "10:00",
        recurrenceRaw: (dialog.element.querySelector("#av-event-recurrence") as HTMLInputElement)?.value,
        location: (dialog.element.querySelector("#av-event-location") as HTMLInputElement)?.value,
        description: (dialog.element.querySelector("#av-event-description") as HTMLTextAreaElement)?.value,
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
