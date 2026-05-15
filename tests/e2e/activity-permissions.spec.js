// @ts-check
const { test, expect } = require('@playwright/test');
const { installTestHarness, TEST_USERS } = require('./helpers/test-harness');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DEFAULT_USER_ACTIVITY_CAPABILITIES = [
  'user.activity.basic_create',
  'user.activity.external_create',
  'user.activity.own_manage_entry',
  'user.activity.own_edit_basic',
  'user.activity.own_cancel',
  'user.activity.site_operate',
  'user.activity.delegate_assign',
];

async function openActivityRuntime(page, capabilities = DEFAULT_USER_ACTIVITY_CAPABILITIES) {
  await installTestHarness(page, TEST_USERS.userBasic);
  await page.goto(`${BASE_URL}#page-activities`);
  await page.waitForSelector('#loading-overlay', { state: 'hidden', timeout: 15000 });
  await page.waitForFunction(() => (
    typeof App !== 'undefined'
    && typeof ScriptLoader !== 'undefined'
    && typeof FirebaseService !== 'undefined'
  ));
  await page.evaluate(async ({ caps }) => {
    const user = window.__E2E_TEST_HARNESS__?.currentUser;
    if (!FirebaseService._cache) FirebaseService._cache = {};
    FirebaseService._cache.currentUser = user;
    FirebaseService._cache.roleActivityCapabilities = { user: caps };
    App.currentRole = 'user';
    await ScriptLoader.ensureForPage?.('page-activities');
  }, { caps: capabilities });
}

test.describe('Activity permission runtime', () => {
  test('basic user can create basic activity but add-ons show upsell toast', async ({ page }) => {
    await openActivityRuntime(page);

    const result = await page.evaluate(() => {
      window.__lastToast = '';
      App.showToast = message => { window.__lastToast = message; };
      App._showActivityAddonUpsellToast?.();
      return {
        canCreateBasic: App._canCreateBasicActivity?.(),
        canUseAddonsForNewEvent: App._canUseActivityAddons?.(),
        toast: window.__lastToast,
      };
    });

    expect(result).toEqual({
      canCreateBasic: true,
      canUseAddonsForNewEvent: false,
      toast: '如需更多功能請聯繫官方Line@',
    });
  });

  test('add-ons capability allows owner add-ons but not delegate add-ons', async ({ page }) => {
    await openActivityRuntime(page, [
      ...DEFAULT_USER_ACTIVITY_CAPABILITIES,
      'user.activity.addons_use',
    ]);

    const result = await page.evaluate(() => {
      const uid = window.__E2E_TEST_HARNESS__?.currentUser?.uid;
      return {
        canUseAddonsForNewEvent: App._canUseActivityAddons?.(),
        canUseAddonsForOwnerEvent: App._canUseActivityAddons?.({ id: 'owner-event', creatorUid: uid }),
        canUseAddonsForDelegateEvent: App._canUseActivityAddons?.({
          id: 'delegate-event',
          creatorUid: 'other-owner',
          delegateUids: [uid],
          delegates: [{ uid, name: 'Delegate' }],
        }),
      };
    });

    expect(result).toEqual({
      canUseAddonsForNewEvent: true,
      canUseAddonsForOwnerEvent: true,
      canUseAddonsForDelegateEvent: false,
    });
  });
});
