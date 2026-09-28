import { describe, expect, it } from "vitest"
import type { PluginMeta } from "@/lib/plugin-types"
import { DEFAULT_TASKBAR_STRIP_STYLE, normalizeTaskbarStripStyle, type TaskbarStripStyle } from "@/lib/settings"
import { buildTaskbarStripItems, colorOnScale, makeTaskbarStripSvg, stripPluginSettings } from "@/lib/taskbar-strip"

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
    const [claude, codex] = build({ colorMode: "off" })
    expect(claude!.lines).toEqual([
      { text: "58%", color: "#ffffff" },
      { text: "12%", color: "#ffffff" },
    ])
    expect(claude!.logoColor).toBe("#DE7356")
    // Weekly is already the primary line: no duplicate; a black brand falls back to white.
    expect(codex!.lines).toHaveLength(1)
    expect(codex!.logoColor).toBe("white")
  })

  it("colors numbers by the share used and follows the chosen text color", () => {
    const [claude, codex] = build({ colorMode: "thresholds", warnAt: 50, criticalAt: 90, textColor: "#00ff00" })
    expect(claude!.lines.map((line) => line.color)).toEqual([DEFAULT_TASKBAR_STRIP_STYLE.warnColor, "#00ff00"])
    expect(codex!.lines[0]!.color).toBe(DEFAULT_TASKBAR_STRIP_STYLE.criticalColor)
  })

  it("reads 'left' mode as the unused share", () => {
    // 0.95 left = 5% used: no warning color.
    const [, codex] = build({ colorMode: "thresholds" }, "left")
    expect(codex!.lines[0]!.color).toBe("#ffffff")
  })

  it("shows session, weekly or both per provider, and can drop the % sign", () => {
    const texts = (patch: Partial<TaskbarStripStyle>) => build({ colorMode: "off", ...patch })[0]!.lines.map((line) => line.text)
    expect(texts({ lineModes: { claude: "session" } })).toEqual(["58%"])
    expect(texts({ lineModes: { claude: "weekly" }, showPercentSign: false })).toEqual(["12"])
    expect(texts({ lineModes: {} })).toEqual(["58%", "12%"])
    // Codex has one line: every mode shows it.
    expect(build({ lineModes: { codex: "session" } })[1]!.lines).toHaveLength(1)
  })

  it("colors along the chosen scale from the text color up to red", () => {
    const [claude, codex] = build({ colorMode: "heat" })
    expect(claude!.lines[1]!.color).not.toBe("#ffffff") // 12% is already on its way to yellow
    expect(codex!.lines[0]!.color).toBe("#ef4444") // 95% = the scale's red
  })
})

describe("colorOnScale", () => {
  const scale = [[0, "base"], [50, "#ffff00"], [100, "#ff0000"]] as const

  it("starts at the text color and blends between stops", () => {
    expect(colorOnScale(scale, 0, "#ffffff")).toBe("#ffffff")
    expect(colorOnScale(scale, 25, "#ffffff")).toBe("#ffff80")
    expect(colorOnScale(scale, 75, "#ffffff")).toBe("#ff8000")
    expect(colorOnScale(scale, 120, "#ffffff")).toBe("#ff0000")
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
    const stored = {
      font: "comic-sans",
      fontSize: 13,
      textColor: "blue",
      warnAt: 250,
      providers: ["a", 1, "b"],
      bold: false,
      lineModes: { claude: "weekly", codex: "sideways" },
    }
    expect(normalizeTaskbarStripStyle(stored)).toEqual({
      ...DEFAULT_TASKBAR_STRIP_STYLE,
      fontSize: 13,
      bold: false,
      providers: ["a", "b"],
      lineModes: { claude: "weekly" },
    })
    expect(normalizeTaskbarStripStyle({ usageColors: false }).colorMode).toBe("off")
    expect(normalizeTaskbarStripStyle(undefined)).toEqual(DEFAULT_TASKBAR_STRIP_STYLE)
  })
})
