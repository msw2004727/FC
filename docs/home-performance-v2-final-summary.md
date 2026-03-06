# Home Performance Slimming V2 — Final Summary

Date: 2026-03-06
Project: SportHub

## Goal

Reduce homepage boot cost without breaking:

- homepage first paint
- deep link entry
- first route visit
- guarded/auth-required pages
- existing no-build `Object.assign(App, ...)` architecture

## Implemented Scope

### Step 1
- froze the real startup chain and dependency baseline
- identified eager bootstrap dependencies and loader mapping gaps

### Step 2
- established unified `page -> script -> data -> render` route gateway
- connected `showPage()` to awaited page/script/data readiness

### Step 3
- moved event/team detail entry to safe async gateway flow
- protected deep link cold start and fallback behavior

### Step 4
- slimmed homepage eager route modules in `index.html`
- restored shared runtime helpers that could not yet be made lazy

### Step 5A
- deferred Firebase / LIFF boot behind `ensureCloudReady()`
- removed homepage Firebase / LIFF preload behavior

### Step 5B
- split homepage rendering into:
  - global shell
  - critical home render
  - deferred home render
- delayed banner autoplay and popup startup

### Step 6
- completed structural validation
- fixed cold-first-visit gaps for:
  - `page-shop-detail`
  - `page-tournament-detail`
- produced final validation report

## Key Outcomes

### Homepage Boot
- homepage no longer tries to eagerly execute all non-home route logic
- critical content can render first, deferred content follows later
- banner autoplay no longer starts in the first critical render pass
- popup ads no longer start from a global boot timeout

### Route Stability
- first visit to lazy routes now follows a consistent readiness pipeline
- event/team detail entry is protected during cold start
- shop/tournament detail no longer depend on parent fragment already being loaded

### Cloud Initialization
- `ensureCloudReady()` is the single cloud boot gateway
- homepage can appear before Firebase / LIFF fully finish
- guarded pages and deep links can still demand cloud readiness safely

### UX Feedback
- cold first route transitions now have a non-blocking status hint
- auth wording is only shown for true auth-pending states
- status hint position is aligned with existing toast behavior

## Files To Keep

- `docs/home-performance-slimming-spec.md`
  - final V2 implementation spec
- `docs/home-performance-step6-validation.md`
  - final validation report
- `docs/home-performance-v2-final-summary.md`
  - final outcome summary

## Files Removed

- `docs/home-performance-slimming-step1-baseline.md`
  - temporary Step 1 construction baseline
  - superseded by the final V2 spec plus the Step 6 validation report

## Remaining Known Limits

- no browser automation exists in this repo
- no local `node_modules` were present during Step 6, so Firestore emulator/rules tests were not runnable in this validation pass
- some routes still intentionally rely on eager bootstrap modules because shared runtime helpers have not yet been fully extracted

## Recommended Future Direction

If future work continues, the next clean targets are:

1. extract shared runtime helpers from page-owned modules
2. add browser-level smoke automation
3. consider route-level warm prefetch for the highest-traffic first-click pages
