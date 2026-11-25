"use strict";

/**
 * 測試用：以指定的 push 值重新編譯 functions/registration-notify.js（正式程式沒有任何覆寫入口）。
 * 開通實測段（2026-11-25）起正式常數為 push:true；push:false 情境改由 loadNotifyWithPushOff 保護
 * （取代原本「直接 require 正式常數就是 false」的寫法）。兩個載入器在正式常數為 true 或 false 時都能用，
 * 所以突變（把常數改回 false）時只有斷言「正式常數為 true」的案例會紅。
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

const NOTIFY_FILE = path.join(__dirname, "../../functions/registration-notify.js");
const PUSH_OFF = "Object.freeze({ inbox: true, line: false, push: false })";
const PUSH_ON = "Object.freeze({ inbox: true, line: false, push: true })";

function loadNotifyWithPush(pushValue) {
  const source = fs.readFileSync(NOTIFY_FILE, "utf8");
  // 常數字面恰出現一次（true 或 false 其一），否則替換可能落空、測到的不是指定狀態
  expect(source.split(PUSH_OFF).length + source.split(PUSH_ON).length).toBe(3);
  const target = pushValue ? PUSH_ON : PUSH_OFF;
  const patched = source.replace(pushValue ? PUSH_OFF : PUSH_ON, target);
  expect(patched.split(target)).toHaveLength(2);
  const mod = new Module(NOTIFY_FILE, null);
  mod.filename = NOTIFY_FILE;
  mod.paths = Module._nodeModulePaths(path.dirname(NOTIFY_FILE));
  mod._compile(patched, NOTIFY_FILE);
  expect(mod.exports.REGISTRATION_NOTIFY_CHANNELS.push).toBe(pushValue);
  return mod.exports;
}

const loadNotifyWithPushOn = () => loadNotifyWithPush(true);
const loadNotifyWithPushOff = () => loadNotifyWithPush(false);

module.exports = { NOTIFY_FILE, loadNotifyWithPushOn, loadNotifyWithPushOff };
