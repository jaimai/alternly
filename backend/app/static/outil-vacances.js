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
