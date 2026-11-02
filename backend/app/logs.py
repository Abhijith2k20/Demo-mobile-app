"""Logging and error tracking (spec §10.10). JSON lines with request and company ids; never codes, tokens,
API keys or message bodies. Sentry when SENTRY_DSN is set."""
from __future__ import annotations

import json
import logging
import os
import sys
from contextvars import ContextVar

request_id: ContextVar[str] = ContextVar("request_id", default="")


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        out = {"level": record.levelname, "logger": record.name, "msg": record.getMessage()}
        if rid := request_id.get():
            out["request_id"] = rid
        if record.exc_info:
            out["error"] = self.formatException(record.exc_info)
        return json.dumps(out)


def setup_logging() -> None:
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JsonFormatter() if os.environ.get("SITELINE_ENV", "development") != "development"
                         else logging.Formatter("%(levelname)s %(name)s: %(message)s"))
    logging.basicConfig(level=logging.INFO, handlers=[handler], force=True)
    if dsn := os.environ.get("SENTRY_DSN"):
        import sentry_sdk

        sentry_sdk.init(dsn=dsn, environment=os.environ.get("SITELINE_ENV", "development"), traces_sample_rate=0.1,
                        send_default_pii=False)
