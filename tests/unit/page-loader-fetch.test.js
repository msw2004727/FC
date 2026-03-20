/**
 * PageLoader fetch error handling tests
 *
 * Covers: Step 7 (E9) — HTTP status check in page-loader.js
 *
 * Strategy: extract the fetch-then-check logic and test with mock responses.
 */

// ═══════════════════════════════════════════════════════
//  Extracted: fetch + response.ok check pattern
//  This is the pattern that Step 7 will add to page-loader.js
// ═══════════════════════════════════════════════════════

/**
 * Simulates the page-loader fetch pattern WITH the E9 fix applied.
 * Returns the HTML string or '' on failure.
 */
async function fetchPageFragment(fileName, mockFetch) {
  try {
    const response = await mockFetch(`pages/${fileName}.html?v=20260320t`);
    if (!response.ok) {
      return '';
    }
    return await response.text();
  } catch (err) {
    return '';
  }
}

/**
 * Simulates the CURRENT (pre-fix) page-loader fetch pattern.
 * No response.ok check — returns whatever .text() gives.
 */
async function fetchPageFragmentNoCheck(fileName, mockFetch) {
  try {
    return await mockFetch(`pages/${fileName}.html?v=20260320t`).then(r => r.text());
  } catch (err) {
    return '';
  }
}

// ═══════════════════════════════════════════════════════
//  Mock response helpers
// ═══════════════════════════════════════════════════════

function mockResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
  };
}

function mockFetchFn(status, body) {
  return async () => mockResponse(status, body);
}

function mockFetchNetworkError() {
  return async () => { throw new Error('NetworkError'); };
}

// ═══════════════════════════════════════════════════════
//  Tests: Step 7 — page-loader HTTP error handling
// ═══════════════════════════════════════════════════════

describe('Step 7: page-loader fetch with response.ok check', () => {
  test('HTTP 200 → returns HTML content', async () => {
    const html = await fetchPageFragment('home', mockFetchFn(200, '<div>Home</div>'));
    expect(html).toBe('<div>Home</div>');
  });

  test('HTTP 404 → returns empty string', async () => {
    const html = await fetchPageFragment('nonexistent', mockFetchFn(404, 'Not Found'));
    expect(html).toBe('');
  });

  test('HTTP 500 → returns empty string', async () => {
    const html = await fetchPageFragment('home', mockFetchFn(500, 'Internal Server Error'));
    expect(html).toBe('');
  });

  test('HTTP 503 (CDN overload) → returns empty string', async () => {
    const html = await fetchPageFragment('home', mockFetchFn(503, 'Service Unavailable'));
    expect(html).toBe('');
  });

  test('network error → returns empty string', async () => {
    const html = await fetchPageFragment('home', mockFetchNetworkError());
    expect(html).toBe('');
  });

  test('HTTP 301 redirect (ok=false) → returns empty string', async () => {
    const html = await fetchPageFragment('home', mockFetchFn(301, ''));
    expect(html).toBe('');
  });

  test('HTTP 204 No Content (ok=true) → returns empty string body', async () => {
    const html = await fetchPageFragment('home', mockFetchFn(204, ''));
    expect(html).toBe('');
  });
});

describe('Step 7: demonstrates the bug that E9 fixes', () => {
  test('WITHOUT fix: HTTP 404 body is treated as valid HTML', async () => {
    // Current code has no response.ok check
    const html = await fetchPageFragmentNoCheck(
      'nonexistent',
      mockFetchFn(404, '<html><body>404 Not Found</body></html>')
    );
    // Bug: 404 error page HTML is returned as if it were a valid page fragment
    expect(html).toBe('<html><body>404 Not Found</body></html>');
  });

  test('WITH fix: HTTP 404 body is rejected', async () => {
    const html = await fetchPageFragment(
      'nonexistent',
      mockFetchFn(404, '<html><body>404 Not Found</body></html>')
    );
    // Fixed: returns empty string instead of error page HTML
    expect(html).toBe('');
  });

  test('WITHOUT fix: HTTP 503 body pollutes page content', async () => {
    const html = await fetchPageFragmentNoCheck(
      'home',
      mockFetchFn(503, '<h1>Service Temporarily Unavailable</h1>')
    );
    // Bug: CDN error page content would be injected into the app
    expect(html).toContain('Temporarily Unavailable');
  });

  test('WITH fix: HTTP 503 body is rejected', async () => {
    const html = await fetchPageFragment(
      'home',
      mockFetchFn(503, '<h1>Service Temporarily Unavailable</h1>')
    );
    expect(html).toBe('');
  });
});

describe('Step 7: multiple pages (loadAll pattern)', () => {
  test('parallel fetch with mixed results → only successful pages have content', async () => {
    const pages = ['home', 'activity', 'team', 'profile'];
    const responses = {
      home: mockFetchFn(200, '<div id="page-home">Home</div>'),
      activity: mockFetchFn(200, '<div id="page-activities">Activities</div>'),
      team: mockFetchFn(503, 'Service Unavailable'),
      profile: mockFetchFn(200, '<div id="page-profile">Profile</div>'),
    };

    const results = await Promise.all(
      pages.map(name => fetchPageFragment(name, responses[name]))
    );

    expect(results[0]).toContain('page-home');
    expect(results[1]).toContain('page-activities');
    expect(results[2]).toBe(''); // team failed
    expect(results[3]).toContain('page-profile');
  });

  test('all pages fail → all return empty string, no crash', async () => {
    const pages = ['home', 'activity', 'team'];
    const results = await Promise.all(
      pages.map(name => fetchPageFragment(name, mockFetchNetworkError()))
    );
    expect(results).toEqual(['', '', '']);
  });
});
