import { render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { App } from "../App";

/** Render the whole app at a hash route, as a visitor arriving at that address would. */
export function renderApp(hash = "#/") {
  window.history.replaceState(null, "", hash);
  const user = userEvent.setup();
  const utils = render(<App />);
  return { user, ...utils };
}

/** Current hash route, e.g. "#/verifications?state=Mismatch". */
export const currentHash = () => window.location.hash;

export async function waitForHash(predicate: (hash: string) => boolean) {
  await waitFor(() => {
    if (!predicate(window.location.hash)) throw new Error(`hash is ${window.location.hash}`);
  });
}
