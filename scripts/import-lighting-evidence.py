"""Bind a visually cross-checked local lighting-rule interpretation to PDF pixels.
Usage: python scripts/import-lighting-evidence.py MANIFEST.json EXPECTED-SHA256 NEW-PROFILE.json
Manifest numeric interpretations are operator inputs, not automatic OCR or certification.
Full PDFs, table images and output profile must remain outside public source.
"""
import datetime
import hashlib
import json
import sys
from pathlib import Path
import pypdfium2 as pdfium

manifest_file, expected, destination = Path(sys.argv[1]).resolve(), sys.argv[2].lower(), Path(sys.argv[3]).resolve()
raw = manifest_file.read_bytes()
assert hashlib.sha256(raw).hexdigest() == expected, "MANIFEST_CHANGED"
manifest = json.loads(raw.decode("utf8"))
assert manifest["schemaVersion"] == 1 and manifest["professionalApproval"] is False
assert not destination.exists(), "PROFILE_EXISTS: use a new version instead of overwriting"
sources, documents = [], {}
for source in manifest["sources"]:
    f = Path(source["file"]).resolve()
    data = f.read_bytes()
    assert data.startswith(b"%PDF") and hashlib.sha256(data).hexdigest() == source["sha256"].lower(), "PDF_SOURCE_CHANGED"
    document = pdfium.PdfDocument(str(f))
    documents[source["id"]] = document
    page = source["noticePdfPage"]
    assert 1 <= page <= len(document)
    image = document[page-1].render(scale=1.5).to_pil().convert("RGB")
    digest = hashlib.sha256(image.tobytes()).hexdigest()
    assert digest == source["noticePixelSHA256"].lower(), "NOTICE_WITNESS_CHANGED"
    sources.append(source)
tables = []
for table in manifest["tables"]:
    document = documents[table["sourceId"]]
    assert 1 <= table["pdfPage"] <= len(document)
    image = document[table["pdfPage"]-1].render(scale=1.5).to_pil().convert("RGB")
    assert hashlib.sha256(image.tobytes()).hexdigest() == table["pixelSHA256"].lower(), "TABLE_WITNESS_CHANGED"
    assert table["transcriptionMethod"] == "visual_transcription_cross_checked" and table["reviewer"].strip()
    assert hashlib.sha256(Path(table["crossCheckFile"]).read_bytes()).hexdigest() == table["crossCheckSHA256"].lower(), "CROSSCHECK_CHANGED"
    tables.append(table)
assert manifest["classes"], "EMPTY_INTERPRETATION"
profile = {"schemaVersion": 1, "id": manifest["id"], "createdAt": datetime.datetime.now(datetime.timezone.utc).isoformat(),
           "manifestSHA256": expected, "sourceScope": "inspected_edition_subset_not_professional_applicability",
           "sources": sources, "tables": tables, "classes": manifest["classes"], "professionalApproval": False}
destination.parent.mkdir(parents=True, exist_ok=True)
with destination.open("x", encoding="utf8") as stream:
    stream.write(json.dumps(profile, ensure_ascii=False, indent=2))
print(json.dumps({"ok": True, "profile": str(destination), "sha256": hashlib.sha256(destination.read_bytes()).hexdigest(),
                  "sources": len(sources), "tables": len(tables), "classes": len(profile["classes"]),
                  "scope": "Visual interpretation bound to original PDF pixels; no professional or complete compliance approval"}))
