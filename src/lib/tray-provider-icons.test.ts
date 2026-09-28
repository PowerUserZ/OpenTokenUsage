import { describe, expect, it } from "vitest"
import type { PluginMeta } from "@/lib/plugin-types"
import { buildProviderTrayIconSpecs, bytesToBase64, makeProviderRingSvg, readableBrandColor } from "@/lib/tray-provider-icons"

const ICON = "data:image/svg+xml;base64,PHN2Zy8+"
const meta = (id: string, name: string) => ({ id, name, iconUrl: ICON }) as unknown as PluginMeta

const dashLength = (svg: string) => Number(/stroke-dasharray="([\d.]+) /.exec(svg)?.[1])

describe("makeProviderRingSvg", () => {
  it("fills the ring in proportion to usage and masks the logo", () => {
    const quarter = makeProviderRingSvg({ iconUrl: ICON, fraction: 0.25, sizePx: 32, color: "white" })
    const half = makeProviderRingSvg({ iconUrl: ICON, fraction: 0.5, sizePx: 32, color: "white" })
    expect(dashLength(half)).toBeCloseTo(dashLength(quarter) * 2)
    expect(half).toContain(`href="${ICON}"`)
    expect(half).toContain('mask="url(#logo)"')
  })

  it("shrinks a logo that reaches its corners so it stays inside the ring", () => {
    const logoSize = (extent: number) =>
      Number(/<rect x="[\d.]+" y="[\d.]+" width="([\d.]+)"/.exec(makeProviderRingSvg({ iconUrl: ICON, sizePx: 16, color: "white", logoExtent: extent }))?.[1])
    const round = logoSize(0.8)
    const square = logoSize(1.3)
    expect(round).toBeGreaterThan(square)
    // The square's corners (1.3 x half its box) end inside the ring's inner edge (8 - 1.28 px).
    expect((square / 2) * 1.3).toBeLessThan(8 - 1.28)
  })

  it("draws only the empty track without data", () => {
    const svg = makeProviderRingSvg({ iconUrl: ICON, sizePx: 32, color: "black" })
    expect(svg).not.toContain("stroke-dasharray")
  })
})

describe("buildProviderTrayIconSpecs", () => {
  const pluginsMeta = [meta("claude", "Claude"), meta("codex", "Codex")]
  const bars = [
    { id: "claude", fraction: 0.58, label: "Session" },
    { id: "codex", fraction: undefined },
    { id: "gone", fraction: 0.1 },
  ]

  it("makes one icon per known provider with the numbers in the tooltip", () => {
    const specs = buildProviderTrayIconSpecs({ bars, pluginsMeta, style: "numbers", sizePx: 32, onLightTaskbar: false, logoColors: true })
    expect(specs.map((spec) => spec.providerId)).toEqual(["claude", "codex"])
    expect(specs[0]!.svg).toContain(">58<")
    expect(specs[0]!.tooltip).toBe("Claude\nSession: 58%")
    expect(specs[1]!.svg).toContain(">--<")
    expect(specs[1]!.tooltip).toBe("Codex\n--%")
  })

  it("uses the provider logo for the logo style", () => {
    const [spec] = buildProviderTrayIconSpecs({ bars, pluginsMeta, style: "logos", sizePx: 32, onLightTaskbar: false, logoColors: true })
    expect(spec!.svg).toContain(ICON)
  })

  it("paints the logo in the brand color only when it reads on the taskbar", () => {
    const colored = [{ ...meta("claude", "Claude"), brandColor: "#DE7356" }, { ...meta("codex", "Codex"), brandColor: "#000000" }]
    const [claude, codex] = buildProviderTrayIconSpecs({ bars, pluginsMeta: colored, style: "logos", sizePx: 16, onLightTaskbar: false, logoColors: true })
    expect(claude!.svg).toContain('fill="#DE7356"')
    expect(codex!.svg).toContain('fill="white" mask')
    const [mono] = buildProviderTrayIconSpecs({ bars, pluginsMeta: colored, style: "logos", sizePx: 16, onLightTaskbar: false, logoColors: false })
    expect(mono!.svg).not.toContain("#DE7356")
  })
})

it("bytesToBase64 encodes large buffers", () => {
  const bytes = new Uint8Array(100_000).map((_, i) => i % 256)
  expect(atob(bytesToBase64(bytes)).length).toBe(100_000)
  expect(bytesToBase64(new Uint8Array([104, 105]))).toBe("aGk=")
})

it("readableBrandColor keeps colors with 3:1 contrast against the taskbar", () => {
  expect(readableBrandColor("#6C7BF7", false)).toBe("#6C7BF7")
  expect(readableBrandColor("#000000", false)).toBeUndefined()
  expect(readableBrandColor("#000000", true)).toBe("#000000")
  expect(readableBrandColor("#FFFFFF", true)).toBeUndefined()
  expect(readableBrandColor(undefined, false)).toBeUndefined()
  expect(readableBrandColor("red", false)).toBeUndefined()
})
