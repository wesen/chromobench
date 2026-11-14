# Construction experiments for the pattern language

Method: `go-go-parc/Research/playbooks/pattern-extraction-with-agent-validation.md` (sections 5–7).

## Design (launched 2026-11-14 17:48)

- Tasks: `tasks/graph` (ch. 1), `tasks/slots` (ch. 4), `tasks/tiling` (ch. 8), `tasks/document` (ch. 9).
- Per task: 4 runs with the chapter (`chapter-1..4`), 2 without (`control-1..2`); 24 runs, DeepSeek 4.1 flash
  (`lunaroute/deepseek-4.1-flash`, thinking high), 8 in parallel: `python3 -I batch.py <runs-root> 8`.
- Each run: `<runs-root>/<task>/<variant>-<n>/` with TASK.md, DIARY-SKILL.md, CHAPTER.md (chapter runs), project/
  (code, tests, DIARY.md, NOTES.md), prompt.md, session/ (native pi JSONL), events.jsonl, answer.json (self-report).
- Hidden acceptance tests (61: graph 19, slots 17, tiling 9, document 16) are kept outside the run directories until
  scoring; they are added to `hidden/` here afterwards. The wide-blur tolerance was checked feasible first
  (field approach: max 0.016–0.024, mean 0.003–0.006), and the requirement set to max 0.025, mean 0.005 at a
  128 × 128 budget.

## After the batch

0. Retry failures: runs that end with `rc=1 … no answer found` in `batch.log` (seen: provider error
   `upstream_stream_failed` after ~98 s, e.g. graph/control-1, slots/control-1). Delete those run directories (they
   may hold partial projects), then run `batch.py` again; it skips runs that have `answer.json`.

1. `python3 -I score.py <runs-root> <hidden-dir> results.json` (hidden tests per run, own tests re-run, diary steps).
2. go-minitrace: `go-minitrace convert pi --source-dir <run>/session --output-dir analysis/archives/<task>-<variant>-<n>`
   for each run, then `go-minitrace query run --archive-glob 'analysis/archives/*/*.minitrace.json' --sql-file
   analysis/02-behaviour.sql` (and 01, 03).
3. Read diaries and self-reports: chapter parts used, unclear, deviations.
4. Blind design review per task (Alexander / Gabriel / Fowler rubric in the playbook, §6): one reviewer per task sees
   the chapter and the six anonymised implementations.
5. Revise the chapters; keep old versions; rerun the same tasks on the new versions.
