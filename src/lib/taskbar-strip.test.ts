import { describe, expect, it } from "vitest"
import type { PluginMeta } from "@/lib/plugin-types"
import { buildTaskbarStripItems, makeTaskbarStripSvg } from "@/lib/taskbar-strip"

const meta = (id: string, brandColor?: string) =>
  ({ id, name: id, iconUrl: `data:image/svg+xml;base64,${id}`, brandColor }) as unknown as PluginMeta

describe("buildTaskbarStripItems", () => {
  const pluginsMeta = [meta("claude", "#DE7356"), meta("codex", "#000000")]

  it("puts the primary value on top and a separate weekly line below", () => {
    const [claude, codex] = buildTaskbarStripItems({
      primaryBars: [
        { id: "claude", fraction: 0.58, label: "Session" },
        { id: "codex", fraction: 0.08, label: "Weekly" },
      ],
      weeklyBars: [
        { id: "claude", fraction: 0.12, label: "Weekly", weekly: true },
        { id: "codex", fraction: 0.08, label: "Weekly", weekly: true },
      ],
      pluginsMeta,
      onLightTaskbar: false,
      logoColors: true,
    })
    expect(claude).toMatchObject({ top: "58%", bottom: "12%", logoColor: "#DE7356" })
    // Weekly is already the primary line: no duplicate below; black brand falls back to white.
    expect(codex).toMatchObject({ top: "8%", bottom: "", logoColor: "white" })
  })

  it("shows -- without data and skips unknown providers", () => {
    const items = buildTaskbarStripItems({
      primaryBars: [{ id: "claude" }, { id: "gone", fraction: 0.5 }],
      weeklyBars: [],
      pluginsMeta,
      onLightTaskbar: true,
      logoColors: false,
    })
    expect(items).toEqual([{ iconUrl: pluginsMeta[0]!.iconUrl, logoColor: "black", top: "--", bottom: "" }])
  })
})

describe("makeTaskbarStripSvg", () => {
  const item = { iconUrl: "data:x", logoColor: "white", top: "58%", bottom: "12%" }

  it("lays items out left to right with two lines each", () => {
    const one = makeTaskbarStripSvg({ items: [item], color: "white", scale: 1 })
    const two = makeTaskbarStripSvg({ items: [item, { ...item, bottom: "" }], color: "white", scale: 1 })
    expect(two.width).toBeGreaterThan(one.width)
    expect(one.height).toBe(40)
    expect(one.svg.match(/<text /g)).toHaveLength(2)
    expect(two.svg.match(/<text /g)).toHaveLength(3)
  })

  it("scales with the display and keeps the whole strip clickable", () => {
    const strip = makeTaskbarStripSvg({ items: [item], color: "black", scale: 1.5 })
    expect(strip.height).toBe(60)
    expect(strip.svg).toContain('fill-opacity="0.004"')
  })
})
