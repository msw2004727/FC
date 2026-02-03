import React from "react";
import { Link } from "react-router-dom";
import ThemeToggle from "./ThemeToggle";
import { useAuth } from "../contexts/AuthContext";

export default function Navbar() {
  const { user, userDoc, signIn, signOut, loading } = useAuth();

  return (
    <div className="card" style={{ borderRadius: 0, borderLeft: 0, borderRight: 0 }}>
      <div className="container" style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
          <Link to="/" style={{ textDecoration: "none", fontWeight: 700 }}>⚽️ 報名系統</Link>
          <Link to="/leaderboard">排行榜</Link>
          {user && <Link to="/profile">會員中心</Link>}
          {userDoc?.role === "admin" && <Link to="/admin">後台</Link>}
        </div>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <ThemeToggle />
          {!loading && !user && <button className="btn btnPrimary" onClick={signIn}>LINE 登入</button>}
          {!loading && user && <button className="btn" onClick={signOut}>登出</button>}
        </div>
      </div>
    </div>
  );
}
