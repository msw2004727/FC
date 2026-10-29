"use strict";

const fs = require("fs");
const path = require("path");
const { buildInboxMessageDoc } = require("../../functions/inbox-message-doc");

const SOURCE_PATH = path.join(__dirname, "../../functions/inbox-message-doc.js");
const BASE_KEYS = [
  "id", "title", "body", "preview", "type", "typeName", "time", "senderName", "fromUid",
  "read", "readAt", "actionType", "actionStatus", "reviewerName", "meta", "ref", "createdAt",
];

describe("buildInboxMessageDoc", () => {
  test("欄位鍵齊全且順序對齊 _writeToUserInbox，ref 用 id，createdAt 原樣放回", () => {
    const createdAt = { marker: "ts" };
    const doc = buildInboxMessageDoc({ id: "msg_1", title: "標題", body: "內文" }, { createdAt });
    expect(Object.keys(doc)).toEqual(BASE_KEYS);
    expect(doc.ref).toBe("messages/msg_1");
    expect(doc.createdAt).toBe(createdAt);
    expect(doc).toMatchObject({
      id: "msg_1",
      title: "標題",
      body: "內文",
      preview: "內文",
      type: "system",
      typeName: "系統",
      time: "",
      senderName: "系統",
      fromUid: null,
      read: false,
      readAt: null,
      actionType: null,
      actionStatus: null,
      reviewerName: null,
      meta: null,
    });
  });

  test("截斷 title 200、body 2000、preview 43；有 preview 就用 preview", () => {
    const doc = buildInboxMessageDoc({
      id: "msg_cut",
      title: "T".repeat(201),
      body: "B".repeat(2001),
      preview: "P".repeat(44),
    }, { createdAt: "TS" });
    expect(doc.title).toBe("T".repeat(200));
    expect(doc.body).toBe("B".repeat(2000));
    expect(doc.preview).toBe("P".repeat(43));
  });

  test("preview 空字串回退 body 再截 43；假值欄位走 _writeToUserInbox 的預設", () => {
    const doc = buildInboxMessageDoc({
      id: "msg_def",
      body: "B".repeat(50),
      preview: "",
      type: "",
      typeName: "",
      time: "",
      senderName: "",
      fromUid: "",
      read: true,
      actionType: "",
      actionStatus: "",
      reviewerName: "",
      meta: 0,
    }, { createdAt: "TS" });
    expect(doc.preview).toBe("B".repeat(43));
    expect(doc.type).toBe("system");
    expect(doc.typeName).toBe("系統");
    expect(doc.senderName).toBe("系統");
    expect(doc.time).toBe("");
    expect(doc.fromUid).toBeNull();
    expect(doc.read).toBe(false);
    expect(doc.readAt).toBeNull();
    expect(doc.actionType).toBeNull();
    expect(doc.actionStatus).toBeNull();
    expect(doc.reviewerName).toBeNull();
    expect(doc.meta).toBeNull();
  });

  test("有給 actionType、meta、type 就沿用，不另填 origin", () => {
    const meta = { kind: "keep" };
    const doc = buildInboxMessageDoc({
      id: "msg_keep",
      type: "private",
      typeName: "私訊",
      actionType: "review",
      actionStatus: "pending",
      reviewerName: "審",
      meta,
      fromUid: "system",
      senderName: "系統",
      time: "2026/10/27 16:00",
    }, { createdAt: "TS" });
    expect(doc).toMatchObject({
      type: "private",
      typeName: "私訊",
      actionType: "review",
      actionStatus: "pending",
      reviewerName: "審",
      fromUid: "system",
      senderName: "系統",
      time: "2026/10/27 16:00",
    });
    expect(doc.meta).toBe(meta);
    expect(Object.prototype.hasOwnProperty.call(doc, "origin")).toBe(false);
  });

  test("origin 只在非空字串時出現，且不改輸入物件", () => {
    const kept = Object.freeze({ id: "msg_o", title: "t", body: "b", meta: Object.freeze({ a: 1 }) });
    const absent = buildInboxMessageDoc(kept, { createdAt: "TS" });
    expect(kept).toEqual({ id: "msg_o", title: "t", body: "b", meta: { a: 1 } });
    expect(Object.keys(absent)).toEqual(BASE_KEYS);

    ["", null, undefined, 0, 1, false].forEach((origin) => {
      const doc = buildInboxMessageDoc({ id: "msg_o", origin }, { createdAt: "TS" });
      expect(Object.prototype.hasOwnProperty.call(doc, "origin")).toBe(false);
    });

    const source = Object.freeze({
      id: "msg_o",
      origin: "team_delete_role_change",
      meta: Object.freeze({ a: 1 }),
    });
    const present = buildInboxMessageDoc(source, { createdAt: "TS" });
    expect(source.origin).toBe("team_delete_role_change");
    expect(present.origin).toBe("team_delete_role_change");
    expect(Object.keys(present)).toEqual([...BASE_KEYS, "origin"]);

    const spaced = buildInboxMessageDoc({ id: "msg_o", origin: " " }, { createdAt: "TS" });
    expect(spaced.origin).toBe(" ");
  });

  test("沒有 id 時仍產生 id，ref 跟著該 id", () => {
    const doc = buildInboxMessageDoc({ title: "t" }, { createdAt: "TS" });
    expect(typeof doc.id).toBe("string");
    expect(doc.id.length).toBeGreaterThan(0);
    expect(doc.ref).toBe(`messages/${doc.id}`);
  });

  test("原始碼不 require guards 模組", () => {
    const source = fs.readFileSync(SOURCE_PATH, "utf8");
    expect(source).not.toContain("notification-guards");
    expect(source).not.toContain("enforceCallerLimit");
    expect(source).not.toContain("enforceDailyLimits");
  });
});
