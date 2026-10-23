import json, sys, collections
# For each capture owner (test), find responses that arrived after that owner's last settle(), and the gap to page close.
for path in sys.argv[1:]:
    rows = [json.loads(l) for l in open(path)]
    by = collections.defaultdict(list)
    for r in rows: by[r["owner"]].append(r)
    late = []
    for owner, rs in by.items():
        settles = [r for r in rs if r["ev"] == "settle"]
        if not settles: continue
        last = settles[-1]["t"]; n = len(settles)
        close = next((r["t"] for r in rs if r["ev"] == "page-close"), None)
        for r in rs:
            if r["ev"] == "response" and r["afterSettles"] == n:
                late.append((owner[:70], r["url"].split("/api/")[1][:60], r["t"] - last, None if close is None else close - r["t"]))
        fails = [r for r in rs if r["ev"] == "HEADERS-FAILED"]
        for f in fails: late.append(("  FAILED " + owner[:62], f["url"].split("/api/")[1][:60], "", ""))
    print(path.split("/")[-1], "late responses after final settle:", len(late))
    for l in late: print("   ", l)
