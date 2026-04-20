/* ================================================
   SportHub — Admin Dashboard Drilldown: 註冊用戶詳情
   15 項指標（概覽 / 詳情 / 排行 三 Tab）
   依賴：dashboard-drilldown-core.js, dashboard-snapshot.js
   ================================================ */

Object.assign(App, {

  _renderDashDrillUsers() {
    const filtered = this._getFilteredDashSnapshot();
    if (!filtered) {
      this.showToast?.('尚無資料，請先撈取');
      return;
    }
    const users = filtered.users || [];

    const now = Date.now();
    const MS_DAY = 24 * 3600 * 1000;
    const cutoff7 = now - 7 * MS_DAY;
    const cutoff30 = now - 30 * MS_DAY;
    const cutoff90 = now - 90 * MS_DAY;

    const toMillis = (v) => {
      if (!v) return 0;
      if (typeof v.toMillis === 'function') return v.toMillis();
      if (v.seconds) return v.seconds * 1000;
      const t = new Date(v).getTime();
      return isNaN(t) ? 0 : t;
    };

    const activeIn = (cutoff) => users.filter(u => toMillis(u.lastLogin) >= cutoff).length;
    const newIn = (cutoff) => users.filter(u => toMillis(u.createdAt) >= cutoff).length;

    // ══════════ 概覽 Tab ══════════
    const renderOverview = () => {
      const total = users.length;
      const a7 = activeIn(cutoff7);
      const a30 = activeIn(cutoff30);
      const a90 = activeIn(cutoff90);
      const n7 = newIn(cutoff7);
      const n30 = newIn(cutoff30);

      const overviewHtml = this._dashStatGrid([
        { num: total, label: '總用戶數' },
        { num: a7, label: '7 天活躍' },
        { num: a30, label: '30 天活躍' },
        { num: a90, label: '90 天活躍' },
      ]);

      const trendHtml = this._dashStatGrid([
        { num: '+' + n7, label: '近 7 天新增' },
        { num: '+' + n30, label: '近 30 天新增' },
      ]);

      return this._dashSection('總覽', overviewHtml)
           + this._dashSection('新增趨勢', trendHtml);
    };

    // ══════════ 詳情 Tab ══════════
    const renderDetail = () => {
      // 身分分布
      const roleLabels = { super_admin: '超管', admin: '管理員', captain: '幹部', coach: '教練', venue_owner: '場地主', user: '一般用戶' };
      const roleCounts = {};
      users.forEach(u => {
        const r = u.role || 'user';
        roleCounts[r] = (roleCounts[r] || 0) + 1;
      });
      const roleEntries = Object.entries(roleCounts).map(([k, v]) => [roleLabels[k] || k, v]);

      // 性別
      const genderCounts = { '男': 0, '女': 0, '其他': 0, '未填': 0 };
      users.forEach(u => {
        const g = u.gender;
        if (g === '男' || g === 'male' || g === 'M') genderCounts['男']++;
        else if (g === '女' || g === 'female' || g === 'F') genderCounts['女']++;
        else if (g) genderCounts['其他']++;
        else genderCounts['未填']++;
      });

      // 地區 Top 10
      const regionCounts = {};
      users.forEach(u => {
        const r = u.region || '未填';
        regionCounts[r] = (regionCounts[r] || 0) + 1;
      });
      const topRegions = Object.entries(regionCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

      // 運動偏好 Top 10（兼容字串或陣列）
      const sportCounts = {};
      users.forEach(u => {
        let sports = u.sports;
        if (!sports) { sportCounts['未填'] = (sportCounts['未填'] || 0) + 1; return; }
        if (typeof sports === 'string') sports = sports.split(/[,，、\s]+/).filter(Boolean);
        if (Array.isArray(sports)) {
          sports.forEach(s => {
            const ss = String(s).trim();
            if (ss) sportCounts[ss] = (sportCounts[ss] || 0) + 1;
          });
        }
      });
      const topSports = Object.entries(sportCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

      // 年齡分布
      const ageGroups = { '<20': 0, '20-30': 0, '31-40': 0, '41-50': 0, '51+': 0, '未填': 0 };
      const thisYear = new Date().getFullYear();
      users.forEach(u => {
        if (!u.birthday) { ageGroups['未填']++; return; }
        const y = parseInt(String(u.birthday).slice(0, 4));
        if (isNaN(y) || y < 1900 || y > thisYear) { ageGroups['未填']++; return; }
        const age = thisYear - y;
        if (age < 20) ageGroups['<20']++;
        else if (age <= 30) ageGroups['20-30']++;
        else if (age <= 40) ageGroups['31-40']++;
        else if (age <= 50) ageGroups['41-50']++;
        else ageGroups['51+']++;
      });

      // 等級分布
      const levelGroups = { '0-5': 0, '6-10': 0, '11-20': 0, '21+': 0 };
      users.forEach(u => {
        const lv = (typeof this._calcLevelFromExp === 'function')
          ? this._calcLevelFromExp(u.exp || 0).level
          : 0;
        if (lv <= 5) levelGroups['0-5']++;
        else if (lv <= 10) levelGroups['6-10']++;
        else if (lv <= 20) levelGroups['11-20']++;
        else levelGroups['21+']++;
      });

      // 其他指標
      const inTeam = users.filter(u => Array.isArray(u.teamIds) && u.teamIds.length > 0).length;
      const teamRate = users.length > 0 ? Math.round(inTeam / users.length * 100) : 0;
      const restricted = users.filter(u => u.restricted === true).length;
      const linePush = users.filter(u => u.lineNotify && u.lineNotify.bound === true).length;
      const linePushRate = users.length > 0 ? Math.round(linePush / users.length * 100) : 0;

      // 登入 IP 地區（新欄位）
      const ipRegionCounts = {};
      users.forEach(u => {
        if (!u.lastLoginRegion) return;
        ipRegionCounts[u.lastLoginRegion] = (ipRegionCounts[u.lastLoginRegion] || 0) + 1;
      });
      const topIpRegions = Object.entries(ipRegionCounts).sort((a, b) => b[1] - a[1]).slice(0, 10);

      const otherMetricsHtml = `
        <div class="dash-kv">俱樂部歸屬率：<strong>${inTeam} / ${users.length}</strong>（${teamRate}%）</div>
        <div class="dash-kv">受限用戶：<strong>${restricted}</strong></div>
        <div class="dash-kv">LINE 推播綁定率：<strong>${linePush} / ${users.length}</strong>（${linePushRate}%）</div>
      `;

      let html = this._dashSection('身分分布', this._dashBarList(roleEntries, users.length))
               + this._dashSection('性別分布', this._dashBarList(Object.entries(genderCounts), users.length))
               + this._dashSection('地區分布（前 10）', this._dashBarList(topRegions, users.length))
               + this._dashSection('運動偏好（前 10）', this._dashBarList(topSports, users.length))
               + this._dashSection('年齡分布', this._dashBarList(Object.entries(ageGroups), users.length))
               + this._dashSection('等級分布', this._dashBarList(Object.entries(levelGroups), users.length))
               + this._dashSection('其他指標', otherMetricsHtml);
      if (topIpRegions.length > 0) {
        html += this._dashSection('登入 IP 地區（前 10）', this._dashBarList(topIpRegions, users.length), '資料累積中');
      }
      return html;
    };

    // ══════════ 排行 Tab ══════════
    const renderRanking = () => {
      const topExp = [...users].sort((a, b) => (b.exp || 0) - (a.exp || 0)).slice(0, 10);
      const topNoShow = [...users]
        .filter(u => (u.noShowCount || 0) > 0)
        .sort((a, b) => (b.noShowCount || 0) - (a.noShowCount || 0))
        .slice(0, 10);

      const currentRole = (typeof ApiService !== 'undefined' && ApiService.getCurrentUser)
        ? (ApiService.getCurrentUser()?.role || 'user') : 'user';
      const stealthAdmins = (currentRole === 'super_admin')
        ? users.filter(u => u.stealth === true && (u.role === 'admin' || u.role === 'super_admin'))
        : [];

      const renderUserItem = (u, extra) => {
        const name = u.displayName || u.name || '(無名)';
        const uid = u.uid || u.lineUserId || '';
        return `<div class="dash-rank-item" data-uid="${escapeHTML(uid)}" data-name="${escapeHTML(name)}">
          <span class="dash-rank-name">${escapeHTML(name)}</span>
          <span class="dash-rank-val">${escapeHTML(String(extra))}</span>
        </div>`;
      };

      const expHtml = topExp.length > 0
        ? topExp.map((u, i) => renderUserItem(u, `#${i + 1} · ${(u.exp || 0).toLocaleString()} EXP`)).join('')
        : '<div class="dash-empty">無資料</div>';

      const noShowHtml = topNoShow.length > 0
        ? topNoShow.map(u => renderUserItem(u, `${u.noShowCount} 次`)).join('')
        : '<div class="dash-empty">無放鴿子紀錄</div>';

      let html = this._dashSection('EXP 排行 Top 10', expHtml)
               + this._dashSection('放鴿子排行 Top 10', noShowHtml);

      if (currentRole === 'super_admin') {
        const stealthHtml = stealthAdmins.length > 0
          ? stealthAdmins.map(u => renderUserItem(u, '🫥 隱身中')).join('')
          : '<div class="dash-empty">目前無隱身中的管理員</div>';
        html += this._dashSection('隱身中的管理員', stealthHtml, '僅超管可見');
      }

      return html;
    };

    // 建立彈窗
    this._renderDashDrillShell({
      title: '註冊用戶詳情',
      infoKey: 'users',
      tabs: [
        { key: 'overview', label: '概覽', render: renderOverview },
        { key: 'detail',   label: '詳情', render: renderDetail },
        { key: 'ranking',  label: '排行', render: renderRanking },
      ],
    });

    // 延遲綁定 rank item 點擊（第一個 Tab 未必是 ranking）
    this._bindDashRankItemClicks();
  },

  /** 綁定「排行項目點擊 → 開個人名片」的事件（用 event delegation 處理 Tab 切換後的新節點） */
  _bindDashRankItemClicks() {
    const body = document.getElementById('dash-drill-body');
    if (!body || body.dataset.rankBound === '1') return;
    body.dataset.rankBound = '1';
    body.addEventListener('click', (e) => {
      const item = e.target.closest('.dash-rank-item');
      if (!item) return;
      const uid = item.dataset.uid;
      const name = item.dataset.name;
      if (!name) return;
      if (typeof this.showUserProfile === 'function') {
        this.showUserProfile(name, { uid });
      }
    });
  },

});
