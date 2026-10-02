import { beforeAll, describe, expect, it } from "vitest"
import { makeCtx } from "./test-helpers.js"

// accountKey(ctx): who the plugin is signed in as, from local files only (wsl.rs compares them).
const plugins = {}
// Nine cold plugin transforms in one hook: give it the suite's 20 s test budget (vite.config.ts), not the 10 s hook default.
beforeAll(async () => {
  await import("./claude/plugin.js"); plugins.claude = globalThis.__openusage_plugin
  await import("./codex/plugin.js"); plugins.codex = globalThis.__openusage_plugin
  await import("./opencode-go/plugin.js"); plugins.opencode = globalThis.__openusage_plugin
  await import("./amp/plugin.js"); plugins.amp = globalThis.__openusage_plugin
  await import("./grok/plugin.js"); plugins.grok = globalThis.__openusage_plugin
  await import("./kimi/plugin.js"); plugins.kimi = globalThis.__openusage_plugin
  await import("./factory/plugin.js"); plugins.factory = globalThis.__openusage_plugin
  await import("./synthetic/plugin.js"); plugins.synthetic = globalThis.__openusage_plugin
  await import("./devin/plugin.js"); plugins.devin = globalThis.__openusage_plugin
}, 20_000)

const jwt = (ctx, payload) => "h." + ctx.base64.encode(JSON.stringify(payload)) + ".s"
const withFile = (path, value) => {
  const ctx = makeCtx()
  ctx.host.fs.writeText(path, typeof value === "string" ? value : JSON.stringify(value))
  return ctx
}

describe("accountKey", () => {
  it("is null for every plugin without a login, and never makes a request", () => {
    for (const [name, plugin] of Object.entries(plugins)) {
      const ctx = makeCtx()
      expect(plugin.accountKey(ctx), name).toBeNull()
      expect(ctx.host.http.request, name).not.toHaveBeenCalled()
    }
  })

  it("claude: the account id in ~/.claude.json", () => {
    const ctx = withFile("~/.claude.json", { oauthAccount: { accountUuid: "uuid-1" } })
    expect(plugins.claude.accountKey(ctx)).toBe("uuid-1")
  })

  it("claude: next to the login when CLAUDE_CONFIG_DIR is set", () => {
    const ctx = withFile("C:/accounts/claude-1/.claude.json", { oauthAccount: { accountUuid: "uuid-2" } })
    ctx.host.env.get.mockImplementation((name) => (name === "CLAUDE_CONFIG_DIR" ? "C:/accounts/claude-1" : null))
    expect(plugins.claude.accountKey(ctx)).toBe("uuid-2")
  })

  it("codex: the ChatGPT account id", () => {
    const ctx = withFile("~/.codex/auth.json", {
      OPENAI_API_KEY: null,
      tokens: { id_token: "i", access_token: "a", refresh_token: "r", account_id: "acct-1" },
    })
    expect(plugins.codex.accountKey(ctx)).toBe("acct-1")
  })

  it("opencode-go: the Go key", () => {
    const ctx = withFile("~/.local/share/opencode/auth.json", { "opencode-go": { type: "api", key: "oc-1" } })
    expect(plugins.opencode.accountKey(ctx)).toBe("oc-1")
  })

  it("amp: the API key", () => {
    const ctx = withFile("~/.local/share/amp/secrets.json", { "apiKey@https://ampcode.com/": "amp-1" })
    expect(plugins.amp.accountKey(ctx)).toBe("amp-1")
  })

  it("grok: the user id, without refreshing an expired token", () => {
    const ctx = withFile("~/.grok/auth.json", {
      "https://auth.x.ai::abc": { key: "tok", user_id: "u-1", expires_at: "2000-01-01T00:00:00Z", refresh_token: "r" },
    })
    expect(plugins.grok.accountKey(ctx)).toBe("u-1")
    expect(ctx.host.http.request).not.toHaveBeenCalled()
  })

  it("kimi: the token's subject", () => {
    const ctx = makeCtx()
    // Payloads whose JSON is a multiple of 3 bytes: no base64 padding inside the fake token.
    ctx.host.fs.writeText("~/.kimi/credentials/kimi-code.json", JSON.stringify({ access_token: jwt(ctx, { sub: "kimi-123" }), refresh_token: "r" }))
    expect(plugins.kimi.accountKey(ctx)).toBe("kimi-123")
  })

  it("factory: the access token's subject", () => {
    const ctx = makeCtx()
    ctx.host.fs.writeText("~/.factory/auth.json", JSON.stringify({ access_token: jwt(ctx, { sub: "fac-1" }), refresh_token: "r" }))
    expect(plugins.factory.accountKey(ctx)).toBe("fac-1")
  })

  it("synthetic: the API key, not opencode's Go key in the same file", () => {
    const ctx = withFile("~/.local/share/opencode/auth.json", { "opencode-go": { type: "api", key: "oc-1" } })
    expect(plugins.synthetic.accountKey(ctx)).toBeNull()
    ctx.host.fs.writeText("~/.pi/agent/auth.json", JSON.stringify({ synthetic: { type: "api_key", key: "syn-1" } }))
    expect(plugins.synthetic.accountKey(ctx)).toBe("syn-1")
  })

  it("devin: the CLI's API key", () => {
    const ctx = withFile("~/.local/share/devin/credentials.toml", 'windsurf_api_key = "devin-1"\n')
    expect(plugins.devin.accountKey(ctx)).toBe("devin-1")
  })
})
