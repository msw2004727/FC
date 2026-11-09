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
    [`users/${U_DELEGATE_ELSEWHERE}`]: user(U_DELEGATE_ELSEWHERE),
    [`users/${U_SUPER}`]: user(U_SUPER, { role: 'super_admin' }),
    // 自訂角色：等級視為 0，只靠 admin.exp.entry
    'rolePermissions/exp_clerk': { permissions: ['admin.exp.entry'] },
    [`events/${EVENT_ID}`]: { id: EVENT_ID, title: 'e1', creatorUid: U_CREATOR, ownerUid: U_OWNER_FIELD, delegateUids: [U_DELEGATE] },
    [`events/${EVENT_ID_2}`]: { id: EVENT_ID_2, title: 'e2', creatorUid: U_CREATOR, delegateUids: [U_DELEGATE_ELSEWHERE] },
    'siteConfig/autoExpRules': { complete_activity: 30, noshow_penalty: -50, register_activity: 10, line_binding: 100 },
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

  test('autoexp_ 去重鍵不屬於目標時拒絕，且不建立去重紀錄', async () => {
    const requestId = `autoexp_${U_OTHER}_line_binding`;
    await expectDenied(call(U_SELF, auto(U_SELF, { amount: 100, requestId })));
    expect(fake.has(`_expDedupe/${requestId}`)).toBe(false);
    expect(expOf(U_SELF)).toBe(200);
    // 目標本人之後仍能用自己的鍵領取
    const res = await call(U_OTHER, auto(U_OTHER, { amount: 100, requestId }));
    expect(res.results[0].success).toBe(true);
    expect(expOf(U_OTHER)).toBe(300);
  });

  test('非 autoexp_ 開頭的 requestId 不受去重鍵歸屬限制', async () => {
    const res = await call(U_SELF, auto(U_SELF, { amount: 5, requestId: 'custom-key-1' }));
    expect(res.results[0].success).toBe(true);
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
    const requestId = `autoexp_${U_OTHER}_noshow_penalty_-50_${TS}_0`;
    const res = await call(U_EXP_ADMIN, auto(U_OTHER, { amount: -50, ruleKey: 'noshow_penalty', requestId, reason: '自動：放鴿子扣分（1 次 × -50）' }));
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

  test('A 時間戳形狀（無活動 ID）：一般用戶是某活動 creatorUid → 退回查詢後放行', async () => {
    const requestId = `autoexp_${U_OTHER}_complete_activity_${TS}`;
    const res = await call(U_CREATOR, auto(U_OTHER, { requestId }));
    expect(res.results[0].success).toBe(true);
  });

  test('A 時間戳形狀（無活動 ID）：一般用戶是某活動委託人 → 退回查詢後放行', async () => {
    const requestId = `autoexp_${U_OTHER}_complete_activity_${TS}`;
    const res = await call(U_DELEGATE_ELSEWHERE, auto(U_OTHER, { requestId }));
    expect(res.results[0].success).toBe(true);
  });

  test('拿不到活動 ID、也不是任何活動主辦／委託的一般用戶 → 拒絕', async () => {
    const requestId = `autoexp_${U_OTHER}_complete_activity_${TS}`;
    await expectDenied(call(U_SELF, auto(U_OTHER, { requestId })));
    expect(fake.has(`_expDedupe/${requestId}`)).toBe(false);
    expect(expOf(U_OTHER)).toBe(200);
    const [log] = deniedLogs();
    expect(log[2]).toMatchObject({ reason: 'caller', ruleKey: 'complete_activity', callerRoleLevel: 0, hasEventId: false });
    // log 只留遮罩過的 uid
    expect(JSON.stringify(log)).not.toContain(U_SELF);
  });

  test('一般用戶且不帶任何 requestId／ruleKey → 拒絕', async () => {
    await expectDenied(call(U_SELF, auto(U_OTHER)));
    expect(deniedLogs()[0][2]).toMatchObject({ reason: 'rule_key', hasEventId: false });
  });
});

describe('auto 模式：目標不是本人，規則與金額', () => {
  beforeEach(() => seed());

  test.each(['line_binding', 'host_activity', 'badge_bonus', 'cancel_registration', 'join_team'])(
    '非白名單 ruleKey %s 一律拒絕（即使是教練）',
    async (ruleKey) => {
      await expectDenied(call(U_COACH, auto(U_OTHER, { amount: 10, ruleKey, requestId: `autoexp_${U_OTHER}_${ruleKey}_${TS}` })));
      expect(fake.has(`_expDedupe/autoexp_${U_OTHER}_${ruleKey}_${TS}`)).toBe(false);
    }
  );

  test('ruleKey 與 requestId 解析結果不一致 → 拒絕', async () => {
    await expectDenied(call(U_COACH, auto(U_OTHER, { ruleKey: 'complete_activity', requestId: `autoexp_${U_OTHER}_noshow_penalty_-50_${TS}_0` })));
  });

  test('complete_activity 超過規則值或方向錯誤 → 拒絕', async () => {
    await expectDenied(call(U_COACH, auto(U_OTHER, { amount: 31, requestId: bId(U_OTHER) })));
    await expectDenied(call(U_COACH, auto(U_OTHER, { amount: -30, requestId: bId(U_OTHER) })));
    expect(fake.has(`_expDedupe/${bId(U_OTHER)}`)).toBe(false);
    expect(deniedLogs().every((row) => row[2].reason === 'amount')).toBe(true);
  });

  test('complete_activity 規則值以內放行', async () => {
    const res = await call(U_COACH, auto(U_OTHER, { amount: 20, requestId: bId(U_OTHER) }));
    expect(res.results[0].success).toBe(true);
  });

  test('noshow_penalty 只能扣分，且絕對值不超過規則值', async () => {
    const id = (n) => `autoexp_${U_OTHER}_noshow_penalty_${n}_${TS}_0`;
    await expectDenied(call(U_COACH, auto(U_OTHER, { amount: 50, ruleKey: 'noshow_penalty', requestId: id(50) })));
    await expectDenied(call(U_COACH, auto(U_OTHER, { amount: -51, ruleKey: 'noshow_penalty', requestId: id(-51) })));
    const res = await call(U_COACH, auto(U_OTHER, { amount: -50, ruleKey: 'noshow_penalty', requestId: id(-50) }));
    expect(res.results[0]).toMatchObject({ success: true, newExp: 150 });
  });

  test('register_activity 固定 +10', async () => {
    const id = `autoexp_${U_OTHER}_register_activity_${TS}`;
    await expectDenied(call(U_COACH, auto(U_OTHER, { amount: 20, requestId: id })));
    await expectDenied(call(U_COACH, auto(U_OTHER, { amount: -10, requestId: id })));
    const res = await call(U_COACH, auto(U_OTHER, { amount: 10, requestId: id }));
    expect(res.results[0]).toMatchObject({ success: true, newExp: 210 });
  });

  test('已接受的回歸：A 非 CF 退回路徑由一般用戶（取消者）代發被遞補者 register_activity → 拒絕', async () => {
    const id = `autoexp_${U_OTHER}_register_activity_${TS}`;
    await expectDenied(call(U_SELF, auto(U_OTHER, { amount: 10, requestId: id })));
    expect(expOf(U_OTHER)).toBe(200);
  });

  test('siteConfig/autoExpRules 不存在或規則為 0 → complete_activity／noshow_penalty 拒絕', async () => {
    seed({ 'siteConfig/autoExpRules': { complete_activity: 0 } });
    await expectDenied(call(U_COACH, auto(U_OTHER, { requestId: bId(U_OTHER) })));
    await expectDenied(call(U_COACH, auto(U_OTHER, { amount: -50, ruleKey: 'noshow_penalty', requestId: `autoexp_${U_OTHER}_noshow_penalty_-50_${TS}_0` })));
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
