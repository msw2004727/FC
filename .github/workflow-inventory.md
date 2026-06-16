# GitHub Actions Workflow Inventory

Created: 2026-06-16

Purpose: Phase A inventory for the Node 24 / workflow cleanup plan. This file is documentation only and does not change workflow behavior.

## Baseline

- No workflow currently declares `node-version: '20'`.
- `deploy-functions.yml` intentionally remains on `node-version: '22'` because it is tied to Cloud Functions deployment behavior.
- Node 20 deprecation annotations observed in CI are from action runtime compatibility, not from project `node-version` fields.
- Several workflows use `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true`; this must be reviewed per workflow before removing it.
- Some existing workflow comments and log messages show mojibake. Phase A records this but does not rewrite workflow files.

## Inventory

| Workflow | Trigger | Runtime / actions | Env / secrets | Permissions | Writes repo | External effect | Risk | Next phase |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `test.yml` | `push` main, `pull_request` main | Node 24; `checkout@v4`, `setup-node@v4`, `upload-artifact@v4`, `setup-java@v4`, `cache@v4` | `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` | implicit default | No | CI gate only | Medium | Phase B |
| `build-sitemap.yml` | daily schedule, `workflow_dispatch` | Node 24; `checkout@v4`, `setup-node@v4` | `GCP_SERVICE_ACCOUNT_JSON`; no FORCE env | `contents: write` | Yes: sitemap child files to `main` | Firestore read, sitemap generation | Medium | Phase C |
| `inject-hot-events.yml` | hourly schedule, `workflow_dispatch` | Node 24; `checkout@v4`, `setup-node@v4` | `GCP_SERVICE_ACCOUNT_JSON`; no FORCE env | `contents: write` | Yes: `index.html` to `main` | Firestore read, static HTML inline data | Medium | Phase C |
| `ci-usage-snapshot.yml` | daily schedule, `workflow_dispatch` | Node 24; `checkout@v4`, `setup-node@v4` | `GITHUB_TOKEN`, `GCP_SERVICE_ACCOUNT_JSON`; no FORCE env | `actions: read`, `contents: read` | No | GitHub Actions API read, Firestore write | Medium | Phase D |
| `gsc-snapshot.yml` | `workflow_dispatch`, scheduled, path-limited push | Node 24; `checkout@v4`, `setup-node@v4` | `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`, `GCP_SERVICE_ACCOUNT_JSON` | implicit default | No | Google Search Console read, Firestore write | Medium | Phase D |
| `submit-sitemap.yml` | path-limited push | Node 24; `checkout@v4`, `setup-node@v4` | `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`, `GCP_SERVICE_ACCOUNT_JSON` | implicit default | No | Google Search Console submit | Medium | Phase D |
| `sync-changelog.yml` | all pushes to main | Node 24; `checkout@v4`, `setup-node@v4` | `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`, `GCP_SERVICE_ACCOUNT_JSON` | implicit default | No | Firestore write | Medium | Phase D |
| `verify-gsc-read.yml` | `workflow_dispatch` only | Node 24; `checkout@v4`, `setup-node@v4` | `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`, `GCP_SERVICE_ACCOUNT_JSON` | implicit default | No | Google Search Console permission check | Medium | Phase D |
| `lighthouse.yml` | weekly schedule, `workflow_dispatch` | `checkout@v4`, `treosh/lighthouse-ci-action@v12` | `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` | implicit default | No | Lighthouse against production URLs; temporary public storage | Medium | Phase D |
| `deploy-functions.yml` | path-limited push, `workflow_dispatch` | Node 22; `checkout@v4`, `setup-node@v4`, Firebase CLI via `npx` | `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true`, `GCP_SERVICE_ACCOUNT_JSON`, Firebase/GCP project env | `contents: read` | No | Cloud Functions deploy | High | Excluded from medium-risk implementation |

## Status After Phase B/C/D

Updated: 2026-06-16

Phase B/C/D medium-risk cleanup has been implemented and verified in small commits. The inventory table above remains the original Phase A baseline for audit history.

Completed:

- `test.yml`: official actions updated to `checkout@v6`, `setup-node@v6`, `upload-artifact@v7`, `setup-java@v5`, `cache@v5`; `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` removed.
- `build-sitemap.yml`: dry-run dispatch added; official actions updated to `checkout@v6`, `setup-node@v6`; dry-run verified.
- `inject-hot-events.yml`: dry-run dispatch added; official actions updated to `checkout@v6`, `setup-node@v6`; dry-run verified.
- `gsc-snapshot.yml` and `verify-gsc-read.yml`: hard-fail missing-secret policy preserved; log messages cleaned; official actions updated to `checkout@v6`, `setup-node@v6`; GSC snapshot verified.
- `submit-sitemap.yml` and `sync-changelog.yml`: soft-skip missing-secret policy preserved; log messages cleaned; official actions updated to `checkout@v6`, `setup-node@v6`; sync workflow verified.
- `ci-usage-snapshot.yml`: official actions updated to `checkout@v6`, `setup-node@v6`; manual dispatch verified.
- `lighthouse.yml`: `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` removed; `checkout@v6` used; `treosh/lighthouse-ci-action@v12` kept because its current action metadata runs on `node24`; manual dispatch verified.

Remaining:

- `deploy-functions.yml` is still intentionally excluded. It remains on `checkout@v4`, `setup-node@v4`, and `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true` because it deploys Cloud Functions and should be handled as a separate high-risk change.

## Findings For Later Phases

1. `test.yml` is the first medium-risk implementation target because it is the main CI gate and does not write to external services.
2. `build-sitemap.yml` and `inject-hot-events.yml` write back to `main`. Phase C must add dry-run or staging validation before any behavior change is tested against `main`.
3. `gsc-snapshot.yml` and `verify-gsc-read.yml` currently show broken-looking mojibake `echo` lines with no visible closing quote in the missing-secret branch. Phase D should fix those scripts and verify shell parsing.
4. GSC / Firestore workflows do not use a consistent missing-secret policy:
   - `gsc-snapshot.yml` and `verify-gsc-read.yml`: hard fail when the secret is missing.
   - `submit-sitemap.yml` and `sync-changelog.yml`: soft skip when the secret is missing.
   - `ci-usage-snapshot.yml`: `continue-on-error: true`.
5. `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` exists in `test.yml`, GSC/GSC-adjacent workflows, `lighthouse.yml`, and `deploy-functions.yml`, but not in `build-sitemap.yml`, `inject-hot-events.yml`, or `ci-usage-snapshot.yml`.
6. `lighthouse.yml` uses a third-party action and production URLs. Treat action/runtime changes there as observable but not deployment-blocking.
7. `deploy-functions.yml` remains high risk. Do not include it in Phase B/C/D implementation commits.

## Phase Boundaries

### Phase B

Scope: `test.yml` only.

Allowed changes:

- Review official action runtime support.
- Adjust official action versions only if the target version is stable and compatible.
- Decide whether `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` should stay in `test.yml`.

Not allowed:

- Changing test commands.
- Removing any of the three CI jobs.
- Touching deploy or GCP workflows.

### Phase C

Scope: `build-sitemap.yml`, `inject-hot-events.yml`.

Required safety before live main writes:

- Add a dry-run or staging validation path.
- Confirm no-change behavior.
- Confirm commit file scope and commit message.
- Confirm pull-rebase and push retry behavior.

### Phase D

Scope: `ci-usage-snapshot.yml`, `gsc-snapshot.yml`, `submit-sitemap.yml`, `sync-changelog.yml`, `verify-gsc-read.yml`, `lighthouse.yml`.

Required safety:

- Normalize missing-secret behavior per workflow purpose.
- Fix mojibake log lines that affect shell parsing.
- Keep external writes narrow.
- Validate with workflow-specific dry-run or manual dispatch where safe.

## Verification For This Phase

Phase A is verified when:

- This inventory is committed separately.
- `git diff --check` passes.
- Local unit tests pass.
- Remote Test Suite passes after push.
