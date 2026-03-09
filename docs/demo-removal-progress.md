# Demo 模式完整清除 — 施作進度追蹤

## 概述
移除專案中所有 Demo / Production 雙模式架構，簡化程式碼。

**影響範圍**：~25 個檔案、~130 處 demo 相關引用

---

## Phase 1：核心基礎設施 ✅ 已完成

### 已完成項目
| 檔案 | 變更內容 | 狀態 |
|------|----------|------|
| `js/config.js` | `ModeManager` 替換為 stub（永遠回傳 production） | ✅ |
| `js/config.js` | 刪除 `DEMO_USERS` 常數 | ✅ |
| `js/core/mode.js` | 整檔刪除（`bindModeSwitch`/`_switchMode`/`_onModeChanged`/`_updateModeBadge`） | ✅ |
| `js/data.js` | 整檔刪除（~30KB 純 demo 種子資料） | ✅ |
| `index.html` | 刪除 early mode detection script，改為直接加 `prod-early` | ✅ |
| `index.html` | 刪除 role-switcher HTML（33 行） | ✅ |
| `index.html` | 刪除 mode-badge `<div>` | ✅ |
| `index.html` | 刪除 `data.js` / `mode.js` script 標籤 | ✅ |
| `index.html` | 移除 `sporthub_mode` localStorage 引用 | ✅ |
| `index.html` | 移除 `isProd` 變數（不再需要） | ✅ |
| `app.js` | 刪除 `this.bindModeSwitch()` 呼叫 | ✅ |
| `app.js` | 刪除 `this.bindRoleSwitcher()` 呼叫 | ✅ |
| `app.js` | 移除 Phase 2 `ModeManager.isDemo()` guard | ✅ |
| `app.js` | 移除 Phase 4 `ModeManager.isDemo()` guard | ✅ |
| `app.js` | 移除 `_scheduleCloudBoot` demo guard | ✅ |
| `app.js` | 移除 `ensureCloudReady` demo guard | ✅ |
| `app.js` | 移除 deep link 方法中所有 `ModeManager.isDemo()` 引用（5 處） | ✅ |

---

## Phase 2：資料層簡化 ⬜ 待施作

### 目標檔案
| 檔案 | 要移除的內容 |
|------|-------------|
| `js/api-service.js` | ~50 處修改：刪除 `_demoMode`、簡化 `_src()`、移除所有 DemoData 分支 |
| `js/firebase-service.js` | 3 處：移除 `ensureCollectionsForPage` / `_syncCurrentUserFromUsersSnapshot` / anonymous auth 的 demo guard |

### 驗收條件
- [ ] `api-service.js` 無 `_demoMode`、`DemoData`、`ModeManager.isDemo()` 引用
- [ ] `firebase-service.js` 無 `ModeManager.isDemo()` 引用

---

## Phase 3：功能模組清除 ⬜ 待施作

### 簡單 guard 移除
| 檔案 | 要移除的內容 |
|------|-------------|
| `js/modules/attendance-notify.js` | demo guard + `_simulateAttendanceNotify()` |
| `js/modules/scan.js` | demo simulation 呼叫 |
| `js/modules/dashboard.js` | demo `clearAllData()` 分支 |
| `js/modules/event-create.js` | `!ModeManager.isDemo() && _docId` → `_docId` |
| `js/modules/event-manage.js` | 同上（4 處） |
| `js/modules/event-detail.js` | demo 分支（2 處） |
| `js/modules/event-detail-signup.js` | demo signup 路徑（3 處） |
| `js/modules/event-detail-companion.js` | demo guard（2 處） |
| `js/modules/favorites.js` | `'demo-user'` fallback（3 處） |
| `js/modules/site-theme.js` | demo guard（1 處） |
| `js/modules/tournament-render.js` | demo guard（2 處） |
| `js/modules/user-admin-exp.js` | demo fallback（1 處） |
| `js/modules/shot-game-page.js` | demo 條件（1 處） |
| `js/modules/ad-manage-*.js` | `!ModeManager.isDemo()` image upload guards |

### DemoData 直接引用清除
| 檔案 | 要移除的內容 |
|------|-------------|
| `js/modules/profile-core.js` | demo 頭像/角色選單 HTML + demo isLoggedIn 分支 |
| `js/modules/profile-data.js` | demo UID/profile fallback（5 處） |
| `js/modules/shop.js` | DemoData.shopItems 寫入分支 |
| `js/modules/message-admin.js` | `DemoData.messages` → `FirebaseService._cache.messages` |
| `js/modules/message-inbox.js` | demo 分支（4+ 處） |
| `js/modules/team.js` | `DemoData.currentUser` fallback（~15 處） |
| `js/modules/team-form.js` | 同上（~15 處） |
| `js/modules/team-list.js` | demo fallback（3 處） |
| `js/modules/team-detail.js` | demo fallback（2 處） |
| `js/modules/user-admin-roles.js` | 重度 DemoData 用法 |

### 部分保留
| 檔案 | 刪除 | 保留 |
|------|------|------|
| `js/modules/role.js` | `bindRoleSwitcher()`、`toggleDemoRoleMenu()`、`selectDemoRole()` | `applyRole()`（移除內部 DemoData sync）、`renderDrawerMenu()` |
| `js/line-auth.js` | demo bypass（login 方法）、localhost auto-enable demo | 其餘 |

### 驗收條件
- [ ] 所有模組無 `ModeManager.isDemo()`、`DemoData`、`_demoMode` 引用
- [ ] `role.js` 保留 `applyRole()` 和 `renderDrawerMenu()`

---

## Phase 4：CSS 與文件清除 ⬜ 待施作

| 檔案 | 要移除的內容 |
|------|-------------|
| `css/base.css` | `.prod-early .mode-badge` 和 `.mode-badge` 樣式 |
| `css/layout.css` | `#role-switcher` 相關規則、`.role-switcher-wrapper` 全部子規則（~115 行）、`html.prod-early` 相關規則 |
| `docs/demo-mode-plan.md` | 整檔刪除 |

### 驗收條件
- [ ] CSS 無 `.mode-badge`、`.role-switcher-wrapper` 規則
- [ ] `docs/demo-mode-plan.md` 不存在

---

## Phase 5：最終清理 ⬜ 待施作

| 項目 | 說明 |
|------|------|
| 移除 ModeManager stub | `config.js` 中的 stub 定義 |
| 全域搜尋驗證 | `ModeManager`、`isDemo`、`_demoMode`、`DemoData`、`sporthub_mode` 零殘留 |
| 更新 `CACHE_VERSION` | 新版本號 |
| 更新 `?v=` 參數 | `index.html` 所有 CSS/JS 引用 |

### 驗收條件
- [ ] `ModeManager` 定義已移除
- [ ] 全域搜尋零殘留
- [ ] `CACHE_VERSION` 已更新
- [ ] `?v=` 參數已同步

---

## 全域驗收清單

### 自動驗收（每個 Phase 後執行）
| 檢查項 | 方法 | 狀態 |
|--------|------|------|
| `isDemo`、`DemoData`、`_demoMode` 零殘留 | `Grep` 全域搜尋 | ⬜ Phase 5 後 |
| 已刪檔案不存在（data.js、mode.js、demo-mode-plan.md） | `Glob` 確認 | ⬜ |
| index.html 無 role-switcher / mode-badge HTML | `Read` + `Grep` | ✅ Phase 1 |
| CSS 無 `.mode-badge`、`.role-switcher-wrapper` | `Grep` | ⬜ Phase 4 後 |
| `sporthub_mode` localStorage 引用零殘留 | `Grep` | ⬜ Phase 5 後 |
| JS 語法正確 | `node --check` 逐檔驗證 | ⬜ 每 Phase 後 |

### 手動驗收（需用戶在瀏覽器操作）
| 檢查項 | 時機 |
|--------|------|
| 頁面正常載入，無白屏 | Phase 1 後、Phase 5 後 |
| Console 無 runtime error | Phase 1 後、Phase 5 後 |
| LINE 登入可正常完成 | Phase 5 後 |
| 右上角頭像選單顯示「個人檔案」/「登出」 | Phase 5 後 |
| 無 "DEMO" badge 或角色切換 UI 出現 | Phase 1 後 |
| 活動報名 → 簽到 → 簽退流程正常 | Phase 5 後 |
| Admin 頁面依權限正確顯示/隱藏 | Phase 5 後 |

---

## 風險備註

| 風險 | 嚴重度 | 緩解方式 |
|------|--------|----------|
| `ModeManager` 刪除後其他檔案呼叫炸裂 | **高** | Phase 1 已用 stub 過渡 |
| `bindModeSwitch()` / `bindRoleSwitcher()` 被刪但 app.js 仍呼叫 | **高** | Phase 1 已同步移除 |
| `DemoData` 被刪後仍有引用 | **高** | `typeof DemoData !== 'undefined'` guard 會降級，Phase 2-3 逐步清除 |
| Firebase 寫入無 auth 時失敗 | **中** | production 本來就有的行為 |
