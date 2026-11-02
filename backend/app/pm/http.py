"""The company's real PM app, over the API Siteline asked the PM team for (spec §9.3). Same calls as mock.py.
Not used until a company's link is switched to kind 'http'."""
from __future__ import annotations

import httpx

from .mock import Refused, Unavailable

TIMEOUT = httpx.Timeout(10.0, connect=3.0)
RECHECK_TIMEOUT = httpx.Timeout(3.0)  # the re-check before a check-in waits at most this long (§8.1)


class Client:
    def __init__(self, base_url: str, api_key: str):
        self.base = base_url.rstrip("/")
        self.headers = {"Authorization": f"Bearer {api_key}", "Accept": "application/json"}

    def _get(self, path: str, params: dict | None = None, timeout: httpx.Timeout = TIMEOUT):
        try:
            r = httpx.get(self.base + path, params=params, headers=self.headers, timeout=timeout)
        except httpx.HTTPError as e:
            raise Unavailable(str(e)) from e
        if r.status_code == 404:
            return None
        if r.status_code >= 400:
            raise Unavailable(f"PM app answered {r.status_code}")
        return r.json()

    def list_projects(self) -> list[dict]:
        return self._get("/projects") or []

    def list_members(self, project_id: str) -> list[dict]:
        return self._get(f"/projects/{project_id}/members") or []

    def list_tasks(self, project_id: str | None = None) -> list[dict]:
        return self._get("/tasks", {"projectId": project_id} if project_id else None) or []

    def get_task(self, task_id: str) -> dict | None:
        return self._get(f"/tasks/{task_id}", timeout=RECHECK_TIMEOUT)

    def write_status(self, task_id: str, change: dict, key: str) -> dict:
        try:
            r = httpx.post(f"{self.base}/tasks/{task_id}/status", json=change,
                           headers={**self.headers, "Idempotency-Key": key}, timeout=TIMEOUT)
        except httpx.HTTPError as e:
            raise Unavailable(str(e)) from e
        if r.status_code in (403, 404, 409, 422):
            reason = (r.json() if r.headers.get("content-type", "").startswith("application/json") else {}).get("message")
            raise Refused(reason or "The PM app didn't accept this update")
        if r.status_code >= 400:
            raise Unavailable(f"PM app answered {r.status_code}")
        return r.json()
