import { useEffect, useRef } from "react"
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification"
import type { PluginState } from "@/hooks/app/types"
import type { PluginMeta, PluginOutput } from "@/lib/plugin-types"
import { loadSentUsageAlerts, saveSentUsageAlerts } from "@/lib/settings"
import { collectUsageAlerts, type UsageAlert } from "@/lib/usage-alerts"

async function showNotifications(alerts: UsageAlert[]) {
  let granted = await isPermissionGranted()
  if (!granted) granted = (await requestPermission()) === "granted"
  if (!granted) return
  for (const alert of alerts) sendNotification({ title: alert.title, body: alert.body })
}

/** Windows notifications for usage thresholds, pace and resets, checked on every fresh probe result. */
export function useUsageAlerts({
  pluginStates,
  pluginsMeta,
  enabled,
}: {
  pluginStates: Record<string, PluginState | undefined>
  pluginsMeta: PluginMeta[]
  enabled: boolean
}) {
  // Keys of alerts already shown; persisted so a restart doesn't repeat them. null = still loading.
  const sentRef = useRef<Set<string> | null>(null)
  const previousRef = useRef<Record<string, PluginOutput>>({})

  useEffect(() => {
    loadSentUsageAlerts()
      .then((keys) => {
        sentRef.current = new Set(keys)
      })
      .catch((error) => {
        console.error("Failed to load sent usage alerts:", error)
        sentRef.current = new Set()
      })
  }, [])

  useEffect(() => {
    const sent = sentRef.current
    const names = new Map(pluginsMeta.map((plugin) => [plugin.id, plugin.name]))
    const alerts: UsageAlert[] = []
    for (const [id, state] of Object.entries(pluginStates)) {
      const data = state?.data
      const previous = previousRef.current[id]
      if (!data || data === previous) continue
      previousRef.current[id] = data
      if (!enabled || !sent) continue
      alerts.push(
        ...collectUsageAlerts({
          pluginId: id,
          providerName: names.get(id) ?? data.displayName,
          lines: data.lines,
          previousLines: previous?.lines,
          sent,
          nowMs: Date.now(),
        })
      )
    }
    if (!sent || alerts.length === 0) return

    for (const alert of alerts) alert.keys.forEach((key) => sent.add(key))
    void saveSentUsageAlerts([...sent]).catch((error) => console.error("Failed to save sent usage alerts:", error))
    void showNotifications(alerts).catch((error) => console.error("Failed to show usage notification:", error))
  }, [pluginStates, pluginsMeta, enabled])
}
