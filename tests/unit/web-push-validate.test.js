"use strict";

/**
 * 網頁推播 W2-B：常數與純函式（functions/web-push-config.js、functions/web-push-validate.js）。
 * 測試用的訂閱金鑰一律在執行時動態產生，不寫死任何看起來像真實金鑰的字串。
 */

const crypto = require("crypto");
const config = require("../../functions/web-push-config");
const v = require("../../functions/web-push-validate");

function dynamicKeys() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: crypto.randomBytes(16).toString("base64url"),
  };
}

describe("常數（顧問 §3.641 Q8）", () => {
  test("初值：每日 20、訂閱 5、作廢 30 分鐘、TTL 12 小時、單筆逾時 10 秒", () => {
    expect(config.WEB_PUSH_DAILY_LIMIT_PER_UID).toBe(20);
    expect(config.WEB_PUSH_MAX_SUBSCRIPTIONS_PER_UID).toBe(5);
    expect(config.WEB_PUSH_STALE_MS).toBe(30 * 60 * 1000);
    expect(config.WEB_PUSH_TTL_SECONDS).toBe(43200);
    expect(config.WEB_PUSH_REQUEST_TIMEOUT_MS).toBe(10000);
    expect(config.WEB_PUSH_REGISTER_REFRESH_SKIP_MS).toBe(24 * 60 * 60 * 1000);
    expect(config.WEB_PUSH_REGISTER_WRITES_PER_UID_PER_DAY).toBe(20);
  });

  test("W1 前公鑰與 key id 留空；填了就必須一致（key id = sha256(公鑰) 前 16 碼）", () => {
    if (config.WEB_PUSH_VAPID_PUBLIC_KEY === "") {
      expect(config.WEB_PUSH_VAPID_KEY_ID).toBe("");
    } else {
      expect(config.WEB_PUSH_VAPID_KEY_ID).toBe(v.computeVapidKeyId(config.WEB_PUSH_VAPID_PUBLIC_KEY));
    }
  });

  test("config 檔沒有任何私鑰欄位", () => {
    const source = require("fs").readFileSync(require.resolve("../../functions/web-push-config"), "utf8");
    expect(source).not.toMatch(/PRIVATE_KEY\s*=|privateKey\s*:/);
  });

  test("subject 是公開網址、點擊路徑是站內信頁、Callable 選項無秘密", () => {
    expect(config.WEB_PUSH_VAPID_SUBJECT).toBe("https://toosterx.com");
    expect(config.WEB_PUSH_CLICK_URL).toBe("/inbox");
    expect(config.WEB_PUSH_CALLABLE_OPTIONS).toEqual({
      region: "asia-east1", minInstances: 0, timeoutSeconds: 10, memory: "256MiB", maxInstances: 3,
    });
  });

  test("後綴白名單全部以點開頭", () => {
    for (const suffix of Object.keys(config.WEB_PUSH_ENDPOINT_SUFFIX_HOSTS)) expect(suffix.startsWith(".")).toBe(true);
  });
});

describe("classifyEndpoint：https＋主機白名單", () => {
  test.each([
    ["https://fcm.googleapis.com/fcm/send/abc", "fcm"],
    ["https://fcm.googleapis.com/wp/abc", "fcm"],
    ["https://updates.push.services.mozilla.com/wpush/v2/abc", "mozilla"],
    ["https://web.push.apple.com/QabcDEF", "apple"],
    ["https://api.push.apple.com/3/device/x", "apple"],
    ["https://wns2-par02p.notify.windows.com/w/?token=abc", "wns"],
    ["https://FCM.googleapis.com/fcm/send/abc", "fcm"],
  ])("收：%s → %s", (endpoint, service) => {
    expect(v.classifyEndpoint(endpoint)).toEqual({ ok: true, service });
  });

  test.each([
    ["http 不收", "http://fcm.googleapis.com/fcm/send/abc"],
    ["帶 port", "https://fcm.googleapis.com:8443/fcm/send/abc"],
    ["帶 443 以外也不行、帶帳密", "https://user:pw@fcm.googleapis.com/fcm/send/abc"],
    ["只有帳號", "https://user@fcm.googleapis.com/fcm/send/abc"],
    ["IPv4", "https://142.250.0.1/fcm/send/abc"],
    ["IPv6", "https://[::1]/fcm/send/abc"],
    ["非白名單", "https://push.example.test/send/abc"],
    ["假冒後綴（沒有點）", "https://evilnotify.windows.com/w/?token=abc"],
    ["假冒後綴（apple）", "https://evilpush.apple.com/abc"],
    ["只有後綴本身", "https://notify.windows.com/w/?token=abc"],
    ["精確主機加前綴", "https://evil.fcm.googleapis.com/fcm/send/abc"],
    ["精確主機加後綴", "https://fcm.googleapis.com.evil.test/fcm/send/abc"],
    ["白名單主機當子網域", "https://fcm.googleapis.com.notify.windows.com.evil.test/x"],
    ["legacy GCM", "https://android.googleapis.com/gcm/send/abc"],
  ])("拒（host）：%s", (_label, endpoint) => {
    expect(v.classifyEndpoint(endpoint)).toEqual({ ok: false, reason: "rejected_host" });
  });

  test.each([
    ["非字串", 123],
    ["空字串", ""],
    ["超長", `https://fcm.googleapis.com/fcm/send/${"a".repeat(1024)}`],
    ["含換行", "https://fcm.googleapis.com/fcm/send/a\nb"],
    ["含空白", "https://fcm.googleapis.com/fcm/send/a b"],
    ["非 ASCII", "https://fcm.googleapis.com/fcm/send/測試"],
    ["解析不了", "https//fcm.googleapis.com"],
  ])("拒（format）：%s", (_label, endpoint) => {
    expect(v.classifyEndpoint(endpoint)).toEqual({ ok: false, reason: "rejected_format" });
  });

  // 審查 P3-1：補拒收案例（原因可能是 host 或 format，只要不收）
  test.each([
    ["http:", "http://fcm.googleapis.com/fcm/send/abc"],
    ["精確主機結尾點", "https://fcm.googleapis.com./fcm/send/abc"],
    ["後綴主機結尾點", "https://wns2-par02p.notify.windows.com./w/?token=abc"],
    ["xn-- punycode 仿冒", "https://xn--fcm-0na.googleapis.com/fcm/send/abc"],
    ["全形點（URL 會正規化成 fcm.googleapis.com，必須在原字串就擋）", "https://fcm。googleapis。com/fcm/send/abc"],
    ["十六進位 IP", "https://0x7f.1/fcm/send/abc"],
    ["十進位 IP", "https://2130706433/fcm/send/abc"],
    ["[::1]", "https://[::1]/fcm/send/abc"],
    ["帶帳密", "https://user:pw@web.push.apple.com/abc"],
    [":8443", "https://web.push.apple.com:8443/abc"],
    ["evilfcm…attacker", "https://evilfcm.googleapis.com.attacker/fcm/send/abc"],
  ])("拒（審查 P3-1）：%s", (_label, endpoint) => {
    expect(v.classifyEndpoint(endpoint).ok).toBe(false);
  });

  // 審查 P3-2：主機不得有空 label
  test.each([
    ["a..push.apple.com", "https://a..push.apple.com/abc"],
    ["x..notify.windows.com", "https://x..notify.windows.com/w/?token=abc"],
    ["開頭點", "https://.push.apple.com/abc"],
  ])("拒（空 label）：%s", (_label, endpoint) => {
    expect(v.classifyEndpoint(endpoint)).toEqual({ ok: false, reason: "rejected_host" });
  });

  test("長度剛好 1024 收", () => {
    const base = "https://fcm.googleapis.com/fcm/send/";
    expect(v.classifyEndpoint(base + "a".repeat(1024 - base.length)).ok).toBe(true);
  });
});

describe("validateSubscriptionKeys", () => {
  test("動態產生的 P-256 公鑰與 16 bytes auth 通過", () => {
    const keys = dynamicKeys();
    expect(v.validateSubscriptionKeys(keys)).toEqual(keys);
  });

  test.each([
    ["缺 keys", undefined],
    ["p256dh 長度錯", { p256dh: Buffer.alloc(64, 4).toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") }],
    ["p256dh 首 byte 不是 0x04", { p256dh: Buffer.concat([Buffer.from([2]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(16, 1).toString("base64url") }],
    ["auth 長度錯", { p256dh: Buffer.concat([Buffer.from([4]), Buffer.alloc(64, 1)]).toString("base64url"), auth: Buffer.alloc(15, 1).toString("base64url") }],
    ["非 base64url 字元", { p256dh: "a+b/", auth: "c+d/" }],
    ["非字串", { p256dh: 1, auth: 2 }],
  ])("拒：%s", (_label, keys) => {
    expect(v.validateSubscriptionKeys(keys)).toBeNull();
  });
});

describe("id 與平台", () => {
  test("subId／uidHash 為 32 碼十六進位且不含原值", () => {
    const endpoint = "https://fcm.googleapis.com/fcm/send/abc";
    expect(v.subscriptionIdOf(endpoint)).toMatch(/^[0-9a-f]{32}$/);
    expect(v.subscriptionIdOf(endpoint)).toBe(v.subscriptionIdOf(endpoint));
    expect(v.uidHashOf("Uabc")).toMatch(/^[0-9a-f]{32}$/);
  });

  test("queueId 由 kind／eventId／收件者／opKey 決定，任一不同就不同", () => {
    const base = { kind: "signup", eventId: "ce_1", recipientUid: "Ua", opKey: "r1" };
    const id = v.queueIdOf(base);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(v.queueIdOf({ ...base })).toBe(id);
    for (const patch of [{ kind: "promoted" }, { eventId: "ce_2" }, { recipientUid: "Ub" }, { opKey: "r2" }]) {
      expect(v.queueIdOf({ ...base, ...patch })).not.toBe(id);
    }
  });

  test("key id 是公鑰 sha256 前 16 碼", () => {
    const key = "test-only-public-key";
    expect(v.computeVapidKeyId(key)).toBe(crypto.createHash("sha256").update(key).digest("hex").slice(0, 16));
  });

  test("platform 不在清單存 other", () => {
    expect(v.normalizePlatform("android")).toBe("android");
    expect(v.normalizePlatform("ios_pwa")).toBe("ios_pwa");
    expect(v.normalizePlatform("windows-phone")).toBe("other");
    expect(v.normalizePlatform(undefined)).toBe("other");
  });
});

describe("buildPushPayload：欄位白名單（設計 §6.3）", () => {
  test("Object.keys 精確等於 v,title,body,url", () => {
    const payload = JSON.parse(v.buildPushPayload({ title: "報名成功通知", body: "內文", url: "/inbox" }));
    expect(Object.keys(payload)).toEqual(["v", "title", "body", "url"]);
    expect(v.PUSH_PAYLOAD_KEYS).toEqual(["v", "title", "body", "url"]);
    expect(payload).toEqual({ v: 1, title: "報名成功通知", body: "內文", url: "/inbox" });
  });

  test("多餘欄位不會進 payload", () => {
    const payload = JSON.parse(v.buildPushPayload({
      title: "t", body: "b", url: "/inbox", recipientUid: "Ux", eventId: "ce_1", kind: "signup", endpoint: "https://x",
    }));
    expect(Object.keys(payload)).toEqual(["v", "title", "body", "url"]);
  });

  test("標題截 80、內文截 180（以字元計，不切壞 emoji）", () => {
    const payload = JSON.parse(v.buildPushPayload({ title: "題".repeat(100), body: "😀".repeat(200), url: "/inbox" }));
    expect(Array.from(payload.title)).toHaveLength(80);
    expect(Array.from(payload.body)).toHaveLength(180);
    expect(payload.body).toBe("😀".repeat(180));
  });

  test.each([
    ["https://evil.test/", "/"],
    ["//evil.test/", "/"],
    ["/\\evil.test", "/"],
    ["javascript:alert(1)", "/"],
    ["/inbox\n", "/"],
    [undefined, "/"],
    ["/inbox", "/inbox"],
  ])("url 只收站內相對路徑：%s → %s", (url, expected) => {
    expect(JSON.parse(v.buildPushPayload({ title: "t", body: "b", url })).url).toBe(expected);
  });
});

describe("新活動通知設定（F2）", () => {
  test("T-CFG-01 種類與 source 白名單", () => {
    expect(config.WEB_PUSH_KINDS).toEqual(["signup", "promoted", "cancelled", "removed", "new_event"]);
    expect(config.WEB_PUSH_SOURCE_KINDS).toEqual({
      registration: ["signup", "promoted", "cancelled", "removed"],
      newEvent: ["new_event"],
    });
    expect(Object.isFrozen(config.WEB_PUSH_KINDS)).toBe(true);
    expect(Object.isFrozen(config.WEB_PUSH_SOURCE_KINDS)).toBe(true);
    expect(Object.isFrozen(config.WEB_PUSH_SOURCE_KINDS.registration)).toBe(true);
    expect(Object.isFrozen(config.WEB_PUSH_SOURCE_KINDS.newEvent)).toBe(true);
  });

  test("T-CFG-02 新活動常數", () => {
    expect(config.WEB_PUSH_NEW_EVENT_DAILY_LIMIT_PER_UID).toBe(5);
    expect(config.WEB_PUSH_NEW_EVENT_DAILY_PREFIX).toBe("ne_");
    expect(config.WEB_PUSH_NEW_EVENT_URL_RE.source).toBe("^\\/events\\/[A-Za-z0-9_-]{1,64}$");
  });
});
