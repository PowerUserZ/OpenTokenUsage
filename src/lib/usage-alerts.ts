import { t, tLabel } from "@/lib/i18n"
import type { MetricLine } from "@/lib/plugin-types"
import { formatCompactDuration } from "@/lib/pace-tooltip"

type ProgressLine = Extract<MetricLine, { type: "progress" }>

export type UsageAlert = {
  title: string
  body: string
  /** Dedupe keys to remember once this alert is sent (a 95% alert also covers 80%). */
  keys: string[]
}

/** Usage levels (percent) that trigger a notification, highest first. */
const LEVELS = [95, 80]
/** Pace alerts only once a window is at least half used, so early spikes stay quiet. */
const PACE_MIN_FRACTION = 0.5
/** A reset is worth announcing only if the window was nearly full before it. */
const RESET_MIN_FRACTION = 0.8

function progressLines(lines: MetricLine[] | undefined): ProgressLine[] {
  return (lines ?? []).filter(
    (line): line is ProgressLine => line.type === "progress" && line.limit > 0 && Number.isFinite(line.used)
  )
}

/**
 * Notifications for one provider's fresh probe result. Pure: `sent` holds keys of alerts already
 * shown (persisted by the caller), so each alert fires once per provider + line + window.
 */
export function collectUsageAlerts(args: {
  pluginId: string
  providerName: string
  lines: MetricLine[]
  previousLines?: MetricLine[]
  sent: ReadonlySet<string>
  nowMs: number
}): UsageAlert[] {
  const { pluginId, providerName, lines, previousLines, sent, nowMs } = args
  const alerts: UsageAlert[] = []
  const previousByLabel = new Map(progressLines(previousLines).map((line) => [line.label, line]))

  for (const line of progressLines(lines)) {
    const label = tLabel(line.label)
    const fraction = line.used / line.limit
    const window = line.resetsAt ?? "none"
    const base = `${pluginId}|${line.label}|${window}`
    const resetsAtMs = line.resetsAt ? Date.parse(line.resetsAt) : Number.NaN

    // Limit reset: same line, later reset time, and it was nearly full before.
    const previous = previousByLabel.get(line.label)
    if (previous?.resetsAt && line.resetsAt && Date.parse(line.resetsAt) > Date.parse(previous.resetsAt)) {
      const resetKey = `${pluginId}|${line.label}|${previous.resetsAt}|reset`
      if (previous.used / previous.limit >= RESET_MIN_FRACTION && !sent.has(resetKey)) {
        alerts.push({
          title: t("alert.reset.title", { provider: providerName, label }),
          body: t("alert.reset.body"),
          keys: [resetKey],
        })
      }
    }

    // Thresholds: announce only the highest level crossed; it also marks the lower ones as sent.
    const level = LEVELS.find((value) => fraction * 100 >= value)
    if (level !== undefined) {
      const keys = LEVELS.filter((value) => value <= level).map((value) => `${base}|t${value}`)
      if (!sent.has(keys[0]!)) {
        const timeLeft = Number.isFinite(resetsAtMs) ? formatCompactDuration(resetsAtMs - nowMs) : null
        alerts.push({
          title: t("alert.threshold.title", { provider: providerName, label, percent: Math.round(fraction * 100) }),
          body: timeLeft ? t("reset.in", { time: timeLeft }) : "",
          keys,
        })
      }
      continue // no pace alert on top of a threshold alert
    }

    // Pace: on track to hit the limit before this window resets.
    const periodMs = line.periodDurationMs
    if (!periodMs || !Number.isFinite(resetsAtMs) || fraction < PACE_MIN_FRACTION) continue
    const elapsedMs = nowMs - (resetsAtMs - periodMs)
    if (elapsedMs <= 0 || nowMs >= resetsAtMs) continue
    const etaMs = (line.limit - line.used) / (line.used / elapsedMs)
    const paceKey = `${base}|pace`
    if (etaMs > 0 && etaMs < resetsAtMs - nowMs && !sent.has(paceKey)) {
      alerts.push({
        title: t("alert.pace.title", { provider: providerName, label }),
        body: t("alert.pace.body", { time: formatCompactDuration(etaMs) ?? "" }),
        keys: [paceKey],
      })
    }
  }
  return alerts
}
