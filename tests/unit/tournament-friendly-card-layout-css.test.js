const fs = require('fs');
const path = require('path');

const css = fs.readFileSync(path.join(__dirname, '../../css/tournament.css'), 'utf8');

describe('friendly tournament participant card layout CSS', () => {
  test('uses compact grid rows instead of tall stacked cards', () => {
    expect(css).toMatch(/\.tfd-team-row \{[\s\S]*display: grid;[\s\S]*grid-template-areas:[\s\S]*"side action"[\s\S]*"roster action"[\s\S]*min-height: 74px;/);
    expect(css).toMatch(/\.tfd-team-row-slot \{[\s\S]*min-height: 60px;[\s\S]*grid-template-areas: "side roster";/);
    expect(css).toMatch(/@media \(max-width: 640px\) \{[\s\S]*\.tfd-team-row \{[\s\S]*min-height: 68px;/);
  });

  test('keeps review actions compact and horizontal on mobile', () => {
    expect(css).toMatch(/\.tfd-review-actions \{[\s\S]*grid-area: action;[\s\S]*flex-wrap: nowrap;/);
    expect(css).toMatch(/@media \(max-width: 640px\) \{[\s\S]*\.tfd-review-actions \{[\s\S]*flex-direction: row;[\s\S]*gap: \.28rem;/);
    expect(css).not.toMatch(/\.tfd-review-actions \{[\s\S]{0,160}flex-direction: column;/);
  });
});
