import * as functions from "firebase-functions";
import cors from "cors";
import { auth, db, FieldValue } from "./admin";
import type { UserDoc, Role } from "./types";

const corsHandler = cors({ origin: true });

function defaultPermissions(role: Role): string[] {
  if (role === "admin") {
    return [
      "activity:create","activity:edit","activity:publish","activity:checkin",
      "user:manage","formula:edit","report:view"
    ];
  }
  return []; // beginner/veteran/coach 先都一般權限，之後可加 coach 專屬
}

/**
 * 前端送：{ idToken, profile:{ userId, displayName, pictureUrl } }
 * 後端：驗證 token（你可以再加 LINE verify API）
 * 先以「信任 LIFF idToken」為骨架，正式上線建議加 verify。
 */
export const createCustomToken = functions.https.onRequest((req, res) => {
  corsHandler(req, res, async () => {
    try {
      const { profile } = req.body as {
        idToken: string;
        profile: { userId: string; displayName: string; pictureUrl?: string };
      };

      if (!profile?.userId) return res.status(400).json({ error: "missing profile.userId" });

      const uid = `line:${profile.userId}`;
      const userRef = db.collection("users").doc(uid);
      const snap = await userRef.get();

      if (!snap.exists) {
        const role: Role = "beginner";
        const doc: UserDoc = {
          uid,
          lineNickname: profile.displayName ?? "LINE User",
          lineAvatarUrl: profile.pictureUrl ?? "",
          role,
          permissions: defaultPermissions(role),
          points: 0,
          coins: 0,
          honorTags: [],
          stats: { signupCount: 0, completeCount: 0, cancelCount: 0, lateCancelCount: 0 },
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp()
        };
        await userRef.set(doc, { merge: false });
      } else {
        await userRef.set(
          {
            lineNickname: profile.displayName ?? snap.data()?.lineNickname ?? "LINE User",
            lineAvatarUrl: profile.pictureUrl ?? snap.data()?.lineAvatarUrl ?? "",
            updatedAt: FieldValue.serverTimestamp()
          },
          { merge: true }
        );
      }

      const token = await auth.createCustomToken(uid);
      return res.json({ token });
    } catch (e: any) {
      console.error(e);
      return res.status(500).json({ error: e?.message ?? "server error" });
    }
  });
});
