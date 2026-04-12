# OpenTokenUsage

Track all your AI coding subscriptions in one place — now on **Windows** too.

See your usage at a glance from your system tray. No digging through dashboards.

> **Fork of [OpenUsage](https://github.com/robinebers/openusage) by Robin Ebers.** This fork adds full Windows support while preserving macOS functionality.

## Download

[**Download the latest release**](https://github.com/PowerUserZ/OpenTokenUsage/releases/latest) (Windows & macOS)

The app auto-updates. Install once and you're set.

## What's Different in This Fork

- **Windows support.** Full cross-platform: tray icon, drag-to-move, resize, minimize-to-tray, auto-positioning near taskbar.
- **Themed tray icon.** White icon for dark taskbar, proper dynamic icon rendering on Windows.
- **No CMD flash.** Subprocess calls use `CREATE_NO_WINDOW` so no console windows pop up.
- **Auto-promote tray icon.** Icon appears in the visible tray area (next to clock) on first launch.
<<<<<<< HEAD
=======
- **Defaults tuned.** Dark theme, "Used" mode, autostart enabled, plugin order: Claude > Codex > Gemini.
- **Codex credits fix.** No longer hardcoded to 1000 — reads actual limit from API.
- **Z.ai renamed.** Shown as "Z.ai (GLM)" for clarity.
>>>>>>> origin/main

## What It Does

OpenTokenUsage lives in your system tray and shows you how much of your AI coding subscriptions you've used. Progress bars, badges, and clear labels. No mental math required.

- **One glance.** All your AI tools, one panel.
- **Always up-to-date.** Refreshes automatically on a schedule you pick.
- **Global shortcut.** Toggle the panel from anywhere with a customizable keyboard shortcut.
- **Lightweight.** Opens instantly, stays out of your way.
- **Plugin-based.** New providers get added without updating the whole app.
- **[Local HTTP API](docs/local-http-api.md).** Other apps can read your usage data from `127.0.0.1:6736`.
- **[Proxy support](docs/proxy.md).** Route provider HTTP requests through a SOCKS5 or HTTP proxy.

## Supported Providers

- [**Amp**](docs/providers/amp.md) / free tier, bonus, credits
- [**Antigravity**](docs/providers/antigravity.md) / all models
- [**Claude**](docs/providers/claude.md) / session, weekly, extra usage, local token usage (ccusage)
- [**Codex**](docs/providers/codex.md) / session, weekly, reviews, credits
- [**Copilot**](docs/providers/copilot.md) / premium, chat, completions
- [**Cursor**](docs/providers/cursor.md) / credits, total usage, auto usage, API usage, on-demand, CLI auth
- [**Factory / Droid**](docs/providers/factory.md) / standard, premium tokens
- [**Gemini**](docs/providers/gemini.md) / pro, flash, workspace/free/paid tier
- [**JetBrains AI Assistant**](docs/providers/jetbrains-ai-assistant.md) / quota, remaining
- [**Kiro**](docs/providers/kiro.md) / credits, bonus credits, overages
- [**Kimi Code**](docs/providers/kimi.md) / session, weekly
- [**MiniMax**](docs/providers/minimax.md) / coding plan session
- [**OpenCode Go**](docs/providers/opencode-go.md) / 5h, weekly, monthly spend limits
- [**Windsurf**](docs/providers/windsurf.md) / prompt credits, flex credits
- [**Z.ai (GLM)**](docs/providers/zai.md) / session, weekly, web searches

## Contributing

- **Add a provider.** Each one is just a plugin. See the [Plugin API](docs/plugins/api.md).
- **Fix a bug.** PRs welcome. Provide before/after screenshots.
- **Request a feature.** [Open an issue](https://github.com/PowerUserZ/OpenTokenUsage/issues/new) and make your case.

## Credits

- Original project: [OpenUsage](https://github.com/robinebers/openusage) by [Robin Ebers](https://itsbyrob.in/x)
- Windows port: [PowerUserZ](https://github.com/PowerUserZ)
- Inspired by [CodexBar](https://github.com/steipete/CodexBar) by [@steipete](https://github.com/steipete)

## License

[MIT](LICENSE)

---

<details>
<summary><strong>Build from source</strong></summary>

### Prerequisites

- [Rust](https://www.rust-lang.org/tools/install)
- [Bun](https://bun.sh)
- [Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/)

### Steps

```bash
git clone https://github.com/PowerUserZ/OpenTokenUsage.git
cd OpenTokenUsage
bun install
bun tauri build
```

The built app will be in `src-tauri/target/release/bundle/`.

</details>
