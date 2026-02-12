/* ================================================
   SportHub — Tournament: Render & Detail View
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

  _tcActiveTab: 'active',

  switchTournamentCenterTab(tab) {
    this._tcActiveTab = tab;
    document.querySelectorAll('#tc-tabs .tab').forEach(el => {
      el.classList.toggle('active', el.dataset.tctab === tab);
    });
    this.renderTournamentTimeline();
  },

  filterTournamentCenter() {
    this.renderTournamentTimeline();
  },

  renderTournamentTimeline() {
    const container = document.getElementById('tournament-timeline');
    if (!container) return;

    const tab = this._tcActiveTab || 'active';
    const query = (document.getElementById('tc-search')?.value || '').trim().toLowerCase();
    const regionFilter = document.getElementById('tc-region-filter')?.value || '';

    let tournaments = ApiService.getTournaments();

    // Tab filter
    tournaments = tournaments.filter(t => {
      const ended = this.isTournamentEnded(t);
      return tab === 'ended' ? ended : !ended;
    });

    // Text search
    if (query) {
      tournaments = tournaments.filter(t =>
        t.name.toLowerCase().includes(query) ||
        (t.organizer || '').toLowerCase().includes(query) ||
        (t.venues || []).some(v => v.toLowerCase().includes(query))
      );
    }

    // Region filter
    if (regionFilter) {
      tournaments = tournaments.filter(t => t.region === regionFilter);
    }

    if (tournaments.length === 0) {
      container.innerHTML = `<div style="text-align:center;padding:2rem;color:var(--text-muted);font-size:.85rem">${tab === 'ended' ? '沒有已結束的賽事' : '沒有進行中的賽事'}</div>`;
      return;
    }

    const fmtDate = d => {
      if (!d) return '';
      const dt = new Date(d);
      return `${dt.getMonth() + 1}/${dt.getDate()}`;
    };
    const fmtDatetime = d => {
      if (!d) return '';
      const dt = new Date(d);
      return `${dt.getFullYear()}/${(dt.getMonth() + 1).toString().padStart(2, '0')}/${dt.getDate().toString().padStart(2, '0')}`;
    };

    const statusBgMap = {
      '報名中':  { bg: 'rgba(52,211,153,.07)', border: '#10b981', darkBg: 'rgba(52,211,153,.15)' },
      '截止報名': { bg: 'rgba(251,191,36,.07)', border: '#f59e0b', darkBg: 'rgba(251,191,36,.15)' },
      '準備中':  { bg: 'rgba(96,165,250,.07)', border: '#60a5fa', darkBg: 'rgba(96,165,250,.15)' },
      '已結束':  { bg: 'rgba(107,114,128,.07)', border: '#6b7280', darkBg: 'rgba(107,114,128,.15)' },
    };
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';

    container.innerHTML = tournaments.map(t => {
      const isEnded = this.isTournamentEnded(t);
      const status = isEnded ? '已結束' : this.getTournamentStatus(t);
      const statusMap = { '報名中': 'open', '截止報名': 'full', '準備中': 'upcoming', '已結束': 'ended' };
      const css = statusMap[status] || 'open';
      const sBg = statusBgMap[status] || statusBgMap['已結束'];

      const registered = t.registeredTeams || [];
      const maxTeams = t.maxTeams || '?';
      const matchDates = t.matchDates || [];
      const matchDatesText = matchDates.length ? matchDates.map(d => fmtDate(d)).join('、') : '未定';
      const regPeriod = (t.regStart && t.regEnd) ? `${fmtDatetime(t.regStart)} ~ ${fmtDatetime(t.regEnd)}` : '未定';
      const organizer = t.organizer || '管理員';
      const role = ApiService.getUserRole(organizer);
      const region = t.region || '';

      return `
        <div class="tl-event-row" onclick="App.showTournamentDetail('${t.id}')" style="margin-bottom:.4rem;flex-wrap:wrap;padding:.45rem .6rem .35rem;background:${isDark ? sBg.darkBg : sBg.bg};border-left:3px solid ${sBg.border}">
          <div style="width:100%;display:flex;align-items:center;gap:.35rem">
            <div class="tl-event-title" style="flex:1">${escapeHTML(t.name)}</div>
            <span style="font-size:.58rem;color:var(--text-muted);opacity:.7">待定義</span>
            <span class="user-capsule uc-${role}" style="pointer-events:none;cursor:default;font-size:.6rem;padding:.1rem .35rem">${escapeHTML(organizer)}</span>
            <span class="tl-event-status ${css}">${status}</span>
            <span class="tl-event-arrow">›</span>
          </div>
          <div style="width:100%;font-size:.62rem;color:var(--text-muted);margin-top:.2rem;line-height:1.5">
            ${region ? region + ' · ' : ''}比賽日 ${matchDatesText} · 報名 ${regPeriod} · 已報 ${registered.length}/${maxTeams} 隊
          </div>
        </div>`;
    }).join('');
  },

  showTournamentDetail(id) {
    this.currentTournament = id;
    const t = ApiService.getTournament(id);
    if (!t) return;

    // 圖片渲染
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

    // 報名按鈕
    this.renderRegisterButton(t);
    // 賽事資訊（場地、日期、費用、主辦、委託）
    this.renderTournamentInfo(t);

    this.showPage('page-tournament-detail');

    // 頁簽綁定
    document.querySelectorAll('#td-tabs .tab').forEach(tab => {
      tab.onclick = () => {
        document.querySelectorAll('#td-tabs .tab').forEach(x => x.classList.remove('active'));
        tab.classList.add('active');
        this.renderTournamentTab(tab.dataset.ttab);
      };
    });
    // 預設為「說明」頁簽
    document.querySelectorAll('#td-tabs .tab').forEach(x => x.classList.toggle('active', x.dataset.ttab === 'info'));
    this.renderTournamentTab('info');
  },

  renderRegisterButton(t) {
    const area = document.getElementById('td-register-area');
    if (!area) return;

    const status = this.getTournamentStatus(t);
    const registered = t.registeredTeams || [];
    const maxTeams = t.maxTeams || 999;
    const isFull = registered.length >= maxTeams;
    const userTeam = this._userTeam;
    const alreadyRegistered = userTeam && registered.includes(userTeam);
    const role = this.currentRole;
    const canRegister = ['captain', 'coach', 'venue_owner'].includes(role);

    let btnHTML = '';
    if (alreadyRegistered) {
      // 已報名 → 聯繫主辦
      btnHTML = `<button class="primary-btn" style="width:100%" onclick="App.showUserProfile('${escapeHTML(t.organizer || '管理員')}')">聯繫主辦</button>`;
    } else if (status === '截止報名' && isFull) {
      btnHTML = `<button class="primary-btn" style="width:100%;opacity:.5;cursor:not-allowed" disabled>報名已滿</button>`;
    } else if (status === '截止報名') {
      btnHTML = `<button class="primary-btn" style="width:100%;opacity:.5;cursor:not-allowed" disabled>報名已截止</button>`;
    } else if (status === '報名中' && isFull) {
      btnHTML = `<button class="primary-btn" style="width:100%;opacity:.5;cursor:not-allowed" disabled>報名已滿</button>`;
    } else if (status === '報名中') {
      if (canRegister) {
        btnHTML = `<button class="primary-btn" style="width:100%" onclick="App.registerTournament('${t.id}')">報名比賽</button>`;
      } else {
        btnHTML = `<button class="primary-btn" style="width:100%" onclick="App.showToast('請聯繫球隊管理人員進行報名')">報名比賽</button>`;
      }
    } else if (status === '準備中') {
      btnHTML = `<button class="primary-btn" style="width:100%;opacity:.5;cursor:not-allowed" disabled>尚未開放報名</button>`;
    }

    const countText = `<div style="font-size:.78rem;color:var(--text-muted);margin-top:.35rem;text-align:center">已報名 ${registered.length} / ${maxTeams} 隊</div>`;
    area.innerHTML = btnHTML + countText;
  },

  registerTournament(id) {
    const t = ApiService.getTournament(id);
    if (!t) return;
    const userTeam = this._userTeam;
    if (!userTeam) {
      this.showToast('您尚未加入任何球隊');
      return;
    }
    if (!t.registeredTeams) t.registeredTeams = [];
    if (t.registeredTeams.includes(userTeam)) {
      this.showToast('您的球隊已報名此賽事');
      return;
    }
    if (t.registeredTeams.length >= (t.maxTeams || 999)) {
      this.showToast('報名已滿');
      return;
    }
    t.registeredTeams.push(userTeam);
    ApiService.updateTournament(id, { registeredTeams: [...t.registeredTeams] });
    this.renderRegisterButton(t);
    this.showToast('報名成功！');
  },

  renderTournamentInfo(t) {
    const container = document.getElementById('td-info-section');
    if (!container) return;

    const rows = [];

    // 地區
    if (t.region) {
      rows.push(`<div class="td-info-row"><span class="td-info-label">地區</span><div class="td-info-value">${escapeHTML(t.region)}</div></div>`);
    }

    // 場地
    const venues = t.venues || [];
    if (venues.length > 0) {
      const searchPrefix = t.region || '';
      const venueLinks = venues.map(v => {
        const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(searchPrefix + v)}`;
        return `<a href="${mapUrl}" target="_blank" rel="noopener" style="color:var(--primary);text-decoration:none;font-size:.82rem">${escapeHTML(v)} 📍</a>`;
      }).join('<span style="color:var(--border);margin:0 .3rem">|</span>');
      rows.push(`<div class="td-info-row"><span class="td-info-label">場地</span><div class="td-info-value">${venueLinks}</div></div>`);
    }

    // 比賽日期
    const dates = t.matchDates || [];
    if (dates.length > 0) {
      const dateTags = dates.map(d => {
        const parts = d.split('-');
        return `<span style="display:inline-block;font-size:.7rem;padding:.15rem .5rem;border-radius:20px;background:var(--accent);color:#fff">${parseInt(parts[1])}/${parseInt(parts[2])}</span>`;
      }).join('');
      rows.push(`<div class="td-info-row"><span class="td-info-label">比賽日期</span><div class="td-info-value" style="display:flex;flex-wrap:wrap;gap:.25rem">${dateTags}</div></div>`);
    }

    // 報名費
    const fee = t.fee || 0;
    rows.push(`<div class="td-info-row"><span class="td-info-label">報名費</span><div class="td-info-value" style="font-weight:600">${fee > 0 ? 'NT$' + fee.toLocaleString() + ' / 隊' : '免費'}</div></div>`);

    // 主辦人
    const organizer = t.organizer || '管理員';
    rows.push(`<div class="td-info-row"><span class="td-info-label">主辦人</span><div class="td-info-value">${this._userTag(organizer)}</div></div>`);

    // 委託人
    const delegates = t.delegates || [];
    if (delegates.length > 0) {
      const delegateTags = delegates.map(d => this._userTag(d.name)).join(' ');
      rows.push(`<div class="td-info-row"><span class="td-info-label">委託</span><div class="td-info-value" style="display:flex;flex-wrap:wrap;gap:.3rem">${delegateTags}</div></div>`);
    }

    container.innerHTML = `<div class="td-info-card">${rows.join('')}</div>`;
  },

  renderTournamentTab(tab) {
    const container = document.getElementById('tournament-content');
    if (!container) return;
    const t = ApiService.getTournament(this.currentTournament);
    if (!t) return;

    if (tab === 'info') {
      const desc = t.description || '';
      const contentImgHTML = t.contentImage ? `<div style="padding:0 .8rem .8rem"><img src="${t.contentImage}" alt="賽事內容圖片" style="width:100%;border-radius:var(--radius);display:block"></div>` : '';
      container.innerHTML = desc
        ? `<div style="padding:.8rem;font-size:.88rem;line-height:1.7;white-space:pre-wrap;color:var(--text-primary)">${escapeHTML(desc)}</div>${contentImgHTML}`
        : `<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem">暫無說明</div>${contentImgHTML}`;
    } else if (tab === 'teams') {
      const teamIds = t.registeredTeams || [];
      if (teamIds.length === 0) {
        container.innerHTML = '<div style="padding:2rem;text-align:center;color:var(--text-muted);font-size:.85rem">尚無球隊報名</div>';
        return;
      }
      const allTeams = ApiService.getTeams();
      const registered = teamIds.map(id => allTeams.find(tm => tm.id === id)).filter(Boolean);
      container.innerHTML = `<div class="team-grid" style="padding:.5rem .4rem">${registered.map(tm => this._teamCardHTML({...tm, pinned: false})).join('')}</div>`;
    } else if (tab === 'schedule') {
      const isCup = t && !t.type.includes('聯賽');
      container.innerHTML = isCup ? this.renderBracket() : this.renderLeagueSchedule();
    } else if (tab === 'stats') {
      container.innerHTML = `<table class="standings-table">
        <tr><th>#</th><th>隊名</th><th>勝</th><th>平</th><th>負</th><th>積分</th></tr>
        ${ApiService.getStandings().map(s => `<tr><td>${s.rank}</td><td>${s.name}</td><td>${s.w}</td><td>${s.d}</td><td>${s.l}</td><td><strong>${s.pts}</strong></td></tr>`).join('')}
      </table>`;
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

});
