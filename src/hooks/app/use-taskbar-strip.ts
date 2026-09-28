import { useEffect, useRef } from "react"
import { create } from "zustand"
import { invoke } from "@tauri-apps/api/core"
import type { PluginState } from "@/hooks/app/types"
import { useTaskbarIsLight } from "@/hooks/app/use-provider-tray-icons"
import type { PluginMeta } from "@/lib/plugin-types"
import type { DisplayMode, PluginSettings, TaskbarStripStyle } from "@/lib/settings"
import {
  buildTaskbarStripItems,
  makeTaskbarStripSvg,
  measureTextWithCanvas,
  stripPluginSettings,
} from "@/lib/taskbar-strip"
import { rasterizeSvgToRgba } from "@/lib/tray-bars-icon"
import { getTrayPrimaryBars } from "@/lib/tray-primary-progress"
import { bytesToBase64 } from "@/lib/tray-provider-icons"

const UPDATE_DEBOUNCE_MS = 400

/** Latest strip drawing, shown as a live preview in Settings. */
export const useTaskbarStripPreview = create<{
  preview: { svg: string; width: number; height: number; scale: number; onLightTaskbar: boolean } | null
}>(() => ({ preview: null }))

/** Experimental taskbar strip (`taskbar_strip.rs`): draws logos + session/weekly for the host. */
export function useTaskbarStrip(args: {
  enabled: boolean
  pluginsMeta: PluginMeta[]
  pluginSettings: PluginSettings | null
  pluginStates: Record<string, PluginState>
  displayMode: DisplayMode
  logoColors: boolean
  style: TaskbarStripStyle
  themeMode: string
}) {
  const { enabled, pluginsMeta, pluginSettings, pluginStates, displayMode, logoColors, style, themeMode } = args
  const taskbarIsLight = useTaskbarIsLight(themeMode)
  const showingRef = useRef(false)

  useEffect(() => {
    if (!enabled && !showingRef.current) return
    const timer = window.setTimeout(() => {
      const scale = window.devicePixelRatio || 1
      const settings = enabled && pluginSettings ? stripPluginSettings(style.providers, pluginSettings) : null
      const barArgs = { pluginsMeta, pluginSettings: settings, pluginStates, maxBars: settings?.order.length ?? 0, displayMode }
      const items = settings
        ? buildTaskbarStripItems({
            primaryBars: getTrayPrimaryBars(barArgs),
            weeklyBars: getTrayPrimaryBars({ ...barArgs, preferWeekly: true }),
            pluginsMeta,
            onLightTaskbar: taskbarIsLight,
            logoColors,
            displayMode,
            style,
          })
        : []
      const drawing = items.length > 0 ? makeTaskbarStripSvg({ items, style, scale, measure: measureTextWithCanvas }) : null
      useTaskbarStripPreview.setState({ preview: drawing && { ...drawing, scale, onLightTaskbar: taskbarIsLight } })
      const render = async () =>
        drawing && {
          rgba: bytesToBase64(await rasterizeSvgToRgba(drawing.svg, drawing.width, drawing.height)),
          width: drawing.width,
          height: drawing.height,
        }
      render()
        .then((image) => invoke("set_taskbar_strip", { image }).then(() => (showingRef.current = image !== null)))
        .catch((error) => console.error("Failed to update the taskbar strip:", error))
    }, UPDATE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [enabled, pluginsMeta, pluginSettings, pluginStates, displayMode, logoColors, style, taskbarIsLight])
}
