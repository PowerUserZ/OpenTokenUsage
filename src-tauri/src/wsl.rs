//! WSL logins: a provider CLI signed in inside a running WSL distro shows as its own card
//! (`Claude · WSL`) when it is a different account than the ones already shown. Each login runs as
//! a copy of the plugin (`claude-wsl-1a2b3c4d`) whose `~` is the Linux home, read in place through
//! `\\wsl.localhost` (nothing is copied, so the CLI in WSL stays signed in), with no Windows
//! environment. A distro is never started: only running ones are read, and a stopped distro's
//! cards show their last data.

use crate::plugin_engine::manifest::{AccountBinding, LoadedPlugin};
use crate::AppState;
use sha2::{Digest, Sha256};
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

/// Where Windows shows each distro's files.
pub const SHARE: &str = r"\\wsl.localhost";
const LIST_FILE: &str = "wsl-accounts.json";

/// A WSL login shown as a card. `id` is `copy_id` of the other three.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WslAccount {
    pub id: String,
    pub plugin: String,
    pub distro: String,
    pub user: String,
}

impl WslAccount {
    pub fn new(plugin: &str, distro: &str, user: &str) -> Self {
        Self {
            id: copy_id(plugin, distro, user),
            plugin: plugin.to_string(),
            distro: distro.to_string(),
            user: user.to_string(),
        }
    }
}

/// A distro name as `wsl.exe` lists it; anything that could leave the share is refused.
pub fn is_distro_name(name: &str) -> bool {
    !name.is_empty()
        && name.len() <= 64
        && !name.contains("..")
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// A Linux user name the way `useradd` makes them.
pub fn is_user_name(name: &str) -> bool {
    let mut chars = name.chars();
    name.len() <= 32
        && matches!(chars.next(), Some(c) if c.is_ascii_lowercase() || c == '_')
        && chars.all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '_' || c == '-')
}

/// `wsl.exe --list --quiet` output: UTF-16LE (with or without a BOM), or UTF-8 with `WSL_UTF8=1`.
pub fn parse_distro_list(bytes: &[u8]) -> Vec<String> {
    let text = if bytes.contains(&0) {
        let units: Vec<u16> = bytes
            .chunks_exact(2)
            .map(|pair| u16::from_le_bytes([pair[0], pair[1]]))
            .collect();
        String::from_utf16_lossy(&units)
    } else {
        String::from_utf8_lossy(bytes).into_owned()
    };
    text.lines()
        .map(|line| {
            line.trim_matches(|c: char| c.is_whitespace() || c == '\u{feff}')
                .to_string()
        })
        .filter(|name| is_distro_name(name))
        .collect()
}

/// `<plugin>-wsl-<8 hex>`: stable for one distro and user, so the card keeps its place and settings.
pub fn copy_id(plugin: &str, distro: &str, user: &str) -> String {
    let digest = Sha256::digest(format!("{distro}/{user}").as_bytes());
    let hex: String = digest[..4]
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    format!("{plugin}-wsl-{hex}")
}

pub fn is_wsl_id(id: &str) -> bool {
    id.rsplit_once("-wsl-").is_some_and(|(plugin, hex)| {
        !plugin.is_empty()
            && hex.len() == 8
            && hex
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}

pub fn home_path(share: &Path, distro: &str, user: &str) -> PathBuf {
    share.join(distro).join("home").join(user)
}

/// The plugin's login files (`plugin.json` → `wsl.login`) relative to the home; anything not under
/// `~/` or climbing out of it is ignored.
pub fn login_files(plugin: &LoadedPlugin) -> Vec<String> {
    let Some(wsl) = plugin.manifest.wsl.as_ref() else {
        return Vec::new();
    };
    wsl.login
        .iter()
        .filter_map(|path| path.strip_prefix("~/"))
        .filter(|rest| {
            rest.split('/')
                .all(|part| !part.is_empty() && part != "." && part != "..")
        })
        .map(str::to_string)
        .collect()
}

/// `Claude · WSL`; when one plugin has several WSL cards the user tells them apart, or the distro
/// when it is the same user in more than one distro.
pub fn card_name(base_name: &str, account: &WslAccount, all: &[WslAccount]) -> String {
    let siblings: Vec<&WslAccount> = all
        .iter()
        .filter(|other| other.plugin == account.plugin)
        .collect();
    if siblings.len() <= 1 {
        return format!("{base_name} · WSL");
    }
    let same_user = siblings
        .iter()
        .filter(|other| other.user == account.user)
        .count();
    let tag = if same_user == 1 {
        &account.user
    } else {
        &account.distro
    };
    format!("{base_name} · WSL {tag}")
}

fn copy_for(
    base: &LoadedPlugin,
    account: &WslAccount,
    home: PathBuf,
    name: String,
) -> LoadedPlugin {
    let mut copy = base.clone();
    copy.manifest.id = account.id.clone();
    copy.manifest.name = name;
    copy.account = Some(AccountBinding {
        base_id: base.manifest.id.clone(),
        home: Some(home),
        isolated_env: true,
        ..Default::default()
    });
    copy
}

/// The plugin list with its WSL copies replaced by `accounts`, each right after its base plugin.
pub fn with_wsl(
    plugins: Vec<LoadedPlugin>,
    accounts: &[WslAccount],
    share: &Path,
) -> Vec<LoadedPlugin> {
    let mut out = Vec::new();
    for plugin in plugins
        .into_iter()
        .filter(|plugin| !is_wsl_id(&plugin.manifest.id))
    {
        let copies: Vec<LoadedPlugin> = if plugin.account.is_none() {
            accounts
                .iter()
                .filter(|account| account.plugin == plugin.manifest.id)
                .map(|account| {
                    copy_for(
                        &plugin,
                        account,
                        home_path(share, &account.distro, &account.user),
                        card_name(&plugin.manifest.name, account, accounts),
                    )
                })
                .collect()
        } else {
            Vec::new()
        };
        out.push(plugin);
        out.extend(copies);
    }
    out
}

/// Linux users with a home folder in `distro`.
fn linux_users(share: &Path, distro: &str) -> Vec<String> {
    let Ok(entries) = std::fs::read_dir(share.join(distro).join("home")) else {
        return Vec::new();
    };
    let mut users: Vec<String> = entries
        .flatten()
        .filter_map(|entry| entry.file_name().into_string().ok())
        .filter(|name| is_user_name(name))
        .collect();
    users.sort();
    users
}

/// What a scan saw in the running distros.
#[derive(Debug, Default, PartialEq)]
pub struct Scan {
    /// Logins worth a card.
    pub shown: Vec<WslAccount>,
    /// Logins whose login file exists but whose account key couldn't be read (no usable login, or a
    /// slow share / timeout): never a new card, but not proof that a shown card signed out either.
    pub no_key: Vec<WslAccount>,
}

/// The logins in `running` distros worth a card. The copy must have an account key (a usable login:
/// a login file alone can be shared, like opencode's auth.json that Synthetic also reads), and the
/// key must match no Windows instance of the plugin (the usual login, extra accounts) and no copy
/// accepted before it (one account in two distros is one card).
pub fn scan(
    plugins: &[LoadedPlugin],
    running: &[String],
    share: &Path,
    account_key: &dyn Fn(&LoadedPlugin) -> Option<String>,
) -> Scan {
    let homes: Vec<(String, String)> = running
        .iter()
        .filter(|distro| !distro.starts_with("docker-desktop"))
        .flat_map(|distro| {
            linux_users(share, distro)
                .into_iter()
                .map(move |user| (distro.clone(), user))
        })
        .collect();
    let mut result = Scan::default();
    for base in plugins.iter().filter(|plugin| plugin.account.is_none()) {
        let files = login_files(base);
        let candidates: Vec<&(String, String)> = homes
            .iter()
            .filter(|(distro, user)| {
                let home = home_path(share, distro, user);
                files.iter().any(|file| home.join(file).exists())
            })
            .collect();
        if candidates.is_empty() {
            continue;
        }
        let mut seen: HashSet<String> = plugins
            .iter()
            .filter(|plugin| match &plugin.account {
                None => plugin.manifest.id == base.manifest.id,
                Some(binding) => binding.base_id == base.manifest.id && binding.home.is_none(),
            })
            .filter_map(|plugin| account_key(plugin))
            .collect();
        for (distro, user) in candidates {
            let account = WslAccount::new(&base.manifest.id, distro, user);
            let copy = copy_for(
                base,
                &account,
                home_path(share, distro, user),
                String::new(),
            );
            match account_key(&copy) {
                Some(key) if !seen.contains(&key) => {
                    seen.insert(key);
                    result.shown.push(account);
                }
                Some(_) => log::info!(
                    "wsl: {} in {distro} is an account already shown",
                    base.manifest.id
                ),
                None => {
                    log::info!("wsl: {} in {distro} has no usable login", base.manifest.id);
                    result.no_key.push(account);
                }
            }
        }
    }
    result
}

/// The cards after a scan. A card stays while its distro is stopped (it shows its last data) and
/// while its login file is there but the key couldn't be read (a slow share must not delete it); it
/// goes when its distro runs without that login (signed out, or now an account already shown) or no
/// longer exists. `registered` is `None` when Windows couldn't say which distros exist.
pub fn reconcile(
    found: &Scan,
    known: &[WslAccount],
    running: &HashSet<String>,
    registered: Option<&HashSet<String>>,
) -> Vec<WslAccount> {
    let mut next: Vec<WslAccount> = known
        .iter()
        .filter(|account| {
            let unread = running.contains(&account.distro) && found.no_key.contains(account);
            (unread || !running.contains(&account.distro))
                && registered.is_none_or(|names| names.contains(&account.distro))
        })
        .cloned()
        .collect();
    for account in &found.shown {
        if !next.contains(account) {
            next.push(account.clone());
        }
    }
    next.sort_by(|a, b| a.id.cmp(&b.id));
    next
}

/// Cards that have shown data once. An unreadable file or a broken entry is dropped; the plugin id
/// check keeps `plugins_data/<id>` (deleted when a card goes) inside the app data folder.
pub fn load(app_data_dir: &Path) -> Vec<WslAccount> {
    let Ok(text) = std::fs::read_to_string(app_data_dir.join(LIST_FILE)) else {
        return Vec::new();
    };
    let accounts: Vec<WslAccount> = serde_json::from_str(&text).unwrap_or_default();
    accounts
        .into_iter()
        .filter(|account| {
            !account.plugin.is_empty()
                && account
                    .plugin
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
                && is_distro_name(&account.distro)
                && is_user_name(&account.user)
                && account.id == copy_id(&account.plugin, &account.distro, &account.user)
        })
        .collect()
}

pub fn save(app_data_dir: &Path, accounts: &[WslAccount]) -> Result<(), String> {
    let path = app_data_dir.join(LIST_FILE);
    let temp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(accounts).map_err(|e| e.to_string())?;
    std::fs::write(&temp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&temp, &path).map_err(|e| e.to_string())
}

/// What `wsl.exe` may take: a stuck WSL service must not stall a refresh.
const WSL_TIMEOUT: Duration = Duration::from_secs(5);
const SCAN_INTERVAL: Duration = Duration::from_secs(30);
/// A WSL card whose distro is stopped and that has no cached data yet (`plugin-errors.ts`: `wslNotRunning`).
pub const NOT_RUNNING: &str = "WSL isn't running. Start it to update this card.";

/// The WSL cards in the plugin list, and which distros ran at the last check.
#[derive(Debug, Default)]
pub struct WslState {
    pub accounts: Vec<WslAccount>,
    pub running: HashSet<String>,
    pub last_scan: Option<Instant>,
}

/// What a scan changed, for the UI (`plugins:changed`).
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginsChange {
    pub added: Vec<AddedPlugin>,
    pub removed: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AddedPlugin {
    pub id: String,
    pub plugin: String,
}

impl PluginsChange {
    fn between(before: &[WslAccount], after: &[WslAccount]) -> Self {
        Self {
            added: after
                .iter()
                .filter(|account| !before.contains(account))
                .map(|account| AddedPlugin {
                    id: account.id.clone(),
                    plugin: account.plugin.clone(),
                })
                .collect(),
            removed: before
                .iter()
                .filter(|account| !after.contains(account))
                .map(|account| account.id.clone())
                .collect(),
        }
    }
}

/// Distros running right now; never starts one. Any failure counts as "none running", so no WSL
/// card gets probed.
#[cfg(windows)]
pub fn running_distros() -> Vec<String> {
    let mut command = crate::plugin_engine::host_api::silent_command("wsl.exe");
    command
        .args(["--list", "--running", "--quiet"])
        .env("WSL_UTF8", "1");
    match crate::plugin_engine::host_api::output_with_timeout(&mut command, WSL_TIMEOUT) {
        Ok(output) if output.status.success() => parse_distro_list(&output.stdout),
        Ok(_) => Vec::new(), // wsl.exe exits non-zero when no distro runs
        Err(error) => {
            log::info!("wsl: listing running distros failed: {error}");
            Vec::new()
        }
    }
}

#[cfg(not(windows))]
pub fn running_distros() -> Vec<String> {
    Vec::new()
}

/// Distros Windows has; `None` when that can't be read (then no card is dropped for it).
#[cfg(windows)]
pub fn registered_distros() -> Option<HashSet<String>> {
    use winreg::{enums::HKEY_CURRENT_USER, RegKey};
    match RegKey::predef(HKEY_CURRENT_USER)
        .open_subkey(r"Software\Microsoft\Windows\CurrentVersion\Lxss")
    {
        Ok(lxss) => Some(
            lxss.enum_keys()
                .flatten()
                .filter_map(|guid| {
                    lxss.open_subkey(&guid)
                        .ok()?
                        .get_value::<String, _>("DistributionName")
                        .ok()
                })
                .collect(),
        ),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Some(HashSet::new()),
        Err(_) => None,
    }
}

#[cfg(not(windows))]
pub fn registered_distros() -> Option<HashSet<String>> {
    None
}

/// Rescan (at most every `SCAN_INTERVAL`) and apply the result to the plugin list; returns what
/// changed. A card that goes is forgotten with its plugin data.
pub fn refresh(state: &Mutex<AppState>) -> Option<PluginsChange> {
    let (plugins, dir, version, known) = {
        let mut locked = state.lock().ok()?;
        if locked
            .wsl
            .last_scan
            .is_some_and(|at| at.elapsed() < SCAN_INTERVAL)
        {
            return None;
        }
        locked.wsl.last_scan = Some(Instant::now());
        (
            locked.plugins.clone(),
            locked.app_data_dir.clone(),
            locked.app_version.clone(),
            locked.wsl.accounts.clone(),
        )
    };
    let running = running_distros();
    let found = scan(
        &plugins,
        &running,
        Path::new(SHARE),
        &|plugin: &LoadedPlugin| {
            crate::plugin_engine::runtime::run_account_key(plugin, &dir, &version)
        },
    );
    let running: HashSet<String> = running.into_iter().collect();
    let next = reconcile(&found, &known, &running, registered_distros().as_ref());

    let mut locked = state.lock().ok()?;
    locked.wsl.running = running;
    if next == locked.wsl.accounts {
        return None;
    }
    let change = PluginsChange::between(&locked.wsl.accounts, &next);
    let plugins = std::mem::take(&mut locked.plugins);
    locked.plugins = with_wsl(plugins, &next, Path::new(SHARE));
    locked.wsl.accounts = next.clone();
    crate::local_http_api::set_known_plugin_ids(
        locked
            .plugins
            .iter()
            .map(|plugin| plugin.manifest.id.clone())
            .collect(),
    );
    drop(locked);
    forget(&dir, &change.removed, &next);
    log::info!(
        "wsl: {} card(s) added, {} removed",
        change.added.len(),
        change.removed.len()
    );
    Some(change)
}

/// Drop removed cards from the saved list and delete their plugin data.
fn forget(dir: &Path, removed: &[String], next: &[WslAccount]) {
    if removed.is_empty() {
        return;
    }
    let saved = load(dir);
    let kept: Vec<WslAccount> = saved
        .iter()
        .filter(|account| next.contains(account))
        .cloned()
        .collect();
    if kept.len() != saved.len() {
        if let Err(error) = save(dir, &kept) {
            log::warn!("wsl: couldn't save the card list: {error}");
        }
    }
    for id in removed {
        // Every id here passed `copy_id` (from `scan` or `load`), so this stays in the app data dir.
        let data = dir.join("plugins_data").join(id);
        if data.exists() {
            if let Err(error) = std::fs::remove_dir_all(&data) {
                log::warn!("wsl: couldn't delete {id}'s plugin data: {error}");
            }
        }
    }
}

/// `refresh` off the async runtime (it can wait on `wsl.exe`); a change reaches the UI as `plugins:changed`.
pub fn refresh_in_background(app: tauri::AppHandle) {
    tauri::async_runtime::spawn_blocking(move || {
        let state = tauri::Manager::state::<Mutex<AppState>>(&app);
        if let Some(change) = refresh(&state) {
            let _ = tauri::Emitter::emit(&app, "plugins:changed", change);
        }
    });
}

/// Before a batch: which distros run now, so a distro stopped since the last scan isn't woken by a
/// probe reading its files. Asked only when the list has WSL cards.
pub fn update_running(state: &Mutex<AppState>) {
    let has_cards = state
        .lock()
        .map(|locked| !locked.wsl.accounts.is_empty())
        .unwrap_or(false);
    if !has_cards {
        return;
    }
    let running: HashSet<String> = running_distros().into_iter().collect();
    if let Ok(mut locked) = state.lock() {
        locked.wsl.running = running;
    }
}

/// A WSL card whose distro isn't running: shown from its cache instead of probed.
pub fn is_stopped(state: &Mutex<AppState>, plugin_id: &str) -> bool {
    if !is_wsl_id(plugin_id) {
        return false;
    }
    state
        .lock()
        .map(|locked| {
            locked
                .wsl
                .accounts
                .iter()
                .find(|account| account.id == plugin_id)
                .is_none_or(|account| !locked.wsl.running.contains(&account.distro))
        })
        .unwrap_or(true)
}

/// A stopped WSL card's last good data, marked with when it was fetched; without it, `NOT_RUNNING`.
pub fn stale_output(
    plugin: &LoadedPlugin,
    snapshot: Option<crate::local_http_api::CachedPluginSnapshot>,
) -> crate::plugin_engine::runtime::PluginOutput {
    let fetched_ms = snapshot.as_ref().and_then(|snapshot| {
        time::OffsetDateTime::parse(
            &snapshot.fetched_at,
            &time::format_description::well_known::Rfc3339,
        )
        .ok()
        .map(|at| (at.unix_timestamp_nanos() / 1_000_000) as i64)
    });
    match (snapshot, fetched_ms) {
        (Some(snapshot), Some(ms)) => crate::plugin_engine::runtime::PluginOutput {
            provider_id: plugin.manifest.id.clone(),
            display_name: plugin.manifest.name.clone(),
            plan: snapshot.plan,
            lines: snapshot.lines,
            icon_url: plugin.icon_data_url.clone(),
            stale_since: Some(ms),
        },
        _ => crate::plugin_engine::runtime::error_output(plugin, NOT_RUNNING.to_string()),
    }
}

/// A WSL card's first good probe: from now on it stays listed while its distro is stopped.
pub fn confirm(state: &Mutex<AppState>, plugin_id: &str) {
    if !is_wsl_id(plugin_id) {
        return;
    }
    let Some((dir, account)) = state.lock().ok().and_then(|locked| {
        let account = locked
            .wsl
            .accounts
            .iter()
            .find(|account| account.id == plugin_id)?
            .clone();
        Some((locked.app_data_dir.clone(), account))
    }) else {
        return;
    };
    let mut saved = load(&dir);
    if saved.contains(&account) {
        return;
    }
    saved.push(account);
    if let Err(error) = save(&dir, &saved) {
        log::warn!("wsl: couldn't save {plugin_id}: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_engine::manifest::{PluginManifest, WslManifest};

    fn plugin(id: &str, login: &[&str]) -> LoadedPlugin {
        LoadedPlugin {
            manifest: PluginManifest {
                schema_version: 1,
                id: id.to_string(),
                name: id.to_uppercase(),
                version: "1".to_string(),
                entry: "plugin.js".to_string(),
                icon: "icon.svg".to_string(),
                brand_color: None,
                lines: vec![],
                links: vec![],
                status_page_url: None,
                wsl: (!login.is_empty()).then(|| WslManifest {
                    login: login.iter().map(|path| path.to_string()).collect(),
                }),
            },
            plugin_dir: PathBuf::from("."),
            entry_script: String::new(),
            icon_data_url: String::new(),
            account: None,
        }
    }

    fn temp_share(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("otu-wsl-{label}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("share");
        dir
    }

    fn login(share: &Path, distro: &str, user: &str, file: &str) {
        let path = home_path(share, distro, user).join(file);
        std::fs::create_dir_all(path.parent().expect("parent")).expect("dirs");
        std::fs::write(path, "{}").expect("login");
    }

    /// Windows instances (no home) are signed in as "win"; a WSL copy as `by_user` says for its user.
    fn keys<'a>(
        by_user: &'a [(&'a str, Option<&'a str>)],
    ) -> impl Fn(&LoadedPlugin) -> Option<String> + 'a {
        move |plugin: &LoadedPlugin| match plugin
            .account
            .as_ref()
            .and_then(|binding| binding.home.as_ref())
        {
            None => Some("win".to_string()),
            Some(home) => by_user
                .iter()
                .find(|(user, _)| home.ends_with(user))
                .and_then(|(_, key)| key.map(str::to_string)),
        }
    }

    #[test]
    fn distro_list_is_read_from_utf16_and_utf8() {
        let utf16: Vec<u8> = "\u{feff}Ubuntu-26.04\r\ndocker-desktop\r\n\r\n"
            .encode_utf16()
            .flat_map(|unit| unit.to_le_bytes())
            .collect();
        assert_eq!(
            parse_distro_list(&utf16),
            vec!["Ubuntu-26.04", "docker-desktop"]
        );
        assert_eq!(parse_distro_list(b"Debian\n"), vec!["Debian"]);
        assert!(parse_distro_list(b"..\\x\ntwo words\n").is_empty());
        assert!(parse_distro_list(b"").is_empty());
    }

    #[test]
    fn odd_names_are_refused() {
        let long = "a".repeat(33);
        for good in ["sailwing", "public_html", "_svc", "a-b1"] {
            assert!(is_user_name(good), "{good}");
        }
        for bad in ["", "Root", "a/b", "..", "a b", "1abc", long.as_str()] {
            assert!(!is_user_name(bad), "{bad}");
        }
        for good in ["Ubuntu-26.04", "kali-linux", "Debian"] {
            assert!(is_distro_name(good), "{good}");
        }
        for bad in ["", "..", "a/b", r"a\b", "a:b", "two words"] {
            assert!(!is_distro_name(bad), "{bad}");
        }
    }

    #[test]
    fn copy_ids_are_stable_and_recognised() {
        let id = copy_id("claude", "Ubuntu-26.04", "sailwing");
        assert_eq!(id, copy_id("claude", "Ubuntu-26.04", "sailwing"));
        assert!(id.starts_with("claude-wsl-") && id.len() == "claude-wsl-".len() + 8);
        assert!(is_wsl_id(&id) && is_wsl_id(&copy_id("opencode-go", "Debian", "a")));
        assert_ne!(id, copy_id("claude", "Ubuntu-26.04", "other"));
        for not_wsl in [
            "claude",
            "claude-1a2b3c4d",
            "claude-wsl-xyz",
            "-wsl-1a2b3c4d",
        ] {
            assert!(!is_wsl_id(not_wsl), "{not_wsl}");
        }
    }

    #[test]
    fn login_files_stay_inside_the_home() {
        let p = plugin(
            "x",
            &["~/.x/auth.json", "/etc/passwd", "~/../y", "~/a//b", "~/"],
        );
        assert_eq!(login_files(&p), vec![".x/auth.json"]);
    }

    #[test]
    fn cards_are_named_wsl_and_told_apart_when_needed() {
        let alice = WslAccount::new("claude", "Ubuntu", "alice");
        assert_eq!(
            card_name("Claude", &alice, &[alice.clone()]),
            "Claude · WSL"
        );
        let bob = WslAccount::new("claude", "Ubuntu", "bob");
        let alice_debian = WslAccount::new("claude", "Debian", "alice");
        let all = [
            alice.clone(),
            bob.clone(),
            alice_debian.clone(),
            WslAccount::new("codex", "Ubuntu", "alice"),
        ];
        assert_eq!(card_name("Claude", &bob, &all), "Claude · WSL bob");
        assert_eq!(card_name("Claude", &alice, &all), "Claude · WSL Ubuntu");
        assert_eq!(
            card_name("Claude", &alice_debian, &all),
            "Claude · WSL Debian"
        );
    }

    #[test]
    fn copies_follow_their_base_with_the_linux_home_and_no_environment() {
        let share = Path::new(SHARE);
        let alice = WslAccount::new("claude", "Ubuntu", "alice");
        let list = with_wsl(
            vec![
                plugin("claude", &["~/.claude/.credentials.json"]),
                plugin("codex", &[]),
            ],
            &[alice.clone()],
            share,
        );
        let ids: Vec<&str> = list.iter().map(|p| p.manifest.id.as_str()).collect();
        assert_eq!(ids, vec!["claude", alice.id.as_str(), "codex"]);
        let binding = list[1].account.as_ref().expect("binding");
        assert_eq!(binding.base_id, "claude");
        assert!(binding.isolated_env && binding.env.is_empty());
        assert_eq!(
            binding.home.as_ref().expect("home").to_string_lossy(),
            r"\\wsl.localhost\Ubuntu\home\alice"
        );
        assert_eq!(list[1].manifest.name, "CLAUDE · WSL");
        assert_eq!(
            with_wsl(list, &[], share).len(),
            2,
            "rebuilding replaces the copies"
        );
    }

    #[test]
    fn scan_shows_a_different_account_and_hides_the_same_one() {
        let share = temp_share("scan");
        login(&share, "Ubuntu", "alice", ".claude/.credentials.json");
        login(&share, "Ubuntu", "bob", ".claude/.credentials.json");
        std::fs::create_dir_all(home_path(&share, "Ubuntu", "carol")).expect("no login");
        let plugins = vec![plugin("claude", &["~/.claude/.credentials.json"])];
        let key = keys(&[("alice", Some("other")), ("bob", Some("win"))]);
        let found = scan(&plugins, &["Ubuntu".to_string()], &share, &key);
        assert_eq!(found.shown, vec![WslAccount::new("claude", "Ubuntu", "alice")]);
    }

    #[test]
    fn scan_skips_logins_without_a_key_and_distros_not_running_or_docker() {
        let share = temp_share("scan-skip");
        login(&share, "Ubuntu", "alice", ".claude/.credentials.json");
        login(&share, "Stopped", "dave", ".claude/.credentials.json");
        login(
            &share,
            "docker-desktop",
            "erin",
            ".claude/.credentials.json",
        );
        let plugins = vec![plugin("claude", &["~/.claude/.credentials.json"])];
        let key = keys(&[("alice", None), ("dave", Some("d")), ("erin", Some("e"))]);
        let running = ["Ubuntu".to_string(), "docker-desktop".to_string()];
        let found = scan(&plugins, &running, &share, &key);
        assert!(found.shown.is_empty());
        assert_eq!(found.no_key, vec![WslAccount::new("claude", "Ubuntu", "alice")]);
    }

    #[test]
    fn scan_shows_one_card_for_one_account_in_two_distros() {
        let share = temp_share("scan-two");
        login(&share, "Ubuntu", "alice", ".codex/auth.json");
        login(&share, "Debian", "alice", ".codex/auth.json");
        let plugins = vec![plugin("codex", &["~/.codex/auth.json"])];
        let key = keys(&[("alice", Some("same"))]);
        let running = ["Debian".to_string(), "Ubuntu".to_string()];
        assert_eq!(scan(&plugins, &running, &share, &key).shown.len(), 1);
    }

    #[test]
    fn scan_hides_a_login_matching_an_extra_account() {
        let share = temp_share("scan-extra");
        login(&share, "Ubuntu", "alice", ".claude/.credentials.json");
        let base = plugin("claude", &["~/.claude/.credentials.json"]);
        let mut extra = base.clone();
        extra.manifest.id = "claude-1a2b3c4d".to_string();
        extra.account = Some(AccountBinding {
            base_id: "claude".to_string(),
            env: vec![("CLAUDE_CONFIG_DIR".to_string(), Some("x".to_string()))],
            ..Default::default()
        });
        let key = |plugin: &LoadedPlugin| -> Option<String> {
            match plugin.account.as_ref() {
                None => Some("personal".to_string()),
                Some(_) => Some("work".to_string()), // the extra account and the WSL login
            }
        };
        assert!(scan(&[base, extra], &["Ubuntu".to_string()], &share, &key).shown.is_empty());
    }

    #[test]
    fn scan_skips_odd_user_folders() {
        let share = temp_share("scan-odd");
        login(&share, "Ubuntu", "Bad User", ".claude/.credentials.json");
        let plugins = vec![plugin("claude", &["~/.claude/.credentials.json"])];
        let key = keys(&[("Bad User", Some("x"))]);
        assert_eq!(scan(&plugins, &["Ubuntu".to_string()], &share, &key), Scan::default());
    }

    #[test]
    fn stopped_distros_keep_their_cards_and_running_ones_follow_the_scan() {
        let kept = WslAccount::new("claude", "Stopped", "alice");
        let signed_out = WslAccount::new("claude", "Ubuntu", "bob");
        let deleted = WslAccount::new("codex", "Deleted", "carl");
        let new = WslAccount::new("codex", "Ubuntu", "bob");
        let running: HashSet<String> = ["Ubuntu".to_string()].into();
        let registered: HashSet<String> = ["Ubuntu".to_string(), "Stopped".to_string()].into();
        let next = reconcile(
            &Scan {
                shown: vec![new.clone()],
                no_key: vec![],
            },
            &[kept.clone(), signed_out, deleted.clone()],
            &running,
            Some(&registered),
        );
        let mut want = vec![kept, new];
        want.sort_by(|a, b| a.id.cmp(&b.id));
        assert_eq!(next, want);
        assert!(
            reconcile(&Scan::default(), &[deleted.clone()], &HashSet::new(), None).contains(&deleted),
            "an unreadable registry deletes nothing"
        );
    }

    #[test]
    fn saved_cards_round_trip_and_broken_entries_are_dropped() {
        let dir = temp_share("saved");
        let good = WslAccount::new("claude", "Ubuntu", "alice");
        save(&dir, &[good.clone()]).expect("save");
        assert_eq!(load(&dir), vec![good.clone()]);
        let forged = WslAccount {
            id: "claude-wsl-00000000".to_string(),
            ..good.clone()
        };
        let climbing = WslAccount::new("../x", "Ubuntu", "alice");
        save(&dir, &[forged, climbing, good.clone()]).expect("save");
        assert_eq!(load(&dir), vec![good]);
        std::fs::write(dir.join(LIST_FILE), "not json").expect("write");
        assert!(load(&dir).is_empty());
    }

    #[test]
    fn a_shown_card_survives_a_scan_that_couldnt_read_its_key() {
        let alice = WslAccount::new("claude", "Ubuntu", "alice");
        let running: HashSet<String> = ["Ubuntu".to_string()].into();
        let slow = Scan {
            shown: vec![],
            no_key: vec![alice.clone()],
        };
        assert_eq!(
            reconcile(&slow, &[alice.clone()], &running, None),
            vec![alice.clone()],
            "a timeout or a parse hiccup must not delete a card that showed data"
        );
        assert!(
            reconcile(&slow, &[], &running, None).is_empty(),
            "a new login without a key is still not shown"
        );
    }

    #[test]
    fn changes_list_added_and_removed_cards() {
        let a = WslAccount::new("claude", "Ubuntu", "alice");
        let b = WslAccount::new("codex", "Ubuntu", "alice");
        let change = PluginsChange::between(&[a.clone()], &[b.clone()]);
        assert_eq!(
            change.added,
            vec![AddedPlugin {
                id: b.id.clone(),
                plugin: "codex".to_string()
            }]
        );
        assert_eq!(change.removed, vec![a.id.clone()]);
        assert_eq!(
            serde_json::to_value(&change).unwrap()["added"][0]["plugin"],
            "codex"
        );
    }

    #[test]
    fn a_stopped_card_shows_its_cached_data_with_the_fetch_time() {
        let p = plugin("claude", &[]);
        let snapshot = crate::local_http_api::CachedPluginSnapshot {
            provider_id: "claude".to_string(),
            display_name: "Claude".to_string(),
            plan: Some("Max".to_string()),
            lines: vec![],
            fetched_at: "2026-10-02T10:00:00Z".to_string(),
        };
        let out = stale_output(&p, Some(snapshot));
        assert_eq!(out.plan.as_deref(), Some("Max"));
        assert_eq!(out.stale_since, Some(1_790_935_200_000));
        let none = stale_output(&p, None);
        assert!(matches!(
            &none.lines[0],
            crate::plugin_engine::runtime::MetricLine::Badge { text, .. } if text == NOT_RUNNING
        ));
    }

    #[test]
    fn only_cards_of_running_distros_are_probed() {
        let a = WslAccount::new("claude", "Ubuntu", "alice");
        let state = std::sync::Mutex::new(crate::AppState {
            plugins: vec![],
            app_data_dir: std::env::temp_dir(),
            app_version: "0".to_string(),
            wsl: WslState {
                accounts: vec![a.clone()],
                ..Default::default()
            },
        });
        assert!(is_stopped(&state, &a.id));
        state
            .lock()
            .unwrap()
            .wsl
            .running
            .insert("Ubuntu".to_string());
        assert!(!is_stopped(&state, &a.id));
        assert!(!is_stopped(&state, "claude"), "not a WSL card");
    }
}
