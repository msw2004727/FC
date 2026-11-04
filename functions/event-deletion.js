"use strict";

const { hasEffectivePermission } = require("./team-permission");
const { maskUid } = require("./notification-fields");
const { ROLE_LABELS } = require("./team-membership-core");

const TRANSACTION_MAX_ATTEMPTS = 5;
const OWNER_FIELDS = ["captainUid", "creatorUid", "ownerUid"];

// Exact Rules authRole() semantics: canonical users/{uid}, then the Auth claim.
// Do not use getCallerAccessContext: it normalizes roles and supplies defaults.
async function readDeleteAccess(db, transaction, request) {
  const uid = request.auth.uid;
  const userSnap = await transaction.get(db.collection("users").doc(uid));
  const userData = userSnap.exists ? userSnap.data() : null;
  // Rules direct field access fails on an existing document without role.
  // Return no access so the caller uses its sanitized permission-denied path.
  if (userSnap.exists && !Object.prototype.hasOwnProperty.call(userData || {}, "role")) {
    return { isAdmin: false, hasPermission: () => false, operator: "" };
  }
  const docRole = userData?.role;
  const tokenRole = request.auth.token?.role;
  const role = typeof docRole === "string" && docRole !== ""
    ? docRole : (typeof tokenRole === "string" ? tokenRole : "user");
  // Same operator formula as deleteTeam's readActorNames (A _writeOpLog), from the
  // users/{uid} read above, so no extra read. Own-property lookup: role is raw input.
  const operator = String(userData?.displayName || "").trim()
    || (Object.prototype.hasOwnProperty.call(ROLE_LABELS, role) ? ROLE_LABELS[role] : "") || "系統";
  const isAdmin = role === "admin" || role === "super_admin";
  if (isAdmin) return { isAdmin, hasPermission: () => true, operator };

  // Invalid path components must never resolve to an unrelated permission doc.
  const validRoleId = role && !role.includes("/") && role !== "." && role !== ".."
    && !/^__.*__$/.test(role) && Buffer.byteLength(role, "utf8") <= 1500;
  const roleSnap = role !== "user" && validRoleId
    ? await transaction.get(db.collection("rolePermissions").doc(role)) : null;
  const grantSnap = await transaction.get(db.collection("userPermissionGrants").doc(uid));
  const sources = {
    role,
    roleDoc: roleSnap?.exists ? roleSnap.data() : null,
    grantDoc: grantSnap.exists ? grantSnap.data() : null,
  };
  return { isAdmin, hasPermission: (code) => hasEffectivePermission(sources, code), operator };
}

// Match A's lifecycle guard, including partially populated legacy course links.
function isCourseManaged(event) {
  const source = String(event.courseLinkSource || event.source || "").trim();
  return event.courseLinked === true || !!String(event.courseLinkId || "").trim()
    || source === "eduCourseLesson";
}

function isAborted(error) {
  return error?.code === 10 || error?.code === "aborted" || error?.code === "ABORTED";
}

function createDeleteEventHandler({
  db, HttpsError, courseLinkedEventManagedByCourseError, buildOperationLogPayload, logger = console,
}) {
  return async function deleteEventHandler(request) {
    const uid = request?.auth?.uid;
    const rawId = request?.data?.eventId;
    const eventId = typeof rawId === "string" ? rawId.trim() : "";
    const validId = /^[A-Za-z0-9_-]{1,120}$/.test(eventId) && !/^__.*__$/.test(eventId);
    const context = {
      function: "deleteEvent",
      actorUid: typeof uid === "string" ? maskUid(uid) : "[missing]",
      eventId: validId ? maskUid(eventId) : "[invalid]",
    };
    let phase = "validate";
    let lastEventRef = null;
    const publicErrors = new Set();
    const reject = (code, message) => {
      const error = new HttpsError(code, message);
      publicErrors.add(error);
      throw error;
    };

    try {
      if (typeof uid !== "string" || !uid) reject("unauthenticated", "AUTH_REQUIRED");
      if (!validId) reject("invalid-argument", "EVENT_ID_INVALID");

      // One atomic commit contains only the audit and the parent delete. The SDK
      // retries ABORTED with fresh event AND permission reads (R-CF-004).
      let result;
      try {
        result = await db.runTransaction(async (transaction) => {
          phase = "resolve";
          const events = db.collection("events");
          const direct = await transaction.get(events.doc(eventId));
          let eventSnap = direct.exists && direct.data()?.id === eventId ? direct : null;
          if (!eventSnap) {
            const legacy = await transaction.get(events.where("id", "==", eventId).limit(2));
            if (legacy.docs.length > 1) reject("failed-precondition", "EVENT_ID_AMBIGUOUS");
            eventSnap = legacy.docs[0] || null;
            if (!eventSnap && direct.exists) reject("failed-precondition", "EVENT_ID_MISMATCH");
          }
          if (!eventSnap) return { ok: true, alreadyDeleted: true };
          lastEventRef = eventSnap.ref;

          phase = "authorize";
          const event = eventSnap.data();
          const access = await readDeleteAccess(db, transaction, request);
          const isOwner = OWNER_FIELDS.some((field) => typeof event[field] === "string" && event[field] === uid);
          // Rules events delete: admin, super_admin, effective delete, owner + delete_self.
          // Neither edit_all, activity entry, capabilities nor delegate grants deletion.
          const allowed = access.isAdmin || access.hasPermission("event.delete")
            || (isOwner && access.hasPermission("event.delete_self"));
          if (!allowed || (event.privateEvent === true && !access.isAdmin && !isOwner)) {
            reject("permission-denied", "EVENT_DELETE_DENIED");
          }

          phase = "course-guard";
          if (isCourseManaged(event)) {
            const error = courseLinkedEventManagedByCourseError();
            publicErrors.add(error);
            throw error;
          }

          phase = "commit";
          // P3-b (consultant 6.3.9) supersedes the seven-field-only audit: A's log page
          // needs type/typeName/operator, so use deleteTeam's shared payload (which also
          // supplies createdAt) and keep the original seven fields. No other event data.
          const title = typeof event.title === "string" ? event.title : "";
          transaction.set(db.collection("operationLogs").doc(), {
            ...buildOperationLogPayload({
              operator: access.operator,
              type: "event_delete",
              typeName: "刪除活動",
              content: `刪除「${title}」`,
              now: new Date(),
            }),
            title,
            date: typeof event.date === "string" ? event.date : "",
            eventId,
            docId: eventSnap.id,
            creatorUid: typeof event.creatorUid === "string" ? event.creatorUid : "",
            actorUid: uid,
            source: "callable",
          });
          transaction.delete(eventSnap.ref, { exists: true });
          return { ok: true, alreadyDeleted: false };
        }, { maxAttempts: TRANSACTION_MAX_ATTEMPTS });
      } catch (error) {
        // SDK retries ABORTED, but not NOT_FOUND from the exists precondition.
        // The failed atomic batch wrote no audit: confirm absence before success.
        const notFound = error?.code === 5 || error?.code === "not-found" || error?.code === "NOT_FOUND";
        if (!notFound || phase !== "commit" || !lastEventRef) throw error;
        phase = "confirm-deleted";
        if ((await lastEventRef.get()).exists) throw error;
        result = { ok: true, alreadyDeleted: true };
      }

      if (result.alreadyDeleted) logger.warn("[deleteEvent] already deleted", context);
      return result;
    } catch (error) {
      // Never expose dependency messages/details or arbitrary error.code strings.
      const response = publicErrors.has(error) ? error
        : isAborted(error) ? new HttpsError("aborted", "EVENT_DELETE_RETRY")
          : new HttpsError("internal", "EVENT_DELETE_FAILED");
      logger.error("[deleteEvent] failed", { ...context, phase, code: response.code });
      throw response;
    }
  };
}

function createDeleteEventCallable({ onCall, ...dependencies }) {
  return onCall(
    { region: "asia-east1", timeoutSeconds: 30, minInstances: 0 },
    createDeleteEventHandler(dependencies),
  );
}

module.exports = { createDeleteEventCallable, createDeleteEventHandler };
