import { useCallback } from "react"
import { invoke } from "@tauri-apps/api/core"
import { insertAccount, type AccountsChange } from "@/lib/accounts"
import type { PluginMeta } from "@/lib/plugin-types"
import { normalizePluginSettings, savePluginSettings, type PluginSettings } from "@/lib/settings"

const TRAY_SETTINGS_DEBOUNCE_MS = 2000

type ScheduleTrayIconUpdate = (reason: "probe" | "settings" | "init", delayMs?: number) => void

type UseSettingsPluginActionsArgs = {
  pluginSettings: PluginSettings | null
  setPluginSettings: (value: PluginSettings | null) => void
  setPluginsMeta: (value: PluginMeta[]) => void
  setLoadingForPlugins: (ids: string[]) => void
  setErrorForPlugins: (ids: string[], error: string) => void
  startBatch: (pluginIds?: string[]) => Promise<string[] | undefined>
  scheduleTrayIconUpdate: ScheduleTrayIconUpdate
}

export function useSettingsPluginActions({
  pluginSettings,
  setPluginSettings,
  setPluginsMeta,
  setLoadingForPlugins,
  setErrorForPlugins,
  startBatch,
  scheduleTrayIconUpdate,
}: UseSettingsPluginActionsArgs) {
  const handleReorder = useCallback((orderedIds: string[]) => {
    if (!pluginSettings) return
    // orderedIds may be a subset (e.g. nav-only, excluding disabled plugins).
    // Re-insert any missing IDs from the previous order at their original
    // relative positions so disabled plugins are not dropped.
    const orderedSet = new Set(orderedIds)
    const missing = (pluginSettings.order ?? []).filter((id) => !orderedSet.has(id))
    const merged = [...orderedIds]
    for (const id of missing) {
      const prevIdx = (pluginSettings.order ?? []).indexOf(id)
      // Insert after the last merged entry whose original index < prevIdx
      let insertAt = 0 // default: prepend if id originally preceded all visible entries
      for (let i = merged.length - 1; i >= 0; i--) {
        const mergedPrevIdx = (pluginSettings.order ?? []).indexOf(merged[i])
        if (mergedPrevIdx < prevIdx) {
          insertAt = i + 1
          break
        }
      }
      merged.splice(insertAt, 0, id)
    }
    const nextSettings: PluginSettings = {
      ...pluginSettings,
      order: merged,
    }
    setPluginSettings(nextSettings)
    scheduleTrayIconUpdate("settings", TRAY_SETTINGS_DEBOUNCE_MS)
    void savePluginSettings(nextSettings).catch((error) => {
      console.error("Failed to save plugin order:", error)
    })
  }, [pluginSettings, scheduleTrayIconUpdate, setPluginSettings])

  const handleToggle = useCallback((id: string) => {
    if (!pluginSettings) return
    const wasDisabled = pluginSettings.disabled.includes(id)
    const disabled = new Set(pluginSettings.disabled)

    if (wasDisabled) {
      disabled.delete(id)
      setLoadingForPlugins([id])
      startBatch([id]).catch((error) => {
        console.error("Failed to start probe for enabled plugin:", error)
        setErrorForPlugins([id], "Failed to start probe")
      })
    } else {
      disabled.add(id)
    }

    const nextSettings: PluginSettings = {
      ...pluginSettings,
      disabled: Array.from(disabled),
    }
    setPluginSettings(nextSettings)
    scheduleTrayIconUpdate("settings", TRAY_SETTINGS_DEBOUNCE_MS)
    void savePluginSettings(nextSettings).catch((error) => {
      console.error("Failed to save plugin toggle:", error)
    })
  }, [
    pluginSettings,
    scheduleTrayIconUpdate,
    setErrorForPlugins,
    setLoadingForPlugins,
    setPluginSettings,
    startBatch,
  ])

  /**
   * After an account was added or removed (`accounts.rs` rebuilt its plugin list): reload the list,
   * put a new account right after its provider, turned on, and probe it; drop a removed one.
   */
  const handleAccountsChanged = useCallback(
    async (change: AccountsChange) => {
      if (!pluginSettings) return
      try {
        const metas = await invoke<PluginMeta[]>("list_plugins")
        setPluginsMeta(metas)
        let order = pluginSettings.order.filter((id) => id !== change.removedId)
        let disabled = pluginSettings.disabled.filter((id) => id !== change.removedId)
        if (change.added) {
          order = insertAccount(order, change.added.id, change.added.plugin)
          disabled = disabled.filter((id) => id !== change.added?.id)
        }
        const nextSettings = normalizePluginSettings({ order, disabled }, metas)
        setPluginSettings(nextSettings)
        scheduleTrayIconUpdate("settings", TRAY_SETTINGS_DEBOUNCE_MS)
        await savePluginSettings(nextSettings)
        if (change.added) {
          const id = change.added.id
          setLoadingForPlugins([id])
          startBatch([id]).catch((error) => {
            console.error("Failed to start probe for a new account:", error)
            setErrorForPlugins([id], "Failed to start probe")
          })
        }
      } catch (error) {
        console.error("Failed to update the plugin list after an account change:", error)
      }
    },
    [pluginSettings, scheduleTrayIconUpdate, setErrorForPlugins, setLoadingForPlugins, setPluginSettings, setPluginsMeta, startBatch]
  )

  return {
    handleReorder,
    handleToggle,
    handleAccountsChanged,
  }
}
