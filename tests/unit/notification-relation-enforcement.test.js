/**
 * 通知發送授權強化（第 2 批）— 關係強制常數（functions/notification-relation-enforcement.js）。
 */

const { RELATION_ENFORCEMENT, relationMode } = require('../../functions/notification-relation-enforcement');

describe('RELATION_ENFORCEMENT', () => {
  test('正式常數：R0、R7 為 enforce；R1～R6、R8、R9 為 log；物件凍結', () => {
    expect(RELATION_ENFORCEMENT).toEqual({
      R0: 'enforce',
      R1: 'log',
      R2: 'log',
      R3: 'log',
      R4: 'log',
      R5: 'log',
      R6: 'log',
      R7: 'enforce',
      R8: 'log',
      R9: 'log',
    });
    expect(Object.keys(RELATION_ENFORCEMENT)).toEqual(['R0', 'R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R7', 'R8', 'R9']);
    expect(Object.isFrozen(RELATION_ENFORCEMENT)).toBe(true);
    ['R1', 'R2', 'R3', 'R4', 'R5', 'R6', 'R8', 'R9'].forEach((id) => {
      expect(relationMode(id)).toBe('log');
    });
    expect(relationMode('R0')).toBe('enforce');
    expect(relationMode('R7')).toBe('enforce');
  });

  test('relationMode 對 constructor、__proto__、client_unknown、未知 id 回 log', () => {
    ['constructor', '__proto__', 'toString', 'valueOf', 'client_unknown', 'unclassified', 'R10', 'r0', ''].forEach((id) => {
      expect(relationMode(id)).toBe('log');
    });
    [null, undefined, 0, 1, true, {}, [], Object.create({ R0: 'enforce' })].forEach((id) => {
      expect(relationMode(id)).toBe('log');
    });
  });
});

describe('客戶端欄位不參與', () => {
  test('沒有任何函式簽章接受 mode 覆寫', () => {
    expect(relationMode.length).toBe(1);
    expect(relationMode('R0', 'log')).toBe('enforce');
    expect(relationMode('R1', 'enforce')).toBe('log');
    expect(Object.keys(require('../../functions/notification-relation-enforcement')).sort())
      .toEqual(['RELATION_ENFORCEMENT', 'relationMode']);
  });
});
