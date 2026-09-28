import { describe, expect, it } from "vitest"
import type { MetricLine } from "@/lib/plugin-types"
import { collectUsageAlerts } from "@/lib/usage-alerts"

const HOUR = 60 * 60 * 1000
const NOW = Date.parse("2026-09-28T12:00:00Z")

function line(used: number, resetsInMs: number, periodMs = 5 * HOUR): MetricLine {
  return {
    type: "progress",
    label: "Session",
    used,
    limit: 100,
    format: { kind: "percent" },
    resetsAt: new Date(NOW + resetsInMs).toISOString(),
    periodDurationMs: periodMs,
  }
}

const collect = (lines: MetricLine[], sent: string[] = [], previousLines?: MetricLine[]) =>
  collectUsageAlerts({ pluginId: "claude", providerName: "Claude", lines, previousLines, sent: new Set(sent), nowMs: NOW })

describe("collectUsageAlerts", () => {
  it("stays quiet below the thresholds and at an easy pace", () => {
    expect(collect([line(40, 4 * HOUR)])).toEqual([])
  })

  it("alerts once at 80% and remembers it", () => {
    const [alert] = collect([line(82, 2 * HOUR)])
    expect(alert?.title).toBe("Claude: Session at 82%")
    expect(alert?.body).toBe("Resets in 2h 0m")
    expect(collect([line(85, 2 * HOUR)], alert!.keys)).toEqual([])
  })

  it("jumping straight past 95% sends one alert that also covers 80%", () => {
    const alerts = collect([line(97, HOUR)])
    expect(alerts).toHaveLength(1)
    expect(alerts[0]!.keys).toHaveLength(2)
    expect(collect([line(98, HOUR)], alerts[0]!.keys)).toEqual([])
  })

  it("warns when the pace runs out before the reset", () => {
    // 60% used after 2h of a 5h window -> 100% at ~3h20m, reset at 5h.
    const [alert] = collect([line(60, 3 * HOUR)])
    expect(alert?.title).toBe("Claude: Session is running out")
    expect(alert?.body).toContain("1h 20m")
  })

  it("no pace alert when the window resets before it would run out", () => {
    // 55% used after 4h -> would need ~3.3h more, reset in 1h.
    expect(collect([line(55, HOUR)])).toEqual([])
  })

  it("announces a reset of a nearly full window", () => {
    const before = line(90, 10 * 60 * 1000)
    const after = line(0, 5 * HOUR)
    const alerts = collect([after], [], [before])
    expect(alerts.map((a) => a.title)).toEqual(["Claude: Session has reset"])
  })

  it("does not announce a reset of a lightly used window", () => {
    expect(collect([line(0, 5 * HOUR)], [], [line(30, 10 * 60 * 1000)])).toEqual([])
  })
})
