# Tournament Module Directory

This directory contains the live tournament feature split. It supports public tournament lists and details, friendly applications and rosters, single-match events, cup/league competition, match recording, scheduling, sharing, and tournament administration.

The runtime source of truth for load order is `js/core/script-loader.js`. `index.html` contains only the eager list baseline; do not infer the complete feature from its direct `<script>` tags.

## Module Responsibilities

### Shared list and permission layer

- `tournament-helpers.js` — organizer, delegate, host-team officer, record-scope, and match-recording permission helpers.
- `tournament-core.js` — shared status/mode/sport normalization, friendly record builders, organizer contact, and lazy tournament-admin entry loading.
- `tournament-render.js` — public list/timeline rendering and the lazy detail opener.

### Competition and data layer

- `tournament-competition.js` — side-effect-free cup/league fixture, standings, scoring, and discipline calculations.
- `tournament-match-data.js` — `ApiService` extension for tournament match subcollection reads and writes.

### Detail and friendly flow

- `tournament-detail.js` — base detail route, legacy/non-friendly detail compatibility, and detail race guard.
- `tournament-friendly-apply-state.js` — eligible-team, alias, officer-role, and application-state decisions.
- `tournament-friendly-state.js` — friendly detail state loading, realtime/cache synchronization, and visibility state.
- `tournament-friendly-detail.js` — friendly detail orchestration and application submit/review actions.
- `tournament-friendly-withdraw.js` — applicant-side team application or entry withdrawal.
- `tournament-friendly-detail-view.js` — friendly tabs, content, team/application, roster, and match presentation.
- `tournament-friendly-roster.js` — approved-team roster participation and join/leave flows.
- `tournament-friendly-notify.js` — application submit/review notification wrappers.

### Competition detail and operations

- `tournament-detail-competition.js` — cup/league brackets, fixtures, standings, scorer/card tables, and match detail rendering.
- `tournament-match-record.js` — score, walkover, scorer, card, referee briefing, and match record modal flows.
- `tournament-schedule-manage.js` — fixture generation/regeneration, scheduled time/place, and referee assignment UI.

### Sharing

- `tournament-share-builders.js` — pure Mini App URL, alt text, and Flex payload builders.
- `tournament-share.js` — share action sheet, LINE picker, clipboard, and platform fallback behavior.

### Administration

- `tournament-manage-form.js` — shared create/edit form state, validation helpers, dates, mode, and upload widgets.
- `tournament-manage-people.js` — delegate, referee, and referee-head pickers.
- `tournament-manage-host-selection.js` — host-team aliases, eligibility, and selection decisions.
- `tournament-manage-host.js` — host/team/mode form layout and host participation controls.
- `tournament-manage-edit.js` — edit hydration, authorization, and save flow.
- `tournament-manage.js` — admin list/tabs plus create, end, reopen, and delete operations.

## Loader Contract

`js/core/script-loader.js` currently defines these groups:

| Group | Responsibility |
|-------|----------------|
| `tournamentList` | Minimal first-screen list dependencies: helpers, core, and render |
| `tournamentDetail` | Full detail dependency chain, including competition, friendly state/actions/views, sharing, roster, notifications, match recording, and schedule management |
| `tournament` | Compatibility alias that mirrors the full detail chain; do not use it for new page mappings when a narrower named group fits |
| `tournamentAdmin` | Create/edit/manage dependencies; loaded together with `tournamentList` on the admin page |

Page mappings:

- `page-tournaments` → `tournamentList`
- `page-tournament-detail` → `tournamentDetail`
- `page-admin-tournaments` → `tournamentList` + `tournamentAdmin`

`index.html` eagerly loads only:

- `tournament-helpers.js`
- `tournament-core.js`
- `tournament-render.js`

Everything else must be reached through `ScriptLoader.ensureForPage(...)` or the existing lazy admin loaders. Do not add a detail/admin module directly to `index.html` merely to fix a missing dependency; register it in the correct group and preserve dependency order.

### Load order is behavior

Several detail modules wrap or extend methods defined by earlier modules. In particular, the base detail implementation is loaded before friendly orchestration/view wrappers, and competition detail rendering extends the active tab renderer afterward. Reordering the group can silently replace the wrong implementation even when every file still loads.

Any group membership or order change must:

1. Keep providers before consumers and wrapper layers in their established sequence.
2. Update `docs/tunables.md`, because loader order is a documented sequence dependency.
3. Run loader and tournament regression tests before release.

## Permission Boundary

`admin.tournaments.entry` controls entry/page visibility only. It is not record-scope authorization.

- Tournament edit/review/schedule management uses global-admin status or `_canManageTournamentRecord(tournament, user)`.
- Match scoring uses `_canRecordTournamentMatch(tournament, match, user)`: assigned referees receive only their match scope; when a match has no `refereeUids`, any referee listed on the tournament may record it.
- Creator, delegate, host-team officer, referee-head, and assigned-referee behavior must remain aligned with the helper implementations and Firestore Rules.

Do not replace these action-specific helpers with the drawer entry permission.

## Adding or Moving a Tournament Module

1. Put the file in this directory and keep one responsibility per module.
2. Register it in the narrowest `ScriptLoader` group; add it to multiple groups only when each route truly needs it.
3. Place it after every dependency and before any wrapper/consumer that reads its methods at load time.
4. Keep `tournamentList` limited to list-first-screen dependencies.
5. Update this README; if module relationships change, also update local-only `docs/architecture.md`. If loader membership/order changes, update local-only `docs/tunables.md`.
6. Do not add direct `index.html` scripts unless the list page needs them before lazy loading.

## Verification

Live inventory and loader checks:

```bash
rg --files js/modules/tournament -g '*.js'
rg -n "tournamentList:|tournamentDetail:|tournamentAdmin:|'page-tournaments'|'page-tournament-detail'|'page-admin-tournaments'" js/core/script-loader.js
rg -n "js/modules/tournament/" index.html
```

Targeted regression set for loader or tournament-module changes:

```bash
npx jest --runInBand tests/unit/script-loader.test.js tests/unit/tournament-loading-performance.test.js tests/unit/tournament-competition.test.js tests/unit/tournament-friendly-detail-view.test.js tests/unit/tournament-match-record.test.js tests/unit/tournament-schedule-ui.test.js tests/unit/tournament-share.test.js
```

Targeted tests are an early signal only. Production module changes must still follow the project-wide requirement to run the complete `npm run test:unit` suite.
