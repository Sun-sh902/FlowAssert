/**
 * The standalone HTML report (offline/report.ts writeHtml, cli.write_html): every value from the files is escaped,
 * wherever it appears (a key, a field value, a compared value, a highlighted run, a destination-only key); the page
 * has no script, loads nothing and links nowhere; and it says the highlighting is a display aid. Both
 * implementations write the same bytes: golden.test.ts and random-parity.test.ts hold them to it.
 */
import { describe, expect, test } from "vitest";
import { check, reportHtml } from "../../offline/check";

const file = (name: string, text: string) => {
  const bytes = new TextEncoder().encode(text);
  return { name, size: bytes.length, read: () => bytes };
};

const HOSTILE = ['<script>alert(1)</script>', '"><img src=x onerror=alert(2)>', "' onmouseover='alert(3)", "</style><style>body{background:url(https://example.test/x)}", "&lt;already&gt;", "<!--", "]]>"];

async function hostileReport() {
  const quote = (v: string) => `"${v.replaceAll('"', '""')}"`;
  const source = ["k,p", ...HOSTILE.map((v, i) => `${quote(v + i)},${quote(v)}`)].join("\n") + "\n";
  // Each destination value differs from its source value, so every value is drawn in the highlighting too.
  const destination = ["k,p", ...HOSTILE.map((v, i) => `${quote(v + i)},${quote(" " + v.slice(1) + "x")}`), `${quote(HOSTILE[0]!)},x`].join("\n") + "\n";
  const outcome = await check({
    source: file("s.csv", source),
    destination: file("d.csv", destination),
    key: "k",
    field: ["p"],
    scope: "exact",
    sourceComplete: true,
    destinationComplete: true,
    details: "all",
    now: () => "2000-01-01T00:00:00Z",
  });
  expect(outcome.exit).toBe(1);
  return reportHtml(outcome.report!);
}

describe("the HTML report", () => {
  test("escapes every value from the files, wherever it is drawn", async () => {
    const html = await hostileReport();
    expect(html.toLowerCase()).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<!--");
    // An attribute written in a value stays text: no tag carries it (the next test reads every tag).
    expect(html).toContain("&#x27; onmouseover=&#x27;alert(3)");
    // One style element, the page's own.
    expect(html.match(/<style>/g)).toHaveLength(1);
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).toContain("&amp;lt;already&amp;gt;");
    // The highlighting is there, and the destination-only key too.
    expect(html).toContain("<del>");
    expect(html).toContain("<ins>");
    expect(html).toContain("Destination-only records (1)");
  });

  test("has no script, loads nothing and links nowhere", async () => {
    const html = await hostileReport();
    const tags = [...html.matchAll(/<([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g)];
    const allowed = new Set(["html", "head", "meta", "title", "style", "body", "main", "header", "h1", "h2", "h3", "p", "span", "section", "div", "article", "table", "tr", "th", "td", "ul", "li", "dl", "dt", "dd", "figure", "figcaption", "del", "ins", "code", "i"]);
    for (const [, name, attributes] of tags) {
      expect(allowed.has(name!.toLowerCase())).toBe(true);
      expect(attributes).not.toMatch(/\b(src|href|action|srcset|on[a-z]+)\s*=/i);
    }
    const style = html.slice(html.indexOf("<style>"), html.indexOf("</style>"));
    expect(style).not.toMatch(/url\(|@import|@font-face/);
    expect(html.replace(/https:\/\/example\.test\/x/g, "")).not.toMatch(/https?:\/\//);
    expect(html).toContain(`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`);
  });

  test("labels the highlighting as a display aid, and says what was applied of each premise", async () => {
    const html = await hostileReport();
    expect(html).toContain("This highlights where the two values differ. The rule’s result above is the conclusion.");
    expect(html).toContain('<p class="applied yes">applied</p>');
    expect(html).toContain('<p class="applied none">not stated</p>');
  });
});
