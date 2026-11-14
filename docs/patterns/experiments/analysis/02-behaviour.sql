-- per run: how the agent worked (chapter reads, test runs and failures, diary writes, boundary crossings)
WITH c AS (
  SELECT session_id, tool_name, operation_type, emitting_turn_index AS t, exit_code,
         coalesce(file_path, '') AS fp,
         coalesce(nullif(command, ''), json_extract(arguments_json, '$.command'), '') AS cmd
  FROM tool_calls)
SELECT s.session_id,
       replace(substr(s.working_directory, instr(s.working_directory, 'pattern-runs/') + 13), '/', ' ') AS run,
       SUM(fp LIKE '%CHAPTER.md' OR cmd LIKE '%CHAPTER.md%') AS chapter_reads,
       MIN(CASE WHEN fp LIKE '%CHAPTER.md' OR cmd LIKE '%CHAPTER.md%' THEN t END) AS first_chapter_turn,
       MIN(CASE WHEN fp LIKE '%src/index.ts' AND operation_type IN ('NEW', 'MODIFY') THEN t END) AS first_src_write_turn,
       SUM(cmd LIKE '%node --test%') AS test_runs,
       SUM(cmd LIKE '%node --test%' AND coalesce(exit_code, 0) <> 0) AS failing_test_runs,
       SUM(fp LIKE '%DIARY.md' AND operation_type IN ('NEW', 'MODIFY')) AS diary_writes,
       SUM(fp LIKE '%src/%' AND operation_type IN ('NEW', 'MODIFY')) AS src_writes,
       SUM(cmd LIKE '%/tmp/%' AND cmd NOT LIKE '%' || s.working_directory || '%') AS tmp_use,
       SUM(cmd LIKE '%hidden-%' OR fp LIKE '%hidden-%' OR cmd LIKE '%cd ..%' OR fp LIKE '%../%') AS outside_attempts
FROM sessions s JOIN c USING (session_id)
GROUP BY s.session_id ORDER BY run;
