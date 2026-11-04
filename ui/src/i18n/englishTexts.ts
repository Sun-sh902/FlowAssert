/**
 * Chinese explanations of the fixed English texts the check writes. Reports, refusals and reasons stay in English, as
 * the command line writes them; in the Chinese interface the page shows each one unchanged and, next to it, the
 * explanation from this table (components/report/Gloss.tsx). The catalogue in zh-CN.ts translates interface text in
 * place; this table never replaces a text, it only explains it.
 *
 * The table covers every refusal message of offline/flowassert_offline/cli.py and ui/src/offline/csv.ts, every reason
 * of evaluator_v2.py, the claim, the limitations and the lines of the printed summary. A test scans the Python sources
 * (src/test/english-texts.test.ts), so a new message without an explanation fails it.
 */

export interface Gloss {
  /** Which entry explained the text: the same id for every record line, or every line of one rule reason. */
  id: string;
  zh: string;
}

type Entry = readonly [id: string, pattern: RegExp, zh: (...groups: string[]) => string];

const STATE: Record<string, string> = { Verified: "已验证", Mismatch: "不一致", Unverified: "未验证", Pending: "待定" };
const STATUS: Record<string, string> = { pass: "通过", fail: "不通过", unknown: "未知" };

export const CLAIM_ZH = "在这次评估中，按所声明的前提，提供的目标行满足所提供来源行的规则。";
export const LIMITS_ZH = "文件和完整性声明都未经认证。未评估：工作流是否运行过、来源是否真实、记录是否在过去的截止时间前存在。";

/** Errors of a comparison rule (parse_rule), alone on the page or inside a configuration refusal. */
const RULE_ERRORS: readonly Entry[] = [
  ["rule-unknown", /^unknown comparison rule (.+); use exact, trim, casefold, digits or date:FORMAT$/s, (r) => `比较规则 ${r} 不存在；请使用 exact、trim、casefold、digits 或 date:FORMAT。`],
  ["rule-no-format", /^date rule (.+) has no format$/s, (r) => `日期规则 ${r} 没有写格式。`],
  ["rule-no-directive", /^date format (.+) has no directive$/s, (f) => `日期格式 ${f} 中没有任何 % 指令，无法读取日期。`],
  ["rule-malformed", /^malformed date format (.+?) \((.+)\)$/s, (f, e) => `日期格式 ${f} 无效（${e}，这是 Python 的错误信息）。`],
  ["rule-repeated-directive", /^date format (.+) repeats a directive$/s, (f) => `日期格式 ${f} 重复使用了同一个指令。`],
  ["rule-browser-directive", /^date format (.+) uses %(.+), which the browser check does not support; it supports (.+)$/s, (f, d, all) => `日期格式 ${f} 用到了 %${d}，浏览器核对不支持；支持的指令是 ${all}。这种格式请使用命令行。`],
];

const ruleError = (text: string) => {
  for (const [, pattern, zh] of RULE_ERRORS) {
    const m = pattern.exec(text);
    if (m) return zh(...m.slice(1));
  }
  return null;
};

/** Operating-system errors (OSError.strerror) a refusal can end with. */
const OS_ERRORS: Record<string, string> = {
  "No such file or directory": "没有这个文件或目录",
  "Permission denied": "没有权限",
  "Is a directory": "这是一个目录，不是文件",
  "Not a directory": "路径中的某一部分不是目录",
  "File exists": "文件已经存在，不会覆盖",
  "Operation not permitted": "不允许这项操作",
  "No space left on device": "磁盘空间不足",
  "Read-only file system": "文件系统是只读的",
  "File name too long": "文件名太长",
  "Too many open files": "打开的文件太多",
};

const decodeZh = (file: string, label: string, noBom?: string) => `${file}：不能按 ${label} 解码${noBom ? "（文件开头没有字节顺序标记；FlowAssert 只读取带标记的 UTF-16）" : ""}。FlowAssert 从不猜测编码。`;

/** Refusals, as the command line prints them after "refused: ". The most specific come first. */
const REFUSALS: readonly Entry[] = [
  ["same-file", /^source and destination are the same file, so the check would not be independent$/, () => "来源和目标是同一个文件，这样的核对不独立。"],
  [
    "identical-content",
    /^source and destination have identical content, so the check would not be independent; pass --allow-identical-content if they really come from different systems$/,
    () => "来源和目标的内容完全相同，这样的核对不独立；如果它们确实来自不同系统，请加上 --allow-identical-content（浏览器中是“允许内容完全相同”）。",
  ],
  ["key-required", /^--key or --mapping is required$/, () => "需要 --key 或 --mapping 来指定键列。"],
  ["field-required", /^at least one --field is required$/, () => "至少需要一个 --field 来指定比较的列。"],
  ["mapping-combined", /^--mapping cannot be combined with --key or --field$/, () => "--mapping 不能和 --key 或 --field 一起使用。"],
  ["config-combined", /^--config cannot be combined with (.+)$/s, (o) => `--config 不能和 ${o} 一起使用。`],
  ["repeated-field", /^a source field is repeated$/, () => "同一个来源字段出现了不止一次。"],
  ["empty-column-arg", /^empty column name in (.+)$/s, (t) => `${t} 中没有来源列名。`],
  ["positive", /^(--[a-z-]+) must be a positive integer$/, (o) => `${o} 必须是正整数。`],
  ["non-negative", /^(--[a-z-]+) must be a non-negative integer$/, (o) => `${o} 必须是非负整数。`],
  ["one-of", /^(--[a-z-]+) must be one of: (.+)$/s, (o, v) => `${o} 只能是以下值之一：${v}。`],
  ["max-bytes", /^(.+): file size (\d+) bytes exceeds --max-bytes limit of (\d+)$/s, (f, n, m) => `${f}：文件大小 ${n} 字节，超过 --max-bytes 上限 ${m}（在读取前检查）。`],
  ["max-rows", /^(.+): exceeds --max-rows limit of (\d+)$/s, (f, n) => `${f}：数据行数超过 --max-rows 上限 ${n}。`],
  ["decode", /^(.+): not (UTF-8|UTF-16|GB18030)( \(no byte order mark\))?$/s, (f, l, b) => decodeZh(f, l!, b)],
  ["repeated-column", /^(.+): repeated column name$/s, (f) => `${f}：表头中有列名重复出现。`],
  ["missing-column", /^(.+): missing column (.+)$/s, (f, c) => `${f}：表头中没有这些列：${c}。列名按原样比较，包括大小写和空格。`],
  ["line-fields", /^(.+): line (\d+) does not match the header$/s, (f, n) => `${f}：第 ${n} 行的字段数与表头不同。`],
  ["csv-unexpected-end", /^(.+): unexpected end of data$/s, (f) => `${f}：文件在一个引号值内部结束，有一个引号没有闭合。`],
  ["csv-quote", /^(.+): ',' expected after '"'$/s, (f) => `${f}：引号值后面应当是逗号，却是别的字符。`],
  ["csv-newline", /^(.+): new-line character seen in unquoted field - do you need to open the file with newline=''\?$/s, (f) => `${f}：一个没有引号的值里有单独的回车符。这是 Python CSV 读取器的消息，其中的问题是写给程序员的，不需要回答。`],
  ["csv-field-limit", /^(.+): field larger than field limit \((\d+)\)$/s, (f, n) => `${f}：有一个值长于 ${n} 个字符，这是 Python 的默认上限。`],
  ["json-invalid", /^(.+): invalid JSON \((.+)\)$/s, (f, e) => `${f}：不是有效的 JSON（${e}，这是 Python 的错误信息）。`],
  ["json-duplicate", /^(.+): duplicate member (.+)$/s, (f, n) => `${f}：成员 ${n} 出现了两次。`],
  ["config-object", /^(.+): (configuration|mapping) must be a JSON object$/s, (f, k) => `${f}：${k === "mapping" ? "映射文件" : "配置文件"}最外层必须是一个 JSON 对象。`],
  [
    "config-premise",
    /^(.+): (.+) cannot be set in a configuration file; completeness statements and counts are command-line options, chosen at each run$/s,
    (f, n) => `${f}：${n} 不能写在配置文件里；完整性声明和总数是命令行选项（浏览器中是“你声明的内容”），每次运行时单独选择。`,
  ],
  ["config-unknown", /^(.+): unknown member (.+?)( in field)?$/s, (f, n, field) => `${f}：${field ? "字段中" : ""}有不认识的成员 ${n}。`],
  ["config-missing", /^(.+): missing member (.+?)( in field)?$/s, (f, n, field) => `${f}：${field ? "字段中" : ""}缺少成员 ${n}。`],
  ["config-pair", /^(.+): (key|field) must be a two-item list of strings$/s, (f, k) => `${f}：${k} 必须写成由两个字符串组成的列表 ["来源列", "目标列"]。`],
  ["config-empty-column", /^(.+): empty column name in (key|field)$/s, (f, k) => `${f}：${k} 中有空的列名。`],
  ["config-fields", /^(.+): fields must be a non-empty list$/s, (f) => `${f}：fields 必须是至少包含一个字段的列表。`],
  ["config-field-object", /^(.+): each field must be an object with source, destination and an optional rule$/s, (f) => `${f}：每个字段必须是一个对象，包含 source、destination，以及可选的 rule。`],
  ["config-field-string", /^(.+): field (source|destination|rule) must be a string$/s, (f, m) => `${f}：字段的 ${m} 必须是字符串。`],
  ["config-repeated-field", /^(.+): a source field is repeated$/s, (f) => `${f}：同一个来源字段出现了不止一次。`],
  ["config-scope", /^(.+): scope must be one of: (.+)$/s, (f, v) => `${f}：scope 只能是以下值之一：${v}。`],
  [
    "config-rule",
    /^(.+): field (.+?): ((?:unknown comparison rule|date rule|date format|malformed date format) .+)$/s,
    (f, name, e) => `${f}：字段 ${name}：${ruleError(e!) ?? e}`,
  ],
  ["os-error", new RegExp(`^(.+): (${Object.keys(OS_ERRORS).join("|")})$`, "s"), (f, e) => `${f}：${OS_ERRORS[e!]}。`],
];

/** A Python repr() of a string, as a date format is written into a reason. */
const PY_REPR = String.raw`'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*"`;

/** Reasons a rule result gives (evaluator_v2.py), and the reasons of destination-only records. */
const REASONS: readonly Entry[] = [
  ["reason-insufficient", /^insufficient evidence$/, () => "证据不足。"],
  ["reason-invalid-key", /^invalid or duplicate source key$/, () => "来源键为空或重复，无法按键匹配。"],
  ["reason-candidates", /^candidates observed$/, () => "找到了带这个键的目标行。"],
  ["reason-candidate", /^candidate observed$/, () => "找到了一行带这个键的目标数据。"],
  ["reason-duplicate", /^more than one destination row carries this key$/, () => "不止一行目标数据带有这个键。"],
  ["reason-no-candidate", /^no arbitrary candidate selected$/, () => "没有随意挑选其中一行来比较。"],
  ["reason-unique", /^one row in stated complete destination$/, () => "在已声明完整的目标中恰好有一行。"],
  ["reason-missing", /^key not found in stated complete destination$/, () => "在已声明完整的目标中找不到这个键。"],
  ["reason-count-absence", /^destination row count differs from the stated count; absence not established$/, () => "目标行数与声明的总数不符；无法确立缺失。"],
  ["reason-absence", /^destination not stated complete; absence not established$/, () => "没有声明目标完整（或目标中有空键的行）；无法确立缺失。"],
  ["reason-empty", /^empty value; a missing value is not assumed to be a difference$/, () => "值为空；缺少的值不会被当作不同。"],
  ["reason-exact", /^exact string comparison$/, () => "按原样比较字符串。"],
  ["reason-trim-empty", /^empty after trimming whitespace; a missing value is not assumed to be a difference$/, () => "去掉空白后为空；缺少的值不会被当作不同。"],
  ["reason-trim", /^comparison after trimming leading and trailing whitespace$/, () => "去掉首尾空白后比较。"],
  ["reason-casefold", /^comparison after Unicode case folding$/, () => "按 Unicode 规则忽略大小写后比较。"],
  ["reason-no-digits", /^no digits to compare$/, () => "没有可比较的数字。"],
  ["reason-digits", /^comparison of the digits 0-9 only$/, () => "只比较数字 0-9。"],
  ["reason-date-unknown", new RegExp(`^value does not match date format (${PY_REPR})$`, "s"), (f) => `值不符合日期格式 ${f}，无法比较。`],
  ["reason-date", new RegExp(`^date comparison with format (${PY_REPR})$`, "s"), (f) => `按日期格式 ${f} 比较。`],
  ["reason-only-mismatch", /^key not in the source, and the source population is known$/, () => "键不在来源中，而来源总体已知。"],
  ["reason-only-unverified", /^key not in the source; source population unknown, so no conclusion$/, () => "键不在来源中；来源总体未知，所以不下结论。"],
];

const reason = (text: string) => {
  for (const [id, pattern, zh] of REASONS) {
    const m = pattern.exec(text);
    if (m) return { id, zh: zh(...m.slice(1)) };
  }
  return null;
};

/** The lines of the printed summary (cli.summary), and the claim and limitations of a report. */
const SUMMARY: readonly Entry[] = [
  ["claim", /^At this evaluation, under the stated premises, the supplied destination rows satisfy the rules for the supplied source rows\.$/, () => CLAIM_ZH],
  ["limitations", /^Files and completeness statements are not authenticated\. Not assessed: whether a workflow ran, whether the source is true, whether a record existed by a past deadline\.$/, () => LIMITS_ZH],
  ["summary-state", /^(Verified|Mismatch|Unverified|Pending): (\d+) rows of (unknown total|\d+)$/, (s, n, t) => `批次结果：${STATE[s!]}。来源文件有 ${n} 行，${t === "unknown total" ? "总数未知" : `总数 ${t}`}。`],
  ["summary-counts", /^Verified (\d+) · Mismatch (\d+) · Unverified (\d+)$/, (v, m, u) => `各状态的记录数：已验证 ${v} · 不一致 ${m} · 未验证 ${u}。`],
  ["summary-identical", /^Source and destination files were identical \(--allow-identical-content\)\.$/, () => "来源文件和目标文件内容完全相同（已用 --allow-identical-content 允许）。"],
  ["summary-source-count", /^Source count stated (\d+), file has (\d+) rows: the batch cannot be Verified\.$/, (s, o) => `声明的来源总数是 ${s}，文件中有 ${o} 行：这一批不能是已验证。`],
  ["summary-destination-count", /^Destination count stated (\d+), file has (\d+) rows: absence and uniqueness stay unknown\.$/, (s, o) => `声明的目标总数是 ${s}，文件中有 ${o} 行：缺失和唯一性保持未知。`],
  ["summary-population", /^Source population unknown: the batch cannot be Verified\.$/, () => "来源总体未知：这一批不能是已验证。"],
  ["summary-coverage", /^Destination coverage not established: absence and uniqueness stay unknown\.$/, () => "目标覆盖未确立：缺失和唯一性保持未知。"],
  ["summary-only-none", /^Destination-only: 0 records not in the source\.$/, () => "仅在目标中：0 条记录不在来源中。"],
  ["summary-only-mismatch", /^Destination-only: (\d+) records not in the source, each a Mismatch\.$/, (n) => `仅在目标中：${n} 条记录不在来源中，每条都是不一致。`],
  ["summary-only-unverified", /^Destination-only: (\d+) records not in the source, listed without a conclusion\.$/, (n) => `仅在目标中：${n} 条记录不在来源中，只列出，不下结论。`],
  ["summary-record", /^ {2}record (\d+) (.*): (Verified|Mismatch|Unverified)$/s, (n, k, s) => `第 ${n} 条来源记录（${k === "(no key)" ? "没有键" : `键 ${k}`}）：${STATE[s!]}。`],
  ["summary-more", /^\.\.\. (\d+) more records not shown; use --json for all of them\.$/, (n) => `另有 ${n} 条记录没有显示；用 --json 可以得到全部记录。`],
];

/** A rule line of the summary: "    NAME STATUS: REASON", then the values when a value was compared. */
const RULE_LINE = /^ {4}(existence|uniqueness|field:.+?) (pass|fail|unknown): (.+)$/s;

function ruleLine(text: string): Gloss | null {
  const m = RULE_LINE.exec(text);
  if (!m) return null;
  const [, name, status, rest] = m as unknown as [string, string, string, string];
  // The reason ends where the values start, at " (" — try the whole line first, then each " (" from the left.
  const cuts = [rest.length, ...[...rest.matchAll(/ \(/g)].map((c) => c.index)];
  for (const cut of cuts) {
    const r = reason(rest.slice(0, cut));
    if (!r) continue;
    const values = cut < rest.length ? (rest.includes(", compared as (", cut) ? "括号里依次是来源值、目标值，以及按规则比较时的值。" : "括号里依次是来源值和目标值。") : "";
    return { id: `summary-rule:${r.id}`, zh: `规则 ${name} ${STATUS[status]}：${r.zh}${values}` };
  }
  return null;
}

function match(entries: readonly Entry[], text: string): Gloss | null {
  for (const [id, pattern, zh] of entries) {
    const m = pattern.exec(text);
    if (m) return { id, zh: zh(...m.slice(1)) };
  }
  return null;
}

/** The Chinese explanation of a fixed English text the page shows, or null when the table has none. */
export function glossOf(text: string): Gloss | null {
  if (text.startsWith("refused: ")) return match(REFUSALS, text.slice(9));
  const failed = /^failed: (\w+)$/.exec(text);
  if (failed) return { id: "failed", zh: `内部故障（${failed[1]}）：没有得出任何结论。` };
  const rule = ruleError(text);
  if (rule) return { id: "rule-error", zh: rule };
  return reason(text) ?? match(SUMMARY, text) ?? ruleLine(text) ?? match(REFUSALS, text);
}

/** The lines of a printed summary that have an explanation, one per entry: every record line shares one, for example. */
export function summaryGlosses(summary: string): { line: string; zh: string }[] {
  const seen = new Set<string>();
  const out: { line: string; zh: string }[] = [];
  for (const line of summary.split("\n")) {
    if (!line) continue;
    const g = glossOf(line);
    if (!g || seen.has(g.id)) continue;
    seen.add(g.id);
    out.push({ line, zh: g.zh });
  }
  return out;
}
