# Home Performance Slimming V2 — Step 6 Validation

Date: 2026-03-06
Scope: Final regression and acceptance validation for V2 Step 1-5 changes.

## Automated Validation Completed

- Git worktree was clean before validation started.
- UTF-8 verification passed for all touched runtime/docs files:
  - `app.js`
  - `index.html`
  - `css/base.css`
  - `js/config.js`
  - `js/core/page-loader.js`
  - `js/core/script-loader.js`
  - `js/core/navigation.js`
  - `js/core/mode.js`
  - `js/firebase-service.js`
  - `js/modules/banner.js`
  - `js/modules/popup-ad.js`
  - `js/modules/event-detail.js`
  - `js/modules/team-detail.js`
  - `js/modules/shop.js`
  - `js/modules/tournament-render.js`
  - `docs/claude-memory.md`
- `node --check` passed for all core changed JS files above.
- Homepage staged-render contract confirmed by static scan:
  - `renderAll()` only schedules homepage critical/deferred flow.
  - `renderAchievements()` no longer runs from homepage boot path.
  - popup ads no longer start from a global boot timeout.
  - banner first render uses `renderBannerCarousel({ autoplay: false })`, then deferred flow starts autoplay later.
- Cloud/deep-link contract confirmed by static scan:
  - `ensureCloudReady()` remains the single cloud boot gateway.
  - deep link boot still uses dedicated deep-link overlay path.
  - `showEventDetail()` / `showTeamDetail()` still route through gateway flow before rendering detail.
- `index.html` no longer contains Firebase/LIFF preload tags.
- Eager module count in `index.html` is now 21, reduced from the original heavy eager set.

## Step 6 Fixes Applied During Validation

### Detail Fragment Coverage Gap
- Issue found:
  - `page-shop-detail` and `page-tournament-detail` were top-level pages but missing from `PageLoader` mapping.
  - `showShopDetail()` / `showTournamentDetail()` wrote detail DOM before ensuring the fragment existed.
  - This created a cold-first-visit failure path, especially for tournament detail opened directly from homepage ongoing tournaments.
- Fix applied:
  - `js/core/page-loader.js`: mapped `page-shop-detail` -> `shop`, `page-tournament-detail` -> `tournament`
  - `js/firebase-service.js`: mapped both detail pages to the same lazy collection sets as their parent pages
  - `js/modules/shop.js`: `showShopDetail()` now awaits `showPage('page-shop-detail')` before writing DOM
  - `js/modules/tournament-render.js`: `showTournamentDetail()` now awaits `showPage('page-tournament-detail')` before writing DOM

## Coverage Notes

- Top-level page fragment coverage check now reports `39 / 39` pages mapped by `PageLoader`.
- `ScriptLoader` intentionally does not cover every page ID because some routes still rely on eager bootstrap modules:
  - `page-home`
  - `page-messages`
  - `page-tournaments`
  - `page-achievements`
  - `page-titles`
  - `page-admin-achievements`
  - `page-admin-announcements`
  - `page-admin-themes`
- This is acceptable for the current V2 state because those owners remain eager in `index.html`.

## Limits Of Local Validation

- No `node_modules` directory exists in this workspace, so Firestore emulator/rules tests were not runnable in Step 6.
- No browser automation or visual regression harness is present in this repo.
- Final acceptance still requires manual browser/mobile verification.

## Manual Acceptance Focus

### Cold Start
- `?clear=1` homepage boot
- first switch to `活動 / 球隊 / 個人`
- status hint behavior and disappearance

### Detail Entry
- homepage event card -> activity detail
- homepage team entry -> team detail
- homepage ongoing tournament card -> tournament detail
- shop list first visit -> shop detail

### Deep Link
- `?event=<validId>`
- `?team=<validId>`

### Homepage Staged Render
- critical content appears first
- deferred content appears shortly after
- banner autoplay starts later, not immediately
- popup ads do not repeatedly reopen on same session home revisit

### Admin / Shared Runtime Risk
- admin banners / floating / popup / sponsor / shot-game ad tabs
- admin users / exp / roles / error logs

## Step 6 Exit Status

- Automated validation: PASS
- Structural regression scan: PASS
- Cold-first-visit detail gap: FIXED during Step 6
- Manual acceptance: REQUIRED
