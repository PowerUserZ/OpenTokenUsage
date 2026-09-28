import { useEffect, useRef, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import type { PluginState } from "@/hooks/app/types"
import type { PluginMeta } from "@/lib/plugin-types"
import { isPerProviderTrayStyle, type DisplayMode, type MenubarIconStyle, type PluginSettings } from "@/lib/settings"
import { getTrayIconSizePx, rasterizeSvgToRgba } from "@/lib/tray-bars-icon"
import { getTrayPrimaryBars } from "@/lib/tray-primary-progress"
import { buildProviderTrayIconSpecs, bytesToBase64, measureLogoExtent } from "@/lib/tray-provider-icons"

const UPDATE_DEBOUNCE_MS = 500
const MAX_PROVIDER_ICONS = 12

// True while the per-provider icons replace the app icon. A hidden tray icon rejects new images,
// so use-tray-icon.ts skips it meanwhile and redraws it via `onAppIconShown`.
let appIconHidden = false
export const isAppTrayIconHidden = () => appIconHidden

/**
 * Taskbar theme (not the app theme): the tray sits on the taskbar. The host sends "taskbar:theme"
 * when Windows switches light/dark; also re-read on focus and app theme change.
 */
export function useTaskbarIsLight(themeMode: string): boolean {
  const [isLight, setIsLight] = useState(false)
  useEffect(() => {
    const refresh = () => {
      invoke<boolean>("get_taskbar_is_light")
        .then(setIsLight)
        .catch((error) => console.error("Failed to read taskbar theme:", error))
    }
    refresh()
    window.addEventListener("focus", refresh)
    const unlisten = listen<boolean>("taskbar:theme", (event) => setIsLight(event.payload))
    return () => {
      window.removeEventListener("focus", refresh)
      void unlisten.then((stop) => stop()).catch(() => {})
    }
  }, [themeMode])
  return isLight
}

/** Tray styles "numbers"/"logos": one tray icon per provider, drawn here and shown by the Rust host. */
export function useProviderTrayIcons(args: {
  pluginsMeta: PluginMeta[]
  pluginSettings: PluginSettings | null
  pluginStates: Record<string, PluginState>
  displayMode: DisplayMode
  style: MenubarIconStyle
  trayMetric: string
  themeMode: string
  logoColors: boolean
  /** Called when the per-provider icons are gone and the app icon is visible again. */
  onAppIconShown: () => void
}) {
  const { pluginsMeta, pluginSettings, pluginStates, displayMode, style, trayMetric, themeMode, logoColors, onAppIconShown } = args
  const taskbarIsLight = useTaskbarIsLight(themeMode)
  const showingRef = useRef(false)

  useEffect(() => {
    const perProvider = isPerProviderTrayStyle(style)
    // Nothing to clear when the icons were never shown.
    if (!perProvider && !showingRef.current) return

    const timer = window.setTimeout(() => {
      // Rings are drawn at the real tray size (16 px x scale): downscaled 32 px art blurs the logo.
      const sizePx =
        style === "logos"
          ? Math.round(16 * (window.devicePixelRatio || 1))
          : getTrayIconSizePx(window.devicePixelRatio)
      const bars =
        perProvider && pluginSettings
          ? getTrayPrimaryBars({
              pluginsMeta,
              pluginSettings,
              pluginStates,
              maxBars: MAX_PROVIDER_ICONS,
              displayMode,
              preferredMetric: trayMetric !== "auto" ? trayMetric : undefined,
              preferWeekly: trayMetric === "Weekly",
            })
          : []
      const update = async () => {
        const iconUrls = bars.flatMap((bar) => pluginsMeta.find((meta) => meta.id === bar.id)?.iconUrl ?? [])
        const logoExtents =
          style === "logos"
            ? new Map(await Promise.all(iconUrls.map(async (url) => [url, await measureLogoExtent(url)] as const)))
            : undefined
        const specs = buildProviderTrayIconSpecs({
          bars,
          pluginsMeta,
          style: style as "numbers" | "logos",
          sizePx,
          onLightTaskbar: taskbarIsLight,
          logoColors,
          logoExtents,
        })
        const icons = await Promise.all(
          specs.map(async ({ providerId, svg, tooltip }) => ({
            providerId,
            tooltip,
            size: sizePx,
            rgba: bytesToBase64(await rasterizeSvgToRgba(svg, sizePx, sizePx)),
          }))
        )
        await invoke("set_provider_tray_icons", { icons })
        const wasShowing = showingRef.current
        showingRef.current = icons.length > 0
        appIconHidden = showingRef.current
        // The app icon can't take a new image while hidden, so redraw it once it's back.
        if (wasShowing && !showingRef.current) onAppIconShown()
      }
      update()
        .catch((error) => console.error("Failed to update provider tray icons:", error))
    }, UPDATE_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [pluginsMeta, pluginSettings, pluginStates, displayMode, style, trayMetric, taskbarIsLight, logoColors, onAppIconShown])
}
