/** Only presentation preferences are persisted; comment contents stay in memory. */
export type FreeTextStyle = {
  color: string;
  backgroundColor: string;
  transparent: boolean;
  fontSize: number;
};

export const FREE_TEXT_PREFERENCES_KEY = "free-text-style";
export const defaultFreeTextStyle: FreeTextStyle = {
  color: "#000000",
  backgroundColor: "#fff6a5",
  transparent: false,
  fontSize: 14,
};

export function readFreeTextStyle(): FreeTextStyle {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(FREE_TEXT_PREFERENCES_KEY) ?? "null",
    );
    if (stored === null || typeof stored !== "object")
      return defaultFreeTextStyle;
    const candidate = stored as Partial<FreeTextStyle>;
    const color = (value: unknown, fallback: string) =>
      typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)
        ? value
        : fallback;
    return {
      color: color(candidate.color, defaultFreeTextStyle.color),
      backgroundColor: color(
        candidate.backgroundColor,
        defaultFreeTextStyle.backgroundColor,
      ),
      transparent:
        typeof candidate.transparent === "boolean"
          ? candidate.transparent
          : defaultFreeTextStyle.transparent,
      fontSize:
        typeof candidate.fontSize === "number" &&
        Number.isFinite(candidate.fontSize) &&
        candidate.fontSize >= 6 &&
        candidate.fontSize <= 96
          ? candidate.fontSize
          : defaultFreeTextStyle.fontSize,
    };
  } catch {
    return defaultFreeTextStyle;
  }
}
