# Tournament Module Directory

This directory is reserved for the tournament refactor so the feature can move out of the current flat `js/modules/` layout.

## Why this folder exists
- Tournament is no longer a single-page rendering feature.
- Friendly match v1 already spans:
  - data helpers
  - permission checks
  - form flows
  - detail rendering
  - team application review
  - roster management
  - notifications
- Future `cup` and `league` modes will expand this further.

## Current split
- `tournament-core.js` — shared status, normalization, record builders, edit lazy-load guard.
- `tournament-helpers.js` — organizer/delegate helpers and record-scope permission checks.
- `tournament-render.js` — public list/timeline rendering.
- `tournament-detail.js` — legacy/non-friendly detail compatibility.
- `tournament-friendly-detail.js` — friendly detail page actions and application review callsite.
- `tournament-friendly-detail-view.js` — friendly detail tab/content rendering.
- `tournament-friendly-state.js` — friendly detail state, application visibility, local cache sync.
- `tournament-friendly-roster.js` — approved-team roster/member participation flow.
- `tournament-friendly-notify.js` — notification wrappers for application submit/review.
- `tournament-manage.js` — admin list, create, end/reopen/delete flows.
- `tournament-manage-form.js` — shared create/edit form widgets.
- `tournament-manage-host.js` — host-team option and host entry builders.
- `tournament-manage-edit.js` — edit modal hydration and save.
- `tournament-share.js` / `tournament-share-builders.js` — tournament share UI/content builders.

## Migration note
- Production now loads this directory as the tournament feature group.
- Public/detail pages use the `tournament` group; admin tournament pages use `tournamentAdmin`.
- `admin.tournaments.entry` is an entry/page-access permission only. It must not be treated as record-scope edit/review authority; record-scope actions must use admin role, creator, delegate, or host-team officer checks.
