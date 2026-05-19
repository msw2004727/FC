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

  test('member role action columns keep stable arrow controls before names', () => {
    const css = readCss();

    expect(css).toMatch(/\.td-member-remove-head,\s*\.td-member-remove-cell\s*\{[\s\S]*width: 48px[\s\S]*text-align: center/);
    expect(css).toMatch(/\.td-member-role-action-head,\s*\.td-member-role-action-cell\s*\{[\s\S]*width: 44px[\s\S]*text-align: center/);
    expect(css).toMatch(/\.td-member-role-action-btn,\s*\.td-member-promote-btn\s*\{[\s\S]*display: inline-flex[\s\S]*width: 28px[\s\S]*height: 28px/);
    expect(css).toMatch(/\.td-member-role-action-btn svg,\s*\.td-member-promote-btn svg\s*\{[\s\S]*width: 15px[\s\S]*stroke: currentColor/);
  });

  test('member management button and role confirm modal use styled stable controls', () => {
    const css = readCss();

    expect(css).toMatch(/\.td-member-edit-btn\s*\{[\s\S]*display: inline-flex[\s\S]*min-width: 106px[\s\S]*white-space: nowrap/);
    expect(css).toContain('.td-member-edit-btn.is-active');
    expect(css).toContain('.app-confirm-overlay.td-role-confirm-open .app-confirm-box');
    expect(css).toMatch(/\.td-role-confirm-flow\s*\{[\s\S]*overflow-x: auto[\s\S]*white-space: nowrap/);
    expect(css).toMatch(/\.td-role-confirm-name-pill,\s*\.td-role-confirm-role-pill\s*\{[\s\S]*display: inline-flex[\s\S]*border-radius: var\(--radius-full\)/);
    expect(css).toContain('.td-role-confirm-name-pill.role-coach');
    expect(css).toContain('.td-role-confirm-name-pill.role-leader');
    expect(css).toContain('.td-role-confirm-name-pill.role-default');
  });
});
