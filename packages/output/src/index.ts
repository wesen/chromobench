// @chromobench/output (CHB-011): encoders, sinks, output spaces and ICC profiles, lcms, the display
// canvas and the tiled export runner. The f64 output maths (spaces, renderings, knees) lives in
// @chromobench/core (print/colour.ts, print/gamut.ts) and the WGSL in packages/gpu (decision D1).
export { crc32, crcFinish, crcUpdate } from './encode/crc32.ts';
export { concat, deflateAll, DeflateStream, inflateAll } from './encode/deflate.ts';
export { pngText, SOFTWARE, tiffDescription, type FileMeta } from './encode/metadata.ts';
export { Png16Writer, PNG_SIGNATURE, pngChunk, pngChunks, ppmFromDpi, type PngColour, type PngOptions } from './encode/png16.ts';
export { ditherTo8, toU16 } from './encode/quantise.ts';
export { fdct8x8, iccSegments, ICC_CHUNK, JpegWriter, quantTable, ZIGZAG, type JpegOptions } from './encode/jpeg.ts';
export {
  CountingSink, MemorySink, opfsRoot, opfsSink, pickerAvailable, pickerSink,
  type ByteSink, type DirHandleLike, type FileHandleLike, type FileSink,
} from './encode/sinks.ts';
export { Tiff16Writer, tiffDateTime, tiffTags, type TiffOptions } from './encode/tiff16.ts';
export { unzip, zip } from './encode/zip.ts';
export { ProfileLibrary, validatePrinterProfile, type PrinterProfileEntry } from './icc/library.ts';
export { createLcms, lcmsInWorker, PIXEL_TYPE, type Intent, type Lcms, type PixelFormat, type ProfileHandle, type TransformHandle } from './icc/lcms/api.ts';
export { curveDecode, curveEncode, matrixTrc, parseIcc, type Curve, type IccHeader, type IccProfile, type MatrixTrc } from './icc/parse.ts';
export { base64Bytes, bundledProfile, getSpace, loadSpaces, pngColour, SPACE_IDS, type OutputSpace } from './spaces.ts';
export { configureCanvas, displaySpace, P3_QUERY, type CanvasConfig, type CanvasOptions, type CanvasSpace } from './display/canvas.ts';
export { documentPayload, documentSha256, exportFrame, exportNode, sidecarName, type EncodedFile, type ExportProgress, type ExportRequest } from './export/run.ts';
