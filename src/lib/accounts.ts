/**
 * Extra provider accounts (`src-tauri/src/accounts.rs`): a second Claude or Codex login in its own
 * folder, probed as a copy of the plugin under the account's id (`claude-1a2b3c4d`).
 */
export const ACCOUNT_PLUGINS = ["claude", "codex"] as const
export type AccountPlugin = (typeof ACCOUNT_PLUGINS)[number]

export type ProviderAccount = { id: string; plugin: AccountPlugin; label: string; home: string }

/** What changed in the account list, so the app can update the plugin list and its order. */
export type AccountsChange = { added?: { id: string; plugin: string }; removedId?: string }

/** Plugin ids of extra accounts, as `accounts.rs` makes them. */
export const isAccountId = (id: string | undefined): id is string => !!id && /^(claude|codex)-[0-9a-f]{8}$/.test(id)

/** A new account goes right after its provider and that provider's other accounts. */
export function insertAccount(order: string[], id: string, plugin: string): string[] {
  const rest = order.filter((other) => other !== id)
  let at = -1
  rest.forEach((other, index) => {
    if (other === plugin || (isAccountId(other) && other.startsWith(`${plugin}-`))) at = index
  })
  return at < 0 ? [...rest, id] : [...rest.slice(0, at + 1), id, ...rest.slice(at + 1)]
}
