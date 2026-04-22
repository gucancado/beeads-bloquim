export type CursorColor =
  | "blue"
  | "green"
  | "red"
  | "orange"
  | "purple"
  | "pink"
  | "teal";

export const CURSOR_COLOR_HEX: Record<CursorColor, string> = {
  blue: "#2563eb",
  green: "#16a34a",
  red: "#dc2626",
  orange: "#ea580c",
  purple: "#7c3aed",
  pink: "#db2777",
  teal: "#0d9488",
};

export function cursorColorHex(color: string | undefined): string {
  if (!color) return CURSOR_COLOR_HEX.blue;
  return (CURSOR_COLOR_HEX as Record<string, string>)[color] ?? CURSOR_COLOR_HEX.blue;
}
