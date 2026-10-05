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


def test_blog_en_index_and_post(client):
    from app.services.blog import CONTENT_DIR_EN, load_articles

    articles = load_articles(CONTENT_DIR_EN)
    assert articles, "les guides anglais doivent être chargés"
    r = client.get("/en/blog")
    assert r.status_code == 200
    assert f'/en/blog/{articles[0].slug}' in r.text
    r = client.get(f"/en/blog/{articles[0].slug}")
    assert r.status_code == 200
    assert 'lang="en"' in r.text or "en-US" in r.text
    assert client.get("/en/blog/nope").status_code == 404


def test_frontmatter_quotes_stripped():
    from app.services.blog import load_articles

    for a in load_articles():
        assert not a.title.startswith('"') and not a.title.endswith('"')


def test_sitemap_lists_english_guides(client):
    from app.services.blog import CONTENT_DIR_EN, load_articles

    xml = client.get("/sitemap.xml").text
    assert "/en/blog</loc>" in xml
    for a in load_articles(CONTENT_DIR_EN):
        assert f"/en/blog/{a.slug}</loc>" in xml


def test_extract_faq_reads_questions_section():
    from app.services.blog import extract_faq

    body = (
        "Intro.\n\n## Questions fréquentes\n\n### Qui a Noël ?\n\nLe parent **années paires**,\n"
        "voir [le guide](/blog/x).\n\n### Et l'été ?\n\nL'autre.\n\n## En résumé\n\n### Pas une question\n\nTexte."
    )
    assert extract_faq(body) == [
        ("Qui a Noël ?", "Le parent années paires, voir le guide."),
        ("Et l'été ?", "L'autre."),
    ]
    assert extract_faq("## Autre\n\n### Q ?\n\nR.") == []


def test_blog_post_emits_faq_structured_data(client):
    r = client.get("/blog/vacances-noel-2026-garde-alternee")
    assert r.status_code == 200
    assert '"@type":"FAQPage"' in r.text
    assert "Qui a les enfants à Noël 2026 en garde alternée ?" in r.text
    # Article sans section FAQ : pas de FAQPage
    assert '"@type":"FAQPage"' not in client.get("/blog/planning-garde-alternee-choisir-rythme").text


def test_llms_txt_has_quick_answers(client):
    text = client.get("/llms.txt").text
    assert "## Réponses rapides" in text
    assert "19 décembre 2026" in text
    assert "/blog/calcul-pension-alimentaire-garde-alternee-exemples" in text
