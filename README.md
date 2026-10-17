# 表格小幫手 / TableMerge Starter

**v0.1.0 · 2026-10-18**

把多份 Excel／CSV 合成一張表，保留資料來源，方便核對。匯入檔案在瀏覽器內處理；SheetJS 隨程式附上，無須從外部 CDN 載入。

## 先試一次

開啟 `dist/index.html`，按示範按鈕。示範內容是虛構商品銷售資料。接著試匯入兩份表格、檢查預覽，再匯出結果。

## 可以做什麼

- 讀取 `.xlsx`／`.csv`；Excel 每個檔案選一張工作表，預設第一張。CSV 預設 UTF-8，可改選 Big5。
- 合併全部欄位（聯集），或只保留共同欄位（交集）。
- 顯示重複筆數；去重須主動開啟，可指定比對欄位，保留檔案順序中首次出現的一筆。
- 加入來源檔案、工作表、列號；欄名衝突時自動加後綴。
- 檢查數值加總，匯出 CSV／XLSX。

匯入只讀取值，不保留原格式與公式；公式快取可能過期。XLSX 匯出把資料寫成文字以保留編號，數值統計另行計算。CSV 使用 UTF-8 BOM，預設為可能被解讀成公式的文字加上單引號。

初版上限：20 檔、單檔 5 MiB、合計 20 MiB、200 欄、合計 20,000 列及 500,000 格。

## 接著做

[從零上線](docs/START_HERE.zh-TW.md) · [維護計畫](docs/MAINTAINER_PLAN.zh-TW.md) · [貢獻方式](CONTRIBUTING.md) · [申請準備](docs/APPLICATION_PREP.zh-TW.md)

這是 AI 協助開發的第一版。維護者須理解與驗證修改，再決定是否發布；目前沒有外部使用量或採用成效的佐證。

本專案採用 [MIT 授權](LICENSE)。隨附第三方程式的授權依各自的授權文件。[GitHub 說明](https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/licensing-a-repository)：公開程式碼仍需要合適授權，才能清楚允許他人使用、修改及散布。

## English summary

TableMerge Starter merges XLSX and CSV files in your browser, with selectable headers, optional deduplication, provenance, numeric summaries, and exports. SheetJS is bundled locally. This AI-assisted initial version requires maintainer review and real-world validation. No adoption or sponsorship outcome is claimed.
