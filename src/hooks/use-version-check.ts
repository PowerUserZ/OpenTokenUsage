import { useEffect, useState } from "react"

const GITHUB_API = "https://api.github.com/repos/PowerUserZ/OpenTokenUsage/releases/latest"
const CHECK_INTERVAL_MS = 30 * 60 * 1000 // 30 minutes

type VersionCheckResult = {
  hasUpdate: boolean
  latestVersion: string | null
  releaseUrl: string | null
}

function compareVersions(current: string, latest: string): boolean {
  const parse = (v: string) => v.replace(/^v/, "").split(".").map(Number)
  const c = parse(current)
  const l = parse(latest)
  for (let i = 0; i < Math.max(c.length, l.length); i++) {
    const cv = c[i] ?? 0
    const lv = l[i] ?? 0
    if (lv > cv) return true
    if (lv < cv) return false
  }
  return false
}

async function checkLatestVersion(currentVersion: string): Promise<VersionCheckResult> {
  try {
    const res = await fetch(GITHUB_API)
    if (!res.ok) return { hasUpdate: false, latestVersion: null, releaseUrl: null }
    const data = await res.json()
    const tagName = String(data.tag_name ?? "")
    const latestVersion = tagName.replace(/^v/, "")
    const hasUpdate = compareVersions(currentVersion, latestVersion)
    return {
      hasUpdate,
      latestVersion: hasUpdate ? latestVersion : null,
      releaseUrl: hasUpdate ? String(data.html_url ?? "") : null,
    }
  } catch {
    return { hasUpdate: false, latestVersion: null, releaseUrl: null }
  }
}

export function useVersionCheck(currentVersion: string): VersionCheckResult {
  const [result, setResult] = useState<VersionCheckResult>({
    hasUpdate: false,
    latestVersion: null,
    releaseUrl: null,
  })

  useEffect(() => {
    let cancelled = false

    const check = async () => {
      const r = await checkLatestVersion(currentVersion)
      if (!cancelled) setResult(r)
    }

    check()
    const timer = setInterval(check, CHECK_INTERVAL_MS)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [currentVersion])

  return result
}
