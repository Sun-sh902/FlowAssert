/**
 * Help after a refusal (offline/refusalHint.ts): one test per hint, from the refusal the check really gives for the
 * file and the file's first bytes, and the refusals and files where no hint is justified.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import { translate } from "../../i18n/translate";
import { check } from "../../offline/check";
import type { Encoding } from "../../offline/csv";
import { refusalHint, separatorOf, type Hint, type HintFile } from "../../offline/refusalHint";
import { REPO_ROOT } from "../fixtures/sources";

const enc = (text: string) => new TextEncoder().encode(text);
const utf16le = (text: string, bom = true) => {
  const out = new Uint8Array((bom ? 2 : 0) + text.length * 2);
  if (bom) out.set([0xff, 0xfe]);
  for (let i = 0; i < text.length; i++) {
    out[(bom ? 2 : 0) + 2 * i] = text.charCodeAt(i) & 0xff;
    out[(bom ? 2 : 0) + 2 * i + 1] = text.charCodeAt(i) >> 8;
  }
  return out;
};
const golden = (name: string, file: string) => new Uint8Array(readFileSync(join(REPO_ROOT, "offline/golden", name, file)));

interface Side {
  bytes: Uint8Array;
  encoding?: Encoding;
}

const KP = (key = "k", field = "p") => ({ key: [key, key], fields: [{ source: field, destination: field, rule: "exact" }], scope: "source" });

/** Run the check as the page runs it and return its refusal and the hint for it, with what the page knows. */
async function refusedWithHint(source: Side, destination: Side, config: { key: string[]; fields: { source: string; destination: string; rule: string }[]; scope: string } = KP()) {
  const file = (name: string, bytes: Uint8Array) => ({ name, size: bytes.length, read: () => bytes });
  const configBytes = enc(JSON.stringify(config));
  const outcome = await check({
    source: file("source.csv", source.bytes),
    destination: file("destination.csv", destination.bytes),
    config: file("config.json", configBytes),
    sourceEncoding: source.encoding ?? "utf-8",
    destinationEncoding: destination.encoding ?? "utf-8",
  });
  expect(outcome.exit).toBe(2);
  const files: HintFile[] = [
    { name: "source.csv", head: source.bytes, size: source.bytes.length, encoding: source.encoding ?? "utf-8", columns: [config.key[0]!, ...config.fields.map((f) => f.source)] },
    { name: "destination.csv", head: destination.bytes, size: destination.bytes.length, encoding: destination.encoding ?? "utf-8", columns: [config.key[1]!, ...config.fields.map((f) => f.destination)] },
  ];
  return { message: outcome.stderr.trim(), hint: refusalHint(outcome.stderr.trim(), files) };
}

const text = (hint: Hint | null) => (hint ? hint.paragraphs.map((p) => p.map((x) => (typeof x === "string" ? x : `«${x.value}»`)).join("")).join("\n") : "");
const ok = { bytes: enc("k,p\n1,2\n") };

describe("not in the chosen encoding", () => {
  test("a UTF-16 file with a byte order mark, chosen as UTF-8: choose UTF-16", async () => {
    const { message, hint } = await refusedWithHint({ bytes: utf16le("k,p\n1,2\n") }, ok);
    expect(message).toBe("refused: source.csv: not UTF-8");
    expect(hint!.kinds).toEqual(["utf-16"]);
    expect(text(hint)).toContain("If it is, choose UTF-16 as its encoding.");
    expect(text(hint)).toContain("its first line is: «k,p»");
  });

  test("UTF-16 without a byte order mark: no encoding choice reads it, so save it again", async () => {
    const noBom = utf16le("k,p\n1,2\n", false);
    // Zero bytes are UTF-8, so as UTF-8 it reads, and no column name matches.
    const asUtf8 = await refusedWithHint({ bytes: noBom }, ok);
    expect(asUtf8.message).toBe("refused: source.csv: missing column k, p");
    expect(asUtf8.hint!.kinds).toEqual(["utf-16-no-bom"]);
    const asUtf16 = await refusedWithHint({ bytes: noBom, encoding: "utf-16" }, ok);
    expect(asUtf16.message).toBe("refused: source.csv: not UTF-16 (no byte order mark)");
    expect(asUtf16.hint!.kinds).toEqual(["utf-16-no-bom"]);
    expect(text(asUtf16.hint)).toContain("Save it again as UTF-8, or as UTF-16 with a byte order mark");
  });

  test("a GB18030 file chosen as UTF-8: choose GB18030, with its first line as GB18030 reads it", async () => {
    const { message, hint } = await refusedWithHint({ bytes: golden("decode-wrong-encoding", "source.csv") }, ok);
    expect(message).toBe("refused: source.csv: not UTF-8");
    expect(hint!.kinds).toEqual(["gb18030"]);
    expect(text(hint)).toContain("If the file is GB18030, choose GB18030 as its encoding.");
  });

  test("a UTF-8 file chosen as UTF-16: choose UTF-8", async () => {
    const { message, hint } = await refusedWithHint({ bytes: enc("k,p\n1,é\n"), encoding: "utf-16" }, ok);
    expect(message).toBe("refused: source.csv: not UTF-16 (no byte order mark)");
    expect(hint!.kinds).toEqual(["utf-8"]);
  });

  test("no hint when the start of the file is UTF-8 and the byte that is not comes later", async () => {
    const bytes = new Uint8Array([...enc("k,p\n" + "1,2\n".repeat(10)), 0xff, 0x0a]);
    const { message, hint } = await refusedWithHint({ bytes }, ok);
    expect(message).toBe("refused: source.csv: not UTF-8");
    expect(hint).toBeNull();
  });
});

describe("missing column", () => {
  test("lists the file's columns and points out one that differs only in case or spaces", async () => {
    const { message, hint } = await refusedWithHint({ bytes: enc("k, Phone ,email\n1,2,3\n") }, { bytes: enc("k,phone\n1,2\n") }, KP("k", "phone"));
    expect(message).toBe("refused: source.csv: missing column phone");
    expect(hint!.kinds).toEqual(["missing-column", "near-column"]);
    expect(text(hint)).toContain("The file has 3 columns: «k,  Phone , email»");
    expect(text(hint)).toContain('The file’s column «" Phone "» differs from «"phone"» only in upper and lower case or in spaces around it.');
  });

  test("a file separated by semicolons has one column: say so, and that FlowAssert reads only commas", async () => {
    const { message, hint } = await refusedWithHint({ bytes: enc("k;p\n1;2\n3;4\n") }, ok);
    expect(message).toBe("refused: source.csv: missing column k, p");
    expect(hint!.kinds).toEqual(["missing-column", "separator"]);
    expect(text(hint)).toContain("The file has one column: «k;p»");
    expect(text(hint)).toContain("separated by semicolons: «;» FlowAssert reads only commas.");
  });

  test("no hint when the columns the page knows do not explain the refusal", () => {
    const head = enc("k,p\n1,2\n");
    expect(refusalHint("refused: source.csv: missing column q", [{ name: "source.csv", head, size: head.length, encoding: "utf-8", columns: ["k", "p"] }])).toBeNull();
  });
});

describe("a line that does not match the header", () => {
  test("says how many fields the line and the header have", async () => {
    const { message, hint } = await refusedWithHint({ bytes: enc("k,p\n1,2\n3,4,5\n") }, ok);
    expect(message).toBe("refused: source.csv: line 3 does not match the header");
    expect(hint!.kinds).toEqual(["line-fields"]);
    expect(text(hint)).toBe("Line 3 has 3 fields; the header has 2. A value that contains a comma must be inside double quotes, or it is read as two fields.");
  });

  test("a file separated by semicolons, with a decimal comma: the counts and the separator", async () => {
    const { message, hint } = await refusedWithHint({ bytes: enc("k;p\nA;1\nB;2,5\nC;3\n") }, ok, { key: ["k;p", "k"], fields: [{ source: "k;p", destination: "p", rule: "exact" }], scope: "source" });
    expect(message).toBe("refused: source.csv: line 3 does not match the header");
    expect(hint!.kinds).toEqual(["line-fields", "separator"]);
    expect(text(hint)).toContain("Line 3 has 2 fields; the header has 1.");
    expect(text(hint)).toContain("FlowAssert reads only commas.");
  });

  test("tabs are recognized too, and a comma file is not taken for one", () => {
    expect(separatorOf("a\tb\tc\n1\t2\t3\n")).toBe("\t");
    expect(separatorOf("a,b;c\n1,2;3\n")).toBeNull();
    expect(separatorOf("a,b,c\n1,2,3\n")).toBeNull();
  });
});

describe("the other refusals", () => {
  test("a repeated column name: which names, and what to do", async () => {
    const { message, hint } = await refusedWithHint({ bytes: enc("k,p,p\n1,2,3\n") }, ok);
    expect(message).toBe("refused: source.csv: repeated column name");
    expect(hint!.kinds).toEqual(["repeated-column"]);
    expect(text(hint)).toContain('«"p"» Give each column a name of its own');
  });

  test("identical content: choose the destination export; the statement is recorded, not checked", async () => {
    const { message, hint } = await refusedWithHint(ok, ok);
    expect(message).toContain("identical content");
    expect(hint!.kinds).toEqual(["identical-content"]);
    expect(text(hint)).toContain("FlowAssert cannot check it.");
  });

  test("the same file chosen twice", () => {
    expect(refusalHint("refused: source and destination are the same file, so the check would not be independent", [])!.kinds).toEqual(["same-file"]);
  });

  test("the size limit and the row limit point to the command line", async () => {
    expect(refusalHint("refused: big.csv: file size 209715201 bytes exceeds --max-bytes limit of 209715200", [])!.kinds).toEqual(["max-bytes"]);
    const rows = await check({ source: { name: "s.csv", size: 12, read: () => enc("k,p\n1,2\n3,4\n") }, destination: { name: "d.csv", size: 8, read: () => enc("k,p\n1,2\n") }, key: "k", field: ["p"], maxRows: 1 });
    expect(refusalHint(rows.stderr.trim(), [])!.kinds).toEqual(["max-rows"]);
  });

  test("no hint for a refusal no hint is written for, such as a quoted field left open", async () => {
    const { message, hint } = await refusedWithHint({ bytes: enc('k,p\n"1,2\n') }, ok);
    expect(message).toBe("refused: source.csv: unexpected end of data");
    expect(hint).toBeNull();
  });
});

describe("Chinese", () => {
  test("every sentence a hint can write has a Chinese entry", () => {
    const source = readFileSync(join(REPO_ROOT, "ui/src/offline/refusalHint.ts"), "utf-8");
    const literals = [...source.matchAll(/"((?:[A-Z#]|\d+ )[^"]*\s[^"]*)"|`((?:[A-Z#$]|\d)[^`]*\s[^`]*)`/g)]
      .map((m) => (m[1] ?? m[2]!).replace(/\$\{[^}]+\}/g, "1"))
      .filter((t) => /[a-z]{3}/.test(t));
    expect(literals.length).toBeGreaterThan(15);
    expect(literals.filter((t) => translate(t) === t)).toEqual([]);
    expect(translate("Line 3 has 3 fields; the header has 2.")).not.toBe("Line 3 has 3 fields; the header has 2.");
  });
});
