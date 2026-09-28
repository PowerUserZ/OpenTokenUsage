/** A custom notification sound is kept short and small: mono, 44.1 kHz, at most this long. */
export const CUSTOM_SOUND_MAX_SECONDS = 5
/**
 * Bigger files are refused before decoding: the whole file is decoded before the 5 s cut, and a long
 * low-bitrate file would decode to gigabytes. Any 5 s clip, and most songs, fit.
 */
export const CUSTOM_SOUND_MAX_MB = 5

export class SoundFileTooLargeError extends Error {}
const SAMPLE_RATE = 44_100
const FADE_OUT_SECONDS = 0.05

/** 16-bit PCM mono WAV, the only layout `alert_sound.rs` accepts. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const text = (offset: number, value: string) =>
    [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)))
  text(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, "WAVEfmt ")
  view.setUint32(16, 16, true) // fmt chunk size
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // mono
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true) // bytes per second
  view.setUint16(32, 2, true) // bytes per frame
  view.setUint16(34, 16, true) // bits per sample
  text(36, "data")
  view.setUint32(40, samples.length * 2, true)
  samples.forEach((sample, i) => view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, sample)) * 32767), true))
  return bytes
}

/** Mixes the channels to mono and cuts at the maximum length, with a short fade so it doesn't click. */
export function toShortMono(channels: Float32Array[], sampleRate: number): Float32Array {
  const fullLength = channels[0]?.length ?? 0
  const length = Math.min(fullLength, Math.round(CUSTOM_SOUND_MAX_SECONDS * sampleRate))
  const mono = new Float32Array(length)
  for (const channel of channels) {
    for (let i = 0; i < length; i++) mono[i]! += channel[i]! / channels.length
  }
  if (fullLength > length) {
    const fade = Math.min(length, Math.round(FADE_OUT_SECONDS * sampleRate))
    for (let i = 0; i < fade; i++) mono[length - fade + i]! *= 1 - (i + 1) / fade
  }
  return mono
}

/** Any audio file the webview can decode (mp3, wav, ogg, m4a, flac...) as our WAV. */
export async function audioFileToWav(file: File): Promise<Uint8Array> {
  if (file.size > CUSTOM_SOUND_MAX_MB * 1024 * 1024) throw new SoundFileTooLargeError(file.name)
  // Decoding on a 44.1 kHz context also resamples to 44.1 kHz.
  const decoded = await new OfflineAudioContext(1, 1, SAMPLE_RATE).decodeAudioData(await file.arrayBuffer())
  const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i))
  return encodeWav(toShortMono(channels, decoded.sampleRate), decoded.sampleRate)
}
