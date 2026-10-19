# Floor-plan extraction processor

`processor/extract.py` processes the actual uploaded PDF/PNG/JPEG with PyMuPDF. It does not use embedded test fixtures or an LLM, and it does not evaluate building-code compliance. Python 3.10+ and the pinned dependency are required:

```sh
python -m pip install -r processor/requirements.txt
python processor/extract.py /path/to/drawing.pdf --page 5 --document-id UUID
python -m unittest discover -s tests/python -v
```

Standard output is one JSON object. Errors use standard error and a nonzero exit status. `--page` is one-based. `--no-ocr` disables optional Tesseract OCR. The caller must authorize the document and enforce application upload limits before invocation. The processor additionally rejects files above 50 MB, documents above 500 pages, unsupported signatures, and encrypted documents. It processes only the requested page; OCR has a 120-second subprocess timeout. Application deployments should also set an outer execution timeout and memory limit.

The output records `schemaVersion`, `documentId`, `sourceSha256`, `pageCount`, `page`, `elements`, `textSpans`, `warnings`, and `metrics`. Every element preserves source page, original text evidence, extraction method, review status, and bounding box. Bounding boxes use normalized coordinates relative to the **displayed** page, with origin at its top-left. Crop boxes and all four right-angle PDF rotations are handled; the viewer must display the same page orientation. Width/height in page metadata are displayed PDF points. Numerical `originalValue` preserves its parsed value/unit and a converted `inches` value. Source values are immutable; user corrections belong in separate review records.

Recognized candidates include room labels, printed dimension tokens, scale labels, and spatially associated door/window schedule rows. Schedule rows include `schedule.mark`, `dimensionText`, `type`, `notes`, and width/height in inches when both are printed. Missing schedule dimensions remain null/absent. Schedule locations are table rows, not physical opening locations. Room label rectangles are text rectangles, not room polygons. Textual height/ceiling annotations remain contextual measurements; long prose dimensions are classified as annotations. Printed scale must be checked before geometry-derived measurements. A printed dimension does not establish which physical feature it measures.

Text is extracted in native reading groups and then transformed into displayed coordinates. This avoids relying on an unreliable sorted text stream for rotated architectural PDFs. Character rectangles locate numeric substrings when possible; Unicode fraction expansion and OCR may preserve the enclosing text rectangle. Up to 20,000 text spans, 5,000 elements, and 5,000 vector line segments are returned. Truncation is explicit. Vector primitives are raw drawing geometry, not classified walls, room boundaries, doors, or windows.

Tesseract is optional (`apt install tesseract-ocr` where system installation is permitted). On pages with fewer than five embedded spans and images, the processor rasterizes the displayed page and OCRs it. OCR candidates have low confidence and always require review. Mixed pages with sufficient embedded text are not OCRed, and a warning explains that image-contained text may be missed. OCR confidence is not accuracy and does not verify a fact.

The uploaded San Diego County Plan F PDF is an extraction baseline only. Its SHA-256 is preserved in the generated artifact. No San José requirements are applied. The independent baseline fixture and scorer define evaluation expectations separately from extraction. Synthetic unit tests generate temporary PDFs and cover numeric units/fractions, all right-angle rotations with cropping, substring boxes, schedule association, unknown dimensions, OCR review status, source hashing, errors, and stable IDs. Real-drawing extraction accuracy is scoped to the explicitly transcribed text annotations; wall topology, room boundaries, physical feature detection, current code applicability, and technical compliance remain unverified.

PyMuPDF is AGPL-3.0/commercial dual licensed. Confirm that the application's distribution/deployment complies with the chosen license, or obtain a commercial license before a closed-source commercial release. This implementation does not disable TLS, signature, or checksum verification.
