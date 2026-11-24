"use strict";

/**
 * 網頁推播（W2-B）常數：只放公開值與上限，私鑰只在 Secret Manager（WEB_PUSH_VAPID_PRIVATE_KEY，只綁 sendWebPushFromQueue）。
 * - 公鑰與 key id 已於 W1（2026-11-24 站長點頭建立金鑰）填入；key id＝computeVapidKeyId(公鑰)（測試鎖住兩者一致）。
 *   任一留空時註冊 Callable 拒收、發送函式停發（fail-closed）；發送前另核對私鑰推出的公鑰與本常數相同，不符即停發。
 * - 主機白名單依各家官方文件（出處見 WEB_PUSH_ENDPOINT_HOST_SOURCES），實機主機待 W5 測試複核。
 * - 常數初值照顧問 §3.641 Q8：每日 20、訂閱 5、作廢 30 分鐘、推播 TTL 12 小時、單筆逾時 10 秒。
 */

// 公開值（W1 填入）；私鑰只在 Secret Manager，不進 repo
const WEB_PUSH_VAPID_PUBLIC_KEY = "BH_ixX7vhX5QjtwewYj-50ylvKTaGiV4ErQMVSJiXIL7H3gGFKY4QwJFeB35GzqZLxG7Ia2Pft3Cw4ywUNmpyRY";
const WEB_PUSH_VAPID_KEY_ID = "726cade1dd107515";
const WEB_PUSH_VAPID_SUBJECT = "https://toosterx.com";

// E3 備用停發：改 false 重新部署發送函式即停發（主手段是控制文件 webPushControl/sender.sendEnabled）
const WEB_PUSH_SENDER_ENABLED = true;

const WEB_PUSH_COLLECTIONS = Object.freeze({
  subscriptions: "webPushSubscriptions",
  queue: "webPushQueue",
  daily: "webPushDaily",
  control: "webPushControl",
});
const WEB_PUSH_CONTROL_DOC_ID = "sender";

const WEB_PUSH_DAILY_LIMIT_PER_UID = 20;
const WEB_PUSH_MAX_SUBSCRIPTIONS_PER_UID = 5;
const WEB_PUSH_STALE_MS = 30 * 60 * 1000;
const WEB_PUSH_TTL_SECONDS = 12 * 60 * 60;
const WEB_PUSH_REQUEST_TIMEOUT_MS = 10 * 1000;

// 顧問 §3.641 a：同一 subId、同金鑰、24 小時內回報過就不寫；每人每日註冊寫入上限（不計 noop）
const WEB_PUSH_REGISTER_REFRESH_SKIP_MS = 24 * 60 * 60 * 1000;
const WEB_PUSH_REGISTER_WRITES_PER_UID_PER_DAY = 20;

// 保存期限（TTL policy 不在本卡建立，只寫 expireAt 欄位預留，顧問 §3.641 Q7）
const WEB_PUSH_QUEUE_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const WEB_PUSH_DAILY_RETENTION_MS = 2 * 24 * 60 * 60 * 1000;
const WEB_PUSH_SUBSCRIPTION_RETENTION_MS = 120 * 24 * 60 * 60 * 1000;

const WEB_PUSH_TITLE_MAX = 80;
const WEB_PUSH_BODY_MAX = 180;
const WEB_PUSH_ENDPOINT_MAX_LENGTH = 1024;

// 點通知開站內信頁（Q4）；不帶活動代號。新站實際路徑於 W5 確認
const WEB_PUSH_CLICK_URL = "/inbox";

// 主機白名單：精確比對＋以點開頭的後綴比對（evilnotify.windows.com 不算）
const WEB_PUSH_ENDPOINT_EXACT_HOSTS = Object.freeze({
  "fcm.googleapis.com": "fcm",
  "updates.push.services.mozilla.com": "mozilla",
});
const WEB_PUSH_ENDPOINT_SUFFIX_HOSTS = Object.freeze({
  ".push.apple.com": "apple",
  ".notify.windows.com": "wns",
});
const WEB_PUSH_ENDPOINT_HOST_SOURCES = Object.freeze({
  fcm: "https://developer.chrome.com/blog/web-push-interop-wins",
  mozilla: "https://mozilla-services.github.io/autopush-rs/",
  apple: "https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers",
  wns: "https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/wns-overview",
});

const WEB_PUSH_PLATFORMS = Object.freeze(["android", "desktop", "ios_pwa", "other"]);
const WEB_PUSH_KINDS = Object.freeze(["signup", "promoted", "cancelled", "removed"]);

const WEB_PUSH_CALLABLE_OPTIONS = Object.freeze({
  region: "asia-east1",
  minInstances: 0,
  timeoutSeconds: 10,
  memory: "256MiB",
  maxInstances: 3,
});

module.exports = {
  WEB_PUSH_VAPID_PUBLIC_KEY,
  WEB_PUSH_VAPID_KEY_ID,
  WEB_PUSH_VAPID_SUBJECT,
  WEB_PUSH_SENDER_ENABLED,
  WEB_PUSH_COLLECTIONS,
  WEB_PUSH_CONTROL_DOC_ID,
  WEB_PUSH_DAILY_LIMIT_PER_UID,
  WEB_PUSH_MAX_SUBSCRIPTIONS_PER_UID,
  WEB_PUSH_STALE_MS,
  WEB_PUSH_TTL_SECONDS,
  WEB_PUSH_REQUEST_TIMEOUT_MS,
  WEB_PUSH_REGISTER_REFRESH_SKIP_MS,
  WEB_PUSH_REGISTER_WRITES_PER_UID_PER_DAY,
  WEB_PUSH_QUEUE_RETENTION_MS,
  WEB_PUSH_DAILY_RETENTION_MS,
  WEB_PUSH_SUBSCRIPTION_RETENTION_MS,
  WEB_PUSH_TITLE_MAX,
  WEB_PUSH_BODY_MAX,
  WEB_PUSH_ENDPOINT_MAX_LENGTH,
  WEB_PUSH_CLICK_URL,
  WEB_PUSH_ENDPOINT_EXACT_HOSTS,
  WEB_PUSH_ENDPOINT_SUFFIX_HOSTS,
  WEB_PUSH_ENDPOINT_HOST_SOURCES,
  WEB_PUSH_PLATFORMS,
  WEB_PUSH_KINDS,
  WEB_PUSH_CALLABLE_OPTIONS,
};
