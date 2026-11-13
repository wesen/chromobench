import sys, io
from PIL import Image, ImageCms
def load(path):
    im = Image.open(path); prof = im.info.get('icc_profile')
    im = im.convert('RGB')
    if prof:
        src = ImageCms.ImageCmsProfile(io.BytesIO(prof)); dst = ImageCms.createProfile('sRGB')
        im = ImageCms.profileToProfile(im, src, dst, renderingIntent=0, outputMode='RGB')
    return im, bool(prof)
if __name__ == '__main__':
    im, p = load(sys.argv[1]); print(im.size, 'icc', p, im.mode)
    im.save(sys.argv[2])
