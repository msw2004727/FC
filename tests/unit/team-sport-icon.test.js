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

  test('team detail cover intentionally omits sport badge overlays', () => {
    const source = readProjectFile('js/modules/team/team-detail.js');

    expect(source).not.toContain('getSportIconSvg(t.sportTag)');
    expect(source).not.toContain('detailSportEmoji');
    expect(source).not.toContain('tc-sport-badge');
    expect(source).not.toContain('td-cover-ribbon');
  });

  test('teaching ribbon sits on the top-right corner with the matching diagonal direction', () => {
    const teamCss = readProjectFile('css/team.css');
    const ribbonRule = teamCss.match(/\.tc-edu-ribbon\s*\{[\s\S]*?\n\}/)?.[0] || '';

    expect(ribbonRule).toContain('right: -26px');
    expect(ribbonRule).toContain('top: 12px');
    expect(ribbonRule).toContain('transform: rotate(35deg)');
    expect(ribbonRule).not.toContain('bottom: 6px');
    expect(ribbonRule).not.toContain('transform: rotate(-35deg)');
  });

  test('teaching cards keep only the diagonal ribbon and do not render the purple text badge', () => {
    const source = readProjectFile('js/modules/team/team-list-render.js');

    expect(source).toContain('tc-edu-ribbon');
    expect(source).not.toContain('tc-edu-badge');
  });
});
