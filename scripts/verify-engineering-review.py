"""Verify private CAD PDFs, render final pages, merge a review booklet and verify ZIP bytes.
Usage: python scripts/verify-engineering-review.py REPORT.json REVIEW-DIRECTORY
Requires pypdf, pypdfium2 and Pillow. Start the PDF artifact marker before creation.
"""
import datetime
import hashlib
import json
import sys
import zipfile
from pathlib import Path

import pypdfium2 as pdfium
from PIL import Image
from pypdf import PdfReader, PdfWriter

report_file, bundle = map(Path, sys.argv[1:3])
report = json.loads(report_file.read_text(encoding="utf8"))
assert report["ok"]
qa = bundle.parent / (bundle.name + "-visual-qa")
qa.mkdir()
writer, pages, previews = PdfWriter(), [], []
for item in report["initialDelivery"]["files"]:
    if item["kind"] != "pdf":
        continue
    source = Path(item["file"])
    assert hashlib.sha256(source.read_bytes()).hexdigest() == item["sha256"]
    reader = PdfReader(source)
    assert len(reader.pages) == 1
    page = reader.pages[0]
    width, height = float(page.mediabox.width) * 25.4 / 72, float(page.mediabox.height) * 25.4 / 72
    assert abs(width - 420) < .25 and abs(height - 297) < .25
    assert len(page.extract_text()) > 100
    document = pdfium.PdfDocument(str(source))
    image = document[0].render(scale=1.25).to_pil().convert("RGB")
    image.save(qa / (source.stem + ".png"))
    previews.append(image)
    writer.append(reader)
    pages.append({"file": source.name, "widthMm": width, "heightMm": height, "sha256": item["sha256"]})
assert len(pages) == report["sheets"]
combined = bundle / "原任务待审图册.pdf"
with combined.open("xb") as stream:
    writer.write(stream)
assert len(PdfReader(combined).pages) == len(pages)
document = pdfium.PdfDocument(str(combined))
contact = Image.new("RGB", (800 * 2, 566 * ((len(pages) + 1) // 2)), "#dbe2e8")
for index in range(len(document)):
    image = document[index].render(scale=1.25).to_pil().convert("RGB")
    assert image.size == previews[index].size
    assert image.tobytes() == previews[index].tobytes(), "Merged PDF render differs from inspected source"
    image.thumbnail((800, 566))
    contact.paste(image, ((index % 2) * 800, (index // 2) * 566))
contact.save(qa / "final-booklet.png")
comments = {"scope": "实际专业审核意见格式，非已认证签审", "jobId": report["jobId"], "modelSHA256": report["modelSHA256"], "reviewer": "填写实际审核人", "comments": [{"target": "图号/房间/对象", "issue": "问题、依据、处理要求", "origin": "unverified_external_record"}], "professionalApproval": False}
(bundle / "人工审核意见格式.json").write_text(json.dumps(comments, ensure_ascii=False, indent=2), encoding="utf8")
manifest_file = bundle / "manifest.json"
manifest = json.loads(manifest_file.read_text(encoding="utf8"))
for file in [combined, bundle / "人工审核意见格式.json"]:
    manifest["files"].append({"file": file.name, "sha256": hashlib.sha256(file.read_bytes()).hexdigest()})
manifest_file.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf8")
archive_file = bundle.with_suffix(".zip")
with zipfile.ZipFile(archive_file, "x", zipfile.ZIP_DEFLATED) as archive:
    for file in sorted(bundle.rglob("*")):
        if file.is_file():
            archive.write(file, file.relative_to(bundle).as_posix())
with zipfile.ZipFile(archive_file) as archive:
    assert archive.testzip() is None
    for item in manifest["files"]:
        assert hashlib.sha256(archive.read(item["file"])).hexdigest() == item["sha256"]
evidence = {"ok": True, "checkedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(), "combined": str(combined), "zip": str(archive_file), "zipSHA256": hashlib.sha256(archive_file.read_bytes()).hexdigest(), "pages": pages, "qaFolder": str(qa), "mergedRenderIdentical": True, "visualReview": "pending_agent_inspection", "professionalApproval": False}
(bundle.parent / (bundle.name + "-verification.json")).write_text(json.dumps(evidence, ensure_ascii=False, indent=2), encoding="utf8")
print(json.dumps(evidence, ensure_ascii=False))
