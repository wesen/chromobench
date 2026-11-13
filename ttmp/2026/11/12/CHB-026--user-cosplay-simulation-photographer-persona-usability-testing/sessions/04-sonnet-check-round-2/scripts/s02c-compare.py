import sys, numpy as np
sys.path.insert(0,'.')
from nlp import load
from PIL import Image
SH='../shots/'; S='/home/manuel/code/wesen/chromobench/.playwright-mcp/scans/2025-08-09_'
def pic(path):
    im=np.asarray(Image.open(path).convert('RGB')).astype(int)[138:728,240:1135]
    d=np.abs(im-np.array([153,153,153])).max(axis=2)>8
    # take columns/rows with substantial picture content
    cols=np.where(d[40:560].mean(axis=0)>0.6)[0]; rows=np.where(d[:, cols.min():cols.max()].mean(axis=1)>0.6)[0]
    x0,x1,y0,y1=cols.min()+4,cols.max()-4,rows.min()+2,rows.max()-2
    return Image.fromarray(im[y0:y1,x0:x1].astype('uint8'))
def stats(im):
    a=np.asarray(im.convert('RGB')).astype(float); m=a.reshape(-1,3).mean(0); L=a@[.299,.587,.114]
    mx=a.max(2); mn=a.min(2); sat=((mx-mn)/np.maximum(mx,1)).mean()
    return dict(luma=round(float(m@[.299,.587,.114]),1), BoverR=round(float(m[2]/m[0]),3), sat=round(float(sat),3), p5=round(float(np.percentile(L,5)),1), p95=round(float(np.percentile(L,95)),1), size=im.size)
cases=[('raw000','10-raw000-f3.png',None),('raw000','10-raw000-f2.png','x'),('raw004','12-raw004-f3.png','x'),('raw007','32-raw007-f2-rotLeft.png','x'),('raw013','33-raw013-f2-rotLeft.png','x')]
for n,f,go in cases:
    if go is None: continue
    a=pic(SH+f); b,_=load(S+n+'-positive.tif')
    print(n, 'app', stats(a)); print(n, 'NLP', stats(b), 'app aspect', round(a.width/a.height,2), 'nlp aspect', round(b.width/b.height,2))
    h=500; A=a.resize((round(a.width*h/a.height),h)); B=b.resize((round(b.width*h/b.height),h))
    c=Image.new('RGB',(A.width+B.width+10,h),(60,60,60)); c.paste(A,(0,0)); c.paste(B,(A.width+10,0)); c.save(f'{SH}50-side-by-side-{n}-app-left-NLP-right.png')
