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
const expectedKernelVersion = JSON.parse(fs.readFileSync(path.join(appDir, "package.json"), "utf8")).version;
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
      if (version === expectedKernelVersion && progress?.progress >= 100) {
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
      // 带上真实的异常信息与调用栈，否则只会看到 "Uncaught (in promise) TypeError"
      const details = result.exceptionDetails;
      const description = details.exception?.description || details.exception?.value || "";
      const frames = (details.stackTrace?.callFrames || [])
        .slice(0, 6)
        .map((frame) => `    at ${frame.functionName || "<anonymous>"} (line ${frame.lineNumber + 1}:${frame.columnNumber})`)
        .join("\n");
      fail(`electron target evaluation failed: ${details.text}\n${description}\n${frames}`);
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
  const compileCalendarFile = (file, outputFile = file) => {
    const source = fs.readFileSync(path.join(calendarSourceDir, file), "utf8");
    const result = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: false,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: file,
    });
    writeFile(path.join(calendarTargetDir, outputFile.replace(/\.ts$/, ".js")), result.outputText);
  };
  // 纯工具模块没有任何 import，也没有 /// #if 分支，直接编译真身而不是写桩，
  // 否则桩少导出一个函数（例如 hasClosestByClassName）只会在运行时炸成
  // "not a function"，被 rerender() 吞掉后表现为“DOM 没更新”这种极难定位的症状。
  const compileAppFile = (relativePath) => {
    const source = fs.readFileSync(path.join(appDir, "src", relativePath), "utf8");
    const result = ts.transpileModule(source, {
      compilerOptions: {
        esModuleInterop: false,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2020,
      },
      fileName: path.basename(relativePath),
    });
    writeFile(path.join(tempDir, "src", relativePath.replace(/\.ts$/, ".js")), result.outputText);
  };
  for (const file of ["model.ts", "mapped-fields.ts", "recurrence.ts", "recurrence-summary.ts", "normalize.ts", "quick-create.ts", "time-geometry.ts", "layout-overlap.ts", "time-grid.ts", "now-indicator.ts", "event-chip.ts", "drafts.ts", "interactions.ts", "context-menu.ts", "keymap.ts", "mini-month.ts", "render.ts"]) {
    compileCalendarFile(file);
  }
  compileAppFile("protyle/util/hasClosest.ts");
  // Compile the REAL event-dialog.ts to a side path so the event-dialog stub below
  // can re-export the production recurrence-scope helpers instead of hand-forking
  // them (which would silently drift from app/src/.../event-dialog.ts).
  compileCalendarFile("event-dialog.ts", "event-dialog-real.ts");
  writeFile(path.join(tempDir, "src/constants.js"), `
exports.Constants = {
  CUSTOM_SY_AV_VIEW: 'custom-sy-av-view',
  CB_GET_AV_NO_CREATE: 'cb-get-av-no-create',
  CB_GET_FOCUS: 'cb-get-focus',
};
`);
  writeFile(path.join(tempDir, "src/dialog/index.js"), `
class Dialog {
  constructor(options) {
    this.destroyed = false;
    this.element = document.createElement('div');
    this.element.className = 'calendar-render-dialog-smoke';
    this.element.innerHTML = '<div class="b3-dialog"><div class="b3-dialog__body">' + ((options && options.content) || '') + '</div></div>';
    document.body.appendChild(this.element);
  }
  destroy() {
    this.destroyed = true;
    this.element.remove();
  }
}
exports.Dialog = Dialog;
`);
  writeFile(path.join(tempDir, "src/dialog/confirmDialog.js"), "exports.confirmDialog = (title, text, confirm) => { if (confirm) confirm(); };\n");
  writeFile(path.join(tempDir, "src/dialog/message.js"), "exports.showMessage = (message) => (globalThis.__calendarRenderMessages ||= []).push(message);\n");
  writeFile(path.join(tempDir, "src/editor/util.js"), "exports.openFileById = (options) => (globalThis.__calendarRenderOpenBlocks ||= []).push({options, blockID: options && options.id});\n");
  writeFile(path.join(tempDir, "src/mobile/editor.js"), "exports.openMobileFileById = (app, blockID) => (globalThis.__calendarRenderOpenBlocks ||= []).push({app, blockID, mobile: true});\n");
  writeFile(path.join(tempDir, "src/util/escape.js"), `
const escapeHtml = (value = '') => String(value).replace(/[&<>"']/g, (item) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[item]));
exports.escapeHtml = escapeHtml;
exports.escapeAttr = escapeHtml;
`);
  writeFile(path.join(tempDir, "src/util/fetch.js"), "exports.fetchSyncPost = async () => globalThis.__calendarRenderFetchResponse || {data: {}};\n");
  writeFile(path.join(tempDir, "src/protyle/util/selection.js"), "exports.focusBlock = (element) => (globalThis.__calendarRenderFocusBlocks ||= []).push(element && element.getAttribute && element.getAttribute('data-av-id'));\n");
  writeFile(path.join(tempDir, "src/protyle/wysiwyg/transaction.js"), "exports.transaction = (protyle, doOperations, undoOperations) => (globalThis.__calendarRenderTransactions ||= []).push({doOperations, undoOperations});\n");
  // render.ts re-dispatches to the sibling layouts and uses the shared
  // search/locate pipeline, so those modules need stubs that record the calls.
  writeFile(path.join(tempDir, "src/protyle/render/av/render.js"), `
exports.genTabHeaderHTML = () => '<div class="av__header"></div>';
exports.avRender = (...args) => (globalThis.__calendarRenderDispatches ||= []).push({layout: 'table', args});
exports.updateSearch = (...args) => (globalThis.__calendarRenderSearchUpdates ||= []).push(args);
`);
  writeFile(path.join(tempDir, "src/protyle/render/av/gallery/render.js"), "exports.renderGallery = (options) => (globalThis.__calendarRenderDispatches ||= []).push({layout: 'gallery', options});\n");
  writeFile(path.join(tempDir, "src/protyle/render/av/kanban/render.js"), "exports.renderKanban = (options) => (globalThis.__calendarRenderDispatches ||= []).push({layout: 'kanban', options});\n");
  writeFile(path.join(tempDir, "src/protyle/render/av/search.js"), "exports.bindAvSearch = (options) => (globalThis.__calendarRenderSearchBinds ||= []).push(options);\n");
  // 事件条目现在是真实文档：主点击走上游的“打开数据库行”，harness 记录调用即可
  writeFile(path.join(tempDir, "src/protyle/render/av/openDatabaseRow.js"), "exports.openDatabaseRowByData = (...args) => (globalThis.__calendarRenderOpenRows ||= []).push(args);\n");
  writeFile(path.join(tempDir, "src/protyle/render/av/locate.js"), `
// 与真实实现一致：渲染令牌按 blockElement 存储，不能用单一全局计数器，
// 否则多个宿主互相作废对方的渲染。
const renderTokens = new WeakMap();
exports.beginAVRender = (blockElement) => {
  const token = Symbol();
  renderTokens.set(blockElement, token);
  return token;
};
exports.isCurrentAVRender = (blockElement, token) => renderTokens.get(blockElement) === token;
exports.getAVLocateParams = () => undefined;
exports.prepareAVLocate = () => undefined;
exports.finishAVLocate = () => undefined;
`);
  writeFile(path.join(tempDir, "src/protyle/render/av/calendar/event-dialog.js"), `
// Pure helpers come from the compiled real module so the harness cannot drift
// from production logic; only the dialog openers are replaced with recorders.
const realEventDialog = require('./event-dialog-real.js');
exports.isRecurringSourceEvent = realEventDialog.isRecurringSourceEvent;
exports.getDisabledRecurrenceScopes = realEventDialog.getDisabledRecurrenceScopes;
exports.openEventDialog = (options) => (globalThis.__calendarRenderDialogs ||= []).push(options);
exports.openRecurrenceScopeDialog = (options) => {
  (globalThis.__calendarRenderScopeDialogs ||= []).push({action: options.action, disabled: options.disabledScopes});
  options.onSelect(globalThis.__calendarNextScope || 'series');
  return {destroy: () => {}};
};
`);
  writeFile(path.join(tempDir, "src/protyle/render/av/calendar/transactions.js"), `
const record = (type, payload) => {
  (globalThis.__calendarRenderTxCalls ||= []).push({type, payload});
  return true;
};
exports.createCalendarEvent = (payload) => record('create', payload);
exports.createCalendarEventAsDocument = (payload) => {
  record('create-document', payload);
  return {itemID: 'created-item', blockID: 'created-document'};
};
exports.createCalendarEventReplacingOccurrence = (payload) => record('replace-occurrence', payload);
exports.updateCalendarEvent = (payload) => record('update', payload);
exports.updateCalendarEventThisAndFuture = (payload) => record('future', payload);
exports.deleteCalendarEvent = (payload) => record('delete', payload);
exports.deleteCalendarOccurrence = (payload) => record('delete-occurrence', payload);
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
  // event-dialog.ts now renders the human-readable recurrence summary/presets
  for (const file of ["model.ts", "mapped-fields.ts", "recurrence.ts", "recurrence-summary.ts", "event-dialog.ts"]) {
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
  writeFile(path.join(tempDir, "src/dialog/confirmDialog.js"), "exports.confirmDialog = (title, text, confirm) => { (globalThis.__calendarDialogConfirms ||= []).push({title, text}); if (confirm) confirm(); };\n");
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
    window.siyuan.config = Object.assign({}, window.siyuan.config || {}, {lang: 'en'});
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
    await new Promise(resolve => setTimeout(resolve, 20));
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
    futureDialog.element.querySelector('#av-event-title').value = 'Future dialog event';
    futureDialog.element.querySelector('[data-type="event-save"]').click();
    const saveScopeDialog = globalThis.__calendarDialogInstances.at(-1);
    const scopeFutureButton = saveScopeDialog.element.querySelector('[data-type="calendar-scope-future"]');
    const scopeFutureEnabled = !!scopeFutureButton && !scopeFutureButton.disabled;
    scopeFutureButton.click();
    await new Promise(resolve => setTimeout(resolve, 20));
    const futureCall = globalThis.__calendarDialogTxCalls.find(call => call.type === 'future');

    const occurrenceDialog = dialogModule.openEventDialog({protyle, blockElement: host, data, date: '2026-06-10', event: occurrence, onDelete: () => deletes++});
    occurrenceDialog.element.querySelector('[data-type="event-delete"]').click();
    const deleteScopeDialog = globalThis.__calendarDialogInstances.at(-1);
    const scopeOccurrenceButton = deleteScopeDialog.element.querySelector('[data-type="calendar-scope-occurrence"]');
    const scopeOccurrenceEnabled = !!scopeOccurrenceButton && !scopeOccurrenceButton.disabled;
    scopeOccurrenceButton.click();
    await new Promise(resolve => setTimeout(resolve, 20));
    const deleteOccurrenceCall = globalThis.__calendarDialogTxCalls.find(call => call.type === 'delete-occurrence');

    const duplicateDialog = dialogModule.openEventDialog({protyle, blockElement: host, data, date: '2026-06-03', event, onSave: () => saves++});
    duplicateDialog.element.querySelector('[data-type="event-duplicate"]').click();
    await new Promise(resolve => setTimeout(resolve, 20));
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
      scopeFutureEnabled,
      scopeOccurrenceEnabled,
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
    !result.scopeFutureEnabled || !result.scopeOccurrenceEnabled || result.futureDraft?.title !== "Future dialog event" || !result.futureDestroyed ||
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
    // rerender() 里的 renderCalendar(...).then(...) 没有 catch，渲染中途抛错只会变成
    // 一条 unhandled rejection，DOM 静悄悄停在上一次的样子。把来自本 harness 模块的
    // rejection 收集起来并在结尾断言为空，否则下次又要靠“DOM 为什么没更新”反推。
    if (!globalThis.__calendarRenderRejectionHook) {
      globalThis.__calendarRenderRejectionHook = true;
      window.addEventListener('unhandledrejection', (event) => {
        const detail = String(event.reason && (event.reason.stack || event.reason.message) || event.reason);
        if (detail.includes('.calendar-electron-render-')) {
          (globalThis.__calendarRenderRejections ||= []).push(detail.split('\\n').slice(0, 3).join(' | '));
        }
      });
    }
    globalThis.__calendarRenderRejections = [];
    const renderModule = require(${JSON.stringify(renderModule)});
    window.siyuan = window.siyuan || {};
    window.siyuan.config = Object.assign({}, window.siyuan.config || {}, {lang: 'en'});
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
    globalThis.__calendarRenderDialogs = [];
    globalThis.__calendarRenderMessages = [];
    globalThis.__calendarRenderTransactions = [];
    globalThis.__calendarRenderTxCalls = [];
    globalThis.__calendarRenderScopeDialogs = [];
    globalThis.__calendarNextScope = 'series';
    const timestamp = (value) => new Date(value).getTime();
    const field = (id, type, extra = {}) => ({id, type, name: id, desc: '', width: '', icon: '', wrap: false, pin: false, hidden: false, numberFormat: '', template: '', calc: {}, ...extra});
    const cell = (rowID, keyID, type, value) => ({id: rowID + '-' + keyID, valueType: type, color: '', bgColor: '', value: {id: rowID + '-' + keyID, keyID, type, ...value}});
    // bound=false reproduces a legacy detached row: the block value carries no
    // document id, so the primary click must still open the scheduling dialog.
    const card = (rowID, title, start, end, recurrence, exception = '', isNotTime = false, bound = true) => ({
      id: rowID,
      values: [
        cell(rowID, 'block', 'block', {block: bound ? {id: 'block-' + rowID, content: title} : {content: title}}),
        cell(rowID, 'date', 'date', {date: {content: timestamp(start), isNotEmpty: true, content2: timestamp(end), isNotEmpty2: true, hasEndDate: true, isNotTime}}),
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
      newItemTarget: 'document',
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
        card('row-detached', 'Calendar detached smoke event', '2026-05-28T15:00:00', '2026-05-28T16:00:00', '', '', false, false),
        // Recurring series whose generated occurrences (05-25, 05-26) are NOT
        // excluded by an exception, so occurrence DOM + occurrence/future scope
        // paths are exercised.
        card('row-recur2', 'Calendar occurrence smoke event', '2026-05-24T13:00:00', '2026-05-24T14:00:00', 'FREQ=DAILY;COUNT=3'),
        // Same-day overlapping timed pair for the day-view column layout check
        // (placed at 15:00 so it stays clear of row-render 09:00 and row-recur2 13:00).
        card('row-ov1', 'Calendar overlap first smoke event', '2026-05-24T15:00:00', '2026-05-24T16:00:00', ''),
        card('row-ov2', 'Calendar overlap second smoke event', '2026-05-24T15:30:00', '2026-05-24T16:30:00', ''),
        // All-day fillers push the 05-24 month cell past the +N cap; they sort
        // FIRST in month cells (all-day before timed), keeping row-render (09:00)
        // inside the 3 visible events that earlier steps click on.
        card('row-fill1', 'Calendar filler alpha smoke event', '2026-05-24T00:00:00', '2026-05-24T00:00:00', '', '', true),
        card('row-fill2', 'Calendar filler beta smoke event', '2026-05-24T00:00:00', '2026-05-24T00:00:00', '', '', true),
      ],
      cardCount: 7,
    };
    globalThis.__calendarRenderFetchResponse = {data: {view: calendar, viewID: ${JSON.stringify(fixture.viewID)}, viewType: 'calendar', defaultTemplateID: 'template-smoke'}};
    await renderModule.renderCalendar({
      protyle: {disabled: false, block: {action: []}, options: {}},
      blockElement: host,
      renderAll: true,
      data: {view: calendar, viewID: ${JSON.stringify(fixture.viewID)}, viewType: 'calendar', defaultTemplateID: 'template-smoke'},
    });
    const calendarElement = host.querySelector('.av__calendar');
    const initialEventText = Array.from(host.querySelectorAll('.av__calendar-event')).map(item => item.textContent || '').join('\\n');
    const initialEventCount = host.querySelectorAll('.av__calendar-event').length;
    const recurringCount = host.querySelectorAll('.av__calendar-recurring').length;
    const tooltip = host.querySelector('.av__calendar-event')?.getAttribute('title') || '';
    // 渲染失败时给出可读诊断，而不是让后面的 .click() 抛 "null.click"
    if (!calendarElement) {
      throw new Error('calendar did not render; host.innerHTML head=' + host.innerHTML.slice(0, 600));
    }
    const clickOrThrow = (selector, root) => {
      const element = (root || host).querySelector(selector);
      if (!element) {
        throw new Error('missing element for click: ' + selector + '; calendar HTML head=' + calendarElement.innerHTML.slice(0, 600));
      }
      element.click();
      return element;
    };
    clickOrThrow('[data-type="calendar-new"]:not(.av__calendar-daynum)');
    const toolbarQuickTitleFocused = document.activeElement?.getAttribute('data-type') === 'calendar-quick-create-title';
    const toolbarQuickAllDay = host.querySelector('[data-type="calendar-quick-create-all-day"]')?.checked === true;
    host.querySelector('[data-type="calendar-quick-create-more"]').click();
    const toolbarNewDialog = globalThis.__calendarRenderDialogs.at(-1);
    host.querySelector('.av__calendar-daynum[data-date="2026-05-26"]').click();
    const dayQuickSummary = host.querySelector('[data-type="calendar-quick-create-summary"]')?.textContent || '';
    const dayQuickAllDay = host.querySelector('[data-type="calendar-quick-create-all-day"]')?.checked === true;
    host.querySelector('[data-type="calendar-quick-create-more"]').click();
    const dayNewDialog = globalThis.__calendarRenderDialogs.at(-1);
    // A bound entry is a real page: the primary click opens it (upstream's
    // openDatabaseRowByData), and the ◷ affordance reaches the scheduling dialog.
    const openRowsBeforeClick = (globalThis.__calendarRenderOpenRows || []).length;
    const dialogsBeforeClick = globalThis.__calendarRenderDialogs.length;
    host.querySelector('.av__calendar-event[data-id="row-render"]').click();
    const boundClickOpenedPage = (globalThis.__calendarRenderOpenRows || []).length === openRowsBeforeClick + 1;
    const boundClickOpenedDialog = globalThis.__calendarRenderDialogs.length !== dialogsBeforeClick;
    host.querySelector('.av__calendar-event[data-id="row-render"] [data-type="calendar-open-dialog"]').click();
    const editDialog = globalThis.__calendarRenderDialogs.at(-1);
    // A detached entry has no page, so its primary click must still open the dialog.
    const detachedDialogsBefore = globalThis.__calendarRenderDialogs.length;
    const detachedOpenRowsBefore = (globalThis.__calendarRenderOpenRows || []).length;
    host.querySelector('.av__calendar-event[data-id="row-detached"]').click();
    const detachedDialog = globalThis.__calendarRenderDialogs.at(-1);
    const detachedClickOpenedDialog = globalThis.__calendarRenderDialogs.length === detachedDialogsBefore + 1;
    const detachedClickOpenedPage = (globalThis.__calendarRenderOpenRows || []).length !== detachedOpenRowsBefore;
    const detachedHasSourceAffordance = !!host.querySelector('.av__calendar-event[data-id="row-detached"] [data-type="calendar-open-source"]');
    // The chip's inline Copy / -15m / +15m buttons are gone: those actions moved
    // into the right-click menu. Same data-type contract, same drafts, same
    // guarded write path - so the assertions below are unchanged, only the way
    // the action is reached is.
    const openChipMenu = (chip) => {
      if (!chip) {
        throw new Error('no chip to open a context menu on');
      }
      const rect = chip.getBoundingClientRect();
      chip.dispatchEvent(new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        clientX: Math.round(rect.left + 4),
        clientY: Math.round(rect.top + 4),
      }));
      return document.querySelector('.av__calendar-menu');
    };
    const runChipMenuCommand = (chipSelector, itemSelector) => {
      const chip = host.querySelector(chipSelector);
      const menu = openChipMenu(chip);
      if (!menu) {
        throw new Error('context menu did not open for ' + chipSelector);
      }
      const item = menu.querySelector(itemSelector);
      if (!item) {
        throw new Error('context menu item missing: ' + itemSelector + ' in [' +
          Array.from(menu.querySelectorAll('[data-type]')).map(node => node.getAttribute('data-type') +
            (node.getAttribute('data-delta') ? '/' + node.getAttribute('data-delta') : '') +
            (node.getAttribute('data-days') ? '/d' + node.getAttribute('data-days') : '')).join(', ') + ']');
      }
      item.click();
      return item;
    };
    // The menu is a popover on <body>: it must be gone again once a command ran.
    const chipMenuOpened = !!openChipMenu(host.querySelector('.av__calendar-event[data-id="row-render"]'));
    const chipMenuItemTypes = Array.from(document.querySelectorAll('.av__calendar-menu [data-type]'))
      .map(node => node.getAttribute('data-type')).join(',');
    document.querySelector('.av__calendar-menu [data-type="calendar-open-dialog"]').click();
    const chipMenuClosedAfterCommand = !document.querySelector('.av__calendar-menu');
    const chipMenuDialogEventID = globalThis.__calendarRenderDialogs.at(-1)?.event?.id || '';
    const keyboardMenuChip = host.querySelector('.av__calendar-event[data-id="row-render"]');
    keyboardMenuChip.focus();
    keyboardMenuChip.dispatchEvent(new KeyboardEvent('keydown', {key: 'F10', shiftKey: true, bubbles: true, cancelable: true}));
    const chipKeyboardMenuOpened = !!document.querySelector('.av__calendar-menu');
    document.querySelector('.av__calendar-menu [data-type="calendar-open-dialog"]')?.click();
    runChipMenuCommand('.av__calendar-event[data-id="row-render"]', '[data-type="calendar-duplicate-next-day"]');
    await new Promise(resolve => setTimeout(resolve, 100));
    const duplicateCall = globalThis.__calendarRenderTxCalls.find(call => call.type === 'create-document');
    runChipMenuCommand('.av__calendar-event[data-id="row-render"]', '[data-type="calendar-resize"][data-delta="15"]');
    await new Promise(resolve => setTimeout(resolve, 100));
    const resizeCall = globalThis.__calendarRenderTxCalls.find(call => call.type === 'update');
    // Moving the whole entry is new to the menu (the chip never offered it) and
    // must go through the same move path a drag uses.
    runChipMenuCommand('.av__calendar-event[data-id="row-none"]', '[data-type="calendar-shift"][data-minutes="15"]');
    await new Promise(resolve => setTimeout(resolve, 100));
    const shiftCall = globalThis.__calendarRenderTxCalls.filter(call => call.type === 'update')
      .find(call => call.payload?.draft?.title === 'Calendar none smoke event' && call.payload?.draft?.startTime === '11:15');
    // Delete from the menu removes the ROW, never the page behind it.
    runChipMenuCommand('.av__calendar-event[data-id="row-detached"]', '[data-type="calendar-delete"]');
    await new Promise(resolve => setTimeout(resolve, 100));
    const menuDeleteCall = globalThis.__calendarRenderTxCalls.filter(call => call.type === 'delete').at(-1);
    const dragEvent = host.querySelector('.av__calendar-event[data-id="row-none"]');
    const dropTarget = host.querySelector('[data-type="calendar-drop-day"][data-date="2026-05-26"]');
    const dataTransfer = new DataTransfer();
    dragEvent.dispatchEvent(new DragEvent('dragstart', {bubbles: true, dataTransfer}));
    dropTarget.dispatchEvent(new DragEvent('dragover', {bubbles: true, cancelable: true, dataTransfer}));
    dropTarget.dispatchEvent(new DragEvent('drop', {bubbles: true, cancelable: true, dataTransfer}));
    await new Promise(resolve => setTimeout(resolve, 100));
    const dragUpdateCall = globalThis.__calendarRenderTxCalls.filter(call => call.type === 'update').find(call => call.payload?.draft?.date === '2026-05-26');
    host.querySelector('[data-type="calendar-mode"][data-mode="1"]').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    const weekMode = host.querySelector('.av__calendar')?.getAttribute('data-view-mode');
    const dialogCountBeforeSlot = globalThis.__calendarRenderDialogs.length;
    // Migrated from the 48-row slot grid: creating in empty space is now one
    // create surface per day column, and the minute comes from the pointer.
    const weekGrid = host.querySelector('.av__calendar-time-grid');
    const gridViewKind = weekGrid?.getAttribute('data-view-kind') || '';
    const gridDayCount = weekGrid?.getAttribute('data-day-count') || '';
    const gridSnapMinutes = weekGrid?.getAttribute('data-snap-minutes') || '';
    const gridHourHeight = parseFloat(weekGrid?.getAttribute('data-hour-height') || '0');
    // Sticky chrome: header, all-day lane and hour gutter must all stick inside
    // the one scroll container.
    const headerPosition = weekGrid ? getComputedStyle(weekGrid.querySelector('.av__calendar-grid-header')).position : '';
    const allDayPosition = weekGrid ? getComputedStyle(weekGrid.querySelector('.av__calendar-allday-row')).position : '';
    const gutterPosition = weekGrid ? getComputedStyle(weekGrid.querySelector('.av__calendar-time-gutter')).position : '';
    // A day header must sit exactly above its own column (the old two-grid
    // markup with an 8px gap could never do this).
    const headerRect = weekGrid?.querySelector('.av__calendar-day-header[data-day-index="2"]')?.getBoundingClientRect();
    const columnRect = weekGrid?.querySelector('.av__calendar-time-day[data-day-index="2"]')?.getBoundingClientRect();
    const headerAlignedToColumn = !!headerRect && !!columnRect &&
      Math.abs(headerRect.left - columnRect.left) < 1 && Math.abs(headerRect.width - columnRect.width) < 1;
    const createSurface = host.querySelector('[data-type="calendar-time-create"][data-date="2026-05-26"]');
    if (!createSurface) {
      const dates = Array.from(new Set(Array.from(host.querySelectorAll('[data-type="calendar-time-create"]')).map(s => s.getAttribute('data-date'))));
      throw new Error('week create surface missing; mode=' + (host.querySelector('.av__calendar')?.getAttribute('data-view-mode')) +
        ' surfaceDates=' + JSON.stringify(dates.slice(0, 10)) + ' surfaceCount=' + host.querySelectorAll('[data-type="calendar-time-create"]').length +
        ' fixtureViewMode=' + calendar.viewMode + ' datasetMode=' + host.dataset.calendarViewMode +
        ' modeButtons=' + host.querySelectorAll('[data-type="calendar-mode"]').length +
        ' txActions=' + JSON.stringify((globalThis.__calendarRenderTransactions || []).flatMap(item => (item.doOperations || []).map(op => op.action)).slice(-6)) +
        ' msgs=' + JSON.stringify((globalThis.__calendarRenderMessages || []).slice(-3)));
    }
    const createRect = createSurface.getBoundingClientRect();
    const createSurfaceHeight = createRect.height;
    // 09:00 is exactly 9 * hourHeight from the top of the column.
    const clickAtNineOClock = () => createSurface.dispatchEvent(new MouseEvent('click', {
      bubbles: true,
      cancelable: true,
      clientX: Math.round(createRect.left + 8),
      clientY: Math.round(createRect.top + 9 * gridHourHeight + 1),
    }));
    clickAtNineOClock();
    await new Promise(resolve => setTimeout(resolve, 100));
    const slotQuickTitle = host.querySelector('[data-type="calendar-quick-create-title"]');
    const slotQuickTitleFocused = document.activeElement === slotQuickTitle;
    const slotQuickTop = host.querySelector('.av__calendar-quick-create')?.style.getPropertyValue('--calendar-quick-create-top') || '';
    const slotQuickSummary = host.querySelector('[data-type="calendar-quick-create-summary"]')?.textContent || '';
    createSurface.dispatchEvent(new MouseEvent('dblclick', {bubbles: true, cancelable: true}));
    const slotDblclickDialogBlocked = globalThis.__calendarRenderDialogs.length === dialogCountBeforeSlot;
    slotQuickTitle.value = 'Quick slot smoke';
    host.querySelector('[data-type="calendar-quick-create-save"]').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    const slotCreateCall = globalThis.__calendarRenderTxCalls.filter(call => call.type === 'create-document').find(call => call.payload?.draft?.title === 'Quick slot smoke');
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
    const selectableCell = host.querySelector('.av__calendar-day[data-date="2026-05-27"]');
    selectableCell.dispatchEvent(new MouseEvent('click', {bubbles: true}));
    const selectedDateAfterClick = host.dataset.calendarDate || '';
    const selectedClassApplied = selectableCell.classList.contains('av__calendar-day--selected');
    const selectedJumpValue = host.querySelector('[data-type="calendar-jump-date"]')?.value || '';
    host.querySelector('[data-type="calendar-mode"][data-mode="2"]').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    // Day view is the same grid renderer with a one-day list; it identifies
    // itself with data-view-kind / data-first-date instead of .av__calendar-day-view.
    const selectedDayViewDate = host.querySelector('.av__calendar-time-grid[data-view-kind="day"]')?.getAttribute('data-first-date') || '';
    host.querySelector('[data-type="calendar-mode"][data-mode="0"]').click();
    await new Promise(resolve => setTimeout(resolve, 100));
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

    // Scoped direct edits on a generated occurrence (month view, anchor 2026-05-27).
    const occurrenceMonthCount = host.querySelectorAll('.av__calendar-event[data-occurrence^="row-recur2:"]').length;
    const occurrenceElement = host.querySelector('.av__calendar-event[data-occurrence="row-recur2:20260525"]');
    const occurrenceDate = occurrenceElement?.dataset.date || '';
    // Driven through the context menu now that the chip carries no inline
    // buttons; the recurrence-scope prompt must still appear and still produce
    // the same occurrence / this-and-future writes.
    globalThis.__calendarNextScope = 'occurrence';
    runChipMenuCommand('.av__calendar-event[data-occurrence="row-recur2:20260525"]', '[data-type="calendar-resize"][data-delta="15"]');
    await new Promise(resolve => setTimeout(resolve, 100));
    const occurrenceScopeCall = globalThis.__calendarRenderTxCalls.filter(call => call.type === 'replace-occurrence').at(-1);
    globalThis.__calendarNextScope = 'future';
    runChipMenuCommand('.av__calendar-event[data-occurrence="row-recur2:20260525"]', '[data-type="calendar-resize"][data-delta="15"]');
    await new Promise(resolve => setTimeout(resolve, 100));
    const futureScopeCall = globalThis.__calendarRenderTxCalls.filter(call => call.type === 'future').at(-1);
    globalThis.__calendarNextScope = 'series';

    // Overlapping timed events must split the day column while a lone timed
    // event keeps the full width (no inline width override).
    host.dataset.calendarDate = '2026-05-24';
    host.querySelector('[data-type="calendar-mode"][data-mode="2"]').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    const overlapDayViewDate = host.querySelector('.av__calendar-time-grid[data-view-kind="day"]')?.getAttribute('data-first-date') || '';
    if (!overlapDayViewDate) {
      throw new Error('day view missing after mode=2; renderedMode=' + host.querySelector('.av__calendar')?.getAttribute('data-view-mode') +
        ' datasetMode=' + host.dataset.calendarViewMode + ' fixtureMode=' + calendar.viewMode +
        ' anchor=' + host.dataset.calendarDate +
        ' calendarHTMLHead=' + (host.querySelector('.av__calendar')?.innerHTML || '').slice(0, 400));
    }
    // Migrated from inline width/marginLeft to inline left/width, and extended
    // with the pixel-exact top/height that the old 30-minute row grid could not
    // express. row-ov1 15:00-16:00 and row-ov2 15:30-16:30 overlap, so both keep
    // half the column; row-render 09:00-10:00 is alone and keeps all of it.
    const overlapFirst = host.querySelector('.av__calendar-event[data-id="row-ov1"]')?.closest('.av__calendar-timed-event');
    const overlapSecond = host.querySelector('.av__calendar-event[data-id="row-ov2"]')?.closest('.av__calendar-timed-event');
    const overlapFirstWidth = overlapFirst?.style.width || '';
    const overlapSecondWidth = overlapSecond?.style.width || '';
    const overlapFirstLeft = overlapFirst?.style.left || '';
    const overlapSecondLeft = overlapSecond?.style.left || '';
    const overlapFirstTop = overlapFirst?.style.top || '';
    const overlapFirstHeight = overlapFirst?.style.height || '';
    const overlapSecondTop = overlapSecond?.style.top || '';
    const overlapFirstStartMinute = overlapFirst?.getAttribute('data-start-minute') || '';
    const overlapSecondStartMinute = overlapSecond?.getAttribute('data-start-minute') || '';
    // Dragging an existing edge previews on the existing wrapper. It must not
    // paint a full-column ghost next to a half-column overlapping event.
    const overlapResizeHandle = overlapFirst?.querySelector('[data-type="calendar-resize-handle"][data-edge="end"]');
    const overlapResizeStyleBefore = overlapFirst?.getAttribute('style') || '';
    const overlapResizeRectBefore = overlapFirst?.getBoundingClientRect();
    if (overlapResizeHandle && overlapResizeRectBefore) {
      const handleRect = overlapResizeHandle.getBoundingClientRect();
      const pointerId = 91;
      overlapResizeHandle.dispatchEvent(new PointerEvent('pointerdown', {
        bubbles: true,
        cancelable: true,
        pointerId,
        button: 0,
        buttons: 1,
        clientX: handleRect.left + handleRect.width / 2,
        clientY: handleRect.top + handleRect.height / 2,
      }));
      document.dispatchEvent(new PointerEvent('pointermove', {
        bubbles: true,
        cancelable: true,
        pointerId,
        button: 0,
        buttons: 1,
        clientX: handleRect.left + handleRect.width / 2,
        clientY: handleRect.top + handleRect.height / 2 + gridHourHeight,
      }));
    }
    const overlapResizeRectDuring = overlapFirst?.getBoundingClientRect();
    const overlapResizeGhostCount = host.querySelectorAll('.av__calendar-ghost').length;
    const overlapResizeWidthDuring = overlapFirst?.style.width || '';
    const overlapResizeLeftDuring = overlapFirst?.style.left || '';
    document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true, cancelable: true}));
    const overlapResizeStyleAfterEscape = overlapFirst?.getAttribute('style') || '';
    // finishGesture swallows the synthetic click that follows a drag until the
    // next task. Let that guard expire before the fixture clicks another mode.
    await new Promise(resolve => setTimeout(resolve, 0));
    const nonOverlapWrapper = host.querySelector('.av__calendar-event[data-id="row-render"]')?.closest('.av__calendar-timed-event');
    const nonOverlapFound = !!nonOverlapWrapper;
    const nonOverlapWidth = nonOverlapWrapper?.style.width || '';
    const nonOverlapLeft = nonOverlapWrapper?.style.left || '';
    const nonOverlapTop = nonOverlapWrapper?.style.top || '';
    // All-day entries live in the sticky lane now, not in a per-day box.
    const allDayBarCount = host.querySelectorAll('.av__calendar-allday-bar').length;
    const allDayBarSpan = host.querySelector('.av__calendar-allday-bar')?.getAttribute('data-span-count') || '';

    // Month "+N" overflow chip peeks at the day locally (dataset override) and
    // must not persist the saved view mode.
    host.querySelector('[data-type="calendar-mode"][data-mode="0"]').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    const moreButton = host.querySelector('[data-type="calendar-more"][data-date="2026-05-24"]');
    const moreButtonText = moreButton?.textContent || '';
    moreButton?.click();
    await new Promise(resolve => setTimeout(resolve, 100));
    const moreLocalViewMode = host.dataset.calendarViewMode || '';
    const morePeekDayDate = host.querySelector('.av__calendar-time-grid[data-view-kind="day"]')?.getAttribute('data-first-date') || '';
    // Exiting the peek back to the persisted mode must clear the local
    // override without issuing any transaction (no av.json churn, no dead
    // undo step).
    const morePeekExitTransactionStart = globalThis.__calendarRenderTransactions.length;
    host.querySelector('[data-type="calendar-mode"][data-mode="0"]').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    const modeAfterMorePeek = host.querySelector('.av__calendar')?.getAttribute('data-view-mode') || '';
    const morePeekOverrideAfterExit = host.dataset.calendarViewMode || '';
    const morePeekExitActions = globalThis.__calendarRenderTransactions.slice(morePeekExitTransactionStart)
      .flatMap(item => (item.doOperations || []).map(op => op.action)).join(',');

    // --- mini month navigator -------------------------------------------------
    // Anchor is 2026-05-24 here (month view). The navigator draws a 6x7 matrix,
    // marks the anchor, dots the days that hold events, pages WITHOUT moving the
    // main view, and moves the main view only when a day is clicked.
    const miniMonthWrapper = host.querySelector('[data-type="calendar-mini-month-wrapper"]');
    if (!miniMonthWrapper) {
      throw new Error('mini month wrapper missing; calendar HTML head=' +
        (host.querySelector('.av__calendar')?.innerHTML || '').slice(0, 400));
    }
    const miniMonthDayCount = miniMonthWrapper.querySelectorAll('[data-type="calendar-mini-day"]').length;
    const miniMonthSelected = miniMonthWrapper.querySelector('.av__calendar-mini-day--selected')?.getAttribute('data-date') || '';
    const miniMonthEventDotCount = miniMonthWrapper.querySelectorAll('.av__calendar-mini-dot').length;
    const miniMonthTitleBeforePaging = miniMonthWrapper.querySelector('.av__calendar-mini-title')?.textContent || '';
    const miniMonthAnchorBeforePaging = host.dataset.calendarDate || '';
    miniMonthWrapper.querySelector('[data-type="calendar-mini-next"]').click();
    await new Promise(resolve => setTimeout(resolve, 50));
    const miniMonthPagedTitleChanged = (miniMonthWrapper.querySelector('.av__calendar-mini-title')?.textContent || '') !== miniMonthTitleBeforePaging;
    const miniMonthPagingLeftMainView = (host.dataset.calendarDate || '') === miniMonthAnchorBeforePaging;
    miniMonthWrapper.querySelector('[data-type="calendar-mini-prev"]').click();
    await new Promise(resolve => setTimeout(resolve, 50));
    miniMonthWrapper.querySelector('[data-type="calendar-mini-day"][data-date="2026-05-28"]').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    const miniMonthAnchorAfterClick = host.dataset.calendarDate || '';

    // --- key map --------------------------------------------------------------
    // The legacy keys and the Google keys both have to work, and they have to
    // keep working after something inside the calendar has been focused - the
    // focus-scope bug was exactly that a click killed every shortcut.
    const pressCalendarKey = async (key, targetSelector) => {
      const target = targetSelector ? host.querySelector(targetSelector) : host.querySelector('.av__calendar');
      if (!target) {
        throw new Error('keymap target missing: ' + targetSelector);
      }
      target.dispatchEvent(new KeyboardEvent('keydown', {key, bubbles: true}));
      await new Promise(resolve => setTimeout(resolve, 100));
      return host.querySelector('.av__calendar')?.getAttribute('data-view-mode') || '';
    };
    // Fired FROM a focused button on purpose: the old handler bailed on BUTTON,
    // and every control in this calendar is a button, so the shortcuts used to
    // die the moment anything was clicked.
    host.querySelector('[data-type="calendar-today"]').focus();
    const modeAfterKeyW = await pressCalendarKey('w', '[data-type="calendar-today"]');
    const modeAfterKeyD = await pressCalendarKey('d', '[data-type="calendar-today"]');
    const modeAfterKeyA = await pressCalendarKey('a');
    const modeAfterKeyM = await pressCalendarKey('m');
    const anchorBeforeKeyJ = host.dataset.calendarDate || '';
    await pressCalendarKey('j');
    const anchorAfterKeyJ = host.dataset.calendarDate || '';
    await pressCalendarKey('k');
    const anchorAfterKeyK = host.dataset.calendarDate || '';
    // A key typed into a text field belongs to the text field.
    const modeAfterKeyInSearch = await pressCalendarKey('d', '[data-type="calendar-search"]');
    // "/" focuses the search box.
    host.querySelector('.av__calendar').focus();
    await pressCalendarKey('/');
    const slashFocusedSearch = document.activeElement?.getAttribute('data-type') === 'calendar-search';
    host.querySelector('.av__calendar').focus();
    // "?" opens the shortcut sheet, and the sheet is generated from the same
    // table the resolver uses, so it can never advertise a key that does nothing.
    const dialogsBeforeHelp = document.querySelectorAll('.calendar-render-dialog-smoke').length;
    await pressCalendarKey('?');
    const helpDialog = Array.from(document.querySelectorAll('.calendar-render-dialog-smoke')).at(-1);
    const shortcutSheetRows = document.querySelectorAll('.calendar-render-dialog-smoke .av__calendar-shortcuts-row').length;
    const shortcutSheetCommands = Array.from(document.querySelectorAll('.calendar-render-dialog-smoke .av__calendar-shortcuts-row'))
      .map(row => row.getAttribute('data-command')).join(',');
    const shortcutSheetOpened = document.querySelectorAll('.calendar-render-dialog-smoke').length === dialogsBeforeHelp + 1;
    helpDialog?.remove();
    // The toolbar entry point for the same sheet.
    host.querySelector('[data-type="calendar-shortcuts"]').click();
    const shortcutButtonOpenedSheet = !!document.querySelector('.calendar-render-dialog-smoke .av__calendar-shortcuts');
    document.querySelectorAll('.calendar-render-dialog-smoke').forEach(node => node.remove());
    // Back to month view / the anchor the later steps expect.
    host.dataset.calendarDate = '2026-05-24';
    host.querySelector('[data-type="calendar-mode"][data-mode="0"]').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    const modeAfterKeymapChecks = host.querySelector('.av__calendar')?.getAttribute('data-view-mode') || '';

    // A multi-day all-day event must be ONE bar spanning its columns, not one
    // chip per day (the old markup gave every day header its own all-day box).
    const spanHost = document.createElement('div');
    spanHost.className = 'av';
    spanHost.setAttribute('data-av-id', ${JSON.stringify(fixture.avID)} + '-span');
    spanHost.setAttribute('data-node-id', ${JSON.stringify(fixture.blockID)} + '-span');
    spanHost.dataset.calendarDate = '2026-05-26';
    spanHost.innerHTML = '<div></div>';
    document.body.appendChild(spanHost);
    await renderModule.renderCalendar({
      protyle: {disabled: false, block: {action: []}, options: {}},
      blockElement: spanHost,
      renderAll: true,
      data: {
        view: {...calendar, viewMode: 1, cards: [card('row-span', 'Calendar span smoke event', '2026-05-26T00:00:00', '2026-05-28T00:00:00', '', '', true)]},
        viewID: ${JSON.stringify(fixture.viewID)} + '-span',
        viewType: 'calendar',
      },
    });
    const spanBars = spanHost.querySelectorAll('.av__calendar-allday-bar');
    const spanBar = spanHost.querySelector('.av__calendar-allday-bar[data-id="row-span"]');
    const spanBarCount = spanBars.length;
    const spanBarSpanCount = spanBar?.getAttribute('data-span-count') || '';
    const spanBarDayIndex = spanBar?.getAttribute('data-day-index') || '';
    const spanBarChipCount = spanHost.querySelectorAll('.av__calendar-event[data-id="row-span"]').length;
    // The fallback scroll: today is not in this range, so the grid lands on ~08:00.
    const spanGrid = spanHost.querySelector('.av__calendar-time-grid');
    const spanGridScrollTop = spanGrid?.scrollTop || 0;
    const spanGridHasNowLine = !!spanHost.querySelector('.av__calendar-now-indicator');

    // The now line: only on today's column, positioned from the real clock, and
    // its interval must not survive a re-render.
    const clockNow = new Date();
    const padTwo = (value) => String(value).padStart(2, '0');
    const todayKey = clockNow.getFullYear() + '-' + padTwo(clockNow.getMonth() + 1) + '-' + padTwo(clockNow.getDate());
    const todayHost = document.createElement('div');
    todayHost.className = 'av';
    todayHost.setAttribute('data-av-id', ${JSON.stringify(fixture.avID)} + '-today');
    todayHost.setAttribute('data-node-id', ${JSON.stringify(fixture.blockID)} + '-today');
    todayHost.dataset.calendarDate = todayKey;
    todayHost.innerHTML = '<div></div>';
    document.body.appendChild(todayHost);
    const renderToday = () => renderModule.renderCalendar({
      protyle: {disabled: false, block: {action: []}, options: {}},
      blockElement: todayHost,
      renderAll: true,
      data: {view: {...calendar, viewMode: 2, cards: []}, viewID: ${JSON.stringify(fixture.viewID)} + '-today', viewType: 'calendar'},
    });
    await renderToday();
    await renderToday();
    const nowIndicators = todayHost.querySelectorAll('.av__calendar-now-indicator');
    const nowIndicatorCount = nowIndicators.length;
    const nowIndicatorInTodayColumn = !!todayHost.querySelector('.av__calendar-time-day[data-date="' + todayKey + '"] .av__calendar-now-indicator');
    const nowIndicatorTop = parseFloat(nowIndicators[0]?.style.top || 'NaN');
    const expectedNowTop = ((clockNow.getHours() * 60 + clockNow.getMinutes()) / 60) * 48;
    const nowIndicatorAccurate = Number.isFinite(nowIndicatorTop) && Math.abs(nowIndicatorTop - expectedNowTop) <= 2;

    const readOnlyHost = document.createElement('div');
    readOnlyHost.className = 'av';
    readOnlyHost.setAttribute('data-av-id', ${JSON.stringify(fixture.avID)} + '-readonly');
    readOnlyHost.setAttribute('data-node-id', ${JSON.stringify(fixture.blockID)} + '-readonly');
    readOnlyHost.setAttribute('data-type', 'NodeBlockQueryEmbed');
    readOnlyHost.dataset.calendarDate = '2026-05-24';
    readOnlyHost.innerHTML = '<div></div>';
    document.body.appendChild(readOnlyHost);
    await renderModule.renderCalendar({
      protyle: {disabled: false, block: {action: []}, options: {}},
      blockElement: readOnlyHost,
      renderAll: true,
      data: {view: {...calendar, viewMode: 0}, viewID: ${JSON.stringify(fixture.viewID)} + '-readonly', viewType: 'calendar'},
    });
    const readOnlyEvent = readOnlyHost.querySelector('.av__calendar-event');
    const readOnlyNewButton = readOnlyHost.querySelector('[data-type="calendar-new"]:not(.av__calendar-daynum)');
    // A read-only / query-embed calendar gets no menu at all: it is the one
    // surface that could otherwise reach a write from a chip.
    readOnlyEvent?.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: 20, clientY: 20}));
    const readOnlyHasContextMenu = !!document.querySelector('.av__calendar-menu');
    document.querySelectorAll('.av__calendar-menu').forEach(node => node.remove());
    readOnlyHost.querySelector('[data-type="calendar-mode"][data-mode="2"]').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    const readOnlyLocalMode = readOnlyHost.dataset.calendarViewMode || '';
    const readOnlyRenderedMode = readOnlyHost.querySelector('.av__calendar')?.getAttribute('data-view-mode') || '';

    const setupHost = document.createElement('div');
    setupHost.className = 'av';
    setupHost.setAttribute('data-av-id', ${JSON.stringify(fixture.avID)} + '-setup');
    setupHost.setAttribute('data-node-id', ${JSON.stringify(fixture.blockID)} + '-setup');
    setupHost.innerHTML = '<div></div>';
    document.body.appendChild(setupHost);
    const setupTransactionStart = globalThis.__calendarRenderTransactions.length;
    await renderModule.renderCalendar({
      protyle: {disabled: false, block: {action: []}, options: {}},
      blockElement: setupHost,
      renderAll: true,
      data: {view: {...calendar, dateFieldID: '', cards: []}, viewID: ${JSON.stringify(fixture.viewID)} + '-setup', viewType: 'calendar'},
    });
    const setupSelect = setupHost.querySelector('[data-type="calendar-empty-date-field"]');
    setupSelect.value = 'date';
    setupSelect.dispatchEvent(new Event('change', {bubbles: true}));
    await new Promise(resolve => setTimeout(resolve, 100));
    const setupOperation = globalThis.__calendarRenderTransactions[setupTransactionStart]?.doOperations?.[0] || {};

    const createFieldHost = document.createElement('div');
    createFieldHost.className = 'av';
    createFieldHost.setAttribute('data-av-id', ${JSON.stringify(fixture.avID)} + '-create-field');
    createFieldHost.setAttribute('data-node-id', ${JSON.stringify(fixture.blockID)} + '-create-field');
    createFieldHost.innerHTML = '<div></div>';
    document.body.appendChild(createFieldHost);
    const createFieldTransactionStart = globalThis.__calendarRenderTransactions.length;
    await renderModule.renderCalendar({
      protyle: {disabled: false, block: {action: []}, options: {}},
      blockElement: createFieldHost,
      renderAll: true,
      data: {view: {...calendar, dateFieldID: '', fields: calendar.fields.filter(field => field.type !== 'date'), cards: []}, viewID: ${JSON.stringify(fixture.viewID)} + '-create-field', viewType: 'calendar'},
    });
    const createFieldHasButton = !!createFieldHost.querySelector('[data-type="calendar-create-date-field"]');
    createFieldHost.querySelector('[data-type="calendar-create-date-field"]').click();
    await new Promise(resolve => setTimeout(resolve, 100));
    const createFieldOperations = globalThis.__calendarRenderTransactions[createFieldTransactionStart]?.doOperations?.map(op => op.action) || [];

    // A configured calendar with zero cards must show the empty-state hint
    // (rendered on a fresh host so shared main-host state stays untouched).
    const emptyHost = document.createElement('div');
    emptyHost.className = 'av';
    emptyHost.setAttribute('data-av-id', ${JSON.stringify(fixture.avID)} + '-empty');
    emptyHost.setAttribute('data-node-id', ${JSON.stringify(fixture.blockID)} + '-empty');
    emptyHost.dataset.calendarDate = '2026-05-24';
    emptyHost.innerHTML = '<div></div>';
    document.body.appendChild(emptyHost);
    await renderModule.renderCalendar({
      protyle: {disabled: false, block: {action: []}, options: {}},
      blockElement: emptyHost,
      renderAll: true,
      data: {view: {...calendar, cards: []}, viewID: ${JSON.stringify(fixture.viewID)} + '-empty', viewType: 'calendar'},
    });
    const emptyHintExists = !!emptyHost.querySelector('.av__calendar-empty-hint');
    const emptyHintEventCount = emptyHost.querySelectorAll('.av__calendar-event').length;

    // Events exist in the database but none fall in the visible range: the
    // create hint must stay hidden (distinguishes the baseEventsByID gate
    // from the old rendered-count gate).
    const offRangeHost = document.createElement('div');
    offRangeHost.className = 'av';
    offRangeHost.setAttribute('data-av-id', ${JSON.stringify(fixture.avID)} + '-offrange');
    offRangeHost.setAttribute('data-node-id', ${JSON.stringify(fixture.blockID)} + '-offrange');
    offRangeHost.dataset.calendarDate = '2026-02-15';
    offRangeHost.innerHTML = '<div></div>';
    document.body.appendChild(offRangeHost);
    await renderModule.renderCalendar({
      protyle: {disabled: false, block: {action: []}, options: {}},
      blockElement: offRangeHost,
      renderAll: true,
      data: {view: {...calendar}, viewID: ${JSON.stringify(fixture.viewID)} + '-offrange', viewType: 'calendar'},
    });
    const offRangeHintExists = !!offRangeHost.querySelector('.av__calendar-empty-hint');
    const offRangeEventCount = offRangeHost.querySelectorAll('.av__calendar-event').length;

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
      toolbarQuickTitleFocused,
      toolbarQuickAllDay,
      dayQuickSummary,
      dayQuickAllDay,
      dialogDates: globalThis.__calendarRenderDialogs.map(item => item.date),
      toolbarNewDate: toolbarNewDialog?.date || '',
      dayNewDate: dayNewDialog?.date || '',
      editDialogEventID: editDialog?.event?.id || '',
      boundClickOpenedPage,
      boundClickOpenedDialog,
      detachedDialogEventID: detachedDialog?.event?.id || '',
      detachedClickOpenedDialog,
      detachedClickOpenedPage,
      detachedHasSourceAffordance,
      chipMenuOpened,
      chipKeyboardMenuOpened,
      chipMenuItemTypes,
      chipMenuClosedAfterCommand,
      chipMenuDialogEventID,
      chipInlineButtonCount: host.querySelectorAll('.av__calendar-event [data-type="calendar-resize"], .av__calendar-event [data-type="calendar-duplicate-next-day"]').length,
      chipDotCount: host.querySelectorAll('.av__calendar-event .av__calendar-event-dot').length,
      duplicateDraft: duplicateCall?.payload?.draft,
      duplicateTemplateID: duplicateCall?.payload?.templateID || '',
      resizeDraft: resizeCall?.payload?.draft,
      shiftDraft: shiftCall?.payload?.draft,
      menuDeleteEventID: menuDeleteCall?.payload?.event?.id || '',
      dragDraft: dragUpdateCall?.payload?.draft,
      persistedModeOperation: globalThis.__calendarRenderTransactions[0]?.doOperations?.[0]?.action || '',
      weekMode,
      slotQuickTitleFocused,
      slotQuickTop,
      scopeDialogActions: (globalThis.__calendarRenderScopeDialogs || []).map(item => item.action).join(','),
      scopeDialogDisabled: (globalThis.__calendarRenderScopeDialogs || []).map(item => (item.disabled?.occurrence ? '1' : '0') + (item.disabled?.future ? '1' : '0')).join(','),
      occurrenceMonthCount,
      occurrenceDate,
      occurrenceScopeDate: occurrenceScopeCall?.payload?.occurrenceDate || '',
      occurrenceScopeEndTime: occurrenceScopeCall?.payload?.draft?.endTime || '',
      futureScopeDate: futureScopeCall?.payload?.occurrenceDate || '',
      futureScopeEndTime: futureScopeCall?.payload?.draft?.endTime || '',
      overlapDayViewDate,
      overlapFirstWidth,
      overlapSecondWidth,
      overlapFirstLeft,
      overlapSecondLeft,
      overlapFirstTop,
      overlapFirstHeight,
      overlapSecondTop,
      overlapFirstStartMinute,
      overlapSecondStartMinute,
      overlapResizeGhostCount,
      overlapResizeHeightBefore: overlapResizeRectBefore?.height || 0,
      overlapResizeHeightDuring: overlapResizeRectDuring?.height || 0,
      overlapResizeWidthDuring,
      overlapResizeLeftDuring,
      overlapResizeStyleRestored: overlapResizeStyleAfterEscape === overlapResizeStyleBefore,
      nonOverlapFound,
      nonOverlapWidth,
      nonOverlapLeft,
      nonOverlapTop,
      allDayBarCount,
      allDayBarSpan,
      gridViewKind,
      gridDayCount,
      gridSnapMinutes,
      gridHourHeight,
      headerPosition,
      allDayPosition,
      gutterPosition,
      headerAlignedToColumn,
      createSurfaceHeight,
      slotQuickSummary,
      spanBarCount,
      spanBarSpanCount,
      spanBarDayIndex,
      spanBarChipCount,
      spanGridScrollTop,
      spanGridHasNowLine,
      nowIndicatorCount,
      nowIndicatorInTodayColumn,
      nowIndicatorAccurate,
      moreButtonText,
      moreLocalViewMode,
      morePeekDayDate,
      modeAfterMorePeek,
      morePeekOverrideAfterExit,
      morePeekExitActions,
      emptyHintExists,
      emptyHintEventCount,
      offRangeHintExists,
      offRangeEventCount,
      slotDblclickDialogBlocked,
      slotCreateDraft: slotCreateCall?.payload?.draft,
      slotCreateTemplateID: slotCreateCall?.payload?.templateID || '',
      dayMode,
      scheduleMode,
      modeAfterKeyboard,
      selectedDateAfterClick,
      selectedClassApplied,
      selectedJumpValue,
      selectedDayViewDate,
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
      readOnlyHasContextMenu,
      miniMonthDayCount,
      miniMonthSelected,
      miniMonthEventDotCount,
      miniMonthAnchorAfterClick,
      miniMonthPagedTitleChanged,
      miniMonthPagingLeftMainView,
      readOnlyMiniMonthDayCount: readOnlyHost.querySelectorAll('[data-type="calendar-mini-day"]').length,
      shortcutSheetRows,
      shortcutSheetCommands,
      shortcutSheetOpened,
      shortcutButtonOpenedSheet,
      modeAfterKeyW,
      modeAfterKeyD,
      modeAfterKeyA,
      modeAfterKeyM,
      anchorBeforeKeyJ,
      anchorAfterKeyJ,
      anchorAfterKeyK,
      modeAfterKeyInSearch,
      slashFocusedSearch,
      modeAfterKeymapChecks,
      setupHasSelect: !!setupSelect,
      setupOperationAction: setupOperation.action || '',
      setupOperationData: setupOperation.data || '',
      createFieldHasButton,
      createFieldOperations,
      harnessRejections: (globalThis.__calendarRenderRejections || []).join(' ;; '),
    };
  })()`);
  if (!result?.hasCalendar || result.modeCount !== 4 || !result.hasSummary || !result.hasSearch ||
    !result.hasJumpDate || !result.eventText.includes("Calendar UI render smoke event") ||
    !result.eventText.includes("Calendar none smoke event") || result.recurringCount < 1 ||
    !result.tooltip.includes("Render Room") || !result.toolbarQuickTitleFocused || !result.toolbarQuickAllDay ||
    !result.dayQuickAllDay || result.dayQuickSummary !== "2026-05-26" ||
    result.toolbarNewDate !== "2026-05-24" ||
    result.dayNewDate !== "2026-05-26" || result.editDialogEventID !== "row-render" ||
    !result.boundClickOpenedPage || result.boundClickOpenedDialog ||
    result.detachedDialogEventID !== "row-detached" || !result.detachedClickOpenedDialog ||
    result.detachedClickOpenedPage || result.detachedHasSourceAffordance ||
    result.duplicateDraft?.date !== "2026-05-25" || result.duplicateDraft?.recurrenceRaw !== "" || result.duplicateTemplateID !== "template-smoke" ||
    result.resizeDraft?.endTime !== "10:15" || result.persistedModeOperation !== "setAttrViewCalendarViewMode" ||
    // The chip is quiet; the menu carries the actions it used to carry inline.
    !result.chipMenuOpened || !result.chipKeyboardMenuOpened || !result.chipMenuClosedAfterCommand ||
    result.chipMenuDialogEventID !== "row-render" ||
    result.chipInlineButtonCount !== 0 || result.chipDotCount < 1 ||
    result.chipMenuItemTypes !== "calendar-open-source,calendar-open-dialog,calendar-duplicate-next-day,calendar-resize,calendar-resize,calendar-shift,calendar-shift,calendar-shift,calendar-shift,calendar-delete" ||
    result.shiftDraft?.startTime !== "11:15" || result.shiftDraft?.endTime !== "12:15" ||
    result.shiftDraft?.date !== "2026-05-25" ||
    result.menuDeleteEventID !== "row-detached" ||
    result.dragDraft?.date !== "2026-05-26" || result.dragDraft?.title !== "Calendar none smoke event" ||
    result.weekMode !== "1" || !result.slotQuickTitleFocused ||
    // pixel-exact popover anchor: 09:00 is 9 * 48px down the column
    result.slotQuickTop !== "432px" ||
    result.scopeDialogActions !== "resize,resize,resize" ||
    result.scopeDialogDisabled !== "11,00,00" ||
    result.occurrenceMonthCount < 1 || result.occurrenceDate !== "2026-05-25" ||
    result.occurrenceScopeDate !== "2026-05-25" || result.occurrenceScopeEndTime !== "14:15" ||
    result.futureScopeDate !== "2026-05-25" || result.futureScopeEndTime !== "14:15" ||
    result.overlapDayViewDate !== "2026-05-24" ||
    result.overlapFirstWidth !== "50%" || result.overlapSecondWidth !== "50%" ||
    result.overlapFirstLeft !== "0%" || result.overlapSecondLeft !== "50%" ||
    // pixel-exact: 15:00 -> 900min -> 720px, one hour -> 48px, 15:30 -> 744px
    result.overlapFirstTop !== "720px" || result.overlapFirstHeight !== "48px" ||
    result.overlapSecondTop !== "744px" ||
    result.overlapFirstStartMinute !== "900" || result.overlapSecondStartMinute !== "930" ||
    result.overlapResizeGhostCount !== 0 ||
    result.overlapResizeHeightDuring <= result.overlapResizeHeightBefore ||
    result.overlapResizeWidthDuring !== "50%" || result.overlapResizeLeftDuring !== "0%" ||
    !result.overlapResizeStyleRestored ||
    !result.nonOverlapFound || result.nonOverlapWidth !== "100%" ||
    result.nonOverlapLeft !== "0%" || result.nonOverlapTop !== "432px" ||
    result.allDayBarCount !== 2 || result.allDayBarSpan !== "1" ||
    result.gridViewKind !== "week" || result.gridDayCount !== "7" ||
    result.gridSnapMinutes !== "15" || result.gridHourHeight !== 48 ||
    result.headerPosition !== "sticky" || result.allDayPosition !== "sticky" ||
    result.gutterPosition !== "sticky" || !result.headerAlignedToColumn ||
    result.createSurfaceHeight !== 1152 ||
    result.slotQuickSummary !== "2026-05-26 09:00 - 09:30" ||
    result.spanBarCount !== 1 || result.spanBarSpanCount !== "3" ||
    result.spanBarDayIndex !== "2" || result.spanBarChipCount !== 1 ||
    result.spanGridScrollTop <= 0 || result.spanGridScrollTop > 384 ||
    result.spanGridHasNowLine ||
    result.nowIndicatorCount !== 1 || !result.nowIndicatorInTodayColumn ||
    !result.nowIndicatorAccurate ||
    result.moreButtonText !== "+3" || result.moreLocalViewMode !== "2" ||
    result.morePeekDayDate !== "2026-05-24" || result.modeAfterMorePeek !== "0" ||
    result.morePeekOverrideAfterExit !== "" || result.morePeekExitActions !== "" ||
    !result.emptyHintExists || result.emptyHintEventCount !== 0 ||
    result.offRangeHintExists || result.offRangeEventCount !== 0 ||
    !result.slotDblclickDialogBlocked || result.slotCreateDraft?.date !== "2026-05-26" ||
    result.slotCreateDraft?.startTime !== "09:00" || result.slotCreateDraft?.endTime !== "09:30" ||
    result.slotCreateDraft?.isAllDay !== false || result.slotCreateTemplateID !== "template-smoke" ||
    result.dayMode !== "2" ||
    result.scheduleMode !== "3" || result.modeAfterKeyboard !== "0" ||
    result.selectedDateAfterClick !== "2026-05-27" || !result.selectedClassApplied ||
    result.selectedJumpValue !== "2026-05-27" || result.selectedDayViewDate !== "2026-05-27" ||
    result.anchorAfterPrevEvent !== "2026-05-24" || result.anchorAfterNextEvent !== "2026-05-25" ||
    !result.filteredEventText.includes("Calendar none smoke event") ||
    result.filteredEventText.includes("Calendar UI render smoke event") ||
    result.searchState !== "none" || result.searchAfterClear || result.filterAfterClear ||
    !result.readOnlyHasEvent || result.readOnlyDraggable !== "false" || result.readOnlyHasNewButton ||
    result.readOnlyLocalMode !== "2" || result.readOnlyRenderedMode !== "2" ||
    result.readOnlyHasContextMenu ||
    // Mini month: a full 6x7 matrix, the anchor marked, dots where events are,
    // paging that leaves the main view alone, and a click that moves it.
    result.miniMonthDayCount !== 42 || result.miniMonthSelected !== "2026-05-24" ||
    result.miniMonthEventDotCount < 1 || !result.miniMonthPagedTitleChanged ||
    !result.miniMonthPagingLeftMainView || result.miniMonthAnchorAfterClick !== "2026-05-28" ||
    result.readOnlyMiniMonthDayCount !== 42 ||
    // Google's keys, from a focused BUTTON (the focus-scope bug), plus the
    // guarantee that typing into the search box is still typing.
    result.modeAfterKeyW !== "1" || result.modeAfterKeyD !== "2" ||
    result.modeAfterKeyA !== "3" || result.modeAfterKeyM !== "0" ||
    result.anchorBeforeKeyJ !== "2026-05-28" || result.anchorAfterKeyJ !== "2026-06-28" ||
    result.anchorAfterKeyK !== "2026-05-28" || result.modeAfterKeyInSearch !== "0" ||
    !result.slashFocusedSearch || result.modeAfterKeymapChecks !== "0" ||
    !result.shortcutSheetOpened || !result.shortcutButtonOpenedSheet ||
    result.shortcutSheetRows !== 13 ||
    result.shortcutSheetCommands !== "view-day,view-week,view-month,view-schedule,next-range,prev-range,today,next-event,prev-event,create,search,help,escape" ||
    !result.setupHasSelect || result.setupOperationAction !== "setAttrViewCalendarDateField" ||
    result.setupOperationData !== "date" || !result.createFieldHasButton ||
    result.createFieldOperations.join(",") !== "addAttrViewCol,setAttrViewCalendarDateField" ||
    result.harnessRejections !== "") {
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
  // A real (non-symlink) stage/build/app left over from `pnpm run build:app`
  // silently shadows the desktop build this smoke was told to verify: the app
  // shell then loads a stale base.css, and every assertion about computed style
  // quietly measures last week's stylesheet. Fail loudly instead.
  if (hadAppBuildDir && !fs.lstatSync(appBuildDir).isSymbolicLink()) {
    const appIndex = path.join(appBuildDir, "index.html");
    const desktopIndex = path.join(desktopBuildDir, "index.html");
    if (fs.existsSync(desktopIndex) &&
      (!fs.existsSync(appIndex) || fs.statSync(appIndex).mtimeMs < fs.statSync(desktopIndex).mtimeMs)) {
      fail(`${appBuildDir} is older than the desktop build and would shadow it; run "cd app && corepack pnpm run build:app" or delete app/stage/build/app`);
    }
  }
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
      "serve",
      "--port", String(kernelPort),
      "--wd", appDir,
      "--workspace", workspace,
      "--mode", "dev",
      "--lang", "zh-TW",
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
