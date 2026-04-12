import { useCallback } from "react"
import { track } from "@/lib/analytics"
import {
  saveDisplayMode,
  saveMenubarIconStyle,
  saveResetTimerDisplayMode,
  saveThemeMode,
  saveTrayMetric,
  saveTrayPercentColor,
  saveTrayProvider,
  type DisplayMode,
  type MenubarIconStyle,
  type ResetTimerDisplayMode,
  type ThemeMode,
  type TrayMetric,
  type TrayPercentColor,
  type TrayProvider,
} from "@/lib/settings"

type ScheduleTrayIconUpdate = (reason: "probe" | "settings" | "init", delayMs?: number) => void

type UseSettingsDisplayActionsArgs = {
  setThemeMode: (value: ThemeMode) => void
  setDisplayMode: (value: DisplayMode) => void
  resetTimerDisplayMode: ResetTimerDisplayMode
  setResetTimerDisplayMode: (value: ResetTimerDisplayMode) => void
  setMenubarIconStyle: (value: MenubarIconStyle) => void
  setTrayProvider: (value: TrayProvider) => void
  setTrayMetric: (value: TrayMetric) => void
  setTrayPercentColor: (value: TrayPercentColor) => void
  scheduleTrayIconUpdate: ScheduleTrayIconUpdate
}

export function useSettingsDisplayActions({
  setThemeMode,
  setDisplayMode,
  resetTimerDisplayMode,
  setResetTimerDisplayMode,
  setMenubarIconStyle,
  setTrayProvider,
  setTrayMetric,
  setTrayPercentColor,
  scheduleTrayIconUpdate,
}: UseSettingsDisplayActionsArgs) {
  const handleThemeModeChange = useCallback((mode: ThemeMode) => {
    track("setting_changed", { setting: "theme", value: mode })
    setThemeMode(mode)
    void saveThemeMode(mode).catch((error) => {
      console.error("Failed to save theme mode:", error)
    })
  }, [setThemeMode])

  const handleDisplayModeChange = useCallback((mode: DisplayMode) => {
    track("setting_changed", { setting: "display_mode", value: mode })
    setDisplayMode(mode)
    scheduleTrayIconUpdate("settings", 0)
    void saveDisplayMode(mode).catch((error) => {
      console.error("Failed to save display mode:", error)
    })
  }, [scheduleTrayIconUpdate, setDisplayMode])

  const handleResetTimerDisplayModeChange = useCallback((mode: ResetTimerDisplayMode) => {
    track("setting_changed", { setting: "reset_timer_display_mode", value: mode })
    setResetTimerDisplayMode(mode)
    void saveResetTimerDisplayMode(mode).catch((error) => {
      console.error("Failed to save reset timer display mode:", error)
    })
  }, [setResetTimerDisplayMode])

  const handleResetTimerDisplayModeToggle = useCallback(() => {
    const next = resetTimerDisplayMode === "relative" ? "absolute" : "relative"
    handleResetTimerDisplayModeChange(next)
  }, [handleResetTimerDisplayModeChange, resetTimerDisplayMode])

  const handleMenubarIconStyleChange = useCallback((style: MenubarIconStyle) => {
    track("setting_changed", { setting: "menubar_icon_style", value: style })
    setMenubarIconStyle(style)
    scheduleTrayIconUpdate("settings", 0)
    void saveMenubarIconStyle(style).catch((error) => {
      console.error("Failed to save menubar icon style:", error)
    })
  }, [scheduleTrayIconUpdate, setMenubarIconStyle])

  const handleTrayProviderChange = useCallback((provider: TrayProvider) => {
    track("setting_changed", { setting: "tray_provider", value: provider })
    setTrayProvider(provider)
    scheduleTrayIconUpdate("settings", 0)
    void saveTrayProvider(provider).catch((error) => {
      console.error("Failed to save tray provider:", error)
    })
  }, [scheduleTrayIconUpdate, setTrayProvider])

  const handleTrayMetricChange = useCallback((metric: TrayMetric) => {
    track("setting_changed", { setting: "tray_metric", value: metric })
    setTrayMetric(metric)
    scheduleTrayIconUpdate("settings", 0)
    void saveTrayMetric(metric).catch((error) => {
      console.error("Failed to save tray metric:", error)
    })
  }, [scheduleTrayIconUpdate, setTrayMetric])

  const handleTrayPercentColorChange = useCallback((color: TrayPercentColor) => {
    track("setting_changed", { setting: "tray_percent_color", value: color })
    setTrayPercentColor(color)
    scheduleTrayIconUpdate("settings", 0)
    void saveTrayPercentColor(color).catch((error) => {
      console.error("Failed to save tray percent color:", error)
    })
  }, [scheduleTrayIconUpdate, setTrayPercentColor])

  return {
    handleThemeModeChange,
    handleDisplayModeChange,
    handleResetTimerDisplayModeChange,
    handleResetTimerDisplayModeToggle,
    handleMenubarIconStyleChange,
    handleTrayProviderChange,
    handleTrayMetricChange,
    handleTrayPercentColorChange,
  }
}
