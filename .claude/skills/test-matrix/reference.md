# test-matrix 參考

## 檔案對照

| 變更檔案 | 命令 | Rule ID |
| --- | --- | --- |
| `js/**`、`css/**`、`pages/**`、`index.html`、`app.js`、`sw.js` | `npm run test:unit` | — |
| `css/**`、`pages/**`、`index.html` | 需 UI 瀏覽器驗證 | R-QA-010～013 |
| 鎖定檔清單 | `npm run check:registration-ops` | R-EXEC-016／R-STAT-001 |
| `firestore.rules`、`storage.rules`、`tests/firestore-rules/**` | `npm run test:rules` | — |
| `functions/**` | `npm run test:functions` + `npm run test:unit` | — |
| `CLAUDE.md`、`AGENTS.md`、`GEMINI.md`、`NAVIGATION.md`、`.claude/rules/**` | `node scripts/check-rules-integrity.js`；含 `NAVIGATION.md` 加 `--nav` | — |
| `seo/**`、`sitemap*.xml`、`robots.txt`、`_headers`、`blog/**` | `npm run test:unit` | — |
| 純 `docs/**`、`tools/**`、其他 `*.md` | 無 runtime test | — |

## 鎖定檔清單

- `js/firebase-crud.js`
- `js/firebase-service.js`
- `js/api-service.js`
- `js/modules/event/event-detail-signup.js`
- `js/modules/event/event-detail-companion.js`
- `js/modules/event/event-create-waitlist.js`
- `js/modules/event/event-manage-noshow.js`
- `js/modules/event/event-manage-confirm.js`
- `js/modules/achievement/stats.js`
- `js/modules/leaderboard.js`
- `js/modules/education/edu-course-enrollment.js`
- `functions/index.js`
- `functions/edu-course-enrollment-core.js`

## 已知 drift

- `tests/firestore-rules/tournament-match-rules.test.js` 未被 aggregate 收錄（R-QA-008）。
- `test:functions` 只跑 `tests/unit/cloud-functions.test.js`（R-QA-009）。
