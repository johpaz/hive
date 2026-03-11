

export function useTheme() {
  const theme = "dark";

  const setTheme = (_newTheme: "light" | "dark") => {
    // Force dark theme regardless of input
    document.documentElement.classList.add("dark");
  };

  const toggleTheme = () => {
    // No-op to avoid toggling to light mode
  };

  return { theme, setTheme, toggleTheme };
}
