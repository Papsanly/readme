#!/usr/bin/env python3
"""FastAPI app exposing the distilled/student VLM contract."""

from __future__ import annotations

from fastapi import FastAPI, HTTPException

from .model import StudentBackend, StudentModelError, build_student_from_env
from .schemas import HealthResponse, VlmAnalyzePageRequest, VlmPageResult

app = FastAPI(
    title="ReadMe Student VLM Server",
    version="0.1.0",
    description="Inference endpoint for the ReadMe document-to-TTS student VLM.",
)

_student: StudentBackend | None = None


def get_student() -> StudentBackend:
    global _student
    if _student is None:
        _student = build_student_from_env()
    return _student


@app.get("/health", response_model=HealthResponse, response_model_exclude_none=True)
def health() -> HealthResponse:
    student = get_student()
    metadata = student.metadata
    return HealthResponse(
        status="ok",
        mode=metadata.mode,
        model=metadata.model,
        adapter=metadata.adapter,
    )


@app.post(
    "/analyze-page", response_model=VlmPageResult, response_model_exclude_none=True
)
def analyze_page(request: VlmAnalyzePageRequest) -> VlmPageResult:
    try:
        return get_student().analyze(request)
    except StudentModelError as exc:
        print(f"[student-vlm] StudentModelError: {exc}")
        raise HTTPException(status_code=500, detail=str(exc)) from exc
    except Exception as exc:  # noqa: BLE001 - keep server response structured
        print(f"[student-vlm] unexpected inference error: {type(exc).__name__}: {exc}")
        raise HTTPException(
            status_code=500, detail=f"student inference failed: {exc}"
        ) from exc
