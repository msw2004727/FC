import * as functions from "firebase-functions";
import { db, FieldValue } from "./admin";

export const cronPublishClose = functions.pubsub
  .schedule("every 5 minutes")
  .timeZone("Asia/Taipei")
  .onRun(async () => {
    const now = FieldValue.serverTimestamp();

    // publish scheduled -> open
    const scheduled = await db.collection("activities")
      .where("status", "==", "scheduled")
      .where("publishAt", "<=", new Date())
      .get();

    const batch1 = db.batch();
    scheduled.forEach(doc => batch1.update(doc.ref, { status: "open", updatedAt: now }));
    await batch1.commit();

    // open -> closed
    const open = await db.collection("activities")
      .where("status", "==", "open")
      .where("closeAt", "<=", new Date())
      .get();

    const batch2 = db.batch();
    open.forEach(doc => batch2.update(doc.ref, { status: "closed", updatedAt: now }));
    await batch2.commit();

    return null;
  });
