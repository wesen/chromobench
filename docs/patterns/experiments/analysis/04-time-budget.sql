-- where the hour went, per session: model time (gap before each assistant turn), tool time, thinking volume
WITH t AS (
  SELECT session_id, turn_index, role, timestamp, output_tokens, length(coalesce(thinking, '')) AS think_chars,
         (julianday(timestamp) - julianday(LAG(timestamp) OVER (PARTITION BY session_id ORDER BY turn_index))) * 86400.0 AS gap_s
  FROM turns)
SELECT replace(substr(s.working_directory, instr(s.working_directory, '/pattern-runs') + 1), '/', ' ') AS run,
       round((julianday(MAX(t.timestamp)) - julianday(MIN(t.timestamp))) * 1440.0, 1) AS recorded_min,
       round(SUM(CASE WHEN t.role = 'assistant' THEN t.gap_s END) / 60.0, 1) AS model_min,
       (SELECT round(SUM(duration_ms) / 60000.0, 1) FROM tool_calls tc WHERE tc.session_id = s.session_id) AS tool_min,
       SUM(t.role = 'assistant') AS assistant_turns,
       SUM(t.output_tokens) AS output_tokens,
       SUM(t.think_chars) AS thinking_chars,
       MAX(t.think_chars) AS max_thinking_chars,
       round(MAX(CASE WHEN t.role = 'assistant' THEN t.gap_s END) / 60.0, 1) AS longest_model_gap_min
FROM sessions s JOIN t USING (session_id)
GROUP BY s.session_id ORDER BY run;
