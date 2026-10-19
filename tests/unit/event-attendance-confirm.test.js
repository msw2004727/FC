"use strict";

const {
  buildPeopleList,
  buildBaseRecord,
  collectAttendanceOps,
  planAttendanceConfirm,
  computeCompleteActivityTargets,
  createConfirmEventAttendanceHandler,
} = require("../../functions/event-attendance-confirm");

class MockHttpsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

describe("confirmEventAttendance — pure function & callable", () => {
  describe("planAttendanceConfirm participant resolution (golden scenarios from attendance-confirm.test.js)", () => {
    test("all registered users appear in people list and get attendance adds", () => {
      const regs = [
        { userId: "u1", userName: "Alice", participantType: "self", status: "confirmed" },
        { userId: "u2", userName: "Bob", participantType: "self", status: "confirmed" },
      ];
      const plan = planAttendanceConfirm({
        eventData: { id: "evt1" },
        registrations: regs,
        currentRecords: [],
        desired: {
          u1: { checkin: true, checkout: false, note: "" },
          u2: { checkin: true, checkout: true, note: "on time" },
        },
        timeStr: "2026/05/01 10:00",
      });

      expect(plan.people).toHaveLength(2);
      expect(plan.people.map((p) => p.name)).toEqual(["Alice", "Bob"]);
      expect(plan.people.every((p) => !p.isCompanion)).toBe(true);
      expect(plan.adds).toHaveLength(4); // u1 checkin + u2 checkin, checkout, note
      expect(plan.expTargets).toEqual(["u2"]);
    });

    test("UID comes from registration data (userId field)", () => {
      const regs = [
        { userId: "line_uid_123", userName: "Alice", participantType: "self", status: "confirmed" },
      ];
      const plan = planAttendanceConfirm({
        eventData: { id: "evt1" },
        registrations: regs,
        currentRecords: [],
        desired: { line_uid_123: { checkin: true } },
      });
      expect(plan.people[0].uid).toBe("line_uid_123");
      expect(plan.adds[0].uid).toBe("line_uid_123");
    });

    test("companion participants get derived uid and resolve parent userId on write", () => {
      const regs = [
        { userId: "u1", userName: "Alice", participantType: "self", status: "confirmed" },
        {
          userId: "u1",
          userName: "Alice",
          participantType: "companion",
          companionId: "comp1",
          companionName: "Bob",
          status: "confirmed",
        },
      ];
      const plan = planAttendanceConfirm({
        eventData: { id: "evt1" },
        registrations: regs,
        currentRecords: [],
        desired: {
          u1: { checkin: true },
          comp1: { checkin: true },
        },
      });

      expect(plan.people).toHaveLength(2);
      const alice = plan.people.find((p) => p.name === "Alice");
      expect(alice.uid).toBe("u1");
      expect(alice.isCompanion).toBe(false);

      const bob = plan.people.find((p) => p.name === "Bob");
      expect(bob.uid).toBe("comp1");
      expect(bob.isCompanion).toBe(true);

      const compAdd = plan.adds.find((a) => a.participantType === "companion");
      expect(compAdd).toMatchObject({
        eventId: "evt1",
        uid: "u1",
        userName: "Alice",
        participantType: "companion",
        companionId: "comp1",
        companionName: "Bob",
        type: "checkin",
      });
    });

    test("companion without companionId gets derived uid from userId + companionName", () => {
      const regs = [
        { userId: "u1", userName: "Alice", participantType: "self", status: "confirmed" },
        {
          userId: "u1",
          userName: "Alice",
          participantType: "companion",
          companionName: "Carol",
          status: "confirmed",
        },
      ];
      const plan = planAttendanceConfirm({
        eventData: { id: "evt1" },
        registrations: regs,
        currentRecords: [],
        desired: { u1_Carol: { checkin: true } },
      });
      const carol = plan.people.find((p) => p.name === "Carol");
      expect(carol.uid).toBe("u1_Carol");
      expect(carol.isCompanion).toBe(true);
      expect(plan.adds[0]).toMatchObject({
        uid: "u1",
        companionId: "u1_Carol",
        companionName: "Carol",
        participantType: "companion",
      });
    });

    test("already-confirmed users not duplicated via participantsWithUid, and name-only participants are ignored (R-STAT-003)", () => {
      const regs = [
        { userId: "u1", userName: "Alice", participantType: "self", status: "confirmed" },
      ];
      const eventData = {
        id: "evt1",
        current: 2,
        participants: ["Alice", "Bob", "NameOnlyGhost"],
        participantsWithUid: [
          { uid: "u1", name: "Alice" },
          { uid: "u2", name: "Bob" },
        ],
      };
      const plan = planAttendanceConfirm({
        eventData,
        registrations: regs,
        currentRecords: [],
        desired: { u1: { checkin: true }, u2: { checkin: true } },
      });
      expect(plan.people).toHaveLength(2);
      expect(plan.people.map((p) => p.uid)).toEqual(["u1", "u2"]);
    });

    test("empty registration list and empty participants -> empty people", () => {
      const plan = planAttendanceConfirm({
        eventData: { id: "evt1" },
        registrations: [],
        currentRecords: [],
        desired: {},
      });
      expect(plan.people).toHaveLength(0);
      expect(plan.adds).toHaveLength(0);
      expect(plan.removes).toHaveLength(0);
    });

    test("multiple companions from same user and group without self reg", () => {
      const regs = [
        { userId: "u1", userName: "AliceMain", participantType: "companion", companionId: "c1", companionName: "Bob", status: "confirmed" },
        { userId: "u1", userName: "AliceMain", participantType: "companion", companionId: "c2", companionName: "Carol", status: "confirmed" },
      ];
      const plan = planAttendanceConfirm({
        eventData: { id: "evt1" },
        registrations: regs,
        currentRecords: [],
        desired: { c1: { checkin: true }, c2: { checkin: true } },
      });
      expect(plan.people).toHaveLength(2);
      expect(plan.people[0]).toMatchObject({ name: "Bob", uid: "c1", isCompanion: true });
      expect(plan.people[1]).toMatchObject({ name: "Carol", uid: "c2", isCompanion: true });
    });

    test("unchecking checkin removes both existing checkin and checkout records", () => {
      const regs = [
        { userId: "u1", userName: "Alice", participantType: "self", status: "confirmed" },
      ];
      const currentRecords = [
        { _docId: "doc_in", id: "att_1", eventId: "evt1", uid: "u1", participantType: "self", type: "checkin", status: "active" },
        { _docId: "doc_out", id: "att_2", eventId: "evt1", uid: "u1", participantType: "self", type: "checkout", status: "active" },
      ];
      const plan = planAttendanceConfirm({
        eventData: { id: "evt1" },
        registrations: regs,
        currentRecords,
        desired: { u1: { checkin: false, checkout: false, note: "" } },
      });
      expect(plan.adds).toHaveLength(0);
      expect(plan.removes.map((r) => r._docId).sort()).toEqual(["doc_in", "doc_out"]);
    });
  });

  describe("buildPeopleList", () => {
    test("missing UID in fallback skips participant", () => {
      const registrations = [];
      const eventData = {
        participantsWithUid: [
          { name: "Known", uid: "u_known" },
          { name: "Ghost" }, // 沒有 uid
        ],
        current: 2,
      };
      const people = buildPeopleList({ eventData, registrations });
      expect(people).toHaveLength(1);
      expect(people[0].name).toBe("Known");
      expect(people[0].uid).toBe("u_known");
    });

    test("刻意偏離 A：名稱反查後再取 lineUserId 的補位不移植", () => {
      // A 的同名測試是先用 displayName「Legacy」在 adminUsers 找到使用者，再取其 lineUserId（event-manage-confirm.js 的 _userByName 路徑），
      // 本質是名稱比對（R-STAT-003／R-ID-002），伺服器版不移植；只有名稱、沒有 uid 的參加者一律略過。
      const registrations = [];
      const eventData = {
        participantsWithUid: [{ name: "Legacy", lineUserId: "line_legacy" }],
        current: 1,
      };
      const people = buildPeopleList({ eventData, registrations });
      expect(people).toHaveLength(0);
    });

    test("刻意偏離 A：只有名稱、沒有 uid 的參加者不會被加入", () => {
      const registrations = [];
      const eventData = {
        participantsWithUid: [
          { name: "OldUser" }, // 只有名稱，沒有 uid
        ],
        current: 1,
      };
      const people = buildPeopleList({ eventData, registrations });
      // 刻意偏離舊站：新版只用 uid，不以名稱比對（R-STAT-003／R-ID-002）
      expect(people).toHaveLength(0);
    });

    test("empty registration list — only participants fallback used", () => {
      const registrations = [];
      const eventData = {
        participantsWithUid: [
          { name: "Alice", uid: "u1" },
          { name: "Bob" }, // 無 uid，應被忽略（照第 3 條）
        ],
        current: 2,
      };
      const people = buildPeopleList({ eventData, registrations });
      expect(people).toHaveLength(1);
      expect(people[0].name).toBe("Alice");
      expect(people[0].uid).toBe("u1");
      expect(people[0].isCompanion).toBe(false);
    });
  });

  describe("buildBaseRecord guards (golden scenarios)", () => {
    test("non-companion person uses own uid and name", () => {
      const person = { name: "Alice", uid: "u1", isCompanion: false };
      const resolved = buildBaseRecord(person, [], "evt1");
      expect(resolved.ok).toBe(true);
      const record = resolved.record;
      expect(record.uid).toBe("u1");
      expect(record.userName).toBe("Alice");
      expect(record.participantType).toBe("self");
      expect(record.companionId).toBeNull();
      expect(record.companionName).toBeNull();
    });

    test("companion person resolves parent userId from registration", () => {
      const person = { name: "Bob", uid: "comp1", isCompanion: true };
      const allRegs = [
        { userId: "u1", userName: "Alice", companionId: "comp1", participantType: "companion", status: "confirmed" },
      ];
      const resolved = buildBaseRecord(person, allRegs, "evt1");
      expect(resolved.ok).toBe(true);
      const record = resolved.record;
      expect(record.uid).toBe("u1");
      expect(record.userName).toBe("Alice");
      expect(record.companionId).toBe("comp1");
      expect(record.companionName).toBe("Bob");
      expect(record.participantType).toBe("companion");
    });

    test("companion derived uid resolves owner registration when companionId is missing", () => {
      const person = { name: "Guest", uid: "owner_uid_Guest", ownerUid: "owner_uid", isCompanion: true };
      const allRegs = [
        { userId: "owner_uid", userName: "Owner", companionName: "Guest", participantType: "companion", status: "confirmed" },
      ];
      const resolved = buildBaseRecord(person, allRegs, "evt1");
      expect(resolved.ok).toBe(true);
      expect(resolved.record.uid).toBe("owner_uid");
      expect(resolved.record.companionId).toBe("owner_uid_Guest");
      expect(resolved.record.participantType).toBe("companion");
    });

    test("eventId is passed through to baseRecord", () => {
      const person = { name: "Alice", uid: "u1", isCompanion: false };
      const record = buildBaseRecord(person, [], "event_abc").record;
      expect(record.eventId).toBe("event_abc");
    });

    test("companion without matching registration is blocked", () => {
      const person = { name: "Orphan", uid: "orphan_uid", isCompanion: true };
      const resolved = buildBaseRecord(person, [], "evt1");
      expect(resolved.ok).toBe(false);
      expect(resolved.reason).toBe("companion_registration_missing");
    });

    test("comp_ pseudo uid resolves as companion even when stale map marks self", () => {
      const person = { name: "Guest", uid: "comp_1776681312140", isCompanion: false };
      const allRegs = [
        {
          userId: "U1234567890abcdef1234567890abcdef",
          userName: "Owner",
          companionId: "comp_1776681312140",
          companionName: "Guest",
          participantType: "companion",
          status: "confirmed",
        },
      ];
      const resolved = buildBaseRecord(person, allRegs, "evt1");
      expect(resolved.ok).toBe(true);
      expect(resolved.record.uid).toBe("U1234567890abcdef1234567890abcdef");
      expect(resolved.record.participantType).toBe("companion");
      expect(resolved.record.companionId).toBe("comp_1776681312140");
    });

    test("comp_ pseudo uid without registration is blocked instead of self attendance", () => {
      const person = { name: "Ghost", uid: "comp_1776681312140", isCompanion: false };
      const resolved = buildBaseRecord(person, [], "evt1");
      expect(resolved.ok).toBe(false);
      expect(resolved.reason).toBe("companion_registration_missing");
    });

    test("same companion name requires owner scope instead of guessing wrong owner", () => {
      const allRegs = [
        { userId: "owner_a", userName: "Owner A", companionName: "Guest", participantType: "companion", status: "confirmed" },
        { userId: "owner_b", userName: "Owner B", companionName: "Guest", participantType: "companion", status: "confirmed" },
      ];
      expect(buildBaseRecord({ name: "Guest", uid: "legacy_guest", isCompanion: true }, allRegs, "evt1").ok).toBe(false);

      const resolved = buildBaseRecord({ name: "Guest", uid: "owner_b_Guest", ownerUid: "owner_b", isCompanion: true }, allRegs, "evt1");
      expect(resolved.ok).toBe(true);
      expect(resolved.record.uid).toBe("owner_b");
    });
  });

  describe("collectAttendanceOps", () => {
    test("collect guard refuses comp_ as attendance uid", () => {
      const person = { uid: "comp_123", name: "Guest", isCompanion: false };
      const wanted = { checkin: true, checkout: false, note: "" };
      const currentRecords = [];
      const eventId = "evt1";
      const timeStr = "2026/05/01 10:00";
      const baseRecord = { uid: "comp_123", userName: "Guest", participantType: "self" };
      const idCounter = { v: 1 };
      const randomSuffixFn = () => "abc";
      const ops = collectAttendanceOps(
        person,
        wanted,
        currentRecords,
        eventId,
        timeStr,
        baseRecord,
        idCounter,
        randomSuffixFn
      );
      expect(ops.blocked).toBe(true);
      expect(ops.adds).toHaveLength(0);
    });
  });

  describe("Callable handler: permissions, docId resolution, and subcollection writes", () => {
    function createMockEnvironment({
      canOperate = true,
      eventExists = true,
      regs = [],
      attRecords = [],
    } = {}) {
      const setCalls = [];
      const updateCalls = [];
      let autoIdCounter = 1;

      const attColRef = {
        path: "events/event_doc_999/attendanceRecords",
        doc: jest.fn((docId) => ({
          id: docId || `gen_att_${autoIdCounter++}`,
          path: `events/event_doc_999/attendanceRecords/${docId || `gen_att_${autoIdCounter - 1}`}`,
        })),
      };
      const regsColRef = { path: "events/event_doc_999/registrations" };

      const eventDoc = eventExists
        ? {
            exists: true,
            id: "event_doc_999",
            data: () => ({ id: "evt_public_1", title: "Test Event", current: regs.length }),
            ref: {
              id: "event_doc_999",
              path: "events/event_doc_999",
              collection: jest.fn((name) => {
                if (name === "registrations") return regsColRef;
                if (name === "attendanceRecords") return attColRef;
                throw new Error(`Unexpected subcollection: ${name}`);
              }),
            },
          }
        : null;

      const transaction = {
        get: jest.fn(async (target) => {
          if (target === regsColRef) {
            return {
              docs: regs.map((r, i) => ({ id: r._docId || `reg_${i}`, data: () => r })),
            };
          }
          if (target === attColRef) {
            return {
              docs: attRecords.map((a, i) => ({ id: a._docId || `att_doc_${i}`, data: () => a })),
            };
          }
          return { docs: [] };
        }),
        set: jest.fn((ref, payload) => setCalls.push({ ref, payload })),
        update: jest.fn((ref, payload) => updateCalls.push({ ref, payload })),
      };

      const db = {
        runTransaction: jest.fn(async (fn) => fn(transaction)),
      };

      const handler = createConfirmEventAttendanceHandler({
        HttpsError: MockHttpsError,
        db,
        FieldValue: { serverTimestamp: () => "SERVER_TS" },
        getCallerAccessContext: jest.fn(async () => ({ role: "coach" })),
        canOperateEventSiteForAccess: jest.fn(() => canOperate),
        getEventDocByPublicIdInTransaction: jest.fn(async (_tx, publicId) =>
          publicId === "evt_public_1" ? eventDoc : null
        ),
        formatTimeStr: () => "2026/05/01 12:00",
        logger: { error: jest.fn() },
      });

      return { handler, setCalls, updateCalls };
    }

    test("rejects unauthenticated requests", async () => {
      const { handler } = createMockEnvironment();
      await expect(handler({ auth: null, data: { eventId: "evt_public_1", desired: {} } }))
        .rejects.toMatchObject({ code: "unauthenticated" });
    });

    test("rejects when caller lacks site operation permission", async () => {
      const { handler } = createMockEnvironment({ canOperate: false });
      await expect(
        handler({
          auth: { uid: "caller_1" },
          data: { eventId: "evt_public_1", desired: { u1: { checkin: true } } },
        })
      ).rejects.toMatchObject({ code: "permission-denied" });
    });

    test("resolves public eventId to docId and writes only to events/{docId}/attendanceRecords", async () => {
      const { handler, setCalls, updateCalls } = createMockEnvironment({
        regs: [
          { _docId: "r1", userId: "U_LINE_1", userName: "Alice", participantType: "self", status: "confirmed" },
        ],
        attRecords: [
          {
            _docId: "old_out_doc",
            id: "att_old_out",
            eventId: "evt_public_1",
            uid: "U_LINE_1",
            userName: "Alice",
            participantType: "self",
            type: "checkout",
            status: "active",
          },
        ],
      });

      const res = await handler({
        auth: { uid: "operator_uid" },
        data: {
          eventId: "evt_public_1",
          desired: {
            U_LINE_1: { checkin: true, checkout: false, note: "遲到5分鐘" },
          },
        },
      });

      // 測試同步更新（R-QA-005）：回傳新增 expTargets（取消簽退後未完成，故為空）。
      expect(res).toEqual({ success: true, added: 2, removed: 1, expTargets: [] });

      // 驗證新增寫入路徑與 payload 形狀（uid 為 LINE UID，eventId 為 public id）
      expect(setCalls).toHaveLength(2);
      expect(setCalls[0].ref.path).toMatch(/^events\/event_doc_999\/attendanceRecords\//);
      expect(setCalls[0].payload).toMatchObject({
        eventId: "evt_public_1",
        uid: "U_LINE_1",
        userName: "Alice",
        participantType: "self",
        companionId: null,
        companionName: null,
        type: "checkin",
        time: "2026/05/01 12:00",
        status: "active",
        createdAt: "SERVER_TS",
      });
      expect(setCalls[1].payload).toMatchObject({
        eventId: "evt_public_1",
        uid: "U_LINE_1",
        type: "note",
        note: "遲到5分鐘",
        status: "active",
      });

      // 驗證軟刪除寫入路徑與 payload
      expect(updateCalls).toHaveLength(1);
      expect(updateCalls[0].ref.path).toBe("events/event_doc_999/attendanceRecords/old_out_doc");
      expect(updateCalls[0].payload).toEqual({
        status: "removed",
        removedByUid: "operator_uid",
        removedAt: "SERVER_TS",
      });
    });
  });
});

describe("computeCompleteActivityTargets（完成活動經驗值對象：最終狀態同時有簽到與簽退）", () => {
  const self = (uid) => ({ uid, name: uid, isCompanion: false });
  const rec = (docId, uid, type, extra = {}) => ({ _docId: docId, uid, type, participantType: "self", status: "active", ...extra });

  test("既有紀錄已完整簽到簽退的人也列入（即時存檔先寫好的情況）", () => {
    const records = [rec("a", "U1", "checkin"), rec("b", "U1", "checkout"), rec("c", "U2", "checkin")];
    expect(computeCompleteActivityTargets([self("U1"), self("U2")], records, { adds: [], removes: [] })).toEqual(["U1"]);
  });

  test("套用本次新增與軟刪除後再判斷", () => {
    const records = [rec("a", "U1", "checkin"), rec("b", "U1", "checkout"), rec("c", "U2", "checkin")];
    const plan = {
      adds: [{ uid: "U2", type: "checkout", participantType: "self", status: "active" }],
      removes: [{ _docId: "b" }],
    };
    expect(computeCompleteActivityTargets([self("U1"), self("U2")], records, plan)).toEqual(["U2"]);
  });

  test("已移除的紀錄、同行者不列入，重複 uid 只算一次", () => {
    const records = [
      rec("a", "U1", "checkin"),
      rec("b", "U1", "checkout", { status: "removed" }),
      rec("c", "U1", "checkin", { participantType: "companion", companionId: "C1", companionName: "小明" }),
      rec("d", "U1", "checkout", { participantType: "companion", companionId: "C1", companionName: "小明" }),
      rec("e", "U3", "checkin"),
      rec("f", "U3", "checkout"),
    ];
    const people = [self("U1"), { uid: "C1", name: "小明", isCompanion: true }, self("U3"), self("U3")];
    expect(computeCompleteActivityTargets(people, records, { adds: [], removes: [] })).toEqual(["U3"]);
  });
});

describe("normalizeAttendanceSelection（照 A event-manage-attendance.js）", () => {
  const { normalizeAttendanceSelection } = require("../../functions/event-attendance-confirm");
  test("只勾簽退時自動視為已簽到（不是丟掉簽退）", () => {
    expect(normalizeAttendanceSelection({ checkin: false, checkout: true })).toMatchObject({ checkin: true, checkout: true });
  });
  test("都不勾維持都不勾", () => {
    expect(normalizeAttendanceSelection({ checkin: false, checkout: false })).toMatchObject({ checkin: false, checkout: false });
  });
});
