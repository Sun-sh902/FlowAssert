"""Test-only socket audit around an unchanged local entry point."""
import atexit
import ipaddress
import json
import os
from pathlib import Path
import runpy
import sys
root=Path(__file__).resolve().parents[1]
sys.path.insert(0, str(root))
target=(root/sys.argv.pop(1)).resolve()
assert target in (root/'run_history.py',root/'archive_cli.py')
observed=[]
def audit(event,args):
    if event=='socket.connect':
        address=args[1]
        if isinstance(address,tuple):
            host=address[0]
            permitted=host in ('localhost','127.0.0.1','::1')
            observed.append({'event':event,'host':host,'port':address[1],'permitted':permitted})
            if not permitted:raise RuntimeError('external network prohibited by test guard')
sys.addaudithook(audit)
@atexit.register
def save():
    path=Path(os.environ['FLOWASSERT_NETWORK_AUDIT'])
    assert path.resolve().is_relative_to(root)
    path.write_text(json.dumps({'connects':observed,'unauthorized':[x for x in observed if not x['permitted']]},indent=2))
sys.argv[0]=str(target)
runpy.run_path(str(target),run_name='__main__')
