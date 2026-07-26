import {transaction} from "../../wysiwyg/transaction";
import {Constants} from "../../../constants";
import {showMessage} from "../../../dialog/message";
import {escapeAttr, escapeHtml} from "../../../util/escape";
import {fetchSyncPost} from "../../../util/fetch";
import {setPosition} from "../../../util/setPosition";
import {getCardAspectRatio} from "./gallery/util";
import {getFieldsByData} from "./view";

const getCalendarLocale = () => window.siyuan.config.lang;

const getWeekdayLabel = (day: 0 | 1) => {
    return new Intl.DateTimeFormat(getCalendarLocale(), {weekday: "long"}).format(new Date(2020, 5, 7 + day));
};

const validateCalendarMetadataMapping = (mapping: Partial<NonNullable<IAVCalendar["fieldMapping"]>>, changedField?: string) => {
    const names = ["recurrenceFieldID", "exceptionFieldID", "locationFieldID", "descriptionFieldID"];
    const used = new Set<string>();
    for (const name of names) {
        const fieldID = mapping?.[name as keyof NonNullable<IAVCalendar["fieldMapping"]>];
        if (!fieldID) {
            continue;
        }
        if (used.has(fieldID)) {
            showMessage((window.siyuan.languages.calendarDuplicateMetadataField || "Please choose different fields for ${x} metadata.").replace("${x}", changedField || ""));
            return false;
        }
        used.add(fieldID);
    }
    return true;
};

export const getLayoutHTML = (data: IAV) => {
    let html = "";
    const view = data.view as IAVKanban;
    if (["gallery", "kanban"].includes(data.viewType)) {
        let coverFromTitle = "";
        if (view.coverFrom === 0) {
            coverFromTitle = window.siyuan.languages.calcOperatorNone;
        } else if (view.coverFrom === 1) {
            coverFromTitle = window.siyuan.languages.contentImage;
        } else if (view.coverFrom === 3) {
            coverFromTitle = window.siyuan.languages.contentBlock;
        } else {
            view.fields.find(item => {
                if (item.type === "mAsset" && item.id === view.coverFromAssetKeyID) {
                    coverFromTitle = item.name;
                    return true;
                }
            });
        }
        html = `<button class="b3-menu__item" data-type="set-gallery-cover">
    <span class="fn__flex-center">${window.siyuan.languages.cardPreview1}</span>
    <span class="fn__flex-1"></span>
    <span class="b3-menu__accelerator">${coverFromTitle}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item" data-type="set-gallery-ratio">
    <span class="fn__flex-center">${window.siyuan.languages.cardAspectRatio}</span>
    <span class="fn__flex-1"></span>
    <span class="b3-menu__accelerator">${getCardAspectRatio(view.cardAspectRatio)}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<button class="b3-menu__item" data-type="set-gallery-size">
    <span class="fn__flex-center">${window.siyuan.languages.cardSize}</span>
    <span class="fn__flex-1"></span>
    <span class="b3-menu__accelerator">${view.cardSize === 0 ? window.siyuan.languages.small : (view.cardSize === 1 ? window.siyuan.languages.medium : window.siyuan.languages.large)}</span>
    <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
</button>
<label class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.fitImage}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-type="toggle-gallery-fit" type="checkbox" class="b3-switch b3-switch--menu" ${view.fitImage ? "checked" : ""}>
</label>
<label class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.displayFieldName}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-type="toggle-gallery-name" type="checkbox" class="b3-switch b3-switch--menu" ${view.displayFieldName ? "checked" : ""}>
</label>`;
    }
    html = `<div class="b3-menu__items">
    <button class="b3-menu__item" data-type="nobg">
        <span class="block__icon" style="padding: 8px;margin-left: -4px;" data-type="go-config">
            <svg><use xlink:href="#iconLeft"></use></svg>
        </span>
        <span class="b3-menu__label ft__center">${window.siyuan.languages.layout}</span>
    </button>
    <button class="b3-menu__separator"></button>
    <button class="b3-menu__item" data-type="nobg">
        <div class="av__layout">
            <div data-type="set-layout" data-view-type="table" class="av__layout-item${data.viewType === "table" ? " av__layout-item--select" : ""}">
                <svg><use xlink:href="#iconTable"></use></svg>
                <div class="fn__hr"></div>
                <div>${window.siyuan.languages.table}</div>
            </div>
            <div data-type="set-layout" data-view-type="kanban" class="av__layout-item${data.viewType === "kanban" ? " av__layout-item--select" : ""}">
                <svg><use xlink:href="#iconBoard"></use></svg>
                <div class="fn__hr"></div>
                <div>${window.siyuan.languages.kanban}</div>
            </div>
            <div data-type="set-layout" data-view-type="gallery" class="av__layout-item${data.viewType === "gallery" ? " av__layout-item--select" : ""}">
                <svg><use xlink:href="#iconGallery"></use></svg>
                <div class="fn__hr"></div>
                <div>${window.siyuan.languages.gallery}</div>
            </div>
            <div data-type="set-layout" data-view-type="calendar" class="av__layout-item${data.viewType === "calendar" ? " av__layout-item--select" : ""}">
                <svg><use xlink:href="#iconCalendar"></use></svg>
                <div class="fn__hr"></div>
                <div>${window.siyuan.languages.calendar || "Calendar"}</div>
            </div>
        </div>
    </button>
    <label class="b3-menu__item">
        <span class="fn__flex-center">${window.siyuan.languages.showTitle}</span>
        <span class="fn__space fn__flex-1"></span>
        <input data-type="toggle-view-title" type="checkbox" class="b3-switch b3-switch--menu" ${view.hideAttrViewName ? "" : "checked"}>
    </label>
    ${html}
    <label class="b3-menu__item">
        <span class="fn__flex-center">${window.siyuan.languages.showAllEntriesIcons}</span>
        <span class="fn__space fn__flex-1"></span>
        <input data-type="toggle-entries-icons" type="checkbox" class="b3-switch b3-switch--menu" ${view.showIcon ? "checked" : ""}>
    </label>
    <label class="b3-menu__item">
        <span class="fn__flex-center">${window.siyuan.languages.wrapAllFields}</span>
        <span class="fn__space fn__flex-1"></span>
        <input data-type="toggle-entries-wrap" type="checkbox" class="b3-switch b3-switch--menu" ${view.wrapField ? "checked" : ""}>
    </label>`;
    if (data.viewType === "kanban" && ["select", "mSelect"].includes(data.view.groups?.[0]?.groupValue?.type)) {
        html += `<label class="b3-menu__item">
    <span class="fn__flex-center">${window.siyuan.languages.useBackground}</span>
    <span class="fn__space fn__flex-1"></span>
    <input data-type="toggle-kanban-bg" type="checkbox" class="b3-switch b3-switch--menu" ${view.fillColBackgroundColor ? "checked" : ""}>
</label>`;
    }
    if (data.viewType === "calendar") {
        const calendarView = data.view as IAVCalendar;
        const fields = getFieldsByData(data);
        const mapping = calendarView.fieldMapping || {};
        const buildOptions = (fieldTypes: TAVCol[], selected = "", allowEmpty = true) => {
            let options = allowEmpty ? `<option value="">${escapeHtml(window.siyuan.languages.calcOperatorNone)}</option>` : "";
            const matched = fields.filter(field => fieldTypes.includes(field.type));
            if (selected && !matched.some(field => field.id === selected)) {
                // The persisted mapping points at a deleted or retyped field:
                // show that honestly instead of implying "None", so the user can
                // pick a valid field (or None) to repair it.
                options += `<option value="${escapeAttr(selected)}" selected disabled>${escapeHtml(window.siyuan.languages.calendarStaleMapping || "Missing or invalid field")}</option>`;
            }
            matched.forEach(field => {
                options += `<option value="${escapeAttr(field.id)}"${field.id === selected ? " selected" : ""}>${escapeHtml(field.name)}</option>`;
            });
            return options;
        };
        html += `<div class="b3-menu__item" data-type="nobg">
    <div class="fn__block">
        <label class="ft__on-surface">${window.siyuan.languages.dateField || "Date Field"}</label>
        <select class="b3-select fn__block" data-type="calendar-date-field">
            ${buildOptions(["date"], calendarView.dateFieldID)}
        </select>
        <div class="fn__hr"></div>
        <label class="ft__on-surface">${window.siyuan.languages.calendarWeekStart || "Week starts on"}</label>
        <select class="b3-select fn__block" data-type="calendar-week-start">
            <option value="0"${(calendarView.weekStart || 0) === 0 ? " selected" : ""}>${escapeHtml(getWeekdayLabel(0))}</option>
            <option value="1"${calendarView.weekStart === 1 ? " selected" : ""}>${escapeHtml(getWeekdayLabel(1))}</option>
        </select>
        <div class="fn__hr"></div>
        <label class="ft__on-surface">${window.siyuan.languages.calendarRecurrence || "Recurrence"}</label>
        <select class="b3-select fn__block" data-type="calendar-map-field" data-field="recurrenceFieldID">
            ${buildOptions(["text", "template"], mapping.recurrenceFieldID)}
        </select>
        <div class="fn__hr"></div>
        <label class="ft__on-surface">${window.siyuan.languages.calendarExceptions || "Exceptions"}</label>
        <select class="b3-select fn__block" data-type="calendar-map-field" data-field="exceptionFieldID">
            ${buildOptions(["text", "template"], mapping.exceptionFieldID)}
        </select>
        <div class="fn__hr"></div>
        <label class="ft__on-surface">${window.siyuan.languages.calendarLocation || "Location"}</label>
        <select class="b3-select fn__block" data-type="calendar-map-field" data-field="locationFieldID">
            ${buildOptions(["text", "template"], mapping.locationFieldID)}
        </select>
        <div class="fn__hr"></div>
        <label class="ft__on-surface">${window.siyuan.languages.calendarDescription || "Description"}</label>
        <select class="b3-select fn__block" data-type="calendar-map-field" data-field="descriptionFieldID">
            ${buildOptions(["text", "template"], mapping.descriptionFieldID)}
        </select>
        <div class="fn__hr"></div>
        <label class="ft__on-surface">${window.siyuan.languages.color || "Color"}</label>
        <select class="b3-select fn__block" data-type="calendar-map-field" data-field="colorFieldID">
            ${buildOptions(["select", "mSelect"], mapping.colorFieldID)}
        </select>
    </div>
</div>`;
    }
    return html + `<button class="b3-menu__item" data-type="set-page-size" data-size="${view.pageSize}">
        <span class="fn__flex-center">${window.siyuan.languages.entryNum}</span>
        <span class="fn__flex-1"></span>
        <span class="b3-menu__accelerator">${view.pageSize === Constants.SIZE_DATABASE_MAZ_SIZE ? window.siyuan.languages.all : view.pageSize}</span>
        <svg class="b3-menu__icon b3-menu__icon--small"><use xlink:href="#iconRight"></use></svg>
    </button>
</div>`;
};

export const bindLayoutEvent = (options: {
    protyle: IProtyle,
    data: IAV,
    menuElement: HTMLElement
    blockElement: Element
}) => {
    const avID = options.blockElement.getAttribute("data-av-id");
    const blockID = options.blockElement.getAttribute("data-node-id");
    const viewID = options.blockElement.getAttribute(Constants.CUSTOM_SY_AV_VIEW);
    const toggleTitleElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-view-title"]') as HTMLInputElement;
    toggleTitleElement.addEventListener("change", () => {
        const checked = toggleTitleElement.checked;
        transaction(options.protyle, [{
            action: "hideAttrViewName",
            avID,
            blockID,
            data: !checked,
            viewID
        }], [{
            action: "hideAttrViewName",
            avID,
            blockID,
            data: checked,
            viewID
        }]);
        options.data.view.hideAttrViewName = !checked;
    });
    const toggleIconElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-entries-icons"]') as HTMLInputElement;
    toggleIconElement.addEventListener("change", () => {
        const checked = toggleIconElement.checked;
        transaction(options.protyle, [{
            action: "setAttrViewShowIcon",
            avID,
            blockID,
            data: checked,
            viewID
        }], [{
            action: "setAttrViewShowIcon",
            avID,
            blockID,
            data: !checked,
            viewID
        }]);
        options.data.view.showIcon = checked;
    });
    const toggleWrapElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-entries-wrap"]') as HTMLInputElement;
    toggleWrapElement.addEventListener("change", () => {
        const checked = toggleWrapElement.checked;
        transaction(options.protyle, [{
            action: "setAttrViewWrapField",
            avID,
            blockID,
            data: checked,
            viewID
        }], [{
            action: "setAttrViewWrapField",
            avID,
            blockID,
            data: !checked,
            viewID
        }]);
        getFieldsByData(options.data).forEach(item => {
            item.wrap = checked;
        });
        options.data.view.wrapField = checked;
    });
    if (options.data.viewType === "table") {
        return options.data;
    }
    const toggleFitElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-gallery-fit"]') as HTMLInputElement;
    toggleFitElement?.addEventListener("change", () => {
        const checked = toggleFitElement.checked;
        transaction(options.protyle, [{
            action: "setAttrViewFitImage",
            avID,
            blockID,
            data: checked,
            viewID
        }], [{
            action: "setAttrViewFitImage",
            avID,
            blockID,
            data: !checked,
            viewID
        }]);
        (options.data.view as IAVGallery).fitImage = checked;
    });
    const toggleNameElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-gallery-name"]') as HTMLInputElement;
    toggleNameElement?.addEventListener("change", () => {
        const checked = toggleNameElement.checked;
        transaction(options.protyle, [{
            action: "setAttrViewDisplayFieldName",
            avID,
            blockID,
            data: checked
        }], [{
            action: "setAttrViewDisplayFieldName",
            avID,
            blockID,
            data: !checked
        }]);
        (options.data.view as IAVGallery).displayFieldName = checked;
    });
    if (options.data.viewType === "calendar") {
        bindCalendarLayoutEvent(options, avID, blockID, viewID);
        return options.data;
    }
    if (options.data.viewType === "gallery") {
        return options.data;
    }
    const toggleBgElement = options.menuElement.querySelector('.b3-switch[data-type="toggle-kanban-bg"]') as HTMLInputElement;
    toggleBgElement?.addEventListener("change", () => {
        const checked = toggleBgElement.checked;
        transaction(options.protyle, [{
            action: "setAttrViewFillColBackgroundColor",
            avID,
            blockID,
            data: checked,
            viewID
        }], [{
            action: "setAttrViewFillColBackgroundColor",
            avID,
            blockID,
            data: !checked,
            viewID
        }]);
        (options.data.view as IAVKanban).fillColBackgroundColor = checked;
    });
};

const bindCalendarLayoutEvent = (options: {
    protyle: IProtyle,
    data: IAV,
    menuElement: HTMLElement
    blockElement: Element
}, avID: string, blockID: string, viewID: string) => {
    const calendarView = options.data.view as IAVCalendar;
    const dateFieldElement = options.menuElement.querySelector('select[data-type="calendar-date-field"]') as HTMLSelectElement;
    dateFieldElement?.addEventListener("change", () => {
        const previous = calendarView.dateFieldID || "";
        const current = dateFieldElement.value;
        transaction(options.protyle, [{
            action: "setAttrViewCalendarDateField",
            avID,
            blockID,
            keyID: current,
            data: current,
            viewID
        }], [{
            action: "setAttrViewCalendarDateField",
            avID,
            blockID,
            keyID: previous,
            data: previous,
            viewID
        }]);
        calendarView.dateFieldID = current;
    });
    const weekStartElement = options.menuElement.querySelector('select[data-type="calendar-week-start"]') as HTMLSelectElement;
    weekStartElement?.addEventListener("change", () => {
        const previous = calendarView.weekStart || 0;
        const current = parseInt(weekStartElement.value, 10);
        transaction(options.protyle, [{
            action: "setAttrViewCalendarWeekStart",
            avID,
            blockID,
            data: current,
            viewID
        }], [{
            action: "setAttrViewCalendarWeekStart",
            avID,
            blockID,
            data: previous,
            viewID
        }]);
        calendarView.weekStart = current;
    });
    options.menuElement.querySelectorAll('select[data-type="calendar-map-field"]').forEach((item: HTMLSelectElement) => {
        item.addEventListener("change", () => {
            const previous = {...(calendarView.fieldMapping || {})};
            const next = {...previous, [item.dataset.field]: item.value};
            if (!validateCalendarMetadataMapping(next, item.dataset.field)) {
                item.value = previous[item.dataset.field as keyof NonNullable<IAVCalendar["fieldMapping"]>] || "";
                return;
            }
            transaction(options.protyle, [{
                action: "setAttrViewCalendarFieldMapping",
                avID,
                blockID,
                data: {[item.dataset.field]: item.value},
                viewID
            }], [{
                action: "setAttrViewCalendarFieldMapping",
                avID,
                blockID,
                data: {[item.dataset.field]: previous[item.dataset.field as keyof NonNullable<IAVCalendar["fieldMapping"]>] || ""},
                viewID
            }]);
            calendarView.fieldMapping = next;
        });
    });
};

export const updateLayout = async (options: {
    data: IAV
    nodeElement: Element,
    protyle: IProtyle,
    target: HTMLElement
}) => {
    if (options.target.classList.contains("av__layout-item--select") || options.target.dataset.load === "true") {
        return;
    }
    options.target.dataset.load = "true";
    options.target.parentElement.querySelector(".av__layout-item--select").classList.remove("av__layout-item--select");
    options.target.classList.add("av__layout-item--select");
    const response = await fetchSyncPost("/api/av/changeAttrViewLayout", {
        blockID: options.nodeElement.getAttribute("data-node-id"),
        avID: options.nodeElement.getAttribute("data-av-id"),
        layoutType: options.target.getAttribute("data-view-type")
    });
    const menuElement = document.querySelector(".av__panel").lastElementChild as HTMLElement;
    menuElement.innerHTML = getLayoutHTML(response.data);
    // 切换布局类型后菜单高度变化（如表格→看板），需重新定位避免底部溢出视窗
    const tabRect = options.nodeElement.querySelector(".av__views").getBoundingClientRect();
    setPosition(menuElement, tabRect.right - menuElement.clientWidth, tabRect.bottom, tabRect.height, 0, true);
    bindLayoutEvent({
        protyle: options.protyle,
        data: response.data,
        menuElement,
        blockElement: options.nodeElement
    });
    options.target.removeAttribute("data-load");
    return response.data;
};
