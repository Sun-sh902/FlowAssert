/**
 * Applies the Chinese catalogue to rendered text and accessible names. It runs only when Chinese is selected, so the
 * English interface is the application exactly as written. It rewrites the DOM node's value and nothing else: React
 * state, view models and provider data keep the English source.
 *
 * Elements marked `data-no-translate`, and code, pre and form values, are left alone so evidence is never altered.
 */
import { translate } from "./translate";

const ATTRIBUTES = ["aria-label", "title", "placeholder", "alt", "aria-description"] as const;
const SKIP = "code, pre, script, style, textarea, [data-no-translate]";

function textNode(node: Text) {
  if (node.parentElement?.closest(SKIP)) return;
  const value = node.nodeValue ?? "";
  const next = translate(value);
  if (next !== value) node.nodeValue = next;
}

function attributes(el: Element) {
  if (el.closest(SKIP)) return;
  for (const name of ATTRIBUTES) {
    const value = el.getAttribute(name);
    if (value === null) continue;
    const next = translate(value);
    if (next !== value) el.setAttribute(name, next);
  }
}

function subtree(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return textNode(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  attributes(el);
  for (const child of el.querySelectorAll("*")) attributes(child);
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) textNode(walker.currentNode as Text);
}

function title() {
  const next = translate(document.title);
  if (next !== document.title) document.title = next;
}

/** Keep `root` and the document title translated. Returns a stop function. */
export function startLocalizer(root: Element = document.body): () => void {
  subtree(root);
  title();
  const observer = new MutationObserver((records) => {
    for (const r of records) {
      if (r.type === "characterData") textNode(r.target as Text);
      else if (r.type === "attributes") attributes(r.target as Element);
      else r.addedNodes.forEach(subtree);
    }
  });
  observer.observe(root, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...ATTRIBUTES] });
  const head = document.querySelector("title");
  const titles = new MutationObserver(title);
  if (head) titles.observe(head, { childList: true, characterData: true, subtree: true });
  return () => {
    observer.disconnect();
    titles.disconnect();
  };
}
