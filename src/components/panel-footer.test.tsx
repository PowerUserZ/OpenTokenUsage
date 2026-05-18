import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { useState } from "react"
import { describe, expect, it, vi } from "vitest"
import { PanelFooter } from "@/components/panel-footer"
import type { UpdateStatus } from "@/hooks/use-app-update"

const openerState = vi.hoisted(() => ({
  openUrlMock: vi.fn(() => Promise.resolve()),
}))

const versionCheckState = vi.hoisted(() => ({
  result: { hasUpdate: false, latestVersion: null as string | null, releaseUrl: null as string | null },
}))

vi.mock("@tauri-apps/plugin-opener", () => ({
  openUrl: openerState.openUrlMock,
}))

vi.mock("@/hooks/use-version-check", () => ({
  useVersionCheck: () => versionCheckState.result,
}))

const idle: UpdateStatus = { status: "idle" }
const noop = () => {}
const footerProps = { showAbout: false, onShowAbout: noop, onCloseAbout: noop }

describe("PanelFooter", () => {
  it("shows countdown in minutes when >= 60 seconds", () => {
    const futureTime = Date.now() + 5 * 60 * 1000 // 5 minutes from now
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={futureTime}
        updateStatus={idle}
        onUpdateInstall={noop}
        {...footerProps}
      />
    )
    expect(screen.getByText("Next update in 5m")).toBeTruthy()
  })

  it("shows countdown in seconds when < 60 seconds", () => {
    const futureTime = Date.now() + 30 * 1000 // 30 seconds from now
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={futureTime}
        updateStatus={idle}
        onUpdateInstall={noop}
        {...footerProps}
      />
    )
    expect(screen.getByText("Next update in 30s")).toBeTruthy()
  })

  it("triggers refresh when clicking countdown label", async () => {
    const futureTime = Date.now() + 5 * 60 * 1000 // 5 minutes from now
    const onRefreshAll = vi.fn()
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={futureTime}
        updateStatus={idle}
        onUpdateInstall={noop}
        onRefreshAll={onRefreshAll}
        {...footerProps}
      />
    )
    const button = screen.getByRole("button", { name: /Next update in/i })
    await userEvent.click(button)
    expect(onRefreshAll).toHaveBeenCalledTimes(1)
  })

  it("shows Paused when autoUpdateNextAt is null", () => {
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={null}
        updateStatus={idle}
        onUpdateInstall={noop}
        {...footerProps}
      />
    )
    expect(screen.getByText("Paused")).toBeTruthy()
  })

  it("shows downloading state", () => {
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={null}
        updateStatus={{ status: "downloading", progress: 42 }}
        onUpdateInstall={noop}
        {...footerProps}
      />
    )
    expect(screen.getByText("Downloading update 42%")).toBeTruthy()
  })

  it("shows downloading state without percentage when progress is unknown", () => {
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={null}
        updateStatus={{ status: "downloading", progress: -1 }}
        onUpdateInstall={noop}
        {...footerProps}
      />
    )
    expect(screen.getByText("Downloading update...")).toBeTruthy()
  })

  it("shows restart button when ready", async () => {
    const onInstall = vi.fn()
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={null}
        updateStatus={{ status: "ready" }}
        onUpdateInstall={onInstall}
        {...footerProps}
      />
    )
    const button = screen.getByText("Restart to update")
    expect(button).toBeTruthy()
    await userEvent.click(button)
    expect(onInstall).toHaveBeenCalledTimes(1)
  })

  it("shows current version button for updater errors and opens releases page", async () => {
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={null}
        updateStatus={{ status: "error", message: "Update check failed" }}
        onUpdateInstall={noop}
        {...footerProps}
      />
    )

    const versionButton = screen.getByRole("button", { name: "v0.0.0" })
    expect(versionButton).toBeTruthy()
    await userEvent.click(versionButton)
    expect(openerState.openUrlMock).toHaveBeenCalledWith("https://github.com/PowerUserZ/OpenTokenUsage/releases")
  })

  it("shows installing state", () => {
    render(
      <PanelFooter
        version="0.0.0"
        autoUpdateNextAt={null}
        updateStatus={{ status: "installing" }}
        onUpdateInstall={noop}
        {...footerProps}
      />
    )
    expect(screen.getByText("Installing...")).toBeTruthy()
  })

  it("opens About dialog when clicking version in idle state", async () => {
    function Harness() {
      const [showAbout, setShowAbout] = useState(false)
      return (
        <PanelFooter
          version="0.0.0"
          autoUpdateNextAt={null}
          updateStatus={idle}
          onUpdateInstall={noop}
          showAbout={showAbout}
          onShowAbout={() => setShowAbout(true)}
          onCloseAbout={() => setShowAbout(false)}
        />
      )
    }

    render(<Harness />)
    await userEvent.click(screen.getByRole("button", { name: /OpenTokenUsage/ }))
    expect(screen.getByText("Open source on")).toBeInTheDocument()

    // Close via Escape to exercise AboutDialog onClose path.
    await userEvent.keyboard("{Escape}")
    expect(screen.queryByText("Open source on")).not.toBeInTheDocument()
  })

  it("shows latest release CTA when a newer version exists", async () => {
    versionCheckState.result = {
      hasUpdate: true,
      latestVersion: "1.2.3",
      releaseUrl: "https://github.com/PowerUserZ/OpenTokenUsage/releases/tag/v1.2.3",
    }

    try {
      render(
        <PanelFooter
          version="1.0.0"
          autoUpdateNextAt={null}
          updateStatus={idle}
          onUpdateInstall={noop}
          {...footerProps}
        />
      )

      const updateButton = screen.getByRole("button", { name: "v1.2.3 available" })
      await userEvent.click(updateButton)
      expect(openerState.openUrlMock).toHaveBeenCalledWith(
        "https://github.com/PowerUserZ/OpenTokenUsage/releases/tag/v1.2.3"
      )
    } finally {
      versionCheckState.result = {
        hasUpdate: false,
        latestVersion: null,
        releaseUrl: null,
      }
    }
  })
})
