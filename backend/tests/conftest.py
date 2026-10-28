import os

os.environ.setdefault("SITELINE_ACTORS", "0")  # no scripted teammates during tests

import pytest
from fastapi.testclient import TestClient

from app.events import hub
from app.main import app, reset_everything


class Api:
    """A signed-in client: api.get('/me'), api.post(...). Raises nothing; check .status_code."""

    def __init__(self, client: TestClient, email: str):
        r = client.post("/auth/otp/verify", json={"email": email, "code": "123456"})
        assert r.status_code == 200, r.text
        body = r.json()
        self.client = client
        self.user = body["user"]
        self.token = body["accessToken"]
        self.refresh = body["refreshToken"]
        self.headers = {"Authorization": f"Bearer {self.token}"}

    def get(self, path, **kw):
        return self.client.get(path, headers=self.headers, **kw)

    def post(self, path, json=None, **kw):
        return self.client.post(path, json=json, headers=self.headers, **kw)

    def patch(self, path, json=None):
        return self.client.patch(path, json=json, headers=self.headers)

    def put(self, path, json=None):
        return self.client.put(path, json=json, headers=self.headers)

    def delete(self, path):
        return self.client.delete(path, headers=self.headers)


@pytest.fixture()
def client():
    with TestClient(app) as c:
        reset_everything()
        yield c


@pytest.fixture()
def login(client):
    return lambda email: Api(client, email)


def events_for(user_id: str, kind: str | None = None) -> list[dict]:
    return [e for targets, e in hub.recent if user_id in targets and (kind is None or e["type"] == kind)]


def project_id(api: Api, name: str) -> str:
    return next(p["id"] for p in api.get("/projects").json()["projects"] if p["name"].startswith(name))


def task_named(api: Api, project: str, name: str) -> dict:
    tasks = api.get(f"/projects/{project_id(api, project)}/tasks").json()["tasks"]
    return next(t for t in tasks if t["name"] == name)


def channel_named(api: Api, project: str | None, name: str) -> dict:
    pid = project_id(api, project) if project else None
    return next(c for c in api.get("/channels").json()["channels"] if c["name"] == name and c["projectId"] == pid)
