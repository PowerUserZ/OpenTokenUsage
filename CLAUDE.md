Read AGENTS.md first — it has the general rules (simplicity, error handling, PR checklist).
This file holds the project facts that are easy to get wrong.

## What this is
- OpenTokenUsage: **Windows-only** Tauri v2 tray app (React 19 + Tailwind v4 frontend, Rust host).
  Fork of `robinebers/openusage`; there is no macOS build — don't add macOS code paths back.
- Upstream (`upstream` remote) is now a Swift macOS app. **Never `git merge upstream/main`.**
  Port provider fixes by hand: read `git show upstream/main:CHANGELOG.md`, compare the Swift
  provider in `upstream/main:Sources/OpenUsage/Providers/<X>/` with `plugins/<x>/plugin.js`.
  The last Tauri upstream is branch `upstream/tauri-legacy` (= v0.6.28).

## Plugins (providers)
- `plugins/<id>/plugin.js` runs in **a fresh QuickJS runtime per probe**: module-level variables
  do NOT survive between refreshes (vitest reuses one instance, so tests hide this). Persist
  anything cross-probe under `ctx.app.pluginDataDir` (see claude `live-plan.json`).
- Every line label a plugin can emit on the overview card must be declared `scope: "overview"` in
  `plugin.json`, or that account type gets a blank card (the card filters by manifest labels).
- Response bodies are logged (first 500 chars) after `redact_body` in
  `src-tauri/src/plugin_engine/host_api.rs` — on any new endpoint, add identity fields
  (email, name, uuid, ids) to the redaction list with a test.
- Host already handles: HTTP 429 backoff per plugin+URL (`plugin_engine/http_gate.rs`), probe
  timeout (30 s), one probe per plugin at a time, panics → error result. Don't re-implement in JS.
- Paths: `~/Library/Application Support/<X>` is mapped to `%APPDATA%\<X>` by `expand_path`.
  SQLite goes through bundled `rusqlite` (no `sqlite3` CLI); no `ps`/`lsof`/`security` on Windows.

## UI
- Windows 11 Fluent look: colors are tokens in `src/index.css` (`--accent-base` = Windows accent
  from the registry, `.backdrop` = Mica active → translucent layers). Use tokens, not hex colors.
- **i18n:** every UI string goes through `t("key")` (`src/lib/i18n.ts`); plugin line labels through
  `tLabel()`. `src/locales/en.ts` is the source; a new key must be added to **all 11 locale files**
  (TypeScript fails otherwise). Keep `{placeholders}` identical (checked by `locales.test.ts`).
  Never compare translated text in logic. The native tray menu gets its labels from the frontend
  (`set_tray_menu_labels`).
- **Translation rule (always):** whenever a feature adds or changes user-facing text, update the
  key in **all 11 languages in the same change**: `src/locales/*.ts` for UI, plus
  `src/locales/plugin-errors/*.ts` for plugin errors. Rewording the English means rewording every
  language, and never paste English into another locale. `translation-lock.test.ts` fails when
  English text changes; after translating everything, run `bun run locales:lock`. Never re-lock
  without translating first.
- Errors: `getPluginErrorAction` turns known errors into one-click fixes: a login command →
  `run_in_terminal` (Rust allow-list in `setup_actions.rs`, test-synced with the plugin fixtures),
  a missing API-key env var → the Windows Environment Variables dialog. Env vars are also read from
  the registry, so a key added while the app is running works on the next refresh.
- Tray metric: one setting, `trayMetric` (auto | Session | Weekly), drives bars, percent and tooltip.
  Tray provider `tightest` = "Most used" line across providers. `trayHiddenPlugins` keeps a provider
  in the nav but out of the tray. The tray icon color follows the *taskbar* theme, not the app theme.
- Tray styles `numbers`/`logos` = one tray icon per provider (`use-provider-tray-icons.ts` draws,
  `tray::set_provider_tray_icons` shows them and hides the app icon). Update icons in place, never
  recreate (Windows keys "show next to clock" on tray-icon's creation-counter uID). A hidden tray
  icon rejects `setIcon`, so the app icon is redrawn after it's shown again. New icons are promoted
  via `HKCU\Control Panel\NotifyIconSettings\*\IsPromoted` only when the user hasn't chosen yet.
- Themes: system | light | dark | oled (`.oled` = opaque pure black, even over Mica).
- Notifications (`src/lib/usage-alerts.ts`, pure + tested): 80/95%, pace, reset; each once per
  provider+line+window, keys persisted in settings (`sentUsageAlerts`).
- Status badge: optional `statusPageUrl` in plugin.json (Atlassian Statuspage `/api/v2/status.json`
  only — verify the URL returns that JSON before adding one).
- Local HTTP API (127.0.0.1:6736) is loopback-only: no CORS, Host/Origin must be loopback. Don't add
  `Access-Control-Allow-Origin` back (any website could read usage).
- Keyboard: Ctrl (not Cmd/Win) shortcuts; show Ctrl/Alt in the UI.

## Verify before committing
- `bunx tsc --noEmit` · `bun run test` (src + plugins) · `cd src-tauri && cargo test --lib`.
- Vitest `testTimeout` is 20 s on purpose (cold transform of a file's first test is slow on
  Windows under load); don't lower it to "fix" speed — a timeout there is not a logic failure.

## Dependencies & releases
- `bunfig.toml` has `minimumReleaseAge` (7 days): don't force newer packages.
- Tauri JS packages and Rust crates must share **major.minor** (`@tauri-apps/api` ↔ `tauri`,
  `@tauri-apps/plugin-x` ↔ `tauri-plugin-x`); the Tauri CLI refuses to build otherwise.
- Release: bump the version in `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`
  (+ `Cargo.lock`), then push a `v*` tag → `publish.yml` (windows-latest) builds NSIS + MSI and
  signs updater artifacts with the `TAURI_SIGNING_*` repo secrets. The updater points at this
  fork's `latest.json`, never upstream's.
- `git push` is blocked by the owner's hook; do local commits and hand the push back.
- `.claude/skills/tauri-*` are real copies (git symlinks don't work on Windows without
  Developer Mode); keep them in sync with `.agents/skills/` if you edit one.
