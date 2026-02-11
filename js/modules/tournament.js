/* ================================================
   SportHub — Tournament (Render + Create + Manage)
   ================================================ */

Object.assign(App, {

  renderOngoingTournaments() {
    const container = document.getElementById('ongoing-tournaments');
    if (!container) return;
    container.innerHTML = ApiService.getTournaments().map(t => `
      <div class="h-card" onclick="App.showTournamentDetail('${t.id}')">
        ${t.image
          ? `<div class="h-card-img"><img src="${t.image}" alt="${escapeHTML(t.name)}"></div>`
          : `<div class="h-card-img h-card-placeholder">220 × 90</div>`}
        <div class="h-card-body">
          <div class="h-card-title">${escapeHTML(t.name)}</div>
          <div class="h-card-meta">
            <span>${escapeHTML(t.type)}</span>
            <span>${t.teams} 隊</span>
          </div>
        </div>
      </div>
    `).join('');
  },

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
              <div class="tl-event-title">${escapeHTML(t.name)}</div>
              <div class="tl-event-meta">${escapeHTML(t.type)} · ${t.teams}隊 · ${t.matches}場</div>
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
        tdImg.innerHTML = `<img src="${t.image}" alt="${escapeHTML(t.name)}" style="width:100%;height:100%;object-fit:cover;display:block;border-radius:var(--radius)">`;
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
  //  Tournament Management (Admin)
  // ══════════════════════════════════

  /** 根據報名區間計算賽事狀態 */
  getTournamentStatus(t) {
    if (!t.regStart || !t.regEnd) return t.status || '準備中';
    const now = new Date();
    const start = new Date(t.regStart);
    const end = new Date(t.regEnd);
    if (now < start) return '準備中';
    if (now >= start && now <= end) return '報名中';
    return '截止報名';
  },

  renderTournamentManage() {
    const container = document.getElementById('tournament-manage-list');
    if (!container) return;
    container.innerHTML = ApiService.getTournaments().map(t => {
      const status = this.getTournamentStatus(t);
      const statusMap = { '準備中': '#6b7280', '報名中': '#10b981', '截止報名': '#f59e0b' };
      const statusColor = statusMap[status] || '#6b7280';

      return `
      <div class="event-card">
        ${t.image ? `<div class="event-card-img"><img src="${t.image}" style="width:100%;height:120px;object-fit:cover;display:block;border-radius:var(--radius) var(--radius) 0 0"></div>` : ''}
        <div class="event-card-body">
          <div style="display:flex;align-items:center;gap:.4rem">
            <div class="event-card-title" style="flex:1">${escapeHTML(t.name)}</div>
            <span style="font-size:.68rem;padding:.15rem .45rem;border-radius:20px;background:${statusColor}18;color:${statusColor};font-weight:600;white-space:nowrap">${status}</span>
          </div>
          <div class="event-meta">
            <span class="event-meta-item">${escapeHTML(t.type)}</span>
            <span class="event-meta-item">${t.teams} 隊</span>
            ${t.matchDates && t.matchDates.length ? `<span class="event-meta-item">比賽日 ${t.matchDates.length} 天</span>` : ''}
          </div>
          <div style="display:flex;gap:.3rem;flex-wrap:wrap;margin-top:.5rem">
            <button class="primary-btn small">管理賽程</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem">賽事統計</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem">參賽管理</button>
            <button class="outline-btn" style="font-size:.75rem;padding:.3rem .6rem;color:var(--danger)" onclick="App.handleDeleteTournament('${t.id}')">刪除</button>
          </div>
        </div>
      </div>`;
    }).join('');
  },

  // ══════════════════════════════════
  //  Create Tournament
  // ══════════════════════════════════

  _ctMatchDates: [],

  addMatchDate(val) {
    if (!val || this._ctMatchDates.includes(val)) return;
    this._ctMatchDates.push(val);
    this._ctMatchDates.sort();
    this._renderMatchDateTags();
    document.getElementById('ct-match-date-picker').value = '';
  },

  removeMatchDate(val) {
    this._ctMatchDates = this._ctMatchDates.filter(d => d !== val);
    this._renderMatchDateTags();
  },

  _renderMatchDateTags() {
    const wrap = document.getElementById('ct-match-dates-wrap');
    if (!wrap) return;
    wrap.innerHTML = this._ctMatchDates.map(d => {
      const parts = d.split('-');
      const label = `${parseInt(parts[1])}/${parseInt(parts[2])}`;
      return `<span style="display:inline-flex;align-items:center;gap:.2rem;font-size:.72rem;padding:.2rem .5rem;border-radius:20px;background:var(--accent);color:#fff">${label}<span style="cursor:pointer;margin-left:.1rem" onclick="App.removeMatchDate('${d}')">✕</span></span>`;
    }).join('');
  },

  handleCreateTournament() {
    const name = document.getElementById('ct-name').value.trim();
    const type = document.getElementById('ct-type').value;
    const teams = parseInt(document.getElementById('ct-teams').value) || 8;
    const regStart = document.getElementById('ct-reg-start').value || null;
    const regEnd = document.getElementById('ct-reg-end').value || null;
    const desc = document.getElementById('ct-desc').value.trim();
    const matchDates = [...this._ctMatchDates];

    if (!name) { this.showToast('請輸入賽事名稱'); return; }

    const ctPreviewEl = document.getElementById('ct-upload-preview');
    const ctImg = ctPreviewEl?.querySelector('img');
    const image = ctImg ? ctImg.src : null;

    const data = {
      id: 'ct_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      name, type, teams,
      matches: teams - 1,
      regStart, regEnd, matchDates, description: desc,
      image,
      gradient: TOURNAMENT_GRADIENT_MAP[type] || 'linear-gradient(135deg,#7c3aed,#4338ca)',
    };
    // 自動計算狀態
    data.status = this.getTournamentStatus(data);

    ApiService.createTournament(data);

    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.closeModal();
    this.showToast(`賽事「${name}」已建立！`);

    // Reset form
    document.getElementById('ct-name').value = '';
    document.getElementById('ct-reg-start').value = '';
    document.getElementById('ct-reg-end').value = '';
    document.getElementById('ct-desc').value = '';
    document.getElementById('ct-desc-count').textContent = '0/500';
    this._ctMatchDates = [];
    this._renderMatchDateTags();
    const preview = document.getElementById('ct-upload-preview');
    if (preview) {
      preview.classList.remove('has-image');
      preview.innerHTML = '<span class="ce-upload-icon">+</span><span class="ce-upload-text">點擊上傳圖片</span><span class="ce-upload-hint">建議尺寸 800 × 300 px｜JPG / PNG｜最大 2MB</span>';
    }
  },

  async handleDeleteTournament(id) {
    const t = ApiService.getTournament(id);
    if (!t) return;
    if (!(await this.appConfirm(`確定要刪除賽事「${t.name}」？刪除後無法恢復。`))) return;
    ApiService.deleteTournament(id);
    this.renderTournamentTimeline();
    this.renderOngoingTournaments();
    this.renderTournamentManage();
    this.showToast(`賽事「${t.name}」已刪除`);
  },

});
