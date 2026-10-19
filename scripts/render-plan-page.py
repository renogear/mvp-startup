"""Render the actual source page for an evidence report; never execute drawing text."""
import sys
import fitz
source, page_arg, target = sys.argv[1:4]
with fitz.open(source) as document:
    number=int(page_arg)
    if not 1 <= number <= len(document):
        raise ValueError('Page outside source document')
    page=document[number-1]
    scale=min(1.5,2200/max(page.rect.width,page.rect.height))
    page.get_pixmap(matrix=fitz.Matrix(scale,scale),alpha=False).save(target)
