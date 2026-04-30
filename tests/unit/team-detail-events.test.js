const fs = require('fs');
const path = require('path');
const vm = require('vm');

describe('team detail club activity section', () => {
  function loadTeamDetailRender(app, events = []) {
    const context = {
      App: app,
      ApiService: {
        getCurrentUser: () => ({ uid: 'viewer' }),
        getEvents: () => events,
        getTeam: () => ({ id: 'teamA', feed: [] }),
        getAdminUsers: () => [],
      },
      TYPE_CONFIG: {
        friendly: { label: '友誼賽' },
        play: { label: '踢球' },
      },
      STATUS_CONFIG: {
        open: { label: '報名中', css: 'open' },
        full: { label: '已額滿', css: 'full' },
        upcoming: { label: '即將開放', css: 'upcoming' },
        ended: { label: '已結束', css: 'ended' },
        cancelled: { label: '已取消', css: 'cancelled' },
      },
      I18N: { t: (key) => key },
      document: {
        getElementById: () => null,
      },
      requestAnimationFrame: (fn) => fn(),
      setTimeout,
      console,
      Object,
      Date,
      Math,
      Number,
      String,
      Array,
      Set,
      escapeHTML: (value) => String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;'),
    };
    const source = fs.readFileSync(
      path.join(__dirname, '../../js/modules/team/team-detail-render.js'),
      'utf8'
    );
    vm.runInNewContext(source, context);
  }

  function loadTeamDetailCore(app) {
    const context = {
      App: app,
      ApiService: {},
      I18N: { t: (key) => key },
      document: {
        getElementById: () => null,
      },
      window: {},
      console,
      Object,
      Date,
      Math,
      Number,
      String,
      Array,
      Set,
      escapeHTML: (value) => String(value ?? ''),
    };
    const source = fs.readFileSync(
      path.join(__dirname, '../../js/modules/team/team-detail.js'),
      'utf8'
    );
    vm.runInNewContext(source, context);
  }

  function parseEventDate(dateStr) {
    const [datePart, timePart = '0:0'] = String(dateStr || '').split(' ');
    const [y, m, d] = datePart.split('/').map(Number);
    const [hh, mm] = timePart.split('~')[0].split(':').map(Number);
    if (!Number.isFinite(y)) return null;
    return new Date(y, (m || 1) - 1, d || 1, hh || 0, mm || 0);
  }

  function makeApp(events) {
    return {
      _getVisibleEvents: () => events,
      _parseEventStartDate: parseEventDate,
      _parseEventEndDate: parseEventDate,
      _getEventLimitedTeamIds(e) {
        const ids = [];
        if (Array.isArray(e.creatorTeamIds)) ids.push(...e.creatorTeamIds.map(String));
        if (e.creatorTeamId) ids.push(String(e.creatorTeamId));
        return Array.from(new Set(ids));
      },
      _getEventParticipantStats(e) {
        return {
          confirmedCount: Number(e.current || 0),
          waitlistCount: Number(e.waitlist || 0),
          maxCount: Number(e.max || 0),
        };
      },
      _getEventEffectiveStatus: (e) => e.status || 'open',
      _renderEventSportIcon: () => '<span class="tl-event-sport-corner"></span>',
      _favHeartHtml: () => '',
      isEventFavorited: () => false,
      _hasEventGenderRestriction: () => false,
      _isEventVisibleToUser: (e) => e.id !== 'blocked',
      _canManageEvent: () => false,
      _isTeamMember: () => false,
    };
  }

  test('renders only future team-only events for the club and limits the first view to 10', () => {
    const clubEvents = Array.from({ length: 12 }, (_, idx) => ({
      id: `e${String(idx + 1).padStart(2, '0')}`,
      title: `Club Event ${idx + 1}`,
      teamOnly: true,
      creatorTeamIds: ['teamA'],
      type: 'friendly',
      status: 'open',
      date: `2099/01/${String(idx + 1).padStart(2, '0')} 19:00`,
      location: '朝馬',
      current: idx,
      max: 20,
      waitlist: 0,
    }));
    const events = [
      ...clubEvents,
      { id: 'other', title: 'Other Team', teamOnly: true, creatorTeamIds: ['teamB'], status: 'open', date: '2099/01/01 19:00' },
      { id: 'past', title: 'Past Event', teamOnly: true, creatorTeamIds: ['teamA'], status: 'open', date: '2000/01/01 19:00' },
      { id: 'ended', title: 'Ended Event', teamOnly: true, creatorTeamIds: ['teamA'], status: 'ended', date: '2099/01/02 19:00' },
      { id: 'blocked', title: 'Blocked Event', teamOnly: true, creatorTeamIds: ['teamA'], status: 'open', date: '2099/01/03 19:00' },
    ];
    const app = makeApp(events);
    loadTeamDetailRender(app, events);

    const html = app._renderTeamEvents('teamA');

    expect(html).toContain('俱樂部活動');
    expect(html).toContain('(12)');
    expect((html.match(/tl-event-row/g) || []).length).toBe(10);
    expect(html).toContain('查看更多');
    expect(html).toContain('還有 2 筆');
    expect(html).toContain("openTeamEventDetailFromCard('e01'");
    expect(html).not.toContain('Other Team');
    expect(html).not.toContain('Past Event');
    expect(html).not.toContain('Ended Event');
    expect(html).not.toContain('Blocked Event');
  });

  test('places club activity after the team feed section', () => {
    const app = makeApp([]);
    loadTeamDetailRender(app, []);
    Object.assign(app, {
      _buildTeamInfoCard: () => '<section>info</section>',
      _buildTeamBioCard: () => '<section>bio</section>',
      _buildTeamRecordCard: () => '<section>record</section>',
      _buildTeamHistoryCard: () => '<section>history</section>',
      _buildTeamMembersCard: () => '<section>members</section>',
      _renderTeamFeed: () => '<section>feed</section>',
      _renderTeamEvents: () => '<section>club events</section>',
    });

    const html = app._buildTeamDetailBodyHtml(
      { id: 'teamA', captain: '', coaches: [] },
      false,
      false,
      { keys: new Set(), names: new Set() },
      0,
      0
    );

    expect(html.indexOf('team-feed-section')).toBeGreaterThan(-1);
    expect(html.indexOf('club events')).toBeGreaterThan(html.indexOf('team-feed-section'));
  });

  test('team detail collapsible cards use the team-owned collapse handler', () => {
    const app = makeApp([]);
    loadTeamDetailRender(app, []);
    Object.assign(app, {
      _isRegularTeamMember: () => true,
    });

    const html = [
      app._buildTeamHistoryCard({ history: [] }),
      app._buildTeamMembersCard(
        { id: 'teamA' },
        false,
        false,
        { keys: new Set(), names: new Set() }
      ),
    ].join('');

    expect(html).toContain("App.toggleTeamDetailSection(this,'teamMatch')");
    expect(html).toContain("App.toggleTeamDetailSection(this,'teamMembers')");
    expect(html).not.toContain('App.toggleProfileSection');
  });

  test('team detail owns its collapse behavior without loading profile modules', () => {
    const app = {};
    loadTeamDetailCore(app);
    let isOpen = false;
    const content = { style: { display: 'none' } };
    const label = {
      nextElementSibling: content,
      classList: {
        toggle: () => {
          isOpen = !isOpen;
          return isOpen;
        },
      },
    };

    app.toggleTeamDetailSection(label);
    expect(content.style.display).toBe('');

    app.toggleTeamDetailSection(label);
    expect(content.style.display).toBe('none');
  });
});
