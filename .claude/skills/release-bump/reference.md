# release-bump 參考

## Rule ID

- R-REL-001
- R-REL-002
- R-REL-003
- R-REL-004
- R-REL-005
- R-REL-006
- R-REL-007
- R-REL-008
- R-REL-009
- R-SAFE-001
- R-SHIP-017
- R-GOV-011

## 版號比對範圍

- 只比對符合 `?v=0.YYYYMMDD{suffix}` 格式的 asset query，與 `scripts/bump-version.js` 一致；其他 query version 不屬 bump 範圍（R-REL-003）。
- `<script type="application/json">` 資料塊內的 `?v=` 是 CI 注入資料，只提醒。

## 何時不 bump

- 只改 docs、specs、tools 或 Markdown，未動主站 runtime（R-REL-006、R-REL-007）。
- 只改 tests，未動主站 runtime（R-REL-006、R-REL-007）。
- 只改 functions 或 Cloud Functions 相關程式，未動主站前端資產（R-REL-006、R-REL-007）。
- 只改 firestore.rules、storage.rules 或其他 rules，未動主站 runtime（R-REL-006、R-REL-007）。
