import type { ResetTimerDisplayMode, TimeFormatMode } from "@/lib/settings"
import { formatCompactDuration } from "@/lib/pace-tooltip"
import { getLocale, t } from "@/lib/i18n"

const timeFormatterCache = new Map<string, Intl.DateTimeFormat>()

export function getTimeFormatter(mode: TimeFormatMode): Intl.DateTimeFormat {
  const cacheKey = `${getLocale()}|${mode}`
  const cached = timeFormatterCache.get(cacheKey)
  if (cached) return cached
  const opts: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" }
  if (mode === "12h") opts.hour12 = true
  else if (mode === "24h") opts.hour12 = false
  // "auto" leaves hour12 unset so the app language decides.
  const formatter = new Intl.DateTimeFormat(getLocale(), opts)
  timeFormatterCache.set(cacheKey, formatter)
  return formatter
}

const RESET_SOON_THRESHOLD_MS = 5 * 60 * 1000

function parseResetTimestamp(resetsAtIso: string): number | null {
  const resetsAtMs = Date.parse(resetsAtIso)
  return Number.isFinite(resetsAtMs) ? resetsAtMs : null
}

function getLocalDayIndex(timestampMs: number): number {
  const date = new Date(timestampMs)
  return Math.floor(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000)
}

function formatMonthDay(timestampMs: number): string {
  return new Intl.DateTimeFormat(getLocale(), { month: "short", day: "numeric" }).format(timestampMs)
}

export function formatResetRelativeLabel(nowMs: number, resetsAtIso: string): string | null {
  const resetsAtMs = parseResetTimestamp(resetsAtIso)
  if (resetsAtMs === null) return null
  const deltaMs = resetsAtMs - nowMs
  if (deltaMs < RESET_SOON_THRESHOLD_MS) return t("reset.soon")
  const durationText = formatCompactDuration(deltaMs)
  return durationText ? t("reset.in", { time: durationText }) : null
}

export function formatResetAbsoluteLabel(
  nowMs: number,
  resetsAtIso: string,
  timeFormatMode: TimeFormatMode = "auto",
): string | null {
  const resetsAtMs = parseResetTimestamp(resetsAtIso)
  if (resetsAtMs === null) return null
  if (resetsAtMs - nowMs <= 0) return t("reset.soon")
  const dayDiff = getLocalDayIndex(resetsAtMs) - getLocalDayIndex(nowMs)
  const timeText = getTimeFormatter(timeFormatMode).format(resetsAtMs)
  if (dayDiff <= 0) return t("reset.todayAt", { time: timeText })
  if (dayDiff === 1) return t("reset.tomorrowAt", { time: timeText })
  return t("reset.onDateAt", { date: formatMonthDay(resetsAtMs), time: timeText })
}

export function formatResetTooltipText({
  nowMs,
  resetsAtIso,
  visibleMode,
  timeFormatMode = "auto",
}: {
  nowMs: number
  resetsAtIso: string
  visibleMode: ResetTimerDisplayMode
  timeFormatMode?: TimeFormatMode
}): string | null {
  return visibleMode === "absolute"
    ? formatResetRelativeLabel(nowMs, resetsAtIso)
    : formatResetAbsoluteLabel(nowMs, resetsAtIso, timeFormatMode)
}
