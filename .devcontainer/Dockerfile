FROM mcr.microsoft.com/devcontainers/python:1-3.12-bookworm

USER root

# OCR is optional in the parser, but include it for scanned plans. The other
# utilities support private service supervision and actual readiness checks.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        ca-certificates curl gh git procps ripgrep tesseract-ocr util-linux \
    && rm -rf /var/lib/apt/lists/*

USER vscode
