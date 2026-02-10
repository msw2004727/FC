/* ================================================
   SportHub — Front-end Render Methods
   依賴：config.js, data.js, api-service.js, app.js (core)
   ================================================ */

Object.assign(App, {

  // ══════════════════════════════════
  //  Render: Hot Events
  // ══════════════════════════════════

  renderHotEvents() {
    const container = document.getElementById('hot-events');
    const upcoming = ApiService.getHotEvents(14);

    container.innerHTML = upcoming.length > 0
      ? upcoming.map(e => `
        <div class="h-card" onclick="App.showEventDetail('${e.id}')">
          ${e.image
            ? `<div class="h-card-img"><img src="${e.image}" alt="${e.title}"></div>`
            : `<div class="h-card-img h-card-placeholder">220 × 90</div>`}
          <div class="h-card-body">
            <div class="h-card-title">${e.title}</div>
            <div class="h-card-meta">
              <span>${e.location.split('市')[0]}市</span>
              <span>${e.current}/${e.max} 人</span>
            </div>
          </div>
        </div>
      `).join('')
      : '<div style="padding:1rem;font-size:.82rem;color:var(--text-muted)">近兩週內無活動</div>';

  },

  // ══════════════════════════════════
  //  Render: Ongoing Tournaments
  // ══════════════════════════════════

  renderOngoingTournaments() {
    const container = document.getElementById('ongoing-tournaments');
    container.innerHTML = ApiService.getTournaments().map(t => `
      <div class="h-card" onclick="App.showTournamentDetail('${t.id}')">
        ${t.image
          ? `<div class="h-card-img"><img src="${t.image}" alt="${t.name}"></div>`
          : `<div class="h-card-img h-card-placeholder">220 × 90</div>`}
        <div class="h-card-body">
          <div class="h-card-title">${t.name}</div>
          <div class="h-card-meta">
            <span>${t.type}</span>
            <span>${t.teams} 隊</span>
          </div>
        </div>
      </div>
    `).join('');

  },

  // ══════════════════════════════════
  //  Render: Activity Timeline
  // ══════════════════════════════════

  renderActivityList() {
    const container = document.getElementById('activity-list');
    if (!container) return;

    const monthGroups = {};
    ApiService.getEvents().forEach(e => {
      const parts = e.date.split(' ')[0].split('/');
      const monthKey = `${parts[0]}/${parts[1]}`;
      const day = parseInt(parts[2], 10);
      const dateObj = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, day);
      const dayName = DAY_NAMES[dateObj.getDay()];

      if (!monthGroups[monthKey]) monthGroups[monthKey] = {};
      if (!monthGroups[monthKey][day]) {
        monthGroups[monthKey][day] = { day, dayName, dateObj, events: [] };
      }
      monthGroups[monthKey][day].events.push(e);
    });

    const today = new Date();
    const todayStr = `${today.getFullYear()}/${today.getMonth()+1}/${today.getDate()}`;

    let html = '';
    Object.keys(monthGroups).sort().forEach(monthKey => {
      const [y, m] = monthKey.split('/');
      const monthLabel = `${y} 年 ${parseInt(m)} 月`;
      html += `<div class="tl-month-group">`;
      html += `<div class="tl-month-header">${monthLabel}</div>`;

      const days = Object.values(monthGroups[monthKey]).sort((a, b) => a.day - b.day);
      days.forEach(dayInfo => {
        const isToday = todayStr === `${y}/${parseInt(m)}/${dayInfo.day}`;
        html += `<div class="tl-day-group">`;
        html += `<div class="tl-date-col${isToday ? ' today' : ''}">
          <div class="tl-day-num">${dayInfo.day}</div>
          <div class="tl-day-name">週${dayInfo.dayName}</div>
        </div>`;
        html += `<div class="tl-events-col">`;

        dayInfo.events.forEach(e => {
          const typeConf = TYPE_CONFIG[e.type] || TYPE_CONFIG.friendly;
          const statusConf = STATUS_CONFIG[e.status] || STATUS_CONFIG.open;
          const time = e.date.split(' ')[1] || '';
          const isEnded = e.status === 'ended' || e.status === 'cancelled';

          html += `
            <div class="tl-event-row tl-type-${e.type}${isEnded ? ' tl-past' : ''}" onclick="App.showEventDetail('${e.id}')">
              <div class="tl-event-info">
                <div class="tl-event-title">${e.title}</div>
                <div class="tl-event-meta">${typeConf.label} · ${time} · ${e.location.split('市')[1] || e.location} · ${e.current}/${e.max}人</div>
              </div>
              <span class="tl-event-status ${statusConf.css}">${statusConf.label}</span>
              <span class="tl-event-arrow">›</span>
            </div>`;
        });

        html += `</div></div>`;
      });

      html += `</div>`;
    });

    container.innerHTML = html;
  },

  // ══════════════════════════════════
  //  Show Event Detail
  // ══════════════════════════════════

  showEventDetail(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;
    const detailImg = document.getElementById('detail-img-placeholder');
    if (detailImg) {
      if (e.image) {
        detailImg.innerHTML = `<img src="${e.image}" alt="${e.title}" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:var(--radius)">`;
        detailImg.style.border = 'none';
      } else {
        detailImg.textContent = '活動圖片 800 × 300';
        detailImg.style.border = '';
      }
    }
    document.getElementById('detail-title').textContent = e.title;
    document.getElementById('detail-body').innerHTML = `
      <div class="detail-row"><span class="detail-label">地點</span>${e.location}</div>
      <div class="detail-row"><span class="detail-label">時間</span>${e.date}</div>
      <div class="detail-row"><span class="detail-label">費用</span>${e.fee > 0 ? '$'+e.fee : '免費'}</div>
      <div class="detail-row"><span class="detail-label">人數</span>已報 ${e.current}/${e.max}　候補 ${e.waitlist}/${e.waitlistMax}</div>
      <div class="detail-row"><span class="detail-label">年齡</span>${e.minAge > 0 ? e.minAge + ' 歲以上' : '無限制'}</div>
      <div class="detail-row"><span class="detail-label">主辦</span>${e.creator}</div>
      ${e.contact ? `<div class="detail-row"><span class="detail-label">聯繫</span>${e.contact}</div>` : ''}
      <div class="detail-row"><span class="detail-label">倒數</span>${e.countdown}</div>
      ${e.notes ? `
      <div class="detail-section">
        <div class="detail-section-title">注意事項</div>
        <p style="font-size:.85rem;color:var(--text-secondary);line-height:1.7;white-space:pre-wrap">${e.notes}</p>
      </div>` : ''}
      <div style="display:flex;gap:.5rem;margin:1rem 0">
        <button class="primary-btn" onclick="App.handleSignup('${e.id}')">${e.current >= e.max ? '候補報名' : '立即報名'}</button>
        <button class="outline-btn disabled" disabled>聯繫主辦人</button>
      </div>
      <div class="detail-section">
        <div class="detail-section-title">報名名單 (${e.current})</div>
        <div class="participant-list">${e.participants.map(p => this._userTag(p)).join('')}</div>
      </div>
      ${e.waitlistNames.length > 0 ? `
      <div class="detail-section">
        <div class="detail-section-title">候補名單 (${e.waitlist})</div>
        <div class="participant-list">${e.waitlistNames.map(p => this._userTag(p)).join('')}</div>
      </div>` : ''}
    `;
    this.showPage('page-activity-detail');
  },

  handleSignup(id) {
    const e = ApiService.getEvent(id);
    if (!e) return;

    if (ApiService._demoMode) {
      this.showToast(e.current >= e.max ? '已額滿，已加入候補名單' : '報名成功！');
      return;
    }

    const user = ApiService.getCurrentUser();
    const userId = user?.uid || 'unknown';
    const userName = user?.displayName || user?.name || '用戶';
    FirebaseService.registerForEvent(id, userId, userName)
      .then(result => {
        this.showToast(result.status === 'waitlisted' ? '已額滿，已加入候補名單' : '報名成功！');
        this.showEventDetail(id);
      })
      .catch(err => {
        console.error('[handleSignup]', err);
        this.showToast(err.message || '報名失敗，請稍後再試');
      });
  },

  // ══════════════════════════════════
  //  Render: Teams
  // ══════════════════════════════════

  _sortTeams(teams) {
    return [...teams].sort((a, b) => {
      if (a.pinned && !b.pinned) return -1;
      if (!a.pinned && b.pinned) return 1;
      if (a.pinned && b.pinned) return (a.pinOrder || 0) - (b.pinOrder || 0);
      return 0;
    });
  },

  _teamCardHTML(t) {
    const pinnedClass = t.pinned ? ' tc-pinned' : '';
    return `
      <div class="tc-card${pinnedClass}" onclick="App.showTeamDetail('${t.id}')">
        ${t.pinned ? '<div class="tc-pin-badge">至頂</div>' : ''}
        <div class="tc-img-placeholder">球隊封面 800 × 300</div>
        <div class="tc-body">
          <div class="tc-name">${t.name}</div>
          <div class="tc-name-en">${t.nameEn || ''}</div>
          <div class="tc-info-row"><span class="tc-label">領隊</span><span>${this._userTag(t.captain, 'captain')}</span></div>
          <div class="tc-info-row"><span class="tc-label">教練</span><span>${t.coaches.length > 0 ? t.coaches.map(c => this._userTag(c, 'coach')).join(' ') : '—'}</span></div>
          <div class="tc-info-row"><span class="tc-label">隊員</span><span>${t.members} 人</span></div>
          <div class="tc-info-row"><span class="tc-label">地區</span><span>${t.region}</span></div>
        </div>
      </div>`;
  },

  renderTeamList() {
    const container = document.getElementById('team-list');
    if (!container) return;
    const sorted = this._sortTeams(ApiService.getActiveTeams());
    container.innerHTML = sorted.map(t => this._teamCardHTML(t)).join('');
  },

  filterTeams() {
    const query = (document.getElementById('team-search')?.value || '').trim().toLowerCase();
    const region = document.getElementById('team-region-filter')?.value || '';
    const container = document.getElementById('team-list');

    let filtered = ApiService.getActiveTeams();
    if (query) {
      filtered = filtered.filter(t =>
        t.name.toLowerCase().includes(query) ||
        (t.nameEn || '').toLowerCase().includes(query) ||
        t.captain.toLowerCase().includes(query)
      );
    }
    if (region) {
      filtered = filtered.filter(t => t.region === region);
    }

    const sorted = this._sortTeams(filtered);
    container.innerHTML = sorted.length > 0
      ? sorted.map(t => this._teamCardHTML(t)).join('')
      : '<div style="grid-column:1/-1;text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">找不到符合的球隊</div>';
  },

  showTeamDetail(id) {
    const t = ApiService.getTeam(id);
    if (!t) return;
    document.getElementById('team-detail-title').textContent = t.name;
    document.getElementById('team-detail-name-en').textContent = t.nameEn || '';

    const totalGames = t.wins + t.draws + t.losses;
    const winRate = totalGames > 0 ? Math.round(t.wins / totalGames * 100) : 0;

    document.getElementById('team-detail-body').innerHTML = `
      <div class="td-card">
        <div class="td-card-title">球隊資訊</div>
        <div class="td-card-grid">
          <div class="td-card-item"><span class="td-card-label">領隊</span><span class="td-card-value">${this._userTag(t.captain, 'captain')}</span></div>
          <div class="td-card-item"><span class="td-card-label">教練</span><span class="td-card-value">${t.coaches.length > 0 ? t.coaches.map(c => this._userTag(c, 'coach')).join(' ') : '無'}</span></div>
          <div class="td-card-item"><span class="td-card-label">隊員數</span><span class="td-card-value">${t.members} 人</span></div>
          <div class="td-card-item"><span class="td-card-label">地區</span><span class="td-card-value">${t.region}</span></div>
        </div>
      </div>
      <div class="td-card">
        <div class="td-card-title">球隊戰績</div>
        <div class="td-stats-row">
          <div class="td-stat"><span class="td-stat-num" style="color:var(--success)">${t.wins}</span><span class="td-stat-label">勝</span></div>
          <div class="td-stat"><span class="td-stat-num" style="color:var(--warning)">${t.draws}</span><span class="td-stat-label">平</span></div>
          <div class="td-stat"><span class="td-stat-num" style="color:var(--danger)">${t.losses}</span><span class="td-stat-label">負</span></div>
          <div class="td-stat"><span class="td-stat-num">${winRate}%</span><span class="td-stat-label">勝率</span></div>
        </div>
        <div class="td-card-grid" style="margin-top:.5rem">
          <div class="td-card-item"><span class="td-card-label">進球</span><span class="td-card-value">${t.gf}</span></div>
          <div class="td-card-item"><span class="td-card-label">失球</span><span class="td-card-value">${t.ga}</span></div>
          <div class="td-card-item"><span class="td-card-label">淨勝球</span><span class="td-card-value">${t.gf - t.ga > 0 ? '+' : ''}${t.gf - t.ga}</span></div>
          <div class="td-card-item"><span class="td-card-label">總場次</span><span class="td-card-value">${totalGames}</span></div>
        </div>
      </div>
      <div class="td-card">
        <div class="td-card-title">賽事紀錄</div>
        ${(t.history || []).map(h => `
          <div class="td-history-row">
            <span class="td-history-name">${h.name}</span>
            <span class="td-history-result">${h.result}</span>
          </div>
        `).join('') || '<div style="font-size:.82rem;color:var(--text-muted);padding:.3rem">尚無賽事紀錄</div>'}
      </div>
      <div class="td-card">
        <div class="td-card-title">成員列表</div>
        <div class="td-member-list">
          ${Array.from({length: Math.min(t.members, 8)}, (_, i) => {
            const role = i === 0 ? 'captain' : i <= t.coaches.length ? 'coach' : 'user';
            const roleLabel = i === 0 ? '領隊' : i <= t.coaches.length ? '教練' : '球員';
            const roleClass = i === 0 ? 'captain' : i <= t.coaches.length ? 'coach' : 'player';
            const memberName = i === 0 ? t.captain : i <= t.coaches.length ? t.coaches[i - 1] : '球員' + String.fromCharCode(65 + i);
            return `
            <div class="td-member-card">
              <div class="td-member-avatar" style="background:${t.color}22;color:${t.color}">${i === 0 ? t.captain.charAt(t.captain.length - 1) : String.fromCharCode(65 + i)}</div>
              <div class="td-member-info">
                <div class="td-member-name">${this._userTag(memberName, role)}</div>
                <span class="td-member-role ${roleClass}">${roleLabel}</span>
              </div>
            </div>`;
          }).join('')}
          ${t.members > 8 ? `<div class="td-member-more">... 共 ${t.members} 人</div>` : ''}
        </div>
      </div>
      <div class="td-actions">
        <button class="primary-btn" onclick="App.handleJoinTeam()">申請加入</button>
        <button class="outline-btn" onclick="App.showToast('透過站內信聯繫')">聯繫領隊</button>
      </div>
    `;
    this.showPage('page-team-detail');
  },

  handleJoinTeam() {
    let teamId = this._userTeam;
    if (!ModeManager.isDemo()) {
      const user = ApiService.getCurrentUser();
      teamId = user && user.teamId ? user.teamId : null;
    }
    if (teamId) {
      const team = ApiService.getTeam(teamId);
      const teamName = team ? team.name : '球隊';
      this.showToast(`您已加入「${teamName}」，無法重複加入其他球隊`);
      return;
    }
    this.showToast('已送出加入申請！');
  },

  goMyTeam() {
    // 正式版：從資料庫取 teamId
    let teamId = this._userTeam;
    if (!ModeManager.isDemo()) {
      const user = ApiService.getCurrentUser();
      teamId = user && user.teamId ? user.teamId : null;
    }
    if (teamId) {
      this.showTeamDetail(teamId);
    } else {
      this.showToast('您目前沒有加入任何球隊');
    }
  },

  // ══════════════════════════════════
  //  Render: Messages
  // ══════════════════════════════════

  renderMessageList() {
    const messages = ApiService.getMessages();
    const container = document.getElementById('message-list');
    container.innerHTML = messages.map(m => `
      <div class="msg-card${m.unread ? ' msg-unread' : ''}" onclick="App.readMessage(this, '${m.id}')">
        <div class="msg-card-header">
          <span class="msg-dot ${m.unread ? 'unread' : 'read'}"></span>
          <span class="msg-type">${m.typeName}</span>
          <span class="msg-title">${m.title}</span>
        </div>
        <div class="msg-preview">${m.preview}</div>
        <div class="msg-time">${m.time}</div>
      </div>
    `).join('');
    this.updateNotifBadge();
    this.updateStorageBar();
  },

  // ══════════════════════════════════
  //  Render: Achievements & Badges
  // ══════════════════════════════════

  _catOrder: { gold: 0, silver: 1, bronze: 2 },
  _catColors: { gold: '#d4a017', silver: '#9ca3af', bronze: '#b87333' },
  _catBg: { gold: 'rgba(212,160,23,.12)', silver: 'rgba(156,163,175,.12)', bronze: 'rgba(184,115,51,.12)' },
  _catLabels: { gold: '金', silver: '銀', bronze: '銅' },

  _sortByCat(items) {
    return [...items].sort((a, b) => (this._catOrder[a.category] ?? 9) - (this._catOrder[b.category] ?? 9));
  },

  renderAchievements() {
    const container = document.getElementById('achievement-grid');
    if (!container) return;
    const sorted = this._sortByCat(ApiService.getAchievements());
    const pending = sorted.filter(a => a.current < a.target);
    const completed = sorted.filter(a => a.current >= a.target);
    const renderRow = a => {
      const done = a.current >= a.target;
      const pct = a.target > 0 ? Math.min(100, Math.round(a.current / a.target * 100)) : 0;
      const bg = this._catBg[a.category] || this._catBg.bronze;
      return `
      <div class="ach-row ${done ? 'ach-done' : ''}" style="background:${done ? 'var(--bg-elevated)' : bg}">
        <span class="ach-cat-chip ach-cat-${a.category}">${this._catLabels[a.category] || '銅'}</span>
        <span class="ach-row-name">${a.name}</span>
        <span class="ach-row-desc">${a.desc}</span>
        <div class="ach-bar-mini"><div class="ach-bar-fill" style="width:${pct}%"></div></div>
        <span class="ach-row-num">${a.current}/${a.target}</span>
        ${done ? `<span class="ach-row-done">已完成</span>` : ''}
        ${done && a.completedAt ? `<span class="ach-row-time">${a.completedAt}</span>` : ''}
      </div>`;
    };
    let html = pending.map(renderRow).join('');
    if (pending.length && completed.length) {
      html += '<div class="ach-divider"><span>已完成</span></div>';
    }
    html += completed.map(renderRow).join('');
    container.innerHTML = html;
  },

  renderBadges() {
    const container = document.getElementById('badge-grid');
    if (!container) return;
    const achievements = ApiService.getAchievements();
    const sorted = this._sortByCat(ApiService.getBadges());
    container.innerHTML = sorted.map(b => {
      const ach = achievements.find(a => a.id === b.achId);
      const earned = ach ? ach.current >= ach.target : false;
      const color = this._catColors[b.category] || this._catColors.bronze;
      return `
      <div class="badge-card ${earned ? '' : 'badge-locked'}" style="border-color:${color}">
        <div class="badge-img-placeholder" style="border-color:${color}">${b.image ? `<img src="${b.image}">` : ''}</div>
        <div class="badge-card-name">${b.name}</div>
        ${earned ? `<div class="badge-earned-tag" style="color:${color}">已獲得</div>` : '<div class="badge-locked-tag">未解鎖</div>'}
      </div>`;
    }).join('');
  },

  // ══════════════════════════════════
  //  Render: Shop
  // ══════════════════════════════════

  renderShop() {
    const container = document.getElementById('shop-grid');
    container.innerHTML = ApiService.getShopItems().map(s => `
      <div class="shop-card" onclick="App.showShopDetail('${s.id}')">
        <div class="shop-img-placeholder">商品圖 150 × 150</div>
        <div class="shop-body">
          <div class="shop-name">${s.name}</div>
          <div class="shop-price">$${s.price.toLocaleString()}</div>
          <div class="shop-meta">${s.condition} ・ ${s.size}</div>
        </div>
      </div>
    `).join('');
  },

  showShopDetail(id) {
    const s = ApiService.getShopItem(id);
    if (!s) return;
    document.getElementById('shop-detail-title').textContent = s.name;
    document.getElementById('shop-detail-body').innerHTML = `
      <div class="sd-images">
        <div class="sd-img-item" onclick="App.openLightbox(this)"><div class="td-img-placeholder">商品圖 1<br>400 × 300</div></div>
        <div class="sd-img-item" onclick="App.openLightbox(this)"><div class="td-img-placeholder">商品圖 2<br>400 × 300</div></div>
        <div class="sd-img-item" onclick="App.openLightbox(this)"><div class="td-img-placeholder">商品圖 3<br>400 × 300</div></div>
      </div>
      <div class="td-card">
        <div class="td-card-title">商品資訊</div>
        <div class="td-card-grid">
          <div class="td-card-item"><span class="td-card-label">品名</span><span class="td-card-value">${s.name}</span></div>
          <div class="td-card-item"><span class="td-card-label">新舊程度</span><span class="td-card-value">${s.condition}</span></div>
          <div class="td-card-item"><span class="td-card-label">價格</span><span class="td-card-value" style="color:var(--accent)">$${s.price.toLocaleString()}</span></div>
          <div class="td-card-item"><span class="td-card-label">尺寸</span><span class="td-card-value">${s.size}</span></div>
        </div>
      </div>
      <div class="td-card">
        <div class="td-card-title">商品描述</div>
        <p style="font-size:.85rem;color:var(--text-secondary);line-height:1.7">${s.desc || '賣家未提供描述。'}</p>
      </div>
      <div class="td-actions">
        <button class="primary-btn" onclick="App.showToast('已發送購買意願！')">我想購買</button>
        <button class="outline-btn" onclick="App.showToast('已透過站內信聯繫賣家')">聯繫賣家</button>
      </div>
    `;
    this.showPage('page-shop-detail');
  },

  openLightbox(el) {
    const img = el.querySelector('img');
    const lb = document.getElementById('lightbox');
    if (img && lb) {
      document.getElementById('lightbox-img').src = img.src;
      lb.classList.add('open');
    } else {
      this.showToast('Demo 模式：尚未上傳實際圖片');
    }
  },

  closeLightbox() {
    document.getElementById('lightbox')?.classList.remove('open');
  },

  // ══════════════════════════════════
  //  Render: Leaderboard
  // ══════════════════════════════════

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

  // ══════════════════════════════════
  //  Render: Tournament Timeline & Detail
  // ══════════════════════════════════

  renderTournamentTimeline() {
    const container = document.getElementById('tournament-timeline');
    if (!container) return;

    const tournaments = ApiService.getTournaments();
    const leagues = tournaments.filter(t => t.type.includes('聯賽'));
    const cups = tournaments.filter(t => !t.type.includes('聯賽'));

    const renderSection = (title, icon, items) => {
      let html = `<div class="tl-month-header">${icon} ${title}</div>`;
      items.forEach(t => {
        const statusMap = { '進行中': 'open', '即將開始': 'upcoming', '報名中': 'open', '已結束': 'ended' };
        const css = statusMap[t.status] || 'open';
        html += `
          <div class="tl-event-row tl-tournament-card ${t.type.includes('聯賽') ? 'tl-league' : 'tl-cup'}" onclick="App.showTournamentDetail('${t.id}')" style="margin-bottom:.4rem">
            <div class="tl-event-info">
              <div class="tl-event-title">${t.name}</div>
              <div class="tl-event-meta">${t.type} · ${t.teams}隊 · ${t.matches}場</div>
            </div>
            <span class="tl-event-status ${css}">${t.status}</span>
            <span class="tl-event-arrow">›</span>
          </div>`;
      });
      return html;
    };

    container.innerHTML =
      renderSection('聯賽', '', leagues) +
      '<div style="height:.5rem"></div>' +
      renderSection('盃賽', '', cups);
  },

  showTournamentDetail(id) {
    this.currentTournament = id;
    const t = ApiService.getTournament(id);
    if (!t) return;
    const tdImg = document.getElementById('td-img-placeholder');
    if (tdImg) {
      if (t.image) {
        tdImg.innerHTML = `<img src="${t.image}" alt="${t.name}" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:var(--radius)">`;
        tdImg.style.border = 'none';
      } else {
        tdImg.textContent = '賽事圖片 800 × 300';
        tdImg.style.border = '';
      }
    }
    document.getElementById('td-title').textContent = t.name;
    this.showPage('page-tournament-detail');

    document.querySelectorAll('#td-tabs .tab').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('#td-tabs .tab').forEach(x => x.classList.remove('active'));
        tab.classList.add('active');
        this.renderTournamentTab(tab.dataset.ttab);
      };
    });
    document.querySelectorAll('#td-tabs .tab').forEach(x => x.classList.toggle('active', x.dataset.ttab === 'schedule'));
    this.renderTournamentTab('schedule');
  },

  renderTournamentTab(tab) {
    const container = document.getElementById('tournament-content');
    if (!container) return;
    const t = ApiService.getTournament(this.currentTournament);
    const isCup = t && !t.type.includes('聯賽');

    if (tab === 'schedule') {
      container.innerHTML = isCup ? this.renderBracket() : this.renderLeagueSchedule();
    } else if (tab === 'standings') {
      container.innerHTML = `<table class="standings-table">
        <tr><th>#</th><th>隊名</th><th>勝</th><th>平</th><th>負</th><th>積分</th></tr>
        ${ApiService.getStandings().map(s => `<tr><td>${s.rank}</td><td>${s.name}</td><td>${s.w}</td><td>${s.d}</td><td>${s.l}</td><td><strong>${s.pts}</strong></td></tr>`).join('')}
      </table>`;
    } else if (tab === 'trades') {
      container.innerHTML = `
        <div style="padding:.5rem;margin-bottom:.5rem;font-size:.82rem;color:var(--text-secondary)">
          交易窗口：03/01~03/20　狀態：<span style="color:var(--success);font-weight:600">開放中</span>
        </div>
        ${ApiService.getTrades().map(tr => `
          <div class="trade-card">
            <div style="font-weight:600;margin-bottom:.25rem">${tr.from} → ${tr.to}</div>
            <div>球員：${tr.player}　價值：${tr.value} 積分</div>
            <div style="margin-top:.3rem"><span class="trade-status ${tr.status}">${tr.status === 'success' ? '成交' : '待確認'}</span> <span style="font-size:.72rem;color:var(--text-muted)">${tr.date}</span></div>
          </div>
        `).join('')}`;
    }
  },

  renderLeagueSchedule() {
    const teams = ApiService.getTeams();
    const matches = ApiService.getMatches();

    let html = '<div style="font-size:.78rem;font-weight:700;color:var(--text-muted);margin-bottom:.4rem">賽程</div>';
    matches.forEach(m => {
      const homeTeam = teams.find(t => t.name === m.home);
      const awayTeam = teams.find(t => t.name === m.away);
      html += `
        <div class="match-card-compact">
          <div class="mc-team">
            <div class="mc-emblem" style="background:${homeTeam?.color || '#666'}22;color:${homeTeam?.color || '#666'}">${homeTeam?.emblem || '?'}</div>
            <span>${m.home}</span>
          </div>
          <div class="mc-score">${m.scoreH !== null ? `${m.scoreH} : ${m.scoreA}` : 'vs'}</div>
          <div class="mc-team away">
            <span>${m.away}</span>
            <div class="mc-emblem" style="background:${awayTeam?.color || '#666'}22;color:${awayTeam?.color || '#666'}">${awayTeam?.emblem || '?'}</div>
          </div>
        </div>
        <div class="mc-meta"><span>${m.venue}</span><span>${m.time}</span></div>`;
    });

    html += '<div style="font-size:.78rem;font-weight:700;color:var(--text-muted);margin:.8rem 0 .4rem">循環對戰表</div>';
    html += '<div class="rr-table-wrap"><table class="rr-table"><tr><th></th>';
    teams.forEach(t => { html += `<th>${t.emblem}</th>`; });
    html += '</tr>';
    teams.forEach((home, hi) => {
      html += `<tr><td class="rr-team-cell">${home.emblem} ${home.name}</td>`;
      teams.forEach((away, ai) => {
        if (hi === ai) {
          html += '<td class="rr-self">—</td>';
        } else {
          const m = matches.find(x => (x.home === home.name && x.away === away.name));
          if (m && m.scoreH !== null) {
            const cls = m.scoreH > m.scoreA ? 'rr-win' : m.scoreH < m.scoreA ? 'rr-loss' : 'rr-draw';
            html += `<td class="${cls}">${m.scoreH}:${m.scoreA}</td>`;
          } else {
            html += '<td style="color:var(--text-muted)">-</td>';
          }
        }
      });
      html += '</tr>';
    });
    html += '</table></div>';
    return html;
  },

  renderBracket() {
    const bracketData = [
      { round: '八強', matches: [
        { t1: '雷霆隊', s1: 3, t2: '旋風B隊', s2: 0, e1: '雷', e2: '旋' },
        { t1: '閃電隊', s1: 2, t2: '火焰B隊', s2: 1, e1: '電', e2: '火' },
        { t1: '旋風隊', s1: 1, t2: '獵鷹隊', s2: 1, e1: '旋', e2: '鷹' },
        { t1: '火焰隊', s1: 4, t2: '鐵衛隊', s2: 2, e1: '火', e2: '鐵' },
      ]},
      { round: '四強', matches: [
        { t1: '雷霆隊', s1: null, t2: '閃電隊', s2: null, e1: '雷', e2: '電' },
        { t1: '?', s1: null, t2: '火焰隊', s2: null, e1: '?', e2: '火' },
      ]},
      { round: '決賽', matches: [
        { t1: '?', s1: null, t2: '?', s2: null, e1: '?', e2: '?' },
      ]},
    ];

    let html = '<div class="bracket-container"><div class="bracket">';
    bracketData.forEach((round, ri) => {
      html += `<div class="bracket-round">
        <div class="bracket-round-title">${round.round}</div>`;
      round.matches.forEach(m => {
        const w1 = m.s1 !== null && m.s2 !== null && m.s1 > m.s2;
        const w2 = m.s1 !== null && m.s2 !== null && m.s2 > m.s1;
        html += `<div class="bracket-match">
          <div class="bracket-team${w1 ? ' winner' : ''}">
            <span>${m.e1}</span> ${m.t1}
            <span class="bt-score">${m.s1 !== null ? m.s1 : ''}</span>
          </div>
          <div class="bracket-team${w2 ? ' winner' : ''}">
            <span>${m.e2}</span> ${m.t2}
            <span class="bt-score">${m.s2 !== null ? m.s2 : ''}</span>
          </div>
        </div>`;
      });
      html += '</div>';
      if (ri < bracketData.length - 1) {
        html += '<div class="bracket-connector"></div>';
      }
    });
    html += '</div></div>';
    return html;
  },

  // ══════════════════════════════════
  //  Render: Activity Records
  // ══════════════════════════════════

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
