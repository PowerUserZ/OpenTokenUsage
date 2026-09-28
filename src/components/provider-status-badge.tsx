import { openUrl } from "@tauri-apps/plugin-opener"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { useProviderStatus } from "@/hooks/use-provider-status"
import { t, type MessageKey } from "@/lib/i18n"

const INDICATORS: Record<string, { dotClass: string; label: MessageKey }> = {
  minor: { dotClass: "bg-yellow-500", label: "status.minor" },
  major: { dotClass: "bg-red-500", label: "status.major" },
  critical: { dotClass: "bg-red-500", label: "status.critical" },
  maintenance: { dotClass: "bg-muted-foreground", label: "status.maintenance" },
}

/** "Is it me or them?" — shown only while the vendor's status page reports an issue. */
export function ProviderStatusBadge({
  pluginId,
  statusPageUrl,
}: {
  pluginId: string
  statusPageUrl?: string | null
}) {
  const status = useProviderStatus(pluginId, Boolean(statusPageUrl))
  const visual = status ? INDICATORS[status.indicator] : undefined
  if (!status || !visual || !statusPageUrl) return null
  const label = t(visual.label)

  return (
    <Tooltip>
      <TooltipTrigger
        render={(props) => (
          <button
            {...props}
            type="button"
            className="ml-1.5 inline-flex h-5 items-center gap-1 rounded-full px-1.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={`${label}: ${status.description}`}
            onClick={() => {
              openUrl(statusPageUrl).catch(console.error)
            }}
          >
            <span className={`inline-block size-2 rounded-full ${visual.dotClass}`} />
            {label}
          </button>
        )}
      />
      <TooltipContent side="top" className="max-w-xs text-xs text-center">
        <div>{status.description}</div>
        <div className="text-[10px] opacity-60">{t("status.open")}</div>
      </TooltipContent>
    </Tooltip>
  )
}
