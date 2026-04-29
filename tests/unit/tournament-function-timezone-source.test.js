const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '../..');

describe('tournament function timezone contract', () => {
  test('Cloud Functions treats legacy datetime-local tournament dates as Taipei time', () => {
    const source = fs.readFileSync(path.join(projectRoot, 'functions/index.js'), 'utf8');

    expect(source).toContain('function getLegacyTaipeiLocalDateTimeMillis');
    expect(source).toContain('return utcMillis - (8 * 60 * 60 * 1000);');
    expect(source).toContain('const legacyTaipeiMillis = getLegacyTaipeiLocalDateTimeMillis(raw);');
  });

  test('createFriendlyTournament normalizes accepted registration dates to ISO', () => {
    const source = fs.readFileSync(path.join(projectRoot, 'functions/index.js'), 'utf8');

    expect(source).toContain('const regStartMs = getTimestampMillis(regStartRaw);');
    expect(source).toContain('const regEndMs = getTimestampMillis(regEndRaw);');
    expect(source).toContain('const regStart = new Date(regStartMs).toISOString();');
    expect(source).toContain('const regEnd = new Date(regEndMs).toISOString();');
  });

  test('createFriendlyTournament creates the participating host creator roster member atomically', () => {
    const source = fs.readFileSync(path.join(projectRoot, 'functions/index.js'), 'utf8');

    expect(source).toContain('function buildServerTournamentRosterMember');
    expect(source).toContain('source: "host_create"');
    expect(source).toContain('const hostMember = hostEntry && root.hostParticipates === true');
    expect(source).toContain('batch.create(entryRef.collection("members").doc(callerUid), hostMember);');
  });

  test('application approval and host creation share the same roster member shape', () => {
    const source = fs.readFileSync(path.join(projectRoot, 'functions/index.js'), 'utf8');

    expect(source).toContain('tx.set(applicantMemberRef, buildServerTournamentRosterMember({');
    expect(source).toContain('source: "application_approval"');
  });
});
