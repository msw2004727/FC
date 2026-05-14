const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '../..');

function readCss() {
  return fs.readFileSync(path.join(root, 'css/team.css'), 'utf8');
}

function ruleBlock(css, selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = css.match(new RegExp(`${escaped}\\s*\\{([\\s\\S]*?)\\}`));
  return match ? match[1] : '';
}

describe('team member table CSS contract', () => {
  test('member table fills the card instead of shrinking to content', () => {
    const css = readCss();
    const block = ruleBlock(css, '.td-member-table');

    expect(block).toContain('display: table');
    expect(block).toContain('width: 100%');
    expect(block).toContain('min-width: 100%');
    expect(block).not.toContain('display: inline-table');
    expect(block).not.toContain('width: auto');
  });

  test('notes column remains a real table cell and can consume remaining width', () => {
    const css = readCss();
    const noteBlock = ruleBlock(css, '.td-member-note');

    expect(noteBlock).toContain('display: table-cell');
    expect(noteBlock).toContain('max-width: none');
    expect(noteBlock).toContain('text-align: left');
    expect(noteBlock).not.toContain('display: block');
    expect(noteBlock).not.toContain('max-width: 150px');
  });
});
