# Swipe Tab Smooth Transition Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the binary tab swipe (instant re-render) with a smooth follow-finger + slide exit/entry animation, similar to the ad banner carousel.

**Architecture:** Rewrite `_bindSwipeTabs()` in `app.js` to translate the content container following the user's finger during touchmove, then animate a slide-out/slide-in transition on touchend. No caller changes needed — the function signature stays the same. Add `overflow-x: hidden` clipping to prevent visual overflow during swipe.

**Tech Stack:** Vanilla JS (touch events + CSS transform/transition), no dependencies.

---

## Current State Analysis

### How it works now (`app.js:288-337`)
- `_bindSwipeTabs(contentId, tabsId, onSwitch, getKey)` — reusable function
- touchstart: records startX/startY
- touchmove: detects horizontal vs vertical, sets `swiping` flag, **no visual feedback**
- touchend: if dx >= 40px, calls `onSwitch` immediately — content re-renders instantly
- Uses `{ passive: true }` on all handlers (cannot `preventDefault`)

### How banner does it (`banner.js:70-150`)
- touchstart: disables CSS `transition`, records start position
- touchmove: `{ passive: false }` + `preventDefault()`, translates track with `transform: translateX()` following finger, edge damping (ratio *= 0.3)
- touchend: restores transition, velocity + distance threshold check, snaps to target

### Three call sites (all use identical pattern)
| Caller | Content ID | Tabs ID | Tabs Count |
|--------|-----------|---------|------------|
| `event-list.js:1158` | `activity-list` | `activity-tabs` | 2 (normal/ended) |
| `event-manage.js:395` | `my-activity-list` | `my-activity-tabs` | 6 (all/upcoming/open/full/ended/cancelled) |
| `news.js:39` | `news-card-list` | `news-tabs` | dynamic (sport tags) |

### Key constraint
Content is rendered dynamically into the container via `innerHTML =`. The render functions (`renderActivityList`, `renderMyActivities`, `_renderNewsCards`) replace container children but don't touch the container element itself. Event listeners on the container survive re-renders. The `dataset.swipeBound` guard prevents double-binding.

---

## Design: Transform-on-Content with Exit/Entry Animation

### Why not two-pane (like banner)?
Banner has all slides pre-rendered as sibling `<div>`s in a track. Tab content is dynamically rendered into a single container. Pre-rendering adjacent tab content would require calling render functions that have side effects (state changes, DOM mutations). Too risky.

### Chosen approach
1. **During swipe (touchmove):** Translate the content container itself with `transform: translateX()`, following the finger. Add subtle opacity reduction.
2. **On release — switch (touchend, threshold met):** Animate slide-out → call `onSwitch` (re-renders content) → animate slide-in from opposite direction.
3. **On release — cancel (touchend, threshold not met):** Animate bounce-back to position 0.
4. **Edge damping:** At first/last tab, reduce drag ratio (like banner's `ratio *= 0.3`).

### Visual flow
```
Finger drags left on "一般" tab:
  [content follows finger ←, opacity fades slightly]

Finger releases (threshold met):
  [content slides out to left (-100%), opacity → 0]   200ms
  [onSwitch('ended') → re-renders container]
  [content appears from right (+30%), slides to center (0), opacity 1→1]   200ms

Finger releases (threshold NOT met):
  [content bounces back to center (0), opacity → 1]   250ms
```

---

## File Map

| File | Action | What Changes |
|------|--------|-------------|
| `app.js:288-337` | Modify | Rewrite `_bindSwipeTabs` with transform follow + exit/entry animation |
| `css/base.css:123` | Modify | Add `overflow-x: hidden` to `.page` to clip content during swipe |
| `js/config.js:252` | Modify | Bump `CACHE_VERSION` |
| `index.html` | Modify | Update all `?v=` params |
| `docs/claude-memory.md` | Modify | Add fix log entry |

**No changes needed in callers** (event-list.js, event-manage.js, news.js) — the API is unchanged.

---

## Chunk 1: Implementation

### Task 1: Add overflow-x clipping to `.page`

**Files:**
- Modify: `css/base.css:123`

- [ ] **Step 1: Add overflow-x: hidden to .page rule**

Current (line 123):
```css
.page { display: none; animation: fadeIn .3s ease; }
```

Change to:
```css
.page { display: none; animation: fadeIn .3s ease; overflow-x: hidden; }
```

This prevents the translated content from being visible outside the page bounds during swipe.

- [ ] **Step 2: Verify no layout breakage**

Open the app in browser, navigate between pages (home, activities, teams, profile). Confirm no horizontal scrollbars appear and no content is clipped unexpectedly. The `overflow-x: hidden` only affects the x-axis; vertical scroll is unaffected.

---

### Task 2: Rewrite `_bindSwipeTabs` with smooth transition

**Files:**
- Modify: `app.js:288-337`

- [ ] **Step 1: Replace the `_bindSwipeTabs` function**

Replace lines 288-337 of `app.js` with the new implementation:

```javascript
_bindSwipeTabs(contentId, tabsId, onSwitch, getKey) {
  const content = document.getElementById(contentId);
  if (!content || content.dataset.swipeBound) return;
  content.dataset.swipeBound = '1';

  let startX = 0, startY = 0, startTime = 0;
  let swiping = false, locked = false, animating = false;
  let contentW = 0;

  content.addEventListener('touchstart', function (e) {
    if (animating) return;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
    startTime = Date.now();
    swiping = false;
    locked = false;
    contentW = content.offsetWidth;
    content.style.transition = 'none';
    content.style.willChange = 'transform, opacity';
  }, { passive: true });

  content.addEventListener('touchmove', function (e) {
    if (locked || animating) return;
    var dx = e.touches[0].clientX - startX;
    var dy = e.touches[0].clientY - startY;

    if (!swiping) {
      if (Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 10) { locked = true; return; }
      if (Math.abs(dx) > 10) { swiping = true; } else { return; }
    }

    e.preventDefault();

    var tabs = document.getElementById(tabsId);
    if (!tabs) return;
    var buttons = Array.from(tabs.querySelectorAll('button'));
    var activeIdx = buttons.findIndex(function (b) { return b.classList.contains('active'); });

    var ratio = dx / (contentW || 1);

    // Edge damping: first tab swiping right, or last tab swiping left
    if ((activeIdx <= 0 && dx > 0) || (activeIdx >= buttons.length - 1 && dx < 0)) {
      ratio *= 0.3;
    }

    content.style.transform = 'translateX(' + (ratio * 100) + '%)';
    content.style.opacity = String(Math.max(1 - Math.abs(ratio) * 0.4, 0.5));
  }, { passive: false });

  content.addEventListener('touchend', function (e) {
    content.style.willChange = '';

    if (!swiping || locked || animating) {
      content.style.transition = '';
      content.style.transform = '';
      content.style.opacity = '';
      return;
    }

    var dx = e.changedTouches[0].clientX - startX;
    var elapsed = Date.now() - startTime;
    var velocity = Math.abs(dx) / (elapsed || 1);

    var tabs = document.getElementById(tabsId);
    if (!tabs) { _reset(); return; }
    var buttons = Array.from(tabs.querySelectorAll('button'));
    if (buttons.length < 2) { _reset(); return; }

    var activeIdx = buttons.findIndex(function (b) { return b.classList.contains('active'); });
    if (activeIdx < 0) { _reset(); return; }

    // Threshold: 40px distance OR velocity > 0.3 px/ms with at least 20px
    var shouldSwitch = Math.abs(dx) >= 40 || (Math.abs(dx) >= 20 && velocity > 0.3);
    var nextIdx = dx < 0
      ? Math.min(activeIdx + 1, buttons.length - 1)
      : Math.max(activeIdx - 1, 0);

    if (!shouldSwitch || nextIdx === activeIdx) {
      // Bounce back
      content.style.transition = 'transform .25s cubic-bezier(.2,.9,.3,1), opacity .25s ease';
      content.style.transform = 'translateX(0)';
      content.style.opacity = '1';
      _onTransitionEnd(function () { _reset(); });
      return;
    }

    // Slide out
    animating = true;
    var exitDir = dx < 0 ? '-100%' : '100%';
    var enterFrom = dx < 0 ? '40%' : '-40%';

    content.style.transition = 'transform .2s cubic-bezier(.4,0,1,1), opacity .18s ease';
    content.style.transform = 'translateX(' + exitDir + ')';
    content.style.opacity = '0';

    _onTransitionEnd(function () {
      // Switch tab content (this re-renders the container)
      var key = getKey(buttons[nextIdx]);
      if (key != null) {
        // Position off-screen on entry side (no transition yet)
        content.style.transition = 'none';
        content.style.transform = 'translateX(' + enterFrom + ')';
        content.style.opacity = '0';

        onSwitch.call(App, key);

        // Force layout reflow before enabling transition
        void content.offsetWidth;

        // Slide in
        content.style.transition = 'transform .25s cubic-bezier(.0,0,.2,1), opacity .2s ease';
        content.style.transform = 'translateX(0)';
        content.style.opacity = '1';

        _onTransitionEnd(function () {
          _reset();
          animating = false;
        });

        buttons[nextIdx].scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
      } else {
        _reset();
        animating = false;
      }
    });
  }, { passive: true });

  function _reset() {
    content.style.transition = '';
    content.style.transform = '';
    content.style.opacity = '';
    content.style.willChange = '';
  }

  function _onTransitionEnd(cb) {
    var called = false;
    function handler() {
      if (called) return;
      called = true;
      content.removeEventListener('transitionend', handler);
      clearTimeout(fallback);
      cb();
    }
    content.addEventListener('transitionend', handler);
    // Fallback timeout in case transitionend doesn't fire
    var fallback = setTimeout(handler, 350);
  }
},
```

Key differences from the old implementation:
- **touchstart:** Disables transition, sets `will-change` for GPU acceleration
- **touchmove:** `{ passive: false }` to `preventDefault()`, translates content following finger, edge damping at boundaries, opacity fade proportional to drag distance
- **touchend:** Velocity detection (same as banner), slide-out animation → `onSwitch` re-render → slide-in animation. Bounce-back if threshold not met.
- **Safety:** `animating` flag prevents interaction during animation; `_onTransitionEnd` has 350ms fallback timer in case `transitionend` doesn't fire (LINE WebView edge case)

- [ ] **Step 2: Verify activity page (2 tabs)**

1. Open activities page
2. Swipe left on the event list — content should follow finger, then slide out left, new "已結束" tab content slides in from right
3. Swipe right — reverse animation back to "一般"
4. Quick flick (fast, short distance) — should still trigger switch (velocity threshold)
5. Short drag (< 40px) and release — content should bounce back
6. Swipe right on first tab — edge damping (heavy resistance), no switch
7. Swipe left on last tab — edge damping, no switch
8. Tap on event cards — should still navigate to detail (no interference)
9. Vertical scroll — should work normally (direction lock)

- [ ] **Step 3: Verify activity management page (6 tabs)**

1. Open activity management page (coach+ role)
2. Swipe through all 6 tabs: 全部 → 即將開放 → 報名中 → 已額滿 → 已結束 → 已取消
3. Swipe back through all tabs
4. Confirm edge damping on first and last tab
5. Confirm tab bar auto-scrolls to show active tab

- [ ] **Step 4: Verify news section (dynamic tabs)**

1. Scroll to news section on home page
2. Swipe between sport tag tabs
3. Confirm same smooth behavior

---

### Task 3: Version bump and deploy

**Files:**
- Modify: `js/config.js:252`
- Modify: `index.html` (all `?v=` params)
- Modify: `docs/claude-memory.md`

- [ ] **Step 1: Update CACHE_VERSION**

In `js/config.js`, change:
```javascript
const CACHE_VERSION = '20260316zt';
```
to:
```javascript
const CACHE_VERSION = '20260316zu';
```

- [ ] **Step 2: Update index.html version params**

Replace all `?v=20260316zt` with `?v=20260316zu` in `index.html`.

- [ ] **Step 3: Add claude-memory.md entry**

Add entry for the swipe tab smooth transition feature.

- [ ] **Step 4: Commit and push**

```bash
git add app.js css/base.css js/config.js index.html docs/claude-memory.md
git commit -m "feat: 活動頁籤滑動改為跟手滑動 + 滑出滑入動畫（類似 banner 體驗）"
git push origin main
```

---

## Rollback Plan

If the smooth swipe causes issues (jank, missed taps, broken scroll):

```bash
git revert HEAD
git push origin main
```

The change is entirely contained in `_bindSwipeTabs` (app.js) + one CSS property. No caller changes means a clean revert restores the old binary behavior.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `transitionend` not firing in LINE WebView | Medium | High (stuck state) | 350ms fallback timer in `_onTransitionEnd` |
| Vertical scroll interference | Low | Medium | Direction lock unchanged (same as before) |
| `passive: false` on touchmove reduces scroll perf | Low | Low | Only active during horizontal swipe; vertical scroll releases immediately |
| Rapid swipe during animation | Medium | Medium | `animating` flag blocks input during transition |
| Content taller than viewport — slide looks odd | Low | Low | `overflow-x: hidden` on `.page` clips horizontal overflow |
