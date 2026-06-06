import { useCallback } from "react"
import {
  saveDisplayMode,
  saveMenubarIconStyle,
  saveMenubarMetric,
  saveResetTimerDisplayMode,
  saveThemeMode,
  saveTimeFormatMode,
  saveTrayMetric,
  saveTrayPercentColor,
  saveTrayProvider,
  type DisplayMode,
  type MenubarIconStyle,
  type MenubarMetric,
  type ResetTimerDisplayMode,
  type ThemeMode,
  type TimeFormatMode,
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
  setTimeFormatMode: (value: TimeFormatMode) => void
  setMenubarIconStyle: (value: MenubarIconStyle) => void
  setTrayProvider: (value: TrayProvider) => void
  setTrayMetric: (value: TrayMetric) => void
  setTrayPercentColor: (value: TrayPercentColor) => void
  setMenubarMetric: (value: MenubarMetric) => void
  scheduleTrayIconUpdate: ScheduleTrayIconUpdate
}

export function useSettingsDisplayActions({
  setThemeMode,
  setDisplayMode,
  resetTimerDisplayMode,
  setResetTimerDisplayMode,
  setTimeFormatMode,
  setMenubarIconStyle,
  setTrayProvider,
  setTrayMetric,
  setTrayPercentColor,
  setMenubarMetric,
  scheduleTrayIconUpdate,
}: UseSettingsDisplayActionsArgs) {
  const handleThemeModeChange = useCallback((mode: ThemeMode) => {
    setThemeMode(mode)
    void saveThemeMode(mode).catch((error) => {
      console.error("Failed to save theme mode:", error)
    })
  }, [setThemeMode])

  const handleDisplayModeChange = useCallback((mode: DisplayMode) => {
    setDisplayMode(mode)
    scheduleTrayIconUpdate("settings", 0)
    void saveDisplayMode(mode).catch((error) => {
      console.error("Failed to save display mode:", error)
    })
  }, [scheduleTrayIconUpdate, setDisplayMode])

  const handleResetTimerDisplayModeChange = useCallback((mode: ResetTimerDisplayMode) => {
    setResetTimerDisplayMode(mode)
    void saveResetTimerDisplayMode(mode).catch((error) => {
      console.error("Failed to save reset timer display mode:", error)
    })
  }, [setResetTimerDisplayMode])

  const handleResetTimerDisplayModeToggle = useCallback(() => {
    const next = resetTimerDisplayMode === "relative" ? "absolute" : "relative"
    handleResetTimerDisplayModeChange(next)
  }, [handleResetTimerDisplayModeChange, resetTimerDisplayMode])

  const handleTimeFormatModeChange = useCallback((mode: TimeFormatMode) => {
    setTimeFormatMode(mode)
    void saveTimeFormatMode(mode).catch((error) => {
      console.error("Failed to save time format mode:", error)
    })
  }, [setTimeFormatMode])

  const handleMenubarIconStyleChange = useCallback((style: MenubarIconStyle) => {
    setMenubarIconStyle(style)
    scheduleTrayIconUpdate("settings", 0)
    void saveMenubarIconStyle(style).catch((error) => {
      console.error("Failed to save menubar icon style:", error)
    })
  }, [scheduleTrayIconUpdate, setMenubarIconStyle])

  const handleTrayProviderChange = useCallback((provider: TrayProvider) => {
    setTrayProvider(provider)
    scheduleTrayIconUpdate("settings", 0)
    void saveTrayProvider(provider).catch((error) => {
      console.error("Failed to save tray provider:", error)
    })
  }, [scheduleTrayIconUpdate, setTrayProvider])

  const handleTrayMetricChange = useCallback((metric: TrayMetric) => {
    setTrayMetric(metric)
    scheduleTrayIconUpdate("settings", 0)
    void saveTrayMetric(metric).catch((error) => {
      console.error("Failed to save tray metric:", error)
    })
  }, [scheduleTrayIconUpdate, setTrayMetric])

  const handleTrayPercentColorChange = useCallback((color: TrayPercentColor) => {
    setTrayPercentColor(color)
    scheduleTrayIconUpdate("settings", 0)
    void saveTrayPercentColor(color).catch((error) => {
      console.error("Failed to save tray percent color:", error)
    })
  }, [scheduleTrayIconUpdate, setTrayPercentColor])

  const handleMenubarMetricChange = useCallback((metric: MenubarMetric) => {
    setMenubarMetric(metric)
    scheduleTrayIconUpdate("settings", 0)
    void saveMenubarMetric(metric).catch((error) => {
      console.error("Failed to save menubar metric:", error)
    })
  }, [scheduleTrayIconUpdate, setMenubarMetric])

  return {
    handleThemeModeChange,
    handleDisplayModeChange,
    handleResetTimerDisplayModeChange,
    handleResetTimerDisplayModeToggle,
    handleTimeFormatModeChange,
    handleMenubarIconStyleChange,
    handleTrayProviderChange,
    handleTrayMetricChange,
    handleTrayPercentColorChange,
    handleMenubarMetricChange,
  }
}
