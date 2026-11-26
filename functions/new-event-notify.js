"use strict";
const config = require("./web-push-config");
const core = require("./new-event-notify-core");
const { taipeiDayKey } = require("./notification-fields");

const LOG_PENDING = "[newEventPending]";
const LOG_RUN = "[newEventDispatch] run";
const LOG_EXPANDED = "[newEventDispatch] expanded";
const LOG_ERROR = "[newEventDispatch] error";

const NEW_EVENT_TRIGGER_OPTIONS = Object.freeze({
  document: "events/{eventId}", region: "asia-east1", minInstances: 0, maxInstances: 3,
  timeoutSeconds: 30, memory: "256MiB", retry: false,
});
// 逾時（顧問 §3.803 Q6 條件）：開始 200 秒後不開新展開（RUN_TIME_BUDGET_MS），但第 200 秒前剛開始的那一次展開仍要做完。
// 單次展開最壞＝用戶查詢 1 次＋訂閱查詢 ceil(500/30)=17 次（逐組）＋記號讀≤22＋500 筆 create（allSettled 並行）＋記號寫≤22，
// 以每次讀寫往返 ≤1 秒保守估約 60～80 秒；200＋80＝280 秒，再留一倍以上餘裕設 540 秒。只按實際執行時間計費，多設不增加費用。
// 沒處理完的待處理文件不刪，下一次排程依活動開始時間由近到遠接著處理（eligible.sort）。
const NEW_EVENT_DISPATCH_OPTIONS = Object.freeze({
  region: "asia-east1", schedule: "*/15 * * * *", timeZone: "Asia/Taipei",
  memory: "512MiB", timeoutSeconds: 540, minInstances: 0, maxInstances: 1, retryCount: 0,
});

const isAlreadyExists = (error) => error?.code === 6 || error?.code === "already-exists";

function safeErrorCode(error) {
  const code = error && error.code;
  if (typeof code === "number" && Number.isFinite(code)) return String(code);
  if (typeof code === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(code)) return code;
  return "unknown";
}

function createQueueNewEventNoticeHandler({ db, FieldValue, logger, now = () => Date.now() }) {
  async function queueNewEventNotice(event) {
    try {
      const snap = event?.data;
      const eventId = String(event?.params?.eventId || "");
      const data = snap && typeof snap.data === "function" ? (snap.data() || {}) : {};
      const reason = core.createTimeReason(data, eventId);
      if (reason) {
        logger.info(LOG_PENDING, { outcome: "skipped", reason, sportTag: "" });
        return;
      }
      await db.collection(core.NEW_EVENT_PENDING_COLLECTION).doc(eventId).create({
        eventId,
        createdAt: FieldValue.serverTimestamp(),
        expireAt: new Date(now() + core.NEW_EVENT_PENDING_RETENTION_MS),
      });
      logger.info(LOG_PENDING, { outcome: "queued", reason: "", sportTag: data.sportTag });
    } catch (error) {
      if (isAlreadyExists(error)) {
        logger.info(LOG_PENDING, { outcome: "deduped", reason: "", sportTag: "" });
        return;
      }
      logger.error(LOG_ERROR, { stage: "pending_create", code: safeErrorCode(error) });
    }
  }
  return queueNewEventNotice;
}

function createDispatchNewEventNoticesHandler({ db, FieldValue, logger, now = () => Date.now(), settings = config }) {
  async function dispatchNewEventNotices(_event) {
    const nowMs = now();
    const dayKey = taipeiDayKey(nowMs);
    const t0 = nowMs;
    const stats = {
      pendingRead: 0,
      ready: 0,
      young: 0,
      tooOld: 0,
      ineligible: {},
      allMarked: 0,
      creatorLimit: 0,
      expansions: 0,
      deferred: 0,
      queued: 0,
      deduped: 0,
      failed: 0,
    };

    const logRun = (outcome, reason) => {
      logger.info(LOG_RUN, {
        outcome,
        reason: reason || "",
        pendingRead: stats.pendingRead,
        ready: stats.ready,
        young: stats.young,
        tooOld: stats.tooOld,
        ineligible: { ...stats.ineligible },
        allMarked: stats.allMarked,
        creatorLimit: stats.creatorLimit,
        expansions: stats.expansions,
        deferred: stats.deferred,
        queued: stats.queued,
        deduped: stats.deduped,
        failed: stats.failed,
        durationMs: Math.max(0, now() - t0),
      });
    };
    const logError = (stage, error) => logger.error(LOG_ERROR, { stage, code: safeErrorCode(error) });
    const deletePending = async (ref) => {
      try {
        await ref.delete();
      } catch (error) {
        logError("pending_delete", error);
      }
    };
    const logExpanded = (level, fields) => logger[level](LOG_EXPANDED, fields);

    try {
      if (core.isQuietHour(nowMs)) {
        logRun("skipped", "quiet");
        return;
      }

      let enabled = false;
      try {
        const controlSnap = await db.collection(settings.WEB_PUSH_COLLECTIONS.control)
          .doc(settings.WEB_PUSH_CONTROL_DOC_ID).get();
        const controlData = controlSnap.exists ? (controlSnap.data() || {}) : {};
        enabled = settings.WEB_PUSH_SENDER_ENABLED === true
          && controlSnap.exists
          && controlData.sendEnabled === true
          && controlData.newEventEnabled === true;
      } catch (error) {
        logError("control_read", error);
        enabled = false;
      }
      if (!enabled) {
        logRun("skipped", "disabled");
        return;
      }

      let pendingSnap;
      try {
        pendingSnap = await db.collection(core.NEW_EVENT_PENDING_COLLECTION)
          .orderBy("createdAt", "asc").limit(core.PENDING_SCAN_LIMIT).get();
      } catch (error) {
        logError("pending_read", error);
        logRun("failed", "pending_read");
        return;
      }

      const pendingDocs = Array.isArray(pendingSnap.docs) ? pendingSnap.docs : [];
      stats.pendingRead = pendingDocs.length;
      const ready = [];
      for (const doc of pendingDocs) {
        const data = doc.data() || {};
        const createdMs = core.toMillis(data.createdAt);
        if (!Number.isFinite(createdMs)) {
          await deletePending(doc.ref);
          continue;
        }
        if (nowMs - createdMs > core.PENDING_MAX_AGE_MS) {
          await deletePending(doc.ref);
          stats.tooOld += 1;
          continue;
        }
        if (nowMs - createdMs < core.NEW_EVENT_DELAY_MS) {
          stats.young += 1;
          continue;
        }
        ready.push({ ref: doc.ref, id: doc.id, createdMs });
      }
      stats.ready = ready.length;

      const eligible = [];
      for (const item of ready) {
        let eventData = null;
        try {
          const eventSnap = await db.collection("events").doc(item.id).get();
          eventData = eventSnap.exists ? (eventSnap.data() || {}) : null;
        } catch (error) {
          logError("event_read", error);
          continue;
        }
        const reason = core.dispatchTimeReason(eventData, item.id, nowMs);
        if (reason) {
          await deletePending(item.ref);
          stats.ineligible[reason] = (stats.ineligible[reason] || 0) + 1;
          continue;
        }
        const startMs = core.toMillis(eventData.startTimestamp);
        eligible.push({ ...item, ev: eventData, startMs });
      }

      eligible.sort((a, b) => {
        if (a.startMs !== b.startMs) return a.startMs - b.startMs;
        if (a.createdMs !== b.createdMs) return a.createdMs - b.createdMs;
        return a.id.localeCompare(b.id);
      });

      const usersBySport = new Map();
      const hasSubByUid = new Map();
      const markerExists = new Map();

      const writeCreatorCounter = async (counterRef) => {
        try {
          await counterRef.set({
            count: FieldValue.increment(1),
            updatedAt: FieldValue.serverTimestamp(),
            expireAt: new Date(nowMs + settings.WEB_PUSH_DAILY_RETENTION_MS),
          }, { merge: true });
        } catch (error) {
          logError("creator_write", error);
        }
      };

      for (const item of eligible) {
        if (stats.expansions >= core.MAX_EXPANSIONS_PER_RUN || now() - t0 > core.RUN_TIME_BUDGET_MS) {
          stats.deferred += 1;
          continue;
        }

        const ev = item.ev;
        const sportTag = ev.sportTag;
        const cities = core.resolveTargetCities(ev);
        const cityMarkers = cities.map((city) => ({
          city,
          id: core.dailyMarkerIdOf({ dayKey, sportTag, city }),
        }));
        const missingMarkers = cityMarkers.filter((marker) => !markerExists.has(marker.id));
        try {
          const markerSnaps = await Promise.all(missingMarkers.map((marker) => (
            db.collection(core.SPORT_NEW_EVENT_DAILY_COLLECTION).doc(marker.id).get()
          )));
          missingMarkers.forEach((marker, index) => {
            markerExists.set(marker.id, markerSnaps[index].exists);
          });
        } catch (error) {
          logError("marker_read", error);
          continue;
        }
        const remaining = cityMarkers
          .filter((marker) => !markerExists.get(marker.id))
          .map((marker) => marker.city);
        if (remaining.length === 0) {
          await deletePending(item.ref);
          stats.allMarked += 1;
          continue;
        }

        const creatorCounterRef = db.collection(settings.WEB_PUSH_COLLECTIONS.daily)
          .doc(core.creatorCounterIdOf({ dayKey, uid: ev.creatorUid }));
        let creatorSnap;
        try {
          creatorSnap = await creatorCounterRef.get();
        } catch (error) {
          logError("creator_read", error);
          continue;
        }
        const creatorCount = creatorSnap.exists ? Number(creatorSnap.data()?.count) || 0 : 0;
        if (creatorCount >= core.CREATOR_EXPANSIONS_PER_DAY) {
          await deletePending(item.ref);
          stats.creatorLimit += 1;
          continue;
        }

        let users = usersBySport.get(sportTag);
        if (!users) {
          try {
            const usersSnap = await db.collection("users")
              .where("favSports", "array-contains", sportTag)
              .select("favSports", "newEventNotify", "region").get();
            users = usersSnap.docs.map((doc) => {
              const data = doc.data() || {};
              return {
                uid: doc.id,
                region: data.region,
                notify: data.newEventNotify !== false,
              };
            });
            usersBySport.set(sportTag, users);
          } catch (error) {
            logError("users_query", error);
            continue;
          }
        }

        const citySet = new Set(remaining);
        const candidates = users
          .filter((user) => user.notify && user.uid !== ev.creatorUid && core.userMatchesCities(user.region, citySet))
          .map((user) => user.uid);

        const chunks = [];
        for (let i = 0; i < candidates.length; i += core.SUBSCRIPTION_IN_CHUNK) {
          chunks.push(candidates.slice(i, i + core.SUBSCRIPTION_IN_CHUNK));
        }
        // 已湊滿 500 位有訂閱的人就停，不再查後面的組（Opus 審 P3-1：喜好人數多時省讀取與時間）
        let stoppedEarly = false;
        let found = 0;
        try {
          for (let ci = 0; ci < chunks.length; ci += 1) {
            if (found >= core.MAX_RECIPIENTS_PER_EXPANSION) {
              stoppedEarly = true;
              break;
            }
            const chunk = chunks[ci];
            const queryIds = chunk.filter((uid) => !hasSubByUid.has(uid));
            if (queryIds.length === 0) {
              found += chunk.filter((uid) => hasSubByUid.get(uid) === true).length;
              continue;
            }
            const subSnap = await db.collection(settings.WEB_PUSH_COLLECTIONS.subscriptions)
              .where("uid", "in", queryIds)
              .select("uid", "vapidKeyId").get();
            const matched = new Set();
            for (const subDoc of subSnap.docs) {
              const subData = subDoc.data() || {};
              if (subData.vapidKeyId === settings.WEB_PUSH_VAPID_KEY_ID) matched.add(subData.uid);
            }
            for (const uid of queryIds) hasSubByUid.set(uid, matched.has(uid));
            found += chunk.filter((uid) => hasSubByUid.get(uid) === true).length;
          }
        } catch (error) {
          logError("subs_query", error);
          continue;
        }

        const allRecipients = candidates.filter((uid) => hasSubByUid.get(uid) === true);
        const capped = stoppedEarly || allRecipients.length > core.MAX_RECIPIENTS_PER_EXPANSION;
        const recipients = allRecipients.slice(0, core.MAX_RECIPIENTS_PER_EXPANSION);

        stats.expansions += 1;
        if (recipients.length === 0) {
          await deletePending(item.ref);
          await writeCreatorCounter(creatorCounterRef);
          logExpanded("info", {
            sportTag,
            cities: remaining.length,
            candidates: candidates.length,
            recipients: 0,
            queued: 0,
            deduped: 0,
            failed: 0,
            capped: false,
            markers: 0,
          });
          continue;
        }

        const notice = core.buildNewEventNotice({
          sportTag,
          startMs: item.startMs,
          eventId: item.id,
        });
        const outcomes = await Promise.allSettled(recipients.map((uid) => (
          db.collection(settings.WEB_PUSH_COLLECTIONS.queue)
            .doc(core.queueIdOf({ dayKey, sportTag, uid }))
            .create({
              schema: 1,
              source: settings.WEB_PUSH_NEW_EVENT_SOURCE,
              kind: settings.WEB_PUSH_NEW_EVENT_KIND,
              recipientUid: uid,
              title: notice.title,
              body: notice.body,
              url: notice.url,
              status: "pending",
              createdAt: FieldValue.serverTimestamp(),
              expireAt: new Date(nowMs + settings.WEB_PUSH_QUEUE_RETENTION_MS),
            })
        )));

        let queued = 0;
        let deduped = 0;
        let failed = 0;
        for (const outcome of outcomes) {
          if (outcome.status === "fulfilled") queued += 1;
          else if (isAlreadyExists(outcome.reason)) deduped += 1;
          else failed += 1;
        }
        stats.queued += queued;
        stats.deduped += deduped;
        stats.failed += failed;

        if (failed > 0) {
          logExpanded("warn", {
            sportTag,
            cities: remaining.length,
            candidates: candidates.length,
            recipients: recipients.length,
            queued,
            deduped,
            failed,
            capped,
            markers: 0,
          });
          continue;
        }

        let markers = 0;
        if (queued + deduped >= 1) {
          const markerOutcomes = await Promise.allSettled(remaining.map((city) => {
            const markerId = core.dailyMarkerIdOf({ dayKey, sportTag, city });
            return db.collection(core.SPORT_NEW_EVENT_DAILY_COLLECTION).doc(markerId).create({
              date: dayKey,
              sportTag,
              city,
              createdAt: FieldValue.serverTimestamp(),
              expireAt: new Date(nowMs + core.SPORT_NEW_EVENT_DAILY_RETENTION_MS),
            });
          }));
          markerOutcomes.forEach((outcome, index) => {
            const markerId = core.dailyMarkerIdOf({ dayKey, sportTag, city: remaining[index] });
            if (outcome.status === "fulfilled" || isAlreadyExists(outcome.reason)) {
              markers += 1;
              markerExists.set(markerId, true);
            } else {
              logError("marker_create", outcome.reason);
            }
          });
        }

        await writeCreatorCounter(creatorCounterRef);
        await deletePending(item.ref);

        logExpanded(capped ? "warn" : "info", {
          sportTag,
          cities: remaining.length,
          candidates: candidates.length,
          recipients: recipients.length,
          queued,
          deduped,
          failed,
          capped,
          markers,
        });
      }

      logRun("done", "");
    } catch (error) {
      logError("unexpected", error);
    }
  }
  return dispatchNewEventNotices;
}

module.exports = {
  NEW_EVENT_TRIGGER_OPTIONS,
  NEW_EVENT_DISPATCH_OPTIONS,
  createQueueNewEventNoticeHandler,
  createDispatchNewEventNoticesHandler,
};
