"""Safety properties of the benchmark, separate from extractor implementation tests."""
import importlib.util
import json
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location("evaluate_plan", ROOT / "scripts/evaluate-plan.py")
evaluator = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(evaluator)


class BaselineEvaluationTests(unittest.TestCase):
    def setUp(self):
        self.baseline = json.loads((ROOT / "fixtures/plans/groundtruth-a1.json").read_text())

    def test_one_candidate_cannot_satisfy_two_repeated_dimensions(self):
        expected = [
            {"id": "a", "inches": 48, "bbox": {"x": .2, "y": .2, "width": .02, "height": .02}},
            {"id": "b", "inches": 48, "bbox": {"x": .2, "y": .2, "width": .02, "height": .02}},
        ]
        actual = [{"id": "single", "kind": "dimension", "label": "4'-0\"", "originalValue": {"inches": 48}, "bbox": expected[0]["bbox"]}]
        matches, missing, _ = evaluator.match_items(expected, actual, self.baseline["matching"], True)
        self.assertEqual(len(matches), 1)
        self.assertEqual(len(missing), 1)

    def test_same_number_at_wrong_location_is_not_a_match(self):
        expected = [{"id": "a", "inches": 48, "bbox": {"x": .2, "y": .2, "width": .02, "height": .02}}]
        actual = [{"id": "wrong", "kind": "dimension", "label": "4'-0\"", "originalValue": {"inches": 48}, "bbox": {"x": .7, "y": .7, "width": .02, "height": .02}}]
        matches, missing, extra = evaluator.match_items(expected, actual, self.baseline["matching"], True)
        self.assertFalse(matches)
        self.assertEqual(len(missing), 1)
        self.assertEqual(len(extra), 1)

    def test_foreign_document_cannot_receive_baseline_score(self):
        with self.assertRaisesRegex(ValueError, "SHA-256"):
            evaluator.evaluate({"sourceSha256": "different"}, self.baseline)

    def test_empty_extraction_reports_unknown_precision_and_zero_recall(self):
        result = evaluator.evaluate({"sourceSha256": self.baseline["sourceSha256"], "page": {"number": 5}, "elements": [], "metrics": {"processingMs": 1}}, self.baseline)
        self.assertEqual(result["dimensions"]["recall"], 0)
        self.assertIsNone(result["dimensions"]["precisionWithinAnnotatedRegion"])
        self.assertIsNone(result["overallPlanAccuracy"])
        self.assertFalse(result["compliance"]["enabled"])
        self.assertIsNone(result["incorrectlyIdentifiedArchitecturalFeatures"]["count"])

    def test_baseline_defines_49_dimension_labels_and_blank_door_dimension(self):
        self.assertEqual(len(self.baseline["dimensions"]), 49)
        self.assertEqual(len({item["id"] for item in self.baseline["dimensions"]}), 49)
        blank_door = next(door for door in self.baseline["schedules"]["doors"] if door["mark"] == "3")
        self.assertIsNone(blank_door["widthInches"])
        self.assertIsNone(blank_door["heightInches"])

    def test_fabricated_blank_door_dimension_is_an_incorrect_schedule_row(self):
        actual = [{"id": "fabricated", "kind": "door_schedule", "schedule": {"mark": "3", "dimensionText": "3'-0\" x 6'-8\"", "widthInches": 36, "heightInches": 80, "type": "BI-FOLD", "notes": ["LAUNDRY ROOM"]}}]
        result = evaluator.evaluate_schedules(actual, self.baseline)
        self.assertEqual(result["matchedRows"], 0)
        self.assertEqual(len(result["incorrectRows"]), 1)
        self.assertEqual(result["incorrectRows"][0]["mark"], "3")


if __name__ == "__main__":
    unittest.main()
