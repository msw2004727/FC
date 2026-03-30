# Activity Data Scaling Assessment

## Summary

This document evaluates when the current ToosterX activity-data architecture should move from the current cache-first, client-side filtering model to pagination, historical split-flow, or archival.

Current conclusion:

- Around `200` total activities with roughly `190` terminal (`ended` / `cancelled`) activities is usually still acceptable.
- The project does **not** need immediate database-level archival at that size.
- The project **should** begin planning a historical-activity split once terminal activities approach `250~300`, or earlier if related collections grow quickly.

The real bottleneck is not only the number of `events` documents. The heavier cost usually comes from:

- `registrations`
- `attendanceRecords`
- `activityRecords`

## Current Architecture

### Event loading behavior

The current FirebaseService intentionally does not block first paint on all historical events:

- Active events are listened to in real time with:
  - `status in ['open', 'full', 'upcoming']`
  - `limit(200)`
  - source: `js/firebase-service.js`
- Terminal events are loaded separately in the background with:
  - `status in ['ended', 'cancelled']`
  - `limit(200)`
  - source: `js/firebase-service.js`

This means the homepage is protected from immediate historical-event load pressure, but historical events still accumulate into the front-end cache after initialization.

### Front-end rendering behavior

The main activity UIs are still client-side full-list UIs:

- `renderActivityList()` takes cached events, then filters, sorts, groups by month/day, and renders the full result set.
- `renderMyActivities()` takes cached events, filters by ownership/delegation/admin scope, sorts, computes stats, then renders all visible cards.

Because of this, growth pressure appears first in pages that process the full in-memory list, not on the homepage.

## Load Thresholds

### 1. Safe Zone

Recommended range:

- Total activities: `< 200`

Expected behavior:

- Homepage should remain comfortable.
- Activity page should still be acceptable on most devices.
- Admin activity management should not yet require structural changes.

Recommended action:

- No architecture change.
- Only observe page responsiveness and cache growth.

### 2. Watch Zone

Recommended range:

- Total activities: `200~400`
- or terminal activities: `150~300`

Likely symptoms:

- The `ended` tab in the activity page becomes noticeably slower.
- Admin activity management starts to feel heavier than other pages.
- Historical events take longer to merge after background load.

Recommended action:

- Start planning a historical-activity split.
- Do not treat drawer/homepage/active-event behavior as the same data path as historical activity views.

This is the stage the project is approaching now.

### 3. Implementation Zone

Recommended range:

- Total activities: `400~800`
- or terminal activities: `> 300`
- or admin activity management has stable, repeatable lag

Expected problems:

- Full-list client filtering/sorting/rendering becomes meaningfully heavier.
- Historical activity UX becomes the main bottleneck.
- Current `limit(200)` on terminal events becomes a data-completeness risk, not only a performance issue.

Recommended action:

- Split active events and historical events into clearly different UI/data paths.
- Add pagination or batched loading for historical activities.
- Stop treating all terminal activities as part of the always-available front-end cache.

### 4. Danger Zone

Recommended range:

- Total activities: `> 800~1000`
- or event-related child collections become very large

Expected problems:

- Historical activity completeness breaks first because the current terminal query is capped.
- Front-end full-list rendering becomes increasingly expensive.
- Cache restore becomes less effective.
- Activity-related pages start to drag each other down because they share large supporting collections.

Recommended action:

- Introduce real archival or active/archive collection separation.
- Historical browsing must become query-driven instead of cache-driven.

## What Actually Gets Heavy First

### Homepage

Usually not the first bottleneck.

Reason:

- Homepage only surfaces a small subset of visible activities.
- Historical events are not part of the critical first-render path.

### Activity page

This is one of the first likely pressure points.

Reason:

- The page processes the entire visible event cache.
- The `ended` tab becomes more expensive as historical events accumulate.

### Activity management page

This is the most likely first bottleneck.

Reason:

- Admin can see all events.
- The page computes filters, stats, sorting, and card rendering over the full event list.
- The UI is denser than the public activity timeline.

### Related collections

This is often the real scaling problem.

Reason:

- `page-activities` and `page-my-activities` also depend on:
  - `registrations`
  - `attendanceRecords`
  - `activityRecords`
- A project with 200 activities but very heavy sign-up/check-in history can feel worse than a project with more events but lighter records.

## Key Warning Signals

The project should move historical activities into a dedicated strategy once two or more of the following happen consistently:

- Terminal activities exceed `200`
- Admin activity management is noticeably slower than other pages
- The public activity page `ended` tab becomes obviously laggy
- Older ended activities stop appearing reliably because of the current query cap
- Related collections grow faster than the event documents themselves

## Recommended Next Step

For the current project state, the most pragmatic sequence is:

1. Keep the current architecture for now.
2. Begin planning a historical-activity split before terminal activities reach `250~300`.
3. When implementing, prioritize:
   - activity management
   - ended activity browsing
   - related-record collection strategy
4. Do **not** start by changing the homepage, because it is not the first bottleneck in the current design.
