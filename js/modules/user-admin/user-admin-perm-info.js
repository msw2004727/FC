/* ================================================
   SportHub — User Admin: Permission Info Popup
   ================================================
   每個權限開關旁的「?」說明彈窗內容與顯示邏輯
   設計參考：教學俱樂部的 _showEduInfoPopup（edu-helpers.js）
   ================================================ */

Object.assign(App, {

  // ── 權限說明對照表 ──

  _PERM_INFO: {
    // ─ 層級架構說明 ─
    '_hierarchy': {
      title: '層級架構數字說明',
      body: '<p>每個層級行顯示兩個數字：</p>'
        + '<div style="display:flex;align-items:center;gap:.5rem;margin:.6rem 0"><span style="display:inline-flex;align-items:center;justify-content:center;min-width:1.25rem;height:1.25rem;padding:0 .25rem;border-radius:50%;background:var(--accent-bg);color:var(--accent);font-size:.62rem;font-weight:700;border:1px solid var(--accent)">13</span><span>該層級目前擁有的<b>後台權限數量</b></span></div>'
        + '<div style="display:flex;align-items:center;gap:.5rem;margin:.6rem 0"><span style="font-size:.65rem;font-weight:700;color:#dc2626">5</span><span>目前屬於該層級的<b>用戶人數</b></span></div>'
        + '<p style="color:var(--text-muted);font-size:.78rem;margin-top:.5rem">權限數量會隨開關切換即時更新；用戶人數依據用戶管理資料統計。</p>',
    },

    // ─ 活動管理 ─
    'activity.manage.entry': {
      title: '活動管理（入口）',
      body: '控制是否能在側邊選單中看到並進入「活動管理」功能區。<br>關閉後該角色將無法存取任何活動管理相關功能。',
    },
    'event.create': {
      title: '建立活動',
      body: '允許建立新的活動，包含 PLAY、友誼、教學、觀賽等所有活動類型。',
    },
    'event.edit_self': {
      title: '編輯自己的活動',
      body: '允許編輯自己建立的活動內容，包含標題、時間、地點、人數上限等欄位。'
        + '<p style="color:var(--text-muted);font-size:.78rem;margin-top:.4rem">僅限自己建立的活動，不影響他人的活動。</p>',
    },
    'event.edit_all': {
      title: '編輯所有活動',
      body: '允許編輯系統中所有活動的內容，不限於自己建立的。'
        + '<p style="color:#d97706;font-size:.78rem;margin-top:.4rem">⚠ 此為高權限操作，建議僅授予管理員以上層級。</p>',
    },
    'event.delete_self': {
      title: '刪除自己的活動',
      body: '允許刪除自己建立的活動。僅限自己建立的活動。',
    },
    'event.delete': {
      title: '刪除所有活動',
      body: '允許刪除系統中所有活動，不限於自己建立的。'
        + '<p style="color:#d97706;font-size:.78rem;margin-top:.4rem">⚠ 此為高權限操作，刪除後無法復原。</p>',
    },
    'event.publish': {
      title: '上架 / 下架活動',
      body: '控制活動的可見性——上架後活動會出現在活動列表中供用戶報名，下架後一般用戶將無法看到該活動。',
    },
    'event.scan': {
      title: '掃碼簽到 / 簽退',
      body: '允許使用 QR Code 掃碼功能，為活動參加者執行簽到與簽退操作。',
    },
    'event.manual_checkin': {
      title: '手動簽到 / 簽退',
      body: '允許不透過 QR Code，直接在管理介面手動為參加者標記簽到或簽退。'
        + '<p style="color:var(--text-muted);font-size:.78rem;margin-top:.4rem">適用於忘帶手機或設備故障等情況。</p>',
    },
    'event.view_registrations': {
      title: '查看報名名單',
      body: '允許查看活動的完整報名名單，包含參加者的詳細資訊、報名時間與狀態（正取 / 候補）。',
    },

    // ─ 賽事管理 ─
    'admin.tournaments.entry': {
      title: '賽事管理（入口）',
      body: '控制是否能在側邊選單中看到並進入「賽事管理」功能區。<br>關閉後該角色將無法存取任何賽事管理功能。',
    },
    'admin.tournaments.create': {
      title: '建立賽事',
      body: '允許建立新的錦標賽或友誼賽賽事。',
    },
    'admin.tournaments.manage_all': {
      title: '管理所有賽事',
      body: '允許管理系統中所有賽事，包含編輯賽事資訊、調整賽程、管理參賽隊伍等。',
    },
    'admin.tournaments.review': {
      title: '審核參賽申請',
      body: '允許審核俱樂部或個人提交的參賽申請，決定是否核准參賽資格。',
    },

    // ─ 俱樂部管理 ─
    'admin.teams.entry': {
      title: '俱樂部管理（入口）',
      body: '控制是否能在側邊選單中看到並進入「俱樂部管理」功能區。<br>關閉後該角色將無法存取任何俱樂部管理功能。',
    },
    'team.create': {
      title: '建立俱樂部',
      body: '允許建立新的俱樂部，包含一般俱樂部與教學型俱樂部。',
    },
    'team.manage_all': {
      title: '管理所有俱樂部',
      body: '允許管理系統中所有俱樂部，不限於自己所屬的。'
        + '<p style="color:#d97706;font-size:.78rem;margin-top:.4rem">⚠ 此為高權限操作，可影響所有俱樂部的設定與成員。</p>',
    },
    'team.manage_self': {
      title: '管理自己的俱樂部',
      body: '允許管理自己擔任領隊或教練的俱樂部，包含編輯俱樂部資訊、管理成員等。',
    },
    'team.review_join': {
      title: '審核入隊申請',
      body: '允許審核用戶提交的入隊申請，決定是否核准加入俱樂部。',
    },
    'team.assign_coach': {
      title: '指派俱樂部教練',
      body: '允許為俱樂部指派或更換教練角色。',
    },
    'team.create_event': {
      title: '建立俱樂部專屬活動',
      body: '允許為所屬俱樂部建立專屬活動，這些活動預設僅對俱樂部成員可見。',
    },
    'team.toggle_event_visibility': {
      title: '切換活動公開性',
      body: '允許將俱樂部專屬活動切換為公開（所有用戶可見）或僅限成員可見。',
    },

    // ─ 用戶管理 ─
    'admin.users.entry': {
      title: '用戶管理（入口）',
      body: '控制是否能在側邊選單中看到並進入「用戶管理」功能區。<br>關閉後該角色將無法存取任何用戶管理功能。',
    },
    'admin.users.edit_profile': {
      title: '編輯用戶基本資料',
      body: '允許編輯其他用戶的基本資料，包含暱稱、地區、性別、運動項目等欄位。',
    },
    'admin.users.change_role': {
      title: '修改用戶身分',
      body: '允許變更用戶的身分層級，例如將一般用戶提升為教練、領隊等。'
        + '<p style="color:#d97706;font-size:.78rem;margin-top:.4rem">⚠ 身分變更會即時影響該用戶的後台權限範圍。</p>',
    },
    'admin.users.restrict': {
      title: '限制 / 解除限制用戶',
      body: '允許對用戶帳號進行限制（停權）或解除限制，被限制的用戶將無法使用部分功能。',
    },

    // ─ 站內信管理 ─
    'admin.messages.entry': {
      title: '站內信管理（入口）',
      body: '控制是否能在側邊選單中看到並進入「站內信管理」功能區。',
    },
    'admin.messages.compose': {
      title: '撰寫廣播站內信',
      body: '允許撰寫並發送廣播站內信，可選擇發送對象（全體用戶、特定層級、特定俱樂部等）。',
    },
    'admin.messages.delete': {
      title: '刪除站內信',
      body: '允許刪除系統中的站內信訊息。',
    },

    // ─ 用戶補正管理 ─
    'admin.repair.entry': {
      title: '用戶補正管理（入口）',
      body: '控制是否能在側邊選單中看到並進入「用戶補正」功能區。<br>此功能用於修正系統資料異常。',
    },
    'admin.repair.team_join_repair': {
      title: '歷史入隊補正',
      body: '允許為用戶補正歷史入隊紀錄，適用於入隊時間或紀錄有誤的情況。',
    },
    'admin.repair.no_show_adjust': {
      title: '放鴿子修改',
      body: '允許修改用戶的放鴿子（未出席）紀錄，適用於誤判或特殊情況需要調整時。',
    },
    'admin.repair.data_sync': {
      title: '系統資料同步',
      body: '允許執行系統資料同步操作，修正快取與資料庫之間的不一致問題。',
    },

    // ─ 日誌中心 ─
    'admin.logs.entry': {
      title: '日誌中心（入口）',
      body: '控制是否能在側邊選單中看到並進入「日誌中心」功能區。',
    },
    'admin.logs.error_read': {
      title: '錯誤日誌讀取',
      body: '允許查看系統錯誤日誌，了解系統運行狀態與異常記錄。',
    },
    'admin.logs.error_delete': {
      title: '錯誤日誌清除',
      body: '允許清除系統錯誤日誌記錄。'
        + '<p style="color:#d97706;font-size:.78rem;margin-top:.4rem">⚠ 清除後無法復原，建議確認無需調查後再清除。</p>',
    },
    'admin.logs.audit_read': {
      title: '稽核日誌讀取',
      body: '允許查看稽核日誌，記錄所有管理員的操作行為（角色變更、EXP 調整、活動管理等）。',
    },

    // ─ 入口權限（無子項目）─
    'admin.games.entry': {
      title: '小遊戲管理',
      body: '允許進入小遊戲管理功能區，可管理射門遊戲、踢球遊戲等小遊戲的設定與排行榜。',
    },
    'admin.shop.entry': {
      title: '二手商品管理',
      body: '允許進入二手商品管理功能區，可檢視與管理用戶刊登的二手運動用品。',
    },
    'admin.banners.entry': {
      title: '廣告管理',
      body: '允許進入廣告管理功能區，可管理首頁輪播廣告、浮動廣告、贊助廣告與品牌開機畫面。',
    },
    'admin.dashboard.entry': {
      title: '數據儀表板',
      body: '允許進入數據儀表板，可查看活動統計、用戶數據、報名趨勢等分析報表。',
    },
    'admin.themes.entry': {
      title: '佈景主題',
      body: '允許進入佈景主題管理，可切換或自訂系統的視覺主題配色。',
    },
    'admin.exp.entry': {
      title: '手動 EXP 管理',
      body: '允許進入手動 EXP 管理功能，可為用戶個別或批次加減經驗值。',
    },
    'admin.auto_exp.entry': {
      title: '自動 EXP 管理',
      body: '允許進入自動 EXP 管理功能，可設定自動發放經驗值的規則條件與數值。',
    },
    'admin.announcements.entry': {
      title: '系統公告管理',
      body: '允許進入系統公告管理功能，可建立、編輯、排程與刪除系統公告。',
    },
    'admin.achievements.entry': {
      title: '成就 / 徽章管理',
      body: '允許進入成就與徽章管理功能，可建立、編輯成就條件、設定獎勵徽章與自動發放規則。',
    },
    'admin.notif.entry': {
      title: '推播通知設定',
      body: '允許進入推播通知設定頁面，查看目前的分類與通知類型開關。這個入口本身不代表可修改設定，若要儲存仍需另外具備「修改推播開關」權限。',
    },
    'admin.notif.toggle': {
      title: '修改推播開關',
      body: '允許修改 LINE 推播通知的分類開關與指定模板開關。此權限只應影響 siteConfig/featureFlags 的 notificationToggles 欄位，不會擴及其他站台設定文件。',
    },
    'admin.inactive.entry': {
      title: '無效資料查詢',
      body: '允許進入無效資料查詢功能，可查看已解散的俱樂部與長期未活動用戶的清單。',
    },
  },

  // ── 權限說明彈窗 ──

  _showPermInfoPopup(code) {
    var item = this._PERM_INFO[code];
    if (!item) return;
    var overlay = document.createElement('div');
    overlay.className = 'perm-info-overlay';
    overlay.onclick = function(e) { if (e.target === overlay) overlay.remove(); };
    // 阻止背景穿透滾動
    overlay.addEventListener('touchmove', function(e) {
      if (!e.target.closest('.perm-info-dialog')) { e.preventDefault(); e.stopPropagation(); }
    }, { passive: false });
    overlay.innerHTML = '<div class="perm-info-dialog">'
      + '<div class="perm-info-dialog-title">' + item.title + '</div>'
      + '<div class="perm-info-dialog-body">' + item.body + '</div>'
      + '<button class="primary-btn" style="width:100%;margin-top:.8rem" onclick="this.closest(\'.perm-info-overlay\').remove()">了解</button>'
      + '</div>';
    document.body.appendChild(overlay);
  },

});
