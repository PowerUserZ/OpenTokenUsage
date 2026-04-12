import { useShallow } from "zustand/react/shallow"
import { Minus } from "lucide-react"
import { invoke } from "@tauri-apps/api/core"
import { AppContent, type AppContentActionProps } from "@/components/app/app-content"
import { PanelFooter } from "@/components/panel-footer"
import { SideNav, type NavPlugin, type PluginContextAction } from "@/components/side-nav"
import type { DisplayPluginState } from "@/hooks/app/use-app-plugin-views"
import type { SettingsPluginState } from "@/hooks/app/use-settings-plugin-list"
import { useAppVersion } from "@/hooks/app/use-app-version"
import { usePanel } from "@/hooks/app/use-panel"
import { useAppUpdate } from "@/hooks/use-app-update"
import { useAppUiStore } from "@/stores/app-ui-store"

const IS_MACOS = navigator.userAgent.includes("Macintosh")

const ARROW_OVERHEAD_PX = 37

type AppShellProps = {
  onRefreshAll: () => void
  navPlugins: NavPlugin[]
  displayPlugins: DisplayPluginState[]
  settingsPlugins: SettingsPluginState[]
  autoUpdateNextAt: number | null
  selectedPlugin: DisplayPluginState | null
  onPluginContextAction: (pluginId: string, action: PluginContextAction) => void
  isPluginRefreshAvailable: (pluginId: string) => boolean
  onNavReorder: (orderedIds: string[]) => void
  appContentProps: AppContentActionProps
}

export function AppShell({
  onRefreshAll,
  navPlugins,
  displayPlugins,
  settingsPlugins,
  autoUpdateNextAt,
  selectedPlugin,
  onPluginContextAction,
  isPluginRefreshAvailable,
  onNavReorder,
  appContentProps,
}: AppShellProps) {
  const {
    activeView,
    setActiveView,
    showAbout,
    setShowAbout,
  } = useAppUiStore(
    useShallow((state) => ({
      activeView: state.activeView,
      setActiveView: state.setActiveView,
      showAbout: state.showAbout,
      setShowAbout: state.setShowAbout,
    }))
  )

  const {
    containerRef,
    scrollRef,
    canScrollDown,
    maxPanelHeightPx,
  } = usePanel({
    activeView,
    setActiveView,
    showAbout,
    setShowAbout,
    displayPlugins,
  })

  const appVersion = useAppVersion()
  const { updateStatus, triggerInstall } = useAppUpdate()

  return (
    <div ref={containerRef} className={`flex flex-col items-center bg-transparent ${IS_MACOS ? "p-6 pt-1.5" : "p-0"}`}>
      {IS_MACOS && <div className="tray-arrow" />}
      <div
        className={`relative bg-card overflow-hidden select-none w-full flex flex-col ${IS_MACOS ? "rounded-xl border shadow-lg" : ""}`}
        style={maxPanelHeightPx ? { maxHeight: `${maxPanelHeightPx - (IS_MACOS ? ARROW_OVERHEAD_PX : 0)}px` } : undefined}
      >
        {!IS_MACOS && (
          <div
            data-tauri-drag-region
            className="titlebar flex items-center h-7 px-2 shrink-0"
          >
            <span className="titlebar text-xs font-medium text-muted-foreground select-none pointer-events-none">OpenTokenUsage</span>
            <span className="flex-1" />
            <button
              onClick={() => invoke("hide_panel")}
              className="titlebar-button inline-flex items-center justify-center w-6 h-5 rounded hover:bg-muted/80 text-muted-foreground hover:text-foreground transition-colors"
              title="Minimize to tray"
            >
              <Minus size={14} strokeWidth={2} />
            </button>
          </div>
        )}
        <div className="flex flex-1 min-h-0 flex-row">
          <SideNav
            activeView={activeView}
            onViewChange={setActiveView}
            plugins={navPlugins}
            onPluginContextAction={onPluginContextAction}
            isPluginRefreshAvailable={isPluginRefreshAvailable}
            onReorder={onNavReorder}
          />
          <div className="flex-1 flex flex-col px-3 pt-2 pb-1.5 min-w-0 bg-card dark:bg-muted/50">
            <div className="relative flex-1 min-h-0">
              <div ref={scrollRef} className={`h-full overflow-y-auto ${IS_MACOS ? "scrollbar-none" : ""}`}>
                <AppContent
                  {...appContentProps}
                  displayPlugins={displayPlugins}
                  settingsPlugins={settingsPlugins}
                  selectedPlugin={selectedPlugin}
                />
              </div>
              <div
                className={`pointer-events-none absolute inset-x-0 bottom-0 h-14 bg-gradient-to-t from-card dark:from-muted/50 to-transparent transition-opacity duration-200 ${canScrollDown ? "opacity-100" : "opacity-0"}`}
              />
            </div>
            <PanelFooter
              version={appVersion}
              autoUpdateNextAt={autoUpdateNextAt}
              updateStatus={updateStatus}
              onUpdateInstall={triggerInstall}
              onRefreshAll={onRefreshAll}
              showAbout={showAbout}
              onShowAbout={() => setShowAbout(true)}
              onCloseAbout={() => setShowAbout(false)}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
