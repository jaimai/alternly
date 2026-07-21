class TestMarketingPages:
    def test_landing(self, client):
        resp = client.get("/")
        assert resp.status_code == 200
        assert "calendrier de garde" in resp.text.lower()
        assert "/app/register" in resp.text

    def test_blog_index_lists_articles(self, client):
        resp = client.get("/blog")
        assert resp.status_code == 200
        # les articles embarqués dans content/blog doivent apparaître
        assert "/blog/" in resp.text

    def test_blog_article_renders(self, client):
        listing = client.get("/blog").text
        # extrait un slug présent dans la page
        import re
        slugs = re.findall(r'href="/blog/([a-z0-9-]+)"', listing)
        assert slugs, "aucun article publié"
        resp = client.get(f"/blog/{slugs[0]}")
        assert resp.status_code == 200
        assert "<h1>" in resp.text

    def test_blog_404(self, client):
        assert client.get("/blog/nexiste-pas").status_code == 404

    def test_robots_and_sitemap(self, client):
        robots = client.get("/robots.txt")
        assert robots.status_code == 200
        assert "Disallow: /app" in robots.text
        sitemap = client.get("/sitemap.xml")
        assert sitemap.status_code == 200
        assert "<urlset" in sitemap.text
        assert "/blog" in sitemap.text
