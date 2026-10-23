"""Usage: SERVICE_DIR/.venv/bin/python -I -B symlink.py SERVICE_DIR WORKDIR
Builds a disposable parent holding every protected root named in protected-before.json, then checks whether
snapshot() notices adding, retargeting and removing a DIRECTORY symlink. Exit 0 = detected, 1 = blind."""
import json, os, sys, shutil
svc, work = sys.argv[1], sys.argv[2]
shutil.rmtree(work, ignore_errors=True)
parent = os.path.join(work, 'parent'); os.makedirs(os.path.join(work, 'A', 'sub')); os.makedirs(os.path.join(work, 'B'))
open(os.path.join(work, 'A', 'sub', 'f'), 'w').write('a'); open(os.path.join(work, 'B', 'g'), 'w').write('b')
names = list(json.load(open(os.path.join(svc, 'evidence/protected-before.json'))))
for n in names:
    os.makedirs(os.path.join(parent, n)); open(os.path.join(parent, n, 'file.txt'), 'w').write('x')
os.environ['FLOWASSERT_PROTECTED_PARENT'] = parent
sys.path.insert(0, svc)
from scripts.protected_integrity import snapshot
root = os.path.join(parent, names[0]); link = os.path.join(root, 'linkdir')
files = lambda: snapshot()[names[0]]['files']
s0 = files(); os.symlink(os.path.join(work, 'A'), link); s1 = files()
os.remove(link); os.symlink(os.path.join(work, 'B'), link); s2 = files(); os.remove(link); s3 = files()
r = {'added': s0 != s1, 'retargeted': s1 != s2, 'removed': s2 != s3, 'real_dirs_unchanged': s0 == s3, 'with_link': s1}
print(json.dumps(r)); sys.exit(0 if r['added'] and r['retargeted'] and r['removed'] and r['real_dirs_unchanged'] else 1)
