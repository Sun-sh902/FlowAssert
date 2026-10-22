"""Record exact commands/streams/exits for current source, with local caches."""
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'docs/phase3a/evidence'

def run(argv,label,extra=None):
    env={**os.environ,'LC_ALL':'C','PYTHONDONTWRITEBYTECODE':'1','TMPDIR':str(ROOT/'.runtime/tmp'),
         'PYTHONPYCACHEPREFIX':str(ROOT/'.runtime/cache'),**(extra or {})}
    start=datetime.now(timezone.utc).isoformat()
    with (OUT/(label+'.stdout.log')).open('wb') as stdout,(OUT/(label+'.stderr.log')).open('wb') as stderr:
        p=subprocess.Popen(argv,cwd=ROOT,env=env,stdout=stdout,stderr=stderr)
        pid=p.pid;rc=p.wait()
    receipt={'argv':argv,'cwd':str(ROOT.resolve()),'pid':pid,'start':start,'end':datetime.now(timezone.utc).isoformat(),'exit':rc,
             'stdout_sha256':hashlib.sha256((OUT/(label+'.stdout.log')).read_bytes()).hexdigest(),
             'stderr_sha256':hashlib.sha256((OUT/(label+'.stderr.log')).read_bytes()).hexdigest()}
    (OUT/(label+'.command.json')).write_text(json.dumps(receipt,indent=2))
    print(json.dumps(receipt),flush=True)
    return rc

if __name__=='__main__':
    label=sys.argv[1]
    argv=[str(ROOT/'.venv/bin/python'),'-B','-m','pytest','-p','no:cacheprovider',
          '--basetemp='+str(ROOT/'.runtime/tmp'/label),'--junitxml='+str(OUT/(label+'.xml')),*sys.argv[2:]]
    sys.exit(run(argv,label))
