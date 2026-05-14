# Scoreboard Translation Workflow Plan

> Created: 2026-05-06
> Status: implemented and verified locally

## Goal

SportsAPI Pro does not return Traditional Chinese names. ToosterX will keep using the existing cached scoreboard architecture, then add a conservative source-name translation layer:

SportsAPI Pro source data -> backend normalization -> source-name translation layer -> Firestore cache -> frontend display.

The translation layer must not guess aggressively. It should translate known or approved names, collect unknown names as candidates, and keep the original source text when confidence is low.

## Confirmed Current Architecture

- Backend collection happens in `functions/scoreboard-sportsapipro.js`.
- Sports catalog, request planning, and match normalization live in `functions/scoreboard-sportsapipro-utils.js`.
- Homepage and public scoreboard read only `siteConfig/scoreboardConfig`, `scoreboardSnapshots/home`, and `scoreboardMatchDetails/{sport_matchId}`.
- Admin scoreboard control page lives in `js/modules/scoreboard/scoreboard-admin.js`.
- Firestore rules currently make scoreboard snapshots/details public read and client write denied.
- `siteConfig/scoreboardConfig` is public-readable and must not store API keys, translation bulk data, or sensitive maintenance payloads.

No blocking medium or major flaw was found in the existing architecture. The main implementation risk is data volume and translation accuracy, so the design uses cached stats, status flags, and original-text fallback.

## Data Model

### `scoreboardTranslationCandidates/{id}`

Admin-readable, client-write denied. Written by Cloud Functions when source names appear in live/schedule/detail payloads.

Fields:

- `provider`: `sportsapipro`
- `sport`: e.g. `football`, `basketball`
- `type`: `team`, `league`, `status`, `venue`, `player`, `tournament`
- `sourceName`: original text from the API, not necessarily English
- `normalizedSourceName`: normalized key for matching and dedupe
- `occurrenceCount`: total observed count
- `firstSeenAt`
- `lastSeenAt`
- `lastMatchId`
- `sampleLeague`
- `sampleTitle`
- `status`: defaults to `pending`

### `scoreboardTranslations/{id}`

Admin-readable, client-write denied. Written by trusted maintenance flow or admin callable.

Fields:

- `provider`
- `sport`
- `type`
- `sourceName`
- `normalizedSourceName`
- `zhTW`
- `status`: `approved`, `keep_original`, `ignored`, `needs_review`, `conflict`
- `reviewedBy`
- `reviewedAt`
- `updatedAt`

### `scoreboardTranslationStats/summary`

Admin-readable, client-write denied. Written by Cloud Functions after refresh or maintenance.

Fields:

- `totals`: total pending, approved, keep original, ignored, needs review, conflicts, coverage rate
- `bySport`: same counts by sport
- `byType`: same counts by type
- `topPending`: top high-frequency pending terms
- `lastCollectedAt`
- `lastStatsAt`
- `aiPrompt`
- `aiDirectPrompt`

## Translation Rules

- Approved translations override source text.
- `keep_original` means the original API name should remain visible and should not count as unfinished work.
- `ignored` is excluded from priority lists.
- Unknown source names remain unchanged in the UI.
- Original values are preserved in cache fields such as `homeTeamOriginal`, `awayTeamOriginal`, `leagueOriginal`, and `statusOriginal` when a translated display value is applied.
- The layer is source-name based, not English-only. Vietnamese, Spanish, French, Japanese, or mixed Latin names use the same candidate workflow.

## Backend Implementation

1. Add a translation helper module under `functions/`.
2. Load built-in stable translations first, then Firestore-approved translations.
3. During scoreboard refresh:
   - normalize live/today matches
   - collect candidate source names
   - apply approved translations
   - write translated snapshot cache
   - update translation candidates and stats
4. During detail fetch:
   - apply approved translations to summary fields
   - collect candidates from detail summary/stat/incidents where safe
5. Add admin-only callable support for future maintenance reads/writes if needed, while direct client Firestore writes remain denied.

## Admin UI Implementation

Add a "scoreboard translation dictionary" section inside the existing scoreboard admin page:

- translated terms
- pending terms
- keep-original terms
- needs-review terms
- conflicts
- coverage rate
- per-sport breakdown
- top high-frequency pending names
- last collected/stats update time
- AI workflow prompt
- direct AI maintenance prompt

Every metric must have the same style of explanation button used by the existing scoreboard admin page.

## AI Maintenance Prompt

The admin page should expose this prompt so the workflow can be resumed later:

```text
Please follow docs/scoreboard-translation-workflow-plan.md for the scoreboard translation maintenance flow.
Read scoreboardTranslationCandidates and scoreboardTranslationStats, group by sport/type/status, and report total pending, approved, keep_original, needs_review, conflict, and the top high-frequency pending terms.
Generate Traditional Chinese suggestions conservatively. Prioritize major leagues, national teams, well-known clubs, NBA/MLB/BWF and common status text.
For local teams, youth teams, small leagues, or non-English source names with no reliable common Traditional Chinese name, mark keep_original instead of forcing a translation.
Do not overwrite approved translations unless explicitly requested.
Report suggested writes before applying them.
```

## Automated Test Coverage

Automated tests are needed because this touches cached public data, Cloud Functions normalization, Firestore rules, and admin UI display.

Required tests:

- Unit test translation key normalization, candidate extraction, approved translation application, keep-original fallback, and stats aggregation.
- Unit test SportsAPI Pro snapshot generation includes translated display names and original source fields.
- Unit test admin scoreboard page renders translation metrics and AI prompt from `scoreboardTranslationStats/summary`.
- Firestore rules test: candidates/translations/stats are denied to guests and normal admins, allowed to `super_admin` or `admin.scoreboard.translation`/`admin.scoreboard.configure`, and direct client writes are denied.

## Self-Acceptance Checklist

- [x] Existing scoreboard homepage still renders if translation collections do not exist.
- [x] Unknown names stay as source text and do not break UI.
- [x] Approved translations appear in homepage and public scoreboard after refresh.
- [x] Original source names are preserved when translated.
- [x] Candidate collection does not call extra SportsAPI Pro endpoints.
- [x] Candidate writes are deduped by provider/sport/type/normalized source name.
- [x] Stats update after refresh and after approved/keep-original translations exist.
- [x] Admin dashboard displays total metrics, per-sport breakdown, top pending terms, and AI prompt.
- [x] Firestore client writes to translation collections are denied.
- [x] Unit tests and Firestore rules tests pass.

## Verification Record

- `npm test -- --runInBand`: 101 suites / 2805 tests passed.
- `node_modules\.bin\firebase.cmd emulators:exec --only firestore --project demo-rules-test "node_modules\.bin\jest.cmd --runInBand --testTimeout=30000 --runTestsByPath tests/firestore.rules.test.js tests/firestore-rules-extended.test.js tests/team-split-rules.test.js tests/firestore-rules/team-feed-rules.test.js tests/firestore-rules/tournament-member-rules.test.js"`: 5 suites / 518 tests passed.
- Post-version-bump targeted tests passed: scoreboard translation helpers, normalizer, admin render, config utils, and script dependency tests.
- `git diff --check` has no whitespace errors; only repository line-ending warnings were reported.

## Deployment Plan

1. Run unit tests for scoreboard translation, normalizer, config/admin rendering.
2. Run Firestore rules tests for translation collection access.
3. Deploy Firebase Functions and Firestore rules.
4. Push static frontend changes to `main` for Cloudflare/GitHub Pages static deployment.
5. Verify no unrelated dirty files are staged or committed.
