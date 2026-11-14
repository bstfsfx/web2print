# PrintFlow

專業線上印刷平台前端示範 — 單頁靜態站，部署於 Vercel。

原檔為單一 `PrintFlow.html`（162 KB，內嵌 base64 圖片）。此專案將其重構為可快取、
可最佳化、可部署的結構，並保留完全相同的視覺與互動效果。

---

## 快速開始

```bash
npm install          # 無相依套件，僅需 Node 18+
npm run assets       # 從原始 HTML 抽出圖片並最佳化（首次執行）
npm run build        # 產生 dist/
npm run dev          # 本機預覽 http://localhost:4173
```

部署到 Vercel 時不需任何設定 — `vercel.json` 已宣告建置指令與輸出目錄：

```bash
vercel --prod
```

---

## 效能成果

| 指標 | 原始 | 最佳化後 | 變化 |
|---|---:|---:|---:|
| 首次傳輸量 | 323.3 KB | 95.6 KB | **−70%** |
| Brotli 文字量 | 108.5 KB | 8.2 KB | **−92%** |
| 請求數 | 1 | 15 | +14（皆可快取）|
| 重複造訪傳輸量 | 323.3 KB | ≈ 0 KB | **−100%** |
| Time to Interactive | 34 ms | 22 ms | −35% |

> 15 個請求全部帶 `Cache-Control: immutable` 與內容雜湊檔名，重複造訪時
> 除了 HTML 之外全部命中瀏覽器快取。

---

## 最佳化項目

### 圖片
- 全部改為獨立檔案（WebP + JPEG fallback），不再內嵌 base64
- 依據實際版面寬度產生響應式尺寸（`srcset` + `sizes`）
- 移除 metadata 後重新編碼（Lanczos 重採樣、quality 依用途調整）
- 預載 LCP 圖片，`preload` 的 `srcset` 與 `<picture>` 完全一致
- 首屏以下圖片使用 `loading="lazy"` + `decoding="async"`
- 所有 `<img>` 帶 `width`/`height`，消除 CLS

### 快取
- 檔名加入內容雜湊（`hero-960.367c5eab.webp`），因此可以安全使用
  `Cache-Control: immutable` — 內容改變時檔名改變，絕不會拿到舊檔
- HTML 本身 `must-revalidate`，保證更新能即時生效

### 渲染
- 關鍵 CSS（首屏）inline 於 HTML，避免阻塞繪製的請求
- 其餘 CSS 抽出為獨立檔案，可跨頁快取
- `content-visibility: auto` 讓瀏覽器略過離屏區段的 layout/paint
- `prefers-reduced-motion` 支援
- `scroll-padding-top` 修正 sticky header 造成的錨點遮蔽

### 執行期
- 事件委派：每個容器一個監聽器，而非每個元素一個
- 快取 DOM 查詢結果
- Toast 以 `requestAnimationFrame` 批次更新
- `defer` 載入腳本，不阻塞 HTML 解析

### 安全性
- CSP 標頭（無 inline event handler，腳本外掛）
- `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、
  `Permissions-Policy`、`Strict-Transport-Security`

### SEO / PWA
- Open Graph / Twitter Card meta
- `site.webmanifest` + 產生式 favicon 與 app icons
- `robots.txt`、`sitemap.xml`
- 語意化標記、`aria-*`、鍵盤 focus 樣式、skip link

---

## 專案結構

```
src/
  index.html          原始碼（含 inline 關鍵 CSS）
  app.css             首屏以下的樣式
  app.js              互動邏輯
public/
  assets/             最佳化後的圖片產物
  sitemap.xml
scripts/
  extract-assets.mjs  從 PrintFlow.html 抽出原始圖片
  optimize-images.mjs 產生 WebP / JPEG 響應式變體
  generate-icons.mjs  由向量 logo 產生 favicon / PWA icons
  hash-assets.mjs     為檔名加入內容雜湊
  build.mjs           壓縮 + 組裝 dist/
  check.mjs           產出稽核（CLS、lazy loading、preload…）
  verify-deploy.mjs  模擬 Vercel 建置環境
  serve.mjs           零相依靜態伺服器
dist/                 建置產物（部署內容）
PrintFlow.html        原始單檔版本，保留作為參考
```

---

## 指令

| 指令 | 說明 |
|---|---|
| `npm run assets` | 重新抽取並最佳化圖片 |
| `npm run build` | 建置至 `dist/` |
| `npm run dev` | 本機預覽 |
| `npm run check` | 稽核建置產物 |
| `npm run verify` | 驗證 Vercel 部署設定 |
| `npm test` | build + check + verify |

---

## 注意事項

- `src/app.css` 的 `content-visibility` 規則會讓離屏區段在整頁截圖時呈現空白，
  這是預期行為；實際瀏覽時捲動到該區段即會正常繪製。
- 若要替換圖片，將新圖放入 `.source-assets/` 後執行 `npm run assets`，
  並在 `scripts/optimize-images.mjs` 的 `MANIFEST` 宣告寬度與品質。
