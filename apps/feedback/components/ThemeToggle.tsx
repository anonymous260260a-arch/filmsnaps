"use client";

import { useTheme } from "next-themes";
import { Sun, Moon, Monitor } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <Button variant="outline" size="icon" disabled>
        <Sun className="h-4 w-4" />
      </Button>
    );
  }

  const next =
    theme === "dark" ? "light" : theme === "light" ? "system" : "dark";

  const icons = {
    dark: Moon,
    light: Sun,
    system: Monitor,
  };

  const Icon = icons[theme as keyof typeof icons] ?? Sun;

  return (
    <Button
      variant="outline"
      size="icon"
      onClick={() => setTheme(next)}
      title={`Current: ${theme}. Click for ${next}.`}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
