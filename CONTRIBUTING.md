# Contributing to OpenTokenUsage

OpenTokenUsage accepts contributions, but has a high quality bar. Read this entire document before opening a PR.

## Philosophy

OpenTokenUsage is opinionated. It focuses on clean design, fast performance, and a great experience on Windows 11. The feature set is intentionally limited to core functionality: tracking AI coding subscription usage, nothing more. Contributions that try to expand that scope, add unnecessary complexity, or compromise the UX will be closed.

If you're unsure whether your idea fits, open an issue first.

## Ground Rules

- No feature creep. If it's not about usage tracking, it doesn't belong here.
- Windows only. Don't add macOS or Linux code paths.
- Test your changes. If it touches UI, include before/after screenshots.
- Keep it simple. Don't over-engineer.
- One PR per concern. Don't bundle unrelated changes.
- Match the existing design language: the Windows 11 Fluent look, with colors from the tokens in `src/index.css`.
- Every new or changed UI string goes into all 11 languages in `src/locales/` in the same PR, then run `bun run locales:lock`.

## License Agreement

By submitting a pull request, you agree that your contribution is licensed under the [MIT License](LICENSE) that covers this project.

## How to Contribute

### Fork and PR workflow

1. Fork the repo
2. Create a branch (`feat/my-change`, `fix/some-bug`, etc.)
3. Make your changes
4. Verify nothing is broken: `bunx tsc --noEmit`, `bun run test`, and `cd src-tauri && cargo test --lib`
5. Open a PR against `main`

### Add a provider plugin

Each provider is a plugin. See the [Plugin API docs](docs/plugins/api.md) for the full spec.

1. Create a new folder under `plugins/` with your provider name
2. Add `plugin.json` (metadata) and `plugin.js` (implementation)
3. Add documentation in `docs/providers/`
4. Test it locally with `bun tauri dev`
5. Open a PR with screenshots showing it working

You can also [open an issue](https://github.com/PowerUserZ/OpenTokenUsage/issues/new?template=new_provider.yml) to request a provider without building it yourself.

### Fix a bug

1. Reference the issue number in your PR
2. Describe the root cause and fix
3. Include before/after screenshots for UI bugs
4. Add a regression test if applicable

### Request a feature

Don't open a PR for large features without discussing first. [Open an issue](https://github.com/PowerUserZ/OpenTokenUsage/issues/new?template=feature_request.yml) and make your case.

## What Gets Accepted

- Bug fixes with clear descriptions
- New provider plugins that follow the Plugin API
- Translations and documentation improvements
- Performance improvements with benchmarks
- Accessibility improvements

## What Gets Rejected

- Features that expand the scope beyond usage tracking
- Changes that compromise speed, simplicity, or the existing UX
- Analytics or telemetry of any kind
- PRs without testing evidence
- Code with no clear purpose or explanation
- Cosmetic-only changes without prior discussion

## Code Standards

- TypeScript for the frontend (`src/`)
- Rust for the backend (`src-tauri/`)
- Follow existing patterns in the codebase
- No new dependencies without justification

## Maintainer

[@PowerUserZ](https://github.com/PowerUserZ) reviews and merges PRs and cuts releases (`v*` tags).

## Questions?

Open a [bug report](https://github.com/PowerUserZ/OpenTokenUsage/issues/new?template=bug_report.yml) or [feature request](https://github.com/PowerUserZ/OpenTokenUsage/issues/new?template=feature_request.yml) using the issue templates. Found a security problem? Don't open an issue; see [SECURITY.md](SECURITY.md).
