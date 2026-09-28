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
- Tray metric: one setting, `trayMetric` (auto | Session | Weekly), drives bars, percent and tooltip.
- Keyboard: Ctrl (not Cmd/Win) shortcuts; show Ctrl/Alt in the UI.

## Verify before committing
- `bunx tsc --noEmit` · `bun run test` (src + plugins) · `cd src-tauri && cargo test --lib`.
- Under full-suite load the first test of a heavy file can hit the 5 s timeout; rerun that file
  alone before treating it as a failure.

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
