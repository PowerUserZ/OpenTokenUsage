import type { PluginMeta } from "@/lib/plugin-types"
import type { TrayPrimaryBar } from "@/lib/tray-primary-progress"
import { formatTrayPercentText } from "@/lib/tray-tooltip"
import { readableBrandColor } from "@/lib/tray-provider-icons"

export type TaskbarStripItem = {
  iconUrl: string
  logoColor: string
  /** Session-like value (the provider's primary line). */
  top: string
  /** Weekly value; empty when the provider has no separate weekly line. */
  bottom: string
}

/** Logical px; the Windows 11 taskbar is 48 px tall. */
const HEIGHT = 40
const LOGO = 22
const LOGO_GAP = 5
const ITEM_GAP = 12
const FONT_SIZE = 12
const FONT = `"Segoe UI Variable Text", "Segoe UI", sans-serif`

/** Rough text width for tests and non-canvas environments; the app measures with a canvas. */
export function estimateTextWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.58
}

export function measureTextWithCanvas(text: string, fontSize: number): number {
  const context = document.createElement("canvas").getContext("2d")
  if (!context) return estimateTextWidth(text, fontSize)
  context.font = `600 ${fontSize}px ${FONT}`
  return context.measureText(text).width
}

/** One strip item per provider: primary value on top, weekly below (like the macOS menu bar). */
export function buildTaskbarStripItems(args: {
  primaryBars: TrayPrimaryBar[]
  weeklyBars: TrayPrimaryBar[]
  pluginsMeta: PluginMeta[]
  onLightTaskbar: boolean
  logoColors: boolean
}): TaskbarStripItem[] {
  const { primaryBars, weeklyBars, pluginsMeta, onLightTaskbar, logoColors } = args
  const color = onLightTaskbar ? "black" : "white"
  const metaById = new Map(pluginsMeta.map((meta) => [meta.id, meta]))
  const weeklyById = new Map(weeklyBars.map((bar) => [bar.id, bar]))
  return primaryBars.flatMap((primary) => {
    const meta = metaById.get(primary.id)
    if (!meta) return []
    const weekly = weeklyById.get(primary.id)
    const hasWeekly = weekly?.weekly === true && weekly.label !== primary.label
    return [
      {
        iconUrl: meta.iconUrl,
        logoColor: (logoColors && readableBrandColor(meta.brandColor, onLightTaskbar)) || color,
        top: formatTrayPercentText(primary.fraction).replace("--%", "--"),
        bottom: hasWeekly ? formatTrayPercentText(weekly.fraction).replace("--%", "--") : "",
      },
    ]
  })
}

/** The strip as one SVG, sized in physical px (`scale` = devicePixelRatio). */
export function makeTaskbarStripSvg(args: {
  items: TaskbarStripItem[]
  color: string
  scale: number
  measure?: (text: string, fontSize: number) => number
}): { svg: string; width: number; height: number } {
  const { items, color, scale, measure = estimateTextWidth } = args
  const px = (value: number) => Math.round(value * scale)
  const height = px(HEIGHT)
  const fontSize = FONT_SIZE * scale
  const logo = px(LOGO)
  const parts: string[] = []
  let x = 0
  items.forEach((item, index) => {
    if (index > 0) x += px(ITEM_GAP)
    const logoY = Math.round((height - logo) / 2)
    parts.push(
      `<mask id="logo${index}" style="mask-type:alpha"><image href="${item.iconUrl}" x="${x}" y="${logoY}" width="${logo}" height="${logo}"/></mask>`,
      `<rect x="${x}" y="${logoY}" width="${logo}" height="${logo}" fill="${item.logoColor}" mask="url(#logo${index})"/>`
    )
    x += logo + px(LOGO_GAP)
    const lines = item.bottom ? [item.top, item.bottom] : [item.top]
    const lineHeight = fontSize * 1.2
    const firstBaseline = height / 2 - ((lines.length - 1) * lineHeight) / 2
    lines.forEach((line, i) => {
      parts.push(
        `<text x="${x}" y="${firstBaseline + i * lineHeight}" dominant-baseline="central" fill="${color}" font-family='${FONT}' font-size="${fontSize}" font-weight="600">${line}</text>`
      )
    })
    x += Math.ceil(Math.max(...lines.map((line) => measure(line, fontSize))))
  })
  const width = Math.max(1, x)
  // Alpha 1/255 everywhere: invisible, but makes the whole strip clickable (Windows lets clicks
  // through fully transparent pixels of a layered window).
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<rect width="${width}" height="${height}" fill="black" fill-opacity="0.004"/>`,
    ...parts,
    `</svg>`,
  ].join("")
  return { svg, width, height }
}
