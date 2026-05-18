const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');

function readProjectFile(file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8');
}

describe('activity early bird registration add-on', () => {
  test('create activity places early bird after social links and before reserved toggles', () => {
    const activityHtml = readProjectFile('pages/activity.html');
    const socialIndex = activityHtml.indexOf('id="ce-social-links-enabled"');
    const earlyBirdIndex = activityHtml.indexOf('id="ce-early-bird-enabled"');
    const reservedIndex = activityHtml.indexOf('id="ce-reserved-noshow-detection"');

    expect(socialIndex).toBeGreaterThan(-1);
    expect(earlyBirdIndex).toBeGreaterThan(socialIndex);
    expect(reservedIndex).toBeGreaterThan(earlyBirdIndex);
    expect(activityHtml).toContain('id="ce-early-bird-cost"');
    expect(activityHtml).toContain('min="10"');
    expect(activityHtml).toContain('max="500"');
  });

  test('form code stores, restores, templates, and permission-gates early bird settings', () => {
    const optionsSource = readProjectFile('js/modules/event/event-create-options.js');
    const createSource = readProjectFile('js/modules/event/event-create.js');
    const lifecycleSource = readProjectFile('js/modules/event/event-manage-lifecycle.js');
    const templateSource = readProjectFile('js/modules/event/event-create-template.js');
    const helpersSource = readProjectFile('js/modules/event/event-list-helpers.js');
    const configSource = readProjectFile('js/config.js');
    const rolesSource = readProjectFile('js/modules/user-admin/user-admin-roles.js');

    expect(optionsSource).toContain('_getEventEarlyBirdFormData');
    expect(optionsSource).toContain('_setEventEarlyBirdFormData');
    expect(optionsSource).toContain('bindEventEarlyBirdToggle');
    expect(optionsSource).toContain('_earlyBirdMinCost: 10');
    expect(optionsSource).toContain('_earlyBirdMaxCost: 500');

    expect(createSource).toContain('this._getEventEarlyBirdFormData?.({ validate: true })');
    expect(createSource).toContain('earlyBirdEnabled');
    expect(createSource).toContain('earlyBirdCost');
    expect(createSource).toContain('earlyBirdPolicyVersion');
    expect(createSource).toContain('早鳥報名');
    expect(createSource).toContain('_canUseActivityAddons');
    expect(helpersSource).toContain("user.activity.addons_use");
    expect(configSource).toContain('社群連結與早鳥報名等進階功能（加值服務）');
    expect(rolesSource).toContain('社群連結與早鳥報名功能');
    expect(lifecycleSource).toContain('this._setEventEarlyBirdFormData?.(!!e.earlyBirdEnabled, e.earlyBirdCost || 10)');
    expect(templateSource).toContain('earlyBirdData');
    expect(templateSource).toContain('this._setEventEarlyBirdFormData?.(canUseAddons && !!tpl.earlyBirdEnabled');
  });

  test('detail signup renders early bird states and confirmation copy', () => {
    const detailSource = readProjectFile('js/modules/event/event-detail.js');
    const signupSource = readProjectFile('js/modules/event/event-detail-signup.js');
    const activityCss = readProjectFile('css/activity.css');

    expect(detailSource).toContain('this._buildEventEarlyBirdSignupHtml?.(e, { isGuestView, isMainFull })');
    expect(signupSource).toContain('_isEventEarlyBirdWindow');
    expect(signupSource).toContain('_buildEventEarlyBirdSignupHtml');
    expect(signupSource).toContain('目前積分不足，可等正式開放後報名');
    expect(signupSource).toContain('若活動取消，系統會退回積分；若你自行取消報名，已扣除的早鳥積分不會退回。');
    expect(signupSource).toContain('event-early-bird-btn event-early-bird-btn-disabled');
    expect(signupSource).toContain('shouldUseServerRegistrationForEarlyBird');
    expect(signupSource).toContain('earlyBirdAccepted = true');
    expect(signupSource).toContain('earlyBirdExpectedCost = earlyBirdCost');
    expect(activityCss).toContain('.event-early-bird-btn');
    expect(activityCss).toContain('.event-early-bird-btn:disabled');
    expect(activityCss).toContain('.event-early-bird-btn-disabled');
    expect(activityCss).toContain('.early-bird-confirm-body');
  });

  test('cloud function charges early bird atomically and refunds on event cancellation', () => {
    const functionsSource = readProjectFile('functions/index.js');

    expect(functionsSource).toContain('function normalizeEventEarlyBirdCost(value)');
    expect(functionsSource).toContain('EARLY_BIRD_INSUFFICIENT_EXP');
    expect(functionsSource).toContain('EARLY_BIRD_COST_CHANGED');
    expect(functionsSource).toContain('ruleKey: "early_bird_registration"');
    expect(functionsSource).toContain('reg.earlyBirdRefunded = false');
    expect(functionsSource).toContain('refundEarlyBirdRegistrationsForCancelledEvent');
    expect(functionsSource).toContain('ruleKey: "early_bird_refund"');
    expect(functionsSource).toContain('event_cancel_refund_user_cancel_no_refund');
  });

  test('firestore rules treat early bird as an add-on with bounded cost', () => {
    const rulesSource = readProjectFile('firestore.rules');

    expect(rulesSource).toContain("request.resource.data.get('earlyBirdEnabled', false) == false");
    expect(rulesSource).toContain("request.resource.data.get('earlyBirdCost', 0) == 0");
    expect(rulesSource).toContain("hasActivityCap('user.activity.addons_use')");
    expect(rulesSource).toContain('function eventEarlyBirdFieldsValid(data)');
    expect(rulesSource).toContain("data.get('earlyBirdCost', 0) >= 10");
    expect(rulesSource).toContain("data.get('earlyBirdCost', 0) <= 500");
    expect(rulesSource).toContain("'earlyBirdEnabled', 'earlyBirdCost', 'earlyBirdPolicyVersion'");
  });
});
