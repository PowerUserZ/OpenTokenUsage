import { renderHook, act } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { useProbeState } from "@/hooks/app/use-probe-state"

describe("useProbeState", () => {
  it("updates pluginStatesRef synchronously when marking plugins loading", () => {
    const { result } = renderHook(() => useProbeState({}))

    let loadingImmediatelyAfterSet: boolean | undefined
    act(() => {
      result.current.setLoadingForPlugins(["codex"])
      loadingImmediatelyAfterSet =
        result.current.pluginStatesRef.current.codex?.loading
    })

    expect(loadingImmediatelyAfterSet).toBe(true)
    expect(result.current.pluginStates.codex?.loading).toBe(true)
  })

  it("dates cached data by when it was fetched", () => {
    const { result } = renderHook(() => useProbeState({}))
    act(() => {
      result.current.handleProbeResult({
        providerId: "claude-wsl-1a2b3c4d",
        displayName: "Claude · WSL",
        lines: [],
        iconUrl: "",
        staleSince: 1_000,
      })
    })
    expect(result.current.pluginStates["claude-wsl-1a2b3c4d"]?.lastUpdatedAt).toBe(1_000)
  })
})
