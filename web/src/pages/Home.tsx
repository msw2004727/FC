import React, { useEffect, useState } from "react";
import { collection, getDocs, orderBy, query, where } from "firebase/firestore";
import { db } from "../lib/firebase";
import { Link } from "react-router-dom";

type Activity = { name: string; locationName: string; startAt: any; fee: number; status: string; bannerUrl?: string };

export default function Home() {
  const [items, setItems] = useState<{ id: string; data: Activity }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const q = query(
        collection(db, "activities"),
        where("status", "in", ["open", "scheduled"]),
        orderBy("startAt", "asc")
      );
      const snap = await getDocs(q);
      setItems(snap.docs.map(d => ({ id: d.id, data: d.data() as any })));
      setLoading(false);
    })();
  }, []);

  if (loading) return <div>載入中…</div>;

  return (
    <div className="row">
      {items.map(({ id, data }) => (
        <Link key={id} to={`/activities/${id}`} style={{ textDecoration: "none", flex: "1 1 320px" }}>
          <div className="card">
            <div style={{ fontWeight: 700, fontSize: 18 }}>{data.name}</div>
            <div className="small">{data.locationName}</div>
            <div style={{ marginTop: 8 }} className="small">費用：{data.fee}</div>
            <div style={{ marginTop: 8 }} className="small">狀態：{data.status}</div>
          </div>
        </Link>
      ))}
      {!items.length && <div className="small">目前沒有活動</div>}
    </div>
  );
}
