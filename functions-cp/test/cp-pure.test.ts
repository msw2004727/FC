/**
 * 第 2 步純函式測試（不需模擬器）：禁用字、取姓氏、年齡、輸入驗證、id、錯誤轉換、未知動作。
 */
import { describe, expect, it } from 'vitest';
import { ageOn, evaluateAge, parseBirthdayParts, taipeiDateParts } from '../src/cp/age.js';
import { runCallable, toErrorShape } from '../src/cp/callable.js';
import { CID_RE, DVID_RE, ENID_RE, PLID_RE, actorHash, callerOf, newId, type CpDeps } from '../src/cp/context.js';
import { handleCpEntry } from '../src/cp/entry.js';
import { CpError } from '../src/cp/errors.js';
import { handleCpHost } from '../src/cp/host.js';
import { handleCpParticipant } from '../src/cp/participant.js';
import {
  SUGGESTED_BANNED_WORDS, bannedWordsOf, cleanLine, findBannedWord, isAllowedLiveLink, maskedPublicName, optionalText, surnameOf
} from '../src/cp/text.js';
import {
  divisionOf, divisionsOf, feeNoteOf, liveLinksOf, onlyKeys, scheduleOf, venuesOf, competitionName
} from '../src/cp/validate.js';

const reasonOf = (fn: () => unknown) => {
  try { fn(); } catch (e) { return (e as CpError).reason; }
  return 'NO_ERROR';
};

const W = SUGGESTED_BANNED_WORDS;
describe('禁用字（§5.4；站長 11-18：預設清單為空，由管理員設定）', () => {
  it('預設空清單不擋任何字；設定格式不對視為空清單', () => {
    expect(findBannedWord('官方協會盃', [])).toBeNull();
    expect(bannedWordsOf(undefined)).toEqual([]);
    expect(bannedWordsOf('官方')).toEqual([]);
    expect(bannedWordsOf(['官方', ' 官方 ', 3, '', 'x'.repeat(21), '協會'])).toEqual(['官方', '協會']);
    expect(competitionName('官方盃', [])).toBe('官方盃');
  });
  it.each([
    '台北足球協會盃', '全國聯盟賽', '官方認可賽', '中華足協', '足球總會', '亞洲足球联盟',
    'Taipei Football Association Cup', 'OFFICIAL cup', 'F.e.d.e.r.a.t.i.o.n', '官 方 賽', '官​方', 'ＯＦＦＩＣＩＡＬ'
  ])('擋下 %s', s => { expect(findBannedWord(s, W)).not.toBeNull(); });
  it('韓文填充字、點字空白等看不見的字母不能拆開禁用字', () => {
    for (const cp of [0x3164, 0x115f, 0x1160, 0xffa0, 0x2800]) {
      expect(findBannedWord('官' + String.fromCodePoint(cp) + '方盃', W)).not.toBeNull();
    }
  });
  it.each(['週末友誼賽', '信義區五人制', 'Sunday Cup', '飛達盃'])('放行 %s', s => {
    expect(findBannedWord(s, W)).toBeNull();
  });
  it('賽事名稱命中禁用字回 BANNED_WORD', () => {
    expect(reasonOf(() => competitionName('官方盃', W))).toBe('BANNED_WORD');
  });
});

describe('取姓氏（§4.3）', () => {
  it.each([
    ['王小明', '王'], ['歐陽娜娜', '歐陽'], ['張簡一二', '張簡'], ['范姜三', '范姜'], ['周黃四五', '周黃'],
    ['司馬光', '司馬'], ['諸葛亮', '諸葛'], ['林', '林'], ['歐陽', '歐'],
    ['John Smith', 'Smith'], ['Mary Ann Lee', 'Lee'], ['Neymar', 'Neymar'], ['', '']
  ])('%s → %s', (name, sur) => { expect(surnameOf(name)).toBe(sur); });
  it('公開名遮字：遮姓氏後第一字（站長 11-18）', () => {
    expect(maskedPublicName('王小明')).toBe('王O明');
    expect(maskedPublicName('歐陽娜娜')).toBe('歐陽O娜');
    expect(maskedPublicName('張簡一二')).toBe('張簡O二');
    expect(maskedPublicName('王明')).toBe('王O');
    expect(maskedPublicName('歐陽')).toBe('歐O');
    expect(maskedPublicName('林')).toBe('林O');
    expect(maskedPublicName('Amy王小美')).toBe('王O美');
    expect(maskedPublicName('王 小 明')).toBe('王O明');
    expect(maskedPublicName('John Smith')).toBe('J. Smith');
    expect(maskedPublicName('mary ann lee')).toBe('M. lee');
    expect(maskedPublicName('ChenXiaoming')).toBe('C.');
    expect(maskedPublicName('')).toBe('');
    for (const n of ['王小明', '歐陽娜娜', '王明', '林', 'John Smith', 'ChenXiaoming', 'Amy王小美']) {
      expect(maskedPublicName(n)).not.toBe(n);
    }
  });
});

describe('年齡（生日只算不存）', () => {
  it('解析與主站相同格式', () => {
    expect(parseBirthdayParts('2010/03/05')).toEqual({ year: 2010, month: 3, day: 5 });
    expect(parseBirthdayParts('2010-3-5')).toEqual({ year: 2010, month: 3, day: 5 });
    expect(parseBirthdayParts('2010/02/30')).toBeNull();
    expect(parseBirthdayParts('abc')).toBeNull();
    expect(parseBirthdayParts(null)).toBeNull();
    expect(parseBirthdayParts('2010/03/05 extra')).toBeNull();
  });
  it('未過生日減 1；台北日期', () => {
    expect(ageOn({ year: 2008, month: 6, day: 1 }, { year: 2026, month: 5, day: 31 })).toBe(17);
    expect(ageOn({ year: 2008, month: 6, day: 1 }, { year: 2026, month: 6, day: 1 })).toBe(18);
    // UTC 16:00 已是台北隔天
    expect(taipeiDateParts(new Date('2026-05-31T16:00:00Z'))).toEqual({ year: 2026, month: 6, day: 1 });
  });
  it('isMinor 以首場日期、ageEligible 含端點', () => {
    const first = new Date('2026-06-01T02:00:00Z');
    expect(evaluateAge('2008/06/01', first, {})).toEqual({ age: 18, isMinor: false, ageEligible: true });
    expect(evaluateAge('2008/06/02', first, {})).toMatchObject({ age: 17, isMinor: true });
    expect(evaluateAge('2014/06/01', first, { minAge: 10, maxAge: 12 })?.ageEligible).toBe(true);
    expect(evaluateAge('2014/06/02', first, { minAge: 10, maxAge: 11 })?.ageEligible).toBe(true);
    expect(evaluateAge('2016/06/02', first, { minAge: 10 })?.ageEligible).toBe(false);
    expect(evaluateAge('', first, {})).toBeNull();
  });
});

describe('建賽輸入驗證', () => {
  const now = Date.UTC(2026, 10, 18);
  const D = 86400_000;
  const sched = { regOpenAt: now, regCloseAt: now + 10 * D, firstMatchAt: now + 20 * D, lastMatchAt: now + 21 * D };
  it('時間順序與範圍', () => {
    expect(scheduleOf(sched, now, { requireFuture: true })).toEqual(sched);
    expect(reasonOf(() => scheduleOf({ ...sched, regCloseAt: now }, now, { requireFuture: true }))).toBe('SCHEDULE_ORDER');
    expect(reasonOf(() => scheduleOf({ ...sched, firstMatchAt: now + 5 * D }, now, { requireFuture: true }))).toBe('SCHEDULE_ORDER');
    expect(reasonOf(() => scheduleOf({ ...sched, lastMatchAt: now + 19 * D }, now, { requireFuture: true }))).toBe('SCHEDULE_ORDER');
    expect(reasonOf(() => scheduleOf({ ...sched, lastMatchAt: now + 300 * D }, now, { requireFuture: true }))).toBe('SCHEDULE_SPAN');
    expect(reasonOf(() => scheduleOf({ ...sched, regOpenAt: 'x' }, now, { requireFuture: true }))).toBe('FIELD_TIME');
    expect(reasonOf(() => scheduleOf({ ...sched, firstMatchAt: now - D, regCloseAt: now - 2 * D, regOpenAt: now - 3 * D }, now, { requireFuture: true }))).toBe('SCHEDULE_PAST');
    expect(reasonOf(() => scheduleOf({ ...sched, regOpenAt: now + 0.5 }, now, { requireFuture: true }))).toBe('FIELD_TIME');
  });
  it('組別：人制、隊數、名單人數、年齡、真名預設', () => {
    const base = { name: 'U12', playersOnField: 8, maxTeams: 8, rosterMin: 8, rosterMax: 16 };
    expect(divisionOf(base, 0).requireRealName).toBe(false);
    expect(divisionOf(base, 0).feePerTeam).toBe(0);
    expect(divisionOf({ ...base, feePerTeam: 1500 }, 0).feePerTeam).toBe(1500);
    expect(reasonOf(() => divisionOf({ ...base, feePerTeam: -1 }, 0))).toBe('FIELD_RANGE');
    expect(reasonOf(() => divisionOf({ ...base, feePerTeam: 10.5 }, 0))).toBe('FIELD_RANGE');
    expect(divisionOf({ ...base, minAge: 10, maxAge: 12 }, 0).requireRealName).toBe(true);
    expect(divisionOf({ ...base, minAge: 10, requireRealName: false }, 0).requireRealName).toBe(false);
    expect(reasonOf(() => divisionOf({ ...base, playersOnField: 6 }, 0))).toBe('FIELD_ENUM');
    expect(reasonOf(() => divisionOf({ ...base, maxTeams: 1 }, 0))).toBe('FIELD_RANGE');
    expect(reasonOf(() => divisionOf({ ...base, rosterMax: 7 }, 0))).toBe('FIELD_RANGE');
    expect(reasonOf(() => divisionOf({ ...base, rosterMin: 17 }, 0))).toBe('FIELD_RANGE');
    expect(reasonOf(() => divisionOf({ ...base, minAge: 12, maxAge: 10 }, 0))).toBe('FIELD_RANGE');
    expect(reasonOf(() => divisionOf({ ...base, requireRealName: 'yes' }, 0))).toBe('FIELD_TYPE');
    expect(reasonOf(() => divisionOf({ ...base, fee: 100 }, 0))).toBe('UNKNOWN_FIELD');
    expect(reasonOf(() => divisionsOf([base, base]))).toBe('DIVISION_NAME_DUPLICATE');
    expect(reasonOf(() => divisionsOf([]))).toBe('FIELD_RANGE');
  });
  it('場地、直播連結白名單、繳費說明只限俱樂部', () => {
    expect(venuesOf([{ name: 'A 場' }])).toEqual([{ name: 'A 場', address: null, lat: null, lng: null, mapPlaceId: null, mapProvider: null }]);
    // 地圖欄位比照活動：lat／lng 成對、placeId 只收安全字元、有 placeId 預設 google
    expect(venuesOf([{ name: 'A', lat: 25.03, lng: 121.56, mapPlaceId: 'ChIJ_abc-1' }])[0]).toMatchObject({ lat: 25.03, lng: 121.56, mapProvider: 'google' });
    expect(venuesOf([{ name: 'A', lat: 25, lng: 121 }])[0].mapProvider).toBe('manual');
    expect(reasonOf(() => venuesOf([{ name: 'A', lat: 25 }]))).toBe('FIELD_REQUIRED');
    expect(reasonOf(() => venuesOf([{ name: 'A', lat: 95, lng: 121 }]))).toBe('FIELD_RANGE');
    expect(reasonOf(() => venuesOf([{ name: 'A', lat: 25, lng: 121, mapPlaceId: 'x y<' }]))).toBe('FIELD_FORMAT');
    expect(reasonOf(() => venuesOf([{ name: 'A', mapPlaceId: 'abc' }]))).toBe('FIELD_REQUIRED');
    expect(reasonOf(() => venuesOf([]))).toBe('FIELD_RANGE');
    expect(reasonOf(() => venuesOf([{ name: 'A', note: '停車' }]))).toBe('UNKNOWN_FIELD');
    expect(liveLinksOf(['https://www.youtube.com/watch?v=x'])).toHaveLength(1);
    expect(reasonOf(() => liveLinksOf(['http://youtube.com/x']))).toBe('LIVE_LINK_NOT_ALLOWED');
    expect(reasonOf(() => liveLinksOf(['https://evil.example/youtube.com']))).toBe('LIVE_LINK_NOT_ALLOWED');
    expect(reasonOf(() => liveLinksOf(['https://youtube.com.evil.example/']))).toBe('LIVE_LINK_NOT_ALLOWED');
    expect(isAllowedLiveLink('https://user:pw@youtube.com/')).toBe(false);
    expect(feeNoteOf('每隊 1000 元', 'club')).toBe('每隊 1000 元');
    expect(reasonOf(() => feeNoteOf('每隊 1000 元', 'personal'))).toBe('FEE_NOTE_NOT_ALLOWED');
    expect(feeNoteOf(null, 'personal')).toBeNull();
  });
  it('多帶鍵一律拒絕', () => {
    expect(reasonOf(() => onlyKeys({ action: 'x', visibility: 'public' }, ['action']))).toBe('UNKNOWN_FIELD');
  });
  it('文字清理：去不可見字元與雙向控制字元', () => {
    expect(cleanLine('  甲‮隊​  ')).toBe('甲隊');
    expect(optionalText('a\r\n\r\n\r\n\r\nb', 'x', 10)).toBe('a\n\nb');
  });
});

describe('id 與身分', () => {
  it('前綴＋20 碼英數', () => {
    for (let i = 0; i < 200; i++) {
      expect(newId('cp')).toMatch(CID_RE);
      expect(newId('dv')).toMatch(DVID_RE);
      expect(newId('en')).toMatch(ENID_RE);
      expect(newId('pl')).toMatch(PLID_RE);
    }
    // 與 Rules plIdOk（^pl_[A-Za-z0-9_-]{1,37}$）相容
    expect(newId('pl')).toMatch(/^pl_[A-Za-z0-9_-]{1,37}$/);
  });
  it('未登入回 unauthenticated；role 只取 claims', () => {
    expect(() => callerOf(null)).toThrow(CpError);
    expect(callerOf({ uid: 'u', token: { role: 'admin' } })).toEqual({ uid: 'u', role: 'admin' });
    expect(callerOf({ uid: 'u', token: {} })).toEqual({ uid: 'u', role: null });
  });
  it('稽核代號不含 uid 原文、同輸入同輸出', () => {
    const h = actorHash('cp_x', 'secretuid');
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(h).not.toContain('secret');
    expect(actorHash('cp_x', 'secretuid')).toBe(h);
    expect(actorHash('cp_y', 'secretuid')).not.toBe(h);
  });
});

describe('Callable 外殼', () => {
  const deps = { db: null, mainDb: null, now: () => new Date() } as unknown as CpDeps;
  it('錯誤只回 code、reason、params；未知錯誤不外露訊息', () => {
    expect(toErrorShape(new CpError('permission-denied', 'NOT_HOST'))).toEqual({ code: 'permission-denied', reason: 'NOT_HOST' });
    expect(toErrorShape(new Error('secret stack'))).toEqual({ code: 'internal', reason: 'INTERNAL' });
  });
  it.each([
    ['cpHost', handleCpHost, ['generateSchedule', 'assignStaff', 'createInvite', 'resetMatch', 'toString', '__proto__', '']],
    ['cpEntry', handleCpEntry, ['lockRoster', 'unlockRoster', 'constructor', 'hasOwnProperty']],
    ['cpParticipant', handleCpParticipant, ['acceptInvite', 'resyncMyClubs', 'requestMyDataRemoval']]
  ] as const)('%s 未知或未實作動作一律拒絕（在讀資料庫之前）', async (_n, handler, actions) => {
    for (const action of actions) {
      const out = await runCallable(deps, { uid: 'u' }, { action }, handler);
      expect(out.ok).toBe(false);
      if (!out.ok) expect(out.error.reason).toBe('UNKNOWN_ACTION');
    }
    const noAction = await runCallable(deps, { uid: 'u' }, null, handler);
    expect(noAction.ok).toBe(false);
  });
  it('未登入在動作分派前就拒絕', async () => {
    const out = await runCallable(deps, null, { action: 'create' }, handleCpHost);
    expect(out.ok === false && out.error.code).toBe('unauthenticated');
  });
});
