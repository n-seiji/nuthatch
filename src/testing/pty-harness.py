#!/usr/bin/env python3
"""
Minimal pty-driving harness for the picker's integration tests
(picker-terminal.integration.test.ts). Not part of the published package
(see AGENTS.md's dependency direction -- this only exists under src/testing/,
which is test-only) -- it exists because Node has no built-in pty module, and
this repo doesn't want a native node-pty dependency just for one test file.

Protocol: takes the binary + args + cwd as argv, then a JSON "script" on
stdin: a list of steps, each either
  {"wait_ms": <int>}
  {"wait_for": "<substring>", "timeout_ms": <int>}
  {"send": "<string, python escapes ok>"}
  {"signal": "TERM"|"HUP"}
  {"resize": {"rows": <int>, "cols": <int>}}
Runs them in order against the child's pty, then waits for the child to
exit (or kills it after a timeout). Prints one JSON object to stdout:
{"output": "<all bytes read, latin1-decoded>", "exit_code": <int|null>}

The pty's slave fd is deliberately kept open (by this parent process) until
after the child has exited and been drained, rather than closed right
after Popen -- closing it early can make the OS discard bytes the child
writes in its very last instants (e.g. a signal handler's terminal-restore
sequence) if nothing has read them from the master side yet.
"""

import fcntl
import json
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import termios
import time


def main() -> None:
    binary = sys.argv[1]
    cwd = sys.argv[2]
    extra_args = sys.argv[3:]
    script = json.loads(sys.stdin.read())

    master, slave = pty.openpty()
    env = dict(os.environ)
    env["TERM"] = "xterm-256color"
    def _make_controlling_tty() -> None:
        # Runs in the forked child, just before exec. Making the child a
        # session leader (setsid) is not enough on its own: the pty slave
        # was opened by *this* (parent) process, and inheriting an
        # already-open fd across fork/exec never makes it a controlling
        # terminal -- only an open(2) call by a session leader with no
        # controlling terminal does that. TIOCSCTTY forces the (already
        # inherited) slave fd to become the controlling terminal instead,
        # which is what makes job-control signals -- SIGWINCH on a resize,
        # in particular -- actually reach the child.
        os.setsid()
        fcntl.ioctl(0, termios.TIOCSCTTY, 0)

    proc = subprocess.Popen(
        [binary, *extra_args],
        stdin=slave,
        stdout=slave,
        stderr=slave,
        cwd=cwd,
        env=env,
        close_fds=True,
        preexec_fn=_make_controlling_tty,
    )

    output = b""

    def pump(timeout_s: float) -> None:
        nonlocal output
        deadline = time.monotonic() + timeout_s
        while time.monotonic() < deadline:
            remaining = max(0.0, deadline - time.monotonic())
            r, _, _ = select.select([master], [], [], min(0.02, remaining))
            if master in r:
                try:
                    chunk = os.read(master, 65536)
                except OSError:
                    return
                if not chunk:
                    return
                output += chunk

    for step in script:
        if "wait_ms" in step:
            pump(step["wait_ms"] / 1000)
        elif "wait_for" in step:
            needle = step["wait_for"].encode("latin1", errors="replace")
            timeout_s = step.get("timeout_ms", 2000) / 1000
            deadline = time.monotonic() + timeout_s
            while needle not in output and time.monotonic() < deadline:
                pump(0.05)
        elif "send" in step:
            data = step["send"].encode("latin1", errors="replace")
            try:
                os.write(master, data)
            except OSError:
                pass
        elif "signal" in step:
            sig = getattr(signal, f"SIG{step['signal']}")
            try:
                proc.send_signal(sig)
            except OSError:
                pass
        elif "resize" in step:
            # Setting the pty's window size delivers SIGWINCH to the
            # foreground process group automatically (standard tty
            # behavior) -- no explicit signal needed.
            rows = step["resize"]["rows"]
            cols = step["resize"]["cols"]
            winsize = struct.pack("HHHH", rows, cols, 0, 0)
            try:
                fcntl.ioctl(master, termios.TIOCSWINSZ, winsize)
            except OSError:
                pass

    # Keep draining the master fd while waiting for the child to exit,
    # rather than blocking in proc.wait() with no reads in between: on this
    # platform, a pty can drop output still queued in its buffer once the
    # writer's last fd closes (process exit) if nothing has read it yet, so
    # a read-then-wait ordering can lose a process's final bytes (its
    # cleanup/teardown sequence) even though the write() call succeeded.
    # Pumping continuously until the process is confirmed exited closes
    # that race.
    exit_deadline = time.monotonic() + 5
    while proc.poll() is None and time.monotonic() < exit_deadline:
        pump(0.05)
    if proc.poll() is None:
        proc.send_signal(signal.SIGKILL)
        proc.wait(timeout=2)
    pump(0.2)
    try:
        os.close(slave)
    except OSError:
        pass
    try:
        os.close(master)
    except OSError:
        pass

    print(json.dumps({"output": output.decode("latin1"), "exit_code": proc.returncode}))


if __name__ == "__main__":
    main()
