#!/usr/bin/env python3
"""Flags saved step code that passes but shouldn't be trusted."""
import json, re, sys

CHECKS = {
    "conditional": r"\bif \(|\btry\b|\.catch\(",
    "leftover Escape": r"press\(['\"]Escape",
    "several statements on a line": r";[ \t]+(await|expect|const)",
    "hard-coded host": r"https?://",
    "fixed wait": r"waitForTimeout",
    "forced action": r"force: true|dispatchEvent",
}

def scan(path):
    steps, found = 0, {name: [] for name in CHECKS}
    for line in open(path):
        row = json.loads(line)
        for key, source in row.get("steps", {}).items():
            body = source.split("Promise<void> {\n", 1)[-1]
            steps += 1
            for name, pattern in CHECKS.items():
                if re.search(pattern, body):
                    found[name].append(f"{row['name']}: {key.split('/')[-1]}")
    return steps, found

for path in sys.argv[1:]:
    steps, found = scan(path)
    print(f"{path}: {steps} changed steps")
    for name, hits in found.items():
        print(f"  {name}: {len(hits)}")
        for hit in hits:
            print(f"    {hit}")
