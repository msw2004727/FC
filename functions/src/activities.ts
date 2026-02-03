import * as functions from "firebase-functions";
import { db, FieldValue } from "./admin";

export const registerActivity = functions.https.onCall(async (data, context) => {
  const uid = context.auth?.uid;
  if (!uid) throw new functions.https.HttpsError("unauthenticated", "Please sign in.");

  const { activityId } = data as { activityId: string };
  if (!activityId) throw new functions.https.HttpsError("invalid-argument", "Missing activityId");

  const actRef = db.collection("activities").doc(activityId);
  const regRef = actRef.collection("registrations").doc(uid);

  await db.runTransaction(async (tx) => {
    const actSnap = await tx.get(actRef);
    if (!actSnap.exists) throw new functions.https.HttpsError("not-found", "Activity not found");

    const act = actSnap.data()!;
    if (act.status !== "open") throw new functions.https.HttpsError("failed-precondition", "Not open");

    const regSnap = await tx.get(regRef);
    if (regSnap.exists && regSnap.data()?.status !== "canceled") {
      throw new functions.https.HttpsError("already-exists", "Already registered");
    }

    // 計算目前 registered 數
    const regsSnap = await tx.get(
      actRef.collection("registrations").where("status", "==", "registered")
    );

    const registeredCount = regsSnap.size;
    const capacity = act.capacity ?? 0;

    const status = registeredCount < capacity ? "registered" : "waitlisted";

    tx.set(regRef, {
      uid,
      status,
      joinAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp()
    }, { merge: true });

    tx.update(db.collection("users").doc(uid), {
      "stats.signupCount": FieldValue.increment(1),
      updatedAt: FieldValue.serverTimestamp()
    });
  });

  return { ok: true };
});
