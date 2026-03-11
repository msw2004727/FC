# 賽事重構規格索引

本資料夾用於整理 `友誼賽（friendly）` 重構前的施作規格，並為後續 `盃賽（cup）`、`聯賽（league）` 保留可延展的架構決策。

## 閱讀順序
1. `00-overview.md`
2. `01-domain-model.md`
3. `02-permissions.md`
4. `03-friendly-flow.md`
5. `04-ui-spec.md`
6. `05-notification-spec.md`
7. `06-implementation-phases.md`

## 第一階段範圍
- 正式落地 `友誼賽（friendly）`
- 建立主辦球隊制
- 建立球隊申請與主辦審核流程
- 建立已核准隊伍的隊員 roster 流程
- 建立站內信模板與通知規格

## 暫不實作但必須預留
- `盃賽（cup）`
- `聯賽（league）`
- bracket、積分榜、賽程表的完整執行邏輯

## 架構決策摘要
- `賽事（tournaments）` 保留為主文件集合
- 球隊申請與參賽隊伍改採子集合設計，避免把所有狀態長期塞在單一 tournament 文件
- 前端後續模組化目錄預留在 `js/modules/tournament/`

## 對應文件
- 規格文件：`docs/tournament-refactor/`
- 模組化預留目錄：`js/modules/tournament/README.md`
