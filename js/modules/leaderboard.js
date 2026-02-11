/* ================================================
   SportHub — Leaderboard & Activity Records
   ================================================ */

Object.assign(App, {

  renderLeaderboard() {
    const container = document.getElementById('leaderboard-list');
    if (!container) return;
    container.innerHTML = ApiService.getLeaderboard().map((p, i) => {
      const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : 'normal';
      return `
        <div class="lb-item">
          <div class="lb-rank ${rankClass}">${i + 1}</div>
          <div class="lb-avatar">${escapeHTML(p.avatar)}</div>
          <div class="lb-info">
            <div class="lb-name">${this._userTag(p.name)}</div>
            <div class="lb-sub">Lv.${App._calcLevelFromExp(p.exp || 0).level}</div>
          </div>
          <div class="lb-exp">${p.exp.toLocaleString()}</div>
        </div>
      `;
    }).join('');
  },

  renderActivityRecords(filter) {
    const container = document.getElementById('my-activity-records');
    if (!container) return;
    const user = ApiService.getCurrentUser();
    const uid = user?.uid || 'demo-user';
    const all = ApiService.getActivityRecords(uid);
    const statusLabel = { completed: '完成', cancelled: '取消', 'early-left': '早退', registered: '已報名', waitlisted: '候補中' };

    // 篩選邏輯：completed 包含 completed，cancelled 包含 cancelled，all 顯示全部
    let filtered;
    if (!filter || filter === 'all') {
      filtered = all;
    } else if (filter === 'completed') {
      filtered = all.filter(r => r.status === 'completed');
    } else if (filter === 'cancelled') {
      filtered = all.filter(r => r.status === 'cancelled');
    } else if (filter === 'early-left') {
      filtered = all.filter(r => r.status === 'early-left');
    } else {
      filtered = all.filter(r => r.status === filter);
    }

    container.innerHTML = filtered.length ? filtered.map(r => `
      <div class="mini-activity">
        <span class="mini-activity-status ${r.status}"></span>
        <span class="mini-activity-name">${escapeHTML(r.name)}</span>
        <span class="mini-activity-tag ${r.status}">${escapeHTML(statusLabel[r.status] || r.status)}</span>
        <span class="mini-activity-date">${r.date}</span>
      </div>
    `).join('') : '<div style="text-align:center;padding:1rem;font-size:.8rem;color:var(--text-muted)">無紀錄</div>';

    // 更新統計
    const totalRecords = ApiService.getActivityRecords(uid);
    const completedCount = totalRecords.filter(r => r.status === 'completed').length;
    const totalCount = totalRecords.length;
    const cancelledCount = totalRecords.filter(r => r.status === 'cancelled').length;
    const attendRate = totalCount > 0 ? Math.round(((totalCount - cancelledCount) / totalCount) * 100) : 0;

    const el = (id) => document.getElementById(id);
    if (el('profile-stat-total')) el('profile-stat-total').textContent = totalCount;
    if (el('profile-stat-done')) el('profile-stat-done').textContent = completedCount;
    if (el('profile-stat-rate')) el('profile-stat-rate').textContent = `${attendRate}%`;

    const tabs = document.getElementById('record-tabs');
    if (tabs && !tabs.dataset.bound) {
      tabs.dataset.bound = '1';
      tabs.querySelectorAll('.tab').forEach(tab => {
        tab.addEventListener('click', () => {
          tabs.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
          tab.classList.add('active');
          this.renderActivityRecords(tab.dataset.filter);
        });
      });
    }
  },

});
