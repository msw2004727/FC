/* ================================================
   SportHub - Team Detail V2: Tabs / Panels
   ================================================ */

Object.assign(App, {

  _getTeamDetailV2Tabs(t) {
    const tabs = [{ key: 'overview', label: '總覽' }];
    if (this._isTeamDetailSectionVisible?.(t, 'courses')) tabs.push({ key: 'courses', label: '課程' });
    if (this._isTeamDetailSectionVisible?.(t, 'events')) tabs.push({ key: 'events', label: '活動' });
    if (this._isTeamDetailSectionVisible?.(t, 'members')) tabs.push({ key: 'members', label: '成員' });
    if (this._isTeamDetailSectionVisible?.(t, 'record') || this._isTeamDetailSectionVisible?.(t, 'matches')) tabs.push({ key: 'record', label: '戰績' });
    tabs.push({ key: 'feed', label: '動態' });
    return tabs;
  },

  _getTeamDetailV2ActiveTab(t) {
    const tabs = this._getTeamDetailV2Tabs(t);
    const keys = new Set(tabs.map(tab => tab.key));
    const saved = this._teamDetailTabByTeam?.[t.id];
    return keys.has(saved) ? saved : 'overview';
  },

  _buildTeamDetailV2Tabs(t) {
    const active = this._getTeamDetailV2ActiveTab(t);
    const countByKey = {
      courses: this._getTeamDetailV2CourseCount?.(t) || 0,
      events: this._getTeamDetailEventCount?.(t) || 0,
    };
    const buttons = this._getTeamDetailV2Tabs(t).map(tab => {
      const badge = countByKey[tab.key] ? '<span class="td-v2-tab-badge">' + countByKey[tab.key] + '</span>' : '';
      return '<button class="' + (active === tab.key ? 'active' : '') + '" type="button" data-td-v2-action="tab" data-tab="' + escapeHTML(tab.key) + '">'
        + escapeHTML(tab.label) + badge + '</button>';
    }).join('');
    return '<div class="td-v2-tab-rail"><div class="td-v2-tab-list" role="tablist">' + buttons + '</div></div>';
  },

  _buildTeamDetailV2PanelsHtml(t, canManageMembers, memberEditMode, staffIdentity, totalGames, winRate) {
    const active = this._getTeamDetailV2ActiveTab(t);
    const panel = (key, html) => '<section class="td-v2-panel td-v2-panel-' + key + (active === key ? ' active' : '') + '" data-panel="' + key + '">' + html + '</section>';
    const panels = [
      panel('overview', this._buildTeamDetailV2OverviewPanel(t, totalGames, winRate)),
    ];
    if (this._isTeamDetailSectionVisible?.(t, 'courses')) panels.push(panel('courses', this._buildTeamDetailV2CoursesPanel(t)));
    if (this._isTeamDetailSectionVisible?.(t, 'events')) panels.push(panel('events', this._buildTeamDetailV2EventsPanel(t)));
    if (this._isTeamDetailSectionVisible?.(t, 'members')) panels.push(panel('members', this._buildTeamDetailV2MembersPanel(t, canManageMembers, memberEditMode, staffIdentity)));
    if (this._isTeamDetailSectionVisible?.(t, 'record') || this._isTeamDetailSectionVisible?.(t, 'matches')) {
      panels.push(panel('record', this._buildTeamDetailV2RecordPanel(t, totalGames, winRate)));
    }
    panels.push(panel('feed', this._buildTeamDetailV2FeedPanel(t)));
    return '<main class="td-v2-content">' + panels.join('') + '</main>';
  },

  _buildTeamDetailV2QuickLink(key, label, value) {
    return '<button class="td-v2-quick" type="button" data-td-v2-action="tab" data-tab="' + escapeHTML(key) + '">'
      + '<strong>' + escapeHTML(value) + '</strong><span>' + escapeHTML(label) + '</span></button>';
  },

  _buildTeamDetailV2OverviewPanel(t, totalGames, winRate) {
    const quickItems = [];
    if (this._isTeamDetailSectionVisible?.(t, 'courses')) quickItems.push(this._buildTeamDetailV2QuickLink('courses', '課程方案', this._getTeamDetailV2CourseCount?.(t) || 0));
    if (this._isTeamDetailSectionVisible?.(t, 'events')) quickItems.push(this._buildTeamDetailV2QuickLink('events', '近期活動', this._getTeamDetailEventCount?.(t) || 0));
    if (this._isTeamDetailSectionVisible?.(t, 'members')) quickItems.push(this._buildTeamDetailV2QuickLink('members', '成員總數', this._getTeamDetailMemberCount?.(t) || 0));
    if (this._isTeamDetailSectionVisible?.(t, 'record')) quickItems.push(this._buildTeamDetailV2QuickLink('record', '勝率', totalGames > 0 ? winRate + '%' : '-'));
    const quickLinks = quickItems.join('');
    const bio = t.bio
      ? '<div class="td-v2-card"><div class="td-v2-section-head"><h3>關於我們</h3></div><p class="td-v2-bio">' + escapeHTML(t.bio) + '</p></div>'
      : '<div class="td-v2-card td-v2-empty-card">尚未填寫俱樂部簡介</div>';
    const info = this._buildTeamDetailV2InfoGrid(t);
    const featuredCourses = this._buildTeamDetailV2FeaturedCourses(t);
    const upcoming = this._buildTeamDetailV2EventRows(t, 2);
    return '<div class="td-v2-card"><div class="td-v2-section-head"><h3>快速導覽</h3><span>所有原有內容都保留在分頁內</span></div><div class="td-v2-quick-grid">' + quickLinks + '</div></div>'
      + bio + info + featuredCourses
      + '<div class="td-v2-card"><div class="td-v2-section-head"><h3>近期活動</h3><button type="button" data-td-v2-action="tab" data-tab="events">全部</button></div>' + upcoming + '</div>';
  },

  _buildTeamDetailV2InfoGrid(t) {
    const leaders = (Array.isArray(t.leaders) ? t.leaders : (t.leader ? [t.leader] : [])).filter(Boolean);
    const contactLinks = t.contactLinksEnabled ? (this._renderTeamContactLinksHtml?.(t.contactLinks) || '') : '';
    const contactText = String(t.contact || '').trim();
    const staffRow = (label, value) => '<div class="td-v2-staff-row"><span class="td-v2-staff-label">' + escapeHTML(label) + '</span><div class="td-v2-person-tags">' + (value || '<strong>未設定</strong>') + '</div></div>';
    const personTags = (names) => names.filter(Boolean).map(name => {
      if (typeof this._userTag === 'function') return this._userTag(name);
      return '<span class="user-capsule uc-user" data-no-translate>' + escapeHTML(name) + '</span>';
    }).join(' ');
    const rows = staffRow('經理', t.captain ? personTags([t.captain]) : '')
      + staffRow('領隊', personTags(leaders));
    const contactParts = [];
    if (contactLinks) contactParts.push('<span class="event-social-link-list td-contact-link-list">' + contactLinks + '</span>');
    if (contactText) contactParts.push('<span class="td-v2-contact-text">' + escapeHTML(contactText) + '</span>');
    const contact = contactParts.length
      ? '<div class="td-v2-contact-card"><span class="td-v2-contact-label">聯繫方式</span><div class="td-v2-contact-actions">' + contactParts.join('') + '</div></div>'
      : '';
    return '<div class="td-v2-card td-v2-info-card"><div class="td-v2-section-head"><h3>俱樂部資訊</h3></div><div class="td-v2-info-staff-grid">' + rows + '</div>' + contact + '</div>';
  },

  _buildTeamDetailV2FeaturedCourses(t) {
    if (!this._isTeamDetailSectionVisible?.(t, 'courses')) return '';
    const plans = (typeof this._getTeamDetailV2CurrentCoursePlans === 'function'
      ? this._getTeamDetailV2CurrentCoursePlans(t)
      : []);
    const pinnedPlans = (Array.isArray(plans) ? plans : [])
      .map((plan, index) => ({ plan, index }))
      .filter(({ plan }) => plan?.pinned === true)
      .sort((a, b) => {
        const av = Number(a.plan?.sortOrder);
        const bv = Number(b.plan?.sortOrder);
        const ao = Number.isFinite(av) ? av : a.index;
        const bo = Number.isFinite(bv) ? bv : b.index;
        return ao - bo || a.index - b.index;
      })
      .map(({ plan }) => plan);
    const cardClass = 'td-v2-card td-v2-featured-courses-card';
    if (!pinnedPlans.length) {
      return '<div class="' + cardClass + '"><div class="td-v2-section-head"><h3>熱門課程</h3><button type="button" data-td-v2-action="tab" data-tab="courses">課程</button></div><div class="td-v2-empty">課程資料載入後會顯示在這裡</div></div>';
    }
    return '<div class="' + cardClass + '"><div class="td-v2-section-head"><h3>熱門課程</h3><button type="button" data-td-v2-action="tab" data-tab="courses">全部</button></div>'
      + pinnedPlans.map(p => this._buildTeamDetailV2CourseMiniRow(t.id, p)).join('') + '</div>';
  },

  _buildTeamDetailV2CourseMiniRow(teamId, plan) {
    const typeLabel = plan.planType === 'weekly' ? '固定週期' : '堂數制';
    const count = Number(plan._effectiveCount || 0);
    const max = Number(plan.maxCapacity || 0);
    const capacity = max > 0 ? `${count}/${max} 人` : `${count} 人`;
    const coverImage = String(plan.coverImage || plan.coverUrl || plan.imageUrl || plan.image || plan.imageVariants?.card || plan.imageVariants?.cover || '').trim();
    const rowClass = 'td-v2-course-row' + (coverImage ? ' has-cover' : '');
    const rowStyle = coverImage ? ' style="--td-v2-course-cover:url(\'' + escapeHTML(coverImage) + '\')"' : '';
    return '<button class="' + rowClass + '" type="button" data-td-v2-action="course" data-course-id="' + escapeHTML(plan.id || '') + '"' + rowStyle + '>'
      + '<span class="td-v2-course-main"><strong>' + escapeHTML(plan.name || '未命名課程') + '</strong><em>' + escapeHTML(typeLabel + ' · ' + capacity) + '</em></span>'
      + '<b>›</b></button>';
  },

  _buildTeamDetailV2CoursesPanel(t) {
    const accepting = t?.eduSettings?.acceptingStudents !== false;
    const banner = '<div class="td-v2-recruit-banner ' + (accepting ? 'open' : 'closed') + '"><div><strong>' + (accepting ? '接受新學員報名' : '暫停招收新學員') + '</strong><span>' + escapeHTML(this._getTeamDetailV2RecruitText(t)) + '</span></div></div>';
    return banner
      + '<div class="td-v2-card td-v2-edu-card">'
      + '<div class="td-v2-section-head td-v2-course-section-head"><h3>課程方案</h3><button type="button" class="edu-info-btn td-v2-course-info-btn" onclick="App._showEduInfoPopup(\'course\')" title="課程方案說明" aria-label="課程方案說明">?</button></div>'
      + this._buildTeamEducationSection(t)
      + '</div>';
  },

});
