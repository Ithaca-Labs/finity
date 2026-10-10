"use client";
import { useSyncExternalStore } from "react";
import { motion } from "motion/react";

type Theme = "light" | "dark";
const KEY = "finity-theme";

/** Runs before paint so the first frame already has the right palette. */
export const themeScript = `(function(){try{var t=localStorage.getItem('${KEY}');if(t!=='light'&&t!=='dark'){t=matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light'}document.documentElement.dataset.theme=t}catch(e){}})()`;

function subscribe(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  // Follow the OS until the visitor picks a theme themselves.
  const media = matchMedia("(prefers-color-scheme: dark)");
  const onMedia = () => {
    let stored: string | null = null;
    try { stored = localStorage.getItem(KEY); } catch {}
    if (!stored) document.documentElement.dataset.theme = media.matches ? "dark" : "light";
  };
  media.addEventListener("change", onMedia);
  return () => { observer.disconnect(); media.removeEventListener("change", onMedia); };
}

export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, () => (document.documentElement.dataset.theme === "dark" ? "dark" : "light"), () => "light");
}

function setTheme(theme: Theme) {
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem(KEY, theme); } catch {}
}

/** The eye shuts to turn the lights off. */
export function ThemeToggle() {
  const dark = useTheme() === "dark";
  return (
    <button type="button" className="icon-btn" onClick={() => setTheme(dark ? "light" : "dark")} aria-label={dark ? "Switch to light theme" : "Switch to dark theme"}>
      <svg viewBox="0 0 40 28" width="28" aria-hidden fill="none" stroke="currentColor" strokeLinecap="round">
        <motion.path strokeWidth="2.6" initial={false} animate={{ d: dark ? "M3 13 C12 20 28 20 37 13" : "M3 14 C12 3 28 3 37 14" }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }} />
        <path d="M3 14 C12 24 28 24 37 14" strokeWidth="2" />
        <motion.circle cx="20" cy="14" r="4.2" fill="currentColor" stroke="none" animate={{ opacity: dark ? 0 : 1, scale: dark ? 0.4 : 1 }} transition={{ duration: 0.3 }} />
        <motion.g animate={{ opacity: dark ? 1 : 0 }} transition={{ duration: 0.3 }} strokeWidth="1.8">
          <path d="M11 19 l-2 5" /><path d="M20 21 l0 5" /><path d="M29 19 l2 5" />
        </motion.g>
      </svg>
    </button>
  );
}
