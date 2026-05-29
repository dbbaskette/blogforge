"""Global exception handling: log unhandled errors with a greppable id.

Without this, an unhandled exception (e.g. a DB IntegrityError) returns a
bare "Internal Server Error" and — depending on the uvicorn log config —
may not surface a traceback at all, making a user-reported "HTTP 500"
a scavenger hunt. We attach a short error id to both the logged traceback
and the JSON response so the two can be matched instantly.
"""
from __future__ import annotations

import logging
import secrets

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

_log = logging.getLogger("pencraft.errors")


def install_exception_handler(app: FastAPI) -> None:
    @app.exception_handler(Exception)
    async def _unhandled(request: Request, exc: Exception) -> JSONResponse:
        error_id = secrets.token_hex(4)
        _log.error(
            "unhandled error %s on %s %s",
            error_id,
            request.method,
            request.url.path,
            exc_info=exc,
        )
        return JSONResponse(
            status_code=500,
            content={
                "error": {
                    "code": "internal_error",
                    "id": error_id,
                    "message": "Something went wrong. Quote this id when reporting it.",
                }
            },
        )
