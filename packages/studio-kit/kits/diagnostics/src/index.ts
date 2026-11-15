// @chromobench/studio-kit/kits/diagnostics — the diagnostics journal's panel and problem reports (CHB-038).
// Headless; renderers and dialog bodies are ./dom.ts.
export { createDiagnosticsKit, diagnosticsOf, type DiagnosticsKit, type DiagnosticsService } from './kit.ts';
export {
  ALWAYS, CHOICES, readReport, readmeText, REPORT_FORMAT, REPORT_VERSION, reportFiles, reportName, sizeText, summaryText,
  type ManifestFrame, type Report, type ReportFrameRead, type ReportEntry, type ReportFrame, type ReportInput, type ReportManifest, type ReportPart,
} from './report.ts';
export { keepJournal, JOURNAL_KEY, type KeptJournal } from './persist.ts';
