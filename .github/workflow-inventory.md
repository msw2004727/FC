# GitHub Actions Workflow Inventory

Verified: 2026-07-17

This document describes the workflows that currently exist under
`.github/workflows/`. The workflow YAML files are the source of truth; update
this inventory in the same change whenever a trigger, permission, runtime,
secret policy, repository write, or external side effect changes.

## Current Inventory

| Workflow | Trigger | Runtime | Repository / external effect | Safety behavior |
| --- | --- | --- | --- | --- |
| `test.yml` | Push and pull request to `main` | Node 24; Java 21 for Rules tests | Read-only CI; uploads the unit coverage summary artifact | Runs registration guard, unit tests, coverage, Firestore Rules tests, and Chromium desktop E2E smoke tests |
| `build-sitemap.yml` | Daily at `03:17 UTC`; manual dispatch | Node 24 | Reads Firestore; may commit and push `sitemap-events.xml`, `sitemap-teams.xml`, and `sitemap-tournaments.xml` | Manual `dry_run` reports only; generation is best-effort; push retries transient remote failures |
| `inject-hot-events.yml` | Hourly at minute `17`; manual dispatch | Node 24 | Reads Firestore; may commit and push the generated home summary in `index.html` | Manual `dry_run` reports only; generation is best-effort; push retries transient remote failures |
| `ci-usage-snapshot.yml` | Daily at `06:00 UTC`; manual dispatch | Node 24 | Reads GitHub Actions usage and writes a Firestore snapshot | Snapshot step is best-effort (`continue-on-error`) |
| `gsc-snapshot.yml` | Daily at `03:00 UTC`; manual dispatch; selected SEO/admin file pushes | Node 24 | Reads Google Search Console and writes Firestore `seoSnapshots` | Missing `GCP_SERVICE_ACCOUNT_JSON` is a hard failure |
| `submit-sitemap.yml` | Pushes that change sitemap, SEO, blog, role, home, privacy, or terms paths | Node 24 | Submits the sitemap to Google Search Console | Missing `GCP_SERVICE_ACCOUNT_JSON` causes a soft skip |
| `sync-changelog.yml` | Every push to `main` | Node 24 | Reads Git history and writes the current-month changelog to Firestore | Missing `GCP_SERVICE_ACCOUNT_JSON` causes a soft skip |
| `verify-gsc-read.yml` | Manual dispatch | Node 24 | Verifies Google Search Console read access | Missing `GCP_SERVICE_ACCOUNT_JSON` is a hard failure |
| `lighthouse.yml` | Weekly on Monday at `02:00 UTC`; manual dispatch | Lighthouse action runtime | Audits production URLs and uploads reports to temporary public storage | Observation only; no performance assertions or deployment gate |
| `deploy-functions.yml` | Selected Functions-related pushes; manual dispatch | Node 22 | Can deploy Firebase Cloud Functions to `fc-football-6c8dc` | Push deployment requires `ENABLE_FUNCTIONS_AUTO_DEPLOY=true`; manual dispatch defaults to dry-run |

## Runtime and Action Baseline

- General automation and tests use Node 24.
- Cloud Functions deployment intentionally uses Node 22 to match the Functions
  runtime contract.
- Official actions currently use:
  - `actions/checkout@v6`
  - `actions/setup-node@v6`
  - `actions/setup-java@v5`
  - `actions/cache@v5`
  - `actions/upload-artifact@v7`
- `lighthouse.yml` uses `treosh/lighthouse-ci-action@v12`.
- Do not reintroduce `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24`; the current official
  action versions no longer require that override.

## Write and Deployment Boundaries

### Workflows that can push to `main`

- `build-sitemap.yml` — only the three dynamic sitemap child files.
- `inject-hot-events.yml` — only `index.html`.

Both workflows provide manual dry-run paths and perform a pull/rebase before
their final push. Any expansion of their staged file lists is a behavior change
and requires separate review.

### Workflows that write external data

- Firestore: `ci-usage-snapshot.yml`, `gsc-snapshot.yml`,
  `sync-changelog.yml`.
- Google Search Console: `submit-sitemap.yml`; read-only verification in
  `verify-gsc-read.yml`.
- Production URL reporting: `lighthouse.yml`.

The workflows intentionally use different missing-secret policies:

- Hard failure: GSC snapshot and GSC permission verification.
- Soft skip: sitemap submission and changelog sync.
- Best effort: CI usage snapshot.

Do not normalize these policies without first confirming the operational intent
of each workflow.

### Cloud Functions deployment gate

`deploy-functions.yml` is the only workflow in this directory that deploys
backend runtime code.

- A push-triggered job deploys only when the repository variable
  `ENABLE_FUNCTIONS_AUTO_DEPLOY` equals `true`.
- A manually dispatched run defaults to `dry_run: true`.
- Before deployment it installs root and Functions dependencies, runs
  `check:registration-ops`, and runs `test:functions`.
- Deployment authentication requires `GCP_SERVICE_ACCOUNT_JSON`.
- Operational prerequisites and IAM details live in
  `.github/functions-deploy-runbook.md`.

## Broad Trigger Notes

- A documentation-only push still triggers `test.yml` and
  `sync-changelog.yml`, because both listen broadly to pushes on `main`.
- `deploy-functions.yml` is path-filtered; ordinary documentation changes do
  not enter its push trigger.
- Website hosting deployment is not defined by these workflow files. Do not
  infer website deployment status from this inventory alone.

## Live Verification

Use the workflow files rather than hard-coded counts:

```bash
rg --files .github/workflows -g '*.yml'
rg -n "node-version|uses:|cron:|workflow_dispatch|permissions:" .github/workflows
rg -n "ENABLE_FUNCTIONS_AUTO_DEPLOY|GCP_SERVICE_ACCOUNT_JSON|git push|firebase deploy" .github/workflows
```

For a workflow behavior change, also inspect its complete YAML and verify the
specific manual dry-run path where one exists.
