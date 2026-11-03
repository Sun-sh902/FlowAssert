/**
 * Which build this is. The GitHub Pages demo (`vite build --mode pages`) has no local Service: there the CSV check is
 * the home page, and every page that reads the Service says it works only locally instead of trying to reach it.
 */
export const PAGES_BUILD = import.meta.env.MODE === "pages";
