class TestAuth:
    def test_register_then_me(self, client, auth_headers):
        headers, user = auth_headers()
        assert user["display_name"] == "Camille"
        resp = client.get("/api/auth/me", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["email"] == "parent1@test.fr"

    def test_login_ok(self, client, auth_headers):
        auth_headers()
        resp = client.post("/api/auth/login", json={"email": "parent1@test.fr", "password": "motdepasse1"})
        assert resp.status_code == 200
        assert resp.json()["access_token"]

    def test_login_wrong_password(self, client, auth_headers):
        auth_headers()
        resp = client.post("/api/auth/login", json={"email": "parent1@test.fr", "password": "mauvais-mdp"})
        assert resp.status_code == 401

    def test_duplicate_email_409(self, client, auth_headers):
        auth_headers()
        resp = client.post(
            "/api/auth/register",
            json={"email": "PARENT1@test.fr", "password": "motdepasse1", "display_name": "X"},
        )
        assert resp.status_code == 409

    def test_me_without_token_401(self, client):
        assert client.get("/api/auth/me").status_code == 401

    def test_me_garbage_token_401(self, client):
        assert client.get("/api/auth/me", headers={"Authorization": "Bearer nimportequoi"}).status_code == 401

    def test_update_profile(self, client, auth_headers):
        headers, _ = auth_headers()
        resp = client.patch("/api/auth/me", json={"color": "#aa3355"}, headers=headers)
        assert resp.status_code == 200
        assert resp.json()["color"] == "#aa3355"
