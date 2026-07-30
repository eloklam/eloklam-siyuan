import * as dayjs from "dayjs";
import {App} from "../../index";
import {Model} from "../Model";
import {Tab} from "../Tab";
import {Constants} from "../../constants";
import {fetchSyncPost} from "../../util/fetch";
import {setStorageVal} from "../../protyle/util/compatibility";
import {getCalendarFieldMapping} from "../../protyle/render/av/calendar/mapped-fields";
import {normalizeCalendarEvents} from "../../protyle/render/av/calendar/normalize";
import {ICalendarNormalizedEvent} from "../../protyle/render/av/calendar/model";

interface ICalendarViewRef {
    avID: string;
    blockID: string;
    viewID: string;
    viewName: string;
    databaseName: string;
    hPath: string;
}

interface ICalendarSource {
    ref: ICalendarViewRef;
    data?: IAV;
    error?: string;
}

const STORAGE_KEY = Constants.LOCAL_CALENDAR_DOCK;
const rangeForMonth = (anchor: dayjs.Dayjs) => ({
    start: anchor.startOf("month").startOf("week"),
    end: anchor.endOf("month").endOf("week"),
});

const escape = (value: string) => value.replace(/[&<>"']/g, item => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;"}[item]));

export class Calendar extends Model {
    private element: HTMLElement;
    private selected: string[] = [];
    private sources: ICalendarSource[] = [];
    private anchor = dayjs();
    private loading = false;

    constructor(app: App, tab: Tab) {
        super({app});
        this.element = tab.panelElement;
        this.element.classList.add("fn__flex-column", "file-tree", "sy__calendar", "dockPanel");
        try {
            const stored = window.siyuan.storage?.[STORAGE_KEY];
            this.selected = Array.isArray(stored) ? stored.filter(item => typeof item === "string") : [];
        } catch {
            this.selected = [];
        }
        this.renderShell();
        this.bindShell();
        void this.refresh();
    }

    private renderShell() {
        this.element.innerHTML = `<div class="block__icons">
    <div class="block__logo fn__flex-1">${escape(window.siyuan.languages.calendar || "Calendar")}</div>
    <span data-type="refresh" class="block__icon ariaLabel" aria-label="${escape(window.siyuan.languages.refresh)}"><svg><use xlink:href="#iconRefresh"></use></svg></span>
    <span data-type="prev" class="block__icon ariaLabel" aria-label="${escape(window.siyuan.languages.previousMonth || "Previous month")}"><svg><use xlink:href="#iconLeft"></use></svg></span>
    <span data-type="next" class="block__icon ariaLabel" aria-label="${escape(window.siyuan.languages.nextMonth || "Next month")}"><svg><use xlink:href="#iconRight"></use></svg></span>
    <span data-type="min" class="block__icon ariaLabel" aria-label="${escape(window.siyuan.languages.min)}"><svg><use xlink:href="#iconMin"></use></svg></span>
</div>
<div class="av__calendar-dock-content fn__flex-1"></div>`;
    }

    private bindShell() {
        this.element.addEventListener("click", event => {
            const target = (event.target as HTMLElement).closest("[data-type]") as HTMLElement;
            if (!target) return;
            switch (target.dataset.type) {
                case "refresh": void this.refresh(); break;
                case "prev": this.anchor = this.anchor.subtract(1, "month"); void this.renderEvents(); break;
                case "next": this.anchor = this.anchor.add(1, "month"); void this.renderEvents(); break;
                case "min": window.siyuan.layout.leftDock?.toggleModel("calendar", false, true); break;
                case "toggle-databases":
                    this.element.querySelector('[data-type="database-options"]')?.classList.toggle("fn__none");
                    break;
                case "select-source": {
                    const id = (target as HTMLInputElement).value || target.dataset.id;
                    if (!id) return;
                    this.selected = (target as HTMLInputElement).checked ? [...new Set([...this.selected, id])] : this.selected.filter(item => item !== id);
                    setStorageVal(STORAGE_KEY, this.selected);
                    void this.renderEvents();
                    break;
                }
            }
        });
    }

    private async discover(): Promise<ICalendarViewRef[]> {
        const response = await fetchSyncPost("/api/av/searchAttributeView", {keyword: "", avID: "", blockID: "", excludes: []});
        const results = response?.data?.results || [];
        const refs = new Map<string, ICalendarViewRef>();
        results.forEach((item: any) => {
            const calendarView = (item.children || []).find((child: any) => child.viewLayout === "calendar" && child.viewID);
            if (!calendarView || refs.has(calendarView.avID)) return;
            const hPath = calendarView.hPath || item.hPath || "";
            const databaseName = item.avName || calendarView.avName || hPath.split("/").filter(Boolean).at(-1) || calendarView.avID;
            refs.set(calendarView.avID, {avID: calendarView.avID, blockID: calendarView.blockID, viewID: calendarView.viewID, viewName: calendarView.viewName || "Calendar", databaseName, hPath});
        });
        return [...refs.values()];
    }

    private async loadSource(ref: ICalendarViewRef): Promise<ICalendarSource> {
        const response = await fetchSyncPost("/api/av/renderAttributeView", {id: ref.avID, blockID: ref.blockID, viewID: ref.viewID, pageSize: -1, createIfNotExist: false});
        if (response?.code !== 0 || !response?.data) return {ref, error: response?.msg || "Unable to load calendar"};
        return {ref, data: response.data};
    }

    private async refresh() {
        if (this.loading) return;
        this.loading = true;
        try {
            const refs = await this.discover();
            const known = new Set(refs.map(item => item.avID));
            this.selected = this.selected.filter(item => known.has(item));
            this.sources = await Promise.all(refs.filter(item => this.selected.includes(item.avID)).map(item => this.loadSource(item)));
            await this.renderEvents(refs);
        } finally {
            this.loading = false;
        }
    }

    private async renderEvents(refs?: ICalendarViewRef[]) {
        const available = refs || await this.discover();
        if (!this.sources.length && this.selected.length) {
            this.sources = await Promise.all(available.filter(item => this.selected.includes(item.avID)).map(item => this.loadSource(item)));
        }
        const content = this.element.querySelector(".av__calendar-dock-content") as HTMLElement;
        if (!content) return;
        const options = available.map(ref => `<label class="b3-list-item b3-list-item--narrow"><input type="checkbox" data-type="select-source" value="${escape(ref.avID)}"${this.selected.includes(ref.avID) ? " checked" : ""}><span class="b3-list-item__text" title="${escape(ref.hPath)}"><strong>${escape(ref.databaseName)}</strong><small>${escape(ref.hPath)}</small></span></label>`).join("");
        const selectedNames = available.filter(ref => this.selected.includes(ref.avID)).map(ref => ref.databaseName);
        const range = rangeForMonth(this.anchor);
        const events: Array<{event: ICalendarNormalizedEvent, source: ICalendarSource}> = [];
        this.sources.forEach(source => {
            if (!source.data || source.data.viewType !== "calendar") return;
            const calendar = source.data.view as IAVCalendar;
            normalizeCalendarEvents(calendar, getCalendarFieldMapping(calendar), range).events.forEach(event => events.push({event, source}));
        });
        events.sort((a, b) => a.event.start.valueOf() - b.event.start.valueOf());
        // Every interpolated value is escaped above. This panel deliberately uses
        // the same small static markup pattern as the built-in dock models.
        content.innerHTML = `<div class="av__calendar-dock-database-picker"><button class="b3-button b3-button--outline fn__block" data-type="toggle-databases" title="${escape(selectedNames.join(", "))}">${escape(selectedNames.length ? selectedNames.join(", ") : (window.siyuan.languages.database || "Database"))}<svg><use xlink:href="#iconDown"></use></svg></button><div class="av__calendar-dock-sources fn__none" data-type="database-options">${options || `<div class="ft__on-surface">${escape(window.siyuan.languages.calendarNoSources || "No calendar databases found")}</div>`}</div></div><div class="av__calendar-dock-month"><div class="block__icons"><div class="block__logo fn__flex-1">${escape(this.anchor.format("MMMM YYYY"))}</div></div>${events.length ? events.map(item => `<div class="b3-list-item b3-list-item--narrow"><span class="b3-list-item__graphic" style="color:${escape(item.event.color || "var(--b3-theme-primary)")}">●</span><span class="b3-list-item__text"><strong>${escape(item.event.start.format("DD.MM HH:mm"))}</strong> ${escape(item.event.title)}<small>${escape(item.source.ref.databaseName)}</small></span></div>`).join("") : `<div class="ft__on-surface">${escape(window.siyuan.languages.calendarNoEvents || "No events this month")}</div>`}</div>`;
    }
}

export const CALENDAR_DOCK_TYPE = "calendar";
