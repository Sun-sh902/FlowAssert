/**
 * jsdom gaps filled with inert stand-ins. Nothing here fakes product behaviour:
 * matchMedia answers "no match" (light scheme, wide layout rules not applied),
 * scrolling is a no-op, and storage is the real jsdom localStorage, cleared per test.
 */
import { cleanup } from "@testing-library/react";
import { afterEach, beforeEach, vi } from "vitest";

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
Element.prototype.scrollIntoView = function scrollIntoView() {};
window.scrollTo = (() => {}) as typeof window.scrollTo;

beforeEach(() => {
  localStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
