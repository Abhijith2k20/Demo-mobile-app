from app import db


def _signed_in(client):
    client.post("/platform/login", data={"email": "admin@siteline.app"})
    assert client.post("/platform/verify", data={"email": "admin@siteline.app", "code": "123456"}, follow_redirects=False).status_code == 303


def test_every_platform_page_renders_and_escapes_what_people_typed(client):
    _signed_in(client)  # the client keeps the cookie
    with db.transaction():
        cid = db.value("SELECT id FROM companies WHERE name = 'Paliath Interiors'")
        db.run("UPDATE companies SET name = %(n)s WHERE id = %(c)s", n="Paliath <script>alert(1)</script> & Co's", c=cid)

    pages = {"/platform": "Companies", f"/platform/companies/{cid}": "Mock PM app", "/platform/audit": "Audit log"}
    for path, heading in pages.items():
        r = client.get(path)
        assert r.status_code == 200 and heading in r.text, path
        assert "<script>alert(1)</script>" not in r.text, path
    company = client.get(f"/platform/companies/{cid}").text
    assert "Paliath &lt;script&gt;alert(1)&lt;/script&gt; &amp; Co&#39;s" in company
    # The confirm text is JSON inside a single-quoted attribute: the apostrophe can't end it.
    assert "Co\\u0027s" in company and "onsubmit='return confirm(" in company

    key = client.post(f"/platform/companies/{cid}/pm-key")
    assert key.status_code == 200 and "Webhook secret" in key.text
    client.cookies.clear()
    assert "Sign in to Siteline Platform" in client.get("/platform").text
    assert "Check your email" in client.post("/platform/login", data={"email": "nobody@example.com"}).text
