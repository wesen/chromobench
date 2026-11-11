import re, sys
p = sys.argv[1]; textbook_lines = set(int(x) for x in sys.argv[2].split(','))
out = []
for i, line in enumerate(open(p).read().split('\n'), start=1):
    def fix(m):
        pre = line[max(0, m.start()-14):m.start()]
        if re.search(r"(textbook|textbook's|architecture|report|document|md`|chromogen-studio\.md`)\s*$", pre) or re.search(r"\), $", pre) or re.search(r"§[0-9.–]+, $", pre) or re.search(r"\d\), $", pre):
            return m.group(0)
        return ('textbook §' if i in textbook_lines else 'section ')
    line2 = re.sub(r'§', fix, line)
    out.append(line2)
open(p, 'w').write('\n'.join(out))
