import { useMemo, useRef, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";
import { AboutDialog } from "@/components/about-dialog";
import type { UpdateStatus } from "@/hooks/use-app-update";
import { useNowTicker } from "@/hooks/use-now-ticker";
import { useVersionCheck } from "@/hooks/use-version-check";

interface PanelFooterProps {
  version: string;
  autoUpdateNextAt: number | null;
  updateStatus: UpdateStatus;
  onUpdateInstall: () => void;
  onRefreshAll?: () => void;
  showAbout: boolean;
  onShowAbout: () => void;
  onCloseAbout: () => void;
}

function VersionDisplay({
  version,
  updateStatus,
  onUpdateInstall,
  onVersionClick,
  versionCheck,
}: {
  version: string;
  updateStatus: UpdateStatus;
  onUpdateInstall: () => void;
  onVersionClick: () => void;
  versionCheck: { hasUpdate: boolean; latestVersion: string | null; releaseUrl: string | null };
}) {
  // Show update available banner regardless of updater status
  if (versionCheck.hasUpdate && versionCheck.releaseUrl) {
    return (
      <button
        type="button"
        onClick={() => openUrl(versionCheck.releaseUrl!).catch(console.error)}
        className="text-xs text-green-500 hover:text-green-400 font-medium transition-colors cursor-pointer"
        title={`Download v${versionCheck.latestVersion}`}
      >
        v{versionCheck.latestVersion} available
      </button>
    );
  }
  switch (updateStatus.status) {
    case "downloading":
      return (
        <span className="text-xs text-muted-foreground">
          {updateStatus.progress >= 0
            ? `Downloading update ${updateStatus.progress}%`
            : "Downloading update..."}
        </span>
      );
    case "ready":
      return (
        <Button
          variant="destructive"
          size="xs"
          className="update-border-beam"
          onClick={onUpdateInstall}
        >
          Restart to update
        </Button>
      );
    case "installing":
      return (
        <span className="text-xs text-muted-foreground">Installing...</span>
      );
    case "error":
      return (
        <button
          type="button"
          onClick={() => openUrl("https://github.com/PowerUserZ/OpenTokenUsage/releases").catch(console.error)}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
          title="Open releases page"
        >
          v{version}
        </button>
      );
    default:
      return (
        <button
          type="button"
          onClick={onVersionClick}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
        >
          OpenTokenUsage {version}
        </button>
      );
  }
}

export function PanelFooter({
  version,
  autoUpdateNextAt,
  updateStatus,
  onUpdateInstall,
  onRefreshAll,
  showAbout,
  onShowAbout,
  onCloseAbout,
}: PanelFooterProps) {
  const versionCheck = useVersionCheck(version);
  const [refreshCooldown, setRefreshCooldown] = useState(false);
  const cooldownTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleRefresh = () => {
    if (refreshCooldown || !onRefreshAll) return;
    onRefreshAll();
    setRefreshCooldown(true);
    if (cooldownTimerRef.current) clearTimeout(cooldownTimerRef.current);
    cooldownTimerRef.current = setTimeout(() => setRefreshCooldown(false), 30_000);
  };

  const now = useNowTicker({
    enabled: Boolean(autoUpdateNextAt),
    resetKey: autoUpdateNextAt,
  });

  const countdownLabel = useMemo(() => {
    if (!autoUpdateNextAt) return "Paused";
    const remainingMs = Math.max(0, autoUpdateNextAt - now);
    const totalSeconds = Math.ceil(remainingMs / 1000);
    if (totalSeconds >= 60) {
      const minutes = Math.ceil(totalSeconds / 60);
      return `Next update in ${minutes}m`;
    }
    return `Next update in ${totalSeconds}s`;
  }, [autoUpdateNextAt, now]);

  return (
    <>
      <div className="flex justify-between items-center h-8 pt-1.5 border-t">
        <VersionDisplay
          version={version}
          updateStatus={updateStatus}
          onUpdateInstall={onUpdateInstall}
          onVersionClick={onShowAbout}
          versionCheck={versionCheck}
        />
        {autoUpdateNextAt !== null && onRefreshAll ? (
          <button
            type="button"
            disabled={refreshCooldown}
            onClick={(event) => {
              event.currentTarget.blur()
              handleRefresh()
            }}
            className={`text-xs tabular-nums transition-colors ${refreshCooldown ? "text-muted-foreground/50 cursor-not-allowed" : "text-muted-foreground hover:text-foreground cursor-pointer"}`}
            title={refreshCooldown ? "Wait before refreshing again" : "Refresh now"}
          >
            {countdownLabel}
          </button>
        ) : (
          <span className="text-xs text-muted-foreground tabular-nums">
            {countdownLabel}
          </span>
        )}
      </div>
      {showAbout && (
        <AboutDialog version={version} onClose={onCloseAbout} />
      )}
    </>
  );
}
