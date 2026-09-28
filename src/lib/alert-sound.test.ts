import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { CUSTOM_SOUND_MAX_SECONDS, encodeWav, toShortMono } from "@/lib/alert-sound"
import { ALERT_SOUNDS } from "@/lib/settings"

describe("encodeWav", () => {
  it("writes the 16-bit PCM mono layout the host accepts", () => {
    const bytes = encodeWav(new Float32Array([0, 1, -1, 2]), 44_100)
    const view = new DataView(bytes.buffer)
    const text = (offset: number, length: number) => String.fromCharCode(...bytes.subarray(offset, offset + length))
    expect(text(0, 4)).toBe("RIFF")
    expect(text(8, 8)).toBe("WAVEfmt ")
    expect(text(36, 4)).toBe("data")
    expect(view.getUint16(20, true)).toBe(1) // PCM
    expect(view.getUint16(22, true)).toBe(1) // mono
    expect(view.getUint32(24, true)).toBe(44_100)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(bytes.length - 44)
    expect([1, 2, 3].map((i) => view.getInt16(44 + i * 2, true))).toEqual([32767, -32767, 32767]) // clipped
  })
})

describe("toShortMono", () => {
  it("averages the channels", () => {
    expect([...toShortMono([new Float32Array([1, 0.5]), new Float32Array([0, 0.5])], 10)]).toEqual([0.5, 0.5])
  })

  it("cuts long sounds and fades the cut to silence", () => {
    const rate = 1000
    const long = new Float32Array((CUSTOM_SOUND_MAX_SECONDS + 3) * rate).fill(1)
    const mono = toShortMono([long], rate)
    expect(mono.length).toBe(CUSTOM_SOUND_MAX_SECONDS * rate)
    expect(mono[0]).toBe(1)
    expect(mono[mono.length - 1]).toBe(0)
  })
})

describe("bundled sounds", () => {
  it("the settings list matches the ids the host can play", () => {
    const rust = readFileSync("src-tauri/src/alert_sound.rs", "utf8")
    const builtIn = [...rust.match(/const BUILT_IN[^=]*=\s*\[([^\]]*)\]/)![1]!.matchAll(/"([^"]+)"/g)].map((m) => m[1])
    expect(ALERT_SOUNDS.filter((sound) => !["windows", "none", "custom"].includes(sound))).toEqual(builtIn)
  })
})
