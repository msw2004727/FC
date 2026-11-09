/**
 * 積分調整授權強化：直接跑 functions/index.js 真正的 adjustExp handler
 * （vm 載入整份 index.js、firebase-* 換成假的、記憶體版 Firestore）。
 *
 * requestId 形狀對照（呼叫端清單見 local-only 卡片附錄）：
 *  - B 結算：autoexp_<uid>_complete_activity_<eventId>（不帶 ruleKey）
 *  - A _grantAutoExp：autoexp_<uid>_<ruleKey>_<時間戳>（不帶 ruleKey）
 *  - A _reconcileAutoExp：autoexp_<uid>_<ruleKey>_<預期總額>_<時間戳>_<段號>（帶 ruleKey）
 *  - A／B line_binding：autoexp_<uid>_line_binding（本人）
 */

const { createFakeFirestore, loadFunctionsIndex } = require('./registration-callable-harness');

const U_SELF = `U${'1'.repeat(32)}`;
const U_OTHER = `U${'2'.repeat(32)}`;
const U_COACH = `U${'3'.repeat(32)}`;
const U_EXP_ADMIN = `U${'4'.repeat(32)}`;
const U_DELEGATE = `U${'5'.repeat(32)}`;
const U_CREATOR = `U${'6'.repeat(32)}`;
const U_OWNER_FIELD = `U${'7'.repeat(32)}`;
const U_DELEGATE_ELSEWHERE = `U${'8'.repeat(32)}`;
const U_SUPER = `U${'9'.repeat(32)}`;
const U_CAPTAIN_FIELD = `U${'a'.repeat(32)}`;
const EVENT_ID = 'ce_1800000000000_abc';
const EVENT_ID_2 = 'ce_1800000000001_def';
const TS = '1762650000000';

let fn;
let harness;
let fake;

beforeAll(() => {
  const loaded = loadFunctionsIndex();
  fn = loaded.exports;
  harness = loaded.harness;
});

beforeEach(() => {
  jest.spyOn(console, 'info').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
  harness.logs.length = 0;
});

function user(uid, extra = {}) {
  return { uid, lineUserId: uid, name: `name-${uid.slice(0, 4)}`, displayName: `user-${uid.slice(1, 3)}`, role: 'user', exp: 200, ...extra };
}

function seed(extra = {}) {
  fake = createFakeFirestore({
    [`users/${U_SELF}`]: user(U_SELF),
    [`users/${U_OTHER}`]: user(U_OTHER),
    [`users/${U_COACH}`]: user(U_COACH, { role: 'coach' }),
    [`users/${U_EXP_ADMIN}`]: user(U_EXP_ADMIN, { role: 'exp_clerk' }),
    [`users/${U_DELEGATE}`]: user(U_DELEGATE),
    [`users/${U_CREATOR}`]: user(U_CREATOR),
    [`users/${U_OWNER_FIELD}`]: user(U_OWNER_FIELD),
    [`users/${U_CAPTAIN_FIELD}`]: user(U_CAPTAIN_FIELD),
    [`users/${U_DELEGATE_ELSEWHERE}`]: user(U_DELEGATE_ELSEWHERE),
    [`users/${U_SUPER}`]: user(U_SUPER, { role: 'super_admin' }),
    // 自訂角色：等級視為 0，只靠 admin.exp.entry
    'rolePermissions/exp_clerk': { permissions: ['admin.exp.entry'] },
    [`events/${EVENT_ID}`]: { id: EVENT_ID, title: 'e1', creatorUid: U_CREATOR, ownerUid: U_OWNER_FIELD, delegateUids: [U_DELEGATE] },
    [`events/${EVENT_ID_2}`]: { id: EVENT_ID_2, title: 'e2', creatorUid: U_CREATOR, captainUid: U_CAPTAIN_FIELD, delegateUids: [U_DELEGATE_ELSEWHERE] },
    'teams/tm_1': { name: 'team-1', teamExp: 9990 },
    ...extra,
  });
  harness.current = fake;
}

function call(uid, data) {
  return fn.adjustExp({ auth: uid ? { uid } : null, data });
}

function auto(target, extra = {}) {
  return { mode: 'auto', targets: [target], amount: 30, reason: '自動：完成活動（e1）', operatorLabel: '系統', ...extra };
}

async function expectDenied(promise, code = 'permission-denied') {
  await expect(promise).rejects.toMatchObject({ code });
}

function deniedLogs() {
  return harness.logs.filter((row) => row[0] === 'warn' && row[1] === 'autoexp_denied');
}

function expOf(uid) {
  return fake.get(`users/${uid}`).exp;
}

const bId = (uid, eventId = EVENT_ID) => `autoexp_${uid}_complete_activity_${eventId}`;
const aId = (uid, key = 'complete_activity') => `autoexp_${uid}_${key}_${TS}`;
const noshowId = (uid, total = -50) => `autoexp_${uid}_noshow_penalty_${total}_${TS}_0`;

describe('auto 模式：目標是本人', () => {
  beforeEach(() => seed());

  test('本人照舊放行（不限規則），去重紀錄與寫入同批建立', async () => {
    const requestId = `autoexp_${U_SELF}_line_binding`;
    const res = await call(U_SELF, auto(U_SELF, { amount: 100, ruleKey: 'line_binding', requestId }));
    expect(res.success).toBe(true);
    expect(res.results[0]).toMatchObject({ success: true, oldExp: 200, newExp: 300 });
    expect(fake.has(`_expDedupe/${requestId}`)).toBe(true);
    const dedupWrite = fake.state.writes.find((w) => w.path === `_expDedupe/${requestId}`);
    const expWrite = fake.state.writes.find((w) => w.path === `users/${U_SELF}`);
    expect(dedupWrite.via).toBe('batch');
    expect(dedupWrite.commit).toBe(expWrite.commit);
  });

  test('同一 requestId 第二次回 deduplicated，不重複加分', async () => {
    const requestId = `autoexp_${U_SELF}_line_binding`;
    await call(U_SELF, auto(U_SELF, { amount: 100, requestId }));
    const res = await call(U_SELF, auto(U_SELF, { amount: 100, requestId }));
    expect(res).toEqual({ success: true, deduplicated: true });
    expect(expOf(U_SELF)).toBe(300);
  });

  test('本人仍限 ±100', async () => {
    await expectDenied(call(U_SELF, auto(U_SELF, { amount: 101 })), 'invalid-argument');
    await expectDenied(call(U_SELF, auto(U_SELF, { amount: -101 })), 'invalid-argument');
  });

  test('本人不帶 requestId 照舊放行', async () => {
    const res = await call(U_SELF, auto(U_SELF, { amount: 10 }));
    expect(res.results[0].success).toBe(true);
  });

  test.each([
    ['A 主辦活動', aId(U_SELF, 'host_activity'), undefined],
    ['A 徽章對帳', `autoexp_${U_SELF}_badge_bonus_200_${TS}_0`, 'badge_bonus'],
    ['A 取消報名', aId(U_SELF, 'cancel_registration'), undefined],
    ['A 報名活動', aId(U_SELF, 'register_activity'), undefined],
    ['A 加入俱樂部', aId(U_SELF, 'join_team'), undefined],
    ['B 主辦活動', aId(U_SELF, 'host_activity'), 'host_activity'],
  ])('既有本人形狀照常通過：%s', async (_label, requestId, ruleKey) => {
    const res = await call(U_SELF, auto(U_SELF, { amount: 10, requestId, ...(ruleKey ? { ruleKey } : {}) }));
    expect(res.results[0].success).toBe(true);
  });

  test('去重鍵 uid 段不是目標時拒絕，且不建立去重紀錄；目標本人之後仍可使用', async () => {
    const requestId = `autoexp_${U_OTHER}_line_binding`;
    await expectDenied(call(U_SELF, auto(U_SELF, { amount: 100, requestId })));
    expect(fake.has(`_expDedupe/${requestId}`)).toBe(false);
    expect(expOf(U_SELF)).toBe(200);
    expect(deniedLogs()[0][2]).toMatchObject({ reason: 'request_id_owner' });
    const res = await call(U_OTHER, auto(U_OTHER, { amount: 100, requestId }));
    expect(res.results[0].success).toBe(true);
    expect(expOf(U_OTHER)).toBe(300);
  });

  test.each([
    ['任意字串', 'manual-1'],
    ['未知規則名', `autoexp_${U_SELF}_free_points`],
    ['uid 段含底線（切段後不是規則名）', `autoexp_${U_SELF}_x_line_binding`],
    ['尾段含斜線', `autoexp_${U_SELF}_line_binding_a/b`],
    ['非字串', 12345],
  ])('auto 模式的 requestId 必須是白名單格式：%s → invalid-argument，不佔用去重鍵', async (_label, requestId) => {
    await expectDenied(call(U_SELF, auto(U_SELF, { amount: 5, requestId })), 'invalid-argument');
    if (typeof requestId === 'string' && !requestId.includes('/')) {
      expect(fake.has(`_expDedupe/${requestId}`)).toBe(false);
    }
    expect(expOf(U_SELF)).toBe(200);
  });

  test('manual 模式仍可使用任意 requestId（auto 不再能先佔）', async () => {
    await expectDenied(call(U_SELF, auto(U_SELF, { amount: 5, requestId: 'manual-1' })), 'invalid-argument');
    const res = await call(U_EXP_ADMIN, { mode: 'manual', targets: [U_OTHER], amount: 5, reason: 'x', requestId: 'manual-1' });
    expect(res.results[0].success).toBe(true);
  });

  test('不認 lineUserId：uid 段是本人的 lineUserId（與 docId 不同）→ 拒絕', async () => {
    const legacy = `L${'a'.repeat(32)}`;
    seed({ [`users/${U_SELF}`]: user(U_SELF, { lineUserId: legacy }) });
    const requestId = `autoexp_${legacy}_line_binding`;
    await expectDenied(call(U_SELF, auto(U_SELF, { amount: 100, requestId })));
    expect(fake.has(`_expDedupe/${requestId}`)).toBe(false);
  });

  test('本人路徑查到的文件不是本人（只有 lineUserId 吻合）→ 拒絕，不改到該文件', async () => {
    const noDoc = `U${'c'.repeat(32)}`;
    const otherDoc = `U${'d'.repeat(32)}`;
    seed({ [`users/${otherDoc}`]: user(otherDoc, { lineUserId: noDoc }) });
    await expectDenied(call(noDoc, auto(noDoc, { amount: 100, requestId: `autoexp_${noDoc}_line_binding` })));
    await expectDenied(call(noDoc, auto(noDoc, { amount: 100 })));
    expect(expOf(otherDoc)).toBe(200);
    expect(deniedLogs()[0][2]).toMatchObject({ reason: 'target_mismatch' });
  });

  test('本人路徑查到的文件只有 uid 欄位吻合（docId 不同）→ 拒絕', async () => {
    const alias = `U${'e'.repeat(32)}`;
    const legacyDoc = `U${'f'.repeat(32)}`;
    seed({ [`users/${legacyDoc}`]: user(alias, { lineUserId: legacyDoc }) });
    await expectDenied(call(alias, auto(alias, { amount: 100 })));
    expect(fake.get(`users/${legacyDoc}`).exp).toBe(200);
  });
});

describe('auto 模式：參數', () => {
  beforeEach(() => seed());

  test('未登入拒絕', async () => {
    await expectDenied(call(null, auto(U_SELF)), 'unauthenticated');
  });

  test.each([
    ['targets 空陣列', []],
    ['多個目標', [U_SELF, U_OTHER]],
    ['targets 不是陣列', U_SELF],
    ['目標型別錯誤（數字）', [123]],
    ['目標空字串', ['']],
    ['目標 null', [null]],
  ])('%s → invalid-argument，且不建立去重紀錄', async (_label, targets) => {
    const requestId = `autoexp_${U_SELF}_line_binding`;
    await expectDenied(call(U_SELF, { ...auto(U_SELF, { requestId }), targets }), 'invalid-argument');
    expect(fake.has(`_expDedupe/${requestId}`)).toBe(false);
  });

  test('目標查無使用者：回 not_found，不建立去重紀錄', async () => {
    const ghost = `U${'0'.repeat(32)}`;
    const requestId = bId(ghost);
    const res = await call(U_COACH, auto(ghost, { requestId }));
    expect(res.results[0]).toMatchObject({ success: false, error: 'not_found' });
    expect(fake.has(`_expDedupe/${requestId}`)).toBe(false);
  });

  test('不讀 siteConfig/autoExpRules：設定文件不存在也照常代發', async () => {
    const res = await call(U_COACH, auto(U_OTHER, { requestId: bId(U_OTHER) }));
    expect(res.results[0].success).toBe(true);
    expect(fake.has('siteConfig/autoExpRules')).toBe(false);
  });
});

describe('auto 模式：目標不是本人，requestId 必填與歸屬', () => {
  beforeEach(() => seed());

  test('一般用戶且不帶任何 requestId／ruleKey → invalid-argument', async () => {
    await expectDenied(call(U_SELF, auto(U_OTHER)), 'invalid-argument');
    expect(deniedLogs()[0][2]).toMatchObject({ reason: 'request_id', hasEventId: false });
  });

  test('代發只帶 ruleKey、或隨機字串 → invalid-argument（教練、委託人也一樣）', async () => {
    await expectDenied(call(U_COACH, auto(U_OTHER, { ruleKey: 'complete_activity' })), 'invalid-argument');
    await expectDenied(call(U_COACH, auto(U_OTHER, { ruleKey: 'complete_activity', requestId: 'rnd-1' })), 'invalid-argument');
    await expectDenied(call(U_DELEGATE, auto(U_OTHER, { ruleKey: 'complete_activity', eventId: EVENT_ID })), 'invalid-argument');
    expect(fake.has('_expDedupe/rnd-1')).toBe(false);
    expect(expOf(U_OTHER)).toBe(200);
    expect(deniedLogs().every((row) => row[2].reason === 'request_id')).toBe(true);
  });

  test('代發的去重鍵 uid 段必須是目標本人', async () => {
    await expectDenied(call(U_COACH, auto(U_OTHER, { requestId: bId(U_SELF) })));
    expect(fake.has(`_expDedupe/${bId(U_SELF)}`)).toBe(false);
    expect(expOf(U_OTHER)).toBe(200);
  });

  test('代發的去重鍵 uid 段含底線（前綴碰撞形狀）→ invalid-argument', async () => {
    const requestId = `autoexp_${U_OTHER}_x_complete_activity_${EVENT_ID}`;
    await expectDenied(call(U_COACH, auto(U_OTHER, { requestId })), 'invalid-argument');
    expect(fake.has(`_expDedupe/${requestId}`)).toBe(false);
  });

  test('代發目標用 uid 欄位別名（docId 不同）→ 拒絕，不改到該文件', async () => {
    const alias = `U${'e'.repeat(32)}`;
    const legacyDoc = `U${'f'.repeat(32)}`;
    seed({ [`users/${legacyDoc}`]: user(alias, { lineUserId: legacyDoc }) });
    await expectDenied(call(U_COACH, auto(alias, { requestId: bId(alias) })));
    expect(fake.get(`users/${legacyDoc}`).exp).toBe(200);
    expect(fake.has(`_expDedupe/${bId(alias)}`)).toBe(false);
  });
});

describe('auto 模式：目標不是本人，呼叫者身分', () => {
  beforeEach(() => seed());

  test('教練以上（角色等級）可代發 complete_activity（B 結算形狀，不帶 ruleKey）', async () => {
    const res = await call(U_COACH, auto(U_OTHER, { requestId: bId(U_OTHER) }));
    expect(res.results[0]).toMatchObject({ success: true, oldExp: 200, newExp: 230 });
    expect(fake.has(`_expDedupe/${bId(U_OTHER)}`)).toBe(true);
  });

  test('super_admin 可代發', async () => {
    const res = await call(U_SUPER, auto(U_OTHER, { requestId: bId(U_OTHER) }));
    expect(res.results[0].success).toBe(true);
  });

  test('具 admin.exp.entry 的自訂角色（等級 0）可代發 noshow_penalty（A 對帳形狀）', async () => {
    const res = await call(U_EXP_ADMIN, auto(U_OTHER, { amount: -50, ruleKey: 'noshow_penalty', requestId: noshowId(U_OTHER), reason: '自動：放鴿子扣分（1 次 × -50）' }));
    expect(res.results[0]).toMatchObject({ success: true, newExp: 150 });
  });

  test('一般用戶擔任該活動委託人：requestId 帶活動 ID 時放行', async () => {
    const res = await call(U_DELEGATE, auto(U_OTHER, { requestId: bId(U_OTHER) }));
    expect(res.results[0].success).toBe(true);
  });

  test('活動的 ownerUid 也算主辦（與 Rules isEventOwnerOrDelegateForData 一致）', async () => {
    const res = await call(U_OWNER_FIELD, auto(U_OTHER, { requestId: bId(U_OTHER) }));
    expect(res.results[0].success).toBe(true);
  });

  test('request.data.eventId 優先於 requestId 解析', async () => {
    // requestId 指向 EVENT_ID（不是委託），data.eventId 指向 EVENT_ID_2（是委託）
    const res = await call(U_DELEGATE_ELSEWHERE, auto(U_OTHER, { requestId: bId(U_OTHER), eventId: EVENT_ID_2 }));
    expect(res.results[0].success).toBe(true);
  });

  test('一般用戶是別場活動的委託人：指定活動不符時拒絕（不退回廣查）', async () => {
    await expectDenied(call(U_DELEGATE_ELSEWHERE, auto(U_OTHER, { requestId: bId(U_OTHER) })));
    expect(expOf(U_OTHER)).toBe(200);
  });

  test('指定的活動不存在時拒絕', async () => {
    await expectDenied(call(U_DELEGATE, auto(U_OTHER, { requestId: bId(U_OTHER, 'ce_missing_x') })));
  });

  test.each([
    ['creatorUid', U_CREATOR],
    ['ownerUid', U_OWNER_FIELD],
    ['captainUid', U_CAPTAIN_FIELD],
    ['delegateUids', U_DELEGATE_ELSEWHERE],
  ])('A 時間戳形狀（無活動 ID）：一般用戶在任一活動的 %s → 退回查詢後放行', async (_field, caller) => {
    const res = await call(caller, auto(U_OTHER, { requestId: aId(U_OTHER) }));
    expect(res.results[0].success).toBe(true);
  });

  test('退回查詢命中即停：creatorUid 命中時只查一段', async () => {
    const before = fake.state.reads.direct;
    await call(U_CREATOR, auto(U_OTHER, { requestId: aId(U_OTHER) }));
    const creatorReads = fake.state.reads.direct - before;
    seed();
    const before2 = fake.state.reads.direct;
    await call(U_DELEGATE_ELSEWHERE, auto(U_OTHER, { requestId: aId(U_OTHER) }));
    // 委託人要查完前三段才命中第四段，比 creatorUid 多 3 次讀取
    expect(fake.state.reads.direct - before2 - creatorReads).toBe(3);
  });

  test('拿不到活動 ID、也不是任何活動主辦／委託的一般用戶 → 拒絕', async () => {
    await expectDenied(call(U_SELF, auto(U_OTHER, { requestId: aId(U_OTHER) })));
    expect(fake.has(`_expDedupe/${aId(U_OTHER)}`)).toBe(false);
    expect(expOf(U_OTHER)).toBe(200);
    const [log] = deniedLogs();
    expect(log[2]).toMatchObject({ reason: 'caller', ruleKey: 'complete_activity', callerRoleLevel: 0, hasEventId: false });
    // log 只留遮罩過的 uid
    expect(JSON.stringify(log)).not.toContain(U_SELF);
  });
});

describe('auto 模式：目標不是本人，規則與金額', () => {
  beforeEach(() => seed());

  test.each(['line_binding', 'host_activity', 'badge_bonus', 'cancel_registration', 'join_team'])(
    '非白名單 ruleKey %s 一律拒絕（即使是教練）',
    async (ruleKey) => {
      await expectDenied(call(U_COACH, auto(U_OTHER, { amount: 10, ruleKey, requestId: aId(U_OTHER, ruleKey) })));
      expect(fake.has(`_expDedupe/${aId(U_OTHER, ruleKey)}`)).toBe(false);
      expect(deniedLogs()[0][2]).toMatchObject({ reason: 'rule_key' });
    }
  );

  test('ruleKey 與 requestId 解析結果不一致 → 拒絕', async () => {
    await expectDenied(call(U_COACH, auto(U_OTHER, { ruleKey: 'complete_activity', requestId: noshowId(U_OTHER) })));
  });

  test('complete_activity：正值、上限 100', async () => {
    await expectDenied(call(U_COACH, auto(U_OTHER, { amount: -30, requestId: bId(U_OTHER) })));
    await expectDenied(call(U_COACH, auto(U_OTHER, { amount: 101, requestId: bId(U_OTHER) })), 'invalid-argument');
    expect(fake.has(`_expDedupe/${bId(U_OTHER)}`)).toBe(false);
    const res = await call(U_COACH, auto(U_OTHER, { amount: 100, requestId: bId(U_OTHER) }));
    expect(res.results[0]).toMatchObject({ success: true, newExp: 300 });
  });

  test('noshow_penalty：管理者（教練以上／admin.exp.entry）可 −100～+100（退分與多次合併）', async () => {
    const r1 = await call(U_COACH, auto(U_OTHER, { amount: 50, ruleKey: 'noshow_penalty', requestId: noshowId(U_OTHER, 0) }));
    expect(r1.results[0]).toMatchObject({ success: true, newExp: 250 });
    const r2 = await call(U_EXP_ADMIN, auto(U_OTHER, { amount: -100, ruleKey: 'noshow_penalty', requestId: noshowId(U_OTHER, -150) }));
    expect(r2.results[0]).toMatchObject({ success: true, newExp: 150 });
    await expectDenied(call(U_COACH, auto(U_OTHER, { amount: 101, ruleKey: 'noshow_penalty', requestId: noshowId(U_OTHER, 1) })), 'invalid-argument');
    await expectDenied(call(U_COACH, auto(U_OTHER, { amount: 0, ruleKey: 'noshow_penalty', requestId: noshowId(U_OTHER, 2) })), 'invalid-argument');
  });

  test('noshow_penalty：只靠活動關係通過的一般用戶只能扣分（≤100）', async () => {
    await expectDenied(call(U_DELEGATE, auto(U_OTHER, { amount: 50, ruleKey: 'noshow_penalty', requestId: noshowId(U_OTHER, 0) })));
    expect(deniedLogs()[0][2]).toMatchObject({ reason: 'amount', callerRoleLevel: 0 });
    const res = await call(U_DELEGATE, auto(U_OTHER, { amount: -100, ruleKey: 'noshow_penalty', requestId: noshowId(U_OTHER, -100) }));
    expect(res.results[0]).toMatchObject({ success: true, newExp: 100 });
  });

  test('register_activity 固定 +10', async () => {
    const id = aId(U_OTHER, 'register_activity');
    await expectDenied(call(U_COACH, auto(U_OTHER, { amount: 20, requestId: id })));
    await expectDenied(call(U_COACH, auto(U_OTHER, { amount: -10, requestId: id })));
    const res = await call(U_COACH, auto(U_OTHER, { amount: 10, requestId: id }));
    expect(res.results[0]).toMatchObject({ success: true, newExp: 210 });
  });

  test('已接受的回歸：A 非 CF 退回路徑由一般用戶（取消者）代發被遞補者 register_activity → 拒絕', async () => {
    await expectDenied(call(U_SELF, auto(U_OTHER, { amount: 10, requestId: aId(U_OTHER, 'register_activity') })));
    expect(expOf(U_OTHER)).toBe(200);
  });

  test('被拒後同一 requestId 仍可由合法呼叫者使用（去重紀錄未被佔用）', async () => {
    await expectDenied(call(U_SELF, auto(U_OTHER, { requestId: bId(U_OTHER) })));
    expect(fake.has(`_expDedupe/${bId(U_OTHER)}`)).toBe(false);
    const res = await call(U_DELEGATE, auto(U_OTHER, { requestId: bId(U_OTHER) }));
    expect(res.results[0].success).toBe(true);
    const again = await call(U_DELEGATE, auto(U_OTHER, { requestId: bId(U_OTHER) }));
    expect(again).toEqual({ success: true, deduplicated: true });
    expect(expOf(U_OTHER)).toBe(230);
  });
});

describe('manual／batch／team／teamExp 行為不變', () => {
  beforeEach(() => seed());

  test('manual：沒有 admin.exp.entry 拒絕（教練也一樣）', async () => {
    const data = { mode: 'manual', targets: [U_OTHER], amount: 500, reason: '補發' };
    await expectDenied(call(U_SELF, data));
    await expectDenied(call(U_COACH, data));
  });

  test('manual：有權限不受 auto 規則與 ±100 限制；requestId 去重照舊', async () => {
    const data = { mode: 'manual', targets: [U_OTHER], amount: 500, reason: '補發', requestId: 'manual-1' };
    const res = await call(U_EXP_ADMIN, data);
    expect(res.results[0]).toMatchObject({ success: true, oldExp: 200, newExp: 700 });
    expect(await call(U_EXP_ADMIN, data)).toEqual({ success: true, deduplicated: true });
    expect(expOf(U_OTHER)).toBe(700);
  });

  test('manual：仍可用 uid 欄位或 lineUserId 找到目標（不受 auto 的 docId 限制）', async () => {
    const alias = `U${'e'.repeat(32)}`;
    const legacyDoc = `U${'f'.repeat(32)}`;
    seed({ [`users/${legacyDoc}`]: user(alias, { lineUserId: legacyDoc }) });
    const res = await call(U_EXP_ADMIN, { mode: 'manual', targets: [alias], amount: 5, reason: 'x' });
    expect(res.results[0]).toMatchObject({ success: true, docId: legacyDoc });
  });

  test('manual：目標數量錯誤仍是 invalid-argument', async () => {
    await expectDenied(call(U_EXP_ADMIN, { mode: 'manual', targets: [U_OTHER, U_SELF], amount: 5, reason: 'x' }), 'invalid-argument');
  });

  test.each(['batch', 'team'])('%s：多目標逐一寫入、查無者回 not_found、去重只建一次', async (mode) => {
    const ghost = `U${'0'.repeat(32)}`;
    const data = { mode, targets: [U_SELF, ghost, U_OTHER], amount: -300, reason: '批次', requestId: `${mode}-1` };
    const res = await call(U_EXP_ADMIN, data);
    expect(res.results.map((r) => r.success)).toEqual([true, false, true]);
    expect(res.results[1].error).toBe('not_found');
    expect(expOf(U_SELF)).toBe(0);
    expect(expOf(U_OTHER)).toBe(0);
    expect(await call(U_EXP_ADMIN, data)).toEqual({ success: true, deduplicated: true });
    await expectDenied(call(U_COACH, data));
    await expectDenied(call(U_EXP_ADMIN, { ...data, requestId: undefined, targets: Array(51).fill(U_SELF) }), 'invalid-argument');
  });

  test('teamExp：權限、上限夾值與去重照舊', async () => {
    const data = { mode: 'teamExp', teamId: 'tm_1', amount: 50, reason: '俱樂部', requestId: 'team-exp-1' };
    await expectDenied(call(U_COACH, data));
    const res = await call(U_EXP_ADMIN, data);
    expect(res).toMatchObject({ success: true, teamId: 'tm_1', oldExp: 9990, newExp: 10000 });
    expect(await call(U_EXP_ADMIN, data)).toEqual({ success: true, deduplicated: true });
    await expectDenied(call(U_EXP_ADMIN, { ...data, teamId: 'tm_missing', requestId: 'team-exp-2' }), 'not-found');
    expect(fake.has('_expDedupe/team-exp-2')).toBe(false);
  });

  test('無效 mode 與金額照舊拒絕', async () => {
    await expectDenied(call(U_EXP_ADMIN, { mode: 'nope', targets: [U_OTHER], amount: 5, reason: 'x' }), 'invalid-argument');
    await expectDenied(call(U_EXP_ADMIN, { mode: 'manual', targets: [U_OTHER], amount: 0, reason: 'x' }), 'invalid-argument');
    await expectDenied(call(U_EXP_ADMIN, { mode: 'manual', targets: [U_OTHER], amount: 5, reason: ' ' }), 'invalid-argument');
  });
});
