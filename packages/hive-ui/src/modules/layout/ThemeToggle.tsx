import { Button } from "@/components/ui/button";
import { Moon, Sun } from "lucide-react";
import { useTheme } from "@/hooks/useTheme";

// Cast icons to any to bypass React 19 type incompatibility with Lucide
// This is a known issue where React 19's ReactNode type includes bigint
// which Lucide's ForwardRefExoticComponent types don't account for
const SunIcon = Sun as any;
const MoonIcon = Moon as any;

export function ThemeToggle() {
  const { theme, toggleTheme } = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={toggleTheme} className="h-8 w-8">
      {theme === "dark" ? <SunIcon className="h-4 w-4" /> : <MoonIcon className="h-4 w-4" />}
    </Button>
  );
}
