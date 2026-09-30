//! Extra provider accounts: a second Claude or Codex login next to the usual one (work and
//! personal). Each has its own login folder in the app data dir, which the CLI and the plugin both
//! find through the CLI's own variable (`CLAUDE_CONFIG_DIR`, `CODEX_HOME`). The plugin then runs as
//! a copy under the account's id, so everything keyed by plugin id (order, tray, strip, alerts, the
//! local API, rate-limit gates, `pluginDataDir`) works per account without knowing about accounts.
//! The usual login (`~/.claude`, `~/.codex`) stays the plain plugin and is never copied: two
//! programs refreshing one rotating refresh token log each other out.

use crate::plugin_engine::manifest::{AccountBinding, LoadedPlugin};
use crate::AppState;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

/// Plugins that can have extra accounts: plugin id, the CLI's home variable, its login command.
const SUPPORTED: [(&str, &str, &str); 2] = [
    ("claude", "CLAUDE_CONFIG_DIR", "claude"),
    ("codex", "CODEX_HOME", "codex login"),
];
/// Variables an account must not inherit from the usual login (a token here would win over the
/// account's own login in the CLI and in the plugin).
const HIDDEN_ENV: [(&str, &str); 1] = [("claude", "CLAUDE_CODE_OAUTH_TOKEN")];
const MAX_ACCOUNTS: usize = 16;
const MAX_LABEL_CHARS: usize = 32;
const LIST_FILE: &str = "accounts.json";
const HOMES_DIR: &str = "accounts";

#[derive(Debug, Clone, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub plugin: String,
    pub label: String,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AccountDto {
    id: String,
    plugin: String,
    label: String,
    /// The login folder, for users who want to use the account in the CLI too.
    home: String,
}

fn supported(plugin: &str) -> Option<(&'static str, &'static str, &'static str)> {
    SUPPORTED.iter().copied().find(|(id, _, _)| *id == plugin)
}

/// `claude-1a2b3c4d`: a supported plugin, a dash and 8 lowercase hex digits. Also a valid plugin id
/// and folder name, with nothing that could climb out of the accounts folder.
fn is_account_id(id: &str) -> bool {
    id.split_once('-').is_some_and(|(plugin, suffix)| {
        supported(plugin).is_some()
            && suffix.len() == 8
            && suffix
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    })
}

fn clean_label(label: &str) -> Result<String, String> {
    let label = label.trim();
    if label.is_empty()
        || label.chars().count() > MAX_LABEL_CHARS
        || label.chars().any(char::is_control)
    {
        return Err("invalid account name".into());
    }
    Ok(label.to_string())
}

fn home(app_data_dir: &Path, id: &str) -> PathBuf {
    app_data_dir.join(HOMES_DIR).join(id)
}

/// Saved accounts; an unreadable file or a broken entry is dropped rather than failing the app.
pub fn load(app_data_dir: &Path) -> Vec<Account> {
    let Ok(text) = std::fs::read_to_string(app_data_dir.join(LIST_FILE)) else {
        return Vec::new();
    };
    let accounts: Vec<Account> = serde_json::from_str(&text).unwrap_or_default();
    let mut seen = HashSet::new();
    accounts
        .into_iter()
        .filter(|account| {
            is_account_id(&account.id)
                && account.id.starts_with(&format!("{}-", account.plugin))
                && clean_label(&account.label).is_ok()
                && seen.insert(account.id.clone())
        })
        .take(MAX_ACCOUNTS)
        .collect()
}

fn save(app_data_dir: &Path, accounts: &[Account]) -> Result<(), String> {
    let path = app_data_dir.join(LIST_FILE);
    let temp = path.with_extension("json.tmp");
    let text = serde_json::to_string_pretty(accounts).map_err(|e| e.to_string())?;
    std::fs::write(&temp, text).map_err(|e| e.to_string())?;
    std::fs::rename(&temp, &path).map_err(|e| e.to_string())
}

/// The base plugins plus one copy per account, each right after its base plugin.
pub fn with_accounts(
    plugins: Vec<LoadedPlugin>,
    accounts: &[Account],
    app_data_dir: &Path,
) -> Vec<LoadedPlugin> {
    let mut out = Vec::new();
    for base in plugins
        .into_iter()
        .filter(|plugin| plugin.account.is_none())
    {
        let copies: Vec<LoadedPlugin> = accounts
            .iter()
            .filter(|account| account.plugin == base.manifest.id)
            .filter_map(|account| copy_for(&base, account, app_data_dir))
            .collect();
        out.push(base);
        out.extend(copies);
    }
    out
}

fn copy_for(base: &LoadedPlugin, account: &Account, app_data_dir: &Path) -> Option<LoadedPlugin> {
    let (_, home_var, _) = supported(&account.plugin)?;
    let mut env = vec![(
        home_var.to_string(),
        Some(
            home(app_data_dir, &account.id)
                .to_string_lossy()
                .into_owned(),
        ),
    )];
    env.extend(
        HIDDEN_ENV
            .iter()
            .filter(|(plugin, _)| *plugin == account.plugin)
            .map(|(_, var)| (var.to_string(), None)),
    );
    let mut copy = base.clone();
    copy.manifest.id = account.id.clone();
    copy.manifest.name = format!("{} · {}", base.manifest.name, account.label);
    copy.account = Some(AccountBinding {
        base_id: base.manifest.id.clone(),
        env,
    });
    Some(copy)
}

fn dto(app_data_dir: &Path, account: &Account) -> AccountDto {
    AccountDto {
        id: account.id.clone(),
        plugin: account.plugin.clone(),
        label: account.label.clone(),
        home: home(app_data_dir, &account.id)
            .to_string_lossy()
            .into_owned(),
    }
}

/// After the list changed: rebuild what gets probed and what the local API knows.
fn apply(state: &mut AppState, accounts: &[Account]) {
    let plugins = std::mem::take(&mut state.plugins);
    state.plugins = with_accounts(plugins, accounts, &state.app_data_dir);
    crate::local_http_api::set_known_plugin_ids(
        state
            .plugins
            .iter()
            .map(|plugin| plugin.manifest.id.clone())
            .collect(),
    );
}

#[tauri::command]
pub fn list_accounts(state: tauri::State<'_, Mutex<AppState>>) -> Result<Vec<AccountDto>, String> {
    let dir = state
        .lock()
        .map_err(|e| e.to_string())?
        .app_data_dir
        .clone();
    Ok(load(&dir)
        .iter()
        .map(|account| dto(&dir, account))
        .collect())
}

#[tauri::command]
pub fn add_account(
    state: tauri::State<'_, Mutex<AppState>>,
    plugin: String,
    label: String,
) -> Result<AccountDto, String> {
    supported(&plugin).ok_or("this provider has no extra accounts")?;
    let label = clean_label(&label)?;
    let mut locked = state.lock().map_err(|e| e.to_string())?;
    let dir = locked.app_data_dir.clone();
    let mut accounts = load(&dir);
    if accounts.len() >= MAX_ACCOUNTS {
        return Err("too many accounts".into());
    }
    let id = loop {
        let candidate = format!(
            "{plugin}-{}",
            &uuid::Uuid::new_v4().simple().to_string()[..8]
        );
        if !accounts.iter().any(|account| account.id == candidate) {
            break candidate;
        }
    };
    std::fs::create_dir_all(home(&dir, &id)).map_err(|e| e.to_string())?;
    let account = Account { id, plugin, label };
    accounts.push(account.clone());
    save(&dir, &accounts)?;
    apply(&mut locked, &accounts);
    log::info!("account {} added", account.id);
    Ok(dto(&dir, &account))
}

/// Forgets the account and deletes its login folder and cached plugin data.
#[tauri::command]
pub fn remove_account(state: tauri::State<'_, Mutex<AppState>>, id: String) -> Result<(), String> {
    if !is_account_id(&id) {
        return Err("unknown account".into());
    }
    let dir = {
        let mut locked = state.lock().map_err(|e| e.to_string())?;
        let dir = locked.app_data_dir.clone();
        let mut accounts = load(&dir);
        let before = accounts.len();
        accounts.retain(|account| account.id != id);
        if accounts.len() == before {
            return Err("unknown account".into());
        }
        save(&dir, &accounts)?;
        apply(&mut locked, &accounts);
        dir
    };
    // `id` passed `is_account_id`, so both paths stay inside the app data dir.
    for path in [home(&dir, &id), dir.join("plugins_data").join(&id)] {
        if path.exists() {
            if let Err(error) = std::fs::remove_dir_all(&path) {
                log::warn!("account {id}: couldn't delete a folder: {error}");
            }
        }
    }
    log::info!("account {id} removed");
    Ok(())
}

/// Opens a terminal that signs the CLI in to this account's folder (`claude`, `codex login`).
#[tauri::command]
pub fn start_account_login(
    state: tauri::State<'_, Mutex<AppState>>,
    id: String,
) -> Result<(), String> {
    let dir = state
        .lock()
        .map_err(|e| e.to_string())?
        .app_data_dir
        .clone();
    let account = load(&dir)
        .into_iter()
        .find(|account| account.id == id)
        .ok_or("unknown account")?;
    let (_, home_var, command) = supported(&account.plugin).ok_or("unknown account")?;
    let home = home(&dir, &account.id);
    std::fs::create_dir_all(&home).map_err(|e| e.to_string())?;
    let hidden: Vec<&str> = HIDDEN_ENV
        .iter()
        .filter(|(plugin, _)| *plugin == account.plugin)
        .map(|(_, var)| *var)
        .collect();
    crate::setup_actions::open_terminal(command, Some((home_var, &home)), &hidden)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::plugin_engine::manifest::PluginManifest;

    fn plugin(id: &str) -> LoadedPlugin {
        LoadedPlugin {
            manifest: PluginManifest {
                schema_version: 1,
                id: id.to_string(),
                name: id.to_uppercase(),
                version: "0.0.0".to_string(),
                entry: "plugin.js".to_string(),
                icon: "icon.svg".to_string(),
                brand_color: None,
                lines: vec![],
                links: vec![],
                status_page_url: None,
            },
            plugin_dir: PathBuf::new(),
            entry_script: String::new(),
            icon_data_url: String::new(),
            account: None,
        }
    }

    fn account(id: &str, label: &str) -> Account {
        Account {
            id: id.into(),
            plugin: id.split('-').next().unwrap().into(),
            label: label.into(),
        }
    }

    #[test]
    fn account_ids_are_strict() {
        assert!(is_account_id("claude-1a2b3c4d"));
        assert!(is_account_id("codex-00000000"));
        assert!(!is_account_id("cursor-1a2b3c4d"));
        assert!(!is_account_id("claude-1A2B3C4D"));
        assert!(!is_account_id("claude-1a2b3c4"));
        assert!(!is_account_id("claude-../../x1"));
        assert!(!is_account_id("claude"));
    }

    #[test]
    fn labels_are_trimmed_and_bounded() {
        assert_eq!(clean_label("  Work ").unwrap(), "Work");
        assert!(clean_label("   ").is_err());
        assert!(clean_label(&"x".repeat(33)).is_err());
        assert!(clean_label("a\nb").is_err());
        assert_eq!(clean_label("İş hesabı").unwrap(), "İş hesabı");
    }

    #[test]
    fn copies_follow_their_base_plugin_with_the_accounts_home() {
        let dir = PathBuf::from("C:/data");
        let accounts = [
            account("codex-00000001", "Team"),
            account("claude-00000002", "Work"),
        ];
        let plugins = with_accounts(
            vec![plugin("claude"), plugin("codex"), plugin("cursor")],
            &accounts,
            &dir,
        );
        let ids: Vec<&str> = plugins.iter().map(|p| p.manifest.id.as_str()).collect();
        assert_eq!(
            ids,
            [
                "claude",
                "claude-00000002",
                "codex",
                "codex-00000001",
                "cursor"
            ]
        );

        let work = &plugins[1];
        assert_eq!(work.manifest.name, "CLAUDE · Work");
        let binding = work.account.as_ref().unwrap();
        assert_eq!(binding.base_id, "claude");
        assert_eq!(
            binding.env,
            vec![
                (
                    "CLAUDE_CONFIG_DIR".to_string(),
                    Some(home(&dir, "claude-00000002").to_string_lossy().into_owned())
                ),
                ("CLAUDE_CODE_OAUTH_TOKEN".to_string(), None),
            ]
        );
        assert_eq!(plugins[3].account.as_ref().unwrap().env[0].0, "CODEX_HOME");

        // Rebuilding from a list that already has copies keeps one copy per account.
        let again = with_accounts(plugins, &accounts[..1], &dir);
        let ids: Vec<&str> = again.iter().map(|p| p.manifest.id.as_str()).collect();
        assert_eq!(ids, ["claude", "codex", "codex-00000001", "cursor"]);
    }

    #[test]
    fn broken_saved_accounts_are_dropped() {
        let dir =
            std::env::temp_dir().join(format!("otu-accounts-{}", uuid::Uuid::new_v4().simple()));
        std::fs::create_dir_all(&dir).unwrap();
        let saved = r#"[
            {"id":"claude-00000001","plugin":"claude","label":"Work"},
            {"id":"claude-00000001","plugin":"claude","label":"Duplicate"},
            {"id":"codex-00000002","plugin":"claude","label":"Wrong plugin"},
            {"id":"../evil","plugin":"claude","label":"x"},
            {"id":"codex-00000003","plugin":"codex","label":""}
        ]"#;
        std::fs::write(dir.join(LIST_FILE), saved).unwrap();
        assert_eq!(load(&dir), vec![account("claude-00000001", "Work")]);
        std::fs::write(dir.join(LIST_FILE), "not json").unwrap();
        assert!(load(&dir).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }
}
