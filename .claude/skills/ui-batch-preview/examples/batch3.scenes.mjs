// 第 3 批（活動列表／詳情）截圖情境；種子 UID 與活動 ID 只存在 emulator。
import { UIDS } from '../../../../../FC-B/scripts/seed-data.mjs';

const EV = 'ce_1700000000000_fmtch1'; // 種子「週末足球公開賽」

export default (h) => {
  const openACard = async (p) => { await p.locator('.tl-event-row:not(.tl-past)').first().click(); await p.waitForTimeout(5000); await h.dismissA(p); };
  const roster = /出席名單|正取名單|報名名單|出席管理/;
  const calendarTab = async (p) => { await p.locator('#activity-tabs button', { hasText: '月曆' }).click(); await p.waitForTimeout(3000); };
  return [
    { name: 'list', A: { path: '/activities' }, B: { path: '/activities' } },
    { name: 'calendar', A: { path: '/activities', run: calendarTab }, B: { path: '/activities', run: calendarTab } },
    { name: 'detail-guest', A: { path: '/activities', run: openACard }, B: { path: `/events/${EV}` } },
    { name: 'roster', A: { path: '/activities', run: async (p) => { await openACard(p); await h.wheel(p, 650); } }, B: { path: `/events/${EV}`, run: (p) => h.scrollToText(p, roster) } },
    { name: 'detail-user', B: { path: `/events/${EV}`, uid: UIDS.user1 } },
    { name: 'cancel', B: { path: `/events/${EV}`, uid: UIDS.user1, run: (p) => h.clickButton(p, /取消報名|取消候補/) } },
    { name: 'companion', B: { path: `/events/${EV}`, uid: UIDS.user1, run: (p) => h.clickButton(p, /幫夥伴報名/) } },
    // 先按摘要卡「管理名單 / 出席紀錄」展開表格，再按表格內的「管理名單」才進編輯模式
    { name: 'roster-finish', B: { path: `/events/${EV}`, uid: UIDS.admin, run: async (p) => {
      await h.scrollToText(p, roster); await h.clickButton(p, /出席紀錄/); await h.clickButton(p, '管理名單', true); await h.scrollToText(p, roster);
    } } },
  ];
};
