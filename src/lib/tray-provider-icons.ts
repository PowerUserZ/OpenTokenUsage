import { tLabel } from "@/lib/i18n"
import type { PluginMeta } from "@/lib/plugin-types"
import { makeTrayBarsSvg } from "@/lib/tray-bars-icon"
import type { TrayPrimaryBar } from "@/lib/tray-primary-progress"
import { formatTrayPercentText } from "@/lib/tray-tooltip"

export type ProviderTrayIconSpec = {
  providerId: string
  svg: string
  tooltip: string
}

/**
 * Provider logo inside a ring that fills with usage. A tray slot is 16 px at 100% scale: a logo
 * and digits side by side don't read there, a logo with a ring does (digits are in the tooltip).
 */
export function makeProviderRingSvg(args: {
  iconUrl: string
  fraction?: number
  sizePx: number
  color: string
  /** Brand color for the logo; the ring always uses `color`. */
  logoColor?: string
  /** How far the logo's pixels reach from its center, in half box widths (see measureLogoExtent). */
  logoExtent?: number
}): string {
  const { iconUrl, fraction, sizePx, color, logoColor = color, logoExtent = 1 } = args
  // Thin ring, big logo: at 16 px the logo is what you recognize.
  const stroke = sizePx * 0.08
  const center = sizePx / 2
  const radius = (sizePx - stroke) / 2
  const circumference = 2 * Math.PI * radius
  const filled =
    typeof fraction === "number" && Number.isFinite(fraction)
      ? Math.max(0, Math.min(1, fraction)) * circumference
      : 0
  // As big as fits inside the ring: a round logo grows, a square one's corners stay inside.
  const innerRadius = radius - stroke / 2 - sizePx * 0.06
  const logo = Math.min(sizePx, (2 * innerRadius) / Math.max(0.3, logoExtent))
  const offset = (sizePx - logo) / 2
  const ring = `cx="${center}" cy="${center}" r="${radius}" fill="none" stroke="${color}" stroke-width="${stroke}"`
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${sizePx}" height="${sizePx}" viewBox="0 0 ${sizePx} ${sizePx}">`,
    // Plugin logos are single-color shapes; use them as an alpha mask and paint the taskbar color.
    `<defs><mask id="logo" style="mask-type:alpha"><image href="${iconUrl}" x="${offset}" y="${offset}" width="${logo}" height="${logo}"/></mask></defs>`,
    `<circle ${ring} stroke-opacity="0.25"/>`,
    filled > 0
      ? `<circle ${ring} stroke-dasharray="${filled} ${circumference}" transform="rotate(-90 ${center} ${center})"/>`
      : "",
    `<rect x="${offset}" y="${offset}" width="${logo}" height="${logo}" fill="${logoColor}" mask="url(#logo)"/>`,
    `</svg>`,
  ].join("")
}

function relativeLuminance(hex: string): number | null {
  const match = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!match) return null
  const [r, g, b] = [0, 2, 4].map((i) => {
    const channel = parseInt(match[1]!.slice(i, i + 2), 16) / 255
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  })
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!
}

/**
 * The brand color when it stands out on the taskbar (3:1 contrast), else undefined so the caller
 * falls back to plain black/white: many brands are black, which vanishes on a dark taskbar.
 */
export function readableBrandColor(brandColor: string | undefined, onLightTaskbar: boolean): string | undefined {
  const luminance = brandColor ? relativeLuminance(brandColor) : null
  if (luminance === null) return undefined
  const background = onLightTaskbar ? 0.9 : 0.015
  const contrast = (Math.max(luminance, background) + 0.05) / (Math.min(luminance, background) + 0.05)
  return contrast >= 3 ? brandColor : undefined
}

const logoExtents = new Map<string, number>()

/**
 * How far a logo's visible pixels reach from the center of its box, in half box widths: about
 * 0.8 for a round logo, up to 1.4 for a square filling its box. Measured once per logo.
 */
export async function measureLogoExtent(iconUrl: string): Promise<number> {
  const cached = logoExtents.get(iconUrl)
  if (cached !== undefined) return cached
  const size = 64
  const image = new window.Image()
  image.src = iconUrl
  await image.decode()
  const canvas = document.createElement("canvas")
  canvas.width = size
  canvas.height = size
  const context = canvas.getContext("2d")
  if (!context) return 1
  context.drawImage(image, 0, 0, size, size)
  const alpha = context.getImageData(0, 0, size, size).data
  let farthest = 0
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      if (alpha[(y * size + x) * 4 + 3]! > 64) {
        farthest = Math.max(farthest, Math.hypot(x + 0.5 - size / 2, y + 0.5 - size / 2))
      }
    }
  }
  const extent = farthest > 0 ? farthest / (size / 2) : 1
  logoExtents.set(iconUrl, extent)
  return extent
}

/** One icon per provider bar, in the nav order the bars come in. */
export function buildProviderTrayIconSpecs(args: {
  bars: TrayPrimaryBar[]
  pluginsMeta: PluginMeta[]
  style: "numbers" | "logos"
  sizePx: number
  onLightTaskbar: boolean
  logoColors: boolean
  logoExtents?: Map<string, number>
}): ProviderTrayIconSpec[] {
  const { bars, pluginsMeta, style, sizePx, onLightTaskbar, logoColors, logoExtents } = args
  const color = onLightTaskbar ? "black" : "white"
  const metaById = new Map(pluginsMeta.map((meta) => [meta.id, meta]))
  return bars.flatMap((bar) => {
    const meta = metaById.get(bar.id)
    if (!meta) return []
    const percent = formatTrayPercentText(bar.fraction)
    const svg =
      style === "logos"
        ? makeProviderRingSvg({
            iconUrl: meta.iconUrl,
            fraction: bar.fraction,
            sizePx,
            color,
            logoColor: (logoColors && readableBrandColor(meta.brandColor, onLightTaskbar)) || color,
            logoExtent: logoExtents?.get(meta.iconUrl),
          })
        : makeTrayBarsSvg({
            bars: [bar],
            sizePx,
            style: "percent",
            percentText: percent === "--%" ? "--" : percent.replace(/%$/, ""),
            iconColor: color,
          })
    const tooltip = bar.label ? `${meta.name}\n${tLabel(bar.label)}: ${percent}` : `${meta.name}\n${percent}`
    return [{ providerId: bar.id, svg, tooltip }]
  })
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ""
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  }
  return btoa(binary)
}
