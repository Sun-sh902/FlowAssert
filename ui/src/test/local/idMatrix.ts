/**
 * The Owner's identifier matrix for ID-addressability remediation-03 (section 8), plus the backend corpus controls
 * (FlowAssert-Phase3A-Service/docs/phase3a/id-addressability-remediation-03/evidence/corpus.py). Shared by the unit
 * tests; the browser suite (e2e-lookup/) keeps its own copy, tied to the live alias manifest.
 */
export const LAB = "\u{1F9EA}";
export const NFC = "\u00e9";
export const NFD = "e\u0301";
export const BMP128 = "\u4e2d\u6587".repeat(64);

/** The Owner's identifier matrix (section 8) plus the backend corpus controls. */
export const MATRIX: [label: string, id: string][] = [
  ["SPEC-001", "SPEC-001"],
  ["colon", "SPEC:006"],
  ["chinese", "中文"],
  ["emoji", LAB],
  ["emoji128", LAB.repeat(128)],
  ["dot", "."],
  ["dotdot", ".."],
  ["slash", "customer/001"],
  ["evidence-suffix", "x/evidence"],
  ["punctuation", "a?b#c"],
  ["plus", "a+b"],
  ["space", "a b"],
  ["percent-literal", "a%2Fb"],
  ["decoded-slash", "a/b"],
  ["bmp128", BMP128],
  ["nfc", NFC],
  ["nfd", NFD],
  ["whitespace", " leading and trailing "],
  ["controls", "\x00\t\n\x1f\x7f"],
];
