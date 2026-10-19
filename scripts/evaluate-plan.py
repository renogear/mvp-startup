#!/usr/bin/env python3
"""Compare an extractor artifact with a separately maintained visual baseline.

Expected values are test-only. This script is never imported by the application
extractor and does not generate or amend extraction results.
"""
from __future__ import annotations

import argparse
from collections import Counter
import json
import math
from pathlib import Path


def center(box: dict) -> tuple[float, float]:
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def in_region(box: dict, region: dict) -> bool:
    x, y = center(box)
    return region["x"] <= x <= region["x"] + region["width"] and region["y"] <= y <= region["y"] + region["height"]


def normalize_label(value: str) -> str:
    return " ".join(value.upper().split())


def candidate_summary(element: dict) -> dict:
    return {key: element.get(key) for key in ("id", "kind", "label", "bbox", "originalValue", "method")}


def match_items(expected: list[dict], actual: list[dict], matching: dict, dimensions: bool) -> tuple[list[dict], list[dict], list[dict]]:
    """Maximum-cardinality one-to-one matching; repeated values are not reused."""
    adjacency: dict[int, list[int]] = {}
    for expected_index, item in enumerate(expected):
        ex, ey = center(item["bbox"])
        choices = []
        for actual_index, element in enumerate(actual):
            ax, ay = center(element["bbox"])
            if abs(ex - ax) > matching["xTolerance"] or abs(ey - ay) > matching["yTolerance"]:
                continue
            if dimensions:
                inches = (element.get("originalValue") or {}).get("inches")
                if not isinstance(inches, (int, float)) or not math.isfinite(inches) or abs(item["inches"] - inches) > matching["inchesTolerance"]:
                    continue
            elif normalize_label(item["label"]) != normalize_label(element["label"]):
                continue
            choices.append((abs(ex - ax) / matching["xTolerance"] + abs(ey - ay) / matching["yTolerance"], actual_index))
        adjacency[expected_index] = [index for _, index in sorted(choices)]
    owners: dict[int, int] = {}

    def assign(expected_index: int, visited: set[int]) -> bool:
        for actual_index in adjacency[expected_index]:
            if actual_index in visited:
                continue
            visited.add(actual_index)
            if actual_index not in owners or assign(owners[actual_index], visited):
                owners[actual_index] = expected_index
                return True
        return False

    for expected_index in range(len(expected)):
        assign(expected_index, set())
    matched_expected = set(owners.values())
    matches = [{"expectedId": expected[expected_index]["id"], "elementId": actual[actual_index]["id"]} for actual_index, expected_index in sorted(owners.items(), key=lambda pair: pair[1])]
    missing = [item for index, item in enumerate(expected) if index not in matched_expected]
    extra = [candidate_summary(element) for index, element in enumerate(actual) if index not in owners]
    return matches, missing, extra


def evaluate_schedules(page_elements: list[dict], baseline: dict) -> dict:
    """Compare row semantics; schedule rows are not physical opening locations."""
    actual = [element for element in page_elements if element.get("kind") in ("door_schedule", "window_schedule")]
    matched = []
    missing = []
    mismatches = []
    consumed = set()
    for name, kind in (("windows", "window_schedule"), ("doors", "door_schedule")):
        for expected in baseline["schedules"][name]:
            candidates = [element for element in actual if element["kind"] == kind and element.get("schedule", {}).get("mark") == expected["mark"] and element["id"] not in consumed]
            if not candidates:
                missing.append({"kind": kind, "mark": expected["mark"]})
                continue
            element = candidates[0]
            consumed.add(element["id"])
            row = element["schedule"]
            failures = []
            for field in ("widthInches", "heightInches"):
                found, wanted = row.get(field), expected[field]
                if wanted is None:
                    if found is not None or row.get("dimensionText") is not None:
                        failures.append(f"{field}: expected unknown/blank dimension")
                elif not isinstance(found, (int, float)) or abs(found - wanted) > baseline["matching"]["inchesTolerance"]:
                    failures.append(f"{field}: expected {wanted}, got {found}")
            if normalize_label(row.get("type") or "") != expected["type"]:
                failures.append("Incorrect opening type")
            notes = [normalize_label(note) for note in row.get("notes", [])]
            if name == "windows":
                marker = "Y" if "Y" in notes else None
                if marker != expected["temperedMarker"]:
                    failures.append("Incorrect printed tempered marker")
            elif notes != ([normalize_label(expected["notes"])] if expected["notes"] else []):
                failures.append("Incorrect door note text")
            summary = {"kind": kind, "mark": expected["mark"], "elementId": element["id"]}
            if failures:
                mismatches.append({**summary, "failures": failures})
            else:
                matched.append(summary)
    expected_count = len(baseline["schedules"]["doors"]) + len(baseline["schedules"]["windows"])
    return {
        "expectedRows": expected_count,
        "actualRows": len(actual),
        "matchedRows": len(matched),
        "recall": len(matched) / expected_count,
        "precision": len(matched) / len(actual) if actual else None,
        "matches": matched,
        "missingRows": missing,
        "incorrectRows": mismatches,
        "extraRows": [candidate_summary(element) for element in actual if element["id"] not in consumed],
        "scope": "Printed mark, type, dimensions/blank dimension, door notes, and window Y markers. No physical opening location or compliance claim.",
    }


def evaluate(extraction: dict, baseline: dict) -> dict:
    if extraction.get("sourceSha256") != baseline["sourceSha256"]:
        raise ValueError("Source SHA-256 differs from baseline; do not score another document against A1 assertions")
    if extraction.get("page", {}).get("number") != baseline["source"]["page"]:
        raise ValueError("Extracted page is not baseline page 5")
    expected_page = baseline["source"]["page"]
    page_elements = [e for e in extraction["elements"] if e.get("page") == expected_page]
    region_elements = [e for e in page_elements if in_region(e["bbox"], baseline["drawingRegion"])]
    dimensions = [e for e in region_elements if e.get("kind") == "dimension"]
    rooms = [e for e in region_elements if e.get("kind") == "room_label"]
    dimension_matches, missing_dimensions, extra_dimensions = match_items(baseline["dimensions"], dimensions, baseline["matching"], True)
    room_matches, missing_rooms, extra_rooms = match_items(baseline["rooms"], rooms, baseline["matching"], False)
    groups = sorted({item["group"] for item in baseline["dimensions"]})
    matched_ids = {item["expectedId"] for item in dimension_matches}
    dimension_groups = {group: {"expected": sum(item["group"] == group for item in baseline["dimensions"]), "matched": sum(item["group"] == group and item["id"] in matched_ids for item in baseline["dimensions"])} for group in groups}
    outside_dimensions = [candidate_summary(e) for e in page_elements if e.get("kind") == "dimension" and not in_region(e["bbox"], baseline["drawingRegion"])]
    schedules = [candidate_summary(e) for e in page_elements if e.get("kind") in ("door_schedule", "window_schedule")]
    scales = [candidate_summary(e) for e in page_elements if e.get("kind") == "scale"]
    scale_text = baseline["scale"]["printed"].replace(" ", "")
    scale_matches = [element for element in scales if element["label"].replace(" ", "") == scale_text]
    return {
        "schemaVersion": "1.0.0",
        "fixture": baseline["fixture"],
        "sourceSha256": baseline["sourceSha256"],
        "page": expected_page,
        "method": "One-to-one printed-label measurement matching by numeric inches and approximate location, not feature geometry validation.",
        "reviewQualification": baseline["review"]["qualification"],
        "allExtractedCandidateKinds": dict(Counter(element["kind"] for element in page_elements)),
        "unscoredAnnotationCandidatesForManualReview": [candidate_summary(element) for element in page_elements if element["kind"] == "annotation"],
        "dimensions": {
            "expected": len(baseline["dimensions"]),
            "candidatesInAnnotatedRegion": len(dimensions),
            "matched": len(dimension_matches),
            "recall": len(dimension_matches) / len(baseline["dimensions"]),
            "precisionWithinAnnotatedRegion": len(dimension_matches) / len(dimensions) if dimensions else None,
            "precisionScope": baseline["review"]["dimensionUniverse"],
            "groups": dimension_groups,
            "matches": dimension_matches,
            "missedDimensions": missing_dimensions,
            "unmatchedCandidatesInAnnotatedRegion": extra_dimensions,
            "outsideBenchmarkCandidatesNotScored": outside_dimensions,
        },
        "rooms": {
            "expected": len(baseline["rooms"]),
            "candidatesInAnnotatedRegion": len(rooms),
            "matched": len(room_matches),
            "recall": len(room_matches) / len(baseline["rooms"]),
            "precisionForDefinedRoomAndSpaceLabels": len(room_matches) / len(rooms) if rooms else None,
            "precisionScope": baseline["review"]["roomUniverse"],
            "matches": room_matches,
            "missedRooms": missing_rooms,
            "unmatchedCandidatesInAnnotatedRegion": extra_rooms,
        },
        "schedules": evaluate_schedules(page_elements, baseline),
        "scheduleCandidates": schedules,
        "scale": {"expectedLabels": 1, "matchedLabels": len(scale_matches), "candidates": scales, "calibrated": False, "scope": "Printed scale text only. No physical calibration or scale-derived measurements."},
        "processingMs": extraction["metrics"]["processingMs"],
        "timingScope": "Extractor-reported duration only; excludes upload, queue delay, PDF rendering, human review, and this comparison.",
        "incorrectlyIdentifiedArchitecturalFeatures": {
            "assessed": False,
            "count": None,
            "reason": "Label assertions cannot determine wall/room polygons, opening geometry, or whether a dimension belongs to a feature. Unmatched label candidates are listed separately for inspection."
        },
        "overallPlanAccuracy": None,
        "limitations": baseline["review"]["limitations"],
        "compliance": baseline["compliance"],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--extraction", type=Path, default=Path("artifacts/plan-baseline-extraction.json"))
    parser.add_argument("--groundtruth", type=Path, default=Path("fixtures/plans/groundtruth-a1.json"))
    parser.add_argument("--output", type=Path, default=Path("artifacts/plan-baseline-metrics.json"))
    parser.add_argument("--require-full-dimensions", action="store_true", help="Fail if any of the independently enumerated dimension labels are missed")
    args = parser.parse_args()
    result = evaluate(json.loads(args.extraction.read_text()), json.loads(args.groundtruth.read_text()))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps({"output": str(args.output), "dimensionsMatched": result["dimensions"]["matched"], "dimensionsExpected": result["dimensions"]["expected"], "missedDimensions": len(result["dimensions"]["missedDimensions"]), "unmatchedDimensionCandidates": len(result["dimensions"]["unmatchedCandidatesInAnnotatedRegion"]), "roomLabelsMatched": result["rooms"]["matched"], "processingMs": result["processingMs"], "complianceEnabled": False}))
    if args.require_full_dimensions and result["dimensions"]["missedDimensions"]:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
