#!/usr/bin/env node
import {spawn, spawnSync} from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const appDir = path.join(root, "app");
const kernelDir = path.join(root, "kernel");
const requireFromApp = createRequire(path.join(appDir, "package.json"));
const ts = requireFromApp("typescript");
const appKernelDir = path.join(appDir, "kernel");
const appKernelBinary = path.join(appKernelDir, process.platform === "win32" ? "SiYuan-Kernel.exe" : "SiYuan-Kernel");
const electronBinary = path.join(appDir, "node_modules/.bin/electron");
const desktopBuildDir = path.join(appDir, "stage/build/desktop");
const appBuildDir = path.join(appDir, "stage/build/app");
const kernelPort = 6806;

const fail = (message) => {
  throw new Error(message);
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const nodeID = () => {
  const now = new Date();
  const pad = (value, size = 2) => String(value).padStart(size, "0");
  const stamp = [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
  const random = Math.random().toString(36).slice(2, 9).padEnd(7, "0");
  return `${stamp}-${random}`;
};

const isPortFree = (port) => new Promise((resolve) => {
  const server = net.createServer();
  server.once("error", () => resolve(false));
  server.listen(port, "127.0.0.1", () => {
    server.close(() => resolve(true));
  });
});

const getFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close(() => resolve(address.port));
  });
});

const postJSON = async (baseURL, endpoint, body = {}) => {
  const response = await fetch(`${baseURL}${endpoint}`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    fail(`${endpoint} returned HTTP ${response.status}`);
  }
  const data = await response.json();
  if (data.code !== 0) {
    fail(`${endpoint} failed: ${data.msg || JSON.stringify(data)}`);
  }
  return data.data;
};

const getJSON = (url) => new Promise((resolve, reject) => {
  const request = http.get(url, (response) => {
    let body = "";
    response.setEncoding("utf8");
    response.on("data", (chunk) => {
      body += chunk;
    });
    response.on("end", () => {
      if (response.statusCode !== 200) {
        reject(new Error(`${url} returned HTTP ${response.statusCode}`));
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(error);
      }
    });
  });
  request.on("error", reject);
  request.setTimeout(1000, () => {
    request.destroy(new Error(`${url} timed out`));
  });
});

const waitForKernelBoot = async (baseURL) => {
  let lastError = "";
  for (let i = 0; i < 120; i++) {
    try {
      const version = await postJSON(baseURL, "/api/system/version");
      const progress = await postJSON(baseURL, "/api/system/bootProgress");
      if (version === "3.6.5" && progress?.progress >= 100) {
        return;
      }
      lastError = `version=${version} progress=${progress?.progress}`;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(500);
  }
  fail(`kernel did not finish booting: ${lastError}`);
};

const waitForElectronDebug = async (debugPort) => {
  let lastError = "";
  for (let i = 0; i < 80; i++) {
    try {
      const version = await getJSON(`http://127.0.0.1:${debugPort}/json/version`);
      const targets = await getJSON(`http://127.0.0.1:${debugPort}/json/list`);
      const urls = targets.map((target) => target.url || "");
      const hasSiYuanTarget = urls.some((url) =>
        url.includes("/stage/build/") || url.includes("/appearance/boot/") || url.endsWith("/check-auth"));
      if (version.Browser && hasSiYuanTarget) {
        return {browser: version.Browser, urls};
      }
      lastError = `targets=${urls.join(",")}`;
    } catch (error) {
      lastError = error.message;
    }
    await sleep(500);
  }
  fail(`electron remote debugging endpoint did not expose a SiYuan target: ${lastError}`);
};

const createCDPClient = (webSocketURL) => new Promise((resolve, reject) => {
  const socket = new WebSocket(webSocketURL);
  let id = 0;
  const pending = new Map();
  socket.addEventListener("open", () => {
    resolve({
      send(method, params = {}) {
        const requestID = ++id;
        socket.send(JSON.stringify({id: requestID, method, params}));
        return new Promise((requestResolve, requestReject) => {
          pending.set(requestID, {resolve: requestResolve, reject: requestReject});
        });
      },
      close() {
        socket.close();
      },
    });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data.toString());
    if (!message.id || !pending.has(message.id)) {
      return;
    }
    const request = pending.get(message.id);
    pending.delete(message.id);
    if (message.error) {
      request.reject(new Error(message.error.message || JSON.stringify(message.error)));
    } else {
      request.resolve(message.result);
    }
  });
  socket.addEventListener("error", () => reject(new Error(`failed to connect to ${webSocketURL}`)));
});

const evaluateInTarget = async (debugPort, expression) => {
  const targets = await getJSON(`http://127.0.0.1:${debugPort}/json/list`);
  const target = targets.find((item) => (item.url || "").includes("/stage/build/")) ||
    targets.find((item) => (item.url || "").endsWith("/check-auth")) ||
    targets.find((item) => (item.url || "").includes("/appearance/boot/"));
  if (!target?.webSocketDebuggerUrl) {
    fail(`no debuggable SiYuan target found: ${targets.map((item) => item.url).join(",")}`);
  }
  const client = await createCDPClient(target.webSocketDebuggerUrl);
  try {
    await client.send("Runtime.enable");
    const result = await client.send("Runtime.evaluate", {
      expression,
      awaitPromise: true,
      returnByValue: true,
      timeout: 5000,
    });
    if (result.exceptionDetails) {
      fail(`electron target evaluation failed: ${result.exceptionDetails.text}`);
    }
    return result.result?.value;
  } finally {
    client.close();
  }
};

const waitForAppShell = async (debugPort) => {
  let lastState;
  for (let i = 0; i < 80; i++) {
    lastState = await evaluateInTarget(debugPort, `(() => ({
      href: location.href,
      title: document.title,
      hasSiyuan: !!window.siyuan,
      siyuanKeys: window.siyuan ? Object.keys(window.siyuan).slice(0, 30) : [],
      hasOpenFileByURL: typeof window.openFileByURL === 'function',
      bodyClasses: document.body.className,
      hasLayout: !!document.querySelector('.layout, .layout__center, .fn__flex-column'),
      hasCalendar: !!document.querySelector('.av__calendar')
    }))()`);
    if (lastState?.hasSiyuan && lastState.hasLayout && lastState.hasOpenFileByURL) {
      return lastState;
    }
    await sleep(500);
  }
  fail(`electron target did not expose the SiYuan app shell: ${JSON.stringify(lastState)}`);
};

const writeFile = (file, content) => {
  fs.mkdirSync(path.dirname(file), {recursive: true});
  fs.writeFileSync(file, content);
};

const compileCalendarRenderHarness = () => {
  const tempDir = fs.mkdtempSync(path.join(appDir, ".calendar-electron-render-"));
  const calendarSourceDir = path.join(appDir, "src/protyle/render/av/calendar");
  const calendarTargetDir = path.join(tempDir, "src/protyle/render/av/calendar");
  const compileCalendarFile = (file) => {
    const source = fs.readFileSync(path.join(calendarSourceDir, file), "utf8");
    const result = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: false,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: file,
    });
    writeFile(path.join(calendarTargetDir, file.replace(/\.ts$/, ".js")), result.outputText);
  };
  for (const file of ["model.ts", "mapped-fields.ts", "recurrence.ts", "normalize.ts", "render.ts"]) {
    compileCalendarFile(file);
  }
  writeFile(path.join(tempDir, "src/constants.js"), `
exports.Constants = {
  CUSTOM_SY_AV_VIEW: 'custom-sy-av-view',
  CB_GET_AV_NO_CREATE: 'cb-get-av-no-create',
};
`);
  writeFile(path.join(tempDir, "src/dialog/message.js"), "exports.showMessage = () => undefined;\n");
  writeFile(path.join(tempDir, "src/util/escape.js"), `
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (item) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[item]));
exports.escapeHtml = escapeHtml;
exports.escapeAttr = escapeHtml;
`);
  writeFile(path.join(tempDir, "src/util/fetch.js"), "exports.fetchSyncPost = async () => globalThis.__calendarRenderFetchResponse || {data: {}};\n");
  writeFile(path.join(tempDir, "src/protyle/util/hasClosest.js"), `
exports.hasClosestByAttribute = (element, attr, value) => {
  let current = element;
  while (current) {
    if (current.getAttribute && current.getAttribute(attr) === value) return current;
    current = current.parentElement;
  }
  return undefined;
};
`);
  writeFile(path.join(tempDir, "src/protyle/wysiwyg/transaction.js"), "exports.transaction = () => undefined;\n");
  writeFile(path.join(tempDir, "src/protyle/render/av/render.js"), "exports.genTabHeaderHTML = () => '<div class=\"av__header\"></div>';\n");
  writeFile(path.join(tempDir, "src/protyle/render/av/calendar/event-dialog.js"), "exports.openEventDialog = () => undefined;\n");
  writeFile(path.join(tempDir, "src/protyle/render/av/calendar/transactions.js"), `
exports.createCalendarEvent = () => true;
exports.createCalendarEventReplacingOccurrence = () => true;
exports.updateCalendarEvent = () => true;
`);
  return {tempDir, renderModule: path.join(calendarTargetDir, "render.js")};
};

const compileCalendarDialogHarness = () => {
  const tempDir = fs.mkdtempSync(path.join(appDir, ".calendar-electron-dialog-"));
  const calendarSourceDir = path.join(appDir, "src/protyle/render/av/calendar");
  const calendarTargetDir = path.join(tempDir, "src/protyle/render/av/calendar");
  const compileCalendarFile = (file) => {
    const source = fs.readFileSync(path.join(calendarSourceDir, file), "utf8");
    const result = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: false,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: file,
    });
    writeFile(path.join(calendarTargetDir, file.replace(/\.ts$/, ".js")), result.outputText);
  };
  for (const file of ["model.ts", "mapped-fields.ts", "event-dialog.ts"]) {
    compileCalendarFile(file);
  }
  writeFile(path.join(tempDir, "src/dialog/index.js"), `
class Dialog {
  constructor(options) {
    this.destroyed = false;
    this.element = document.createElement('div');
    this.element.className = 'calendar-dialog-smoke';
    this.element.innerHTML = '<div class="b3-dialog"><div class="b3-dialog__body">' + options.content + '</div></div>';
    document.body.appendChild(this.element);
    (globalThis.__calendarDialogInstances ||= []).push(this);
  }
  destroy() {
    this.destroyed = true;
    this.element.remove();
  }
}
exports.Dialog = Dialog;
`);
  writeFile(path.join(tempDir, "src/constants.js"), "exports.Constants = {CB_GET_FOCUS: 'cb-get-focus'};\n");
  writeFile(path.join(tempDir, "src/dialog/message.js"), "exports.showMessage = (message) => (globalThis.__calendarDialogMessages ||= []).push(message);\n");
  writeFile(path.join(tempDir, "src/editor/util.js"), "exports.openFileById = (options) => (globalThis.__calendarDialogOpenBlocks ||= []).push({options, blockID: options && options.id});\n");
  writeFile(path.join(tempDir, "src/mobile/editor.js"), "exports.openMobileFileById = (app, blockID) => (globalThis.__calendarDialogOpenBlocks ||= []).push({app, blockID, mobile: true});\n");
  writeFile(path.join(tempDir, "src/util/escape.js"), `
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (item) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[item]));
exports.escapeHtml = escapeHtml;
exports.escapeAttr = escapeHtml;
`);
  writeFile(path.join(tempDir, "src/protyle/render/av/calendar/transactions.js"), `
const record = (type, payload) => {
  (globalThis.__calendarDialogTxCalls ||= []).push({type, payload});
  return true;
};
exports.createCalendarEvent = (payload) => record('create', payload);
exports.createCalendarEventReplacingOccurrence = (payload) => record('replace-occurrence', payload);
exports.updateCalendarEvent = (payload) => record('update', payload);
exports.updateCalendarEventThisAndFuture = (payload) => record('future', payload);
exports.deleteCalendarEvent = (payload) => record('delete', payload);
exports.deleteCalendarOccurrence = (payload) => record('delete-occurrence', payload);
`);
  return {tempDir, dialogModule: path.join(calendarTargetDir, "event-dialog.js")};
};

const runCalendarDialogSmoke = async (debugPort, dialogModule) => {
  const fixture = {
    avID: nodeID(),
    blockID: nodeID(),
    viewID: nodeID(),
  };
  const result = await evaluateInTarget(debugPort, `(async () => {
    globalThis.dayjs = require('dayjs');
    const dialogModule = require(${JSON.stringify(dialogModule)});
    window.siyuan = window.siyuan || {};
    window.siyuan.config = Object.assign({}, window.siyuan.config || {}, {lang: 'en_US'});
    window.siyuan.languages = Object.assign({
      allDay: 'All day',
      cancel: 'Cancel',
      color: 'Color',
      date: 'Date',
      delete: 'Delete',
      duplicate: 'Duplicate',
      endDate: 'End date',
      none: 'None',
      save: 'Save',
      title: 'Title',
      calendarCount: 'Count',
      calendarDaily: 'Daily',
      calendarDeleteOccurrence: 'Delete occurrence',
      calendarDescription: 'Description',
      calendarInterval: 'Interval',
      calendarLocation: 'Location',
      calendarMonthly: 'Monthly',
      calendarRecurringAdvancedReadOnly: 'Advanced recurrence is retained',
      calendarThisAndFuture: 'This and future',
      calendarUntil: 'Until',
      calendarWeekly: 'Weekly',
      calendarYearly: 'Yearly',
    }, window.siyuan.languages || {});
    window.Lute = window.Lute || {NewNodeID: () => 'dialog-generated-id'};
    globalThis.__calendarDialogTxCalls = [];
    globalThis.__calendarDialogMessages = [];
    globalThis.__calendarDialogOpenBlocks = [];
    globalThis.__calendarDialogInstances = [];

    const field = (id, type, extra = {}) => ({id, type, name: id, desc: '', width: '', icon: '', wrap: false, pin: false, hidden: false, numberFormat: '', template: '', calc: {}, ...extra});
    const host = document.createElement('div');
    host.className = 'av';
    host.setAttribute('data-av-id', ${JSON.stringify(fixture.avID)});
    host.setAttribute('data-node-id', ${JSON.stringify(fixture.blockID)});
    document.body.appendChild(host);
    const calendar = {
      dateFieldID: 'date',
      fields: [
        field('date', 'date'),
        field('recurrence', 'text'),
        field('exception', 'text'),
        field('location', 'text'),
        field('description', 'text'),
        field('color', 'select', {options: [{name: 'Focus', color: '1'}, {name: 'Rest', color: '2'}]}),
      ],
      fieldMapping: {
        recurrenceFieldID: 'recurrence',
        exceptionFieldID: 'exception',
        locationFieldID: 'location',
        descriptionFieldID: 'description',
        colorFieldID: 'color',
      },
      cards: [],
    };
    const data = {view: calendar, viewID: ${JSON.stringify(fixture.viewID)}, viewType: 'calendar'};
    const protyle = {disabled: false, block: {action: []}, app: {}};
    let saves = 0;
    let deletes = 0;

    const newDialog = dialogModule.openEventDialog({protyle, blockElement: host, data, date: '2026-06-01', onSave: () => saves++});
    newDialog.element.querySelector('#av-event-title').value = 'Dialog smoke event';
    newDialog.element.querySelector('#av-event-allday').checked = false;
    newDialog.element.querySelector('#av-event-allday').dispatchEvent(new Event('change', {bubbles: true}));
    const timeRowVisible = newDialog.element.querySelector('#av-event-time-row').style.display !== 'none';
    newDialog.element.querySelector('#av-event-start').value = '09:30';
    newDialog.element.querySelector('#av-event-end').value = '10:45';
    newDialog.element.querySelector('#av-event-end-date').value = '2026-06-02';
    newDialog.element.querySelector('#av-event-location').value = 'Dialog Room';
    newDialog.element.querySelector('#av-event-description').value = 'Dialog details';
    newDialog.element.querySelector('#av-event-color').value = 'Focus';
    newDialog.element.querySelector('#av-event-recurrence-freq').value = 'WEEKLY';
    newDialog.element.querySelector('#av-event-recurrence-freq').dispatchEvent(new Event('change', {bubbles: true}));
    newDialog.element.querySelector('#av-event-recurrence-interval').value = '2';
    newDialog.element.querySelector('#av-event-recurrence-count').value = '3';
    newDialog.element.querySelector('#av-event-recurrence-until').value = '2026-05-01';
    newDialog.element.querySelector('[data-type="calendar-recurrence-weekday"][value="MO"]').checked = true;
    newDialog.element.querySelector('[data-type="calendar-recurrence-weekday"][value="WE"]').checked = true;
    const weekdayVisible = newDialog.element.querySelector('[data-type="calendar-weekday-row"]').style.display !== 'none';
    newDialog.element.querySelector('[data-type="event-save"]').click();
    const createCall = globalThis.__calendarDialogTxCalls.find(call => call.type === 'create');

    const event = {
      id: 'row-dialog',
      blockID: 'block-dialog',
      title: 'Existing dialog event',
      start: dayjs('2026-06-03T11:00:00'),
      end: dayjs('2026-06-03T12:00:00'),
      isAllDay: false,
      recurrenceRaw: 'FREQ=WEEKLY;COUNT=5',
      location: 'Old room',
      description: 'Old details',
      colorContent: 'Rest',
    };
    const readOnlyDialog = dialogModule.openEventDialog({protyle, blockElement: host, data, date: '2026-06-03', event, readOnly: true});
    const readOnlyDisabled = readOnlyDialog.element.querySelector('#av-event-title').disabled;
    const readOnlyHasSave = !!readOnlyDialog.element.querySelector('[data-type="event-save"]');
    readOnlyDialog.element.querySelector('[data-type="event-open-block"]').click();
    const openedBlock = globalThis.__calendarDialogOpenBlocks[0]?.blockID || '';

    const occurrence = {...event, id: 'row-dialog::2026-06-10', isOccurrence: true, occurrenceDate: '2026-06-10'};
    const futureDialog = dialogModule.openEventDialog({protyle, blockElement: host, data, date: '2026-06-10', event: occurrence, onSave: () => saves++});
    const hasFutureButton = !!futureDialog.element.querySelector('[data-type="event-save-future"]');
    futureDialog.element.querySelector('#av-event-title').value = 'Future dialog event';
    futureDialog.element.querySelector('[data-type="event-save-future"]').click();
    const futureCall = globalThis.__calendarDialogTxCalls.find(call => call.type === 'future');

    const occurrenceDialog = dialogModule.openEventDialog({protyle, blockElement: host, data, date: '2026-06-10', event: occurrence, onDelete: () => deletes++});
    occurrenceDialog.element.querySelector('[data-type="event-delete"]').click();
    const deleteOccurrenceCall = globalThis.__calendarDialogTxCalls.find(call => call.type === 'delete-occurrence');

    const duplicateDialog = dialogModule.openEventDialog({protyle, blockElement: host, data, date: '2026-06-03', event, onSave: () => saves++});
    duplicateDialog.element.querySelector('[data-type="event-duplicate"]').click();
    const duplicateCreateCall = globalThis.__calendarDialogTxCalls.filter(call => call.type === 'create').at(-1);

    const advancedDialog = dialogModule.openEventDialog({protyle, blockElement: host, data, date: '2026-06-03', event: {...event, recurrenceRaw: 'FREQ=WEEKLY;BYMONTH=1'}});
    const advancedReadOnly = advancedDialog.element.querySelector('#av-event-recurrence-raw')?.readOnly || false;

    return {
      timeRowVisible,
      weekdayVisible,
      createDraft: createCall?.payload?.draft,
      createDestroyed: newDialog.destroyed,
      saves,
      readOnlyDisabled,
      readOnlyHasSave,
      openedBlock,
      hasFutureButton,
      futureDraft: futureCall?.payload?.draft,
      futureDestroyed: futureDialog.destroyed,
      deleteOccurrenceType: deleteOccurrenceCall?.type || '',
      deletes,
      duplicateDraft: duplicateCreateCall?.payload?.draft,
      advancedReadOnly,
      messageCount: globalThis.__calendarDialogMessages.length,
    };
  })()`);
  const draft = result?.createDraft || {};
  const duplicateDraft = result?.duplicateDraft || {};
  if (!result?.timeRowVisible || !result.weekdayVisible || !result.createDestroyed ||
    result.saves < 2 || draft.title !== "Dialog smoke event" || draft.date !== "2026-06-01" ||
    draft.endDate !== "2026-06-02" || draft.startTime !== "09:30" || draft.endTime !== "10:45" ||
    draft.isAllDay !== false || draft.location !== "Dialog Room" || draft.description !== "Dialog details" ||
    draft.colorContent !== "Focus" || draft.recurrenceRaw !== "FREQ=WEEKLY;INTERVAL=2;COUNT=3;UNTIL=2026-06-01;BYDAY=MO,WE" ||
    !result.readOnlyDisabled || result.readOnlyHasSave || result.openedBlock !== "block-dialog" ||
    !result.hasFutureButton || result.futureDraft?.title !== "Future dialog event" || !result.futureDestroyed ||
    result.deleteOccurrenceType !== "delete-occurrence" || result.deletes !== 1 ||
    duplicateDraft.title !== "Existing dialog event" || duplicateDraft.recurrenceRaw !== "" ||
    !result.advancedReadOnly || result.messageCount !== 0) {
    fail(`calendar Electron dialog smoke failed: ${JSON.stringify(result)}`);
  }
  return result;
};

const runCalendarRenderSmoke = async (debugPort, renderModule) => {
  const fixture = {
    avID: nodeID(),
    blockID: nodeID(),
    viewID: nodeID(),
  };
  const result = await evaluateInTarget(debugPort, `(async () => {
    const renderModule = require(${JSON.stringify(renderModule)});
    window.siyuan = window.siyuan || {};
    window.siyuan.config = Object.assign({}, window.siyuan.config || {}, {lang: 'en_US'});
    window.siyuan.languages = Object.assign({
      calendar: 'Calendar',
      month: 'Month',
      week: 'Week',
      day: 'Day',
      calendarSchedule: 'Schedule',
      today: 'Today',
      calendarPreviousEvent: 'Previous event',
      calendarNextEvent: 'Next event',
      calendarSearch: 'Search',
      calendarEvents: 'Events',
      calendarTimed: 'Timed',
      calendarRecurrence: 'Recurring',
      calendarOccurrence: 'Recurring occurrence',
      calendarLocation: 'Location',
      calendarDescription: 'Description',
      allDay: 'All day',
      all: 'All',
      filter: 'Filter',
      emptyContent: 'Empty',
      newEvent: 'New event',
      newRow: 'New row',
      copy: 'Copy',
      untitled: 'Untitled',
      _kernel: {29: 'Failed'}
    }, window.siyuan.languages || {});
    window.Lute = window.Lute || {NewNodeID: () => String(Date.now()) + '-render'};
    const timestamp = (value) => new Date(value).getTime();
    const field = (id, type, extra = {}) => ({id, type, name: id, desc: '', width: '', icon: '', wrap: false, pin: false, hidden: false, numberFormat: '', template: '', calc: {}, ...extra});
    const cell = (rowID, keyID, type, value) => ({id: rowID + '-' + keyID, valueType: type, color: '', bgColor: '', value: {id: rowID + '-' + keyID, keyID, type, ...value}});
    const card = (rowID, title, start, end, recurrence, exception = '') => ({
      id: rowID,
      values: [
        cell(rowID, 'block', 'block', {block: {id: 'block-' + rowID, content: title}}),
        cell(rowID, 'date', 'date', {date: {content: timestamp(start), isNotEmpty: true, content2: timestamp(end), isNotEmpty2: true, hasEndDate: true, isNotTime: false}}),
        cell(rowID, 'recurrence', 'text', {text: {content: recurrence}}),
        cell(rowID, 'exception', 'text', {text: {content: exception}}),
        cell(rowID, 'location', 'text', {text: {content: 'Render Room'}}),
        cell(rowID, 'description', 'text', {text: {content: 'Render description'}}),
        cell(rowID, 'color', 'select', {mSelect: [{content: 'Focus', color: '1'}]}),
      ],
    });
    const host = document.createElement('div');
    host.className = 'av';
    host.setAttribute('data-av-id', ${JSON.stringify(fixture.avID)});
    host.setAttribute('data-node-id', ${JSON.stringify(fixture.blockID)});
    host.dataset.calendarDate = '2026-05-24';
    host.innerHTML = '<div></div>';
    document.body.appendChild(host);
    const calendar = {
      dateFieldID: 'date',
      viewMode: 0,
      weekStart: 0,
      fields: [
        field('date', 'date'),
        field('recurrence', 'text'),
        field('exception', 'text'),
        field('location', 'text'),
        field('description', 'text'),
        field('color', 'select', {options: [{name: 'Focus', color: '1'}]}),
      ],
      fieldMapping: {
        recurrenceFieldID: 'recurrence',
        exceptionFieldID: 'exception',
        locationFieldID: 'location',
        descriptionFieldID: 'description',
        colorFieldID: 'color',
      },
      cards: [
        card('row-render', 'Calendar UI render smoke event', '2026-05-24T09:00:00', '2026-05-24T10:00:00', 'FREQ=WEEKLY;COUNT=2', '2026-05-31'),
        card('row-none', 'Calendar none smoke event', '2026-05-25T11:00:00', '2026-05-25T12:00:00', 'None'),
      ],
      cardCount: 2,
    };
    globalThis.__calendarRenderFetchResponse = {data: {view: calendar, viewID: ${JSON.stringify(fixture.viewID)}, viewType: 'calendar'}};
    await renderModule.renderCalendar({
      protyle: {disabled: false, block: {action: []}},
      blockElement: host,
      renderAll: true,
      data: {view: calendar, viewID: ${JSON.stringify(fixture.viewID)}, viewType: 'calendar'},
    });
    const calendarElement = host.querySelector('.av__calendar');
    const initialEventText = Array.from(host.querySelectorAll('.av__calendar-event')).map(item => item.textContent || '').join('\\n');
    const initialEventCount = host.querySelectorAll('.av__calendar-event').length;
    const recurringCount = host.querySelectorAll('.av__calendar-recurring').length;
    const tooltip = host.querySelector('.av__calendar-event')?.getAttribute('title') || '';
    host.querySelector('[data-type="calendar-mode"][data-mode="1"]').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    const weekMode = host.querySelector('.av__calendar')?.getAttribute('data-view-mode');
    host.querySelector('[data-type="calendar-mode"][data-mode="2"]').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    const dayMode = host.querySelector('.av__calendar')?.getAttribute('data-view-mode');
    host.querySelector('[data-type="calendar-mode"][data-mode="3"]').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    const scheduleMode = host.querySelector('.av__calendar')?.getAttribute('data-view-mode');
    host.querySelector('[data-type="calendar-prev-event"]').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    const anchorAfterPrevEvent = host.dataset.calendarDate || '';
    host.querySelector('[data-type="calendar-next-event"]').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    const anchorAfterNextEvent = host.dataset.calendarDate || '';
    host.querySelector('.av__calendar').dispatchEvent(new KeyboardEvent('keydown', {key: '1', bubbles: true}));
    await new Promise(resolve => setTimeout(resolve, 100));
    const modeAfterKeyboard = host.querySelector('.av__calendar')?.getAttribute('data-view-mode');
    const search = host.querySelector('[data-type="calendar-search"]');
    search.value = 'none';
    search.dispatchEvent(new Event('input', {bubbles: true}));
    await new Promise(resolve => setTimeout(resolve, 100));
    const filteredEventText = Array.from(host.querySelectorAll('.av__calendar-event')).map(item => item.textContent || '').join('\\n');
    const filteredEventCount = host.querySelectorAll('.av__calendar-event').length;
    const searchState = host.dataset.calendarSearch;
    host.querySelector('[data-type="calendar-clear-search"]').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    const searchAfterClear = host.dataset.calendarSearch || '';
    const filterAfterClear = host.dataset.calendarFilter || '';

    const readOnlyHost = document.createElement('div');
    readOnlyHost.className = 'av';
    readOnlyHost.setAttribute('data-av-id', ${JSON.stringify(fixture.avID)} + '-readonly');
    readOnlyHost.setAttribute('data-node-id', ${JSON.stringify(fixture.blockID)} + '-readonly');
    readOnlyHost.setAttribute('data-type', 'NodeBlockQueryEmbed');
    readOnlyHost.dataset.calendarDate = '2026-05-24';
    readOnlyHost.innerHTML = '<div></div>';
    document.body.appendChild(readOnlyHost);
    await renderModule.renderCalendar({
      protyle: {disabled: false, block: {action: []}},
      blockElement: readOnlyHost,
      renderAll: true,
      data: {view: {...calendar, viewMode: 0}, viewID: ${JSON.stringify(fixture.viewID)} + '-readonly', viewType: 'calendar'},
    });
    const readOnlyEvent = readOnlyHost.querySelector('.av__calendar-event');
    const readOnlyNewButton = readOnlyHost.querySelector('[data-type="calendar-new"]:not(.av__calendar-daynum)');
    readOnlyHost.querySelector('[data-type="calendar-mode"][data-mode="2"]').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    const readOnlyLocalMode = readOnlyHost.dataset.calendarViewMode || '';
    const readOnlyRenderedMode = readOnlyHost.querySelector('.av__calendar')?.getAttribute('data-view-mode') || '';

    return {
      hasCalendar: !!calendarElement,
      eventCount: filteredEventCount,
      initialEventCount,
      eventText: initialEventText,
      modeCount: host.querySelectorAll('[data-type="calendar-mode"]').length,
      hasSummary: !!host.querySelector('.av__calendar-summary'),
      hasSearch: !!host.querySelector('[data-type="calendar-search"]'),
      hasJumpDate: !!host.querySelector('[data-type="calendar-jump-date"]'),
      recurringCount,
      dataViewMode: calendarElement && calendarElement.getAttribute('data-view-mode'),
      tooltip,
      weekMode,
      dayMode,
      scheduleMode,
      modeAfterKeyboard,
      anchorAfterPrevEvent,
      anchorAfterNextEvent,
      filteredEventText,
      searchState,
      searchAfterClear,
      filterAfterClear,
      readOnlyHasEvent: !!readOnlyEvent,
      readOnlyDraggable: readOnlyEvent?.getAttribute('draggable') || '',
      readOnlyHasNewButton: !!readOnlyNewButton,
      readOnlyLocalMode,
      readOnlyRenderedMode,
    };
  })()`);
  if (!result?.hasCalendar || result.modeCount !== 4 || !result.hasSummary || !result.hasSearch ||
    !result.hasJumpDate || !result.eventText.includes("Calendar UI render smoke event") ||
    !result.eventText.includes("Calendar none smoke event") || result.recurringCount < 1 ||
    !result.tooltip.includes("Render Room") || result.weekMode !== "1" || result.dayMode !== "2" ||
    result.scheduleMode !== "3" || result.modeAfterKeyboard !== "0" ||
    result.anchorAfterPrevEvent !== "2026-05-24" || result.anchorAfterNextEvent !== "2026-05-25" ||
    !result.filteredEventText.includes("Calendar none smoke event") ||
    result.filteredEventText.includes("Calendar UI render smoke event") ||
    result.searchState !== "none" || result.searchAfterClear || result.filterAfterClear ||
    !result.readOnlyHasEvent || result.readOnlyDraggable !== "false" || result.readOnlyHasNewButton ||
    result.readOnlyLocalMode !== "2" || result.readOnlyRenderedMode !== "2") {
    fail(`calendar Electron render smoke failed: ${JSON.stringify(result)}`);
  }
  return result;
};

const stopProcessGroup = async (child) => {
  if (!child || child.exitCode !== null) {
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    child.kill("SIGTERM");
  }
  await sleep(500);
  if (child.exitCode === null) {
    try {
      process.kill(-child.pid, "SIGKILL");
    } catch {
      child.kill("SIGKILL");
    }
  }
};

const main = async () => {
  if (!fs.existsSync(electronBinary)) {
    fail(`electron binary missing at ${electronBinary}; run app dependencies install first`);
  }
  if (!process.env.DISPLAY && spawnSync("which", ["xvfb-run"], {stdio: "ignore"}).status !== 0) {
    fail("DISPLAY is not set and xvfb-run is unavailable");
  }
  if (!(await isPortFree(kernelPort))) {
    fail(`port ${kernelPort} is already in use; close the existing SiYuan kernel before running this smoke`);
  }

  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-calendar-electron-smoke-workspace-"));
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "siyuan-calendar-electron-smoke-home-"));
  const xdgConfig = path.join(home, ".config");
  const siyuanConfig = path.join(home, ".config/siyuan");
  const debugPort = await getFreePort();
  const baseURL = `http://127.0.0.1:${kernelPort}`;
  const hadKernelBinary = fs.existsSync(appKernelBinary);
  const hadAppBuildDir = fs.existsSync(appBuildDir);
  let kernel;
  let electron;
  let renderHarness;
  let dialogHarness;

  try {
    fs.mkdirSync(siyuanConfig, {recursive: true});
    fs.writeFileSync(path.join(siyuanConfig, "workspace.json"), JSON.stringify([workspace]));
    renderHarness = compileCalendarRenderHarness();
    dialogHarness = compileCalendarDialogHarness();
    if (!hadAppBuildDir) {
      if (!fs.existsSync(path.join(desktopBuildDir, "index.html"))) {
        fail(`desktop build output missing at ${desktopBuildDir}; run cd app && corepack pnpm run build:desktop first`);
      }
      fs.symlinkSync(desktopBuildDir, appBuildDir, "dir");
    }

    if (!hadKernelBinary) {
      fs.mkdirSync(appKernelDir, {recursive: true});
      const build = spawnSync("go", ["build", "-tags", "fts5", "-o", appKernelBinary, "."], {
        cwd: kernelDir,
        env: {...process.env, CGO_ENABLED: "1"},
        stdio: "inherit",
      });
      if (build.status !== 0) {
        fail(`kernel build failed with code ${build.status}`);
      }
    }

    kernel = spawn(appKernelBinary, [
      "--port", String(kernelPort),
      "--wd", appDir,
      "--workspace", workspace,
      "--mode", "dev",
      "--lang", "zh_CHT",
    ], {
      cwd: root,
      stdio: ["ignore", "pipe", "pipe"],
    });
    kernel.stdout.on("data", (chunk) => process.stdout.write(chunk));
    kernel.stderr.on("data", (chunk) => process.stderr.write(chunk));
    await waitForKernelBoot(baseURL);

    const electronArgs = [
      electronBinary,
      "./electron/main.js",
      `--workspace=${workspace}`,
      `--port=${kernelPort}`,
      `--remote-debugging-port=${debugPort}`,
      "--no-sandbox",
      "--disable-gpu",
      "--ozone-platform=x11",
    ];
    const command = process.env.DISPLAY ? electronArgs[0] : "xvfb-run";
    const args = process.env.DISPLAY ? electronArgs.slice(1) : ["-a", ...electronArgs];
    electron = spawn(command, args, {
      cwd: appDir,
      env: {
        ...process.env,
        NODE_ENV: "development",
        HOME: home,
        XDG_CONFIG_HOME: xdgConfig,
      },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let electronOutput = "";
    electron.stdout.on("data", (chunk) => {
      electronOutput += chunk.toString();
      process.stdout.write(chunk);
    });
    electron.stderr.on("data", (chunk) => {
      electronOutput += chunk.toString();
      process.stderr.write(chunk);
    });
    electron.once("exit", (code, signal) => {
      if (code !== null && code !== 0) {
        electronOutput += `\nelectron exited early with code ${code}`;
      } else if (signal) {
        electronOutput += `\nelectron exited early with signal ${signal}`;
      }
    });

    const debugInfo = await waitForElectronDebug(debugPort);
    const uiState = await waitForAppShell(debugPort);
    const renderState = await runCalendarRenderSmoke(debugPort, renderHarness.renderModule);
    const dialogState = await runCalendarDialogSmoke(debugPort, dialogHarness.dialogModule);
    if (electron.exitCode !== null) {
      fail(`electron exited before launch smoke completed: ${electronOutput.slice(-2000)}`);
    }
    await sleep(2000);
    if (electron.exitCode !== null) {
      fail(`electron exited shortly after exposing debug target: ${electronOutput.slice(-2000)}`);
    }
    console.log(`calendar electron launch smoke passed: workspace=${workspace} debugPort=${debugPort} browser=${debugInfo.browser} href=${uiState.href} renderedEvents=${renderState.eventCount} dialogSaves=${dialogState.saves}`);
  } finally {
    await stopProcessGroup(electron);
    if (kernel && kernel.exitCode === null) {
      try {
        await postJSON(baseURL, "/api/system/exit", {});
      } catch {
        kernel.kill("SIGTERM");
      }
      await sleep(500);
      if (kernel.exitCode === null) {
        kernel.kill("SIGKILL");
      }
    }
    if (!hadKernelBinary) {
      fs.rmSync(appKernelDir, {recursive: true, force: true, maxRetries: 3});
    }
    if (!hadAppBuildDir) {
      fs.rmSync(appBuildDir, {recursive: true, force: true, maxRetries: 3});
    }
    if (renderHarness?.tempDir) {
      fs.rmSync(renderHarness.tempDir, {recursive: true, force: true, maxRetries: 3});
    }
    if (dialogHarness?.tempDir) {
      fs.rmSync(dialogHarness.tempDir, {recursive: true, force: true, maxRetries: 3});
    }
    if (process.env.SIYUAN_CALENDAR_KEEP_SMOKE_WORKSPACE !== "1") {
      fs.rmSync(workspace, {recursive: true, force: true, maxRetries: 3});
      fs.rmSync(home, {recursive: true, force: true, maxRetries: 3});
    }
  }
};

main().catch((error) => {
  console.error(`calendar electron launch smoke failed: ${error.stack || error.message}`);
  process.exit(1);
});
