# 庫存管理系統實作計畫

> 路徑：`toosterx.com/inventory`
> 狀態：**Phase 1 MVP 已部署**
> 最後更新：2026-03-29
> 審閱：架構專家 ✅ ｜ 安全專家 ✅ ｜ UX 專家 ✅

---

## 一、系統定位

獨立的運動商品庫存管理系統，部署在 `toosterx.com/inventory`，與現有 ToosterX 完全隔離但共用 Firebase 專案。

**核心流程**：
- 入庫：掃條碼 → 辨識編號 → 輸入商品資訊 → 建檔
- 銷售：掃條碼 → 帶出商品 → 輸入數量/優惠 → 扣庫存 + 建立銷售紀錄

---

## 二、技術架構

| 項目 | 選型 | 說明 |
|------|------|------|
| 前端 | Vanilla JS + HTML + CSS | 與 ToosterX 一致，無框架無 build |
| 資料庫 | Firebase Firestore（共用 `fc-football-6c8dc`） | Collection 前綴 `inv_` 隔離 |
| 掃碼 | Html5Qrcode | 支援 EAN-13、Code 128、UPC-A、QR Code |
| 登入 | LINE LIFF（新建獨立 LIFF App） | 共用 LINE Login Channel，獨立 endpoint |
| 部署 | Cloudflare Pages | 共用現有 toosterx.com，子目錄 `/inventory` |
| 離線 | Firestore 內建離線快取 | Transaction 離線時會失敗，UI 須明確提示 |

### 與 ToosterX 的隔離策略

```
Firebase 專案：fc-football-6c8dc（共用）
├── ToosterX: events, teams, users, registrations...
└── 庫存系統: inv_products, inv_transactions, inv_settings, inv_stocktakes
    └── Firestore Rules: 僅 inventoryAdmin 或 ToosterX super_admin 可讀寫
```

---

## 三、Firestore 資料結構

### 3.1 `inv_products`（商品主檔）

```javascript
{
  id: "自動生成",
  barcode: "4710088432001",         // 條碼（建議用 barcode 作為 doc ID 保證唯一）
  name: "Nike Dri-FIT 短袖上衣",
  brand: "Nike",                    // 品牌
  category: "上衣",                 // 分類
  color: "黑色",
  size: "L",
  sku: "",                          // 自有內部編號（選填）
  supplier: "",                     // 供應商（選填）
  costPrice: 800,                   // 進貨價（成本）
  sellPrice: 1200,                  // 建議售價
  stock: 25,                        // 目前庫存量
  lowStockAlert: 5,                 // 低庫存警示門檻
  image: null,                      // 商品圖片 URL（選填）
  note: "",                         // 備註
  active: true,                     // 是否上架
  locationId: "main",               // 存放位置（預留多店面）
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp(),
}
```

### 3.2 `inv_transactions`（異動紀錄，不可修改/刪除）

```javascript
{
  id: "自動生成",
  receiptNo: "S20260328-001",       // 人類可讀流水號（銷售時自動生成）
  saleGroupId: "sg_1711612800000",  // 同一筆銷售的群組 ID
  barcode: "4710088432001",
  productId: "對應 product id",
  productName: "Nike Dri-FIT 短袖上衣",
  type: "in|out|return|adjust|void|waste|gift",
  quantity: 5,                       // 一律正整數，方向由 type 決定
  unitPrice: 1200,                   // 單價
  costPrice: 800,                    // 當時成本價（快照，利潤計算用）
  discount: 100,                     // 優惠金額
  discountType: "amount|percent",    // 優惠類型
  totalAmount: 5900,                 // 實收金額
  paymentMethod: "cash|transfer|linepay", // 收款方式
  paymentNote: "",                   // 收款備註
  beforeStock: 30,                   // 異動前庫存
  afterStock: 25,                    // 異動後庫存
  reason: "",                        // 調整/退貨/報廢原因
  originalTransactionId: null,       // 退貨/作廢時關聯原始交易
  returnToStock: true,               // 退貨是否回到可銷售庫存
  isGift: false,                     // 是否為贈品
  isStaffPurchase: false,            // 是否為員工內購
  locationId: "main",                // 店面位置
  operatorUid: "LINE userId",
  operatorName: "管理員",
  createdAt: serverTimestamp(),
}
```

**type 欄位值說明**：

| type | 說明 | stock 影響 |
|------|------|-----------|
| `in` | 入庫/補貨 | +quantity |
| `out` | 銷售 | -quantity |
| `return` | 退貨 | +quantity（若 returnToStock=true） |
| `adjust` | 手動調整/盤點 | ±quantity |
| `void` | 作廢（沖銷錯誤交易） | 反向操作 |
| `waste` | 損耗/報廢 | -quantity |
| `gift` | 贈品出庫 | -quantity |

### 3.3 `inv_settings`（系統設定）

```javascript
// 文件 ID: "config"
{
  categories: ["上衣", "褲子", "鞋子", "配件", "球具", "其他"],
  adminUids: ["U1234..."],           // 有權限操作的 LINE userId 白名單
  shopName: "ToosterX 運動用品",
  currency: "TWD",
  defaultLowStockAlert: 5,           // 預設低庫存門檻
}
```

### 3.4 `inv_stocktakes`（盤點單）

```javascript
{
  id: "自動生成",
  status: "in_progress|completed|cancelled",
  scope: "all|category",
  scopeCategory: "鞋子",
  items: [
    { barcode: "...", productId: "...", productName: "...",
      systemStock: 25, actualStock: 23, confirmed: false }
  ],
  operatorUid: "LINE userId",
  operatorName: "管理員",
  startedAt: serverTimestamp(),
  completedAt: null,
  note: "",
}
```

### 3.5 索引需求

| Collection | 索引欄位 | 用途 |
|------------|---------|------|
| `inv_products` | `barcode` (ASC) | 掃碼查詢 |
| `inv_products` | `category` (ASC), `name` (ASC) | 分類瀏覽 |
| `inv_products` | `stock` (ASC) | 低庫存篩選 |
| `inv_transactions` | `createdAt` (DESC) | 時間排序 |
| `inv_transactions` | `type` (ASC), `createdAt` (DESC) | 依類型篩選 |
| `inv_transactions` | `saleGroupId` (ASC) | 同一筆銷售查詢 |
| `inv_transactions` | `barcode` (ASC), `createdAt` (DESC) | 單一商品歷史 |

---

## 四、Firestore Security Rules

```javascript
// ── 庫存系統權限判斷 ──
function isInventoryAdmin() {
  return request.auth != null
    && (
      get(/databases/$(database)/documents/inv_settings/config).data.adminUids.hasAny([request.auth.uid])
      || isSuperAdmin()  // ToosterX super_admin 緊急後門
    );
}

match /inv_products/{docId} {
  allow read, write: if isInventoryAdmin();
}

match /inv_transactions/{docId} {
  allow read: if isInventoryAdmin();
  allow create: if isInventoryAdmin()
    && request.resource.data.type in ['in', 'out', 'return', 'adjust', 'void', 'waste', 'gift']
    && request.resource.data.quantity is int
    && request.resource.data.operatorUid == request.auth.uid
    && request.resource.data.createdAt == request.time;
  allow update, delete: if false;  // 交易紀錄不可修改/刪除（用 void 沖銷）
}

match /inv_stocktakes/{docId} {
  allow read, write: if isInventoryAdmin();
}

match /inv_settings/{docId} {
  allow get: if request.auth != null;    // 登入可讀（權限判斷用）
  allow list: if isInventoryAdmin();     // 列舉需管理員
  allow write: if isInventoryAdmin();
}
```

**注意**：規則必須放在 `firestore.rules` 的 catch-all 規則之前。

---

## 五、庫存操作的原子性保證

所有涉及庫存數量變更的操作必須使用 **Firestore Transaction**：

```javascript
async function processSale(items) {
  await db.runTransaction(async (transaction) => {
    // 1. 先讀取所有商品（Transaction 要求先讀後寫）
    const snapshots = new Map();
    for (const item of items) {
      const ref = db.collection('inv_products').doc(item.productId);
      const snap = await transaction.get(ref);
      if (!snap.exists) throw new Error('商品不存在：' + item.productId);
      snapshots.set(item.productId, { ref, snap });
    }
    // 2. 驗證庫存
    for (const item of items) {
      const { snap } = snapshots.get(item.productId);
      if (snap.data().stock < item.quantity) {
        throw new Error('庫存不足：' + snap.data().name);
      }
    }
    // 3. 全部通過後才扣庫存 + 寫交易紀錄
    const saleGroupId = 'sg_' + Date.now();
    for (const item of items) {
      const { ref, snap } = snapshots.get(item.productId);
      const before = snap.data().stock;
      transaction.update(ref, {
        stock: before - item.quantity,
        updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
      transaction.set(db.collection('inv_transactions').doc(), {
        saleGroupId, barcode: item.barcode, productId: item.productId,
        type: 'out', quantity: item.quantity,
        costPrice: snap.data().costPrice,
        beforeStock: before, afterStock: before - item.quantity,
        // ...其他欄位
        createdAt: firebase.firestore.FieldValue.serverTimestamp(),
      });
    }
  });
}
```

**重要限制**：
- 單一 Transaction 最多 500 次讀寫
- Transaction 離線時直接失敗（不排隊），UI 必須提示
- 購物車同商品須先合併（同 productId 合併數量），避免對同一文件做多次 update

---

## 六、頁面規劃

### 6.1 頁面清單

| 頁面 | 路徑/ID | 說明 |
|------|--------|------|
| 登入頁 | `page-login` | LINE LIFF 登入 + 權限檢查 |
| 首頁（儀表板） | `page-dashboard` | 庫存總覽 + 低庫存警示 + 今日銷售 + 趨勢 |
| 掃碼入庫 | `page-stock-in` | 相機掃碼 → 新增/補貨（支援批次） |
| 掃碼銷售 | `page-sale` | 相機掃碼 → 購物車 → 結帳 |
| 商品管理 | `page-products` | 商品列表 + 搜尋/篩選 + 編輯 |
| 商品詳情 | `page-product-detail` | 單一商品資訊 + 異動歷史 |
| 銷售紀錄 | `page-transactions` | 日期篩選 + 統計 + 匯出 |
| 盤點 | `page-stocktake` | 建立盤點單 + 掃碼盤點 + 差異報告 |
| 設定 | `page-settings` | 管理員白名單 + 分類管理 |

### 6.2 儀表板指標

**即時狀態區**（最上方）：
- 今日銷售額 / 銷售筆數 / 毛利 / 退貨金額

**庫存健康區**（中間）：
- 總 SKU 數 / 總庫存件數 / 低庫存警示數 / 零庫存數 / 庫存總成本

**趨勢區**（下方）：
- 最近 7 天銷售趨勢圖 / 熱銷 TOP 5 / 滯銷提醒（30 天未售出）

### 6.3 掃碼入庫流程（含批次模式）

| 步驟 | 說明 |
|------|------|
| 1 | 開啟相機掃碼（手動輸入條碼永遠可見在掃碼區下方） |
| 2 | 查詢 `inv_products` 是否有此條碼 |
| 3a（已存在） | 顯示商品資訊 → 焦點跳到數量欄位 → 快捷按鈕 +1/+5/+10 |
| 3b（不存在） | 顯示精簡表單（必填：品名、進貨價、售價、數量；選填：品牌、分類、顏色、尺寸） |
| 4 | Transaction 增加 stock + 寫入 `inv_transactions`（type: "in"） |
| 5 | 全螢幕綠色 overlay 1.5 秒（品名 + 數量 + 目前總庫存）→ 自動回到掃碼 |
| 6 | 底部累計顯示「本次已入庫 N 品項 / M 件」 |

### 6.4 掃碼銷售流程

| 步驟 | 說明 |
|------|------|
| 1 | 相機固定在畫面上方（sticky, 35vh），購物車在下方可獨立滾動 |
| 2 | 掃碼 → 加入購物車（同條碼再掃自動 +1，不新增行） |
| 3 | 即時庫存檢查（庫存不足黃色警示，庫存 0 阻擋加入） |
| 4 | 購物車可調整數量、刪除項目 |
| 5 | 優惠選填（快速按鈕：9折/85折/8折/自訂金額） |
| 6 | 選擇收款方式（現金/轉帳/LINE Pay）+ 現金找零計算 |
| 7 | 確認結帳 → Transaction 扣庫存 + 寫紀錄 |
| 8 | 暫存/清空購物車功能（防中途離開遺失） |

### 6.5 退貨流程

| 步驟 | 說明 |
|------|------|
| 1 | 掃碼或從銷售紀錄中選擇原始交易（用 receiptNo 或 saleGroupId 關聯） |
| 2 | 輸入退貨數量 + 原因（預設選項：瑕疵品/尺寸不合/改變心意/其他） |
| 3 | 選擇退款金額（可能不等於原售價） |
| 4 | 選擇「退回庫存」或「報廢」 |
| 5 | Transaction 加回庫存（若退回）+ 寫紀錄（type: "return"） |

### 6.6 盤點流程

| 步驟 | 說明 |
|------|------|
| 1 | 建立盤點單（全品項 或 依分類） |
| 2 | 逐一掃碼 → 輸入實際數量 → 標記「已盤」 |
| 3 | 可暫停/繼續（盤點單狀態：in_progress） |
| 4 | 產生差異報告（未掃到的顯示「未盤」，不假設為 0） |
| 5 | 操作者逐項確認差異 → Transaction 批次調整（每批 ≤100 件） |

---

## 七、手機 UX 設計原則

| 原則 | 做法 |
|------|------|
| 單手操作 | 所有按鈕在拇指可觸及範圍（螢幕下半 60%），重要按鈕 fixed bottom |
| 掃碼回饋 | 成功震動 `navigator.vibrate(100)` + 音效，不用盯螢幕 |
| 輸入優化 | 數量用 `inputmode="numeric"`，金額用 `inputmode="decimal"`，font-size ≥ 16px |
| 連續操作 | 入庫/盤點先載入全部商品到本地快取，掃碼查快取（毫秒級） |
| 網路提示 | 畫面上方網路狀態燈（綠/黃/紅），離線時禁用寫入操作並明確提示 |
| 光線不足 | 掃碼頁高對比配色 + 手電筒按鈕 |

---

## 八、匯出功能

### 銷售紀錄匯出欄位

交易日期、類型、商品名稱、條碼、品牌、分類、數量、單價、成本價、優惠金額、實收金額、毛利、收款方式、操作人

### 庫存清單匯出欄位

條碼、商品名稱、品牌、分類、顏色、尺寸、進貨成本、售價、目前庫存、庫存成本小計、低庫存門檻、建檔日期

### 匯出規範

- 支援日期範圍篩選
- CSV 加 UTF-8 BOM（`\uFEFF`），Excel 開啟不亂碼
- 檔名格式：`銷售紀錄_20260301-20260331.csv`

---

## 九、安全性與備份

### 9.1 API Key 風險

Firebase API Key 暴露在前端（與 ToosterX 相同），安全性由 Firestore Rules 強制執行。庫存資料（成本價等）只有 `isInventoryAdmin()` 通過才能讀取。

### 9.2 備份策略

| 層級 | 做法 |
|------|------|
| 第一層 | Cloud Function 每日自動匯出 inv_ 集合到 Cloud Storage |
| 第二層 | 前端 CSV 匯出（手動備份） |
| 第三層 | inv_transactions 不可刪改（Rules 強制） |

### 9.3 庫存重建

新增「庫存重建」工具：根據 `inv_transactions` 完整歷史紀錄重新計算所有商品的正確 stock 值（類似 ToosterX 的 `_rebuildOccupancy`）。

### 9.4 金額計算

所有金額計算後統一 `Math.round()` 取整，避免浮點數精度問題。

---

## 十、目錄結構

```
inventory/
├── index.html              # 主入口（SPA）
├── css/
│   └── inventory.css       # 樣式
├── js/
│   ├── inv-config.js       # Firebase 設定 + LIFF 設定
│   ├── inv-auth.js         # LINE 登入 + 權限檢查
│   ├── inv-app.js          # App 核心（路由、頁面切換）
│   ├── inv-utils.js        # 共用工具（金額計算、日期格式化、條碼驗證）
│   ├── inv-scanner.js      # 掃碼模組
│   ├── inv-products.js     # 商品 CRUD
│   ├── inv-stock-in.js     # 入庫邏輯
│   ├── inv-sale.js         # 銷售邏輯（結帳 + Transaction）
│   ├── inv-cart.js         # 購物車狀態管理（獨立模組）
│   ├── inv-transactions.js # 交易紀錄 + 統計
│   ├── inv-stocktake.js    # 盤點模組
│   ├── inv-dashboard.js    # 儀表板
│   └── inv-export.js       # 匯出功能
├── pages/
│   ├── dashboard.html
│   ├── stock-in.html
│   ├── sale.html
│   ├── products.html
│   ├── product-detail.html
│   ├── transactions.html
│   ├── stocktake.html
│   └── settings.html
└── assets/
```

---

## 十一、實作階段規劃

### Phase 1：核心功能（MVP）

| 順序 | 功能 | 備註 |
|------|------|------|
| 1 | Firestore Rules 基本版部署 | 先部署才能開發 |
| 2 | 專案骨架（index.html + CSS + 路由） | |
| 3 | LINE LIFF 登入 + 權限檢查 | 共用 createCustomToken Cloud Function |
| 4 | 掃碼模組 | 參考現有 scan-camera.js |
| 5 | 商品建檔 + 入庫（含批次模式） | saleGroupId、costPrice 快照在此階段就設計 |
| 6 | 掃碼銷售 + 購物車 + 結帳 | 含收款方式、找零計算 |
| 7 | 儀表板（庫存總覽 + 低庫存 + 今日銷售） | |

### Phase 2：管理功能

| 順序 | 功能 |
|------|------|
| 8 | 商品列表 + 搜尋/篩選 + 編輯 |
| 9 | 銷售紀錄 + 日期篩選 |
| 10 | 退貨功能（含關聯原始交易） |
| 11 | 損耗報廢功能 |
| 12 | 銷售統計（日/週/月報） |
| 13 | 匯出 CSV |

### Phase 3：進階功能

| 順序 | 功能 |
|------|------|
| 14 | 盤點單管理 + 差異報告 |
| 15 | 條碼生成/列印 |
| 16 | 管理員白名單管理 UI |
| 17 | 庫存重建工具 |
| 18 | 每日自動備份 Cloud Function |

---

## 十二、LINE LIFF 設定（已完成）

- Provider：`FC Football`
- Channel：`FC 足球報名系統`（LINE Login，Published）
- LIFF App Name：`ToosterX Inventory`
- **LIFF ID：`2009084941-vbH7G70A`**
- LIFF URL：`https://liff.line.me/2009084941-vbH7G70A`
- Endpoint URL：`https://toosterx.com/inventory`
- Size：Full / Scope：profile + openid / Scan QR：On
- 共用 `createCustomToken` Cloud Function（不需另建）

---

## 十三、Phase 1 實作紀錄

### 13.1 完成日期：2026-03-29

### 13.2 已建立的檔案（12 個，共 1,959 行）

| 檔案 | 行數 | 說明 |
|------|------|------|
| `inventory/index.html` | 129 | 主入口 SPA，含所有頁面骨架 |
| `inventory/css/inventory.css` | 154 | 完整 CSS（teal 主色、30 個元件） |
| `inventory/js/inv-config.js` | 22 | Firebase + LIFF 設定 |
| `inventory/js/inv-utils.js` | 93 | 工具函式（日期、金額、流水號、條碼驗證） |
| `inventory/js/inv-auth.js` | 132 | LINE LIFF 登入 + adminUids 權限檢查 |
| `inventory/js/inv-app.js` | 118 | 核心路由、toast、escapeHTML、formatCurrency |
| `inventory/js/inv-scanner.js` | 113 | Html5Qrcode 掃碼 + 手動輸入 + 震動回饋 |
| `inventory/js/inv-products.js` | 291 | 商品 CRUD + adjustStock Transaction + 列表/詳情渲染 |
| `inventory/js/inv-stock-in.js` | 280 | 入庫模組（補貨/新品、批次模式、成功 overlay） |
| `inventory/js/inv-cart.js` | 188 | 購物車狀態管理（add/remove/暫存/恢復） |
| `inventory/js/inv-sale.js` | 250 | 銷售結帳（Transaction、折扣、收款、找零） |
| `inventory/js/inv-dashboard.js` | 189 | 儀表板（今日統計、庫存健康、低庫存警示） |

### 13.3 Firestore 設定

- **Rules**：`isInventoryAdmin()` + `isSuperAdmin()` 緊急後門，已部署
- **初始文件**：`inv_settings/config` 已建立（via REST API）
  - adminUids：`['U7774e1410479bafff4997f51b2c47b95']`
  - categories：`['上衣', '褲子', '鞋子', '配件', '球具', '其他']`
  - shopName：`ToosterX 運動用品`
  - defaultLowStockAlert：`5`

### 13.4 QA 驗收結果（8/8 通過）

| 項目 | 狀態 |
|------|------|
| ToosterX 隔離性（無引用 App/ApiService 等） | ✅ |
| 命名空間無衝突（Inv* 前綴） | ✅ |
| script 引用順序正確 | ✅ |
| XSS 防護（escapeHTML 全覆蓋） | ✅ |
| Firestore Rules 正確 | ✅ |
| barcode 作為 doc ID | ✅ |
| Transaction 先讀後寫 | ✅ |
| 語法檢查通過 | ✅ |

---

## 十四、待辦事項

### 已完成

- [x] LINE Developers Console 新建 LIFF App（ID: `2009084941-vbH7G70A`）
- [x] 初始管理員 LINE userId 寫入 inv_settings/config
- [x] Firestore Rules 部署（含 inv_ 集合 + catch-all 前置）
- [x] Phase 1 MVP 全部功能實作 + QA 通過
- [x] 條碼規格：混用（EAN-13 + Code 128 + QR Code，Html5Qrcode 全支援）
- [x] 多店面支援：已預留 locationId 欄位
- [x] 員工折扣/贈品：已在 Phase 2 實作（isGift + isStaffPurchase）
- [x] Phase 2 全部完成 + QA 通過（2026-03-29）
- [x] Phase 3 全部完成 + QA 通過（2026-03-29）

### Phase 2 已完成檔案

| 檔案 | 行數 | 說明 |
|------|------|------|
| `inv-transactions.js` | 258 | 銷售紀錄列表 + 日期/類型篩選 + 統計摘要 |
| `inv-sale-return.js` | 154 | 退貨（關聯原始交易）+ 報廢功能 |
| `inv-export.js` | 250 | CSV 匯出（UTF-8 BOM）+ 日/週/月銷售統計 |
| `inv-sale.js`（更新） | 272 | 新增 isGift 贈品出庫 + isStaffPurchase 員工內購 |

### Phase 3 已完成檔案

| 檔案 | 行數 | 說明 |
|------|------|------|
| `inv-stocktake.js` | 286 | 盤點單管理 + 掃碼盤點 + 差異報告 + 批次調整(≤50) |
| `inv-settings.js` | 274 | 管理員白名單 UI + 分類管理 + 條碼列印 + 庫存重建 |

### 待做

- [ ] 每日自動備份 Cloud Function（Phase 3+）
