"""Read-only custody snapshot of protected roots: relative path -> sha256 (or link target). Usage: custody.py OUT.json"""
import hashlib,json,os,sys,stat
D='/Users/zhangshenghe/Documents'
ROOTS=['FlowAssert-Phase3A-UI','FlowAssert-Phase3A-Service','FlowAssert-Phase3A-Review/PHASE3A_FINAL_OWNER_ACCEPTANCE','FlowAssert-round03-oracle-fix','FlowAssert-Phase3B-Planning-Review/PHASE3BP_FINAL_OWNER_ACCEPTANCE','FlowAssert-Phase3B-Planning']
out={}
for r in ROOTS:
  base=os.path.join(D,r);m={}
  for dp,dn,fn in os.walk(base):
    for n in fn:
      p=os.path.join(dp,n);rel=os.path.relpath(p,base)
      try:
        st=os.lstat(p)
        if stat.S_ISLNK(st.st_mode): m[rel]='link:'+os.readlink(p)
        elif stat.S_ISREG(st.st_mode):
          h=hashlib.sha256()
          with open(p,'rb') as f:
            for c in iter(lambda:f.read(1<<20),b''): h.update(c)
          m[rel]=h.hexdigest()+':'+str(st.st_mtime_ns)
        else: m[rel]='special:'+oct(st.st_mode)
      except OSError as e: m[rel]='unreadable:'+type(e).__name__
  out[r]={'count':len(m),'map_sha256':hashlib.sha256(json.dumps(m,sort_keys=True).encode()).hexdigest(),'files':m}
json.dump(out,open(sys.argv[1],'w'))
print({r:(v['count'],v['map_sha256'][:16]) for r,v in out.items()})
