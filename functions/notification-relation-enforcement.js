"use strict";

/**
 * 通知發送授權強化（第 2 批）：關係類別的強制常數（純資料，無 I/O）。
 * 模式只放在 RELATION_ENFORCEMENT。relationMode 不接受覆寫，也不讀 request。
 */

const RELATION_ENFORCEMENT = Object.freeze({
  R0: "enforce",
  R1: "log",
  R2: "log",
  R3: "log",
  R4: "log",
  R5: "log",
  R6: "log",
  R7: "enforce",
  R8: "log",
  R9: "log",
});

// 只用自身屬性。constructor、__proto__、toString 在原型上，不得誤命中。
function relationMode(id) {
  if (typeof id !== "string") return "log";
  if (Object.prototype.hasOwnProperty.call(RELATION_ENFORCEMENT, id)) {
    return RELATION_ENFORCEMENT[id];
  }
  return "log";
}

module.exports = {
  RELATION_ENFORCEMENT,
  relationMode,
};
