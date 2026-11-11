import numpy as np, math
def xyz_from_xy(x,y): return np.array([x/y,1,(1-x-y)/y])
def rgb2xyz(prim, white):
    P = np.array([xyz_from_xy(*p) for p in prim]).T
    S = np.linalg.solve(P, white)
    return P*S
D65 = np.array([0.95047,1,1.08883]); D50=np.array([0.96422,1,0.82521])
B = np.array([[0.8951,0.2664,-0.1614],[-0.7502,1.7135,0.0367],[0.0389,-0.0685,1.0296]])
def brad(src,dst):
    s=B@src; d=B@dst; return np.linalg.inv(B)@np.diag(d/s)@B
spaces = {
 'sRGB': ([(0.64,0.33),(0.30,0.60),(0.15,0.06)], D65),
 'DisplayP3': ([(0.680,0.320),(0.265,0.690),(0.150,0.060)], D65),
 'Rec2020': ([(0.708,0.292),(0.170,0.797),(0.131,0.046)], D65),
 'AdobeRGB': ([(0.64,0.33),(0.21,0.71),(0.15,0.06)], D65),
 'ProPhoto': ([(0.7347,0.2653),(0.1596,0.8404),(0.0366,0.0001)], D50),
}
srgb_enc = lambda v: 12.92*v if v<=0.0031308 else 1.055*v**(1/2.4)-0.055
enc = {'sRGB':srgb_enc,'DisplayP3':srgb_enc,
 'Rec2020': lambda v: 4.5*v if v<0.018053968510807 else 1.09929682680944*v**0.45-0.09929682680944,
 'AdobeRGB': lambda v: max(v,0)**(256/563),
 'ProPhoto': lambda v: 16*v if v<1/512 else v**(1/1.8)}
grey = np.array([0.1664,0.1754,0.2131])
for name,(prim,w) in spaces.items():
    M = rgb2xyz(prim,w); Mi=np.linalg.inv(M)
    X = grey if w is D65 else brad(D65,D50)@grey
    lin = Mi@X
    e = [enc[name](v) for v in lin]
    print(name, 'lin', np.round(lin,4), 'enc', np.round(e,4), '16bit', [round(v*65535) for v in e], '8bit',[round(v*255) for v in e])
print('P3 matrix XYZ->P3', np.round(np.linalg.inv(rgb2xyz(*spaces['DisplayP3'])),7))
# paper white
for Y in [0.813, 0.813+0.0048*0.813]:
    print('paper white Y',Y,'sRGB enc',srgb_enc(Y), round(srgb_enc(Y)*255), round(srgb_enc(Y)*65535))
print('tanh shoulder 1.0 ->', 0.82+0.18*math.tanh(1), srgb_enc(0.82+0.18*math.tanh(1))*255)
knee=lambda d,t=0,l=1,p=6: t+(l-t)*((d-t)/(l-t))/(1+((d-t)/(l-t))**p)**(1/p)
print([round(knee(d),4) for d in (0.5,0.8,1,2)])
print('lightness knee (0.7,1,2.2) at 1.0:', knee(1,0.7,1,2.2), 'at 0.9', knee(0.9,0.7,1,2.2))
# grey card scan-of-print
g2 = grey/0.813
lin = np.linalg.inv(rgb2xyz(*spaces['sRGB']))@g2
print('scan-of-print grey sRGB enc',[round(srgb_enc(v),4) for v in lin],[round(srgb_enc(v)*255) for v in lin])
# 100MP numbers
W,H=11600,8700; n=W*H; print(n, n*16/2**30,'GiB rgba32f', n*8/2**20,'MiB rgba16', n*6/1e6,'MB rgb16')
for T,h in [(256,8),(1024,8),(1024,64),(2048,64)]: print(T,h,((T+2*h)/T)**2-1)
print('tiles 1024:', math.ceil(W/1024)*math.ceil(H/1024))
print('halation px at 5.8um', [65*math.sqrt(k)/5.8 for k in (1,2,3)])
