#!/usr/bin/env python3
"""Runs changed mode against real bugs and real UI changes, from a clean baseline.

Usage: failures.py [results.jsonl] [scenario,scenario]
"""
import base64, filecmp, json, os, re, shutil, subprocess, sys, time
from pathlib import Path

ROOT = Path(os.environ.get("TUTORIAL", Path(__file__).resolve().parents[2] / "playwright-tutorial"))
BASE = Path(os.environ.get("INTENT_BASELINE", "/tmp/intent-baseline"))
NAME = "should change user name"
PLAN = "should successfully upgrade"
INVITE = "should successfully invite"
GENERAL = "app/(dashboard)/dashboard/general/page.tsx"
NAV = "app/(dashboard)/dashboard/layout.tsx"
PRICING = "app/(dashboard)/pricing/submit-button.tsx"
DASH = "app/(dashboard)/dashboard/page.tsx"
SHELL = "app/(dashboard)/layout.tsx"

SCENARIOS = [
    # Real bugs: the steps must stay as they are.
    ("bug", "api-team-500", NAME, {}),
    ("bug", "api-team-malformed-json", NAME, {}),
    ("bug", "account-update-db-write-skipped", NAME, {}),
    ("bug", "payment-server-error", PLAN, {}),
    ("bug", "payment-subscription-update-skipped", PLAN, {}),
    ("bug", "session-cookie-missing-mid-flow", PLAN, {}),
    # One-offs: the steps must stay as they are too.
    ("transient", "api-team-latency-spike", NAME, {}),
    ("transient", "script-chunk-timeout", PLAN, {}),
    # Real UI changes: the steps should end up fixed.
    ("stale", "rename save button", NAME, {GENERAL: [("Save Changes", "Update account")]}),
    ("stale", "rename nav and heading", NAME, {NAV: [('label: "General"', 'label: "Account"')], GENERAL: [("General Settings", "Account Settings")]}),
    ("stale", "rename pricing button", PLAN, {PRICING: [("Get Started", "Choose plan")]}),
    ("stale", "rename change plan", PLAN, {DASH: [("Change Plan", "Manage plan")]}),
    ("stale", "rename invite button", INVITE, {DASH: [("Invite Member", "Send invitation")]}),
    ("stale", "rename sign out", INVITE, {SHELL: [("Sign out", "Log out")]}),
    # Harder: a bug that could be mistaken for a rename. Repairing this hides it.
    ("bug", "invite says it failed", INVITE, {"app/(login)/actions.ts": [('success: "Invitation sent successfully"', 'success: "Invitation could not be sent"')]}),
    ("bug", "save button removed", NAME, {GENERAL: [("Save Changes", ""), ('type="submit"', 'type="button" hidden')]}),
    # Hand-written failures, outside any step.
    ("handwritten-bug", "hand-written assertion is out of date", NAME, {"tests-intent/change-name.spec.ts": [('page.getByText("John Doe")', 'page.getByText("Jane Doe")')]}),
    ("handwritten-step", "a step passes but does the wrong thing", NAME, {}),
]

def run(mode, grep, faults=None, retries=0):
    env = {k: v for k, v in os.environ.items() if k not in ("CI", "FAULTS", "PW_INTENT")}
    env.update(BASE_URL="http://localhost:3000", PW_INTENT=mode)
    if faults:
        env["FAULTS"] = faults
    done = subprocess.run(["./node_modules/.bin/playwright", "test", "-c", "intent.config.ts", f"--retries={retries}", "-g", grep],
                          cwd=ROOT, env=env, capture_output=True, text=True)
    return done.returncode, json.loads((ROOT / "intent-report.json").read_text())

def tests(report):
    for suite in report["suites"]:
        for spec in suite.get("specs", []):
            yield from spec["tests"]

def summary(report):
    attempts, notes, decisions, turns = [], [], [], 0
    for test in tests(report):
        for result in test["results"]:
            attempts.append(result["status"])
            notes += [a.get("description", "") for a in result.get("annotations", []) if a["type"] == "intent"]
            for a in result.get("attachments", []):
                if a["name"] == "agent: diagnose" or a["name"].startswith("agent:"):
                    body = base64.b64decode(a["body"]).decode() if a.get("body") else Path(a["path"]).read_text()
                    m = re.search(r"--- (\d+) turns", body)
                    turns += int(m[1]) if m else 0
                    decisions.append((a["name"], body))
    return attempts, notes, decisions, turns

def diff():
    changed = []
    for path in sorted(p for p in (ROOT / ".intent").rglob("*") if p.is_file()):
        rel = path.relative_to(ROOT / ".intent")
        old = BASE / rel
        if not old.exists() or not filecmp.cmp(path, old, shallow=False):
            changed.append(str(rel))
    for path in sorted(p for p in BASE.rglob("*") if p.is_file()):
        rel = path.relative_to(BASE)
        if not (ROOT / ".intent" / rel).exists():
            changed.append(f"removed {rel}")
    return changed

def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/intent-failures.jsonl")
    only = set(sys.argv[2].split(",")) if len(sys.argv) > 2 else None
    for kind, name, grep, edits in SCENARIOS:
        if only and name not in only:
            continue
        shutil.rmtree(ROOT / ".intent", ignore_errors=True)
        shutil.copytree(BASE, ROOT / ".intent")
        originals = {}
        for file, swaps in edits.items():
            path = ROOT / file
            originals[path] = path.read_text()
            text = originals[path]
            for old, new in swaps:
                assert old in text, (file, old)
                text = text.replace(old, new)
            path.write_text(text)
        if edits:
            time.sleep(3)
        if name == "a step passes but does the wrong thing":
            for step in [p for p in (ROOT / ".intent").rglob("*.ts") if p.is_file()]:
                text = step.read_text()
                if "change my name" in step.name:
                    step.write_text(text.replace("vars.name", "'Wrong Name'"))
                if "go back" in step.name:
                    step.write_text(text.replace("	await expect(page.getByText('John Doe')).toBeVisible();\n", ""))
        started = time.time()
        try:
            code, report = run("changed", grep, faults=name if kind in ("bug", "transient") and not edits else None, retries=1)
            attempts, notes, decisions, turns = summary(report)
            changed = diff()
            verify = None
            if kind in ("stale", "handwritten-step"):
                verify = [run("none", grep)[0] for _ in range(2)]
                steps = {str(p.relative_to(ROOT / ".intent")): p.read_text() for p in (ROOT / ".intent").rglob("*.ts") if p.is_file() and str(p.relative_to(ROOT / ".intent")) in changed}
            else:
                steps = {}
        finally:
            for path, text in originals.items():
                path.write_text(text)
        record = dict(kind=kind, name=name, exit=code, attempts=attempts, notes=notes, changed=changed, verify=verify, turns=turns,
                      seconds=round(time.time() - started), transcripts=decisions, steps=steps)
        with out.open("a") as log:
            log.write(json.dumps(record) + "\n")
        print(kind, name, "exit", code, attempts, "changed", len(changed), "verify", verify, flush=True)
        for note in notes:
            print("   ", note[:230].replace("\n", " | "), flush=True)
        time.sleep(1)
    print("done")


if __name__ == "__main__":
    main()
