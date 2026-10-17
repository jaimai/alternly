/*
 * Outil « Qui a les enfants pendant les vacances ? » — amélioration progressive.
 * Sans JS : le formulaire GET est rendu côté serveur. Avec JS : appel à
 * /api/public/vacation-split (même moteur), rendu sans rechargement, URL mise à jour.
 * Les prénoms saisis restent dans la page (jamais envoyés ni stockés).
 * Mesure : événement « alternly:track » relayé par analytics.js (consentement respecté).
 */
(function () {
  'use strict';
  var form = document.getElementById('tool-form');
  var out = document.getElementById('tool-result');
  if (!form || !out || !window.fetch) return;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function names() {
    var n = { A: 'Parent A', B: 'Parent B' };
    Array.prototype.forEach.call(form.querySelectorAll('[data-name-for]'), function (i) {
      var v = i.value.trim();
      if (v) n[i.getAttribute('data-name-for')] = v.slice(0, 24);
    });
    return n;
  }
  function applyNames() {
    var n = names();
    Array.prototype.forEach.call(document.querySelectorAll('[data-parent-label]'), function (el) {
      el.textContent = n[el.getAttribute('data-parent-label')];
    });
    Array.prototype.forEach.call(form.querySelectorAll('[data-parent-option]'), function (el) {
      el.textContent = n[el.getAttribute('data-parent-option')];
    });
  }
  function who(p) {
    return '<span class="who who-' + p.toLowerCase() + '" data-parent-label="' + p + '">Parent ' + p + '</span>';
  }
  function track(event, props) {
    try { document.dispatchEvent(new CustomEvent('alternly:track', { detail: { event: event, props: props } })); } catch (e) {}
  }

  // Libellé du sélecteur selon la règle choisie.
  var evenLabel = document.getElementById('f-even-label');
  function syncLabel() {
    var full = form.querySelector('input[name="mode"]:checked');
    if (evenLabel) evenLabel.textContent = evenLabel.getAttribute(full && full.value === 'alternate_full' ? 'data-full' : 'data-split');
  }
  Array.prototype.forEach.call(form.querySelectorAll('input[name="mode"]'), function (r) { r.addEventListener('change', syncLabel); });
  form.addEventListener('input', function (e) { if (e.target.hasAttribute('data-name-for')) applyNames(); });

  function card(html) {
    Array.prototype.forEach.call(out.querySelectorAll('.result-card'), function (c) { c.remove(); });
    out.insertAdjacentHTML('afterbegin', html);
    applyNames();
  }

  function render(r) {
    var p = r.period;
    var lines = r.segments.map(function (s) {
      return '<li class="seg-line seg-' + s.parent.toLowerCase() + '"><span class="seg-dates">Du ' + esc(s.start_label) +
        ' au ' + esc(s.end_label) + '</span> <span class="seg-who">chez ' + who(s.parent) + '</span> <span class="seg-days">' +
        s.days + ' jour' + (s.days > 1 ? 's' : '') + '</span></li>';
    }).join('');
    var tl = r.timeline.map(function (d) {
      var h = r.handover && d.date === r.handover.date ? ' tl-handover' : '';
      return '<span class="tl-day tl-' + d.parent.toLowerCase() + h + '" title="' + d.date + '"><b>' + d.dow + '</b>' + d.day + '</span>';
    }).join('');
    var handover = r.handover
      ? '<p class="handover"><strong>Passage de bras : ' + esc(r.handover.label) + '</strong> — c’est le premier jour de la seconde moitié. L’heure est celle de votre accord (le calcul se fait en journées entières).</p>'
      : '';
    card(
      '<div class="result-card is-new">' +
      '<p class="result-kicker">' + esc(p.label) + ' · zone ' + r.zone + ' · année ' + r.year_parity + '</p>' +
      '<h2 id="result-title" tabindex="-1">Du ' + esc(p.start_label) + ' au ' + esc(p.end_label) + ' ' + p.start.slice(0, 4) + '</h2>' +
      '<ul class="result-lines">' + lines + '</ul>' +
      '<div class="timeline' + (r.timeline.length > 21 ? ' dense' : '') + '" style="--n: ' + r.timeline.length +
      '" role="img" aria-label="Frise des ' + p.days + ' jours de vacances, colorée par parent">' + tl + '</div>' +
      '<div class="tl-legend"><span><i class="dot p1"></i>' + who('A') + '</span><span><i class="dot p2"></i>' + who('B') + '</span></div>' +
      handover +
      '<p class="hint">Reprise de l’école\u00a0: ' + esc(p.resume_label) + ' · ' + esc(r.source) + '</p></div>'
    );
  }

  function renderError(msg) {
    card('<div class="result-card result-empty"><h2 id="result-title">Résultat indisponible</h2><p>' + esc(msg) + '</p></div>');
  }

  // Vue « toute l'année » : mêmes règles, toutes les vacances de l'année scolaire.
  var yearBox = document.getElementById('year-view');
  var oldCta = out.querySelector('.tool-cta');
  function ctaHref(zone, mode) {
    var base = (yearBox && yearBox.getAttribute('data-cta-base')) || '/register';
    return base + '&zone=' + encodeURIComponent(zone) + '&vac_mode=' + encodeURIComponent(mode);
  }
  function dot(p) { return '<i class="dot ' + (p === 'A' ? 'p1' : 'p2') + '"></i>'; }
  function when(n) {
    return n === 0 ? 'dès maintenant' : n === 1 ? 'demain' : 'dans ' + n + ' jours';
  }
  function renderYear(y, href) {
    if (!yearBox) return;
    var ta = y.totals.A, tb = y.totals.B;
    var modeLabel = y.mode === 'split_half' ? 'moitié / moitié' : 'vacances entières alternées';
    var next = y.next;
    var nextHtml = next
      ? '<p class="year-next">Prochaines vacances : <strong>' + esc(next.name) + '</strong>, ' + when(next.days_until) +
        ', chez ' + who(next.first_parent) + '.' +
        (next.handover ? ' Passage de bras : <strong>' + esc(next.handover.label) + '</strong>' : '') + '</p>'
      : '';
    var items = y.periods.map(function (p) {
      var isNext = next && p.value === next.value;
      var badge = p.past ? '<span class="yp-badge past">passées</span>' : isNext ? '<span class="yp-badge">prochaines</span>' : '';
      var bar = p.segments.map(function (s) {
        return '<span class="yb-' + s.parent.toLowerCase() + '" style="flex: ' + s.days + '"></span>';
      }).join('');
      var segs = p.segments.map(function (s) {
        return '<li>' + dot(s.parent) + who(s.parent) + '<span>' + esc(s.start_label) + ' → ' + esc(s.end_label) + '</span></li>';
      }).join('');
      return '<li class="year-period' + (isNext ? ' is-next' : '') + (p.past ? ' is-past' : '') + '">' +
        '<div class="yp-head"><h3>' + esc(p.name) + '</h3>' + badge + '</div>' +
        '<p class="yp-dates">' + esc(p.start_label) + ' → ' + esc(p.end_label) + ' · ' + p.days + ' jours</p>' +
        '<div class="yp-bar" aria-hidden="true">' + bar + '</div>' +
        '<ul class="yp-segs">' + segs + '</ul>' +
        (p.handover ? '<p class="yp-handover">Passage de bras : ' + esc(p.handover.label) + '</p>' : '') +
        '</li>';
    }).join('');
    yearBox.innerHTML =
      '<div class="year-head"><p class="result-kicker">Zone ' + esc(y.zone) + ' · ' + modeLabel + '</p>' +
      '<h2 id="year-title" tabindex="-1">Toute l’année scolaire ' + esc(y.school_year) + '</h2></div>' +
      '<div class="year-summary">' +
      '<div class="year-bar" role="img" aria-label="Sur l’année : ' + ta + ' jours chez le parent A, ' + tb + ' jours chez le parent B">' +
      '<span class="yb-a" style="flex: ' + ta + '"></span><span class="yb-b" style="flex: ' + tb + '"></span></div>' +
      '<div class="year-totals"><p>' + dot('A') + who('A') + '<strong>' + ta + ' jours</strong></p>' +
      '<p>' + dot('B') + who('B') + '<strong>' + tb + ' jours</strong></p></div>' + nextHtml + '</div>' +
      '<ol class="year-periods">' + items + '</ol>' +
      '<p class="hint year-hint">Années paires : ' + (y.mode === 'split_half' ? '1re moitié' : 'vacances') + ' chez ' + who(y.even_first) +
      ' ; l’ordre s’inverse les années impaires (pour Noël, c’est l’année du premier jour qui compte). ' + esc(y.source) + '.</p>' +
      '<div class="year-cta" data-cta="tool_year"><h3>Gardez cette année sous la main, sans rien recalculer</h3><ul>' +
      '<li>Un rappel la veille de chaque passage de bras</li>' +
      '<li>Toutes ces vacances dans l’agenda de votre téléphone</li>' +
      '<li>L’autre parent voit exactement le même calendrier</li></ul>' +
      '<a class="cta big" href="' + esc(href) + '">Recevoir mon calendrier ' + esc(y.school_year) + '</a>' +
      '<p class="year-cta-note">Gratuit, sans carte bancaire. Votre zone et votre règle de vacances sont reprises.</p></div>' +
      '<button type="button" class="year-share" data-share hidden>Envoyer ce récap à l’autre parent</button>';
    yearBox.hidden = false;
    if (oldCta) oldCta.hidden = true;
    applyNames();
    setupShare();
  }
  function loadYear(zone, schoolYear, mode, evenFirst) {
    if (!yearBox) return;
    var q = new URLSearchParams({ zone: zone, school_year: schoolYear, mode: mode, even_first: evenFirst });
    fetch('/api/public/vacation-year?' + q.toString(), { headers: { Accept: 'application/json' } })
      .then(function (res) { return res.ok ? res.json() : null; })
      .then(function (y) {
        if (!y || !y.periods || !y.periods.length) { hideYear(); return; }
        renderYear(y, ctaHref(zone, mode));
        track('tool_year_viewed', { zone: zone, school_year: schoolYear, mode: mode, periods: y.periods.length });
      })
      .catch(hideYear);
  }
  function hideYear() {
    // Pas de vue annuelle à jour : on ne laisse pas celle d'un ancien calcul.
    yearBox.hidden = true;
    if (oldCta) oldCta.hidden = false;
  }

  // Partage du récap (lien vers la même page, déjà réglée) : feuille de partage
  // native sur mobile, sinon copie du lien.
  function setupShare() {
    var btn = yearBox && yearBox.querySelector('[data-share]');
    if (!btn) return;
    btn.hidden = !(navigator.share || (navigator.clipboard && navigator.clipboard.writeText));
    btn.onclick = function () {
      var url = location.href.split('#')[0];
      var text = 'Nos vacances de l’année en garde alternée, avec les dates officielles :';
      if (navigator.share) {
        navigator.share({ title: document.title, text: text, url: url })
          .then(function () { track('tool_shared', { method: 'native' }); }, function () {});
      } else {
        navigator.clipboard.writeText(url).then(function () {
          btn.textContent = 'Lien copié : collez-le à l’autre parent';
          track('tool_shared', { method: 'copy' });
        }, function () {});
      }
    };
  }
  setupShare();
  if (yearBox && !yearBox.hidden) {
    track('tool_year_viewed', { zone: form.querySelector('input[name="zone"]:checked') ? form.querySelector('input[name="zone"]:checked').value : null, ssr: true });
  }

  form.addEventListener('submit', function (e) {
    if (!form.checkValidity()) return; // le navigateur signale le champ manquant
    e.preventDefault();
    var fd = new FormData(form);
    var vac = String(fd.get('vacances') || '');
    var cut = vac.lastIndexOf('-');
    var q = new URLSearchParams({
      zone: fd.get('zone'), period: vac.slice(0, cut), year: vac.slice(cut + 1),
      mode: fd.get('mode'), even_first: fd.get('even_first')
    });
    var btn = form.querySelector('.tool-submit');
    btn.disabled = true;
    out.setAttribute('aria-busy', 'true');
    fetch('/api/public/vacation-split?' + q.toString(), { headers: { Accept: 'application/json' } })
      .then(function (res) {
        var json = (res.headers.get('content-type') || '').indexOf('application/json') === 0;
        if (!json) return null;
        return res.json().then(function (body) { return { ok: res.ok, body: body }; }, function () { return { ok: false, body: {} }; });
      })
      .then(function (r) {
        if (!r) { HTMLFormElement.prototype.submit.call(form); return; } // API injoignable : rendu serveur
        if (!r.ok) {
          renderError(typeof r.body.detail === 'string' ? r.body.detail : 'Le calcul n’a pas abouti. Réessayez dans un instant.');
          return;
        }
        render(r.body);
        track('tool_used', { zone: fd.get('zone'), period: vac, mode: fd.get('mode') });
        var oldLink = oldCta && oldCta.querySelector('a.cta');
        if (oldLink) oldLink.setAttribute('href', ctaHref(String(fd.get('zone')), String(fd.get('mode'))));
        loadYear(String(fd.get('zone')), r.body.period.school_year, String(fd.get('mode')), String(fd.get('even_first')));
        var page = new URLSearchParams({ zone: fd.get('zone'), vacances: vac, mode: fd.get('mode'), even_first: fd.get('even_first') });
        try { history.replaceState(null, '', location.pathname + '?' + page.toString()); } catch (err) {}
        var title = document.getElementById('result-title');
        if (window.matchMedia && window.matchMedia('(max-width: 860px)').matches && title) {
          title.focus({ preventScroll: true });
          out.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      })
      .catch(function () { renderError('Connexion impossible. Vérifiez votre réseau et réessayez.'); })
      .then(function () { btn.disabled = false; out.removeAttribute('aria-busy'); });
  });

  syncLabel();
})();
