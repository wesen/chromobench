import json, sys, re, html
d = json.load(open(sys.argv[1]))
for ch in d['chapters']:
    print("=== CH", ch['n'], ch['title'], len(ch.get('html','')))
n = int(sys.argv[2])
ch = [c for c in d['chapters'] if c['n']==n][0]
h = ch['html']
h = re.sub(r'<script.*?</script>', '', h, flags=re.S)
h = re.sub(r'<(h[1-4])[^>]*>', r'\n\n## ', h)
h = re.sub(r'<(p|li|tr|pre)[^>]*>', '\n', h)
h = re.sub(r'<annotation[^>]*>.*?</annotation>', '', h, flags=re.S)
h = re.sub(r'<[^>]+>', '', h)
print(html.unescape(h))
