"use strict";

const DEFAULT_CACHE_TTL_MS = 30 * 1000;
const MAX_VERIFY_UIDS = 50;
const MAX_UID_LENGTH = 128;
const MAX_IDENTITY_MATCHES = 5;
const IDENTITY_QUERY_LIMIT = MAX_IDENTITY_MATCHES + 1;
const DIRECTORY_ROLES = new Set([
  "user", "coach", "captain", "venue_owner", "admin", "super_admin",
]);

function firstSafeText(values, maxLength) {
  for (const value of values) {
    if (typeof value !== "string") continue;
    const normalized = value.trim().slice(0, maxLength);
    if (normalized) return normalized;
  }
  return "";
}

function normalizeUid(value) {
  if (typeof value !== "string") return "";
  const uid = value.trim();
  return uid && uid.length <= MAX_UID_LENGTH && !uid.includes("/") ? uid : "";
}

function normalizeDirectoryRole(value) {
  const role = typeof value === "string" ? value.trim().toLowerCase() : "";
  return DIRECTORY_ROLES.has(role) ? role : "user";
}

function invalidVerifyUidsError(HttpsError) {
  return new HttpsError("invalid-argument", "verifyUids must contain 1 to 50 valid UIDs");
}

function sanitizeVerifyUids(value, HttpsError) {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_VERIFY_UIDS) {
    throw invalidVerifyUidsError(HttpsError);
  }
  const seen = new Set();
  const uids = [];
  for (const candidate of value) {
    const uid = normalizeUid(candidate);
    if (!uid) throw invalidVerifyUidsError(HttpsError);
    if (!seen.has(uid)) {
      seen.add(uid);
      uids.push(uid);
    }
  }
  return uids;
}

/** Build the only user shape that may leave the callable boundary. */
function projectUserDirectoryEntry(data = {}, documentId = "", forcedUid = "") {
  if (!data || typeof data !== "object") return null;
  if (data.isRestricted === true || data.restricted === true) return null;
  const uid = normalizeUid(forcedUid)
    || normalizeUid(data.uid)
    || normalizeUid(data.lineUserId)
    || normalizeUid(documentId);
  if (!uid) return null;
  const name = firstSafeText([data.name, data.displayName, uid], 80);
  const displayName = firstSafeText([data.displayName, data.name, uid], 80);
  const pictureUrl = firstSafeText([data.pictureUrl, data.photoURL], 2000);
  const storedRole = normalizeDirectoryRole(data.role);
  const isStealth = data.stealth === true || data.isStealth === true;
  const role = isStealth && (storedRole === "admin" || storedRole === "super_admin")
    ? "user" : storedRole;
  return { uid, name, displayName, pictureUrl, role };
}

function inspectDirectoryDocument(doc, expectedUid = "") {
  const data = doc?.data?.();
  const documentId = normalizeUid(doc?.id);
  if (!data || typeof data !== "object") {
    return { uids: [expectedUid || documentId].filter(Boolean), invalid: true };
  }
  const fields = ["uid", "lineUserId"].map((key) => {
    const raw = data[key];
    const present = raw !== undefined && raw !== null
      && !(typeof raw === "string" && raw.trim() === "");
    return { present, value: present ? normalizeUid(raw) : "" };
  });
  const claimedUids = [...new Set(fields.map(field => field.value).filter(Boolean))];
  const invalid = fields.some(field => field.present && !field.value)
    || claimedUids.length > 1;
  const logicalUid = !invalid ? (claimedUids[0] || documentId) : "";
  const uids = [...new Set([...claimedUids, documentId].filter(Boolean))];
  if (expectedUid && !uids.includes(expectedUid)) uids.push(expectedUid);
  const restricted = data.isRestricted === true || data.restricted === true;
  const entry = !invalid && logicalUid
    ? projectUserDirectoryEntry(data, documentId, logicalUid) : null;
  return {
    uids,
    logicalUid,
    canonical: Boolean(logicalUid && documentId === logicalUid),
    restricted,
    invalid,
    entry,
  };
}

function entriesMatch(left, right) {
  return left.uid === right.uid
    && left.name === right.name
    && left.displayName === right.displayName
    && left.pictureUrl === right.pictureUrl
    && left.role === right.role;
}

function compareDirectoryEntries(left, right) {
  return left.displayName.localeCompare(right.displayName)
    || left.uid.localeCompare(right.uid);
}

function resolveDirectoryDocuments(docs, expectedUid = "") {
  const groups = new Map();
  docs.forEach((doc) => {
    const record = inspectDirectoryDocument(doc, expectedUid);
    record.uids.forEach((uid) => {
      if (expectedUid && uid !== expectedUid) return;
      if (!groups.has(uid)) groups.set(uid, []);
      groups.get(uid).push(record);
    });
  });
  const entries = [];
  groups.forEach((records, uid) => {
    if (records.some(
      record => record.invalid || record.restricted || !record.entry || record.logicalUid !== uid,
    )) return;
    const canonical = records.find(
      record => record.canonical && record.logicalUid === uid,
    );
    if (canonical) {
      entries.push(canonical.entry);
      return;
    }
    const legacyEntries = records
      .filter(record => record.logicalUid === uid)
      .map(record => record.entry);
    if (legacyEntries.length
      && legacyEntries.every(entry => entriesMatch(entry, legacyEntries[0]))) {
      entries.push(legacyEntries[0]);
    }
  });
  return entries.sort(compareDirectoryEntries);
}

function cloneDirectory(entries) {
  return entries.map(entry => ({ ...entry }));
}

function createListUserDirectoryHandler({
  db, HttpsError, cacheTtlMs = DEFAULT_CACHE_TTL_MS, now = Date.now, logger = console,
}) {
  if (!db || typeof db.collection !== "function") throw new TypeError("db.collection is required");
  if (typeof HttpsError !== "function") throw new TypeError("HttpsError is required");
  const ttlMs = Number.isFinite(cacheTtlMs) && cacheTtlMs >= 0
    ? cacheTtlMs : DEFAULT_CACHE_TTL_MS;
  let cachedEntries = null;
  let cacheExpiresAt = 0;
  let pendingLoad = null;
  let activeLoadRevision = null;
  let cacheRevision = 0;
  const pendingOverrides = new Map();

  function createUnavailableError(error, operation) {
    if (logger && typeof logger.error === "function") {
      logger.error("[listUserDirectory] failed to load directory", {
        operation,
        error: error instanceof Error ? error.message : "unknown",
      });
    }
    return new HttpsError("unavailable", "USER_DIRECTORY_UNAVAILABLE");
  }

  function applyOverrides(entries) {
    const replacedUids = new Set(pendingOverrides.keys());
    const merged = entries.filter(entry => !replacedUids.has(entry.uid));
    pendingOverrides.forEach((entry) => {
      if (entry) merged.push(entry);
    });
    pendingOverrides.clear();
    return merged.sort(compareDirectoryEntries);
  }

  async function loadDirectory() {
    const revisionBeforeLoad = cacheRevision;
    activeLoadRevision = revisionBeforeLoad;
    try {
      const snapshot = await db.collection("users").get();
      let entries = resolveDirectoryDocuments(snapshot.docs);
      if (revisionBeforeLoad !== cacheRevision) entries = applyOverrides(entries);
      cachedEntries = entries;
      cacheExpiresAt = Number(now()) + ttlMs;
      activeLoadRevision = null;
      pendingOverrides.clear();
      return entries;
    } catch (error) {
      activeLoadRevision = null;
      pendingOverrides.clear();
      throw createUnavailableError(error, "full-directory");
    }
  }

  function refreshCachedEntries(verifyUids, verifiedEntries) {
    cacheRevision += 1;
    const byUid = new Map(verifiedEntries.map(entry => [entry.uid, entry]));
    if (activeLoadRevision !== null) {
      verifyUids.forEach(uid => pendingOverrides.set(uid, byUid.get(uid) || null));
    }
    if (cachedEntries === null) return;
    const replacedUids = new Set(verifyUids);
    cachedEntries = [
      ...cachedEntries.filter(entry => !replacedUids.has(entry.uid)),
      ...cloneDirectory(verifiedEntries),
    ].sort(compareDirectoryEntries);
  }

  async function queryIdentityMatches(userCollection, field, uid) {
    const snapshot = await userCollection
      .where(field, "==", uid)
      .limit(IDENTITY_QUERY_LIMIT)
      .get();
    return snapshot.docs.length >= IDENTITY_QUERY_LIMIT
      ? { overflow: true, docs: [] } : { overflow: false, docs: snapshot.docs };
  }

  async function verifySingleUid(userCollection, uid) {
    const canonical = await userCollection.doc(uid).get();
    if (canonical?.exists) {
      const record = inspectDirectoryDocument(canonical, uid);
      if (record.invalid || record.restricted || record.logicalUid !== uid) return null;
    }
    const matches = await Promise.all([
      queryIdentityMatches(userCollection, "uid", uid),
      queryIdentityMatches(userCollection, "lineUserId", uid),
    ]);
    if (matches.some(result => result.overflow)) return null;
    const uniqueDocs = new Map();
    if (canonical?.exists) uniqueDocs.set(canonical.id, canonical);
    matches.forEach(result => result.docs.forEach(doc => uniqueDocs.set(doc.id, doc)));
    return resolveDirectoryDocuments([...uniqueDocs.values()], uid)[0] || null;
  }

  async function loadVerifiedDirectory(verifyUids) {
    try {
      const userCollection = db.collection("users");
      const results = await Promise.all(
        verifyUids.map(uid => verifySingleUid(userCollection, uid)),
      );
      const entries = results.filter(Boolean).sort(compareDirectoryEntries);
      refreshCachedEntries(verifyUids, entries);
      return entries;
    } catch (error) {
      throw createUnavailableError(error, "fresh-identity-verification");
    }
  }

  return async function listUserDirectoryHandler(request) {
    if (!request?.auth?.uid) {
      throw new HttpsError("unauthenticated", "Authentication required");
    }
    const hasVerifyUids = request.data
      && typeof request.data === "object"
      && Object.prototype.hasOwnProperty.call(request.data, "verifyUids");
    if (hasVerifyUids) {
      const verifyUids = sanitizeVerifyUids(request.data.verifyUids, HttpsError);
      return { users: cloneDirectory(await loadVerifiedDirectory(verifyUids)) };
    }
    if (cachedEntries && Number(now()) < cacheExpiresAt) {
      return { users: cloneDirectory(cachedEntries) };
    }
    if (!pendingLoad) {
      pendingLoad = loadDirectory().finally(() => {
        pendingLoad = null;
      });
    }
    return { users: cloneDirectory(await pendingLoad) };
  };
}

function createListUserDirectoryCallable({ onCall, ...dependencies }) {
  if (typeof onCall !== "function") throw new TypeError("onCall is required");
  return onCall(
    { region: "asia-east1", timeoutSeconds: 30, memory: "256MiB" },
    createListUserDirectoryHandler(dependencies),
  );
}

module.exports = {
  DEFAULT_CACHE_TTL_MS,
  createListUserDirectoryCallable,
  createListUserDirectoryHandler,
  projectUserDirectoryEntry,
};