-- (a) empty assistant turns (no output tokens) and how long each took: provider stalls
-- (b) tool calls that ran longer than 30 s
WITH t AS (
  SELECT session_id, turn_index, role, timestamp, output_tokens, framework_metadata_json AS meta,
         (julianday(timestamp) - julianday(LAG(timestamp) OVER (PARTITION BY session_id ORDER BY turn_index))) * 86400.0 AS gap_s
  FROM turns)
SELECT 'stall' AS kind, replace(substr(s.working_directory, instr(s.working_directory, 'pattern-runs/') + 13), '/', ' ') AS run,
       t.turn_index AS at, round(t.gap_s / 60.0, 2) AS minutes, substr(t.meta, 1, 120) AS detail
FROM t JOIN sessions s USING (session_id) WHERE t.role = 'assistant' AND t.output_tokens IS NULL
UNION ALL
SELECT 'slow tool', replace(substr(s.working_directory, instr(s.working_directory, 'pattern-runs/') + 13), '/', ' '),
       tc.emitting_turn_index, round(tc.duration_ms / 60000.0, 2),
       substr(replace(coalesce(nullif(tc.command, ''), tc.file_path, ''), char(10), ' '), -120)
FROM tool_calls tc JOIN sessions s USING (session_id) WHERE tc.duration_ms > 30000
ORDER BY kind, run, at;
