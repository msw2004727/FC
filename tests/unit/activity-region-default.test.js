const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('activity region default', () => {
  test('activity page defaults the region tab to all', () => {
    const activityHtml = readProjectFile('pages/activity.html');
    const helperSource = readProjectFile('js/modules/event/event-list-helpers.js');

    expect(activityHtml).toContain('<button class="region-tab" data-region="中部" onclick="App.switchRegionTab(\'中部\')">中部</button>');
    expect(activityHtml).toContain('<button class="region-tab active" data-region="全部" onclick="App.switchRegionTab(\'全部\')">全部</button>');
    expect(helperSource).toContain("_activeRegionTab: '全部'");
    expect(helperSource).toContain("this._activeRegionTab || '全部'");
    expect(helperSource).toContain("region || '全部'");
  });

  test('activity feature tabs include female-only filter and unavailable placeholders', () => {
    const activityHtml = readProjectFile('pages/activity.html');
    const activityCss = readProjectFile('css/activity.css');
    const tabSource = readProjectFile('js/modules/event/event-list.js');
    const femaleThemeSource = readProjectFile('js/modules/event/event-list-female-theme.js');
    const scriptLoaderSource = readProjectFile('js/core/script-loader.js');
    const indexHtml = readProjectFile('index.html');
    const timelineSource = readProjectFile('js/modules/event/event-list-timeline.js');

    expect(activityHtml).toContain('id="activity-female-petals"');
    expect(activityHtml).toContain('<span class="activity-tab-separator" aria-hidden="true">|</span>');
    expect(activityHtml).toContain('class="tab activity-tab-female" data-atab="female" onclick="App.switchActivityTab(\'female\')">女生專屬</button>');
    expect(activityHtml).toContain('data-atab="beginner" onclick="App.switchActivityTab(\'beginner\', event)">新手友善</button>');
    expect(activityHtml).toContain('data-atab="high-intensity" onclick="App.switchActivityTab(\'high-intensity\', event)">高強度</button>');
    expect(activityCss).toContain('#page-activities.activity-female-theme');
    expect(activityCss).toContain('#activity-tabs .activity-tab-female.active');
    expect(tabSource).toContain("_unavailableActivityTabs: ['beginner', 'high-intensity']");
    expect(tabSource).toContain('this._syncActivityFemaleTheme?.(tab)');
    expect(femaleThemeSource).toContain('_syncActivityFemaleTheme(tab = this._activityActiveTab)');
    expect(femaleThemeSource).toContain('_startActivityFemalePetals()');
    expect(femaleThemeSource).toContain('_stopActivityFemalePetals()');
    expect(scriptLoaderSource).toContain("'js/modules/event/event-list-female-theme.js'");
    expect(indexHtml).toContain('js/modules/event/event-list-female-theme.js');
    expect(tabSource).toContain("this.showToast?.('功能尚未開放')");
    expect(tabSource).toContain('event?.stopImmediatePropagation?.()');
    expect(timelineSource).toContain("if (activeTab === 'female')");
    expect(timelineSource).toContain("this._getEventAllowedGender?.(e) === '女'");
  });
});
