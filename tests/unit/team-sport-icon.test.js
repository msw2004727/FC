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

  test('category ribbons sit on the top-right corner with the matching diagonal direction', () => {
    const teamCss = readProjectFile('css/team.css');
    const ribbonRule = teamCss.match(/\.tc-type-ribbon,[\s\S]*?\.tc-edu-ribbon\s*\{[\s\S]*?\n\}/)?.[0] || '';

    expect(ribbonRule).toContain('right: -26px');
    expect(ribbonRule).toContain('top: 12px');
    expect(ribbonRule).toContain('transform: rotate(35deg)');
    expect(ribbonRule).toContain('z-index: 3');
    expect(ribbonRule).not.toContain('bottom: 6px');
    expect(ribbonRule).not.toContain('transform: rotate(-35deg)');
  });

  test('team card sport image badges stay bounded like emoji badges', () => {
    const teamCss = readProjectFile('css/team.css');
    const badgeImageRule = teamCss.match(/\.tc-card-media \.tc-sport-badge img,[\s\S]*?\.tc-sport-badge svg\s*\{[\s\S]*?\n\}/)?.[0] || '';

    expect(badgeImageRule).toContain('width: 1em');
    expect(badgeImageRule).toContain('height: 1em');
    expect(badgeImageRule).toContain('object-fit: contain');
  });

  test('club category cards keep only the diagonal ribbon and do not render the purple text badge', () => {
    const source = readProjectFile('js/modules/team/team-list-render.js');
    const teamCss = readProjectFile('css/team.css');

    expect(source).toContain('tc-type-ribbon');
    expect(source).toContain('tc-edu-ribbon');
    expect(teamCss).toContain('.tc-type-ribbon-competitive');
    expect(teamCss).toContain('.tc-type-ribbon-education');
    expect(teamCss).toContain('.tc-type-ribbon-leisure');
    expect(source).not.toContain('tc-edu-badge');
  });

  test('none category suppresses card ribbons and detail pills', () => {
    const listSource = readProjectFile('js/modules/team/team-list-render.js');
    const detailSource = readProjectFile('js/modules/team/team-detail-render.js');

    expect(listSource).toContain("t.type === 'none'");
    expect(listSource).toContain('hasCategoryRibbon');
    expect(listSource).toContain('categoryMeta.ribbonClass && categoryMeta.label');
    expect(detailSource).toContain("t.type === 'none'");
    expect(detailSource).toContain('categoryMeta.pillClass && categoryMeta.label');
  });
});
