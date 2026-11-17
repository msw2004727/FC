"use strict";

// 會員資料讀取強化：根文件四欄鏡像到私密子文件；目標只看路徑上的文件 id，不看文件內容。

const { isDeepStrictEqual } = require("util");

const PROFILE_PRIVATE_FIELDS = Object.freeze([
  "phone",
  "email",
  "companions",
  "eduChildren",
]);
const PROFILE_PRIVATE_COLLECTION = "profilePrivate";
const PROFILE_PRIVATE_DOC_ID = "profile";

let failures = 0;

function hasOwnField(data, field) {
  return data !== null
    && typeof data === "object"
    && Object.prototype.hasOwnProperty.call(data, field);
}

function readField(data, field) {
  if (data === null || typeof data !== "object") return null;
  if (!hasOwnField(data, field)) return null;
  const value = data[field];
  return typeof value === "undefined" ? null : value;
}

function changedProfileFields(beforeData, afterData) {
  if (afterData === null || typeof afterData === "undefined") return [];

  if (beforeData === null || typeof beforeData === "undefined") {
    return PROFILE_PRIVATE_FIELDS.filter(
      (field) => readField(afterData, field) !== null,
    );
  }

  return PROFILE_PRIVATE_FIELDS.filter(
    (field) => !isDeepStrictEqual(
      readField(beforeData, field),
      readField(afterData, field),
    ),
  );
}

function planProfilePrivatePatch({ isCreate, fields, rootData, privateData }) {
  const patch = {};
  let hasPatch = false;

  for (const field of fields) {
    const rootValue = readField(rootData, field);
    const privateHasField = hasOwnField(privateData, field);

    if (isCreate) {
      if (!privateHasField && rootValue !== null) {
        patch[field] = rootValue;
        hasPatch = true;
      }
      continue;
    }

    if (!privateHasField || !isDeepStrictEqual(privateData[field], rootValue)) {
      patch[field] = rootValue;
      hasPatch = true;
    }
  }

  return hasPatch ? patch : null;
}

function isSafeUserDocId(id) {
  return typeof id === "string"
    && id.length > 0
    && id.length <= 128
    && !id.includes("/")
    && id !== "."
    && id !== ".."
    && !/^__.*__$/.test(id);
}

function createProfilePrivateMirror({ db, FieldValue, logger = console }) {
  return async function mirrorProfilePrivate({ userId, beforeData, afterData }) {
    const fields = changedProfileFields(beforeData, afterData);
    if (fields.length === 0) return { outcome: "unchanged" };
    if (!isSafeUserDocId(userId)) return { outcome: "skipped_invalid_id" };

    const rootRef = db.collection("users").doc(userId);
    const privateRef = rootRef
      .collection(PROFILE_PRIVATE_COLLECTION)
      .doc(PROFILE_PRIVATE_DOC_ID);

    try {
      return await db.runTransaction(async (tx) => {
        const rootSnap = await tx.get(rootRef);
        if (!rootSnap.exists) return { outcome: "skipped_root_missing" };

        const privateSnap = await tx.get(privateRef);
        const patch = planProfilePrivatePatch({
          isCreate: beforeData == null,
          fields,
          rootData: rootSnap.data() || {},
          privateData: privateSnap.exists ? (privateSnap.data() || {}) : null,
        });

        if (patch === null) return { outcome: "unchanged" };

        const payload = {
          ...patch,
          updatedAt: FieldValue.serverTimestamp(),
        };
        if (!privateSnap.exists) {
          payload.createdAt = FieldValue.serverTimestamp();
        }

        tx.set(privateRef, payload, { merge: true });
        return {
          outcome: "written",
          fieldCount: Object.keys(patch).length,
        };
      });
    } catch (err) {
      failures += 1;
      const rawCode = err && (err.code || err.name)
        ? String(err.code || err.name)
        : "unknown";
      const code = rawCode.slice(0, 40);
      logger.error("[profilePrivateMirror]", {
        event: "profile_private_mirror",
        outcome: "failed",
        code,
        failures,
      });
      return { outcome: "failed" };
    }
  };
}

function _resetFailuresForTest() {
  failures = 0;
}

module.exports = {
  PROFILE_PRIVATE_FIELDS,
  PROFILE_PRIVATE_COLLECTION,
  PROFILE_PRIVATE_DOC_ID,
  readField,
  changedProfileFields,
  planProfilePrivatePatch,
  isSafeUserDocId,
  createProfilePrivateMirror,
  _resetFailuresForTest,
};
