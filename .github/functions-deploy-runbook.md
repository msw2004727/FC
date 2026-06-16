# Cloud Functions Deploy Runbook

Updated: 2026-06-16

## Scope

- Workflow: `.github/workflows/deploy-functions.yml`
- Project: `fc-football-6c8dc`
- Runtime: Node.js 22 / Cloud Functions v2
- Region: `asia-east1`
- Do not enable push auto-deploy unless explicitly requested.

## Current Safety Gates

- Push-triggered Cloud Functions deploys run only when the repo variable `ENABLE_FUNCTIONS_AUTO_DEPLOY` is `true`.
- `ENABLE_FUNCTIONS_AUTO_DEPLOY` is currently unset, so push-triggered deploy jobs are expected to be skipped.
- Manual `workflow_dispatch` should default to dry-run validation.

## Readiness Findings

- Local `node --check functions/index.js` passed.
- Local `npm run check:registration-ops` passed.
- Local `npm run test:functions` passed.
- Local Firebase Functions dry-run passed.
- GitHub secret `GCP_SERVICE_ACCOUNT_JSON` exists.
- GitHub dry-run passed on run `27630483024` with `dry_run=true`.
- GitHub dry-run passed again on run `27631535325` after updating `actions/checkout` and `actions/setup-node` to v6 and removing `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`.
- GitHub deploy service account currently has these project-level roles:
  - `roles/datastore.owner`
  - `roles/datastore.user`
  - `roles/firebase.viewer`
  - `roles/serviceusage.serviceUsageConsumer`
- GitHub deploy service account has `roles/iam.serviceAccountUser` only on `fc-football-6c8dc@appspot.gserviceaccount.com`.
- GitHub deploy service account has `roles/secretmanager.viewer` only on Functions-used secrets:
  - `LINE_CHANNEL_ACCESS_TOKEN`
  - `NEWS_API_KEY`
  - `GOOGLE_MAPS_BROWSER_API_KEY`
  - `SPORTSAPI_PRO_API_KEY`
- Production currently has 84 `gcfv2` Node.js 22 functions in `asia-east1`, so real deploys have broad impact.
- `firebase-functions` patch update `7.1.0 -> 7.2.5` is recommended before real deploy.
- No real Cloud Functions deploy has been run from this workflow cleanup.

## Stop Conditions

- Any local test failure.
- GitHub dry-run attempts a real deploy.
- GitHub dry-run fails because of IAM or service enablement gaps.
- Firebase reports an unexpected function deletion or large diff.
- Any request to enable push auto-deploy without explicit final confirmation.

## Phase Plan

### H1: Add Dry-Run Dispatch

- Add a `workflow_dispatch` `dry_run` input.
- Default manual dispatches to `dry_run=true`.
- Keep existing action versions and deploy command path otherwise unchanged.
- Commit, push, verify push-triggered deploy remains skipped, then manually dispatch dry-run.

### H2: Update GitHub Actions Runtime

- Completed in commit `84936752`.
- `actions/checkout` and `actions/setup-node` are on v6.
- `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` has been removed.
- Manual dispatch `dry_run=true` passed on run `27631535325`.

### H3: Fix Deploy Readiness

- Add IAM roles only when a dry-run log proves the exact missing permission.
- Keep `roles/iam.serviceAccountUser` scoped to the runtime service account, not project-wide.
- Keep Secret Manager grants scoped to the Functions-used secrets, not project-wide.
- Consider patch-level dependency updates separately from workflow edits.
- Re-run local tests and GitHub dry-run after each change.

### H4: Manual Real Deploy

- Run only after explicit confirmation.
- Dispatch with `dry_run=false`.
- Observe Functions/Cloud Run logs for at least 5 minutes after deploy.

## Rollback

- Revert workflow-only commits for workflow mistakes.
- Do not use `git reset --hard`.
- If a real deploy fails, inspect Firebase, Cloud Functions, and Cloud Run logs before any deletion or cleanup.
