import json,sys,collections
d=json.load(open(sys.argv[1]))
print({k:d[k] for k in ['numTotalTests','numPassedTests','numFailedTests','numPendingTests','numTotalTestSuites']})
for f in sorted(d['testResults'],key=lambda f:f['name']):
    st=collections.Counter(a['status'] for a in f['assertionResults'])
    if set(st)-{'passed'} or f['status']!='passed':
        print(f"  {f['name'].split('/src/test/')[-1]:40s} {f['status']:7s} {dict(st)} {(f.get('message') or '')[:110]}")
