import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";

export function RequireAuth({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <div style={{ padding: 16 }}>Loading...</div>;
  if (!user) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export function RequireRole({ allow }: { allow: string[] }) {
  const { userDoc, loading } = useAuth();
  if (loading) return <div style={{ padding: 16 }}>Loading...</div>;
  if (!userDoc) return <Navigate to="/" replace />;
  if (!allow.includes(userDoc.role)) return <Navigate to="/" replace />;
  return null;
}
