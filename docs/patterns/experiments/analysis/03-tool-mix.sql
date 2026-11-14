-- tool frequency per run
SELECT replace(substr(s.working_directory, instr(s.working_directory, 'pattern-runs/') + 13), '/', ' ') AS run,
       tc.tool_name, COUNT(*) AS n
FROM sessions s JOIN tool_calls tc USING (session_id)
GROUP BY run, tc.tool_name ORDER BY run, n DESC;
