#!/bin/sh
# Usage: nosyspy.sh CLONE — run bootstrap where /usr/bin/python3 cannot execute (and siblings unreadable).
cd "$1" && sandbox-exec -p '(version 1)(allow default)(deny file-read* file-write* (subpath "/Users/zhangshenghe/Documents"))(deny process-exec (literal "/usr/bin/python3"))' scripts/dev/bootstrap.sh > "$1/.nosyspy.out" 2>&1; rc=$?
grep -E "^== |FAILED|^  [a-z]" "$1/.nosyspy.out" | grep -v '"' ; echo "bootstrap exit=$rc"
