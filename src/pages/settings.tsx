import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Eye, EyeOff, GripVertical } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { GlobalShortcutSection } from "@/components/global-shortcut-section";
import { SegmentedControl, SettingsSection } from "@/components/settings-section";
import { getBarFillLayout, getTrayIconSizePx } from "@/lib/tray-bars-icon";
import {
  AUTO_UPDATE_OPTIONS,
  DISPLAY_MODE_OPTIONS,
  MENUBAR_ICON_STYLE_OPTIONS,
  RESET_TIMER_DISPLAY_OPTIONS,
  saveLanguage,
  saveTrayHiddenPlugins,
  saveUsageAlerts,
  THEME_OPTIONS,
  TIME_FORMAT_OPTIONS,
  type AutoUpdateIntervalMinutes,
  type DisplayMode,
  type GlobalShortcut,
  type MenubarIconStyle,
  type ResetTimerDisplayMode,
  type ThemeMode,
  type TimeFormatMode,
} from "@/lib/settings";
import { getTimeFormatter } from "@/lib/reset-tooltip";
import { LANGUAGES, resolveLanguage, t, useLocaleStore, type LanguagePreference } from "@/lib/i18n";
import type { TraySettingsPreview } from "@/hooks/app/use-tray-icon";
import { cn } from "@/lib/utils";
import { useAppPreferencesStore } from "@/stores/app-preferences-store";

interface PluginConfig {
  id: string;
  name: string;
  enabled: boolean;
}

const TRAY_PREVIEW_SIZE_PX = getTrayIconSizePx(1) / 2;

const PREVIEW_BAR_TRACK_PX = 20;

// Sample time for the time-format and absolute-reset examples.
const EXAMPLE_TIME = new Date(2026, 1, 2, 11, 4);

function getPreviewBarLayout(fraction: number): { fillPercent: number; remainderPercent: number } {
  const { fillW, remainderDrawW } = getBarFillLayout(PREVIEW_BAR_TRACK_PX, fraction);
  return {
    fillPercent: (fillW / PREVIEW_BAR_TRACK_PX) * 100,
    remainderPercent: (remainderDrawW / PREVIEW_BAR_TRACK_PX) * 100,
  };
}

function TrayIconStylePreview({
  style,
  traySettingsPreview,
}: {
  style: MenubarIconStyle;
  traySettingsPreview: TraySettingsPreview;
}) {
  if (style === "icon") {
    return (
      <img
        src="/icon.png"
        alt=""
        className="shrink-0"
        style={{ width: `${TRAY_PREVIEW_SIZE_PX}px`, height: `${TRAY_PREVIEW_SIZE_PX}px` }}
      />
    );
  }

  if (style === "bars") {
    const fractions = traySettingsPreview.bars.length > 0
      ? traySettingsPreview.bars.map((b) => b.fraction ?? 0)
      : [0.83, 0.7, 0.56];

    return (
      <div className="flex flex-col gap-0.5 w-5">
        {fractions.map((fraction, i) => {
          const { fillPercent, remainderPercent } = getPreviewBarLayout(fraction);
          return (
            <div key={i} className="relative h-1 rounded-sm bg-current/15">
              {remainderPercent > 0 && (
                <span
                  aria-hidden
                  className="absolute right-0 inset-y-0 bg-current/20"
                  style={{ width: `${remainderPercent}%`, borderRadius: "1px 2px 2px 1px" }}
                />
              )}
              <div className="h-1 bg-current" style={{ width: `${fillPercent}%`, borderRadius: "2px 1px 1px 2px" }} />
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <span className="text-[13px] font-bold tabular-nums leading-none">
      {(traySettingsPreview.providerPercentText || "0%").replace(/%$/, "")}
    </span>
  );
}

function SortablePluginItem({
  plugin,
  onToggle,
  inTray,
  onToggleTray,
}: {
  plugin: PluginConfig;
  onToggle: (id: string) => void;
  inTray: boolean;
  onToggleTray: (id: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: plugin.id });

  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition }}
      onClick={() => onToggle(plugin.id)}
      className={cn(
        "flex items-center gap-2.5 px-2 h-9 rounded-md cursor-pointer hover:bg-accent transition-colors",
        isDragging && "opacity-50 bg-accent"
      )}
    >
      <button
        type="button"
        onClick={(e) => e.stopPropagation()}
        className="touch-none cursor-grab active:cursor-grabbing text-muted-foreground hover:text-foreground transition-colors"
        {...attributes}
        {...listeners}
      >
        <GripVertical className="h-4 w-4" />
      </button>

      <span className={cn("flex-1 text-[13px]", !plugin.enabled && "text-muted-foreground")}>
        {plugin.name}
      </span>

      {plugin.enabled && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleTray(plugin.id);
          }}
          title={t(inTray ? "settings.plugins.inTray" : "settings.plugins.notInTray")}
          aria-label={t(inTray ? "settings.plugins.inTray" : "settings.plugins.notInTray")}
          aria-pressed={inTray}
          className={cn(
            "inline-flex items-center justify-center size-6 rounded-md hover:bg-accent transition-colors",
            inTray ? "text-foreground" : "text-muted-foreground/60"
          )}
        >
          {inTray ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </button>
      )}

      {/* Wrap to stop Base UI's internal input.click() from bubbling to the row div */}
      <span onClick={(e) => e.stopPropagation()}>
        <Checkbox
          key={`${plugin.id}-${plugin.enabled}`}
          checked={plugin.enabled}
          onCheckedChange={() => onToggle(plugin.id)}
        />
      </span>
    </div>
  );
}

function LanguageSection() {
  const preference = useLocaleStore((state) => state.preference);
  const setPreference = useLocaleStore((state) => state.setPreference);
  const systemLanguage = LANGUAGES.find((l) => l.code === resolveLanguage("system"));

  const handleChange = (value: LanguagePreference) => {
    setPreference(value);
    void saveLanguage(value).catch((error) => {
      console.error("Failed to save language:", error);
    });
  };

  return (
    <SettingsSection title={t("settings.language.title")} description={t("settings.language.desc")}>
      <select
        aria-label={t("settings.language.title")}
        value={preference}
        onChange={(e) => handleChange(e.target.value as LanguagePreference)}
        className="fluent-control w-full"
      >
        <option value="system">
          {t("settings.language.system")}
          {systemLanguage ? ` (${systemLanguage.name})` : ""}
        </option>
        {LANGUAGES.map((language) => (
          <option key={language.code} value={language.code}>
            {language.name}
          </option>
        ))}
      </select>
    </SettingsSection>
  );
}

function NotificationsSection() {
  const usageAlerts = useAppPreferencesStore((state) => state.usageAlerts);
  const setUsageAlerts = useAppPreferencesStore((state) => state.setUsageAlerts);
  return (
    <SettingsSection title={t("settings.alerts.title")} description={t("settings.alerts.desc")}>
      <label className="flex items-center gap-2 text-[13px] select-none text-foreground">
        <Checkbox
          key={`usage-alerts-${usageAlerts}`}
          checked={usageAlerts}
          onCheckedChange={(checked) => {
            const next = checked === true;
            setUsageAlerts(next);
            void saveUsageAlerts(next).catch((error) => {
              console.error("Failed to save usage alerts setting:", error);
            });
          }}
        />
        {t("settings.alerts.label")}
      </label>
    </SettingsSection>
  );
}

interface SettingsPageProps {
  plugins: PluginConfig[];
  onReorder: (orderedIds: string[]) => void;
  onToggle: (id: string) => void;
  autoUpdateInterval: AutoUpdateIntervalMinutes;
  onAutoUpdateIntervalChange: (value: AutoUpdateIntervalMinutes) => void;
  themeMode: ThemeMode;
  onThemeModeChange: (value: ThemeMode) => void;
  displayMode: DisplayMode;
  onDisplayModeChange: (value: DisplayMode) => void;
  resetTimerDisplayMode: ResetTimerDisplayMode;
  onResetTimerDisplayModeChange: (value: ResetTimerDisplayMode) => void;
  timeFormatMode: TimeFormatMode;
  onTimeFormatModeChange: (value: TimeFormatMode) => void;
  menubarIconStyle: MenubarIconStyle;
  onMenubarIconStyleChange: (value: MenubarIconStyle) => void;
  trayProvider: string;
  onTrayProviderChange: (value: string) => void;
  trayMetric: string;
  onTrayMetricChange: (value: string) => void;
  trayPercentColor: string;
  onTrayPercentColorChange: (value: string) => void;
  traySettingsPreview: TraySettingsPreview;
  globalShortcut: GlobalShortcut;
  onGlobalShortcutChange: (value: GlobalShortcut) => void;
  startOnLogin: boolean;
  onStartOnLoginChange: (value: boolean) => void;
}

/** Choice with a second, smaller line (an example of what it looks like). */
function OptionWithExample({ label, example, isActive }: { label: string; example: string; isActive: boolean }) {
  return (
    <span className="flex flex-col items-center leading-tight">
      <span>{label}</span>
      <span className={cn("text-[11px] font-normal", isActive ? "text-primary-foreground/80" : "text-muted-foreground")}>
        {example}
      </span>
    </span>
  );
}

export function SettingsPage({
  plugins,
  onReorder,
  onToggle,
  autoUpdateInterval,
  onAutoUpdateIntervalChange,
  themeMode,
  onThemeModeChange,
  displayMode,
  onDisplayModeChange,
  resetTimerDisplayMode,
  onResetTimerDisplayModeChange,
  timeFormatMode,
  onTimeFormatModeChange,
  menubarIconStyle,
  onMenubarIconStyleChange,
  trayProvider,
  onTrayProviderChange,
  trayMetric,
  onTrayMetricChange,
  trayPercentColor,
  onTrayPercentColorChange,
  traySettingsPreview,
  globalShortcut,
  onGlobalShortcutChange,
  startOnLogin,
  onStartOnLoginChange,
}: SettingsPageProps) {
  const trayHiddenPlugins = useAppPreferencesStore((state) => state.trayHiddenPlugins);
  const setTrayHiddenPlugins = useAppPreferencesStore((state) => state.setTrayHiddenPlugins);
  const handleToggleTray = (id: string) => {
    const next = trayHiddenPlugins.includes(id)
      ? trayHiddenPlugins.filter((hiddenId) => hiddenId !== id)
      : [...trayHiddenPlugins, id];
    setTrayHiddenPlugins(next);
    void saveTrayHiddenPlugins(next).catch((error) => {
      console.error("Failed to save tray-hidden providers:", error);
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  // Enabled providers first (stable sort keeps the user's order inside each group); dragging works
  // on this list, so a reorder saves the grouped order.
  const sortedPlugins = [...plugins].sort((a, b) => Number(b.enabled) - Number(a.enabled));

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      const oldIndex = sortedPlugins.findIndex((item) => item.id === active.id);
      const newIndex = sortedPlugins.findIndex((item) => item.id === over.id);
      if (oldIndex === -1 || newIndex === -1) return;
      onReorder(arrayMove(sortedPlugins, oldIndex, newIndex).map((item) => item.id));
    }
  };

  return (
    <div className="py-2 space-y-1">
      <SettingsSection title={t("settings.autoRefresh.title")} description={t("settings.autoRefresh.desc")}>
        <SegmentedControl
          ariaLabel={t("settings.autoRefresh.title")}
          options={AUTO_UPDATE_OPTIONS}
          value={autoUpdateInterval}
          onChange={onAutoUpdateIntervalChange}
        />
      </SettingsSection>

      <SettingsSection title={t("settings.usageMode.title")} description={t("settings.usageMode.desc")}>
        <SegmentedControl
          ariaLabel={t("settings.usageMode.title")}
          options={DISPLAY_MODE_OPTIONS}
          value={displayMode}
          onChange={onDisplayModeChange}
        />
      </SettingsSection>

      <SettingsSection title={t("settings.resetTimers.title")} description={t("settings.resetTimers.desc")}>
        <SegmentedControl
          ariaLabel={t("settings.resetTimers.title")}
          options={RESET_TIMER_DISPLAY_OPTIONS}
          value={resetTimerDisplayMode}
          onChange={onResetTimerDisplayModeChange}
          itemClassName="h-auto py-1"
          renderOption={(option, isActive) => (
            <OptionWithExample
              label={t(option.labelKey)}
              isActive={isActive}
              example={
                option.value === "relative"
                  ? t("duration.hm", { h: 5, m: 12 })
                  : t("settings.resetTimers.todayAt", { time: getTimeFormatter(timeFormatMode).format(EXAMPLE_TIME) })
              }
            />
          )}
        />
      </SettingsSection>

      <SettingsSection title={t("settings.timeFormat.title")} description={t("settings.timeFormat.desc")}>
        <SegmentedControl
          ariaLabel={t("settings.timeFormat.title")}
          options={TIME_FORMAT_OPTIONS}
          value={timeFormatMode}
          onChange={onTimeFormatModeChange}
          itemClassName="h-auto py-1"
          renderOption={(option, isActive) => (
            <OptionWithExample
              label={t(option.labelKey)}
              isActive={isActive}
              example={getTimeFormatter(option.value).format(EXAMPLE_TIME)}
            />
          )}
        />
      </SettingsSection>

      <SettingsSection title={t("settings.tray.title")} description={t("settings.tray.desc")}>
        <SegmentedControl
          ariaLabel={t("settings.tray.title")}
          options={MENUBAR_ICON_STYLE_OPTIONS}
          value={menubarIconStyle}
          onChange={onMenubarIconStyleChange}
          itemClassName="h-9 flex items-center justify-center"
          renderOption={(option) => (
            <TrayIconStylePreview style={option.value} traySettingsPreview={traySettingsPreview} />
          )}
        />
        {menubarIconStyle !== "icon" && (
          <div className="flex gap-2 mt-2">
            <label className="flex-1 text-xs text-muted-foreground">
              <span className="mb-1 block">{t("settings.tray.provider")}</span>
              <select
                aria-label="Tray provider"
                value={trayProvider}
                onChange={(e) => onTrayProviderChange(e.target.value)}
                className="fluent-control w-full"
              >
                <option value="auto">{t("settings.tray.auto")}</option>
                <option value="tightest">{t("settings.tray.tightest")}</option>
                {plugins.filter((p) => p.enabled).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </label>
            <label className="flex-1 text-xs text-muted-foreground">
              <span className="mb-1 block">{t("settings.tray.metric")}</span>
              <select
                aria-label="Tray metric"
                value={trayMetric}
                onChange={(e) => onTrayMetricChange(e.target.value)}
                className="fluent-control w-full"
              >
                <option value="auto">{t("settings.tray.auto")}</option>
                <option value="Session">{t("label.Session")}</option>
                <option value="Weekly">{t("label.Weekly")}</option>
              </select>
            </label>
            {menubarIconStyle === "percent" && (
              <label className="w-14 text-xs text-muted-foreground">
                <span className="mb-1 block">{t("settings.tray.color")}</span>
                <input
                  type="color"
                  value={trayPercentColor}
                  onChange={(e) => onTrayPercentColorChange(e.target.value)}
                  className="fluent-control w-full cursor-pointer px-1"
                  title={t("settings.tray.colorTitle")}
                />
              </label>
            )}
          </div>
        )}
      </SettingsSection>

      <SettingsSection title={t("settings.theme.title")} description={t("settings.theme.desc")}>
        <SegmentedControl
          ariaLabel={t("settings.theme.title")}
          options={THEME_OPTIONS}
          value={themeMode}
          onChange={onThemeModeChange}
        />
      </SettingsSection>

      <LanguageSection />

      <GlobalShortcutSection globalShortcut={globalShortcut} onGlobalShortcutChange={onGlobalShortcutChange} />

      <NotificationsSection />

      <SettingsSection title={t("settings.startOnLogin.title")} description={t("settings.startOnLogin.desc")}>
        <label className="flex items-center gap-2 text-[13px] select-none text-foreground">
          <Checkbox
            key={`start-on-login-${startOnLogin}`}
            checked={startOnLogin}
            onCheckedChange={(checked) => onStartOnLoginChange(checked === true)}
          />
          {t("settings.startOnLogin.label")}
        </label>
      </SettingsSection>

      <SettingsSection title={t("settings.plugins.title")} description={t("settings.plugins.desc")}>
        <div className="-mx-1">
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
            <SortableContext items={sortedPlugins.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              {sortedPlugins.map((plugin) => (
                <SortablePluginItem
                  key={plugin.id}
                  plugin={plugin}
                  onToggle={onToggle}
                  inTray={!trayHiddenPlugins.includes(plugin.id)}
                  onToggleTray={handleToggleTray}
                />
              ))}
            </SortableContext>
          </DndContext>
        </div>
      </SettingsSection>
    </div>
  );
}
