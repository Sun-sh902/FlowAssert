"""Compare the reports the Action wrote with a golden case's, apart from evaluated_at. Used by the Action self-test.

    python scripts/dev/check_action_report.py offline/golden/CASE REPORT.json REPORT.html

The golden reports were written by flowassert-verify on macOS. The checker opens its reports in text mode, so on
Windows each line break is written as CR LF; the expected bytes follow the platform the same way. Exit 0 when both
match, 1 with the first difference otherwise. Standard library only.
"""
import os
from pathlib import Path
import re
import sys


def without_time(text):
    text = re.sub(r'"evaluated_at": "[^"]*"', '"evaluated_at": ""', text)
    return re.sub(r"<p>Evaluated at [^ ]* by", "<p>Evaluated at by", text)


def main(argv):
    if len(argv) != 3:
        print(__doc__, file=sys.stderr)
        return 2
    folder, reports = Path(argv[0]), {"json": Path(argv[1]), "html": Path(argv[2])}
    problems = 0
    for kind, path in reports.items():
        expected = (folder / f"report.{kind}").read_bytes().decode("utf-8").replace("\n", os.linesep)
        actual = path.read_bytes().decode("utf-8")
        if without_time(actual) == without_time(expected):
            print(f"{path}: same as {folder.name}/report.{kind}, apart from evaluated_at")
            continue
        problems += 1
        a, e = without_time(actual), without_time(expected)
        at = next((i for i, (x, y) in enumerate(zip(a, e)) if x != y), min(len(a), len(e)))
        print(f"{path}: differs from {folder.name}/report.{kind} at character {at}: "
              f"{a[max(0, at - 40):at + 40]!r} vs {e[max(0, at - 40):at + 40]!r}")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
