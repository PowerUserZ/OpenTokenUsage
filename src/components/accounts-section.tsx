import { useEffect, useState } from "react"
import { invoke } from "@tauri-apps/api/core"
import { Copy, LogIn, Trash2 } from "lucide-react"
import { SettingsSection } from "@/components/settings-section"
import { Button } from "@/components/ui/button"
import { ACCOUNT_PLUGINS, type AccountPlugin, type AccountsChange, type ProviderAccount } from "@/lib/accounts"
import { t } from "@/lib/i18n"
import { useAppPluginStore } from "@/stores/app-plugin-store"

/** Longest name `accounts.rs` accepts. */
const MAX_LABEL = 32

/**
 * Extra Claude/Codex accounts (work and personal). Adding one opens a terminal that signs the CLI in
 * to the account's own folder; the usual login is never touched.
 */
export function AccountsSection({ onAccountsChanged }: { onAccountsChanged: (change: AccountsChange) => void }) {
  const pluginsMeta = useAppPluginStore((state) => state.pluginsMeta)
  const [accounts, setAccounts] = useState<ProviderAccount[]>([])
  const [plugin, setPlugin] = useState<AccountPlugin>("claude")
  const [label, setLabel] = useState("")
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null)

  const nameOf = (id: string) => pluginsMeta.find((meta) => meta.id === id)?.name ?? id
  const reload = () =>
    invoke<ProviderAccount[]>("list_accounts")
      .then((list) => setAccounts(Array.isArray(list) ? list : []))
      .catch((error) => console.error("Failed to list accounts:", error))

  useEffect(() => {
    void reload()
  }, [])

  const signIn = (id: string) => invoke("start_account_login", { id }).catch((error) => console.error("Account sign-in failed:", error))

  const add = async () => {
    setBusy(true)
    setFailed(false)
    try {
      const account = await invoke<ProviderAccount>("add_account", { plugin, label: label.trim() })
      setLabel("")
      await reload()
      onAccountsChanged({ added: { id: account.id, plugin: account.plugin } })
      await signIn(account.id)
    } catch (error) {
      console.error("Failed to add account:", error)
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    if (confirmRemove !== id) return setConfirmRemove(id)
    setConfirmRemove(null)
    try {
      await invoke("remove_account", { id })
      await reload()
      onAccountsChanged({ removedId: id })
    } catch (error) {
      console.error("Failed to remove account:", error)
    }
  }

  return (
    <SettingsSection title={t("settings.accounts.title")} description={t("settings.accounts.desc")}>
      {accounts.length > 0 && (
        <div className="mb-3 space-y-1">
          {accounts.map((account) => (
            <div key={account.id} className="flex items-center gap-1.5 h-8 px-2 rounded-md hover:bg-accent">
              <span className="flex-1 truncate text-[13px]">{nameOf(account.id)}</span>
              <Button variant="ghost" size="xs" className="text-[11px]" onClick={() => void signIn(account.id)} title={t("settings.accounts.signIn")}>
                <LogIn className="size-3" />
                {t("settings.accounts.signIn")}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                aria-label={t("settings.accounts.copyPath")}
                title={t("settings.accounts.copyPath")}
                onClick={() => navigator.clipboard.writeText(account.home).catch(() => {})}
              >
                <Copy className="size-3" />
              </Button>
              <Button
                variant={confirmRemove === account.id ? "destructive" : "ghost"}
                size="xs"
                className="text-[11px]"
                aria-label={confirmRemove === account.id ? t("settings.accounts.confirmRemove") : t("settings.accounts.remove")}
                title={t("settings.accounts.remove")}
                onClick={() => void remove(account.id)}
                onBlur={() => setConfirmRemove(null)}
              >
                <Trash2 className="size-3" />
                {confirmRemove === account.id && t("settings.accounts.confirmRemove")}
              </Button>
            </div>
          ))}
        </div>
      )}

      <div className="flex gap-2">
        <select
          value={plugin}
          aria-label={t("settings.accounts.provider")}
          onChange={(e) => setPlugin(e.target.value as AccountPlugin)}
          className="fluent-control h-7 w-28 py-0 text-xs"
        >
          {ACCOUNT_PLUGINS.map((id) => (
            <option key={id} value={id}>
              {nameOf(id)}
            </option>
          ))}
        </select>
        <input
          value={label}
          maxLength={MAX_LABEL}
          aria-label={t("settings.accounts.label")}
          placeholder={t("settings.accounts.labelPlaceholder")}
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && label.trim() && !busy) void add()
          }}
          className="fluent-control h-7 min-w-0 flex-1 px-2 text-xs"
        />
        <Button size="xs" className="h-7" disabled={busy || !label.trim()} onClick={() => void add()}>
          {t("settings.accounts.add")}
        </Button>
      </div>
      {failed && <p className="mt-1 text-xs text-destructive">{t("settings.accounts.addFailed")}</p>}
      <p className="mt-1.5 text-xs text-muted-foreground">{t("settings.accounts.hint")}</p>
    </SettingsSection>
  )
}
