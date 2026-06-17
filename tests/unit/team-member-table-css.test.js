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
    expect(css).toContain('.td-member-list-note-hint');
    expect(css).not.toContain('.td-member-sort-hint');
    expect(css).not.toContain('.td-member-view-hint');
  });

  test('member list fills the card with stable row sizing and no avatar lane', () => {
    const css = readCss();
    const shellBlock = ruleBlock(css, '.td-member-management-panel .td-member-list-shell');
    const listBlock = ruleBlock(css, '.td-member-management-panel .td-member-list');

    expect(shellBlock).toContain('display: block');
    expect(shellBlock).toContain('min-width: 0');
    expect(listBlock).toContain('grid-template-columns: minmax(0, 1fr)');
    expect(css).toMatch(/\.td-member-management-panel \.td-member-row,[\s\S]*\.td-member-management-panel \.td-member-list-shell\.is-editing \.td-member-row\s*\{[\s\S]*display: flex[\s\S]*flex-wrap: nowrap[\s\S]*padding: 11px 4px/);
    expect(css).toMatch(/\.td-member-management-panel \.td-member-row \+ \.td-member-row::before\s*\{[\s\S]*left: 4px/);
    expect(css).not.toContain('.td-member-management-panel .td-member-avatar');
  });

  test('metadata line truncates safely and note becomes an inline chip', () => {
    const css = readCss();
    const metaBlock = ruleBlock(css, '.td-member-meta-item');
    const noteBlock = ruleBlock(css, '.td-member-note');
    const panelLine2Block = ruleBlock(css, '.td-member-management-panel .td-member-line2');

    expect(css).toMatch(/\.td-member-line2\s*\{[\s\S]*gap: \.34rem[\s\S]*overflow: hidden[\s\S]*white-space: nowrap/);
    expect(panelLine2Block).toContain('flex-wrap: wrap');
    expect(panelLine2Block).toContain('overflow: visible');
    expect(panelLine2Block).toContain('white-space: normal');
    expect(css).toContain('.td-member-management-panel .td-member-line3');
    expect(css).toContain('.td-member-management-panel .td-member-note-label');
    expect(css).toContain('.td-member-management-panel .td-member-group');
    expect(css).toContain('.td-member-management-panel .td-member-jersey');
    expect(metaBlock).toContain('text-overflow: ellipsis');
    expect(noteBlock).toContain('border-radius: 6px');
    expect(noteBlock).toContain('background: var(--bg-elevated)');
    expect(noteBlock).not.toContain('display: table-cell');
    expect(noteBlock).not.toContain('display: block');
  });

  test('member role action controls keep stable widths after the name capsule', () => {
    const css = readCss();

    expect(css).toMatch(/\.td-member-management-panel \.td-member-row,[\s\S]*\.td-member-management-panel \.td-member-list-shell\.is-editing \.td-member-row\s*\{[\s\S]*flex-wrap: nowrap/);
    expect(css).toMatch(/\.td-member-management-panel \.td-member-action-cell\s*\{[\s\S]*justify-content: flex-end[\s\S]*gap: 2px/);
    expect(css).toMatch(/\.td-member-management-panel \.td-member-remove-cell,[\s\S]*\.td-member-management-panel \.td-member-role-action-cell\s*\{[\s\S]*flex: 0 0 auto[\s\S]*width: auto/);
    expect(css).toMatch(/\.td-member-role-action-btn,\s*\.td-member-promote-btn\s*\{[\s\S]*display: inline-flex[\s\S]*width: 28px[\s\S]*height: 28px/);
    expect(css).toMatch(/\.td-member-management-panel \.td-mm-icon-btn,[\s\S]*\.td-member-management-panel \.td-member-row-edit-btn,[\s\S]*\.td-member-management-panel \.td-member-role-action-btn,[\s\S]*\.td-member-management-panel \.td-member-remove-btn\s*\{[\s\S]*width: 30px[\s\S]*height: 30px/);
  });

  test('member name wrappers size central user capsules without replacing them', () => {
    const css = readCss();
    const managementCapsuleBlock = ruleBlock(css, '.td-member-management-panel .td-member-name-wrap .user-capsule');
    const managementStaticBlock = Array.from(css.matchAll(/(?:^|\n)\.td-member-management-panel \.td-member-name-static\s*\{([\s\S]*?)\n\}/g))
      .map(match => match[1])
      .find(block => block.includes('display: inline-flex')) || '';

    expect(css).toMatch(/\.td-member-name-wrap \.user-capsule\s*\{[\s\S]*max-width: min\(12em, 48vw\)[\s\S]*text-overflow: ellipsis/);
    expect(managementCapsuleBlock).toContain('max-width: 180px');
    expect(managementCapsuleBlock).toContain('margin-top: 7px');
    expect(managementCapsuleBlock).toContain('padding: 0 8px');
    expect(managementCapsuleBlock).toContain('border-radius: var(--radius-full)');
    expect(managementCapsuleBlock).toContain('font-size: .75rem');
    expect(managementCapsuleBlock).toContain('overflow: visible');
    expect(managementCapsuleBlock).not.toContain('background: transparent');
    expect(managementCapsuleBlock).not.toContain('border: 0');
    expect(css).toMatch(/\.td-member-management-panel \.td-member-name-wrap \.user-capsule \.uc-lv\s*\{[\s\S]*z-index: 90/);
    expect(css).toMatch(/\.td-member-management-panel \.td-member-name-wrap \.user-capsule \.td-member-name-text\s*\{[\s\S]*overflow: hidden[\s\S]*text-overflow: ellipsis/);
    expect(managementStaticBlock).toContain('background: var(--td-mm-role-student-bg)');
    expect(managementStaticBlock).toContain('border-radius: var(--radius-full)');
    expect(managementStaticBlock).toContain('white-space: nowrap');
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
