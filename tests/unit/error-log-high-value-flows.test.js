const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf8');
}

describe('high-value flow error log instrumentation', () => {
  test('activity signup and companion flows record diagnostic errors', () => {
    const signup = read('js/modules/event/event-detail-signup.js');
    const companion = read('js/modules/event/event-detail-companion.js');

    expect(signup).toContain("fn: 'handleSignup'");
    expect(signup).toContain('teamReservationTeamId');
    expect(companion).toContain("fn: '_confirmCompanionRegister'");
    expect(companion).toContain("fn: '_confirmCompanionCancel'");
  });

  test('scan and manual attendance write failures record diagnostic errors', () => {
    expect(read('js/modules/scan/scan-process.js')).toContain("fn: '_processAttendance.addAttendanceRecord'");
    expect(read('js/modules/scan/scan-family.js')).toContain("fn: '_confirmFamilyCheckin.addAttendanceRecord'");

    const instantSave = read('js/modules/event/event-manage-instant-save.js');
    expect(instantSave).toContain("fn: '_writeInstantAttendance'");
    expect(instantSave).toContain("fn: '_writeInstantUnregAttendance'");

    const confirm = read('js/modules/event/event-manage-confirm.js');
    expect(confirm).toContain("fn: '_confirmAllUnregAttendance'");
    expect(confirm).toContain("fn: '_removeUnregUser.removeAttendanceRecord'");
  });

  test('team, tournament review, and shop management failures record diagnostic errors', () => {
    expect(read('js/modules/team/team-form.js')).toContain("fn: 'handleSaveTeam.updateTeamAwait'");
    expect(read('js/modules/team/team-form-join.js')).toContain("fn: 'handleLeaveTeam.updateCurrentUserAwait'");
    expect(read('js/modules/team/team-list.js')).toContain("fn: 'removeTeam'");
    expect(read('js/modules/message/message-actions-team.js')).toContain("fn: 'handleTeamJoinAction.getTeamAsync'");
    expect(read('js/modules/tournament/tournament-friendly-detail.js')).toContain("fn: 'reviewFriendlyTournamentApplication'");
    expect(read('js/modules/shop.js')).toContain("fn: 'handleSaveShopItem.uploadImage'");
  });
});
