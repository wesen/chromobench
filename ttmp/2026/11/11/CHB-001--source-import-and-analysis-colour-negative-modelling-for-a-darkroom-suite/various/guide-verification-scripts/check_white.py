import json, math, sys
top = json.load(open(sys.argv[1]))
wl = top['wl']; cmf = top['cmf']
def g(x, mu, s1, s2): return math.exp(-0.5*((x-mu)/(s1 if x<mu else s2))**2)
fit = [[1.056*g(w,599.8,37.9,31)+0.362*g(w,442,16,26.7)-0.065*g(w,501.1,20.4,26.2),
        0.821*g(w,568.8,46.9,40.5)+0.286*g(w,530.9,16.3,31.1),
        1.217*g(w,437,11.8,36)+0.681*g(w,459,26,13.8)] for w in wl]
def bb(T):
    c1=3741771852e-25; c2=0.01438776877
    p=lambda w: c1/(w*1e-9)**5/(math.exp(c2/(w*1e-9*T))-1)
    return [p(w)/p(560) for w in wl]
def white(C, S):
    X=sum(s*c[0] for s,c in zip(S,C)); Y=sum(s*c[1] for s,c in zip(S,C)); Z=sum(s*c[2] for s,c in zip(S,C))
    return [X/Y,1,Z/Y]
S=bb(5000)
wf=white(fit,S); wt=white(cmf,S)
print('5000K white fitted', wf, 'tabulated', wt)
BR=[[0.8951,0.2664,-0.1614],[-0.7502,1.7135,0.0367],[0.0389,-0.0685,1.0296]]
BRI=[[0.9869929,-0.1470543,0.1599627],[0.4323053,0.5183603,0.0492912],[-85287e-7,0.0400428,0.9684867]]
X2S=[[3.2404542,-1.5371385,-0.4985314],[-0.969266,1.8760108,0.041556],[0.0556434,-0.2040259,1.0572252]]
mv=lambda M,v:[sum(M[i][j]*v[j] for j in range(3)) for i in range(3)]
D65=[0.95047,1,1.08883]
def adapt(X, frm, to=D65):
    s=mv(BR,frm); d=mv(BR,to); c=mv(BR,X)
    return mv(BRI,[c[i]*d[i]/s[i] for i in range(3)])
enc=lambda v: 12.92*v if v<=0.0031308 else 1.055*v**(1/2.4)-0.055
for name,w in [('fitted',wf),('tab',wt)]:
    a=adapt([0.1706,0.1750,0.1686], w)
    lin=mv(X2S,a); e=[enc(max(0,min(1,v))) for v in lin]
    print(name, 'adapted', [round(v,4) for v in a], 'lin', [round(v,4) for v in lin], 'enc', [round(v,4) for v in e], '#'+''.join('%02x'%round(v*255) for v in e))
# sum ybar check
print('sum ybar tabulated', sum(c[1] for c in cmf), 'fitted', sum(c[1] for c in fit))
