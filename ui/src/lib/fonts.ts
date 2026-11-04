import { useEffect } from "react";

/**
 * Load every font face when a page of the browser check opens, so a page that later shows new characters (values from
 * a file or a report) never fetches one: those pages make no request once they are open.
 */
export function useAllFontFaces() {
  useEffect(() => {
    if (typeof document !== "undefined" && document.fonts) document.fonts.forEach((face) => void face.load().catch(() => undefined));
  }, []);
}
