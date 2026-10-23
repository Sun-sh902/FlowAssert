#!/bin/sh
# Sandbox: deny every read/write under ~/Documents (historical roots and the dev workspace). Last matching rule wins.
exec sandbox-exec -p '(version 1)(allow default)(deny file-read* file-write* (subpath "/Users/zhangshenghe/Documents"))(allow file-read-metadata (literal "/Users/zhangshenghe/Documents"))' "$@"
