import { describe, expect, it } from "vitest"
import { insertAccount, isAccountId, isWslId } from "@/lib/accounts"

describe("accounts", () => {
  it("recognizes only the ids accounts.rs makes", () => {
    expect(isAccountId("claude-1a2b3c4d")).toBe(true)
    expect(isAccountId("codex-00000000")).toBe(true)
    expect(isAccountId("claude")).toBe(false)
    expect(isAccountId("cursor-1a2b3c4d")).toBe(false)
    expect(isAccountId("claude-1A2B3C4D")).toBe(false)
    expect(isAccountId(undefined)).toBe(false)
  })

  it("puts a new account after its provider and that provider's other accounts", () => {
    expect(insertAccount(["claude", "codex", "cursor"], "codex-00000001", "codex")).toEqual([
      "claude",
      "codex",
      "codex-00000001",
      "cursor",
    ])
    expect(insertAccount(["claude", "claude-00000001", "codex"], "claude-00000002", "claude")).toEqual([
      "claude",
      "claude-00000001",
      "claude-00000002",
      "codex",
    ])
    // The provider isn't in the order (never enabled): at the end.
    expect(insertAccount(["cursor"], "claude-00000001", "claude")).toEqual(["cursor", "claude-00000001"])
    // Adding twice doesn't duplicate.
    expect(insertAccount(["claude", "claude-00000001"], "claude-00000001", "claude")).toEqual(["claude", "claude-00000001"])
  })

  it("puts a WSL card after its provider and that provider's other cards", () => {
    expect(insertAccount(["claude", "claude-1a2b3c4d", "codex"], "claude-wsl-0a1b2c3d", "claude")).toEqual([
      "claude",
      "claude-1a2b3c4d",
      "claude-wsl-0a1b2c3d",
      "codex",
    ])
    expect(isWslId("opencode-go-wsl-0a1b2c3d")).toBe(true)
    expect(isWslId("claude-1a2b3c4d")).toBe(false)
  })
})
