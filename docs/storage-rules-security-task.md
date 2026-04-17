# Storage Rules 資安加固獨立 Task

> **來源**：Custom Claims V6 實證審計（2026-04-17 Round 14）意外發現
> **狀態**：待評估（**獨立於 Custom Claims 計劃**）
> **優先級**：高（資料外洩風險，比 Custom Claims 更直接影響用戶）

---

## 問題描述

`storage.rules` 檔案目前設定：

```firebase-rules
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /images/{allPaths=**} {
      allow read: if true;          // ← 全網任何人皆可讀
      allow write: if request.auth != null
                   && request.resource.size < 2 * 1024 * 1024
                   && request.resource.contentType.matches('image/.*');
    }
  }
}
```

**核心問題**：`allow read: if true` 意味 **Firebase Storage 內的所有圖片全網公開**，任何人可下載（不需登入、無 rate limit、網路爬蟲皆可）。

---

## 影響範圍與風險

### 目前 Storage 裡有什麼

根據現有 CLAUDE.md 架構與程式碼引用推測：

1. **用戶頭像**（profile.pictureUrl 轉存）
2. **活動照片**（event creator 上傳的宣傳圖）
3. **俱樂部圖**（team.image）
4. **徽章圖**（badges）
5. **贊助廣告圖**（ad-manage 模組）
6. **開機品牌圖**（boot-brand）
7. **小遊戲相關圖**（shot-game、kickball）
8. **可能包含**：家長綁定照片、學員報名證明（education 模組）

### 風險等級

| 情境 | 機率 | 影響 |
|---|---|---|
| 爬蟲批量抓取所有圖片 | 高（任何時刻都可能）| 中（公開資料被整理成 dataset）|
| 私密照片被發現 | 中（若有上傳）| **高（個資洩漏）**|
| 圖片 URL 被枚舉外流 | 中 | 中（資料最小化原則被破壞）|
| 被當成免費 CDN 濫用 | 中 | 低（流量費用增加）|

### 合規角度

- **台灣 PDPA**：若圖片含可識別個人資訊（正面肖像、身分證、病歷等）→ 可能違反
- **GDPR**（若有歐盟用戶）：資料最小化原則（Art. 5）要求只對必要者公開
- **用戶信任**：多數用戶假設自己的頭像只有 app 內可見，未預期「網路上任何人都能下載」

---

## 修復選項

### 方案 A（最安全，但工作多）— 分層 Storage

```firebase-rules
match /public/{allPaths=**} {
  allow read: if true;          // 只有明確放 /public/ 的才公開
  allow write: if request.auth != null && ...
}
match /users/{uid}/{allPaths=**} {
  allow read: if request.auth != null;   // 所有登入用戶可讀
  allow write: if request.auth != null && request.auth.uid == uid;
}
match /private/{allPaths=**} {
  allow read: if request.auth.token.role in ['admin', 'super_admin'];
  allow write: if false;
}
```

**優點**：分級清楚，敏感資料保護強
**缺點**：需要遷移現有圖片到正確路徑、更新所有上傳邏輯

### 方案 B（中等工作量）— 改為 authed-only read

```firebase-rules
match /images/{allPaths=**} {
  allow read: if request.auth != null;    // 至少要登入
  allow write: if request.auth != null && ... (原本的檢查)
}
```

**優點**：1 行改動即可
**缺點**：
- 社交分享預覽圖（OG image）會壞（爬蟲無 auth）
- 需要特別 handle `teamShareOg` / `eventShareOg` 的圖片
- 新頁面若嵌入圖片，必須在 authed context 才能顯示

### 方案 C（折衷）— 圖片用 signed URL

- Storage rules 維持部分公開
- 但敏感圖片改為**透過 Cloud Function 產生時限 signed URL**（1 小時過期）
- 分享時產生新 URL，社交爬蟲抓到後過期失效

**優點**：平衡 UX 與安全
**缺點**：實作較複雜，可能影響現有分享機制

### 方案 D（最保守）— 暫時維持，先做清查

- 不改 rules
- 但**立刻跑腳本**列出 Storage 內所有檔案
- 依內容分類決定是否有敏感資料
- 再決定要不要改 rules

**優點**：零風險啟動
**缺點**：不解決問題，只收集資訊

---

## 建議執行順序

1. **立即（1 天內）**：跑方案 D 的 Storage inventory script，了解實際內容
2. **短期（1 週內）**：基於 inventory 結果選方案 A / B / C
3. **中期（隨 app 下次部署）**：實施所選方案
4. **長期**：定期（半年）重審 Storage rules

---

## 涉及的相關模組（修改時需通知）

- `js/modules/profile/profile-avatar.js`（頭像）
- `js/modules/image-upload.js`（通用上傳）
- `js/modules/image-cropper.js`（裁圖）
- `js/modules/ad-manage/*`（廣告圖）
- `js/modules/boot-brand-manage.js`（品牌圖）
- `functions/index.js` 的 `teamShareOg` / `eventShareOg`（OG 圖）
- `storage.rules`

---

## 非 Custom Claims 計劃範圍的理由

這個任務與 Custom Claims 遷移**完全無關**（Storage rules 不讀 Firestore claims），所以：

- 不應綁在 Custom Claims 計劃中做
- 工時估算獨立
- 決策點獨立（可能老闆會決定「用戶同意過公開頭像，維持現狀」）
- 若 Custom Claims 成功遷移，Storage rules 也不因此改動

---

## 附加發現（可併入此 task）

**OG 預覽 CF 安全**（`teamShareOg` / `eventShareOg`）：

- 目前是 `onRequest` 完全公開
- 未驗證傳入 `teamId` / `eventId` 指向的物件是否為**公開狀態**
- 若回傳 draft / cancelled 活動的 OG 資料 → 資訊洩漏
- 建議：CF 開頭加 `if (data.status !== 'open' && data.status !== 'full' && data.status !== 'ended') return res.status(410).send()`

---

## 待使用者決策

- [ ] 是否同意跑 Storage inventory（方案 D 第一步，純讀、無風險）？
- [ ] 是否優先此 task 於 Custom Claims 前執行？（嚴重度高但範圍小，可平行進行）
- [ ] 用戶上傳過的圖片是否有明確的「公開/私密」分類依據？

---

**建立日期**：2026-04-17
**來源**：custom-claims-migration-plan.md V6 Round 14
**相關計劃書**：[custom-claims-migration-plan.md](custom-claims-migration-plan.md)（不依賴此 task，可並行）
