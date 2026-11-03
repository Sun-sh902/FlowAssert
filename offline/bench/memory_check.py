#!/usr/bin/env python3
"""Peak memory check for the offline CSV checker.

Generates two synthetic CSV files of 1,000,000 rows each (three columns, about
44 MB each) in a temporary folder, runs the checker on them in a child process
with a JSON report, and prints the elapsed time and the child's peak memory.
Exits non-zero if the peak is 500 MB or more, or if the checker's result is not
the one the synthetic data was built to give.

    python3 offline/bench/memory_check.py
"""
import os
import resource
import subprocess
import sys
import tempfile
import time

ROWS = 1_000_000
LIMIT_MB = 500
VERIFY = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "verify.py")
# Rows whose destination phone differs, so the run has to report a few Mismatch records.
DIFFERENT = {17, 500_000, 999_999}


def write_files(folder):
    source = os.path.join(folder, "source.csv")
    destination = os.path.join(folder, "destination.csv")
    with open(source, "w", encoding="utf-8", newline="") as s, \
            open(destination, "w", encoding="utf-8", newline="") as d:
        s.write("id,phone,email\n")
        d.write("id,phone,email\n")
        for i in range(ROWS):
            s.write(f"SYN-{i:07d},+1 555 {i:07d},u{i:07d}@ex.test\n")
            phone = f"+1 555 {i:07d}" if i not in DIFFERENT else "+1 555 0000000x"
            d.write(f"SYN-{i:07d},{phone},u{i:07d}@ex.test\n")
    return source, destination


def peak_child_mb():
    peak = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
    # ru_maxrss is in bytes on macOS and in kilobytes on Linux.
    return peak / 1_000_000 if sys.platform == "darwin" else peak * 1024 / 1_000_000


def main():
    with tempfile.TemporaryDirectory(prefix="flowassert-bench-") as folder:
        source, destination = write_files(folder)
        sizes = [os.path.getsize(p) / 1_000_000 for p in (source, destination)]
        report = os.path.join(folder, "report.json")
        command = [sys.executable, VERIFY, "--source", source, "--destination", destination,
                   "--key", "id", "--field", "phone", "--field", "email",
                   "--source-complete", "--destination-complete", "--max-details", "0", "--json", report]
        started = time.monotonic()
        child = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, universal_newlines=True)
        elapsed = time.monotonic() - started
        peak = peak_child_mb()
        report_mb = os.path.getsize(report) / 1_000_000 if os.path.exists(report) else 0
    print(f"Python {sys.version.split()[0]} on {sys.platform}")
    print(f"Input: 2 files of {ROWS:,} rows, {sizes[0]:.1f} MB and {sizes[1]:.1f} MB")
    print(f"Checker exit status {child.returncode}; report {report_mb:.1f} MB")
    print(f"Elapsed: {elapsed:.1f} s")
    print(f"Peak memory: {peak:.0f} MB (limit: under {LIMIT_MB} MB)")
    first_line = child.stdout.splitlines()[:2]
    expected = [f"Mismatch: {ROWS} rows of {ROWS}", f"Verified {ROWS - len(DIFFERENT)} · Mismatch {len(DIFFERENT)} · Unverified 0"]
    if child.returncode != 1 or first_line != expected:
        print("FAIL: unexpected checker result", file=sys.stderr)
        print(child.stdout[:2000] + child.stderr[:2000], file=sys.stderr)
        return 1
    if peak >= LIMIT_MB:
        print(f"FAIL: peak memory {peak:.0f} MB is not under {LIMIT_MB} MB", file=sys.stderr)
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    sys.exit(main())
