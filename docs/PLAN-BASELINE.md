# A1 extraction baseline

The initial fixture is the **user-supplied** 14-page `SAN DIEGO COUNTY PLOT PLAN.pdf`, SHA-256 `89dbbd8f7977d772df44a4eea1a0ec35d795d9830538e3aa1e29f8d5bfe10bdc`. Page 5 is sheet A1, titled Floor Plan for “Detached Dwelling Unit (Plan F - 600 SF),” with the printed revision `PDS 671 (REV. 01/01/2026)`. Its page size is 1224 × 792 PDF points.

The user's [official-source reference](https://www.sandiegocounty.gov/content/dam/sdc/pds/bldg/adu_info/pds671_11x17.pdf) identifies County of San Diego Planning & Development Services. The attachment's visible title block agrees with that description. We have **not independently authenticated the attachment against a successful download of that URL**. The recorded hash identifies the exact uploaded bytes, not an independently established official-source checksum.

## Geographic and regulatory guard

This is a San Diego County extraction fixture. It is not a San José regulatory validation project. Its source/title block does not establish the actual permitting authority of any future property using these drawings.

Compliance results for this fixture are disabled. There are no verified San Diego rule results, and San José rules must never be applied to it. The printed revision date is not a permit application date or proof of an applicable code edition. A scale label, dimensions, or an official-looking drawing cannot establish code compliance or permit approval.

The initial production jurisdiction remains the **incorporated City of San José**, distinct from unincorporated Santa Clara County. Future executable checks must gate on confirmed actual jurisdiction, project application date and classification, applicable code edition, and verified rule version/source/effective dates. Reliable floor-plan extraction is the current milestone; activation of limited verified San José checks follows independent regulatory validation.

## Independently defined assertions

[`fixtures/plans/groundtruth-a1.json`](../fixtures/plans/groundtruth-a1.json) is test-only reference data. It was transcribed by visually examining the actual rendered A1 drawing, consulting its embedded text to resolve small glyphs, separately from the application extractor output. This is developer visual transcription, **not a licensed professional review**, certified survey, or architectural/code approval.

The fixture defines these finite assertion sets:

| Assertion set | Expected observations | What it measures |
| --- | ---: | --- |
| Exterior/interior dimension chains | 31 printed dimension tokens | Text value and approximate label location |
| Five rooms' printed dimensions | 10 tokens | Text value and approximate label location |
| Ceiling-height labels | 5 tokens | Printed text, without identifying a measured ceiling |
| Shower-size annotation | 2 tokens | Printed 72-inch and 30-inch values |
| Pony-wall maximum-height annotation | 1 token | An annotated limit, **not an observed constructed height** |
| Named room/space labels | 6 labels | Bedroom, bath, kitchen, living room, dining room, closet |
| Window schedule | 4 rows | Marks, printed sizes, type, and printed tempered markers |
| Door schedule | 4 rows | Marks, printed sizes where present, type, notes |
| Drawing scale | 1 label | `1/4" = 1'-0"`; no physical scale calibration |

The room/space-label benchmark excludes fixture/appliance labels; it is not a benchmark of every architectural feature. Door mark 3 has a blank dimension cell, so its size must remain unknown. Blank window tempered cells mean no `Y` marker is printed; they do not prove untempered construction.

The 49-token dimension universe covers the complete manually enumerated drawing-region labels, including interior/exterior chains, room dimensions, ceilings, shower dimensions, and the pony-wall annotation. It excludes schedule dimensions, scale ratios, wall construction labels, and general-note prose. These exclusions are explicit to keep printed measured values separate from unrelated numbers. They are not claims that excluded information has been correctly parsed.

## Running and reading the benchmark

After generating an extractor artifact from the uploaded PDF's page 5, run from the repository root:

```sh
python scripts/evaluate-plan.py \
  --extraction artifacts/plan-baseline-extraction.json \
  --groundtruth fixtures/plans/groundtruth-a1.json \
  --output artifacts/plan-baseline-metrics.json
python -m unittest discover -s tests/python -p 'test_plan_accuracy.py' -v
```

The evaluator refuses another document hash or another page. It matches numeric inches and approximate label positions one-to-one, so one repeated 4-foot label cannot satisfy several expected dimensions. Position tolerances account for manually approximated boxes and PDF text spans containing more than one token. They are not a geometric accuracy tolerance for architectural measurements.

The metrics artifact records matched dimensions by group, every missed expected dimension, every unmatched candidate in the annotated drawing region, and every dimension candidate outside the benchmark. It also includes room-label results, semantic checks of all eight schedule rows, the printed scale-text check, unscored prose annotations for manual inspection, and the extractor's measured processing time. Schedule checks cover printed mark, type, sizes/blank dimensions, door notes, and window `Y` markers. They do not test physical opening locations. Timing excludes upload, queuing, rendering, human correction, and benchmark execution.

Precision and recall refer only to the defined label assertion sets. They do not measure room polygons, wall topology, door/window placement, dimension-to-wall association, OCR performance across arbitrary plans, or full-plan understanding. Overall plan accuracy and incorrectly identified geometric-feature counts remain **unknown**, rather than silently reported as zero errors. There are no verified compliance findings in this benchmark.

The evaluator's six safety tests cover duplicate matching, wrong-location rejection, source-hash mismatch, honest empty-extraction scores, the missing door-schedule dimension, and rejection of a fabricated dimension for that blank door row. Reference assertions are never imported into extraction or used to populate application results.

## Measured A1 result

The actual extractor artifact was evaluated against the separate assertions, with the following finite-baseline results:

| Result | Observed |
| --- | ---: |
| Printed dimension tokens matched | 49 / 49 |
| Missed drawing-region dimension labels | 0 |
| Unmatched dimension candidates in annotated drawing region | 0 |
| Named room/space labels matched | 6 / 6 |
| Semantically correct schedule rows | 8 / 8 |
| Printed scale label matched | 1 / 1 |
| Extractor duration in recorded validated run | 1925.78 ms |
| Verified compliance findings | 0; evaluation disabled |

Dimension-label precision/recall and room/space-label precision/recall are 1.0 **for these manually defined label sets only**. There were no extra schedule rows or incorrect schedule rows, and door mark 3's missing dimension remained unknown. The benchmark does not establish general drawing accuracy.

Manual review also examined the one emitted prose annotation outside those label assertion sets. Validation found a mixed-fraction parsing defect: `1-¼ INCHES` in a door-construction note initially lost the leading integer. The general parser was corrected, a regression assertion was added, and the regenerated artifact now preserves **1.25 inches**. This is note text, not a geometric feature or a San Diego compliance finding. It is reported separately from the 49-token dimension score, which excludes note prose. The scoped label score does not assert that every possible fact on the page has been extracted or correctly understood.

## Remaining validation

Before relying on measurements for any deterministic building-code check, add independently reviewed San José plans, feature associations, geometric/scale calibration tests, page rotation and scanned-document cases, and licensed professional review of each limited supported check. A successful A1 text benchmark is an extraction regression result, not completion of those broader validation tasks.
