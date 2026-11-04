import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark";

interface ThemeState {
  theme: Theme;
  toggleTheme: () => void;
  setTheme: (theme: Theme) => void;
}

/** 首次访问跟随系统；用户切换后写入 localStorage。 */
function systemTheme(): Theme {
  return typeof window !== "undefined" &&
    window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

/** 旧版本存的是 doodle / doodle-dark。 */
export function migrateTheme(stored: unknown): Theme {
  if (stored === "dark" || stored === "doodle-dark") return "dark";
  if (stored === "light" || stored === "doodle") return "light";
  return systemTheme();
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);
  // 浏览器 UI（移动端地址栏）跟着纸色走
  const paper = getComputedStyle(root).getPropertyValue("--color-paper-100").trim();
  if (paper) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", `rgb(${paper})`);
}

try {
  if (typeof window !== "undefined" && localStorage.getItem("komaslate-theme") === null) {
    const legacyTheme = localStorage.getItem("openoii-theme");
    if (legacyTheme !== null) localStorage.setItem("komaslate-theme", legacyTheme);
  }
} catch {
  // ignore storage errors
}

export const useThemeStore = create<ThemeState>()(
  persist(
    (set, get) => ({
      theme: systemTheme(),
      toggleTheme: () => {
        const next = get().theme === "dark" ? "light" : "dark";
        applyTheme(next);
        set({ theme: next });
      },
      setTheme: (theme: Theme) => {
        applyTheme(theme);
        set({ theme });
      },
    }),
    {
      name: "komaslate-theme",
      version: 1,
      migrate: (persisted) => ({
        theme: migrateTheme((persisted as { theme?: unknown } | null)?.theme),
      }),
      onRehydrateStorage: () => (state) => {
        if (state?.theme) applyTheme(state.theme);
      },
    },
  ),
);
