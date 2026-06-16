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
- GitHub deploy service account currently has datastore roles only; `roles/serviceusage.serviceUsageConsumer` is missing.
- Production currently has 84 `gcfv2` Node.js 22 functions in `asia-east1`, so real deploys have broad impact.
- `firebase-functions` patch update `7.1.0 -> 7.2.5` is recommended before real deploy.

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

- Update `actions/checkout` and `actions/setup-node` after H1 is proven.
- Remove `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` only in the same small action-runtime commit.
- Manually dispatch `dry_run=true` again.

### H3: Fix Deploy Readiness

- Add the missing IAM role to the deploy service account.
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
