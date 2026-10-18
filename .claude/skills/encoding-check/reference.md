# encoding-check 參考

## Rule ID

- R-ENC-001
- R-ENC-002
- R-ENC-003
- R-ENC-004
- R-ENC-005
- R-ENC-006
- R-ENC-007

## 檢查項目

- BOM。
- UTF-8 可解碼。
- CR／CRLF（只提醒，不判失敗）。
- U+FFFD、PUA、連續 `???`、典型雙重編碼模式。

## 提醒

- 終端亂碼不等於檔案損壞（R-ENC-005）。
