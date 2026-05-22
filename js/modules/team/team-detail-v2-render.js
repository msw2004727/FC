/* ================================================
   SportHub - Team Detail V2: Shell / Hero
   ================================================ */

Object.assign(App, {

  _teamDetailTabByTeam: {},

  _svgIcon(name) {
    const icons = {
      back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 6l-6 6 6 6"></path></svg>',
      share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12v7a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-7"></path><path d="M16 6l-4-4-4 4"></path><path d="M12 2v14"></path></svg>',
      more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="1"></circle><circle cx="19" cy="12" r="1"></circle><circle cx="5" cy="12" r="1"></circle></svg>',
      join: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path><circle cx="8.5" cy="7" r="4"></circle><path d="M20 8v6"></path><path d="M23 11h-6"></path></svg>',
      check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 6 9 17l-5-5"></path></svg>',
      qr: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 3h7v7H3z"></path><path d="M14 3h7v7h-7z"></path><path d="M3 14h7v7H3z"></path><path d="M14 14h3v3h-3z"></path><path d="M18 18h3v3h-3z"></path></svg>',
      contact: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"></path></svg>',
      settings: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z"></path><path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.05.05a2.1 2.1 0 0 1-3 3l-.05-.05a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.1 1.65V21a2.1 2.1 0 0 1-4.2 0v-.08A1.8 1.8 0 0 0 8.4 19.3a1.8 1.8 0 0 0-2 .36l-.05.05a2.1 2.1 0 0 1-3-3l.05-.05a1.8 1.8 0 0 0 .36-2A1.8 1.8 0 0 0 2 13.55V13a2.1 2.1 0 0 1 0-4.2h.08A1.8 1.8 0 0 0 3.7 7.6a1.8 1.8 0 0 0-.36-2l-.05-.05a2.1 2.1 0 0 1 3-3l.05.05a1.8 1.8 0 0 0 2 .36H8.4A1.8 1.8 0 0 0 9.5 1.3V1a2.1 2.1 0 0 1 4.2 0v.08a1.8 1.8 0 0 0 1.1 1.65 1.8 1.8 0 0 0 2-.36l.05-.05a2.1 2.1 0 0 1 3 3l-.05.05a1.8 1.8 0 0 0-.36 2v.05A1.8 1.8 0 0 0 21 8.5h.1a2.1 2.1 0 0 1 0 4.2H21a1.8 1.8 0 0 0-1.6 1.1Z"></path></svg>',
      plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14"></path><path d="M5 12h14"></path></svg>',
    };
    return icons[name] || '';
  },

  _getTeamDetailV2SportLabel(t) {
    const sportKey = typeof getSportKeySafe === 'function'
      ? getSportKeySafe(t?.sportTag)
      : String(t?.sportTag || '').trim();
    if (sportKey && typeof EVENT_SPORT_MAP !== 'undefined' && EVENT_SPORT_MAP[sportKey]) {
      return EVENT_SPORT_MAP[sportKey].label || sportKey;
    }
    return sportKey || '';
  },

  _getTeamDetailV2CourseCount(t) {
    if (!this._isTeamDetailSectionVisible?.(t, 'courses')) return 0;
    const plans = typeof this.getEduCoursePlans === 'function' ? this.getEduCoursePlans(t.id) : [];
    return (Array.isArray(plans) ? plans : []).filter(p => p && p.active !== false).length;
  },

  _getTeamDetailV2RecruitText(t) {
    if (!this._isTeamDetailTeachingEnabled?.(t)) return '一般俱樂部 · 歡迎查看活動與成員';
    const accepting = t?.eduSettings?.acceptingStudents !== false;
    const count = this._getTeamDetailV2CourseCount(t);
    if (!accepting) return '目前暫停招收新學員';
    return count > 0 ? `正在招收新學員 · ${count} 個課程接受報名` : '正在招收新學員';
  },

  _buildTeamDetailV2Topbar(t) {
    const subtitle = t?.nameEn || this._getTeamDetailV2SportLabel(t) || t?.region || '';
    const canEdit = !!this._canEditTeamByRoleOrCaptain?.(t);
    const settings = canEdit
      ? '<button class="td-v2-icon-btn" type="button" data-td-v2-action="settings" aria-label="俱樂部設定">' + this._svgIcon('settings') + '</button>'
      : '<button class="td-v2-icon-btn" type="button" data-td-v2-action="share" aria-label="分享俱樂部">' + this._svgIcon('share') + '</button>';
    return '<div class="td-v2-topbar">'
      + '<button class="td-v2-icon-btn" type="button" data-td-v2-action="back" aria-label="返回">' + this._svgIcon('back') + '</button>'
      + '<div class="td-v2-title-wrap"><div class="td-v2-title">' + escapeHTML(t?.name || '俱樂部名稱') + '</div>'
      + '<div class="td-v2-subtitle">' + escapeHTML(subtitle || 'Club detail') + '</div></div>'
      + settings
      + '<button class="td-v2-icon-btn" type="button" data-td-v2-action="more" aria-label="更多操作">' + this._svgIcon('more') + '</button>'
      + '</div>';
  },

  _buildTeamDetailV2Hero(t) {
    const sportLabel = this._getTeamDetailV2SportLabel(t);
    const logoUrl = this._getTeamDetailAvatarUrl?.(t) || '';
    const initial = escapeHTML(String(t?.name || 'T').trim().charAt(0) || 'T');
    const logo = logoUrl
      ? '<div class="td-v2-hero-logo has-img"><img src="' + escapeHTML(logoUrl) + '" alt="' + escapeHTML(t?.name || '') + '"></div>'
      : '<div class="td-v2-hero-logo"><span>' + initial + '</span></div>';
    const chips = [
      sportLabel,
      t?.region || t?.nationality || '',
      t?.founded ? `${t.founded} 創立` : '',
      this._isTeamDetailTeachingEnabled?.(t) ? '教學俱樂部' : '',
    ].filter(Boolean).map(text => '<span class="td-v2-hero-chip">' + escapeHTML(text) + '</span>').join('');
    return '<section class="td-v2-hero">'
      + '<div class="td-v2-hero-inner">' + logo
      + '<div class="td-v2-hero-text"><div class="td-v2-hero-name">' + escapeHTML(t?.name || '俱樂部名稱') + '</div>'
      + (t?.nameEn ? '<div class="td-v2-hero-name-en">' + escapeHTML(t.nameEn) + '</div>' : '')
      + '<div class="td-v2-hero-meta">' + chips + '</div></div></div>'
      + '<div class="td-v2-hero-status"><span class="td-v2-pulse"></span><span>' + escapeHTML(this._getTeamDetailV2RecruitText(t)) + '</span></div>'
      + '</section>';
  },

  _buildTeamDetailV2PrimaryButton(t) {
    const isMember = this._isTeamMember(t.id);
    const joinState = !isMember && typeof this._getTeamJoinRequestState === 'function'
      ? this._getTeamJoinRequestState(t.id)
      : null;
    if (joinState?.status === 'pending') {
      return '<button class="td-v2-cta-primary pending" type="button" data-td-v2-action="join-pending">' + this._svgIcon('check') + '<span>審核中</span></button>';
    }
    return isMember
      ? '<button class="td-v2-cta-primary danger" type="button" data-td-v2-action="leave">' + this._svgIcon('check') + '<span>已加入</span></button>'
      : '<button class="td-v2-cta-primary" type="button" data-td-v2-action="join">' + this._svgIcon('join') + '<span>加入俱樂部</span></button>';
  },

  _buildTeamDetailV2CtaBar(t) {
    const u = ApiService.getCurrentUser?.();
    const n = u?.displayName || '';
    const isCaptainCoach = (t.captain === n || (t.coaches || []).includes(n));
    const canInvite = isCaptainCoach || (this._isTeamMember(t.id) && t.allowMemberInvite !== false);
    const disabled = canInvite ? '' : ' disabled aria-disabled="true"';
    return '<div class="td-v2-cta-bar">'
      + this._buildTeamDetailV2PrimaryButton(t)
      + '<button class="td-v2-cta-icon" type="button" data-td-v2-action="share" aria-label="分享俱樂部">' + this._svgIcon('share') + '</button>'
      + '<button class="td-v2-cta-icon" type="button" data-td-v2-action="contact" aria-label="聯繫負責人">' + this._svgIcon('contact') + '</button>'
      + '<button class="td-v2-cta-icon" type="button" data-td-v2-action="invite"' + disabled + ' aria-label="邀請 QR">' + this._svgIcon('qr') + '</button>'
      + '</div>';
  },

  _buildTeamDetailV2Stats(t, totalGames, winRate) {
    const stats = [
      ['成員', this._getTeamDetailMemberCount?.(t) || 0, ''],
      ['課程', this._getTeamDetailV2CourseCount(t), ''],
      ['勝率', totalGames > 0 ? winRate + '%' : '-', totalGames > 0 ? `${totalGames} 場` : ''],
      ['活動', this._getTeamDetailEventCount?.(t) || 0, ''],
    ];
    return '<div class="td-v2-stats">' + stats.map(item =>
      '<div class="td-v2-stat"><div class="td-v2-stat-num">' + escapeHTML(item[1]) + '</div>'
      + '<div class="td-v2-stat-label">' + escapeHTML(item[0]) + (item[2] ? '<span>' + escapeHTML(item[2]) + '</span>' : '') + '</div></div>'
    ).join('') + '</div>';
  },

  _buildTeamDetailV2BodyHtml(t, canManageMembers, memberEditMode, staffIdentity, totalGames, winRate) {
    const themeColor = this._getTeamThemeColor?.(t) || '';
    const themeStyle = themeColor ? ' style="--td-v2-theme:' + escapeHTML(themeColor) + '"' : '';
    return '<div class="td-v2-shell" data-team-id="' + escapeHTML(t.id || '') + '"' + themeStyle + '>'
      + this._buildTeamDetailV2Topbar(t)
      + this._buildTeamDetailV2Hero(t)
      + this._buildTeamDetailV2CtaBar(t)
      + this._buildTeamDetailV2Stats(t, totalGames, winRate)
      + this._buildTeamDetailV2Tabs(t)
      + this._buildTeamDetailV2PanelsHtml(t, canManageMembers, memberEditMode, staffIdentity, totalGames, winRate)
      + '<button class="td-v2-fab" type="button" data-td-v2-action="fab" aria-label="快速操作">' + this._svgIcon('plus') + '</button>'
      + '<div class="td-v2-course-modal" hidden aria-hidden="true"><div class="td-v2-modal-backdrop" data-td-v2-action="close-course"></div><div class="td-v2-modal-card" role="dialog" aria-modal="true"><div class="td-v2-modal-handle"></div><div class="td-v2-course-modal-body"></div></div></div>'
      + '</div>';
  },

});
