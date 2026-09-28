import { describe, expect, it, vi } from "vitest"

const renderMock = vi.fn()
const createRootMock = vi.fn(() => ({ render: renderMock }))
const logErrorMock = vi.fn(() => Promise.resolve())
const logWarnMock = vi.fn(() => Promise.resolve())

vi.mock("react-dom/client", () => ({
  default: {
    createRoot: createRootMock,
  },
}))

vi.mock("@tauri-apps/plugin-log", () => ({
  error: logErrorMock,
  warn: logWarnMock,
}))

vi.mock("@/App", () => ({
  App: () => null,
}))

describe("main", () => {
  it("mounts app", async () => {
    document.body.innerHTML = '<div id="root"></div>'
    await import("@/main")
    expect(createRootMock).toHaveBeenCalled()
    expect(renderMock).toHaveBeenCalled()
    // The first import cold-transforms main.tsx + index.css (Tailwind scans the whole tree), which
    // alone can take 5-10s on Windows; this checks mounting, not speed.
  }, 30_000)
})
