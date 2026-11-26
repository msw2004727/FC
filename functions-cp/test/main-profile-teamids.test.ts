/**
 * 主站有效隊伍清單（規則 E，顧問 §3.839 方案 C）純函式測試：teamIds 非空只認 teamIds；否則 [teamId]；否則 []；元素只認字串。
 */
import { describe, expect, it } from 'vitest';
import { teamIdsOfMainUser } from '../src/cp/main-profile.js';

describe('teamIdsOfMainUser（規則 E）', () => {
  it('teamIds 非空陣列：只認 teamIds，不併 teamId', () => {
    expect(teamIdsOfMainUser(['a', 'b'], 'c')).toEqual(['a', 'b']);
    expect(teamIdsOfMainUser(['a'], undefined)).toEqual(['a']);
  });
  it('teamIds 非空但元素不是字串：濾掉，且不退回 teamId', () => {
    expect(teamIdsOfMainUser([1, null, { id: 'a' }, 'b', ''], 'a')).toEqual(['b']);
    expect(teamIdsOfMainUser([123], 'a')).toEqual([]);
  });
  it('teamIds 空陣列或不是陣列：退回字串 teamId', () => {
    expect(teamIdsOfMainUser([], 'a')).toEqual(['a']);
    expect(teamIdsOfMainUser(undefined, 'a')).toEqual(['a']);
    expect(teamIdsOfMainUser('x', 'a')).toEqual(['a']);
    expect(teamIdsOfMainUser({ 0: 'x' }, 'a')).toEqual(['a']);
  });
  it('兩欄都沒有有效值：回 []', () => {
    expect(teamIdsOfMainUser(undefined, undefined)).toEqual([]);
    expect(teamIdsOfMainUser('a', undefined)).toEqual([]);
    expect(teamIdsOfMainUser([], '')).toEqual([]);
    expect(teamIdsOfMainUser(null, 42)).toEqual([]);
    expect(teamIdsOfMainUser(null, ['a'])).toEqual([]);
  });
});
