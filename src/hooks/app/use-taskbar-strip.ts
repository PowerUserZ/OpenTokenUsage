import { useEffect, useRef } from "react"
import { invoke } from "@tauri-apps/api/core"
import type { PluginState } from "@/hooks/app/types"
import { useTaskbarIsLight } from "@/hooks/app/use-provider-tray-icons"
import type { PluginMeta } from "@/lib/plugin-types"
import type { DisplayMode, PluginSettings } from "@/lib/settings"
import { buildTaskbarStripItems, makeTaskbarStripSvg, measureTextWithCanvas } from "@/lib/taskbar-strip"
import { rasterizeSvgToRgba } from "@/lib/tray-bars-icon"
import { getTrayPrimaryBars } from "@/lib/tray-primary-progress"
import { bytesToBase64 } from "@/lib/tray-provider-icons"

const UPDATE_DEBOUNCE_MS = 500
const MAX_PROVIDERS = 6

/** Experimental taskbar strip (`taskbar_strip.rs`): draws logos + session/weekly for the host. */
export function useTaskbarStrip(args: {
  enabled: boolean
  pluginsMeta: PluginMeta[]
  pluginSettings: PluginSettings | null
  pluginStates: Record<string, PluginState>
  displayMode: DisplayMode
  logoColors: boolean
  themeMode: string
}) {
  const { enabled, pluginsMeta, pluginSettings, pluginStates, displayMode, logoColors, themeMode } = args
  const taskbarIsLight = useTaskbarIsLight(themeMode)
  const showingRef = useRef(false)

  useEffect(() => {
    if (!enabled && !showingRef.current) return
    const timer = window.setTimeout(() => {
      const barArgs = { pluginsMeta, pluginSettings, pluginStates, maxBars: MAX_PROVIDERS, displayMode }
      const items = enabled
        ? buildTaskbarStripItems({
            primaryBars: getTrayPrimaryBars(barArgs),
            weeklyBars: getTrayPrimaryBars({ ...barArgs, preferWeekly: true }),
            pluginsMeta,
            onLightTaskbar: taskbarIsLight,
            logoColors,
          })
        : []
      const render = async () => {
        if (items.length === 0) return null
        const { svg, width, height } = makeTaskbarStripSvg({
          items,
          color: taskbarIsLight ? "black" : "white",
          scale: window.devicePixelRatio || 1,
          measure: measureTextWithCanvas,
        })
        return { rgba: bytesToBase64(await rasterizeSvgToRgba(svg, width, height)), width, height }
      }
      render()
        .then((image) => invoke("set_taskbar_strip", { image }).then(() => (showingRef.current = image !== null)))
        .catch((error) => console.error("Failed to update the taskbar strip:", error))
    }, UPDATE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [enabled, pluginsMeta, pluginSettings, pluginStates, displayMode, logoColors, taskbarIsLight])
}
