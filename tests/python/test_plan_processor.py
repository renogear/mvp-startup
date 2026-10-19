"""Synthetic extraction tests; their expected values never seed runtime extraction."""
import hashlib
import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

import fitz

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from processor.extract import extract, parse_dimensions  # noqa: E402

DOCUMENT_ID = "11111111-1111-4111-8111-111111111111"


class Dimensions(unittest.TestCase):
    def assertInches(self, text, expected):
        values = parse_dimensions(text)
        self.assertEqual(len(values), len(expected), (text, values))
        for actual, expected_inches in zip(values, expected):
            self.assertAlmostEqual(actual["inches"], expected_inches, places=6)

    def test_feet_inches_and_decimal_feet(self):
        self.assertInches("12'-6\"; 8.5 ft; 4 feet 2 inches", [150, 102, 50])

    def test_fractional_inches(self):
        self.assertInches('1-3/8"; 2 1/2 inches; 1/4"', [1.375, 2.5, .25])

    def test_unicode_primes_and_fraction(self):
        self.assertInches("10′-6½″", [126.5])
        self.assertInches("RAISED PANELS 1-¼ INCHES THICK", [1.25])

    def test_metric(self):
        self.assertInches("254 mm; 25.4 cm; 2.54 m", [10, 10, 100])

    def test_multiple_dimensions_and_zero_inches(self):
        self.assertInches('(10\'-2" x 9\'-10") 8\'-0" CEILING', [122, 118, 96])

    def test_does_not_invent_units(self):
        self.assertInches("10 x 12; BEDROOM 2; 2025; 600 SF", [])


class PdfExtraction(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="permitpilot-synthetic-test-")
        self.folder = Path(self.temp.name)

    def tearDown(self):
        self.temp.cleanup()

    def pdf(self, texts, rotation=0, crop=None):
        document = fitz.open()
        page = document.new_page(width=600, height=500)
        for x, y, text in texts:
            page.insert_text((x, y), text, fontsize=12)
        if crop:
            page.set_cropbox(fitz.Rect(crop))
        page.set_rotation(rotation)
        path = self.folder / f"synthetic-{rotation}.pdf"
        document.save(path)
        document.close()
        return path

    def test_source_facts_and_provenance(self):
        path = self.pdf([(60, 60, "BEDROOM"), (60, 100, '12\'-6"'), (60, 140, '1/4" = 1\'-0"')])
        result = extract(path, 1, DOCUMENT_ID)
        self.assertEqual(result["sourceSha256"], hashlib.sha256(path.read_bytes()).hexdigest())
        self.assertEqual(result["documentId"], DOCUMENT_ID)
        self.assertEqual(result["pageCount"], 1)
        self.assertEqual([e["kind"] for e in result["elements"]], ["room_label", "dimension", "scale"])
        self.assertEqual(result["elements"][1]["originalValue"]["inches"], 150)
        for item in result["elements"]:
            self.assertEqual(item["page"], 1)
            self.assertEqual(item["verification"], "unreviewed")
            self.assertEqual(item["method"], "embedded_text")
        self.assertNotIn("complianceResults", result)

    def test_rotated_cropped_bounding_boxes_match_display_orientation(self):
        for rotation in [0, 90, 180, 270]:
            with self.subTest(rotation=rotation):
                path = self.pdf([(100, 120, '12\'-6"')], rotation, [40, 30, 560, 470])
                result = extract(path, 1, DOCUMENT_ID)
                actual = result["elements"][0]["bbox"]
                source = fitz.open(path)
                raw = source[0].get_text("dict")["blocks"][0]["lines"][0]["spans"][0]["bbox"]
                x0, y0, x1, y1 = raw
                w, h = 520, 440
                # Independent mathematical rotation, not the processor's helper.
                if rotation == 0:
                    expected = (x0 / w, y0 / h, (x1 - x0) / w, (y1 - y0) / h)
                elif rotation == 90:
                    expected = ((h - y1) / h, x0 / w, (y1 - y0) / h, (x1 - x0) / w)
                elif rotation == 180:
                    expected = ((w - x1) / w, (h - y1) / h, (x1 - x0) / w, (y1 - y0) / h)
                else:
                    expected = (y0 / h, (w - x1) / w, (y1 - y0) / h, (x1 - x0) / w)
                for key, value in zip(["x", "y", "width", "height"], expected):
                    self.assertAlmostEqual(actual[key], value, places=6)
                source.close()

    def test_numeric_bbox_preserves_character_positions(self):
        result = extract(self.pdf([(60, 80, '(10\'-2" x 9\'-10")')]), 1, DOCUMENT_ID)
        dimensions = result["elements"]
        self.assertEqual(len(dimensions), 2)
        self.assertLess(dimensions[0]["bbox"]["x"], dimensions[1]["bbox"]["x"])
        self.assertLess(dimensions[0]["bbox"]["x"] + dimensions[0]["bbox"]["width"], dimensions[1]["bbox"]["x"])

    def test_prose_is_annotation_without_geometry_claim(self):
        result = extract(self.pdf([(50, 90, 'Provide at least 36 inches clear at all entrances.')]), 1, DOCUMENT_ID)
        self.assertEqual(result["elements"][0]["kind"], "annotation")
        self.assertEqual(result["elements"][0]["context"], "note_text_not_geometric_measurement")

    def test_schedule_rows_preserve_unknown_dimensions(self):
        texts = [(50, 40, "DOOR SCHEDULE"), (50, 60, "MARK"), (100, 60, "DIMENSION"), (220, 60, "TYPE"), (320, 60, "NOTES"), (55, 80, "1"), (100, 80, '3\'-0" x 6\'-8"'), (220, 80, "SWINGING"), (55, 100, "2"), (220, 100, "BI-FOLD"), (320, 100, "LAUNDRY ROOM")]
        result = extract(self.pdf(texts), 1, DOCUMENT_ID)
        schedules = [e for e in result["elements"] if e["kind"] == "door_schedule"]
        self.assertEqual(len(schedules), 2)
        self.assertEqual(schedules[0]["schedule"]["widthInches"], 36)
        self.assertEqual(schedules[0]["schedule"]["heightInches"], 80)
        self.assertIsNone(schedules[1]["schedule"]["dimensionText"])
        self.assertNotIn("widthInches", schedules[1]["schedule"])
        self.assertFalse(any(e["kind"] == "room_label" for e in result["elements"]))

    def test_stable_ids_and_bounded_normalized_rectangles(self):
        path = self.pdf([(60, 60, "KITCHEN"), (60, 100, '12\'-6"')])
        first, second = extract(path, 1, DOCUMENT_ID), extract(path, 1, DOCUMENT_ID)
        self.assertEqual(first["elements"], second["elements"])
        for item in first["elements"]:
            rect = item["bbox"]
            self.assertGreaterEqual(rect["x"], 0)
            self.assertGreaterEqual(rect["y"], 0)
            self.assertLessEqual(rect["x"] + rect["width"], 1)
            self.assertLessEqual(rect["y"] + rect["height"], 1)

    def test_blank_page_reports_unknown_information(self):
        result = extract(self.pdf([]), 1, DOCUMENT_ID)
        self.assertEqual(result["elements"], [])
        self.assertTrue(any("all architectural facts remain unknown" in w for w in result["warnings"]))

    def test_rejects_invalid_page_and_non_document(self):
        with self.assertRaisesRegex(ValueError, "Page must"):
            extract(self.pdf([]), 2, DOCUMENT_ID)
        invalid = self.folder / "invalid.pdf"
        invalid.write_text("not a PDF")
        with self.assertRaisesRegex(ValueError, "Only PDF"):
            extract(invalid, 1, DOCUMENT_ID)

    def test_rejects_password_protected_pdf(self):
        document = fitz.open()
        document.new_page()
        path = self.folder / "encrypted.pdf"
        document.save(path, encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="synthetic-only", owner_pw="synthetic-owner")
        document.close()
        with self.assertRaisesRegex(ValueError, "Password-protected"):
            extract(path, 1, DOCUMENT_ID)

    def test_cli_emits_json_without_logs(self):
        path = self.pdf([(60, 60, "KITCHEN")])
        output = subprocess.run([sys.executable, str(ROOT / "processor/extract.py"), str(path), "--page", "1", "--document-id", DOCUMENT_ID], capture_output=True, text=True, check=True)
        self.assertEqual(json.loads(output.stdout)["elements"][0]["label"], "KITCHEN")
        self.assertEqual(output.stderr, "")

    @unittest.skipUnless(shutil.which("tesseract"), "Tesseract is optional")
    def test_raster_ocr_candidates_remain_unreviewed(self):
        path = self.pdf([(60, 100, "KITCHEN"), (60, 150, '12\'-6"')])
        document = fitz.open(path)
        raster = self.folder / "synthetic-raster.png"
        document[0].get_pixmap(matrix=fitz.Matrix(3, 3)).save(raster)
        document.close()
        result = extract(raster, 1, DOCUMENT_ID)
        self.assertEqual(result["page"]["kind"], "raster")
        self.assertGreater(result["metrics"]["ocrTextSpanCount"], 0)
        self.assertTrue(all(e["method"] == "ocr" and e["verification"] == "unreviewed" for e in result["elements"]))
        self.assertTrue(any("OCR candidates require human review" in w for w in result["warnings"]))


if __name__ == "__main__":
    unittest.main()
