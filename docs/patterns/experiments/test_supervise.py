#!/usr/bin/env python3
"""Tests for supervise.py with a fake agent that behaves like pi: it runs commands in their own process group.

run: python3 -I test_supervise.py -v   (about 30 s)
"""
import os
import subprocess
import sys
import tempfile
import time
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import supervise  # noqa: E402

# The fake agent: runs each argv command detached (own process group, like pi's bash tool), waits for it, reports how
# it ended, then optionally sleeps (to stand for an agent that keeps working) and exits 0.
FAKE_AGENT = r'''
import subprocess, sys, time, json
cmds = json.loads(sys.argv[1]); linger = float(sys.argv[2])
for c in cmds:
    p = subprocess.Popen(["bash", "-c", c], start_new_session=True)
    rc = p.wait()
    print(f"command ended rc={rc}: {c}", flush=True)
time.sleep(linger)
print("agent done", flush=True)
'''


def alive(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    # a zombie still answers kill(0); ask ps for its state
    st = subprocess.run(["ps", "-o", "stat=", "-p", str(pid)], capture_output=True, text=True).stdout.strip()
    return bool(st) and not st.startswith("Z")


class Supervise(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.agent = os.path.join(self.dir, "agent.py")
        open(self.agent, "w").write(FAKE_AGENT)
        self.out = os.path.join(self.dir, "out.txt")
        self.log = os.path.join(self.dir, "watchdog.log")

    def run_agent(self, cmds, linger, timeout_s, watchdog_s):
        import json
        with open(self.out, "w") as o:
            res = supervise.supervise([sys.executable, "-I", self.agent, json.dumps(cmds), str(linger)], self.dir, o,
                                      subprocess.STDOUT, timeout_s, watchdog_s, self.log, poll_s=0.5)
        return res, open(self.out).read()

    def test_parse_etime(self):
        self.assertEqual(supervise.parse_etime("05"), 5)
        self.assertEqual(supervise.parse_etime("01:05"), 65)
        self.assertEqual(supervise.parse_etime("02:01:05"), 7265)
        self.assertEqual(supervise.parse_etime("1-00:00:01"), 86401)

    def test_fast_commands_are_untouched(self):
        res, out = self.run_agent(["echo hi", "sleep 1"], 0, timeout_s=30, watchdog_s=5)
        self.assertEqual(res["returncode"], 0)
        self.assertFalse(res["timed_out"])
        self.assertEqual(res["watchdog_kills"], 0)
        self.assertIn("agent done", out)

    def test_watchdog_kills_a_hanging_command_and_the_agent_continues(self):
        # a test that waits forever (the slots/control-2 hang), then a normal command
        res, out = self.run_agent(["sleep 1000", "echo after"], 0, timeout_s=40, watchdog_s=3)
        self.assertEqual(res["returncode"], 0)
        self.assertFalse(res["timed_out"])
        self.assertEqual(res["watchdog_kills"], 1)
        self.assertIn("command ended rc=-15: sleep 1000", out.replace("rc=143", "rc=-15"))
        self.assertIn("command ended rc=0: echo after", out)
        self.assertLess(res["seconds"], 15)
        self.assertIn("watchdog: killed group", open(self.log).read())

    def test_watchdog_kills_a_cpu_bound_grandchild(self):
        # the tiling/chapter-1 hang: an infinite loop in a node process under bash
        res, out = self.run_agent(["node -e 'for(;;){}'"], 0, timeout_s=40, watchdog_s=3)
        self.assertEqual(res["watchdog_kills"], 1)
        self.assertIn("agent done", out)
        self.assertLess(res["seconds"], 15)

    def test_budget_kills_the_whole_tree_and_leaves_no_orphans(self):
        # the agent itself keeps working past the budget while a detached command runs: everything must die
        marker = f"sleep 777{os.getpid() % 100}"
        res, out = self.run_agent([f"{marker} & echo started; wait"], 1000, timeout_s=4, watchdog_s=1000)
        self.assertTrue(res["timed_out"])
        self.assertNotIn("agent done", out)
        time.sleep(1)
        left = subprocess.run(["pgrep", "-f", marker], capture_output=True, text=True).stdout.split()
        self.assertEqual(left, [], f"orphans left: {left}")

    def test_budget_reaches_the_agents_own_children(self):
        # a non-detached child of the agent (same group) dies with it
        script = os.path.join(self.dir, "own.py")
        open(script, "w").write("import subprocess, time\np = subprocess.Popen(['sleep', '8881'])\nprint(p.pid, flush=True)\ntime.sleep(1000)\n")
        with open(self.out, "w") as o:
            res = supervise.supervise([sys.executable, "-I", script], self.dir, o, subprocess.STDOUT, 3, 1000, self.log,
                                      poll_s=0.5)
        self.assertTrue(res["timed_out"])
        child = int(open(self.out).read().split()[0])
        time.sleep(0.5)
        self.assertFalse(alive(child))


if __name__ == "__main__":
    unittest.main()
