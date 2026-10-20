"""Independent Radiance cross-check; never imports the application's IES parser.
Usage: python scripts/verify-photometry-radiance.py CASES.json RADIANCE-DIRECTORY
Only source files and local processes are used. No network or project transmission.
Point opening override -i .001 deliberately tests the declared far-field point model.
"""
import hashlib
import json
import os
import subprocess
import sys
from pathlib import Path

file, radiance = map(lambda p: Path(p).resolve(), sys.argv[1:3])
data = json.loads(file.read_text(encoding="utf8"))
env = dict(os.environ, RAYPATH=".;" + str(radiance / "lib"))
root = file.parent / "radiance-comparison"
root.mkdir()
commands = []

def run(name, args, cwd, stdin=None):
    command = [str(radiance / "bin" / (name + ".exe")), *map(str, args)]
    proc = subprocess.run(command, input=stdin, cwd=cwd, env=env, capture_output=True,
                          timeout=120, creationflags=0x08000000 if os.name == "nt" else 0)
    commands.append({"tool": name, "args": list(map(str, args)), "exitCode": proc.returncode,
                     "stderr": proc.stderr.decode("utf8", errors="replace")})
    assert proc.returncode == 0, commands[-1]
    return proc.stdout

version = run("rtrace", ["-version"], root).decode().strip()
results = []
for case in data["cases"]:
    folder = root / case["id"]
    folder.mkdir()
    source = Path(case["source"])
    assert hashlib.sha256(source.read_bytes()).hexdigest() == case["sourceSHA256"]
    scene = b""
    for index, lamp in enumerate(case["lamps"]):
        name = "source" + str(index)
        run("ies2rad", ["-t", "default", "-i", ".001", "-m", lamp["maintenanceFactor"], "-o", name, source], folder)
        scene += run("xform", ["-rz", lamp["rotationDegrees"], "-t", *lamp["positionM"], name + ".rad"], folder)
    # Optional opaque wall polygons for independent line-of-sight regression.
    for index, wall in enumerate(case.get("walls", [])):
        scene += ("\nvoid plastic wallmat" + str(index) + "\n0\n0\n5 0 0 0 0 0\nwallmat" + str(index)
                  + " polygon wall" + str(index) + "\n0\n0\n" + str(len(wall)*3) + "\n"
                  + "\n".join(" ".join(map(str, p)) for p in wall) + "\n").encode()
    (folder / "scene.rad").write_bytes(scene)
    (folder / "scene.oct").write_bytes(run("oconv", ["scene.rad"], folder))
    sensors = "".join(" ".join(map(str, p)) + " 0 0 1\n" for p in case["points"]).encode()
    output = run("rtrace", ["-I+", "-h-", "-ab", 0, "-av", 0, 0, 0, "-dt", 0, "-dc", 1, "-dj", 0, "-ds", 0, "-n", 1, "scene.oct"], folder, sensors)
    (folder / "rtrace.txt").write_bytes(output)
    rgb = [list(map(float, line.split())) for line in output.decode().splitlines() if line.strip()]
    measured = [179 * (.265*r + .670*g + .065*b) for r, g, b in rgb]
    assert len(measured) == len(case["expectedLux"])
    differences = [abs(a-b) for a, b in zip(measured, case["expectedLux"])]
    relative = [abs(a-b)/max(1, abs(b)) for a, b in zip(measured, case["expectedLux"])]
    ok = all(delta <= .05 + abs(expected)*.01 for delta, expected in zip(differences, case["expectedLux"]))
    results.append({"id": case["id"], "sourceSHA256": case["sourceSHA256"], "points": len(measured),
                    "ok": ok, "maxAbsoluteLuxDifference": max(differences), "maxRelativeDifferenceAbove1Lux": max(relative),
                    "radianceLux": measured, "expectedLux": case["expectedLux"]})
report = {"ok": all(c["ok"] for c in results), "radianceVersion": version, "cases": results,
          "tolerance": "0.05 lx + 1% of predicted direct illuminance per point",
          "scope": "Independent ies2rad, xform, oconv and rtrace; point opening override, direct only, no diffuse reflections. Not real luminaire near-field or UGR acceptance.",
          "tools": [{"file": n, "sha256": hashlib.sha256((radiance / "bin" / n).read_bytes()).hexdigest()}
                    for n in ["ies2rad.exe", "xform.exe", "oconv.exe", "rtrace.exe"]], "commands": commands,
          "professionalApproval": False}
(root / "report.json").write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf8")
print(json.dumps({"ok": report["ok"], "version": version, "cases": len(results), "points": sum(r["points"] for r in results),
                  "maximumRelativeDifference": max(r["maxRelativeDifferenceAbove1Lux"] for r in results), "report": str(root / "report.json")}))
assert report["ok"], "Independent Radiance comparison failed; inspect per-point results"
