import type { PluginMeta } from "@/lib/plugin-types"
import {
  MAX_TASKBAR_STRIP_PROVIDERS,
  TASKBAR_STRIP_FONTS,
  type DisplayMode,
  type PluginSettings,
  type TaskbarStripStyle,
} from "@/lib/settings"
import type { TrayPrimaryBar } from "@/lib/tray-primary-progress"
import { formatTrayPercentText } from "@/lib/tray-tooltip"
import { readableBrandColor } from "@/lib/tray-provider-icons"

export type TaskbarStripLine = { text: string; color: string }

export type TaskbarStripItem = {
  iconUrl: string
  logoColor: string
  /** Primary (session-like) value first, then weekly when the provider has a separate one. */
  lines: TaskbarStripLine[]
}

/** Logical px; the Windows 11 taskbar is 48 px tall. */
const HEIGHT = 40
const LOGO = 22
const LOGO_GAP = 5
const ITEM_GAP = 12

export type MeasureText = (text: string, fontSizePx: number, fontCss: string, weight: number) => number

/** Rough text width for tests; the app measures with a canvas. */
export const estimateTextWidth: MeasureText = (text, fontSizePx) => text.length * fontSizePx * 0.58

export const measureTextWithCanvas: MeasureText = (text, fontSizePx, fontCss, weight) => {
  const context = document.createElement("canvas").getContext("2d")
  if (!context) return estimateTextWidth(text, fontSizePx, fontCss, weight)
  context.font = `${weight} ${fontSizePx}px ${fontCss}`
  return context.measureText(text).width
}

export function fontCssOf(style: TaskbarStripStyle): string {
  return (TASKBAR_STRIP_FONTS.find((font) => font.id === style.font) ?? TASKBAR_STRIP_FONTS[0]).css
}

/**
 * The providers the strip shows, as plugin settings for `getTrayPrimaryBars`: the user's own strip
 * list (independent of the nav order) or the first enabled providers, never a disabled one.
 */
export function stripPluginSettings(selected: string[] | null, settings: PluginSettings): PluginSettings {
  const enabled = settings.order.filter((id) => !settings.disabled.includes(id))
  const ids = (selected ?? enabled).filter((id) => enabled.includes(id))
  return { order: ids.slice(0, MAX_TASKBAR_STRIP_PROVIDERS), disabled: [] }
}

function lineColor(bar: TrayPrimaryBar | undefined, base: string, style: TaskbarStripStyle, displayMode: DisplayMode) {
  const fraction = bar?.fraction
  if (!style.usageColors || typeof fraction !== "number") return base
  const usedPercent = (displayMode === "left" ? 1 - fraction : fraction) * 100
  if (usedPercent >= style.criticalAt) return style.criticalColor
  if (usedPercent >= style.warnAt) return style.warnColor
  return base
}

export function buildTaskbarStripItems(args: {
  primaryBars: TrayPrimaryBar[]
  weeklyBars: TrayPrimaryBar[]
  pluginsMeta: PluginMeta[]
  onLightTaskbar: boolean
  logoColors: boolean
  displayMode: DisplayMode
  style: TaskbarStripStyle
}): TaskbarStripItem[] {
  const { primaryBars, weeklyBars, pluginsMeta, onLightTaskbar, logoColors, displayMode, style } = args
  const taskbarColor = onLightTaskbar ? "black" : "white"
  const base = style.textColor ?? taskbarColor
  const metaById = new Map(pluginsMeta.map((meta) => [meta.id, meta]))
  const weeklyById = new Map(weeklyBars.map((bar) => [bar.id, bar]))
  const text = (bar: TrayPrimaryBar | undefined) => {
    const percent = formatTrayPercentText(bar?.fraction)
    if (percent === "--%") return "--"
    return style.showPercentSign ? percent : percent.replace(/%$/, "")
  }
  return primaryBars.flatMap((primary) => {
    const meta = metaById.get(primary.id)
    if (!meta) return []
    const weekly = weeklyById.get(primary.id)
    const lines = [{ text: text(primary), color: lineColor(primary, base, style, displayMode) }]
    if (style.showWeekly && weekly?.weekly === true && weekly.label !== primary.label) {
      lines.push({ text: text(weekly), color: lineColor(weekly, base, style, displayMode) })
    }
    return [
      {
        iconUrl: meta.iconUrl,
        logoColor: (logoColors && readableBrandColor(meta.brandColor, onLightTaskbar)) || taskbarColor,
        lines,
      },
    ]
  })
}

/** The strip as one SVG, sized in physical px (`scale` = devicePixelRatio). */
export function makeTaskbarStripSvg(args: {
  items: TaskbarStripItem[]
  style: TaskbarStripStyle
  scale: number
  measure?: MeasureText
}): { svg: string; width: number; height: number } {
  const { items, style, scale, measure = estimateTextWidth } = args
  const px = (value: number) => Math.round(value * scale)
  const height = px(HEIGHT)
  const fontSize = style.fontSize * scale
  const fontCss = fontCssOf(style)
  const weight = style.bold ? 600 : 400
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
    const lineHeight = fontSize * 1.2
    const firstCenter = height / 2 - ((item.lines.length - 1) * lineHeight) / 2
    item.lines.forEach((line, i) => {
      parts.push(
        `<text x="${x}" y="${firstCenter + i * lineHeight}" dominant-baseline="central" fill="${line.color}" font-family='${fontCss}' font-size="${fontSize}" font-weight="${weight}" style="font-variant-numeric:tabular-nums">${line.text}</text>`
      )
    })
    x += Math.ceil(Math.max(0, ...item.lines.map((line) => measure(line.text, fontSize, fontCss, weight))))
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
