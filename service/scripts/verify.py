"""Save real process commands, streams and exits; never mask child failures."""
import json
import os
from pathlib import Path
import subprocess
import sys
from datetime import datetime,timezone
root=Path(__file__).resolve().parents[1]
label=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
base=root/'evidence'/('tests-'+label)
args=[sys.executable,'-B','-m','pytest','-q','-p','no:cacheprovider','--junitxml='+str(base)+'.xml']
env={**os.environ,'PYTHONDONTWRITEBYTECODE':'1'}
p=subprocess.Popen(args,cwd=root,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
out,err=p.communicate()
base.with_suffix('.stdout.log').write_text(out);base.with_suffix('.stderr.log').write_text(err)
base.with_suffix('.command.json').write_text(json.dumps({'argv':args,'cwd':str(root),'pid':p.pid,'exit_code':p.returncode,'stdout':base.with_suffix('.stdout.log').name,'stderr':base.with_suffix('.stderr.log').name},indent=2))
print(out);print(err,file=sys.stderr);sys.exit(p.returncode)
