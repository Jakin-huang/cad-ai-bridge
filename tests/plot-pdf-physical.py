"""Independent local PDF check; requires optional pdfplumber from the QA runtime.

Consumes the private practical-v06 report, never embeds project drawings in source.
The synthetic fixture has 6200 horizontal 10 mm segments. At 1:10 they must
remain horizontal and measure 1 mm on paper within the PDF driver's resolution.
"""
import collections
import datetime
import hashlib
import json
import math
import pathlib
import sys

import pdfplumber

report_file = pathlib.Path(sys.argv[1])
report = json.loads(report_file.read_text(encoding="utf-8-sig"))
compound = report["results"]["compound"]
pdf = next(item for item in compound["files"] if item["kind"] == "pdf")
assert hashlib.sha256(pathlib.Path(pdf["file"]).read_bytes()).hexdigest() == pdf["sha256"]
with pdfplumber.open(pdf["file"]) as document:
    assert len(document.pages) == 1
    page = document.pages[0]
    assert abs(page.width * 25.4 / 72 - 420) < 1
    assert abs(page.height * 25.4 / 72 - 297) < 1
    lengths = []
    for line in page.lines:
        dx, dy = line["x1"] - line["x0"], line["y1"] - line["y0"]
        assert abs(dy) < 0.01, "Synthetic CAD lines must remain horizontal"
        length = math.hypot(dx, dy) * 25.4 / 72
        assert abs(length - 1) <= 0.05, "Fixed 1:10 content scale differs from physical PDF vectors"
        lengths.append(round(length, 5))
    assert len(lengths) == 6200
    extent_mm = [(max(line["x1"] for line in page.lines) - min(line["x0"] for line in page.lines)) * 25.4 / 72,
                 (max(line["y0"] for line in page.lines) - min(line["y0"] for line in page.lines)) * 25.4 / 72]
    assert abs(extent_mm[0] - 199) <= 0.05 and abs(extent_mm[1] - 122) <= 0.05
    assert "CAD AI Bridge" in page.extract_text()
    main = {"displayedPageMm": [page.width * 25.4 / 72, page.height * 25.4 / 72],
            "horizontalSegments": len(lengths), "expectedSegmentMm": 1,
            "toleranceMm": 0.05, "gridExtentMm": extent_mm,
            "measuredSegmentMm": dict(collections.Counter(lengths))}

sizes = {"A0": [841, 1189], "A1": [594, 841], "A2": [420, 594],
         "A3": [297, 420], "A4": [210, 297]}
matrix = []
for item in report["results"]["sheetMatrix"]["exports"]:
    paper, orientation = item["name"].split("_")
    expected = sizes[paper][::-1] if orientation == "landscape" else sizes[paper]
    with pdfplumber.open(item["exported"]["file"]) as document:
        assert len(document.pages) == 1
        page = document.pages[0]
        actual = [page.width * 25.4 / 72, page.height * 25.4 / 72]
        assert all(abs(a - b) < 1 for a, b in zip(actual, expected)), item["name"]
        assert len(page.lines) == 6200
        assert all(abs(line["y1"] - line["y0"]) < 0.01 for line in page.lines)
        if orientation == "landscape":
            assert all(abs((line["x1"] - line["x0"]) * 25.4 / 72 - 0.1) < 0.05 for line in page.lines)
            assert abs((max(line["x1"] for line in page.lines) - min(line["x0"] for line in page.lines)) * 25.4 / 72 - 19.9) < 0.05
        matrix.append({"paper": paper, "orientation": orientation, "displayedPageMm": actual})

result = {"ok": True, "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
          "pluginSHA256": report["pluginSHA256"], "pdfSHA256": pdf["sha256"],
          "checks": ["Displayed A3 landscape orientation", "6200 physical 1:10 vectors and text",
                     "All ten ISO paper/orientation combinations", "Five physical 1:100 outputs"],
          "compound": main, "matrix": matrix,
          "scope": "Current-machine synthetic PDFs; no all-font, standards or external-user acceptance."}
pathlib.Path(sys.argv[2]).write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"ok": True, "checks": len(result["checks"]), "compound": main}))
