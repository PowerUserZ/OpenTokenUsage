import { useEffect } from "react"
import { invoke } from "@tauri-apps/api/core"

/**
 * Applies the native Windows look: `.backdrop` when the window got Mica/Acrylic (surfaces turn
 * translucent, see index.css) and `--accent-base` from the Windows accent color.
 */
export function useWindowsAppearance() {
  useEffect(() => {
    const root = document.documentElement

    invoke<string>("get_window_backdrop")
      .then((backdrop) => root.classList.toggle("backdrop", backdrop === "mica" || backdrop === "acrylic"))
      .catch((error) => console.error("Failed to read window backdrop:", error))

    const applyAccent = () => {
      invoke<string | null>("get_accent_color")
        .then((color) => {
          if (color) root.style.setProperty("--accent-base", color)
        })
        .catch((error) => console.error("Failed to read accent color:", error))
    }
    applyAccent()
    // The accent can change while the app runs; re-read it whenever the panel gets focus.
    window.addEventListener("focus", applyAccent)
    return () => window.removeEventListener("focus", applyAccent)
  }, [])
}
