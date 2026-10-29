/**
 * 通知發送授權強化（第 2 批）— 入列池與發送池（functions/notification-pool.js）。
 */

const { selectEnqueuePool, resolveSendPool } = require('../../functions/notification-pool');
const { relationMode } = require('../../functions/notification-relation-enforcement');
const { NOTIFICATION_GUARD_LIMITS: L } = require('../../functions/notification-guard-limits');

const injected = { globalPerDay: { event: 10 } };

describe('selectEnqueuePool', () => {
  test('正式限額物件不選 event', () => {
    expect(selectEnqueuePool({ staff: false, relationId: 'R1', limits: L, mode: 'enforce' })).toBe('user');
    expect(selectEnqueuePool({ staff: true, relationId: 'R1', limits: L, mode: 'enforce' })).toBe('staff');
    expect(selectEnqueuePool({
      staff: false,
      relationId: 'R1',
      limits: L,
      mode: relationMode('R1'),
    })).toBe('user');
    expect(L.globalPerDay.event).toBeNull();
  });

  test('注入 event 數字且 mode 為 enforce 才選 event；R1 為 log 時不選', () => {
    expect(selectEnqueuePool({ staff: false, relationId: 'R1', limits: injected, mode: 'enforce' })).toBe('event');
    expect(selectEnqueuePool({ staff: true, relationId: 'R1', limits: injected, mode: 'enforce' })).toBe('event');
    expect(selectEnqueuePool({ staff: true, relationId: 'R1', limits: injected, mode: 'log' })).toBe('staff');
    expect(selectEnqueuePool({ staff: false, relationId: 'R1', limits: injected, mode: 'log' })).toBe('user');
    expect(selectEnqueuePool({
      staff: false,
      relationId: 'R1',
      limits: injected,
      mode: relationMode('R1'),
    })).toBe('user');
    expect(selectEnqueuePool({ staff: false, relationId: 'R0', limits: injected, mode: 'enforce' })).toBe('user');
    expect(selectEnqueuePool({ staff: true, relationId: 'R3', limits: injected, mode: 'enforce' })).toBe('staff');
    expect(selectEnqueuePool({ staff: false, relationId: 'r1', limits: injected, mode: 'enforce' })).toBe('user');
    expect(selectEnqueuePool({ staff: true, relationId: 'R1', limits: injected, mode: 'ENFORCE' })).toBe('staff');
    expect(selectEnqueuePool({
      staff: false,
      relationId: 'R1',
      limits: { globalPerDay: { event: Infinity } },
      mode: 'enforce',
    })).toBe('user');
    expect(selectEnqueuePool({
      staff: true,
      relationId: 'R1',
      limits: { globalPerDay: { event: NaN } },
      mode: 'enforce',
    })).toBe('staff');
  });

  test('staff／user 分支', () => {
    expect(selectEnqueuePool({ staff: true, relationId: 'R3', limits: L, mode: 'log' })).toBe('staff');
    expect(selectEnqueuePool({ staff: false, relationId: 'R3', limits: L, mode: 'log' })).toBe('user');
    expect(selectEnqueuePool({ staff: 0, relationId: 'R1', limits: injected, mode: 'log' })).toBe('user');
    expect(selectEnqueuePool({ staff: '', relationId: 'R0', limits: L, mode: 'log' })).toBe('user');
  });

  test('不讀 payload 的 pool', () => {
    expect(selectEnqueuePool({
      staff: false,
      relationId: 'R0',
      limits: L,
      mode: 'log',
      pool: 'staff',
    })).toBe('user');
    expect(selectEnqueuePool({
      staff: false,
      relationId: 'R1',
      limits: L,
      mode: 'enforce',
      pool: 'event',
    })).toBe('user');
  });
});

describe('resolveSendPool', () => {
  test('user／staff 照文件', () => {
    expect(resolveSendPool({ pool: 'user', requestedByUid: 'system', limits: L })).toBe('user');
    expect(resolveSendPool({
      pool: 'staff',
      requestedByUid: 'uidA',
      requestedByRole: 'user',
      limits: L,
    })).toBe('staff');
  });

  test('event 為有限數字回 event，null 回 user', () => {
    expect(resolveSendPool({ pool: 'event', requestedByUid: 'uidA', limits: injected })).toBe('event');
    expect(resolveSendPool({ pool: 'event', requestedByUid: 'system', limits: L })).toBe('user');
    expect(resolveSendPool({ pool: 'event', requestedByUid: 'uidA', limits: { globalPerDay: { event: null } } })).toBe('user');
    expect(resolveSendPool({ pool: 'event', requestedByUid: 'system', limits: { globalPerDay: { event: Infinity } } })).toBe('user');
  });

  test('缺 pool 且 system 為 staff；缺 pool 且 requestedByRole 為 coach 仍是 user', () => {
    expect(resolveSendPool({ requestedByUid: 'system', limits: L })).toBe('staff');
    expect(resolveSendPool({
      pool: undefined,
      requestedByUid: 'uidA',
      requestedByRole: 'coach',
      limits: L,
    })).toBe('user');
  });

  test('髒值', () => {
    ['STAFF', 'Event', 'admin', '', 1, 0, true, {}, [], null].forEach((pool) => {
      expect(resolveSendPool({ pool, requestedByUid: 'uidA', requestedByRole: 'coach', limits: L })).toBe('user');
      expect(resolveSendPool({ pool, requestedByUid: 'system', requestedByRole: 'user', limits: L })).toBe('staff');
    });
  });
});
