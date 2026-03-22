import { useTheme } from "next-themes";
import { Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";

interface ThemeToggleProps {
  collapsed?: boolean;
}

export function ThemeToggle({ collapsed }: ThemeToggleProps) {
  const { setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  const isDark = resolvedTheme === "dark";

  const toggle = () => {
    setTheme(isDark ? "light" : "dark");
  };

  if (!mounted) {
    return (
      <div
        className={`${collapsed ? 'w-10 h-10 mx-auto rounded-xl' : 'w-full rounded-xl h-10'} bg-sidebar-accent/20 animate-pulse`}
      />
    );
  }

  if (collapsed) {
    return (
      <button
        title={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
        onClick={toggle}
        className="w-10 h-10 mx-auto rounded-xl flex items-center justify-center text-sidebar-foreground/50 hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-all"
      >
        {isDark ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
      </button>
    );
  }

  return (
    <button
      title={isDark ? "Mudar para tema claro" : "Mudar para tema escuro"}
      onClick={toggle}
      className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all"
    >
      {isDark ? <Sun className="w-4 h-4 shrink-0" /> : <Moon className="w-4 h-4 shrink-0" />}
      <span className="text-sm">{isDark ? "Tema Claro" : "Tema Escuro"}</span>
    </button>
  );
}
