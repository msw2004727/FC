import * as functions from "firebase-functions";
import { db, FieldValue } from "./admin";
import jwt from "jsonwebtoken";

const CHECKIN_SECRET = process.env.CHECKIN_SECRET || "dev-secret-change-me";

export const getCheckinQrToken = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError("unauthenticated", "Please sign in.");

  const { activityId } = data as { activityId: string };
  if (!activityId) throw new functions.https.HttpsError("invalid-argument", "Missing activityId");

  // 這裡正式版應該檢查 uid 是否有 activity:checkin 權限（可在 rules 或自建檢查）
  const expSeconds = Math.floor(Date.now() / 1000) + 10 * 60; // 10 分鐘
  const token = jwt.sign({ activityId, exp: expSeconds }, CHECKIN_SECRET);

  return { token, expSeconds };
});

export const checkinByToken = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError("unauthenticated", "Please sign in.");

  const { token } = data as { token: string };
  if (!token) throw new functions.https.HttpsError("invalid-argument", "Missing token");

  let payload: any;
  try {
    payload = jwt.verify(token, CHECKIN_SECRET);
  } catch {
    throw new functions.https.HttpsError("permission-denied", "Invalid token");
  }

  const activityId = payload.activityId as string;
  const regRef = db.collection("activities").doc(activityId).collection("registrations").doc(uid);

  await db.runTransaction(async (tx) => {
    const regSnap = await tx.get(regRef);
    if (!regSnap.exists) throw new functions.https.HttpsError("not-found", "Not registered");

    const status = regSnap.data()!.status;
    if (status !== "registered" && status !== "waitlisted") {
      throw new functions.https.HttpsError("failed-precondition", "Cannot check-in in this state");
    }

    tx.update(regRef, {
      status: "checkedIn",
      checkinAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    });
  });

  return { ok: true };
});
