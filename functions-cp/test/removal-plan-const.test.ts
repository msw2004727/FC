/**
 * removal-plan 常數與 staff-host 一致（不 import 以免循環）。
 */
import { describe, expect, it } from 'vitest';
import { SCORE_ASSIGN_MS } from '../src/cp/staff-host.js';
import { ENDED_GRACE_MS } from '../src/cp/removal-plan.js';

describe('removal-plan 常數', () => {
  it('ENDED_GRACE_MS 與 staff-host SCORE_ASSIGN_MS 相等', () => {
    expect(ENDED_GRACE_MS).toBe(SCORE_ASSIGN_MS);
  });
});
