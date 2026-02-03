import React from "react";
import { useAuth } from "../contexts/AuthContext";

export default function Profile() {
  const { userDoc } = useAuth();
  if (!userDoc) return <div>載入中…</div>;

  return (
    <div className="card">
      <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
        {userDoc.lineAvatarUrl && (
          <img src={userDoc.lineAvatarUrl} alt="avatar" width={52} height={52} style={{ borderRadius: 999 }} />
        )}
        <div>
          <div style={{ fontWeight: 800 }}>{userDoc.lineNickname}</div>
          <div className="small">角色：{userDoc.role}｜積分：{userDoc.points}</div>
        </div>
      </div>

      <div style={{ marginTop: 16 }} className="small">
        這裡之後加：性別、年紀、聯絡方式、慣用腳、位置多選、報名/完成/取消統計、金庫…
      </div>
    </div>
  );
}
