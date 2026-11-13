// CHB-033 step 3: render NEFs through Camera Raw (Adobe Standard, every adjustment zeroed by the XMP sidecar) as
// TIFFs. Run on the Mac: open -a "Adobe Photoshop 2025" ~/chromobench-tools/acr/render.jsx (AppleScript "do javascript"
// fails in Photoshop 2025 with 8800, even for "app.version"); the log goes to render.log beside it
var dir = new Folder("~/chromobench-tools/acr");
var names = ["DSC_8559", "DSC_8541", "DSC_8536", "DSC_8655"];
var log = [];
app.displayDialogs = DialogModes.NO;
for (var i = 0; i < names.length; i++) {
  try {
    // CameraRAWOpenOptions fails in Photoshop 2025 (8800 "may not be available in this version"): a plain open uses
    // the XMP sidecar's settings and Camera Raw's workflow colour space and depth, which the log records
    var doc = app.open(new File(dir + "/" + names[i] + ".NEF"));
    var t = new TiffSaveOptions(); t.embedColorProfile = true; t.imageCompression = TIFFEncoding.NONE;
    doc.saveAs(new File(dir + "/" + names[i] + "-acr.tif"), t, true);
    log.push(names[i] + " " + doc.width + "x" + doc.height + " " + doc.bitsPerChannel + " " + doc.colorProfileName);
    doc.close(SaveOptions.DONOTSAVECHANGES);
  } catch (e) { log.push(names[i] + " ERROR " + e); }
}
var lf = new File(dir + "/render.log"); lf.open("w"); lf.write(log.join("\n") + "\n"); lf.close();
