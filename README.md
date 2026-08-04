# SiYuan with Attribute View (Database) Calendar

**This is a personal fork of [SiYuan](https://github.com/siyuan-note/siyuan) — not the official release.** It adds a calendar to the Attribute View (Database). The calendar lives inside an Attribute View (Database) block and offers month, week, multi-day, day and agenda layouts, with all-day and timed events, recurrence, drag and resize, search and filter, keyboard navigation, mobile touch, a Calendar dock, ICS import and 21 locales.

## Differences from upstream / 與上游的差異

This personal fork (hosted as `eloklam/eloklam-siyuan`) tracks upstream `master`/`dev` and adds the following on top:

- **Attribute View Calendar** — a calendar view for Attribute View (Database) blocks: month / week / multi-day / day / agenda layouts, all-day and timed events, drag & resize, recurrence, an event editor, source navigation, and a global Calendar sidebar (dock). This work was proposed upstream but was **not accepted**, so it exists only in this personal fork.
- **Daily note target database** — a new per-notebook setting `dailyNoteDatabaseID`. When a new daily note is created, it is automatically added as a row to the configured target database (Attribute View); the notebook settings dialog gains a database block picker. The insertion is idempotent and best-effort — it never fails daily note creation. This feature is also prepared as a standalone upstream PR branch (`feat/daily-note-db-add`, not pushed yet).
- **Local dev convenience** — Electron dev mode honors an explicit `--port` argument, so a second instance can run alongside the official app without port conflicts.

中文简介：这是 SiYuan 的**个人 fork**，并非官方版本，托管于 `eloklam/eloklam-siyuan`。主要差异：1) **属性视图日历**——月/周/多日/日/议程布局、全天与定时事件、拖拽调整、重复事件、事件编辑器、来源导航、全局日历侧栏；该工作曾向上游提议但未被接受，仅存在于本 fork。2) **日记目标数据库**——新增笔记本级设置 `dailyNoteDatabaseID`，新建日记时自动作为行添加到配置的数据库（属性视图），笔记本设置中通过块选择器选择；幂等且尽力而为，绝不影响日记创建；已整理为独立上游 PR 分支 `feat/daily-note-db-add`，尚未推送。3) **本地开发便利**——Electron 开发模式支持显式 `--port`，可与官方应用并存运行。

![Calendar month view with the Schedule dock](screenshots/calendar-view.png)

## Design

Attribute View (Database) rows and properties remain the source of truth. The calendar reads and writes the same rows through the Attribute View (Database) transaction API, and no separate calendar database is created. Closing and reopening the block renders the same events from the same rows.

## Features

- Month, week, multi-day, day and agenda views
- All-day and timed events
- Recurring events
- Drag and resize
- Search and filter
- Keyboard navigation
- Mobile touch support
- Calendar dock for a persistent schedule view
- ICS import
- 21 locales

## How to try

The calendar work lives on the `feat/av-calendar` branch and is also merged into `master` here. Run it from source:

```bash
git clone https://github.com/eloklam/eloklam-siyuan.git
cd eloklam-siyuan
git checkout feat/av-calendar

# terminal 1: build and start the kernel
cd kernel
go build -tags "fts5 sqlcipher" -o ../app/kernel/SiYuan-Kernel .
cd ..
./app/kernel/SiYuan-Kernel serve --mode dev --port 6806 --workspace /path/to/a-test-workspace

# terminal 2: build the UI and start Electron
cd app
pnpm run dev:desktop
pnpm start
```

Use a test workspace, never your real notes. `pnpm start` in development mode connects to the kernel on port 6806 instead of spawning its own.

## Status

The calendar was built mainly through AI-assisted vibe coding. Quality and compatibility with upstream cannot be guaranteed, and there is no promise of maintenance or restructuring. It exists because a calendar inside the Attribute View (Database) was wanted; the upstream feature request that started it is [siyuan-note/siyuan#13740](https://github.com/siyuan-note/siyuan/issues/13740).

License: AGPL-3.0, same as upstream.

## 中文简介

这是 SiYuan 的一个 fork，在属性视图（Attribute View (Database)）中加入日历视图：月、周、多日、日、议程五种布局，支持全天与定时事件、重复事件、拖拽调整、搜索过滤、键盘操作、移动端触摸、日历停靠面板、ICS 导入和 21 种语言。核心设计是属性视图的行和属性仍然是唯一数据源，日历不创建独立数据库。

试用：检出 `feat/av-calendar` 分支，按上方英文说明从源码启动内核和前端，先构建内核，再运行 `pnpm run dev:desktop` 和 `pnpm start`。测试时请使用测试工作空间，不要使用真实笔记库。

注意：日历主要靠 AI 辅助编程完成，质量与上游兼容性无法保证，也不承诺后续维护。上游功能请求见 https://github.com/siyuan-note/siyuan/issues/13740 ，上游仓库见 https://github.com/siyuan-note/siyuan 。
