from pathlib import Path

import pytest

from app.services.blog import load_articles, render_article


@pytest.fixture
def content_dir(tmp_path):
    d = tmp_path / "blog"
    d.mkdir()
    (d / "premier-article.md").write_text(
        """---
title: Mon premier article
description: Une description SEO.
date: 2026-07-01
---

## Sous-titre

Du **contenu** en markdown.
""",
        encoding="utf-8",
    )
    (d / "second.md").write_text(
        """---
title: Second article
description: Autre description.
date: 2026-07-10
---

Texte.
""",
        encoding="utf-8",
    )
    (d / "brouillon.md").write_text(
        """---
title: Brouillon
description: Pas prêt.
date: 2026-07-15
draft: true
---

Caché.
""",
        encoding="utf-8",
    )
    return d


class TestBlog:
    def test_load_articles_sorted_desc_and_skips_drafts(self, content_dir):
        articles = load_articles(content_dir)
        assert [a.slug for a in articles] == ["second", "premier-article"]
        assert articles[0].title == "Second article"
        assert articles[1].description == "Une description SEO."
        assert articles[1].date.isoformat() == "2026-07-01"

    def test_render_article_html(self, content_dir):
        articles = load_articles(content_dir)
        html = render_article(articles[1])
        assert "<h2" in html and "Sous-titre" in html
        assert "<strong>contenu</strong>" in html

    def test_missing_dir_returns_empty(self, tmp_path):
        assert load_articles(tmp_path / "nope") == []
