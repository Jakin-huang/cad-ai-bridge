"""Read QMP status or stop only the explicitly selected lab's own QEMU instance."""
import argparse
import base64
import json
from pathlib import Path
import socket

p = argparse.ArgumentParser()
p.add_argument("lab")
p.add_argument("--screenshot", action="store_true")
p.add_argument("--stop", action="store_true")
args = p.parse_args()
lab = Path(args.lab).resolve()
state = json.loads((lab / "run.json").read_text())
work = Path(state["work"])
serial = (lab / "serial.log").read_text(errors="replace") if (lab / "serial.log").exists() else ""
for line in serial.splitlines():
    if line.startswith("BRIDGE_VM_RESULT "):
        report = json.loads(base64.b64decode(line.split(" ", 1)[1]))
        if report["nonce"] != state["nonce"]:
            raise SystemExit("Guest report nonce differs from this lab")
        (lab / "guest-report.json").write_text(json.dumps(report, indent=2))
        print(json.dumps({"guestReport": report}))
        break
try:
    with socket.socket(socket.AF_UNIX) as sock:
        sock.settimeout(10)
        sock.connect(str(work / "qmp.sock"))
        stream = sock.makefile("rwb", buffering=0)
        stream.readline()
        def execute(name, arguments=None):
            request = {"execute": name}
            if arguments is not None:
                request["arguments"] = arguments
            stream.write(json.dumps(request).encode() + b"\n")
            while True:
                reply = json.loads(stream.readline())
                if "return" in reply or "error" in reply:
                    return reply
        execute("qmp_capabilities")
        status = execute("query-status")
        blocks = execute("query-blockstats")
        stats = [{"device": b.get("device"), "readBytes": b["stats"]["rd_bytes"], "writtenBytes": b["stats"]["wr_bytes"]} for b in blocks.get("return", [])]
        print(json.dumps({"status": status, "blockStats": stats, "serialBytes": len(serial), "work": str(work)}))
        if args.screenshot:
            print(json.dumps(execute("screendump", {"filename": str(lab / "screen.png"), "format": "png"})))
        if args.stop:
            print(json.dumps(execute("quit")))
except (FileNotFoundError, ConnectionRefusedError):
    print(json.dumps({"qmpAvailable": False, "serialBytes": len(serial)}))
