"use strict";

/**
 * 網頁推播（W2-B）純函式：endpoint／金鑰／平台驗證、文件 id 計算、推播 payload 組裝與白名單。
 * 不碰 Firestore、不載入 web-push；常數見 web-push-config.js。
 */

const crypto = require("crypto");
const config = require("./web-push-config");

const sha256Prefix = (value, length) => crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, length);

// 公鑰指紋：sha256(公鑰字串) 前 16 碼
function computeVapidKeyId(publicKey) {
  return sha256Prefix(publicKey, 16);
}

// 同一裝置重訂閱落在同一份；id 不含 uid、不含原始 endpoint
function subscriptionIdOf(endpoint) {
  return sha256Prefix(endpoint, 32);
}

function uidHashOf(uid) {
  return sha256Prefix(uid, 32);
}

// dedupeKey = wp1|{kind}|{eventId}|{recipientUid}|{opKey}；eventId 只進雜湊
function queueIdOf({ kind, eventId, recipientUid, opKey }) {
  return sha256Prefix(`wp1|${kind}|${eventId}|${recipientUid}|${opKey}`, 32);
}

const PRINTABLE_ASCII = /^[\x21-\x7e]+$/;
const IPV4_LITERAL = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * endpoint 驗證：https、無帳密、無 port、非 IP、主機在白名單、≤ 1024、只有可見 ASCII（不讓 URL 解析器默默吃掉空白或換行）。
 * 回 { ok: true, service } 或 { ok: false, reason: "rejected_format" | "rejected_host" }
 */
function classifyEndpoint(endpoint) {
  if (typeof endpoint !== "string" || endpoint.length === 0 || endpoint.length > config.WEB_PUSH_ENDPOINT_MAX_LENGTH) {
    return { ok: false, reason: "rejected_format" };
  }
  if (!PRINTABLE_ASCII.test(endpoint)) return { ok: false, reason: "rejected_format" };
  let url;
  try {
    url = new URL(endpoint);
  } catch (_error) {
    return { ok: false, reason: "rejected_format" };
  }
  if (url.protocol !== "https:" || url.username !== "" || url.password !== "" || url.port !== "") {
    return { ok: false, reason: "rejected_host" };
  }
  const host = url.hostname.toLowerCase();
  if (!host || host.startsWith("[") || IPV4_LITERAL.test(host)) return { ok: false, reason: "rejected_host" };
  // 不得有空 label（a..push.apple.com、結尾點），否則後綴比對會被繞過（審查 P3-2）
  if (host.split(".").some((label) => label === "")) return { ok: false, reason: "rejected_host" };
  if (Object.prototype.hasOwnProperty.call(config.WEB_PUSH_ENDPOINT_EXACT_HOSTS, host)) {
    return { ok: true, service: config.WEB_PUSH_ENDPOINT_EXACT_HOSTS[host] };
  }
  for (const [suffix, service] of Object.entries(config.WEB_PUSH_ENDPOINT_SUFFIX_HOSTS)) {
    // 後綴一定以點開頭，且點前面至少要有一段子網域
    if (suffix.startsWith(".") && host.length > suffix.length && host.endsWith(suffix)) {
      return { ok: true, service };
    }
  }
  return { ok: false, reason: "rejected_host" };
}

const BASE64URL = /^[A-Za-z0-9_-]+={0,2}$/;

function decodeBase64Url(value, maxLength) {
  if (typeof value !== "string" || value.length === 0 || value.length > maxLength || !BASE64URL.test(value)) return null;
  return Buffer.from(value.replace(/=+$/, ""), "base64url");
}

// p256dh 解碼後 65 bytes 且首 byte 0x04（未壓縮 P-256 點）；auth 解碼後 16 bytes
function validateSubscriptionKeys(keys) {
  if (!keys || typeof keys !== "object") return null;
  const p256dh = decodeBase64Url(keys.p256dh, 128);
  const auth = decodeBase64Url(keys.auth, 32);
  if (!p256dh || p256dh.length !== 65 || p256dh[0] !== 0x04) return null;
  if (!auth || auth.length !== 16) return null;
  return { p256dh: keys.p256dh, auth: keys.auth };
}

function normalizePlatform(platform) {
  return config.WEB_PUSH_PLATFORMS.includes(platform) ? platform : "other";
}

// 依 code point 截斷，不切壞代理對
function truncateText(value, max) {
  const chars = Array.from(String(value ?? ""));
  return chars.length > max ? chars.slice(0, max).join("") : chars.join("");
}

// 只接受站內相對路徑（/ 開頭、不是 //、不含反斜線與控制字元），否則開首頁
function safeRelativeUrl(url) {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//")) return "/";
  if (/[\\\x00-\x1f\x7f]/.test(url)) return "/";
  return url;
}

const PUSH_PAYLOAD_KEYS = Object.freeze(["v", "title", "body", "url"]);

// 推播加密內容：只能有 v、title、body、url（設計 §6.3）
function buildPushPayload({ title, body, url }) {
  return JSON.stringify({
    v: 1,
    title: truncateText(title, config.WEB_PUSH_TITLE_MAX),
    body: truncateText(body, config.WEB_PUSH_BODY_MAX),
    url: safeRelativeUrl(url),
  });
}

module.exports = {
  PUSH_PAYLOAD_KEYS,
  buildPushPayload,
  classifyEndpoint,
  computeVapidKeyId,
  normalizePlatform,
  queueIdOf,
  safeRelativeUrl,
  subscriptionIdOf,
  truncateText,
  uidHashOf,
  validateSubscriptionKeys,
};
