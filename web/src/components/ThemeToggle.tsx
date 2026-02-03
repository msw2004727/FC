import React, { useState } from "react";
import { getTheme, toggleTheme } from "../lib/theme";

export default function ThemeToggle() {
  const [t, setT] = useState(getTheme());
  return (
    <button
      className="btn"
      onClick={() => { toggleTheme(); setT(getTheme()); }}
      title="切換亮/暗"
    >
      {t === "dark" ? "🌙" : "☀️"}
    </button>
  );
}
