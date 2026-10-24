"""The profile's Degree dropdown and the extension's degree catalog must agree.

routers/profile_page.py DEGREE_GROUPS is what a person can pick; the Chrome
extension's DEGREE_CATALOG (chrome-extension/src/autofill/plan.js) is what turns
that pick into each employer's wording ("BTECH" on Workday, "Bachelor's Degree"
on Greenhouse). A label the catalog does not recognise would only ever be
matched as typed — so every option must be known to it, or (for the "(other)"
entries) at least name a degree level.

Skipped (not failed) without node, like test_match_guard.py's agreement check.

Run: python test_degree_options.py
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
import traceback
from pathlib import Path

from routers.profile_page import DEGREE_GROUPS

ROOT = os.path.dirname(os.path.abspath(__file__))
PLAN_JS = os.path.join(ROOT, "chrome-extension", "src", "autofill", "plan.js")


def _labels():
    return [label for _, labels in DEGREE_GROUPS for label in labels]


def test_labels_are_unique_and_short():
    labels = _labels()
    assert len(labels) == len(set(labels)), "a degree is listed twice"
    assert all(0 < len(l) <= 120 for l in labels), "the profile stores at most 120 characters"


def test_every_profile_degree_is_known_to_the_extension():
    node = shutil.which("node")
    if not node:
        print("    (skipped: node not on PATH)")
        return
    script = (
        "import * as p from " + json.dumps(Path(PLAN_JS).as_uri()) + ";\n"
        "const labels = JSON.parse(process.env.TCV_DEGREES);\n"
        "console.log(JSON.stringify(labels.map(l => [\n"
        "  !!p.degreeEntry(l), p.candidatesFor('degree', l, {}).length])));\n"
    )
    with tempfile.NamedTemporaryFile("w", suffix=".mjs", delete=False, encoding="utf-8") as fh:
        fh.write(script)
        path = fh.name
    try:
        env = dict(os.environ, TCV_DEGREES=json.dumps(_labels()))
        proc = subprocess.run([node, path], capture_output=True, text=True, env=env)
        assert proc.returncode == 0, proc.stderr[:2000]
        results = json.loads(proc.stdout.strip().splitlines()[-1])
    finally:
        os.unlink(path)
    unknown = [label for label, (in_catalog, n_candidates) in zip(_labels(), results)
               if not in_catalog and n_candidates < 2]
    assert not unknown, f"not recognised by DEGREE_CATALOG: {unknown}"


def main() -> int:
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    passed, failures = 0, []
    for t in tests:
        try:
            t()
            passed += 1
            print(f"  PASS  {t.__name__}")
        except Exception as exc:  # noqa: BLE001 - report every failure
            failures.append((t.__name__, exc))
            print(f"  FAIL  {t.__name__}: {exc}")
            traceback.print_exc()
    print(f"\n{passed}/{len(tests)} passed, {len(failures)} failed")
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
