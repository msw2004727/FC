/**
 * 賽務台事件的純文字。不含 HTML。
 * 期別名稱只走 util.periodLabel，不在這裡寫死「上半場」。
 */

import { periodLabel } from './util.js';

/** 事件類型對應的圖示名稱（不是 emoji）。 */
export const EVENT_ICON: Record<string, string> = {
  goal: 'goal',
  own_goal: 'goal',
  penalty_scored: 'goal',
  penalty_missed: 'close',
  card: 'card',
  substitution: 'sub',
  injury: 'injury',
  period_start: 'play',
  period_end: 'stop',
  note: 'note'
};

export const CARD_LABEL: Record<string, string> = {
  yellow: '黃牌',
  second_yellow: '兩黃換紅',
  red: '紅牌'
};

/** 隊職員在名單上的身分文字 */
export const ROSTER_ROLE_TEXT: Record<string, string> = {
  coach: '教練',
  captain: '領隊',
  manager: '管理',
  staff: '隊職員'
};

interface EventText {
  type?: string;
  playerName?: string | null;
  jerseyNo?: number | null;
  cardType?: string;
  note?: string | null;
  subInJerseyNo?: number | null;
  subInPlayerName?: string | null;
  periodId?: string;
}

/**
 * 事件的一行文字。
 * periods === 1 時 h1 顯示「比賽」，不寫死上半場。
 */
export function eventText(e: EventText | null | undefined, { periods = 2 }: { periods?: number } = {}): string {
  if (!e) return '';
  const who = e.playerName ? `${e.jerseyNo != null ? '#' + e.jerseyNo + ' ' : ''}${e.playerName}` : '未指定球員';
  switch (e.type) {
    case 'goal': return `進球　${who}`;
    case 'penalty_scored': return `罰球進　${who}`;
    case 'penalty_missed': return `罰球失　${who}`;
    case 'own_goal': return `烏龍球　${who}（記給對隊）`;
    case 'card': return `${CARD_LABEL[e.cardType ?? ''] || '出牌'}　${who}`;
    case 'injury': return `傷停　${who}${e.note ? '　' + e.note : ''}`;
    case 'substitution':
      return `換人　${who} 下場 ／ ${e.subInJerseyNo != null ? '#' + e.subInJerseyNo + ' ' : ''}${e.subInPlayerName ?? ''} 上場`;
    case 'period_start': return `${periodLabel(e.periodId as string, periods)} 開始`;
    case 'period_end': return `${periodLabel(e.periodId as string, periods)} 結束`;
    case 'note': return e.note || '備註';
    default: return e.type as string;
  }
}
