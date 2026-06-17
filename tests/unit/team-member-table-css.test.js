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

describe('team member list CSS contract', () => {
  test('member management panel owns demo-like local structure and tokens', () => {
    const css = readCss();
    const panelBlock = ruleBlock(css, '.td-member-management-panel');

    expect(panelBlock).toContain('--td-mm-surface: #ffffff');
    expect(panelBlock).toContain('--td-mm-selected-bg: #0f172a');
    expect(panelBlock).toContain('width: min(100%, 430px)');
    expect(panelBlock).toContain('border-radius: 22px');
    expect(css).toContain('.td-member-panel-pad');
    expect(css).toContain('.td-member-top h3');
    expect(css).toContain('.td-member-filters');
    expect(css).toContain('.td-member-filter-chip');
    expect(css).toContain('.td-member-view-row');
    expect(css).toContain('.td-member-sort-hint');
  });

  test('member list fills the card with stable row and avatar sizing', () => {
    const css = readCss();
    const shellBlock = ruleBlock(css, '.td-member-list-shell');
    const listBlock = ruleBlock(css, '.td-member-list');
    const rowBlock = ruleBlock(css, '.td-member-row');
    const avatarBlock = ruleBlock(css, '.td-member-avatar');

    expect(shellBlock).toContain('display: grid');
    expect(shellBlock).toContain('min-width: 0');
    expect(listBlock).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(rowBlock).toContain('display: flex');
    expect(rowBlock).toContain('min-height: 58px');
    expect(avatarBlock).toContain('flex: 0 0 40px');
    expect(avatarBlock).toContain('width: 40px');
    expect(avatarBlock).toContain('height: 40px');
  });

  test('metadata line truncates safely and note becomes an inline chip', () => {
    const css = readCss();
    const metaBlock = ruleBlock(css, '.td-member-meta-item');
    const noteBlock = ruleBlock(css, '.td-member-note');

    expect(css).toMatch(/\.td-member-line2\s*\{[\s\S]*gap: \.34rem[\s\S]*overflow: hidden[\s\S]*white-space: nowrap/);
    expect(metaBlock).toContain('text-overflow: ellipsis');
    expect(noteBlock).toContain('border-radius: 6px');
    expect(noteBlock).toContain('background: var(--bg-elevated)');
    expect(noteBlock).not.toContain('display: table-cell');
    expect(noteBlock).not.toContain('display: block');
  });

  test('member role action controls keep stable widths before avatars', () => {
    const css = readCss();

    expect(css).toMatch(/\.td-member-management-panel \.td-member-row,[\s\S]*\.td-member-management-panel \.td-member-list-shell\.is-editing \.td-member-row\s*\{[\s\S]*flex-wrap: nowrap/);
    expect(css).toMatch(/\.td-member-management-panel \.td-member-action-cell\s*\{[\s\S]*justify-content: flex-end[\s\S]*gap: 2px/);
    expect(css).toMatch(/\.td-member-management-panel \.td-member-remove-cell,[\s\S]*\.td-member-management-panel \.td-member-role-action-cell\s*\{[\s\S]*flex: 0 0 auto[\s\S]*width: auto/);
    expect(css).toMatch(/\.td-member-role-action-btn,\s*\.td-member-promote-btn\s*\{[\s\S]*display: inline-flex[\s\S]*width: 28px[\s\S]*height: 28px/);
    expect(css).toMatch(/\.td-member-management-panel \.td-mm-icon-btn,[\s\S]*\.td-member-management-panel \.td-member-row-edit-btn,[\s\S]*\.td-member-management-panel \.td-member-role-action-btn,[\s\S]*\.td-member-management-panel \.td-member-remove-btn\s*\{[\s\S]*width: 30px[\s\S]*height: 30px/);
  });

  test('member name wrappers size central user capsules without replacing them', () => {
    const css = readCss();

    expect(css).toMatch(/\.td-member-name-wrap \.user-capsule\s*\{[\s\S]*max-width: min\(12em, 48vw\)[\s\S]*text-overflow: ellipsis/);
    expect(css).toMatch(/\.td-member-management-panel \.td-member-name-wrap \.user-capsule\s*\{[\s\S]*background: transparent[\s\S]*font-size: 14\.5px/);
    expect(css).toMatch(/\.td-member-management-panel \.td-member-name-wrap \.user-capsule \.uc-lv\s*\{[\s\S]*position: static[\s\S]*height: 14px/);
    expect(css).toMatch(/\.td-member-name-static\s*\{[\s\S]*background: var\(--bg-elevated\)[\s\S]*white-space: nowrap/);
    expect(css).toContain('.td-member-name-static.external-student');
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
