const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

describe('tournament live match schedule UI contract', () => {
  const detailSource = read('js/modules/tournament/tournament-detail-competition.js');
  const recordSource = read('js/modules/tournament/tournament-match-record.js');
  const cssSource = read('css/tournament.css');

  test('public match cards include live slot and click-through detail modal', () => {
    expect(detailSource).toContain('_renderTournamentLiveFrameHtml');
    expect(detailSource).toContain('tc-match-live-slot');
    expect(detailSource).toContain('openTournamentMatchDetailModal');
    expect(detailSource).toContain('role="button"');
  });

  test('staff-only match controls stay behind canRecord and use updated wording', () => {
    expect(detailSource).toContain('tc-match-staff-panel');
    expect(detailSource).toContain('const staffPanel = canRecord');
    expect(detailSource).toContain('更新賽況');
    expect(detailSource).not.toContain('編輯結果');
    expect(detailSource).not.toContain('登錄結果');
  });

  test('match detail modal exposes live, events and referee sections', () => {
    expect(detailSource).toContain('_renderTournamentMatchDetailModalBody');
    expect(detailSource).toContain('_renderTournamentMatchEventsTimeline');
    expect(detailSource).toContain('裁判資訊');
    expect(detailSource).toContain('直播');
  });

  test('record modal owns liveUrl and supports live update mode', () => {
    expect(recordSource).toContain('id="tmr-live-url"');
    expect(recordSource).toContain("value=\"scheduled\"");
    expect(recordSource).toContain('liveUrl');
    expect(recordSource).toContain('更新賽況');
  });

  test('live embeds default to paused in schedule surfaces', () => {
    expect(detailSource).toContain("_buildTournamentLiveEmbedUrl(rawUrl = '', options = {})");
    expect(detailSource).toContain("autoplay: autoplay ? '1' : '0'");
    expect(detailSource).toContain("autoplay=${autoplay ? 'true' : 'false'}");
    expect(detailSource).toContain("allow=\"accelerometer; clipboard-write;");
    expect(detailSource).not.toContain("allow=\"accelerometer; autoplay;");
  });

  test('css contains stable responsive hooks for live match UI', () => {
    expect(cssSource).toContain('.tc-match-live-frame');
    expect(cssSource).toContain('aspect-ratio: 16 / 9');
    expect(cssSource).toContain('.tc-match-info-modal');
    expect(cssSource).toContain('.tc-match-info-modal .modal-body');
    expect(cssSource).toContain('env(safe-area-inset-top)');
    expect(cssSource).toContain('max-height: none');
    expect(detailSource).toContain("document.body?.classList?.add('modal-open')");
    expect(detailSource).toContain("document.body?.classList?.remove('modal-open')");
    expect(cssSource).toContain('.tc-match-staff-panel');
    expect(cssSource).toContain('.tmr-live-card');
    expect(cssSource).toContain('.tfg-live-slot .tc-match-live-frame');
    expect(cssSource).toContain('#tournament-match-record-overlay');
    expect(cssSource).toContain('.tmr-title-team');
  });
});
