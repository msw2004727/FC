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

## Recommended split
- `tournament-core.js`
- `tournament-permissions.js`
- `tournament-friendly-form.js`
- `tournament-friendly-detail.js`
- `tournament-friendly-registration.js`
- `tournament-friendly-notify.js`
- `tournament-friendly-render.js`

## Migration note
- Production still uses the legacy flat files:
  - `tournament-manage.js`
  - `tournament-render.js`
- New work should treat this directory as the target landing zone for the refactor.
