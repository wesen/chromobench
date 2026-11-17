#!/usr/bin/env python3
"""Run an agent process with a wall-clock budget and a watchdog for the commands it starts.

pi starts every bash command in its own process group (`detached: true`) and gives it no timeout unless the model
asks for one. So killing pi's group does not reach the commands, and one hanging test stalls the agent until the
budget runs out (CHB-036 diary, Step 9). This module therefore works on the process tree:

- watchdog: every `poll_s`, any descendant of the agent that has run longer than `watchdog_s` has its process group
  killed (TERM, then KILL). The agent's tool call returns with the output so far, and the agent continues.
- budget: when `timeout_s` is reached, the whole tree is killed: every descendant's process group and the agent's
  own, so nothing outlives the run as an orphan.

Every kill is appended to `log` (one line per kill) and counted in the returned summary.
"""
import os
import signal
import subprocess
import time


def parse_etime(s: str) -> int:
    """`ps` elapsed time ([[dd-]hh:]mm:ss) → seconds."""
    days = 0
    if "-" in s:
        d, s = s.split("-", 1)
        days = int(d)
    parts = [int(p) for p in s.split(":")]
    while len(parts) < 3:
        parts.insert(0, 0)
    h, m, sec = parts
    return ((days * 24 + h) * 60 + m) * 60 + sec


def process_table():
    """{pid: (ppid, pgid, elapsed_s, command)} for every process visible to `ps`."""
    out = subprocess.run(["ps", "-Ao", "pid=,ppid=,pgid=,etime=,command="], capture_output=True, text=True).stdout
    table = {}
    for line in out.splitlines():
        f = line.split(None, 4)
        if len(f) < 4:
            continue
        try:
            table[int(f[0])] = (int(f[1]), int(f[2]), parse_etime(f[3]), f[4] if len(f) > 4 else "")
        except ValueError:
            continue
    return table


def descendants(root: int, table=None):
    """PIDs of every process below `root` (children, grandchildren, …)."""
    table = table if table is not None else process_table()
    children = {}
    for pid, (ppid, *_rest) in table.items():
        children.setdefault(ppid, []).append(pid)
    found, stack = [], list(children.get(root, []))
    while stack:
        pid = stack.pop()
        found.append(pid)
        stack.extend(children.get(pid, []))
    return found


def group_members(pgid: int):
    """Live (non-zombie) PIDs in a process group, from `ps`. macOS answers killpg(pgid, 0) with EPERM once the group
    leader is an unreaped zombie, so membership is read from the process table instead."""
    out = subprocess.run(["ps", "-Ao", "pid=,pgid=,stat="], capture_output=True, text=True).stdout
    members = []
    for line in out.splitlines():
        f = line.split()
        if len(f) == 3 and f[1] == str(pgid) and not f[2].startswith("Z"):
            members.append(int(f[0]))
    return members


def _signal_all(pgid: int, members, sig) -> None:
    try:
        os.killpg(pgid, sig)
    except (ProcessLookupError, PermissionError):
        pass
    for pid in members:  # the group signal can be refused (EPERM); signal each member too
        try:
            os.kill(pid, sig)
        except (ProcessLookupError, PermissionError):
            pass


def kill_group(pgid: int, grace_s: float = 2.0) -> bool:
    """TERM every live member of the process group, KILL what is left after `grace_s`.
    False if the group had no live members."""
    members = group_members(pgid)
    if not members:
        return False
    _signal_all(pgid, members, signal.SIGTERM)
    deadline = time.time() + grace_s
    while time.time() < deadline:
        if not group_members(pgid):
            return True
        time.sleep(0.1)
    _signal_all(pgid, group_members(pgid), signal.SIGKILL)
    return True


def supervise(cmd, cwd, stdout, stderr, timeout_s: float, watchdog_s: float, log=None, poll_s: float = 5.0):
    """Runs `cmd` in a new session; returns {returncode, timed_out, watchdog_kills, seconds}."""
    t0 = time.time()
    p = subprocess.Popen(cmd, cwd=cwd, stdin=subprocess.DEVNULL, stdout=stdout, stderr=stderr, start_new_session=True)
    own_pgid = p.pid  # start_new_session makes the agent its own session and group leader
    kills, timed_out = 0, False

    def note(msg):
        if log:
            with open(log, "a") as fh:
                fh.write(f"{time.strftime('%H:%M:%S')} {msg}\n")

    while True:
        try:
            p.wait(timeout=poll_s)
            break
        except subprocess.TimeoutExpired:
            pass
        table = process_table()
        if time.time() - t0 >= timeout_s:
            timed_out = True
            groups = {table[d][1] for d in descendants(p.pid, table) if d in table} | {own_pgid}
            note(f"budget {timeout_s:.0f}s reached: killing groups {sorted(groups)}")
            for g in groups:
                if g != own_pgid:
                    kill_group(g)
            kill_group(own_pgid)
            p.wait()
            break
        for d in descendants(p.pid, table):
            ppid, pgid, elapsed, command = table[d]
            if elapsed >= watchdog_s and pgid != own_pgid:
                if kill_group(pgid):
                    kills += 1
                    note(f"watchdog: killed group {pgid} after {elapsed}s: {command[:200]}")
    return {"returncode": p.returncode, "timed_out": timed_out, "watchdog_kills": kills,
            "seconds": round(time.time() - t0, 1)}
