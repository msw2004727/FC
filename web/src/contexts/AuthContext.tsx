import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { onAuthStateChanged, signInWithCustomToken, User } from "firebase/auth";
import { doc, getDoc } from "firebase/firestore";
import { auth, db } from "../lib/firebase";
import { initLiff, getLiffProfile, getLiffIdToken } from "../lib/liff";
import { fnCreateCustomToken } from "../lib/api";

type Role = "beginner" | "veteran" | "coach" | "admin";
type UserDoc = { uid: string; role: Role; lineNickname: string; lineAvatarUrl: string; permissions: string[]; points: number; };

type AuthState = {
  user: User | null;
  userDoc: UserDoc | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
};

const Ctx = createContext<AuthState | null>(null);

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error("AuthContext missing");
  return v;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userDocState, setUserDocState] = useState<UserDoc | null>(null);
  const [loading, setLoading] = useState(true);

  async function signIn() {
    setLoading(true);
    await initLiff();
    const profile = await getLiffProfile();
    const idToken = await getLiffIdToken();

    const resp: any = await fnCreateCustomToken({ idToken, profile });
    const token = resp.data.token as string;
    await signInWithCustomToken(auth, token);
  }

  async function signOutFn() {
    await auth.signOut();
  }

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (!u) {
        setUserDocState(null);
        setLoading(false);
        return;
      }
      const ref = doc(db, "users", u.uid);
      const snap = await getDoc(ref);
      setUserDocState(snap.exists() ? (snap.data() as any) : null);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const value = useMemo(() => ({
    user, userDoc: userDocState, loading, signIn, signOut: signOutFn
  }), [user, userDocState, loading]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
