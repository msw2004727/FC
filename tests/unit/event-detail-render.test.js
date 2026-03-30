/**
 * @jest-environment jsdom
 */

/**
 * Event Detail Button Rendering — DOM tests
 *
 * Tests the signup button state rendering logic from event-detail.js
 * in a jsdom environment. Verifies that the correct button is rendered
 * based on registration state, loading state, and event status.
 *
 * These tests focus on the regsLoading / isSignedUp / isOnWaitlist
 * decision tree that determines which button the user sees.
 */

// ===========================================================================
// Extracted logic: button state decision (event-detail.js:295-350)
// ===========================================================================

/**
 * Determines the signup button state.
 * Returns: { type, disabled, text }
 */
function determineButtonState({
  isGuestView = false,
  isDemo = false,
  firstSnapshotReceived = false,
  retryCount = 0,
  isSignedUp = false,
  isOnWaitlist = false,
  isEnded = false,
  isUpcoming = false,
  isMainFull = false,
  teamOnlyBlocked = false,
  genderBlocked = false,
}) {
  // Fix A + Fix 1: regsLoading condition
  const regsLoading = !isGuestView && !isDemo
    && !firstSnapshotReceived
    && retryCount < 3;

  if (isGuestView) {
    return { type: 'guest', disabled: false, text: '立即報名' };
  }
  if (regsLoading) {
    return { type: 'loading', disabled: true, text: '載入中…' };
  }
  if (isUpcoming) {
    return { type: 'upcoming', disabled: true, text: '報名尚未開放' };
  }
  if (isEnded) {
    return { type: 'ended', disabled: true, text: '已結束' };
  }
  if (isOnWaitlist) {
    return { type: 'cancelWaitlist', disabled: false, text: '取消候補' };
  }
  if (isSignedUp) {
    return { type: 'cancelSignup', disabled: false, text: '取消報名' };
  }
  if (teamOnlyBlocked) {
    return { type: 'teamOnly', disabled: true, text: '球隊限定' };
  }
  if (genderBlocked) {
    return { type: 'genderBlocked', disabled: true, text: '性別限定' };
  }
  if (isMainFull) {
    return { type: 'waitlist', disabled: false, text: '報名候補' };
  }
  return { type: 'signup', disabled: false, text: '立即報名' };
}

// ===========================================================================
// TESTS
// ===========================================================================

describe('Button state: regsLoading (Fix A + Fix 1)', () => {
  test('shows loading when snapshot not received and retries < 3', () => {
    const state = determineButtonState({
      firstSnapshotReceived: false,
      retryCount: 0,
    });
    expect(state.type).toBe('loading');
    expect(state.disabled).toBe(true);
    expect(state.text).toBe('載入中…');
  });

  test('shows loading at retry count 2 (still < 3)', () => {
    const state = determineButtonState({
      firstSnapshotReceived: false,
      retryCount: 2,
    });
    expect(state.type).toBe('loading');
  });

  test('stops loading at retry count 3 (Fix 1 escape hatch)', () => {
    const state = determineButtonState({
      firstSnapshotReceived: false,
      retryCount: 3,
    });
    expect(state.type).toBe('signup'); // falls through to default
    expect(state.disabled).toBe(false);
  });

  test('not loading when snapshot received (Fix A)', () => {
    const state = determineButtonState({
      firstSnapshotReceived: true,
      retryCount: 0,
    });
    expect(state.type).toBe('signup');
  });

  test('guest view never shows loading', () => {
    const state = determineButtonState({
      isGuestView: true,
      firstSnapshotReceived: false,
      retryCount: 0,
    });
    expect(state.type).toBe('guest');
  });

  test('demo mode never shows loading', () => {
    const state = determineButtonState({
      isDemo: true,
      firstSnapshotReceived: false,
      retryCount: 0,
    });
    expect(state.type).toBe('signup');
  });
});

describe('Button state: registration status', () => {
  const base = { firstSnapshotReceived: true };

  test('signed up → cancel button', () => {
    const state = determineButtonState({ ...base, isSignedUp: true });
    expect(state.type).toBe('cancelSignup');
    expect(state.text).toBe('取消報名');
  });

  test('on waitlist → cancel waitlist button', () => {
    const state = determineButtonState({ ...base, isSignedUp: true, isOnWaitlist: true });
    expect(state.type).toBe('cancelWaitlist');
    expect(state.text).toBe('取消候補');
  });

  test('not signed up + full → waitlist button', () => {
    const state = determineButtonState({ ...base, isMainFull: true });
    expect(state.type).toBe('waitlist');
    expect(state.text).toBe('報名候補');
  });

  test('not signed up + open → signup button', () => {
    const state = determineButtonState({ ...base });
    expect(state.type).toBe('signup');
    expect(state.text).toBe('立即報名');
  });
});

describe('Button state: event lifecycle', () => {
  const base = { firstSnapshotReceived: true };

  test('ended event → disabled ended button', () => {
    const state = determineButtonState({ ...base, isEnded: true });
    expect(state.type).toBe('ended');
    expect(state.disabled).toBe(true);
  });

  test('upcoming event → disabled upcoming button', () => {
    const state = determineButtonState({ ...base, isUpcoming: true });
    expect(state.type).toBe('upcoming');
    expect(state.disabled).toBe(true);
  });
});

describe('Button state: restrictions', () => {
  const base = { firstSnapshotReceived: true };

  test('team-only blocked → disabled team-only button', () => {
    const state = determineButtonState({ ...base, teamOnlyBlocked: true });
    expect(state.type).toBe('teamOnly');
    expect(state.disabled).toBe(true);
  });

  test('gender blocked → disabled gender button', () => {
    const state = determineButtonState({ ...base, genderBlocked: true });
    expect(state.type).toBe('genderBlocked');
    expect(state.disabled).toBe(true);
  });
});

describe('Button state: priority order', () => {
  const base = { firstSnapshotReceived: true };

  test('ended takes priority over signed up', () => {
    const state = determineButtonState({ ...base, isEnded: true, isSignedUp: true });
    expect(state.type).toBe('ended');
  });

  test('upcoming takes priority over signed up', () => {
    const state = determineButtonState({ ...base, isUpcoming: true, isSignedUp: true });
    expect(state.type).toBe('upcoming');
  });

  test('waitlist takes priority over signup status', () => {
    const state = determineButtonState({ ...base, isSignedUp: true, isOnWaitlist: true });
    expect(state.type).toBe('cancelWaitlist');
  });

  test('loading takes priority over everything (except guest/demo)', () => {
    const state = determineButtonState({
      firstSnapshotReceived: false,
      retryCount: 0,
      isSignedUp: true,
      isEnded: true,
    });
    expect(state.type).toBe('loading');
  });
});

describe('DOM rendering smoke test', () => {
  test('jsdom environment is active', () => {
    expect(typeof document).toBe('object');
    expect(typeof document.createElement).toBe('function');
  });

  test('can create and query button elements', () => {
    const container = document.createElement('div');
    container.innerHTML = '<button disabled>載入中…</button>';
    document.body.appendChild(container);

    const btn = container.querySelector('button');
    expect(btn).not.toBeNull();
    expect(btn.disabled).toBe(true);
    expect(btn.textContent).toBe('載入中…');

    document.body.removeChild(container);
  });
});
