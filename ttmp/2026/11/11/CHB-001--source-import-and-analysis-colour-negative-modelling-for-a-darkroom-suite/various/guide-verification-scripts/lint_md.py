import re,sys
for p in sys.argv[1:]:
    inb=False; n=0
    for i,l in enumerate(open(p,encoding='utf-8'),1):
        if l.startswith('```'):
            if not inb and l.strip()=='```': print(p,i,'untagged fence')
            inb=not inb; n+=1; continue
        if inb: continue
        t=re.sub(r'`[^`]*`','',l)
        if re.search(r'<[A-Za-z/!][^>]*>',t): print(p,i,'possible raw html:',t.strip()[:100])
    print(p,'fences',n,'balanced' if n%2==0 else 'UNBALANCED')
