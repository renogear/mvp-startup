#!/usr/bin/env python3
"""Extract source-backed architectural label candidates; never evaluate compliance."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import math
import re
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

import fitz

SCHEMA_VERSION = "1.0"
MAX_BYTES = 50 * 1024 * 1024
MAX_SPANS = 20000
MAX_ELEMENTS = 5000
NUM = r"(?:\d+(?:\.\d+)?(?:[- ]+\d+/\d+)?|\d+/\d+)"
FEET = re.compile(rf"(?<![\w.])(?P<feet>{NUM})\s*(?:'|ft\b|feet\b)\s*(?:-?\s*(?P<inches>{NUM})\s*(?:\"|in\b|inches\b))?", re.I)
INCHES = re.compile(rf"(?<![\w.])(?P<inches>{NUM})\s*(?:\"|in\b|inches\b)", re.I)
METRIC = re.compile(rf"(?<![\w.])(?P<value>{NUM})\s*(?P<unit>mm|cm|m)\b", re.I)
ROOM = re.compile(r"^(?:(?:PRIMARY|MASTER|GUEST|FAMILY|GREAT|LIVING|DINING|LAUNDRY|UTILITY|MECHANICAL|STORAGE|MUD|BED)\s*(?:ROOM|RM)|BEDROOM|BATH(?:ROOM)?|KITCHEN|CLOSET|W\.?I\.?C\.?|GARAGE|PANTRY|FOYER|ENTRY|HALL(?:WAY)?|CORRIDOR|OFFICE|DEN|PORCH|DECK|BALCONY|LAUNDRY)(?:\s*(?:#?\d+|[A-Z]))?$", re.I)


def normalized_text(text: str) -> str:
    return text.translate(str.maketrans({"′": "'", "’": "'", "‘": "'", "″": '"', "“": '"', "”": '"', "–": "-", "−": "-", "½": " 1/2", "¼": " 1/4", "¾": " 3/4", "⅛": " 1/8", "⅜": " 3/8", "⅝": " 5/8", "⅞": " 7/8"}))


def number(text: str) -> float:
    parts = text.replace("-", " ").split()
    value = 0.0
    for part in parts:
        if "/" in part:
            top, bottom = part.split("/")
            if float(bottom) == 0:
                raise ValueError("Zero denominator")
            value += float(top) / float(bottom)
        else:
            value += float(part)
    if not math.isfinite(value):
        raise ValueError("Non-finite measurement")
    return value


def parse_dimensions(text: str) -> list[dict]:
    """Numeric unit parsing only. Returned offsets refer to normalized source text."""
    text = normalized_text(text)
    found: list[dict] = []
    occupied = []
    for regex, family in [(FEET, "ft"), (INCHES, "in"), (METRIC, "metric")]:
        for match in regex.finditer(text):
            if any(match.start() < end and match.end() > start for start, end in occupied):
                continue
            try:
                if family == "ft":
                    ft = number(match["feet"])
                    inch = number(match["inches"]) if match["inches"] else 0
                    # A composite feet/inches token cannot contain >= 12 residual inches.
                    if inch >= 12:
                        continue
                    value, unit, inches = ft + inch / 12, "ft", ft * 12 + inch
                elif family == "in":
                    value, unit = number(match["inches"]), "in"
                    inches = value
                else:
                    value, unit = number(match["value"]), match["unit"].lower()
                    inches = value * {"mm": 1 / 25.4, "cm": 1 / 2.54, "m": 100 / 2.54}[unit]
            except (ValueError, ZeroDivisionError):
                continue
            found.append({"start": match.start(), "end": match.end(), "text": match[0], "value": round(value, 8), "unit": unit, "inches": round(inches, 8)})
            occupied.append((match.start(), match.end()))
    return sorted(found, key=lambda item: item["start"])


def display_rect(rect, page) -> fitz.Rect:
    return (fitz.Rect(rect) * page.rotation_matrix) & page.rect


def bbox(rect: fitz.Rect, page) -> dict:
    rect = rect & page.rect
    return {"x": round(max(0, rect.x0) / page.rect.width, 7), "y": round(max(0, rect.y0) / page.rect.height, 7), "width": round(max(0, rect.width) / page.rect.width, 7), "height": round(max(0, rect.height) / page.rect.height, 7)}


def union_rect(items) -> fitz.Rect:
    rect = fitz.Rect(items[0])
    for item in items[1:]:
        rect |= fitz.Rect(item)
    return rect


def embedded_spans(page) -> list[dict]:
    spans = []
    for block in page.get_text("rawdict")["blocks"]:
        for line in block.get("lines", []):
            for span in line.get("spans", []):
                chars = span.get("chars", [])
                text = "".join(char["c"] for char in chars).strip()
                if not text:
                    continue
                # Keep untrimmed character positions for exact numeric substring rectangles.
                original = "".join(char["c"] for char in chars)
                left_trim = len(original) - len(original.lstrip())
                spans.append({"text": text, "rect": display_rect(span["bbox"], page), "chars": chars[left_trim:left_trim + len(text)], "method": "embedded_text", "confidence": "high"})
    return spans


def ocr_spans(page, warnings: list[str]) -> list[dict]:
    if not shutil.which("tesseract"):
        warnings.append("OCR unavailable: install Tesseract to extract raster-only text. Unread text remains unknown.")
        return []
    # Rasterizing page.rect preserves the display orientation, including PDF rotation.
    zoom = min(2.5, 5000 / max(page.rect.width, page.rect.height))
    if zoom <= 0:
        return []
    pix = page.get_pixmap(matrix=fitz.Matrix(zoom, zoom), alpha=False)
    with tempfile.TemporaryDirectory(prefix="permitpilot-ocr-") as directory:
        image_path = Path(directory) / "page.png"
        pix.save(image_path)
        result = subprocess.run(["tesseract", str(image_path), "stdout", "--psm", "11", "tsv"], capture_output=True, text=True, timeout=120, check=False)
    if result.returncode:
        warnings.append("OCR failed; raster text remains unknown.")
        return []
    groups: dict[tuple, list[dict]] = {}
    for item in csv.DictReader(io.StringIO(result.stdout), delimiter="\t"):
        if item.get("level") != "5" or not item.get("text", "").strip():
            continue
        try:
            if float(item["conf"]) < 20:
                continue
            key = (item["block_num"], item["par_num"], item["line_num"])
            groups.setdefault(key, []).append(item)
        except (ValueError, KeyError):
            continue
    spans = []
    for words in groups.values():
        rects = [fitz.Rect(float(w["left"]) / zoom, float(w["top"]) / zoom, (float(w["left"]) + float(w["width"])) / zoom, (float(w["top"]) + float(w["height"])) / zoom) for w in words]
        spans.append({"text": " ".join(w["text"] for w in words), "rect": union_rect(rects), "chars": [], "method": "ocr", "confidence": "low"})
    warnings.append("OCR candidates require human review; no OCR measurement is accepted as verified.")
    return spans


def substring_rect(span, start: int, end: int, page) -> fitz.Rect:
    # Unicode fraction expansion changes offsets, so preserve the whole span in that case.
    chars = span["chars"]
    if chars and normalized_text(span["text"]) == span["text"] and end <= len(chars):
        return union_rect([display_rect(char["bbox"], page) for char in chars[start:end]])
    return span["rect"]


def extract(input_path: Path, page_number: int, document_id: str, enable_ocr: bool = True) -> dict:
    started = time.perf_counter()
    if input_path.stat().st_size > MAX_BYTES:
        raise ValueError("File exceeds the 50 MB processor limit")
    source_bytes = input_path.read_bytes()
    source_hash = hashlib.sha256(source_bytes).hexdigest()
    is_image = source_bytes.startswith((b"\x89PNG\r\n\x1a\n", b"\xff\xd8\xff"))
    if not (is_image or source_bytes.startswith(b"%PDF-")):
        raise ValueError("Only PDF, PNG, and JPEG documents are supported")
    document = fitz.open(input_path)
    if document.is_encrypted:
        raise ValueError("Password-protected files must be unlocked before extraction")
    if not document.is_pdf:
        if document.page_count != 1 or not is_image:
            raise ValueError("Only PDF, PNG, and JPEG documents are supported")
        document = fitz.open("pdf", document.convert_to_pdf())
    if not 1 <= page_number <= len(document):
        raise ValueError(f"Page must be between 1 and {len(document)}")
    if len(document) > 500:
        raise ValueError("Documents over 500 pages are unsupported")
    page = document[page_number - 1]
    if min(page.rect.width, page.rect.height) <= 0 or max(page.rect.width, page.rect.height) > 20000:
        raise ValueError("Invalid or excessively large page dimensions")
    warnings = ["Label and dimension candidates describe printed text, not measured physical geometry, room boundaries, or code compliance.", "No compliance checks have been executed. Jurisdiction, permit date, code edition, and verified rule versions must be established separately."]
    spans = embedded_spans(page)
    embedded_count = len(spans)
    image_count = len(page.get_image_info())
    drawings = page.get_drawings()
    vector_count = sum(len(drawing.get("items", [])) for drawing in drawings)
    ocr_count = 0
    if enable_ocr and embedded_count < 5 and image_count:
        additional = ocr_spans(page, warnings)
        # Avoid duplicating text where OCR overlaps already embedded content.
        for span in additional:
            if not any((span["rect"] & old["rect"]).get_area() > span["rect"].get_area() * .5 for old in spans):
                spans.append(span)
                ocr_count += 1
    elif image_count:
        warnings.append("Images occur on this page. OCR of image-only regions was not run because embedded text is available; text inside images may be missed.")
    if len(spans) > MAX_SPANS:
        warnings.append(f"Text output truncated to {MAX_SPANS} spans.")
        spans = spans[:MAX_SPANS]
    if not spans:
        warnings.append("No readable text was extracted; all architectural facts remain unknown.")
    elements = []

    def element(kind, label, rect, evidence, method="embedded_text", confidence="medium", **extra):
        coords = bbox(rect, page)
        identity = json.dumps([document_id, page_number, kind, label, coords], sort_keys=True)
        item = {"id": hashlib.sha256(identity.encode()).hexdigest()[:24], "kind": kind, "label": label[:1000], "bbox": coords, "page": page_number, "method": method, "confidence": confidence, "evidence": evidence[:3000], "verification": "unreviewed", **extra}
        elements.append(item)
        return item

    # Detect generic schedule tables spatially, using their own headings and column headers.
    # Table row locations are NOT locations of physical doors/windows on the floor plan.
    schedule_regions = []
    for heading in spans:
        text = heading["text"].strip().upper()
        if not re.fullmatch(r"(?:DOOR|WINDOW)\s+SCHEDULE", text):
            continue
        family = "door" if text.startswith("DOOR") else "window"
        hr = heading["rect"]
        near = [s for s in spans if hr.y1 <= s["rect"].y0 <= hr.y1 + 30 and abs(s["rect"].x0 - hr.x0) < 180 and s["text"].upper() in ("MARK", "DIMENSION", "SIZE", "TYPE", "TEMPERED", "NOTES")]
        marks = [s for s in near if s["text"].upper() == "MARK"]
        if not marks:
            element(f"{family}_schedule", heading["text"], hr, heading["text"], heading["method"], "low", context="schedule_heading_only")
            continue
        mark_col = min(marks, key=lambda s: abs(s["rect"].x0 - hr.x0))
        header_y = mark_col["rect"].y0
        cols = [s for s in near if abs(s["rect"].y0 - header_y) < 3 and s["rect"].x0 >= mark_col["rect"].x0 - 3]
        cols.sort(key=lambda s: s["rect"].x0)
        left = mark_col["rect"].x0 - 15
        right = max(s["rect"].x1 for s in cols) + 100
        candidates = [s for s in spans if left <= s["rect"].x0 < right and header_y + 5 < s["rect"].y0 < header_y + 100]
        row_marks = sorted([s for s in candidates if re.fullmatch(r"[A-Z]|\d{1,2}", s["text"].strip()) and abs(s["rect"].x0 - mark_col["rect"].x0) < 12], key=lambda s: s["rect"].y0)
        for index, mark in enumerate(row_marks):
            y = mark["rect"].y0
            row = [s for s in candidates if abs(s["rect"].y0 - y) <= 2.5]
            row.sort(key=lambda s: s["rect"].x0)
            if not row:
                continue
            evidence = " | ".join(s["text"] for s in row)
            dims = [(s, parse_dimensions(s["text"])) for s in row if re.search(r"\s[x×]\s", s["text"], re.I)]
            dimension_span, dimensions = dims[0] if dims else (None, [])
            type_values = [s["text"] for s in row if re.fullmatch(r"(?:SLIDING|SWINGING|BI[- ]?FOLD|FIXED|CASEMENT|AWNING|SINGLE[- ]HUNG|DOUBLE[- ]HUNG)", s["text"], re.I)]
            extra = {"mark": mark["text"], "dimensionText": dimension_span["text"] if dimension_span else None, "type": type_values[0] if type_values else None, "notes": [s["text"] for s in row if s != mark and s != dimension_span and s["text"] not in type_values]}
            if len(dimensions) >= 2:
                extra.update(widthInches=dimensions[0]["inches"], heightInches=dimensions[1]["inches"])
            row_rect = union_rect([s["rect"] for s in row])
            element(f"{family}_schedule", f"{family.title()} {mark['text']}: {evidence}", row_rect, evidence, heading["method"], "medium", schedule=extra, context="schedule_row_not_physical_location")
            schedule_regions.append(row_rect + (-3, -3, 3, 3))
        schedule_regions.append(hr)

    for span in spans:
        text, rect = span["text"], span["rect"]
        if any((rect & region).get_area() > rect.get_area() * .5 for region in schedule_regions):
            continue
        clean = re.sub(r"\s+", " ", text).strip()
        common = {"method": span["method"], "confidence": "medium" if span["method"] == "embedded_text" else "low"}
        if ROOM.fullmatch(clean):
            element("room_label", clean, rect, text, **common, context="label_only_boundary_unknown")
        normalized = normalized_text(text)
        measurements = parse_dimensions(text)
        if "=" in normalized and (measurements or re.search(r"\d+\s*:\s*\d+", normalized)):
            element("scale", clean, rect, text, **common, context="printed_scale_requires_calibration")
            continue
        if re.fullmatch(r"(?i)\s*(?:SCALE\s*[:=]?\s*)?(?:\d+\s*:\s*\d+|N\.?T\.?S\.?|NOT TO SCALE)\s*", normalized):
            element("scale", clean, rect, text, **common, context="printed_scale_requires_calibration")
            continue
        for measurement in measurements:
            rest = normalized[:measurement["start"]] + normalized[measurement["end"]:]
            words = re.findall(r"[A-Za-z]{2,}", rest)
            # Long prose is a textual note, never a measured floor-plan dimension.
            prose = len(words) > 5
            context = "printed_dimension_unassociated"
            if "CEILING" in normalized.upper():
                context = "printed_ceiling_height"
            elif "HEIGHT" in normalized.upper():
                context = "printed_height_annotation"
            elif re.search(r"\s[x×]\s", normalized):
                context = "printed_dimension_pair_not_geometric_measurement"
            if prose:
                context = "note_text_not_geometric_measurement"
            original = {key: measurement[key] for key in ("value", "unit", "inches")}
            element("annotation" if prose else "dimension", measurement["text"], substring_rect(span, measurement["start"], measurement["end"], page), text, **common, originalValue=original, context=context)
    if len(elements) > MAX_ELEMENTS:
        warnings.append(f"Elements truncated to {MAX_ELEMENTS}.")
        elements = elements[:MAX_ELEMENTS]
    elements.sort(key=lambda item: (item["bbox"]["y"], item["bbox"]["x"], item["kind"]))
    # Geometry is preserved for future processing, never promoted to wall/room boundaries.
    vector_lines = []
    for drawing in drawings:
        for item in drawing.get("items", []):
            if item[0] == "l" and len(vector_lines) < 5000:
                p1, p2 = item[1] * page.rotation_matrix, item[2] * page.rotation_matrix
                vector_lines.append({"x1": round(p1.x / page.rect.width, 7), "y1": round(p1.y / page.rect.height, 7), "x2": round(p2.x / page.rect.width, 7), "y2": round(p2.y / page.rect.height, 7)})
    kind = "mixed" if image_count and (embedded_count or vector_count) else "raster" if image_count else "vector" if vector_count else "text"
    result = {"schemaVersion": SCHEMA_VERSION, "documentId": document_id, "sourceSha256": source_hash, "pageCount": len(document), "page": {"number": page_number, "width": page.rect.width, "height": page.rect.height, "rotation": page.rotation, "kind": kind, "cropbox": list(page.cropbox), "coordinateSystem": "normalized_top_left_displayed_page", "vectorLines": vector_lines, "vectorLinesTruncated": sum(1 for d in drawings for i in d.get("items", []) if i[0] == "l") > 5000}, "elements": elements, "textSpans": [{"text": s["text"][:3000], "bbox": bbox(s["rect"], page), "page": page_number, "method": s["method"]} for s in spans], "warnings": warnings, "metrics": {"processingMs": round((time.perf_counter() - started) * 1000, 2), "textSpanCount": len(spans), "embeddedTextSpanCount": embedded_count, "ocrTextSpanCount": ocr_count, "imageCount": image_count, "vectorPrimitiveCount": vector_count, "elementCount": len(elements), "roomLabelCount": sum(e["kind"] == "room_label" for e in elements), "dimensionCount": sum(e["kind"] == "dimension" for e in elements)}}
    document.close()
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("input", type=Path)
    parser.add_argument("--page", type=int, default=1, help="One-based page number")
    parser.add_argument("--document-id", required=True)
    parser.add_argument("--no-ocr", action="store_true")
    args = parser.parse_args()
    try:
        result = extract(args.input, args.page, args.document_id, not args.no_ocr)
    except Exception as error:
        print(json.dumps({"error": str(error), "type": type(error).__name__}), file=sys.stderr)
        return 1
    print(json.dumps(result, allow_nan=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
