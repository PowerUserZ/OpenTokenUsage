import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"

export type ProviderStatus = {
  /** "none" | "minor" | "major" | "critical" | "maintenance" */
  indicator: string
  description: string
}

const POLL_MS = 5 * 60_000

/** Vendor status page state; polled while mounted (the host caches for 5 min). */
export function useProviderStatus(pluginId: string, hasStatusPage: boolean): ProviderStatus | null {
  const [status, setStatus] = useState<ProviderStatus | null>(null)

  useEffect(() => {
    if (!hasStatusPage) return
    let cancelled = false
    const load = () => {
      invoke<ProviderStatus | null>("get_provider_status", { pluginId })
        .then((next) => {
          if (!cancelled) setStatus(next)
        })
        // Offline / page down is expected; keep the last known status.
        .catch((e) => console.warn(`status check failed for ${pluginId}:`, e))
    }
    load()
    const timer = setInterval(load, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [pluginId, hasStatusPage])

  return hasStatusPage ? status : null
}
