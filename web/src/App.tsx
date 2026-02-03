import React from "react";
import { Routes, Route } from "react-router-dom";
import Navbar from "./components/Navbar";
import Home from "./pages/Home";
import ActivityDetail from "./pages/ActivityDetail";
import Profile from "./pages/Profile";
import AdminDashboard from "./pages/AdminDashboard";
import AdminActivityEdit from "./pages/AdminActivityEdit";
import Leaderboard from "./pages/Leaderboard";
import Stats from "./pages/Stats";
import { RequireAuth } from "./lib/guards";

export default function App() {
  return (
    <>
      <Navbar />
      <div className="container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/activities/:id" element={<ActivityDetail />} />
          <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />

          <Route path="/admin" element={<RequireAuth><AdminDashboard /></RequireAuth>} />
          <Route path="/admin/activities/new" element={<RequireAuth><AdminActivityEdit mode="new" /></RequireAuth>} />
          <Route path="/admin/activities/:id" element={<RequireAuth><AdminActivityEdit mode="edit" /></RequireAuth>} />

          <Route path="/leaderboard" element={<Leaderboard />} />
          <Route path="/stats" element={<RequireAuth><Stats /></RequireAuth>} />
        </Routes>
      </div>
    </>
  );
}
