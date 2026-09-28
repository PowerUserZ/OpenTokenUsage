import { describe, expect, it } from "vitest"
import type { PluginMeta } from "@/lib/plugin-types"
import { DEFAULT_TASKBAR_STRIP_STYLE, normalizeTaskbarStripStyle, type TaskbarStripStyle } from "@/lib/settings"
import { buildTaskbarStripItems, makeTaskbarStripSvg, stripPluginSettings } from "@/lib/taskbar-strip"

const meta = (id: string, brandColor?: string) =>
  ({ id, name: id, iconUrl: `data:image/svg+xml;base64,${id}`, brandColor }) as unknown as PluginMeta

const pluginsMeta = [meta("claude", "#DE7356"), meta("codex", "#000000")]
const style = (patch: Partial<TaskbarStripStyle> = {}) => ({ ...DEFAULT_TASKBAR_STRIP_STYLE, ...patch })

const build = (patch: Partial<TaskbarStripStyle> = {}, displayMode: "used" | "left" = "used") =>
  buildTaskbarStripItems({
    primaryBars: [
      { id: "claude", fraction: 0.58, label: "Session" },
      { id: "codex", fraction: 0.95, label: "Weekly" },
    ],
    weeklyBars: [
      { id: "claude", fraction: 0.12, label: "Weekly", weekly: true },
      { id: "codex", fraction: 0.95, label: "Weekly", weekly: true },
    ],
    pluginsMeta,
    onLightTaskbar: false,
    logoColors: true,
    displayMode,
    style: style(patch),
  })

describe("buildTaskbarStripItems", () => {
  it("puts the primary value on top and a separate weekly line below", () => {
    const [claude, codex] = build({ usageColors: false })
    expect(claude!.lines).toEqual([
      { text: "58%", color: "white" },
      { text: "12%", color: "white" },
    ])
    expect(claude!.logoColor).toBe("#DE7356")
    // Weekly is already the primary line: no duplicate; a black brand falls back to white.
    expect(codex!.lines).toHaveLength(1)
    expect(codex!.logoColor).toBe("white")
  })

  it("colors numbers by the share used and follows the chosen text color", () => {
    const [claude, codex] = build({ warnAt: 50, criticalAt: 90, textColor: "#00ff00" })
    expect(claude!.lines.map((line) => line.color)).toEqual([DEFAULT_TASKBAR_STRIP_STYLE.warnColor, "#00ff00"])
    expect(codex!.lines[0]!.color).toBe(DEFAULT_TASKBAR_STRIP_STYLE.criticalColor)
  })

  it("reads 'left' mode as the unused share", () => {
    // 0.95 left = 5% used: no warning color.
    const [, codex] = build({}, "left")
    expect(codex!.lines[0]!.color).toBe("white")
  })

  it("can hide the weekly line and the % sign", () => {
    const [claude] = build({ showWeekly: false, showPercentSign: false, usageColors: false })
    expect(claude!.lines).toEqual([{ text: "58", color: "white" }])
  })
})

describe("stripPluginSettings", () => {
  const settings = { order: ["claude", "codex", "zai", "cursor"], disabled: ["zai"] }

  it("uses the strip's own order and skips disabled providers", () => {
    expect(stripPluginSettings(["cursor", "zai", "claude"], settings)).toEqual({ order: ["cursor", "claude"], disabled: [] })
  })

  it("defaults to the enabled providers in nav order", () => {
    expect(stripPluginSettings(null, settings).order).toEqual(["claude", "codex", "cursor"])
  })
})

describe("makeTaskbarStripSvg", () => {
  const item = { iconUrl: "data:x", logoColor: "white", lines: [{ text: "58%", color: "white" }, { text: "12%", color: "red" }] }

  it("lays items out left to right with their lines", () => {
    const one = makeTaskbarStripSvg({ items: [item], style: style(), scale: 1 })
    const two = makeTaskbarStripSvg({ items: [item, { ...item, lines: [item.lines[0]!] }], style: style(), scale: 1 })
    expect(two.width).toBeGreaterThan(one.width)
    expect(one.height).toBe(40)
    expect(one.svg.match(/<text /g)).toHaveLength(2)
    expect(one.svg).toContain('fill="red"')
  })

  it("uses the chosen font, size and weight, scaled for the display", () => {
    const strip = makeTaskbarStripSvg({ items: [item], style: style({ font: "cascadia", fontSize: 14, bold: false }), scale: 1.5 })
    expect(strip.height).toBe(60)
    expect(strip.svg).toContain("Cascadia Mono")
    expect(strip.svg).toContain('font-size="21"')
    expect(strip.svg).toContain('font-weight="400"')
    expect(strip.svg).toContain('fill-opacity="0.004"')
  })
})

describe("normalizeTaskbarStripStyle", () => {
  it("keeps valid fields and replaces broken ones", () => {
    const stored = { font: "comic-sans", fontSize: 13, textColor: "blue", warnAt: 250, providers: ["a", 1, "b"], bold: false }
    expect(normalizeTaskbarStripStyle(stored)).toEqual({
      ...DEFAULT_TASKBAR_STRIP_STYLE,
      fontSize: 13,
      bold: false,
      providers: ["a", "b"],
    })
    expect(normalizeTaskbarStripStyle(undefined)).toEqual(DEFAULT_TASKBAR_STRIP_STYLE)
  })
})
