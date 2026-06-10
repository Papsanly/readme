#!/usr/bin/env python3
"""Pydantic schemas mirroring `src/types/vlm.ts` for the student server."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

BlockType = Literal[
    "heading",
    "paragraph",
    "list",
    "quote",
    "caption",
    "figure",
    "page-number",
    "footnote",
    "header-footer",
    "toc",
    "service",
    "unknown",
]

VlmImageMimeType = Literal["image/png", "image/jpeg", "image/gif", "image/webp"]


class GlossaryItem(BaseModel):
    term: str
    pronunciation: str


class VlmContext(BaseModel):
    bookTitle: str | None = None
    bookDescription: str | None = None
    glossary: list[GlossaryItem] = Field(default_factory=list)
    skipping: str = "service-only"
    language: str | None = None


class VlmOcrBlockHint(BaseModel):
    id: str
    label: str
    text: str


class VlmBlock(BaseModel):
    type: BlockType
    text: str
    rawText: str | None = None
    caption: str | None = None
    isFigure: bool
    isMainContent: bool
    level: Literal[1, 2] | None = None
    ocrBlockIds: list[str] = Field(default_factory=list)


class VlmPageResult(BaseModel):
    blocks: list[VlmBlock]
    pageLanguage: str | None = None


class VlmAnalyzePageRequest(BaseModel):
    imageBase64: str
    imageMimeType: VlmImageMimeType = "image/png"
    context: VlmContext
    pageNumber: int
    totalPages: int
    ocrBlocks: list[VlmOcrBlockHint] = Field(default_factory=list)


class HealthResponse(BaseModel):
    status: str
    mode: str
    model: str | None = None
    adapter: str | None = None
