/* ================================================
   SportHub — Admin Dashboard: Info Modal
   說明按鈕 + 說明彈窗（9 份內容：1 撈取資料 + 8 卡片）
   風格參考 inv-transactions / edu-info-btn
   ================================================ */

Object.assign(App, {

  /** 9 份說明內容：[key]: { title, sections: [{ h, p }] } */
  _dashInfoContent: {
    refresh: {
      title: '重新整理資料說明',
      sections: [
        { h: '為什麼要「重新整理」？', p: '儀表板的詳細數據需要從雲端資料庫撈取完整紀錄（非快取），才能看到正確的 6 個月統計，所以每次查看前請先點「重新整理完整資料」。' },
        { h: '時間區間', p: '可選 1 / 3 / 6 / 12 個月（預設 6）。區間越長，撈取資料越多、越慢。' },
        { h: '撈取內容', p: '系統會依序撈取 7 類資料：用戶 → 俱樂部 → 賽事 → 活動 → 報名紀錄 → 簽到紀錄 → 活動紀錄。進度條會顯示每步完成的筆數。' },
        { h: '費用 / 影響', p: '純讀取操作，不會修改任何資料。每次撈取約數千次 Firestore 讀取，成本極低（約 $0.5 美金/月）。' },
        { h: '取消與重試', p: '撈取過程可隨時取消。取消後已撈部分會清空，避免誤用不完整資料。' },
        { h: '切換時間區間', p: '若切到比目前更小的區間（例如 6→3 個月），會自動前端篩選不用重撈；若切到更大的區間（例如 6→12），會提示重新撈取。' },
      ],
    },

    users: {
      title: '註冊用戶 — 指標說明',
      sections: [
        { h: '概覽 Tab', p: '顯示總用戶數、近 7/30/90 天活躍數（依最後登入時間）、近 30 天新增趨勢。' },
        { h: '詳情 Tab', p: '各維度分布：身分（超管/管理員/幹部/教練/一般用戶）、性別、地區、運動偏好、年齡、等級、俱樂部歸屬率、LINE 推播綁定率、登入 IP 地區（資料累積中）等。' },
        { h: '排行 Tab', p: 'EXP 排行 Top 10、放鴿子排行 Top 10；點擊任一用戶可進入該用戶名片頁。' },
        { h: '隱身管理員', p: '僅超級管理員可看到「隱身中的管理員」清單，方便管理。' },
      ],
    },

    events: {
      title: '活動總數 — 指標說明',
      sections: [
        { h: '概覽 Tab', p: '活動總數、平均填滿率、近 30 天新增、狀態分布（開放中/已滿/已結束/已取消）。' },
        { h: '詳情 Tab', p: '依類型（PLAY/友誼/教學/觀賽/外部）、運動、地點分布。旗標統計：個人辦 vs 俱樂部辦、私密活動、俱樂部限定、性別限定、有黑名單的活動、平均瀏覽數。' },
        { h: '排行 Tab', p: '主辦人排行 Top 10（點擊進個人名片）、熱門地點 Top 10、置頂活動清單（點擊進活動詳情）。' },
      ],
    },

    teams: {
      title: '活躍俱樂部 — 指標說明',
      sections: [
        { h: '概覽 Tab', p: '總俱樂部數、活躍俱樂部、近 30 天新增、沉寂俱樂部（近 90 天無新活動）。' },
        { h: '詳情 Tab', p: '規模分布（<5/5-10/11-20/21+人）、運動/地區分布、教練配置率、幹部配置率、會員 30 天活躍率。' },
        { h: '排行 Tab', p: '積分排行、活動主辦排行、沉寂俱樂部清單；點擊俱樂部進入詳情頁。' },
      ],
    },

    tournaments: {
      title: '進行中賽事 — 指標說明',
      sections: [
        { h: '概覽 Tab', p: '進行中賽事數、全部賽事數、近 30 天新增、平均隊伍數。' },
        { h: '詳情 Tab', p: '賽制分布（聯賽/盃賽/淘汰賽/循環賽）、運動分布、隊伍數分布、剩餘天數、委託人使用率。' },
        { h: '排行 Tab', p: '主辦俱樂部排行、熱門賽事 Top 5（依隊伍數）、近 30 天結束賽事清單。' },
      ],
    },

    openEvents: {
      title: '開放中活動 — 指標說明',
      sections: [
        { h: '概覽 Tab', p: '開放中活動數、平均填滿率、3 天內開始的活動數、距開始時間分布。' },
        { h: '詳情 Tab', p: '填滿率分布（0-30%/30-70%/70-99%/100%候補中）、類型/運動/主辦類型分布、區域熱度、時段（早/午/晚）、星期幾分布、候補壓力。' },
        { h: '排行 Tab', p: '熱度 Top 10（填滿率）、瀏覽數 Top 10（資料累積中）、冷門搶救名單（3 天內開始且填滿率<30%）；點擊進入活動詳情。' },
      ],
    },

    endedEvents: {
      title: '已結束活動 — 指標說明',
      sections: [
        { h: '概覽 Tab', p: '已結束活動數、平均出席率、已取消活動、月份分布（近 6 個月每月結束數）。' },
        { h: '詳情 Tab', p: '出席率分布（0-50%/50-80%/80-100%）、類型/運動/地區分布、平均填滿率、放鴿子事件、超收事件、已取消活動。' },
        { h: '排行 Tab', p: '主辦人排行、最熱門場地、重複舉辦活動 Top 10；點擊用戶進個人名片。' },
      ],
    },

    records: {
      title: '報名紀錄 — 指標說明',
      sections: [
        { h: '概覽 Tab', p: '總報名數、取消率、完成率、近 30 天報名量；狀態分布（已確認/候補/已完成/已取消）。' },
        { h: '詳情 Tab', p: '狀態分布、報名者角色分布、報名時段分布、提前報名天數、同行者使用率、活動類型偏好、依俱樂部分布（前 10）。' },
        { h: '排行 Tab', p: '活躍用戶 Top 10（報名最多）、重複報名用戶 Top 10；點擊進入個人名片。' },
      ],
    },

    attendance: {
      title: '出席率 — 指標說明',
      sections: [
        { h: '概覽 Tab', p: '全站出席率（已簽到/已確認報名，僅限已結束活動）、近 7/30/90 天出席率。' },
        { h: '詳情 Tab', p: '多維度出席率：依類型、運動、地區（≥3 次樣本）、角色、星期幾、時段、新手 vs 老手（註冊 30 天分界）。' },
        { h: '排行 Tab', p: '放鴿子排行 Top 10、全勤榮譽榜（至少 3 場全勤）、放鴿子活動 Top 10（缺席率高，至少 3 人報名）；點擊用戶進名片、點擊活動進詳情。' },
      ],
    },
  },

  /**
   * 開啟說明彈窗
   * @param {string} key refresh|users|events|teams|tournaments|openEvents|endedEvents|records|attendance
   */
  _showDashInfo(key) {
    const info = this._dashInfoContent[key];
    if (!info) return;

    // 移除舊 overlay（避免重複）
    const existing = document.getElementById('dash-info-overlay');
    if (existing) existing.remove();

    const overlay = document.createElement('div');
    overlay.id = 'dash-info-overlay';
    overlay.className = 'dash-info-overlay';

    const sectionsHtml = info.sections.map(s => `
      <div class="dash-info-section">
        <b>${escapeHTML(s.h)}</b>
        <p>${escapeHTML(s.p)}</p>
      </div>
    `).join('');

    overlay.innerHTML = `
      <div class="dash-info-dialog">
        <div class="dash-info-dialog-title">${escapeHTML(info.title)}</div>
        <div class="dash-info-dialog-body">${sectionsHtml}</div>
        <button class="dash-info-close-btn" id="dash-info-close-btn" type="button">我知道了</button>
      </div>
    `;
    document.body.appendChild(overlay);

    // 背景點擊關閉
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay) overlay.remove();
    });
    // 「我知道了」按鈕
    overlay.querySelector('#dash-info-close-btn')?.addEventListener('click', () => overlay.remove());
    // touchmove 穿透保護
    overlay.addEventListener('touchmove', (e) => {
      if (!e.target.closest('.dash-info-dialog')) {
        e.preventDefault();
        e.stopPropagation();
      }
    }, { passive: false });
  },

});
