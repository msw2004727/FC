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
});
