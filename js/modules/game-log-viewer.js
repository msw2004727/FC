/* ================================================
   SportHub — 養成遊戲 Log 查詢（管理員用）
   查詢用戶的遊戲存檔、戰績、數值、裝備
   位於：小遊戲管理 → 遊戲 Log 查詢
   ================================================ */

Object.assign(App, {

  _gameLogCache: null,   // { uid, save, profile }
  _gameLogResults: null,  // 搜尋結果列表

  /* ── 渲染主畫面 ── */
  renderGameLogViewer() {
    const container = document.getElementById('game-log-viewer');
    if (!container) return;

    container.innerHTML = `
      <div style="margin-bottom:.8rem">
        <div style="display:flex;gap:.4rem">
          <input type="text" id="game-log-search" placeholder="輸入暱稱模糊搜尋..."
            style="flex:1;padding:.5rem .7rem;border:1px solid var(--border);border-radius:8px;font-size:.85rem;background:var(--card-bg);color:var(--text-primary)">
          <button class="primary-btn" onclick="App.searchGameLog()" style="white-space:nowrap;padding:.5rem .8rem">搜尋</button>
        </div>
      </div>
      <div id="game-log-results" style="font-size:.82rem;color:var(--text-muted)">輸入暱稱後點搜尋</div>
      <div id="game-log-detail" style="display:none"></div>
    `;

    const input = document.getElementById('game-log-search');
    if (input) {
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') this.searchGameLog();
      });
    }
  },

  /* ── 模糊搜尋用戶（從 adminUsers 快取 + gamePublic） ── */
  async searchGameLog() {
    const input = document.getElementById('game-log-search');
    const resultsEl = document.getElementById('game-log-results');
    const detailEl = document.getElementById('game-log-detail');
    if (!input || !resultsEl) return;

    const keyword = (input.value || '').trim();
    if (!keyword) {
      resultsEl.innerHTML = '<div style="color:var(--text-muted)">請輸入暱稱關鍵字</div>';
      if (detailEl) detailEl.style.display = 'none';
      return;
    }

    resultsEl.innerHTML = '<div style="color:var(--text-muted)">搜尋中...</div>';
    if (detailEl) detailEl.style.display = 'none';

    try {
      const db = firebase.firestore();
      const kw = keyword.toLowerCase();

      // 從 adminUsers 快取搜尋 displayName
      const allUsers = (typeof FirebaseService !== 'undefined' && FirebaseService._cache)
        ? (FirebaseService._cache.adminUsers || [])
        : [];
      const nameMatches = allUsers.filter(u => {
        const dn = (u.displayName || u.name || '').toLowerCase();
        return dn.includes(kw);
      });

      // 對每個匹配用戶，嘗試讀取 gamePublic/profile
      const tasks = nameMatches.map(async (u) => {
        const uid = u.uid || u._docId;
        if (!uid) return null;
        try {
          const profSnap = await db.collection('users').doc(uid).collection('gamePublic').doc('profile').get();
          if (!profSnap.exists) return null;
          const p = profSnap.data();
          return {
            uid,
            displayName: u.displayName || u.name || '',
            customName: p.customName || '',
            level: p.level || 1,
            skin: p.skin || 'whiteCat',
            lastOnline: p.lastOnline || null,
            equipped: p.equipped || {},
          };
        } catch (e) { return null; }
      });

      // 也搜尋 customName（遊戲暱稱可能不同於 LINE 名稱）
      // 取所有用戶 UID，批次查 gamePublic
      const allUids = allUsers.map(u => u.uid || u._docId).filter(Boolean);
      const nameMatchUids = new Set(nameMatches.map(u => u.uid || u._docId));

      // 對非 displayName 匹配的用戶，查 customName
      const otherUids = allUids.filter(id => !nameMatchUids.has(id));
      // 為避免過多查詢，限制最多查 50 筆（如果用戶很多）
      const batchUids = otherUids.slice(0, 50);
      const customTasks = batchUids.map(async (uid) => {
        try {
          const profSnap = await db.collection('users').doc(uid).collection('gamePublic').doc('profile').get();
          if (!profSnap.exists) return null;
          const p = profSnap.data();
          const cn = (p.customName || '').toLowerCase();
          if (!cn.includes(kw)) return null;
          const user = allUsers.find(u => (u.uid || u._docId) === uid);
          return {
            uid,
            displayName: (user && (user.displayName || user.name)) || '',
            customName: p.customName || '',
            level: p.level || 1,
            skin: p.skin || 'whiteCat',
            lastOnline: p.lastOnline || null,
            equipped: p.equipped || {},
          };
        } catch (e) { return null; }
      });

      const results = await Promise.all([...tasks, ...customTasks]);
      const matches = results.filter(Boolean);

      // 去重（同一 UID 可能從兩邊都匹配到）
      const seen = new Set();
      const unique = [];
      for (const m of matches) {
        if (!seen.has(m.uid)) { seen.add(m.uid); unique.push(m); }
      }

      this._gameLogResults = unique;

      if (!unique.length) {
        resultsEl.innerHTML = `<div style="color:var(--text-muted)">找不到符合「${escapeHTML(keyword)}」的用戶（或該用戶尚無遊戲存檔）</div>`;
        return;
      }

      resultsEl.innerHTML = unique.map((m, i) => {
        const name = escapeHTML(m.customName || m.displayName || '未命名');
        const sub = m.customName && m.displayName
          ? `<span style="color:var(--text-muted);font-size:.72rem">（${escapeHTML(m.displayName)}）</span>` : '';
        const lastOn = m.lastOnline && m.lastOnline.toDate
          ? m.lastOnline.toDate().toLocaleString('zh-TW') : '-';
        return `
          <div class="banner-manage-card" style="cursor:pointer;margin-bottom:.4rem"
               onclick="App.viewGameLog(${i})">
            <div style="display:flex;align-items:center;gap:.5rem;width:100%">
              <div style="flex:1">
                <div style="font-weight:700;font-size:.85rem">${name} ${sub}</div>
                <div style="font-size:.72rem;color:var(--text-muted)">Lv.${m.level} · ${escapeHTML(m.skin)} · 最後上線：${lastOn}</div>
              </div>
              <span style="color:var(--text-muted);font-size:.8rem">&rarr;</span>
            </div>
          </div>
        `;
      }).join('');
    } catch (err) {
      console.error('[GameLog] search error:', err);
      resultsEl.innerHTML = `<div style="color:#ef4444">搜尋失敗：${escapeHTML(err.message)}</div>`;
    }
  },

  /* ── 查看單一用戶詳情 ── */
  async viewGameLog(index) {
    const matches = this._gameLogResults;
    if (!matches || !matches[index]) return;

    const m = matches[index];
    const detailEl = document.getElementById('game-log-detail');
    const resultsEl = document.getElementById('game-log-results');
    if (!detailEl) return;

    detailEl.style.display = 'block';
    detailEl.innerHTML = '<div style="color:var(--text-muted);padding:.5rem 0">載入存檔中...</div>';
    if (resultsEl) resultsEl.style.display = 'none';

    try {
      const db = firebase.firestore();
      const saveSnap = await db.collection('users').doc(m.uid).collection('game').doc('save').get();
      const save = saveSnap.exists ? saveSnap.data() : null;

      this._gameLogCache = { uid: m.uid, profile: m, save };
      this._renderGameLogDetail(detailEl, m, save);
    } catch (err) {
      detailEl.innerHTML = `<div style="color:#ef4444">載入失敗：${escapeHTML(err.message)}</div>`;
    }
  },

  /* ── 渲染詳情 ── */
  _renderGameLogDetail(el, profile, save) {
    const name = escapeHTML(profile.customName || profile.displayName || '未命名');
    const ch = save && save.character ? save.character : {};
    const lt = save && save.lifetime ? save.lifetime : {};
    const sc = save && save.scene ? save.scene : {};
    const stats = ch.stats || {};

    const savedAt = save && save.savedAt && save.savedAt.toDate
      ? save.savedAt.toDate().toLocaleString('zh-TW') : '-';
    const createdAt = save && save.createdAt && save.createdAt.toDate
      ? save.createdAt.toDate().toLocaleString('zh-TW') : '-';

    // 敵人擊殺統計
    let enemyKillsHtml = '-';
    if (lt.enemyKills && typeof lt.enemyKills === 'object') {
      const entries = Object.entries(lt.enemyKills);
      if (entries.length) {
        enemyKillsHtml = entries.map(([k, v]) => `${escapeHTML(k)}: ${v}`).join(', ');
      }
    }

    // Boss 擊殺
    let bossKillsHtml = '0';
    if (lt.enemyBossKills && typeof lt.enemyBossKills === 'object') {
      const entries = Object.entries(lt.enemyBossKills);
      if (entries.length) {
        bossKillsHtml = entries.map(([k, v]) => `${escapeHTML(k)}: ${v}`).join(', ');
      }
    }

    // 裝備
    let equippedHtml = '無裝備';
    if (profile.equipped && typeof profile.equipped === 'object') {
      const eqEntries = Object.entries(profile.equipped).filter(([, v]) => v);
      if (eqEntries.length) {
        equippedHtml = eqEntries.map(([slot, item]) => {
          const itemName = typeof item === 'object' ? (item.name || item.icon || '?') : item;
          return `${escapeHTML(slot)}: ${escapeHTML(String(itemName))}`;
        }).join('<br>');
      }
    }

    el.innerHTML = `
      <div style="margin-bottom:.5rem">
        <button class="text-btn" onclick="App.backToGameLogList()" style="font-size:.8rem;color:var(--primary)">&larr; 返回列表</button>
      </div>

      <div class="banner-manage-card" style="flex-direction:column;gap:.5rem;margin-bottom:.6rem">
        <div style="font-weight:800;font-size:1rem">${name}</div>
        <div style="font-size:.72rem;color:var(--text-muted)">UID: ${escapeHTML(profile.uid)}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.3rem .8rem;font-size:.78rem">
          <div>皮膚：${escapeHTML(ch.skin || profile.skin || '-')}</div>
          <div>等級：Lv.${ch.level || profile.level || 1}</div>
          <div>EXP：${ch.exp || 0} / ${ch.expToNext || 100}</div>
          <div>MBTI：${escapeHTML(ch.mbti || '-')}</div>
          <div>體力：${ch.staminaCurrent || '-'}</div>
          <div>虛弱等級：${ch.weakLevel || 0}</div>
          <div>建立時間：${createdAt}</div>
          <div>最後存檔：${savedAt}</div>
          <div>遊戲時長：${save && save.playTimeMinutes ? save.playTimeMinutes + ' 分鐘' : '-'}</div>
        </div>
      </div>

      <div class="banner-manage-card" style="flex-direction:column;gap:.4rem;margin-bottom:.6rem">
        <div style="font-weight:700;font-size:.85rem">六維數值</div>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:.3rem;font-size:.78rem">
          <div>體力：${stats.stamina || 0}</div>
          <div>敏捷：${stats.agility || 0}</div>
          <div>速度：${stats.speed || 0}</div>
          <div>幸運：${stats.luck || 0}</div>
          <div>體質：${stats.constitution || 0}</div>
          <div>智力：${stats.intelligence || 0}</div>
        </div>
      </div>

      <div class="banner-manage-card" style="flex-direction:column;gap:.4rem;margin-bottom:.6rem">
        <div style="font-weight:700;font-size:.85rem">戰績統計</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.3rem .8rem;font-size:.78rem">
          <div>總動作：${lt.totalActions || 0}</div>
          <div>踢球：${lt.totalKicks || 0}</div>
          <div>睡覺：${lt.totalSleeps || 0}</div>
          <div>死亡：${lt.deaths || 0}</div>
          <div>紅花：${lt.flowersRed || 0}</div>
          <div>金花：${lt.flowersGold || 0}</div>
          <div>PvP 勝：${lt.pvpWins || 0}</div>
          <div>PvP 敗：${lt.pvpLosses || 0}</div>
          <div>擊殺玩家：${lt.playerKills || 0}</div>
          <div>拜訪次數：${lt.visitsMade || 0}</div>
          <div>被訪次數：${lt.visitsReceived || 0}</div>
          <div>交易完成：${lt.tradesCompleted || 0}</div>
        </div>
        <div style="font-size:.75rem;margin-top:.2rem">
          <span style="font-weight:600">敵人擊殺明細：</span>${enemyKillsHtml}
        </div>
        <div style="font-size:.75rem">
          <span style="font-weight:600">Boss 擊殺明細：</span>${bossKillsHtml}
        </div>
      </div>

      <div class="banner-manage-card" style="flex-direction:column;gap:.4rem;margin-bottom:.6rem">
        <div style="font-weight:700;font-size:.85rem">場景狀態</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:.3rem .8rem;font-size:.78rem">
          <div>花朵數：${Array.isArray(sc.flowers) ? sc.flowers.length : 0}</div>
          <div>雜草數：${Array.isArray(sc.grass) ? sc.grass.length : 0}</div>
          <div>墓碑數：${Array.isArray(sc.graves) ? sc.graves.length : 0}</div>
          <div>金花計數器：${sc.goldCounter || 0}</div>
          <div>天氣：${sc.weather ? escapeHTML(sc.weather.type || 'clear') : '-'}</div>
        </div>
      </div>

      <div class="banner-manage-card" style="flex-direction:column;gap:.4rem;margin-bottom:.6rem">
        <div style="font-weight:700;font-size:.85rem">裝備</div>
        <div style="font-size:.78rem">${equippedHtml}</div>
      </div>

      <button class="primary-btn full-width" onclick="App.exportGameLog()" style="margin-top:.3rem">匯出遊戲 Log（JSON）</button>
    `;
  },

  /* ── 返回列表 ── */
  backToGameLogList() {
    const detailEl = document.getElementById('game-log-detail');
    const resultsEl = document.getElementById('game-log-results');
    if (detailEl) detailEl.style.display = 'none';
    if (resultsEl) resultsEl.style.display = '';
  },

  /* ── 匯出 JSON ── */
  exportGameLog() {
    const cache = this._gameLogCache;
    if (!cache) {
      this.showToast('無資料可匯出');
      return;
    }

    const exportData = {
      exportedAt: new Date().toISOString(),
      uid: cache.uid,
      profile: {
        displayName: cache.profile.displayName,
        customName: cache.profile.customName,
        level: cache.profile.level,
        skin: cache.profile.skin,
      },
      save: null,
    };

    if (cache.save) {
      const s = JSON.parse(JSON.stringify(cache.save, (key, val) => {
        if (val && typeof val === 'object' && val.seconds !== undefined && val.nanoseconds !== undefined) {
          return new Date(val.seconds * 1000).toISOString();
        }
        return val;
      }));
      exportData.save = s;
    }

    const json = JSON.stringify(exportData, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const fileName = (cache.profile.customName || cache.profile.displayName || cache.uid)
      .replace(/[<>:"/\\|?*]/g, '_');
    a.href = url;
    a.download = `game-log-${fileName}-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.showToast('已匯出遊戲 Log');
  },

});
