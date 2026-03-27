export interface ColorPaletteEntry {
  index: number;
  hex: string;
}

export const COLOR_PALETTE: ColorPaletteEntry[] = [
  { index: 1,  hex: "#FFDEB3" },
  { index: 2,  hex: "#FEFFB3" },
  { index: 3,  hex: "#B3FFB4" },
  { index: 4,  hex: "#B3FFF5" },
  { index: 5,  hex: "#B3D1FF" },
  { index: 6,  hex: "#E8B3FF" },
  { index: 7,  hex: "#FFB3F0" },
  { index: 8,  hex: "#FFB3B3" },
  { index: 9,  hex: "#FF9100" },
  { index: 10, hex: "#F9FF00" },
  { index: 11, hex: "#00FF06" },
  { index: 12, hex: "#00FFDD" },
  { index: 13, hex: "#0064FF" },
  { index: 14, hex: "#B400FF" },
  { index: 15, hex: "#FF00CE" },
  { index: 16, hex: "#FF0000" },
];

export function getColorByIndex(index: number | null | undefined): string | null {
  if (index == null) return null;
  const entry = COLOR_PALETTE.find((c) => c.index === index);
  return entry?.hex ?? null;
}

export const MAX_COLOR_INDEX = COLOR_PALETTE.length;
