//! Notification sounds. A toast from an unpackaged app can only play Windows' own sounds, so the
//! toast stays silent and the sound the user picked is played here with PlaySound.

use base64::{engine::general_purpose::STANDARD as BASE64_STANDARD, Engine as _};
use std::path::PathBuf;
use tauri::path::BaseDirectory;
use tauri::{AppHandle, Manager};

/// Bundled sounds (`src-tauri/sounds`, Kenney, CC0), by the id the frontend stores.
const BUILT_IN: [&str; 8] = [
    "chime",
    "glass",
    "steel",
    "pizzicato",
    "retro",
    "two-tone",
    "three-tone",
    "rise",
];
const CUSTOM_FILE: &str = "alert-sound.wav";
/// The frontend trims a custom sound to 5 s of 44.1 kHz mono 16-bit (about 430 KB).
const MAX_CUSTOM_BYTES: usize = 1024 * 1024;

/// Plays a notification sound. A `preview` (settings page) also plays during Do Not Disturb.
#[tauri::command]
pub fn play_alert_sound(app_handle: AppHandle, sound: String, preview: bool) -> Result<(), String> {
    if sound == "none" || (!preview && do_not_disturb()) {
        return Ok(());
    }
    if sound == "windows" {
        return play(Source::Alias("Notification.Default"));
    }
    let path = if sound == "custom" {
        custom_path(&app_handle)?
    } else if BUILT_IN.contains(&sound.as_str()) {
        app_handle
            .path()
            .resolve(format!("sounds/{sound}.wav"), BaseDirectory::Resource)
            .map_err(|e| e.to_string())?
    } else {
        return Err(format!("unknown sound {sound}"));
    };
    // An async PlaySound reports success before it looks for the file.
    if !path.is_file() {
        return Err(format!("sound file {} is missing", path.display()));
    }
    play(Source::File(path))
}

/// Stores the user's own sound, already converted to WAV by the frontend.
#[tauri::command]
pub fn save_custom_alert_sound(app_handle: AppHandle, wav: String) -> Result<(), String> {
    if wav.len() > MAX_CUSTOM_BYTES.div_ceil(3) * 4 {
        return Err("sound file is too large".to_string());
    }
    let bytes = BASE64_STANDARD.decode(wav).map_err(|e| e.to_string())?;
    check_wav(&bytes)?;
    // Write aside and swap in, so a failed write never leaves a half file to be played later.
    let path = custom_path(&app_handle)?;
    let partial = path.with_extension("wav.tmp");
    std::fs::write(&partial, bytes)
        .and_then(|()| std::fs::rename(&partial, &path))
        .map_err(|e| {
            let _ = std::fs::remove_file(&partial);
            e.to_string()
        })
}

fn custom_path(app_handle: &AppHandle) -> Result<PathBuf, String> {
    let dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.join(CUSTOM_FILE))
}

/// Only the plain layout the frontend writes: RIFF/WAVE, a 16-byte PCM `fmt ` chunk (16-bit,
/// 1-2 channels, 8-96 kHz, consistent sizes), then `data` up to the end. Anything else never
/// reaches PlaySound.
fn check_wav(bytes: &[u8]) -> Result<(), String> {
    let u16_at = |i: usize| u16::from_le_bytes([bytes[i], bytes[i + 1]]);
    let u32_at =
        |i: usize| u32::from_le_bytes([bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]]);
    if bytes.len() < 44
        || &bytes[0..4] != b"RIFF"
        || &bytes[8..16] != b"WAVEfmt "
        || &bytes[36..40] != b"data"
    {
        return Err("not a WAV file".to_string());
    }
    let (channels, rate) = (u16_at(22), u32_at(24));
    let pcm_16 = u32_at(16) == 16 && u16_at(20) == 1 && u16_at(34) == 16;
    let channels_ok = matches!(channels, 1 | 2);
    let rate_ok = (8_000..=96_000).contains(&rate);
    // Checked after the ranges above, so these products are small.
    let frame_ok = channels_ok
        && rate_ok
        && u16_at(32) == channels * 2
        && u32_at(28) == rate * channels as u32 * 2;
    let length_ok =
        u32_at(4) as usize == bytes.len() - 8 && u32_at(40) as usize == bytes.len() - 44;
    if pcm_16 && channels_ok && rate_ok && frame_ok && length_ok {
        Ok(())
    } else {
        Err("only 16-bit PCM WAV is accepted".to_string())
    }
}

enum Source {
    Alias(&'static str),
    File(PathBuf),
}

#[cfg(windows)]
fn play(source: Source) -> Result<(), String> {
    use windows_sys::Win32::Media::Audio::{
        PlaySoundW, SND_ALIAS, SND_ASYNC, SND_FILENAME, SND_NODEFAULT,
    };
    let (name, kind) = match &source {
        Source::Alias(alias) => (alias.to_string(), SND_ALIAS),
        Source::File(path) => (path.to_string_lossy().into_owned(), SND_FILENAME),
    };
    let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    let played = unsafe {
        PlaySoundW(
            wide.as_ptr(),
            std::ptr::null_mut(),
            kind | SND_ASYNC | SND_NODEFAULT,
        )
    };
    if played == 0 {
        return Err(format!("could not play {name}"));
    }
    Ok(())
}

#[cfg(not(windows))]
fn play(_source: Source) -> Result<(), String> {
    Ok(())
}

/// Do Not Disturb (or a Focus rule like a full-screen game) holds notifications back; the sound
/// should wait too.
#[cfg(windows)]
fn do_not_disturb() -> bool {
    use windows::UI::Notifications::{ToastNotificationManager, ToastNotificationMode};
    ToastNotificationManager::GetDefault()
        .and_then(|manager| manager.NotificationMode())
        .is_ok_and(|mode| mode != ToastNotificationMode::Unrestricted)
}

#[cfg(not(windows))]
fn do_not_disturb() -> bool {
    false
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wav(channels: u16, rate: u32, bits: u16, samples: usize) -> Vec<u8> {
        let data = samples * 2;
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"RIFF");
        bytes.extend_from_slice(&(36 + data as u32).to_le_bytes());
        bytes.extend_from_slice(b"WAVEfmt ");
        bytes.extend_from_slice(&16u32.to_le_bytes());
        bytes.extend_from_slice(&1u16.to_le_bytes());
        bytes.extend_from_slice(&channels.to_le_bytes());
        bytes.extend_from_slice(&rate.to_le_bytes());
        bytes.extend_from_slice(&rate.wrapping_mul(channels as u32 * 2).to_le_bytes());
        bytes.extend_from_slice(&(channels * 2).to_le_bytes());
        bytes.extend_from_slice(&bits.to_le_bytes());
        bytes.extend_from_slice(b"data");
        bytes.extend_from_slice(&(data as u32).to_le_bytes());
        bytes.resize(44 + data, 0);
        bytes
    }

    #[test]
    fn accepts_the_wav_the_frontend_writes() {
        assert!(check_wav(&wav(1, 44_100, 16, 100)).is_ok());
    }

    #[test]
    fn refuses_anything_else() {
        assert!(check_wav(b"RIFF").is_err());
        assert!(check_wav(&wav(1, 44_100, 8, 100)).is_err());
        assert!(check_wav(&wav(6, 44_100, 16, 100)).is_err());
        assert!(check_wav(&wav(1, 200_000, 16, 100)).is_err());
        let mut truncated = wav(1, 44_100, 16, 100);
        truncated.truncate(100);
        assert!(check_wav(&truncated).is_err());
        let mut not_wave = wav(1, 44_100, 16, 100);
        not_wave[8..12].copy_from_slice(b"AVI ");
        assert!(check_wav(&not_wave).is_err());
        // Inconsistent sizes that winmm would otherwise have to cope with.
        let broken = |offset: usize, value: &[u8]| {
            let mut bytes = wav(1, 44_100, 16, 100);
            bytes[offset..offset + value.len()].copy_from_slice(value);
            check_wav(&bytes).is_err()
        };
        assert!(broken(4, &u32::MAX.to_le_bytes())); // RIFF size
        assert!(broken(28, &0u32.to_le_bytes())); // byte rate
        assert!(broken(32, &0u16.to_le_bytes())); // block align
        assert!(broken(24, &u32::MAX.to_le_bytes())); // absurd rate: refused, no overflow
        assert!(check_wav(&wav(2, 48_000, 16, 100)).is_ok()); // stereo is fine
    }

    #[test]
    fn every_built_in_sound_is_shipped_as_a_playable_wav() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("sounds");
        for id in BUILT_IN {
            let bytes = std::fs::read(dir.join(format!("{id}.wav"))).expect(id);
            assert!(check_wav(&bytes).is_ok(), "{id}.wav");
        }
    }
}
