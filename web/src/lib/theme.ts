const KEY = "theme";

export function getTheme(): "light" | "dark" {
  const v = localStorage.getItem(KEY);
  return (v === "dark" || v === "light") ? v : "light";
}

export function setTheme(t: "light" | "dark") {
  localStorage.setItem(KEY, t);
  document.documentElement.setAttribute("data-theme", t);
}

export function toggleTheme() {
  setTheme(getTheme() === "dark" ? "light" : "dark");
}
