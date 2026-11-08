#!/usr/bin/env python3
"""Runs repair modes against structural UI changes, from a clean baseline.

Usage: redesign.py [results.jsonl]
"""
import json, re, shutil, sys, time
from pathlib import Path

import failures as m

ROOT = m.ROOT
BASE = m.BASE

SHELL = ROOT / "app/(dashboard)/layout.tsx"
NAV = ROOT / "app/(dashboard)/dashboard/layout.tsx"
CHECKOUT = ROOT / "app/(dashboard)/pricing/checkout/page.tsx"
SECTION = ROOT / "app/(dashboard)/pricing/checkout/billing-section.tsx"
DASH = ROOT / "app/(dashboard)/dashboard/page.tsx"

def swap(text, old, new):
    assert old in text, old
    return text.replace(old, new)

def signout_in_header():
    t = SHELL.read_text()
    t = re.sub(r'\t*<form action=\{handleSignOut\} className="w-full">.*?</form>\n', "", t, count=1, flags=re.S)
    t = swap(t, "<DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>",
             '<>\n<form action={handleSignOut}><button type="submit" className="text-sm">Log off</button></form>\n<DropdownMenu open={isMenuOpen} onOpenChange={setIsMenuOpen}>')
    t = swap(t, "</DropdownMenu>\n\t);", "</DropdownMenu>\n</>\n\t);")
    SHELL.write_text(t)

def settings_in_user_menu():
    n = NAV.read_text()
    NAV.write_text(swap(n, '\t\t{ href: "/dashboard/general", icon: Settings, label: "General" },\n', ""))
    t = SHELL.read_text()
    old = "<span>Dashboard</span>\n\t\t\t\t\t</Link>\n\t\t\t\t</DropdownMenuItem>\n"
    SHELL.write_text(swap(t, old, old + '<DropdownMenuItem className="cursor-pointer" asChild>\n<Link href="/dashboard/general" className="flex w-full items-center" onClick={() => setIsMenuOpen(false)}><span>Account settings</span></Link>\n</DropdownMenuItem>\n'))

def two_stage_checkout():
    SECTION.write_text('''"use client";
import { type ReactNode, useState } from "react";

export function BillingSection({ children }: { children: ReactNode }) {
	const [open, setOpen] = useState(false);
	if (open) return <>{children}</>;
	return (
		<button type="button" className="underline" onClick={() => setOpen(true)}>
			Continue to billing
		</button>
	);
}
''')
    t = CHECKOUT.read_text()
    t = swap(t, 'import { processPayment } from "@/lib/payments/actions";\n', 'import { processPayment } from "@/lib/payments/actions";\nimport { BillingSection } from "./billing-section";\n')
    start = t.index('<div>\n\t\t\t\t\t\t\t<h3 className="text-lg font-medium text-gray-900 mb-4">\n\t\t\t\t\t\t\t\tBilling Address')
    end = t.index("\n\t\t\t\t\t\t</div>\n", start) + len("\n\t\t\t\t\t\t</div>\n")
    CHECKOUT.write_text(t[:start] + "<BillingSection>" + t[start:end] + "</BillingSection>\n" + t[end:])

def role_dropdown():
    t = DASH.read_text()
    t = re.sub(r'<Label>Role</Label>\s*<RadioGroup.*?</RadioGroup>',
               '<Label htmlFor="role">Role</Label>\n<select id="role" name="role" defaultValue="member" disabled={!isOwner}><option value="member">Team member</option><option value="owner">Owner</option></select>',
               t, count=1, flags=re.S)
    DASH.write_text(swap(t, "Invite Member", "Send invitation"))

NAME, PLAN, INVITE = m.NAME, m.PLAN, m.INVITE
ALL = "should"
SCENARIOS = [
    ("sign out moved to the header", INVITE, [signout_in_header], "changed", 2),
    ("settings moved to the user menu", NAME, [settings_in_user_menu], "changed", 2),
    ("checkout gets a second stage", PLAN, [two_stage_checkout], "changed", 2),
    ("role radio becomes a dropdown", INVITE, [role_dropdown], "changed", 2),
    ("all four, changed mode", ALL, [signout_in_header, settings_in_user_menu, two_stage_checkout, role_dropdown], "changed", 3),
    ("all four, all mode", ALL, [signout_in_header, settings_in_user_menu, two_stage_checkout, role_dropdown], "all", 3),
]

FILES = [SHELL, NAV, CHECKOUT, DASH]


def main():
    out = Path(sys.argv[1] if len(sys.argv) > 1 else "/tmp/intent-redesign.jsonl")
    REPEAT = 2
    out.write_text("")
    for number in range(REPEAT):
        for name, grep, edits, mode, retries in SCENARIOS:
            if number and "all four" in name and "changed" not in name:
                continue
            shutil.rmtree(ROOT / ".intent", ignore_errors=True)
            shutil.copytree(BASE, ROOT / ".intent")
            originals = {p: p.read_text() for p in FILES}
            started = time.time()
            try:
                for edit in edits:
                    edit()
                time.sleep(4)
                code, report = m.run(mode, grep, retries=retries)
                attempts, notes, decisions, turns = m.summary(report)
                changed = m.diff()
                verify = [m.run("none", grep)[0] for _ in range(2)]
                steps = {str(p.relative_to(ROOT / ".intent")): p.read_text() for p in (ROOT / ".intent").rglob("*.ts") if p.is_file() and str(p.relative_to(ROOT / ".intent")) in changed}
            finally:
                for path, text in originals.items():
                    path.write_text(text)
                SECTION.unlink(missing_ok=True)
            with out.open("a") as log:
                log.write(json.dumps(dict(name=name, round=number, exit=code, attempts=attempts, notes=notes, changed=changed, verify=verify, turns=turns, seconds=round(time.time() - started), transcripts=decisions, steps=steps)) + "\n")
            print(number, name, "exit", code, attempts, "changed", len(changed), "verify", verify, "turns", turns, flush=True)
            for note in notes:
                print("   ", note[:210].replace("\n", " | "), flush=True)
    print("done")


if __name__ == "__main__":
    main()
