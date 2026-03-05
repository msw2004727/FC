# Home Page Slimming Plan (Implementation Spec)

## 1. Goal

Improve home page performance without changing product behavior.

Top 3 priorities:

1. P0: Script loading stratification
2. P1: Deferred and conditional Firebase/LIFF bootstrap
3. P2: Staged home rendering

Success criteria:

1. Faster first paint and faster interaction readiness on home page.
2. Deep links (`?event=` and `?team=`) keep working with no regression.
3. Non-home features do not load on first home visit.

## 2. Scope

In scope:

1. `index.html` script strategy
2. `js/core/script-loader.js` page/group mapping
3. `js/core/navigation.js` load-before-render flow
4. `app.js` cloud bootstrap timing
5. Home rendering split into critical/deferred stages

Out of scope:

1. Firestore schema changes
2. Visual redesign
3. New feature development

## 3. Priority and Effort

1. P0: 4-6 hours
2. P1: 3-4 hours
3. P2: 2-3 hours
4. Regression test: 1-2 hours

Total: 10-15 hours.

## 4. P0 - Script Loading Stratification

### 4.1 Objective

Replace broad `defer` loading in `index.html` with:

1. core scripts always loaded
2. feature modules loaded per page on demand

### 4.2 Keep in `index.html` (core)

1. `js/i18n.js`
2. `js/config.js`
3. `js/data.js`
4. `js/firebase-config.js`
5. `js/firebase-service.js`
6. `js/firebase-crud.js`
7. `js/api-service.js`
8. `js/line-auth.js`
9. `js/core/page-loader.js`
10. `js/core/script-loader.js`
11. `app.js`
12. `js/core/navigation.js`
13. `js/core/theme.js`
14. `js/core/mode.js`

### 4.3 Move to on-demand loading

Move all `js/modules/*` scripts (including `shot-game-page.js`) out of initial `index.html` loading.

Load them only via `ScriptLoader.ensureForPage(pageId)`.

### 4.4 Implementation steps

1. Remove `js/modules/*` `<script defer ...>` from `index.html`.
2. Update `js/core/script-loader.js`:
   - add `shot-game` group
   - map `page-game` to `shot-game`
   - verify `page-admin-*` mappings are complete
3. Update `js/core/navigation.js`:
   - ensure `await ScriptLoader.ensureForPage(pageId)` runs before page render/init
   - then call `_renderPageContent(pageId)`

### 4.5 Risks and mitigation

1. Risk: first visit to a page fails due missing module mapping.
2. Mitigation: run smoke checks on every main page and patch mapping gaps.

## 5. P1 - Deferred and Conditional Firebase/LIFF Bootstrap

### 5.1 Objective

In non-deep-link scenarios, let home render first, then initialize cloud SDKs.

### 5.2 Implementation steps

1. Create singleton `App.ensureCloudReady()` in `app.js`:
   - wraps `_loadCDNScripts()`
   - wraps `initFirebaseApp()`
   - wraps `LineAuth.initSDK()`
   - wraps `FirebaseService.init()`
2. At DOMContentLoaded:
   - if URL has deep link params (`event` or `team`): call `ensureCloudReady()` immediately
   - else: run `ensureCloudReady()` via `requestIdleCallback` (fallback `setTimeout`)
3. Before entering protected pages:
   - await `App.ensureCloudReady()` if not ready yet
4. Keep existing deep-link guard behavior unchanged.

### 5.3 Risks and mitigation

1. Risk: double initialization attempts.
2. Mitigation: single promise gate.
3. Risk: first protected-page entry waits longer.
4. Mitigation: show loading state only on first entry.

## 6. P2 - Staged Home Rendering

### 6.1 Objective

Reduce main-thread burst by rendering home in two phases.

### 6.2 Rendering split

Critical (immediate):

1. base shell and banner skeleton
2. first batch of hot events
3. bottom navigation interaction

Deferred (idle/in-viewport):

1. ongoing tournaments
2. sponsors and floating ads
3. mini-game shortcut and non-critical sections

### 6.3 Implementation steps

1. Split home render in `navigation.js`:
   - `renderHomeCritical()`
   - `renderHomeDeferred()`
2. Trigger deferred render with `requestIdleCallback` (fallback `setTimeout`).
3. Add `IntersectionObserver` for offscreen blocks.
4. Keep skeleton placeholders to avoid blank content and layout jumps.

### 6.4 Risks and mitigation

1. Risk: delayed sections appear with visible jump.
2. Mitigation: reserve section height and keep skeleton placeholders.

## 7. Validation and Acceptance

### 7.1 Functional checks

1. Home page loads and is interactive with no console errors.
2. `?event=` deep link opens event detail correctly.
3. `?team=` deep link opens team detail correctly.
4. First entry to `page-game` loads game page and initializes successfully.
5. First entry to activity/team/message/admin/scan pages works.

### 7.2 Performance checks

1. Compare before/after `DOMContentLoaded`, LCP, and TTI.
2. Validate smoother scrolling and tap response on mainstream phones.
3. Verify network panel: no non-essential `js/modules/*` on initial home load.

## 8. Versioning and Logging Rules

For each implementation phase:

1. update `CACHE_VERSION` in `js/config.js`
2. sync all `?v=` values in `index.html`
3. append an entry to `docs/claude-memory.md`

## 9. Deliverables

1. This spec: `docs/home-performance-slimming-spec.md`
2. P0/P1/P2 code changes
3. Regression notes
4. changelog entry in `docs/claude-memory.md`
