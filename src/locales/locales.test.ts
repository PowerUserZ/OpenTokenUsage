import { describe, expect, it } from "vitest"
import { LANGUAGES, matchLanguage, resolveLanguage, t } from "@/lib/i18n"
import { en, type MessageKey } from "@/locales/en"

const placeholders = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()

describe("locales", () => {
  // TypeScript already forces every key to exist; a dropped/renamed {placeholder} would silently
  // show the raw "{time}" text, so check those at runtime.
  for (const language of LANGUAGES) {
    it(`${language.code} keeps every placeholder`, () => {
      for (const key of Object.keys(en) as MessageKey[]) {
        expect(placeholders(language.messages[key]), `${language.code} ${key}`).toEqual(placeholders(en[key]))
      }
    })
  }

  it("maps Windows display languages to a supported locale", () => {
    expect(matchLanguage("tr")).toBe("tr-TR")
    expect(matchLanguage("es-MX")).toBe("es-419")
    expect(matchLanguage("es")).toBe("es-ES")
    expect(matchLanguage("zh-TW")).toBe("zh-CN")
    expect(matchLanguage("pt-PT")).toBe("pt-BR")
    expect(resolveLanguage("system", ["nl-NL", "de-AT"])).toBe("de-DE")
    expect(resolveLanguage("system", ["nl-NL"])).toBe("en-US")
    expect(resolveLanguage("ja-JP", ["tr-TR"])).toBe("ja-JP")
  })

  it("interpolates variables", () => {
    expect(t("reset.in", { time: "2h 5m" })).toBe("Resets in 2h 5m")
  })
})
