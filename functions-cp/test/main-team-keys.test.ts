/**
 * 主站俱樂部成員比對鍵（顧問 §3.846 隊伍雙鍵）純函式測試：文件 id 一定在；id 欄位合法且不等於文件 id 時加為第二把。
 */
import { describe, expect, it } from 'vitest';
import { mainTeamKeysOf } from '../src/cp/main-profile.js';

describe('mainTeamKeysOf（隊伍雙鍵）', () => {
  it('文件 id 等於自訂 id：只有一把', () => {
    expect(mainTeamKeysOf('club_a', 'club_a')).toEqual(['club_a']);
  });
  it('兩者不相等：文件 id＋自訂 id 兩把', () => {
    expect(mainTeamKeysOf('club_a', 'legacy_a')).toEqual(['club_a', 'legacy_a']);
  });
  it('teams 文件不存在（undefined）：只有文件 id', () => {
    expect(mainTeamKeysOf('club_a', undefined)).toEqual(['club_a']);
  });
  it('id 欄位形狀錯：只有文件 id', () => {
    for (const bad of [null, 42, ['legacy_a'], { v: 'legacy_a' }, '', 'legacy a', 'a/b', 'x'.repeat(65)]) {
      expect(mainTeamKeysOf('club_a', bad)).toEqual(['club_a']);
    }
  });
  it('別隊的自訂 id 不會出現在本隊的鍵裡', () => {
    expect(mainTeamKeysOf('club_a', 'legacy_a')).not.toContain('legacy_b');
  });
});
