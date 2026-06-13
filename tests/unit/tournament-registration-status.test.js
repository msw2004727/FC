const fs = require('fs');
const path = require('path');
const vm = require('vm');

function loadTournamentCore() {
  const source = fs.readFileSync(
    path.join(__dirname, '../../js/modules/tournament/tournament-core.js'),
    'utf8'
  );
  const context = { App: {}, console };
  vm.createContext(context);
  vm.runInContext(source, context, { filename: 'tournament-core.js' });
  return context.App;
}

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

describe('tournament registration status', () => {
  test('reopens a previously closed registration when deadline moves to the future', () => {
    const App = loadTournamentCore();
    const future = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString();

    expect(App.getTournamentStatus({
      status: '\u5df2\u622a\u6b62\u5831\u540d',
      regStart: '',
      regEnd: future,
    })).toBe('\u5831\u540d\u4e2d');
  });

  test('treats date-only deadlines as local end-of-day', () => {
    const App = loadTournamentCore();
    const tomorrow = localDateString(new Date(Date.now() + 24 * 60 * 60 * 1000));

    expect(App.getTournamentStatus({
      regStart: '',
      regEnd: tomorrow,
    })).toBe('\u5831\u540d\u4e2d');
  });
});
