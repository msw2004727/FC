/* ================================================
   SportHub — Leaderboard & Activity Records
   ================================================ */

Object.assign(App, {

  renderLeaderboard() {
    const container = document.getElementById('leaderboard-list');
    container.innerHTML = ApiService.getLeaderboard().map((p, i) => {
      const rankClass = i === 0 ? 'gold' : i === 1 ? 'silver' : i === 2 ? 'bronze' : 'normal';
      return `
        <div class="lb-item">
          <div class="lb-rank ${rankClass}">${i + 1}</div>
          <div class="lb-avatar">${p.avatar}</div>
          <div class="lb-info">
            <div class="lb-name">${this._userTag(p.name)}</div>
            <div class="lb-sub">Lv.${p.level}</div>
          </div>
          <div class="lb-exp">${p.exp.toLocaleString()}</div>
        </div>
      `;
    }).join('');
  },

  renderActivityRecords(filter) {
    const container = document.getElementById('my-activity-records');
    if (!container) return;
    const all = ApiService.getActivityRecords();
    const filtered = (!filter || filter === 'all') ? all : all.filter(r => r.status === filter);
    const statusLabel = { completed: '完成', cancelled: '取消', 'early-left': '早退' };
    container.innerHTML = filtered.length ? filtered.map(r => `
      <div class="mini-activity">
        <span class="mini-activity-status ${r.status}"></span>
        <span class="mini-activity-name">${r.name}</span>
        <span class="mini-activity-tag ${r.status}">${statusLabel[r.status] || ''}</span>
        <span class="mini-activity-date">${r.date}</span>
      </div>
    `).join('') : '<div style="text-align:center;padding:1rem;font-size:.8rem;color:var(--text-muted)">無紀錄</div>';

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
