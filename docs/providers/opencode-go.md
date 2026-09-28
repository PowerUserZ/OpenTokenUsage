# OpenCode Go

> Reads account-wide OpenCode Go usage from OpenCode's official usage API.

## Overview

- **Auth:** `~/.local/share/opencode/auth.json`, `opencode-go` entry `key`
- **Endpoint:** `GET https://opencode.ai/zen/go/v1/usage` with `Authorization: Bearer <key>`
- **Provider ID:** `opencode-go`
- **Usage scope:** account-wide (same numbers as the OpenCode dashboard, all devices)

## Meters

| Line | Response field | Period |
|---|---|---|
| Session | `usage.rolling.percent` / `resetsAt` | 5h |
| Weekly | `usage.weekly.percent` / `resetsAt` | 7d |
| Monthly | `usage.monthly.percent` / `resetsAt` | 30d |

Percents are clamped to 0–100.

## Errors

- No `opencode-go` key in `auth.json` → "OpenCode Go not detected" (a key set only via env/config is not read; the old local `opencode.db` spend estimate was removed)
- `auth.json` present but unreadable/invalid → error (not skipped)
- `401` → key rejected, log in again
- `403` with `error.type: "EntitlementError"` → no OpenCode Go subscription on this key
- Other non-2xx → HTTP error
- Missing `usage` or a missing `percent` → "Could not parse usage data"
