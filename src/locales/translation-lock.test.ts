import { createHash } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"
import { expect, it } from "vitest"
import { en } from "@/locales/en"
import enErrors from "@/locales/plugin-errors/en-US"

// Fingerprint of every English source text at the time all locales were last translated.
// TypeScript only catches missing keys; this catches English text that was added or reworded
// while the other 10 languages kept the old meaning.
const LOCK_FILE = "src/locales/en.lock.json"

const fingerprint = (text: string) => createHash("sha1").update(text).digest("hex").slice(0, 10)

const current: Record<string, string> = Object.fromEntries([
  ...Object.entries(en).map(([key, text]) => [key, fingerprint(text)]),
  ...Object.entries(enErrors).map(([key, text]) => [`plugin-errors.${key}`, fingerprint(text)]),
])

it("every English text change is translated into all languages", () => {
  if (process.env.UPDATE_LOCALE_LOCK) {
    writeFileSync(LOCK_FILE, `${JSON.stringify(current, null, 2)}\n`)
  }
  const locked: Record<string, string> = JSON.parse(readFileSync(LOCK_FILE, "utf8"))
  const keys = new Set([...Object.keys(current), ...Object.keys(locked)])
  const changed = [...keys].filter((key) => locked[key] !== current[key])
  expect(
    changed,
    "English text was added, changed or removed for these keys. Translate them in EVERY file in " +
      "src/locales/ (and src/locales/plugin-errors/ for plugin-errors.*), then run `bun run locales:lock`.",
  ).toEqual([])
})
