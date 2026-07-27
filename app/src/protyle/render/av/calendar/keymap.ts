import {Dialog} from "../../../../dialog";
import {escapeAttr, escapeHtml} from "../../../../util/escape";

/**
 * The calendar key map.
 *
 * Two halves that must not be confused:
 *   - `resolveCalendarCommand` is PURE. It takes a plain `{key, ctrlKey, ...}`
 *     record (a KeyboardEvent satisfies it structurally) and returns a command
 *     name. No DOM, no window, no side effects - so it is unit-testable from a
 *     bare node script.
 *   - `bindCalendarKeymap` is the only part that touches the DOM. It owns the
 *     focus scope, `preventDefault`, and the dispatch into the renderer's
 *     handlers.
 *
 * Focus scope: the old renderer bailed whenever the keydown target was
 * INPUT|SELECT|TEXTAREA|BUTTON. Every interactive element in the calendar is a
 * button, so the shortcuts died the moment anything was clicked. The real rule
 * is `shouldIgnoreCalendarKey`: bail only while the user is typing into a text
 * field (input / textarea / contenteditable), while a listbox has focus (a
 * <select> uses letter keys to pick options), or while a modal dialog is open.
 * Focus being *inside the calendar* is guaranteed by the listener living on the
 * calendar element itself.
 */

export type CalendarCommand =
    | "view-month"
    | "view-week"
    | "view-day"
    | "view-schedule"
    | "next-range"
    | "prev-range"
    | "today"
    | "create"
    | "search"
    | "help"
    | "next-event"
    | "prev-event"
    | "escape";

/** Structural subset of KeyboardEvent the resolver needs. */
export interface ICalendarKeyEvent {
    key: string;
    ctrlKey?: boolean;
    metaKey?: boolean;
    altKey?: boolean;
    shiftKey?: boolean;
}

export interface ICalendarKeymapOptions {
    /**
     * Google Calendar maps `n` to "next period" and `c` to "create". SiYuan's
     * calendar has always mapped `N` to "new event" and several checks assert
     * that alias, so `n` stays "create" by default and `j` carries "next
     * period". Flip this to get the pure Google mapping.
     */
    nextRangeOnN?: boolean;
}

/** view mode indices as used by render.ts: 0 month, 1 week, 2 day, 3 schedule. */
export const CALENDAR_VIEW_MODE_COMMANDS: CalendarCommand[] = ["view-month", "view-week", "view-day", "view-schedule"];

export const CALENDAR_VIEW_MODE_BY_COMMAND: { [key: string]: number } = {
    "view-month": 0,
    "view-week": 1,
    "view-day": 2,
    "view-schedule": 3,
};

/**
 * Advertised on the calendar region. Keep the legacy prefix intact - it is the
 * string the audit greps for.
 */
export const CALENDAR_ARIA_KEYSHORTCUTS = "ArrowLeft ArrowRight [ ] T N / Escape 1 2 3 4 D W M X A J K P C ?";

export const resolveCalendarCommand = (event: ICalendarKeyEvent, options: ICalendarKeymapOptions = {}): CalendarCommand | undefined => {
    if (!event || typeof event.key !== "string" || !event.key) {
        return undefined;
    }
    // Chords belong to the app, never to the calendar.
    if (event.ctrlKey || event.metaKey || event.altKey) {
        return undefined;
    }
    if (event.key === "ArrowLeft") {
        return "prev-range";
    }
    if (event.key === "ArrowRight") {
        return "next-range";
    }
    if (event.key === "[") {
        return "prev-event";
    }
    if (event.key === "]") {
        return "next-event";
    }
    if (event.key === "/") {
        return "search";
    }
    if (event.key === "?") {
        return "help";
    }
    if (event.key === "Escape") {
        return "escape";
    }
    if (/^[1-4]$/.test(event.key)) {
        return CALENDAR_VIEW_MODE_COMMANDS[parseInt(event.key, 10) - 1];
    }
    if (event.key.toLowerCase() === "t") {
        return "today";
    }
    if (event.key.toLowerCase() === "n") {
        return options.nextRangeOnN ? "next-range" : "create";
    }
    if (event.key.toLowerCase() === "c") {
        return "create";
    }
    if (event.key.toLowerCase() === "d") {
        return "view-day";
    }
    if (event.key.toLowerCase() === "w") {
        return "view-week";
    }
    if (event.key.toLowerCase() === "m") {
        return "view-month";
    }
    if (event.key.toLowerCase() === "x" || event.key.toLowerCase() === "a") {
        return "view-schedule";
    }
    if (event.key.toLowerCase() === "j") {
        return "next-range";
    }
    if (event.key.toLowerCase() === "k" || event.key.toLowerCase() === "p") {
        return "prev-range";
    }
    return undefined;
};

/**
 * True while a keystroke belongs to something other than the calendar.
 * `ownerDocument` is injectable so this can be exercised without a real DOM.
 */
export const shouldIgnoreCalendarKey = (target: EventTarget | null, ownerDocument?: Document): boolean => {
    if (isCalendarModalOpen(ownerDocument)) {
        return true;
    }
    const element = target as HTMLElement;
    if (!element || typeof element.tagName !== "string") {
        return false;
    }
    if (element.isContentEditable) {
        return true;
    }
    // SELECT is here deliberately: a listbox consumes letter keys to jump to an
    // option, so "d" inside the filter dropdown must not switch to Day view.
    return ["INPUT", "SELECT", "TEXTAREA"].includes(element.tagName);
};

const isCalendarModalOpen = (ownerDocument?: Document): boolean => {
    if (typeof window !== "undefined" && window.siyuan?.dialogs?.length > 0) {
        return true;
    }
    const doc = ownerDocument || (typeof document === "undefined" ? undefined : document);
    return !!doc?.querySelector(".b3-dialog--open");
};

export interface ICalendarKeymapHandlers {
    /** 0 month, 1 week, 2 day, 3 schedule. */
    setViewMode: (mode: number) => void;
    /** Page the main view by one visible range. */
    goToRange: (direction: 1 | -1) => void;
    goToToday: () => void;
    /** Must no-op on read-only / query-embed calendars. */
    createEvent: () => void;
    focusSearch: () => void;
    /** Jump to the previous/next event outside the visible range. */
    seekEvent: (direction: 1 | -1) => void;
    /**
     * Back out. Abort an in-flight pointer gesture FIRST, then clear the
     * search/filter. Return true when something was actually backed out so the
     * key is only swallowed when it did something.
     */
    escape: () => boolean;
    /** Defaults to the built-in shortcut sheet. */
    showHelp?: () => void;
}

/**
 * Binds the map to a calendar root. Returns an unbind function; call it from
 * the renderer's teardown so a re-render never stacks listeners.
 */
export const bindCalendarKeymap = (
    element: HTMLElement | null,
    handlers: ICalendarKeymapHandlers,
    options: ICalendarKeymapOptions = {},
): (() => void) => {
    if (!element) {
        return () => undefined;
    }
    const onKeyDown = (event: KeyboardEvent) => {
        if (event.isComposing || shouldIgnoreCalendarKey(event.target, element.ownerDocument)) {
            return;
        }
        const command = resolveCalendarCommand(event, options);
        if (!command) {
            return;
        }
        if (!runCalendarCommand(command, handlers)) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
    };
    element.addEventListener("keydown", onKeyDown);
    return () => element.removeEventListener("keydown", onKeyDown);
};

/** Dispatch one command. Returns false when the command declined to act. */
export const runCalendarCommand = (command: CalendarCommand, handlers: ICalendarKeymapHandlers): boolean => {
    if (command in CALENDAR_VIEW_MODE_BY_COMMAND) {
        handlers.setViewMode(CALENDAR_VIEW_MODE_BY_COMMAND[command]);
        return true;
    }
    if (command === "next-range") {
        handlers.goToRange(1);
        return true;
    }
    if (command === "prev-range") {
        handlers.goToRange(-1);
        return true;
    }
    if (command === "today") {
        handlers.goToToday();
        return true;
    }
    if (command === "create") {
        handlers.createEvent();
        return true;
    }
    if (command === "search") {
        handlers.focusSearch();
        return true;
    }
    if (command === "next-event") {
        handlers.seekEvent(1);
        return true;
    }
    if (command === "prev-event") {
        handlers.seekEvent(-1);
        return true;
    }
    if (command === "help") {
        (handlers.showHelp || openCalendarShortcutHelp)();
        return true;
    }
    // Escape only swallows the key when it really backed something out;
    // otherwise the app's own Escape handling must still run.
    return handlers.escape();
};

// --- the "?" sheet -----------------------------------------------------------

export interface ICalendarShortcutEntry {
    keys: string[];
    command: CalendarCommand;
    /** Resolved at call time so a language switch is picked up. */
    getLabel: () => string;
}

export interface ICalendarShortcutSection {
    getTitle: () => string;
    entries: ICalendarShortcutEntry[];
}

const lang = (key: string, fallback: string) => (typeof window === "undefined" ? fallback : (window.siyuan?.languages?.[key] || fallback));

/**
 * The data behind the "?" sheet. Also the single source of truth for what the
 * map claims to support, so the sheet can never drift from the resolver: every
 * entry below is asserted against `resolveCalendarCommand` by the smoke.
 */
export const getCalendarShortcutSections = (): ICalendarShortcutSection[] => [
    {
        getTitle: () => lang("calendarShortcutsViews", "Views"),
        entries: [
            {keys: ["d", "3"], command: "view-day", getLabel: () => lang("calendarDayView", "Day view")},
            {keys: ["w", "2"], command: "view-week", getLabel: () => lang("calendarWeekView", "Week view")},
            {keys: ["m", "1"], command: "view-month", getLabel: () => lang("calendarMonthView", "Month view")},
            {keys: ["x", "a", "4"], command: "view-schedule", getLabel: () => lang("calendarScheduleView", "Schedule view")},
        ],
    },
    {
        getTitle: () => lang("calendarShortcutsNavigation", "Navigation"),
        entries: [
            {keys: ["j", "→"], command: "next-range", getLabel: () => lang("calendarNextRange", "Next period")},
            {keys: ["k", "p", "←"], command: "prev-range", getLabel: () => lang("calendarPreviousRange", "Previous period")},
            {keys: ["t"], command: "today", getLabel: () => lang("calendarJumpToToday", "Go to today")},
            {keys: ["]"], command: "next-event", getLabel: () => lang("calendarNextEvent", "Next event")},
            {keys: ["["], command: "prev-event", getLabel: () => lang("calendarPreviousEvent", "Previous event")},
        ],
    },
    {
        getTitle: () => lang("calendarShortcutsActions", "Actions"),
        entries: [
            {keys: ["c", "n"], command: "create", getLabel: () => lang("calendarCreateEvent", "Create event")},
            {keys: ["/"], command: "search", getLabel: () => lang("calendarFocusSearch", "Search")},
            {keys: ["?"], command: "help", getLabel: () => lang("calendarShowShortcuts", "Keyboard shortcut help")},
            {keys: ["Esc"], command: "escape", getLabel: () => lang("calendarBackOut", "Cancel the current gesture, then clear the search")},
        ],
    },
];

export const renderCalendarShortcutHelp = (): string => `<div class="b3-dialog__content av__calendar-shortcuts">
    ${getCalendarShortcutSections().map(section => `<div class="av__calendar-shortcuts-section">
        <div class="av__calendar-shortcuts-title">${escapeHtml(section.getTitle())}</div>
        ${section.entries.map(entry => `<div class="av__calendar-shortcuts-row" data-command="${escapeAttr(entry.command)}">
            <span class="av__calendar-shortcuts-keys">${entry.keys.map(key => `<kbd>${escapeHtml(key)}</kbd>`).join("")}</span>
            <span class="av__calendar-shortcuts-label">${escapeHtml(entry.getLabel())}</span>
        </div>`).join("")}
    </div>`).join("")}
</div>`;

export const openCalendarShortcutHelp = (): Dialog => new Dialog({
    title: lang("calendarShortcuts", "Keyboard shortcuts"),
    width: "480px",
    content: renderCalendarShortcutHelp(),
});
