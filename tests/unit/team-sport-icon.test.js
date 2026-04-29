const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function readProjectFile(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

describe('team sport icon rendering', () => {
  test('team cards use shared SVG sport icon helper instead of emoji map', () => {
    const source = readProjectFile('js/modules/team/team-list-render.js');

    expect(source).toContain('getSportIconSvg(t.sportTag)');
    expect(source).toContain('getSportIconSvg(t.sportTag, \'team-title-sport-icon\')');
    expect(source).not.toContain('const sportEmoji =');
    expect(source).not.toContain('SPORT_ICON_EMOJI[t.sportTag]');
  });

  test('team detail cover badge uses shared SVG sport icon helper', () => {
    const source = readProjectFile('js/modules/team/team-detail.js');

    expect(source).toContain('getSportIconSvg(t.sportTag)');
    expect(source).not.toContain('detailSportEmoji');
  });
});
