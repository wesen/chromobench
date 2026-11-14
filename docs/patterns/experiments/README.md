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

1. `python3 -I score.py <runs-root> <hidden-dir> <eval-dir> results.json`: hidden tests per run in an isolated copy
   (`<eval-dir>/<task>-<variant>-<n>/`), the agent's own tests re-run (files listed explicitly: Node 24 reads
   `node --test project/test/` as one module path, so the command in the run prompt failed and some agents added a
   `test/index.js`), diary steps, source lines.
2. `python3 -I analyze.py <runs-root> <trace-dir> <out-dir>`: converts each finished run's pi session with
   `go-minitrace convert pi` (once), then runs `analysis/*.sql` over all archives (passed one by one: go-minitrace
   globs have no `**`) into `<out-dir>/<name>.json|txt`. pi records no exit codes, so `02-behaviour.sql` reads test
   failures from the output text.
3. Read diaries and self-reports: chapter parts used, unclear, deviations.
4. Blind design review per task (Alexander / Gabriel / Fowler rubric in the playbook, §6): `python3 -I
   review-design.py <task> <runs-root> <review-dir> <seed>` builds a blinded workspace and the reviewer prompt; an
   Opus subagent (Claude Code Agent tool, model opus) runs the review from that prompt and its JSON is saved as
   `<review-dir>/<task>-r<seed>.answer.json` (`--run-pi` runs a pi reviewer instead). The reviewer sees CHAPTER.md as
   the yardstick, TASK.md, FACTS.md (sizes) and the six implementations' `src/` and `test/` as impl-A … impl-F,
   shuffled by the seed, with "chapter" and the pattern names redacted to "[ref]"; no diary, notes or self-report. The
   key (letter → run, redaction counts) goes to `<review-dir>/keys/`, outside the workspace. Two change requests per
   task drive the piecemeal-growth lens; the reviewer guesses which runs had the chapter only after scoring.
5. Revise the chapters; keep old versions; rerun the same tasks on the new versions.
