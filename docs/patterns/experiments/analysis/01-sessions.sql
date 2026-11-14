-- one row per run: which task and variant (from the working directory), size of the session
SELECT session_id,
       replace(substr(working_directory, instr(working_directory, 'pattern-runs/') + 13), '/', ' ') AS run,
       turn_count, tool_call_count, read_count, modify_count, create_count, execute_count,
       round(duration_seconds / 60.0, 1) AS minutes
FROM sessions ORDER BY run;
