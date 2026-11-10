"use strict";

const crypto = require("crypto");

const TARGET_UID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const PROFILE_POPULARITY_COLLECTION = "profilePopularity";
const PROFILE_VIEWERS_SUBCOLLECTION = "viewers";
const USERS_COLLECTION = "users";

// 人氣指數（站長 2026-11-10）：人氣＝「有多少不同的人看過這個人的公開個人頁」。
// 規則最簡單：登入者才算、自己看自己不算、同一觀看者對同一被看者終身只算 1。
// 沒有管理員／新帳號排除（站長拿掉）；去重文件不設 expireAt、永久保留。
function sanitizeTargetUid(value, HttpsError) {
  const normalized = typeof value === "string" ? value.trim() : "";
  if (!TARGET_UID_PATTERN.test(normalized)) {
    throw new HttpsError("invalid-argument", "targetUid is invalid");
  }
  return normalized;
}

function normalizeProfileViews(value) {
  const candidate = typeof value === "string" && /^\d+$/.test(value.trim())
    ? Number(value.trim())
    : value;
  if (typeof candidate !== "number" || !Number.isFinite(candidate) || candidate < 0) {
    return 0;
  }
  return Math.floor(candidate);
}

// log 只記雜湊後的 key，不記 uid 原文。
function hashProfileViewKey(viewerUid, targetUid) {
  return crypto
    .createHash("sha256")
    .update(`${viewerUid}\u0000${targetUid}`, "utf8")
    .digest("hex")
    .slice(0, 16);
}

function createRecordProfileViewHandler({
  db,
  HttpsError,
  now = Date.now,
  logger = console,
}) {
  if (!db || typeof db.collection !== "function" || typeof db.runTransaction !== "function") {
    throw new TypeError("Firestore transaction support is required");
  }
  if (typeof HttpsError !== "function") {
    throw new TypeError("HttpsError is required");
  }
  if (typeof now !== "function") {
    throw new TypeError("now is required");
  }

  return async function recordProfileViewHandler(request) {
    const viewerUid = typeof request?.auth?.uid === "string" ? request.auth.uid.trim() : "";
    if (!viewerUid) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }

    const targetUid = sanitizeTargetUid(request?.data?.targetUid, HttpsError);
    // 自己看自己：不進交易、不產生任何讀寫。
    if (viewerUid === targetUid) {
      return { status: "self" };
    }

    const currentDate = new Date(now());
    if (!Number.isFinite(currentDate.getTime())) {
      throw new TypeError("now must resolve to a valid date");
    }
    const parentRef = db.collection(PROFILE_POPULARITY_COLLECTION).doc(targetUid);
    const viewerRef = parentRef.collection(PROFILE_VIEWERS_SUBCOLLECTION).doc(viewerUid);
    const targetUserRef = db.collection(USERS_COLLECTION).doc(targetUid);

    try {
      return await db.runTransaction(async transaction => {
        // 所有讀取都在寫入之前。已看過就直接回，不再讀其他文件。
        const viewerSnapshot = await transaction.get(viewerRef);
        if (viewerSnapshot?.exists) {
          return { status: "already" };
        }

        // 被看者必須存在，避免用亂數 ID 造出無限多份計數文件。
        const targetSnapshot = await transaction.get(targetUserRef);
        if (!targetSnapshot?.exists) {
          throw new HttpsError("not-found", "User not found");
        }

        const parentSnapshot = await transaction.get(parentRef);
        const parentData = parentSnapshot?.exists ? (parentSnapshot.data() || {}) : {};
        const nextViews = normalizeProfileViews(parentData.views) + 1;

        // 觀看紀錄只存 viewerUid 與 firstSeenAt，不存歷史、不設 expireAt。
        transaction.create(viewerRef, { viewerUid, firstSeenAt: currentDate });
        transaction.set(parentRef, { views: nextViews, updatedAt: currentDate });
        return { status: "counted", views: nextViews };
      });
    } catch (error) {
      if (error instanceof HttpsError) throw error;
      if (logger && typeof logger.error === "function") {
        logger.error("[recordProfileView] transaction failed", {
          key: hashProfileViewKey(viewerUid, targetUid),
          errorCode: typeof error?.code === "string" ? error.code : "unknown",
        });
      }
      throw new HttpsError("unavailable", "PROFILE_VIEW_COUNT_UNAVAILABLE");
    }
  };
}

function createRecordProfileViewCallable({ onCall, ...dependencies }) {
  if (typeof onCall !== "function") {
    throw new TypeError("onCall is required");
  }
  return onCall(
    { region: "asia-east1", minInstances: 0 },
    createRecordProfileViewHandler(dependencies),
  );
}

module.exports = {
  PROFILE_POPULARITY_COLLECTION,
  PROFILE_VIEWERS_SUBCOLLECTION,
  TARGET_UID_PATTERN,
  USERS_COLLECTION,
  createRecordProfileViewCallable,
  createRecordProfileViewHandler,
  normalizeProfileViews,
};
