# SiYuan Calendar Claude 合流與原子更新修正計劃

日期：2026-07-27

工作樹：`/home/eloklam/orca/workspaces/SiYuan-Calender-next/siyuan-claude-merge`

分支：`eloklam/siyuan-claude-merge`

基線：`calendar-production`，提交 `b50c87f4552df26abaeac10269363869cdee6f0f`

## 1. 規格

### 目標

建立一個可審查、可回復、可驗證的 SiYuan Calendar 候選版本：

1. 保留復原分支已證明可靠的資料安全、重複事件、唯讀保護與來源項目行為。
2. 保留 Claude 候選版本的新時間格、拖動、縮放、小月曆、鍵盤操作、右鍵選單、頁面式項目與新版 SiYuan 相容性。
3. 徹底消除「文件名稱已改，但日曆欄位更新失敗」的部分成功狀態。
4. 令頁面式日曆在建立、複製、單次事件替代及「此次及未來」拆分路徑中保持一致。
5. 把昨日尚未提交的候選檔案完整納入 Git，移除臨時測試產物，更新交接文件。

### 現況

- `recover/calendar-view-from-recovery` 是 `calendar-production` 的祖先，沒有任何獨有提交需要合併。
- 所謂「合併兩者優點」不是執行 Git 合併，而是以復原分支作安全契約，以 `calendar-production` 作唯一程式碼主線。
- Claude 候選工作目錄共有 41 個修改或未追蹤路徑，其中 11 個日曆核心模組尚未被 Git 追蹤。
- `updateCalendarEvent()` 目前先呼叫 `/api/filetree/renameDocByID`，再提交 AV 欄位交易。第二步失敗時，文件名稱不會回復。
- 現有測試只證明「重新命名失敗時不寫欄位」，沒有證明「欄位交易失敗時文件名稱不變」。

### 必須維持的不變條件

1. 綁定文件的日曆事件更新必須是全有或全無。
2. 任何失敗、程序終止或重試都不得留下新名稱配舊日期，或舊名稱配新日期。
3. 成功更新只能產生一個可撤銷單位。一次復原必須同時復原文件名稱及 AV 欄位。
4. 失敗更新不得加入復原堆疊。
5. 事件頁面的來源文件識別碼不得改變。
6. 游離資料列沿用原有 `updateAttrViewCell` 路徑，不因本修正而被轉成文件。
7. 頁面式日曆的所有新項目路徑都必須建立真正文件。只有明確設定為資料列模式或文件筆記本不可用時，才可回退為游離資料列，並向使用者顯示原因。
8. 不得讀取或修改 `/home/eloklam/SiYuan` 真實筆記庫。
9. 所有整合測試只可使用 `/tmp` 下的隔離工作空間。
10. 未獲明確批准，不得合併、推送或部署。

### 非目標

- 不重新設計整個 SiYuan 交易引擎。
- 不把 Calendar 變成獨立應用程式。
- 不刪除復原分支或原有復原工作樹。
- 不在此輪加入自然語言日期、匯出、每日筆記或大型資料庫虛擬化。
- 不以「重新命名失敗後再改回去」作最終方案。補償式回復只能作過渡防線，不能滿足程序崩潰下的原子性要求。

## 2. 合流策略

### 正式來源

- 程式碼主線：`calendar-production` 加上昨日尚未提交的 41 個路徑。
- 安全契約來源：`recover/calendar-view-from-recovery`。
- 新整合工作樹：`siyuan-claude-merge`。

### 保留復原分支的優點

從復原分支保留並重新驗證以下契約，而不是重新複製舊程式碼：

- 唯讀及查詢嵌入不允許寫入。
- 重複事件刪除及編輯必須選擇作用範圍。
- 游離資料列的建立、更新、刪除及復原仍可運作。
- 來源區塊或文件可被開啟。
- 失敗操作有明確回饋，不得假報成功。
- 所有資料操作有可重播的測試。

### 保留 Claude 候選版本的優點

- SiYuan v3.7.3 基線。
- 精確時間幾何及十五分鐘吸附。
- 重疊事件欄位排版。
- 掃動建立、拖動及雙邊縮放。
- 小月曆、目前時間線、鍵盤快捷鍵及右鍵選單。
- 頁面式項目及新項目模板整合。
- 21 種語言。
- Electron 真實桌面流程驗證。

## 3. 原子更新設計

### 問題根源

目前綁定文件事件的更新跨越兩個獨立請求：

1. `/api/filetree/renameDocByID`
2. `/api/transactions`

第一個請求成功後，第二個請求仍可能因無效欄位、遺失資料列、寫入錯誤、程序終止或核心錯誤而失敗。兩個 HTTP 請求無法提供原子性。

### 最終設計

新增一個通用的 AV 綁定項目更新能力，讓文件主鍵及 AV 欄位在核心內由同一筆 `Transaction` 提交。

建議介面：

```text
POST /api/av/updateAttributeViewItem
```

建議輸入：

```json
{
  "avID": "...",
  "blockID": "...",
  "viewID": "...",
  "itemID": "...",
  "primaryKey": "新文件名稱",
  "fieldValues": {
    "date-field-id": {},
    "location-field-id": {},
    "description-field-id": {},
    "color-field-id": {}
  },
  "app": "...",
  "session": "..."
}
```

建議輸出：

```json
{
  "itemID": "...",
  "blockID": "綁定文件識別碼",
  "content": "核心實際保存的規範化名稱"
}
```

### 核心交易要求

新增內部文件重新命名操作，例如 `renameDocByID`，但不得直接呼叫目前會即時寫入及發送事件的 `RenameDoc()`。

核心實作須把現有重新命名流程拆成兩部分：

1. **準備階段**
   - 載入並驗證 AV、檢視、項目、綁定文件及全部欄位值。
   - 規範化文件名稱並檢查長度。
   - 在 `Transaction` 所管理的樹副本上修改 `title`、`updated` 及 `HPath`。
   - 準備受影響子文件路徑及 AV 欄位操作。
   - 準備對應的 `UndoOperations`，包含舊文件名稱及舊欄位值。
   - 此階段不得寫磁碟、發送事件或更新索引。

2. **提交階段**
   - 文件樹修改與 AV 欄位修改由同一筆 `Transaction` 提交。
   - 任一操作失敗時使用交易本身的 `rollback()`，不得依靠第二次 HTTP 請求補救。
   - 只有提交成功後才發送重新命名事件、更新引用文字、排程子文件 SQL 路徑更新及加入復原記錄。

### 前端路由

`app/src/protyle/render/av/calendar/transactions.ts`：

- 游離項目繼續使用 `executeCalendarOperations()`。
- 綁定文件項目改用 `/api/av/updateAttributeViewItem`。
- 不再從 `updateCalendarEvent()` 直接呼叫 `/api/filetree/renameDocByID`。
- 前端只在核心回傳成功後報告成功及重新繪製。
- 核心回傳失敗時，前端保持原有畫面並顯示錯誤，不註冊復原步驟。

## 4. 測試先行工作單

每個工作單採一個失敗測試、一個最小修正的垂直循環。高風險原子性修正不得先寫實作再補測試。

### 工作單 A：凍結候選內容

涉及路徑：

- `app/src/protyle/render/av/calendar/*.ts`
- `app/src/assets/scss/business/_av.scss`
- `app/appearance/langs/*.json`
- `scripts/calendar-*.mjs`

步驟：

1. 核對新工作樹與 Claude 原工作樹的已追蹤差異內容完全一致。
2. 核對 11 個未追蹤模組的 SHA-256 完全一致。
3. 把 11 個模組納入 Git，但不要把任何建置輸出加入 Git。
4. 記錄候選檔案清單，避免後續整理時漏掉模組。

完成標準：

- 新工作樹可在不依賴另一工作樹檔案的情況下完成類型檢查及建置。
- `git status` 不再顯示日曆核心原始碼為未追蹤。

### 工作單 B：建立原子性失敗測試

涉及路徑：

- `scripts/calendar-transactions-smoke.mjs`
- `scripts/calendar-backend-contract-smoke.mjs`
- `kernel/model/attribute_view_calendar_test.go`
- 建議新增 `kernel/model/attribute_view_update_item_test.go`

第一個失敗測試：

1. 建立綁定真實文件的日曆項目，名稱為 `Old title`。
2. 請求同時改為 `New title` 及新日期。
3. 在 AV 欄位更新階段注入確定失敗。
4. 驗證 API 回傳失敗。
5. 重新讀取文件，名稱仍為 `Old title`。
6. 重新讀取 AV，日期及其他欄位保持舊值。
7. 驗證沒有新增復原記錄及沒有重新命名廣播。

第二個失敗測試：

1. 注入文件重新命名驗證失敗。
2. 驗證任何 AV 欄位都沒有更新。

第三個測試：

1. 成功同時更新名稱及欄位。
2. 執行一次復原。
3. 驗證名稱及全部欄位一併復原。
4. 執行一次重做。
5. 驗證名稱及全部欄位一併恢復。

第四個測試：

- 在提交前注入恐慌或錯誤，驗證交易回復，不留下磁碟部分狀態。

完成標準：

- 第一個測試在現有程式碼上必須失敗，證明測試能捕捉已知缺陷。
- 實作完成後四類測試全數通過。

### 工作單 C：核心原子更新

涉及路徑：

- `kernel/api/router.go`
- `kernel/api/av.go`
- 建議新增 `kernel/model/attribute_view_update_item.go`
- `kernel/model/transaction.go`
- `kernel/model/file.go`
- `kernel/av/new_item_template.go` 或相關欄位驗證模組

步驟：

1. 新增 `updateAttributeViewItem` API。
2. 重用 `resolveCallerItemFieldValues()` 驗證欄位值。
3. 驗證 `itemID` 確實屬於指定 AV，並取得綁定文件識別碼。
4. 把文件名稱變更做成交易內操作。
5. 把欄位值變更加入同一筆交易。
6. 建立完整反向操作。
7. 把重新命名廣播、引用文字更新及子文件索引更新延後至成功提交後。
8. 確保交易回復時不發送任何成功事件。
9. 確保同一文件及 AV 的並行更新經既有鎖序列化，避免交錯提交。

完成標準：

- 不存在先重新命名再提交 AV 的前端流程。
- 不存在失敗後以第二個網絡請求改回名稱的最終實作。
- 注入任何單點失敗後，文件與 AV 均保持原狀。

### 工作單 D：前端採用原子 API

涉及路徑：

- `app/src/protyle/render/av/calendar/transactions.ts`
- `app/src/protyle/render/av/calendar/event-dialog.ts`
- `app/src/protyle/render/av/calendar/render.ts`
- `app/src/types/index.d.ts`

步驟：

1. 新增 `updateCalendarBoundEvent()`，呼叫核心原子 API。
2. `updateCalendarEvent()` 根據 `getEventDocumentID()` 分流。
3. 綁定項目把名稱及全部待更新欄位一次送入核心。
4. 游離項目保留現有交易路徑。
5. 移除綁定項目更新中的獨立 `renameCalendarEventDocument()` 呼叫。
6. 保留獨立「刪除頁面」的明確確認流程，因為刪除文件不可由日曆復原堆疊安全恢復。

完成標準：

- 前端測試證明綁定更新只有一個核心寫入請求。
- API 失敗時沒有第二次補償請求，亦沒有部分成功訊息。

### 工作單 E：頁面式項目一致性

涉及路徑：

- `app/src/protyle/render/av/calendar/render.ts`
- `app/src/protyle/render/av/calendar/event-dialog.ts`
- `app/src/protyle/render/av/calendar/transactions.ts`
- `scripts/calendar-transactions-smoke.mjs`
- `scripts/calendar-electron-launch-smoke.mjs`

修正項目：

1. `duplicateEventToNextDay()` 必須按 `createsDocuments` 選擇文件建立或資料列建立。
2. 拖動或縮放重複事件時，把 `createAsDocument`、`viewID` 及 `templateID` 傳入單次替代及「此次及未來」拆分路徑。
3. 所有頁面式建立路徑都驗證回傳的 `blockID` 可開啟。
4. 筆記本不可用時才允許明確回退為游離資料列，並顯示原因。

完成標準：

- 工具列建立、時間格建立、完整對話框建立、複製、單次替代及系列拆分全部遵守相同的新項目目標。

### 工作單 F：已知介面及結構問題

涉及路徑：

- `app/src/protyle/render/av/calendar/render.ts`
- `app/src/protyle/render/av/calendar/event-chip.ts`
- `app/src/assets/scss/business/_av.scss`
- `scripts/calendar-electron-launch-smoke.mjs`

修正項目：

1. 月檢視超過三項時顯示三項加 `+N`。四項必須顯示三項加 `+1`。
2. 移除 `<button>` 內部的巢狀 `role="button"` 焦點控制。改用同層控制或單一按鈕配合選單，保持來源頁面與排程編輯均可由鍵盤到達。
3. 驗證窄面板沒有水平溢出，工具列可操作，事件文字不被永久控制擠壓。

完成標準：

- 四項事件邊界測試通過。
- DOM 中沒有巢狀互動控制。
- 鍵盤可分別開啟頁面及排程編輯。

### 工作單 G：清理及文件

涉及路徑：

- `app/.calendar-tx-smoke-iyDIfl/`
- `app/.calendar-tx-smoke-uMQb5S/`
- `.gitignore`
- `CALENDAR_REBUILD_HANDOFF.md`
- `CALENDAR_REBUILD_REPORT.md`

步驟：

1. 從 Git 移除兩個臨時煙霧測試編譯目錄。
2. 加入精準忽略規則，避免同類臨時目錄再次提交。
3. 更新交接文件，刪除不再真實的「全數完成」描述。
4. 記錄原子更新介面、頁面式一致性及剩餘風險。
5. 保留復原分支資訊，但明確標示它是歷史後備，不是待合併來源。

## 5. 驗證閘門

### 快速閘門

```bash
git diff --check
cd app && corepack pnpm run typecheck
cd ..
node scripts/calendar-audit.mjs
node scripts/calendar-transactions-smoke.mjs
node scripts/calendar-time-grid-smoke.mjs
node scripts/calendar-quick-create-smoke.mjs
node scripts/calendar-source-link-smoke.mjs
```

### 核心閘門

```bash
cd kernel
go test -vet=off ./av ./sql
go test -vet=off ./model -run 'Calendar|AttributeViewItem|Rename'
cd ..
node scripts/calendar-backend-contract-smoke.mjs
```

必須另外確認整個 `./model` 的已知 Obsidian 環境失敗沒有新增日曆失敗。不得把既有環境失敗寫成全套通過。

### 建置閘門

```bash
cd app
corepack pnpm run build:desktop
corepack pnpm run build:app
cd ..
```

### 真實桌面閘門

兩項測試使用相同連接埠，必須串行執行：

```bash
node scripts/calendar-electron-launch-smoke.mjs
node scripts/calendar-electron-document-flow-smoke.mjs
```

### 原子性專用閘門

隔離工作空間中至少執行以下故障注入：

- 文件名稱驗證失敗。
- AV 欄位驗證失敗。
- AV 資料列不存在。
- 提交前錯誤。
- 提交期間恐慌。
- 成功後一次復原及一次重做。

每次均重新從磁碟及 API 讀取，不得只檢查函式回傳值。

### 最終 Git 閘門

```bash
git status --short --branch
git diff --check
git grep -n '^<<<<<<<\|^=======\|^>>>>>>>' -- .
git ls-files 'app/.calendar-*-smoke-*'
git log --oneline --decorate -10
```

完成狀態要求：

- 沒有未追蹤的必要日曆模組。
- 沒有臨時 smoke 編譯檔被追蹤。
- 沒有衝突標記。
- 所有候選修改均由聚焦提交擁有。

## 6. 提交順序

建議使用以下聚焦提交：

1. `chore(calendar): capture Claude calendar candidate modules`
2. `test(calendar): reproduce bound event partial rename failure`
3. `fix(calendar): update bound page and calendar fields atomically`
4. `fix(calendar): preserve page-per-entry across every create path`
5. `fix(calendar): close month density and nested control gaps`
6. `chore(calendar): remove smoke artefacts and update handoff`

每個提交必須在自己的相關測試通過後建立。原子更新提交不得與視覺整理混在同一提交。

## 7. 審查要求

### 規格審查

確認以下陳述均有測試證據：

- 文件名稱及 AV 欄位全有或全無。
- 一次復原同時復原兩者。
- 所有頁面式建立路徑保持頁面式。
- 復原分支的不變條件沒有倒退。

### 程式品質審查

重點檢查：

- 交易鎖順序及死鎖風險。
- 提交前是否有任何磁碟寫入或事件發送。
- 提交後副作用是否只執行一次。
- 子文件路徑、引用文字及索引是否與現有 `RenameDoc()` 行為一致。
- API 是否驗證 `itemID`、`avID`、`blockID` 及綁定關係，避免跨 AV 或跨文件更新。
- 故障注入是否測試持久化狀態，而非只測試模擬函式。

## 8. 完成定義

只有全部符合以下條件，候選版本才可提交合併審批：

1. 原子性失敗測試先紅後綠。
2. 綁定文件事件不存在兩請求更新流程。
3. 所有頁面式建立路徑一致。
4. 11 個核心模組已追蹤。
5. 臨時 smoke 產物已移除。
6. 類型檢查、核心聚焦測試、兩個建置及兩個串行 Electron 測試通過。
7. 真實持久化讀回證明失敗時文件及 AV 均不變。
8. 獨立唯讀審查沒有未解決的高嚴重度問題。
9. `calendar-production` 及復原工作樹保持原狀。
10. 合併前再次取得使用者明確批准。
