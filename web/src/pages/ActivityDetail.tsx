import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { doc, getDoc } from "firebase/firestore";
import { db } from "../lib/firebase";
import { useAuth } from "../contexts/AuthContext";
import { fnRegisterActivity, fnCheckinByToken } from "../lib/api";

export default function ActivityDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [data, setData] = useState<any>(null);
  const [msg, setMsg] = useState<string>("");

  useEffect(() => {
    (async () => {
      if (!id) return;
      const snap = await getDoc(doc(db, "activities", id));
      setData(snap.exists() ? snap.data() : null);
    })();
  }, [id]);

  async function onRegister() {
    if (!id) return;
    setMsg("");
    try {
      await fnRegisterActivity({ activityId: id });
      setMsg("✅ 報名成功（若已滿會自動候補）");
    } catch (e: any) {
      setMsg(`❌ ${e?.message ?? "報名失敗"}`);
    }
  }

  // 之後你可做 /checkin?token=xxx 的頁面，這邊先示意
  async function onCheckinDemo() {
    const token = prompt("貼上 checkin token（示範用）");
    if (!token) return;
    setMsg("");
    try {
      await fnCheckinByToken({ token });
      setMsg("✅ 報到成功");
    } catch (e: any) {
      setMsg(`❌ ${e?.message ?? "報到失敗"}`);
    }
  }

  if (!data) return <div>活動不存在或載入中…</div>;

  return (
    <div className="card">
      <div style={{ fontWeight: 800, fontSize: 22 }}>{data.name}</div>
      <div className="small">{data.locationName}</div>
      <div style={{ marginTop: 12 }} className="row">
        <button className="btn btnPrimary" disabled={!user} onClick={onRegister}>我要報名</button>
        <button className="btn" disabled={!user} onClick={onCheckinDemo}>（示範）報到</button>
      </div>
      {msg && <div style={{ marginTop: 12 }}>{msg}</div>}
    </div>
  );
}
