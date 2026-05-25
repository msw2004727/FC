const fs = require('fs');
const path = require('path');

function readWorkflow(name) {
  return fs.readFileSync(path.join(__dirname, '../../.github/workflows', name), 'utf8');
}

describe('scheduled write workflows', () => {
  test.each([
    ['inject-hot-events.yml', '[inject-bot]'],
    ['build-sitemap.yml', '[sitemap-bot]'],
  ])('%s retries transient GitHub push failures', (workflowName, botPrefix) => {
    const source = readWorkflow(workflowName);

    expect(source).toContain('push_with_retry()');
    expect(source).toContain(botPrefix);
    expect(source).toContain('git push origin HEAD:main >"$push_log" 2>&1');
    expect(source).toContain('Internal Server Error');
    expect(source).toContain('HTTP 5[0-9][0-9]');
    expect(source).toContain('return 2');
    expect(source).toContain('exit 0');
  });
});
