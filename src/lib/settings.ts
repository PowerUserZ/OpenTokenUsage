import { LazyStore } from "@tauri-apps/plugin-store";
import type { PluginMeta } from "@/lib/plugin-types";
import { isLanguagePreference, type LanguagePreference } from "@/lib/i18n";
import type { MessageKey } from "@/locales/en";

// Refresh cooldown duration in milliseconds (5 minutes)
export const REFRESH_COOLDOWN_MS = 300_000;

// Spec: persist plugin order + disabled list; new plugins append, default disabled unless in DEFAULT_ENABLED_PLUGINS.
export type PluginSettings = {
  order: string[];
  disabled: string[];
};

export type AutoUpdateIntervalMinutes = 5 | 15 | 30 | 60;

/** "oled" = dark with a pure black background. */
export type ThemeMode = "system" | "light" | "dark" | "oled";

export type DisplayMode = "used" | "left";

export type ResetTimerDisplayMode = "relative" | "absolute";

export type TimeFormatMode = "auto" | "12h" | "24h";

/** "numbers"/"logos": one tray icon per provider (`use-provider-tray-icons.ts`). */
export type MenubarIconStyle = "icon" | "percent" | "bars" | "numbers" | "logos";

export type TrayProvider = "auto" | string;
export type TrayMetric = "auto" | string;

export type TrayPercentColor = string;

export type GlobalShortcut = string | null;

const SETTINGS_STORE_PATH = "settings.json";
const PLUGIN_SETTINGS_KEY = "plugins";
const AUTO_UPDATE_SETTINGS_KEY = "autoUpdateInterval";
const THEME_MODE_KEY = "themeMode";
const DISPLAY_MODE_KEY = "displayMode";
const RESET_TIMER_DISPLAY_MODE_KEY = "resetTimerDisplayMode";
const TIME_FORMAT_MODE_KEY = "timeFormatMode";
const MENUBAR_ICON_STYLE_KEY = "menubarIconStyle";
const LEGACY_MENUBAR_METRIC_KEY = "menubarMetric";
const LEGACY_TRAY_ICON_STYLE_KEY = "trayIconStyle";
const LEGACY_TRAY_SHOW_PERCENTAGE_KEY = "trayShowPercentage";
const TRAY_PROVIDER_KEY = "trayProvider";
const TRAY_METRIC_KEY = "trayMetric";
const TRAY_PERCENT_COLOR_KEY = "trayPercentColor";
const TRAY_HIDDEN_PLUGINS_KEY = "trayHiddenPlugins";
const USAGE_ALERTS_KEY = "usageAlerts";
const TRAY_LOGO_COLORS_KEY = "trayLogoColors";
const TASKBAR_STRIP_KEY = "taskbarStrip";
const SENT_USAGE_ALERTS_KEY = "sentUsageAlerts";
/** Enough for every provider x line x level for a few windows; oldest keys drop off first. */
const MAX_SENT_USAGE_ALERTS = 300;
const GLOBAL_SHORTCUT_KEY = "globalShortcut";
const START_ON_LOGIN_KEY = "startOnLogin";
const LANGUAGE_KEY = "language";

export const DEFAULT_AUTO_UPDATE_INTERVAL: AutoUpdateIntervalMinutes = 15;
export const DEFAULT_THEME_MODE: ThemeMode = "system";
export const DEFAULT_DISPLAY_MODE: DisplayMode = "left";
export const DEFAULT_RESET_TIMER_DISPLAY_MODE: ResetTimerDisplayMode = "relative";
export const DEFAULT_TIME_FORMAT_MODE: TimeFormatMode = "auto";
export const DEFAULT_MENUBAR_ICON_STYLE: MenubarIconStyle = "icon";
export const DEFAULT_TRAY_PROVIDER: TrayProvider = "auto";
export const DEFAULT_TRAY_METRIC: TrayMetric = "auto";
export const DEFAULT_TRAY_PERCENT_COLOR: TrayPercentColor = "#ffffff";
export const DEFAULT_GLOBAL_SHORTCUT: GlobalShortcut = null;
export const DEFAULT_START_ON_LOGIN = true;

const AUTO_UPDATE_INTERVALS: AutoUpdateIntervalMinutes[] = [5, 15, 30, 60];
const THEME_MODES: ThemeMode[] = ["system", "light", "dark", "oled"];
const DISPLAY_MODES: DisplayMode[] = ["used", "left"];
const RESET_TIMER_DISPLAY_MODES: ResetTimerDisplayMode[] = ["relative", "absolute"];
const TIME_FORMAT_MODES: TimeFormatMode[] = ["auto", "12h", "24h"];
const MENUBAR_ICON_STYLES: MenubarIconStyle[] = ["icon", "percent", "bars", "numbers", "logos"];

/** A settings choice; the UI renders `t(labelKey, labelVars)` and shows `hintKey` on hover. */
export type SettingOption<T> = {
  value: T;
  labelKey: MessageKey;
  labelVars?: Record<string, number>;
  hintKey?: MessageKey;
};

export const MENUBAR_ICON_STYLE_OPTIONS: SettingOption<MenubarIconStyle>[] = [
  { value: "icon", labelKey: "settings.tray.icon" },
  { value: "percent", labelKey: "settings.tray.percent" },
  { value: "bars", labelKey: "settings.tray.bars" },
  { value: "numbers", labelKey: "settings.tray.numbers" },
  { value: "logos", labelKey: "settings.tray.logos" },
];

export function isPerProviderTrayStyle(style: MenubarIconStyle): boolean {
  return style === "numbers" || style === "logos";
}

export const AUTO_UPDATE_OPTIONS: SettingOption<AutoUpdateIntervalMinutes>[] =
  AUTO_UPDATE_INTERVALS.map((value) =>
    value === 60
      ? { value, labelKey: "settings.autoRefresh.hour" }
      : { value, labelKey: "settings.autoRefresh.minutes", labelVars: { n: value } }
  );

export const THEME_OPTIONS: SettingOption<ThemeMode>[] = THEME_MODES.map((value) => ({
  value,
  labelKey: `settings.theme.${value}` as const,
  hintKey: value === "oled" ? "settings.theme.oledHint" : undefined,
}));

export const DISPLAY_MODE_OPTIONS: SettingOption<DisplayMode>[] = [
  { value: "left", labelKey: "settings.usageMode.left" },
  { value: "used", labelKey: "settings.usageMode.used" },
];

export const RESET_TIMER_DISPLAY_OPTIONS: SettingOption<ResetTimerDisplayMode>[] = [
  { value: "relative", labelKey: "settings.resetTimers.relative" },
  { value: "absolute", labelKey: "settings.resetTimers.absolute" },
];

export const TIME_FORMAT_OPTIONS: SettingOption<TimeFormatMode>[] = [
  { value: "auto", labelKey: "settings.timeFormat.auto" },
  { value: "12h", labelKey: "settings.timeFormat.12h" },
  { value: "24h", labelKey: "settings.timeFormat.24h" },
];

const store = new LazyStore(SETTINGS_STORE_PATH);

const DEFAULT_ENABLED_PLUGINS = new Set(["claude", "codex"]);

const PREFERRED_ORDER = ["claude", "codex", "gemini"];

export const DEFAULT_PLUGIN_SETTINGS: PluginSettings = {
  order: [],
  disabled: [],
};

export async function loadPluginSettings(): Promise<PluginSettings> {
  const stored = await store.get<PluginSettings>(PLUGIN_SETTINGS_KEY);
  if (!stored) return { ...DEFAULT_PLUGIN_SETTINGS };
  return {
    order: Array.isArray(stored.order) ? stored.order : [],
    disabled: Array.isArray(stored.disabled) ? stored.disabled : [],
  };
}

export async function savePluginSettings(settings: PluginSettings): Promise<void> {
  await store.set(PLUGIN_SETTINGS_KEY, settings);
  await store.save();
}

// TODO(remove after 2026-09-01): One-time Windsurf -> Devin settings migration.
export function migrateWindsurfToDevin(settings: PluginSettings): PluginSettings {
  const hasDevin = settings.order.includes("devin");
  const hasWindsurf = settings.order.includes("windsurf");
  const windsurfWasDisabled = settings.disabled.includes("windsurf");
  const order = Array.from(
    new Set(settings.order.map((id) => (id === "windsurf" ? "devin" : id)))
  );
  let disabled = settings.disabled.filter((id) => id !== "windsurf");

  if (hasWindsurf && !windsurfWasDisabled) {
    disabled = disabled.filter((id) => id !== "devin");
  }

  if (!hasDevin && windsurfWasDisabled && !disabled.includes("devin")) {
    disabled.push("devin");
  }

  return {
    order,
    disabled: Array.from(new Set(disabled)),
  };
}

function isAutoUpdateInterval(value: unknown): value is AutoUpdateIntervalMinutes {
  return (
    typeof value === "number" &&
    AUTO_UPDATE_INTERVALS.includes(value as AutoUpdateIntervalMinutes)
  );
}

export async function loadAutoUpdateInterval(): Promise<AutoUpdateIntervalMinutes> {
  const stored = await store.get<unknown>(AUTO_UPDATE_SETTINGS_KEY);
  if (isAutoUpdateInterval(stored)) return stored;
  return DEFAULT_AUTO_UPDATE_INTERVAL;
}

export async function saveAutoUpdateInterval(
  interval: AutoUpdateIntervalMinutes
): Promise<void> {
  await store.set(AUTO_UPDATE_SETTINGS_KEY, interval);
  await store.save();
}

export function normalizePluginSettings(
  settings: PluginSettings,
  plugins: PluginMeta[]
): PluginSettings {
  const knownIds = plugins.map((plugin) => plugin.id);
  const knownSet = new Set(knownIds);
  const hasSavedOrder = settings.order.length > 0;

  const order: string[] = [];
  const seen = new Set<string>();

  // If no saved order yet, seed with preferred IDs and append the rest below.
  const sourceOrder = hasSavedOrder
    ? settings.order
    : PREFERRED_ORDER.filter((id) => knownSet.has(id));

  for (const id of sourceOrder) {
    if (!knownSet.has(id) || seen.has(id)) continue;
    seen.add(id);
    order.push(id);
  }
  const newlyAdded: string[] = [];
  const tailIds = hasSavedOrder
    ? knownIds
    : knownIds
        .filter((id) => !PREFERRED_ORDER.includes(id))
        .sort((a, b) => a.localeCompare(b));

  for (const id of tailIds) {
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
      newlyAdded.push(id);
    }
  }

  const disabled = settings.disabled.filter((id) => knownSet.has(id));
  const defaultDisabledIds = hasSavedOrder ? newlyAdded : order;
  for (const id of defaultDisabledIds) {
    if (!DEFAULT_ENABLED_PLUGINS.has(id) && !disabled.includes(id)) {
      disabled.push(id);
    }
  }
  return { order, disabled };
}

export function arePluginSettingsEqual(
  a: PluginSettings,
  b: PluginSettings
): boolean {
  if (a.order.length !== b.order.length) return false;
  if (a.disabled.length !== b.disabled.length) return false;
  for (let i = 0; i < a.order.length; i += 1) {
    if (a.order[i] !== b.order[i]) return false;
  }
  for (let i = 0; i < a.disabled.length; i += 1) {
    if (a.disabled[i] !== b.disabled[i]) return false;
  }
  return true;
}

function isThemeMode(value: unknown): value is ThemeMode {
  return typeof value === "string" && THEME_MODES.includes(value as ThemeMode);
}

export async function loadThemeMode(): Promise<ThemeMode> {
  const stored = await store.get<unknown>(THEME_MODE_KEY);
  if (isThemeMode(stored)) return stored;
  return DEFAULT_THEME_MODE;
}

export async function saveThemeMode(mode: ThemeMode): Promise<void> {
  await store.set(THEME_MODE_KEY, mode);
  await store.save();
}

function isDisplayMode(value: unknown): value is DisplayMode {
  return typeof value === "string" && DISPLAY_MODES.includes(value as DisplayMode);
}

export async function loadDisplayMode(): Promise<DisplayMode> {
  const stored = await store.get<unknown>(DISPLAY_MODE_KEY);
  if (isDisplayMode(stored)) return stored;
  return DEFAULT_DISPLAY_MODE;
}

export async function saveDisplayMode(mode: DisplayMode): Promise<void> {
  await store.set(DISPLAY_MODE_KEY, mode);
  await store.save();
}

function isResetTimerDisplayMode(value: unknown): value is ResetTimerDisplayMode {
  return (
    typeof value === "string" &&
    RESET_TIMER_DISPLAY_MODES.includes(value as ResetTimerDisplayMode)
  );
}

export async function loadResetTimerDisplayMode(): Promise<ResetTimerDisplayMode> {
  const stored = await store.get<unknown>(RESET_TIMER_DISPLAY_MODE_KEY);
  if (isResetTimerDisplayMode(stored)) return stored;
  return DEFAULT_RESET_TIMER_DISPLAY_MODE;
}

export async function saveResetTimerDisplayMode(mode: ResetTimerDisplayMode): Promise<void> {
  await store.set(RESET_TIMER_DISPLAY_MODE_KEY, mode);
  await store.save();
}

function isTimeFormatMode(value: unknown): value is TimeFormatMode {
  return (
    typeof value === "string" &&
    TIME_FORMAT_MODES.includes(value as TimeFormatMode)
  );
}

export async function loadTimeFormatMode(): Promise<TimeFormatMode> {
  const stored = await store.get<unknown>(TIME_FORMAT_MODE_KEY);
  if (isTimeFormatMode(stored)) return stored;
  return DEFAULT_TIME_FORMAT_MODE;
}

export async function saveTimeFormatMode(mode: TimeFormatMode): Promise<void> {
  await store.set(TIME_FORMAT_MODE_KEY, mode);
  await store.save();
}

function isMenubarIconStyle(value: unknown): value is MenubarIconStyle {
  return (
    typeof value === "string" &&
    MENUBAR_ICON_STYLES.includes(value as MenubarIconStyle)
  );
}

export async function loadMenubarIconStyle(): Promise<MenubarIconStyle> {
  const stored = await store.get<unknown>(MENUBAR_ICON_STYLE_KEY);
  // Migrate legacy values
  if (stored === "provider") return "icon";
  if (stored === "donut") return "percent";
  if (isMenubarIconStyle(stored)) return stored;
  return DEFAULT_MENUBAR_ICON_STYLE;
}

export async function saveMenubarIconStyle(style: MenubarIconStyle): Promise<void> {
  await store.set(MENUBAR_ICON_STYLE_KEY, style);
  await store.save();
}

export async function loadTrayProvider(): Promise<TrayProvider> {
  const stored = await store.get<unknown>(TRAY_PROVIDER_KEY);
  return typeof stored === "string" && stored.length > 0 ? stored : DEFAULT_TRAY_PROVIDER;
}

export async function saveTrayProvider(value: TrayProvider): Promise<void> {
  await store.set(TRAY_PROVIDER_KEY, value);
  await store.save();
}

export async function loadTrayMetric(): Promise<TrayMetric> {
  const stored = await store.get<unknown>(TRAY_METRIC_KEY);
  return typeof stored === "string" && stored.length > 0 ? stored : DEFAULT_TRAY_METRIC;
}

export async function saveTrayMetric(value: TrayMetric): Promise<void> {
  await store.set(TRAY_METRIC_KEY, value);
  await store.save();
}

export async function loadUsageAlerts(): Promise<boolean> {
  const stored = await store.get<unknown>(USAGE_ALERTS_KEY);
  return typeof stored === "boolean" ? stored : true;
}

export async function saveUsageAlerts(value: boolean): Promise<void> {
  await store.set(USAGE_ALERTS_KEY, value);
  await store.save();
}

async function loadBoolean(key: string, fallback: boolean): Promise<boolean> {
  const stored = await store.get<unknown>(key);
  return typeof stored === "boolean" ? stored : fallback;
}

async function saveBoolean(key: string, value: boolean): Promise<void> {
  await store.set(key, value);
  await store.save();
}

/** Provider logos in their brand color (tray "logos" style and the taskbar strip). */
export const loadTrayLogoColors = () => loadBoolean(TRAY_LOGO_COLORS_KEY, true);
export const saveTrayLogoColors = (value: boolean) => saveBoolean(TRAY_LOGO_COLORS_KEY, value);

/** Experimental: usage text embedded in the taskbar next to the tray (`taskbar_strip.rs`). */
export const loadTaskbarStrip = () => loadBoolean(TASKBAR_STRIP_KEY, false);
export const saveTaskbarStrip = (value: boolean) => saveBoolean(TASKBAR_STRIP_KEY, value);

export async function loadSentUsageAlerts(): Promise<string[]> {
  const stored = await store.get<unknown>(SENT_USAGE_ALERTS_KEY);
  return Array.isArray(stored) ? stored.filter((key): key is string => typeof key === "string") : [];
}

export async function saveSentUsageAlerts(keys: string[]): Promise<void> {
  await store.set(SENT_USAGE_ALERTS_KEY, keys.slice(-MAX_SENT_USAGE_ALERTS));
  await store.save();
}

/** Providers kept in the side nav but left out of the tray icon/tooltip. */
export async function loadTrayHiddenPlugins(): Promise<string[]> {
  const stored = await store.get<unknown>(TRAY_HIDDEN_PLUGINS_KEY);
  return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === "string") : [];
}

export async function saveTrayHiddenPlugins(ids: string[]): Promise<void> {
  await store.set(TRAY_HIDDEN_PLUGINS_KEY, ids);
  await store.save();
}

export async function loadTrayPercentColor(): Promise<TrayPercentColor> {
  const stored = await store.get<unknown>(TRAY_PERCENT_COLOR_KEY);
  return typeof stored === "string" && stored.length > 0 ? stored : DEFAULT_TRAY_PERCENT_COLOR;
}

export async function saveTrayPercentColor(value: TrayPercentColor): Promise<void> {
  await store.set(TRAY_PERCENT_COLOR_KEY, value);
  await store.save();
}

type LegacyStoreWithDelete = {
  delete?: (key: string) => Promise<void>;
};

async function deleteStoreKey(key: string): Promise<void> {
  const maybeDelete = (store as unknown as LegacyStoreWithDelete).delete;
  if (typeof maybeDelete === "function") {
    await maybeDelete.call(store, key);
    return;
  }
  // Fallback for store implementations without delete support.
  await store.set(key, null);
}

export async function migrateLegacyTraySettings(): Promise<void> {
  const [legacyTrayStyle, legacyShowPercentage, currentMenubarStyle, legacyMenubarMetric, currentTrayMetric] =
    await Promise.all([
      store.get<unknown>(LEGACY_TRAY_ICON_STYLE_KEY),
      store.get<unknown>(LEGACY_TRAY_SHOW_PERCENTAGE_KEY),
      store.get<unknown>(MENUBAR_ICON_STYLE_KEY),
      store.get<unknown>(LEGACY_MENUBAR_METRIC_KEY),
      store.get<unknown>(TRAY_METRIC_KEY),
    ]);

  const hasLegacyTrayStyle = legacyTrayStyle != null;
  const hasLegacyShowPercentage = legacyShowPercentage != null;
  const hasLegacyMenubarMetric = legacyMenubarMetric != null;
  if (!hasLegacyTrayStyle && !hasLegacyShowPercentage && !hasLegacyMenubarMetric) return;

  // The old Default/Weekly "menubarMetric" duplicated trayMetric and only the bars style read it,
  // so a Weekly pick in the Metric dropdown was ignored there. trayMetric is now the only setting.
  if (legacyMenubarMetric === "weekly" && (currentTrayMetric == null || currentTrayMetric === "auto")) {
    await store.set(TRAY_METRIC_KEY, "Weekly");
  }

  if (hasLegacyTrayStyle && currentMenubarStyle == null) {
    if (legacyTrayStyle === "bars") {
      await store.set(MENUBAR_ICON_STYLE_KEY, "bars");
    } else if (legacyTrayStyle === "circle") {
      await store.set(MENUBAR_ICON_STYLE_KEY, "percent");
    }
  }

  const removals: Promise<void>[] = [];
  if (hasLegacyTrayStyle) removals.push(deleteStoreKey(LEGACY_TRAY_ICON_STYLE_KEY));
  if (hasLegacyShowPercentage) removals.push(deleteStoreKey(LEGACY_TRAY_SHOW_PERCENTAGE_KEY));
  if (hasLegacyMenubarMetric) removals.push(deleteStoreKey(LEGACY_MENUBAR_METRIC_KEY));
  await Promise.all(removals);
  await store.save();
}

export function getEnabledPluginIds(settings: PluginSettings): string[] {
  const disabledSet = new Set(settings.disabled);
  return settings.order.filter((id) => !disabledSet.has(id));
}

function isGlobalShortcut(value: unknown): value is GlobalShortcut {
  if (value === null) return true;
  return typeof value === "string";
}

export async function loadGlobalShortcut(): Promise<GlobalShortcut> {
  const stored = await store.get<unknown>(GLOBAL_SHORTCUT_KEY);
  if (isGlobalShortcut(stored)) return stored;
  return DEFAULT_GLOBAL_SHORTCUT;
}

export async function saveGlobalShortcut(shortcut: GlobalShortcut): Promise<void> {
  await store.set(GLOBAL_SHORTCUT_KEY, shortcut);
  await store.save();
}

export async function loadStartOnLogin(): Promise<boolean> {
  const stored = await store.get<unknown>(START_ON_LOGIN_KEY);
  if (typeof stored === "boolean") return stored;
  return DEFAULT_START_ON_LOGIN;
}

export async function saveStartOnLogin(value: boolean): Promise<void> {
  await store.set(START_ON_LOGIN_KEY, value);
  await store.save();
}

export async function loadLanguage(): Promise<LanguagePreference> {
  const stored = await store.get<unknown>(LANGUAGE_KEY);
  return isLanguagePreference(stored) ? stored : "system";
}

export async function saveLanguage(value: LanguagePreference): Promise<void> {
  await store.set(LANGUAGE_KEY, value);
  await store.save();
}
