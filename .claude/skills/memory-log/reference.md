# memory-log 參考

## 條目範本

```
### YYYY-MM-DD — 標題
- **問題**：一句話描述現象。
- **原因**：根本原因，不是表面徵兆。
- **修復**：改了什麼、怎麼改的、驗證方式。
- **教訓**：下次遇到同類問題該注意什麼；可分 (1)(2)(3) 列點。
```

`[永久]` 加在標題後，僅限：資料完整性地雷、UID、架構決策、重複 2 次以上 bug（R-LOG-003）。

## 遮罩清單

- UID（使用者／隊伍／賽事識別碼）→ 改寫為角色描述或 `UID-xxx`。
- Email → `<email>`。
- Token／API key／密碼 → `<token>`。
- 真實 event ID／team ID → `<event-id>`／`<team-id>`。

## 規則索引

本 skill 引用的 Rule ID（條文只在 `CLAUDE.md` 有 canonical 定義，此處不複製）：R-LOG-001～005、R-SAFE-012、R-DOC-001。
