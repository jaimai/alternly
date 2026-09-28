/*
 * Alternly — site marketing : consentement + mesure d'audience PostHog (UE).
 *
 * Même comportement que la SPA (même origine alternly.com, même clé de stockage) :
 * - sans réponse ou après refus : mesure anonyme sans cookie (cookieless_mode
 *   "on_reject" + opt_out_capturing_by_default) ;
 * - après acceptation : persistance, replay (saisies masquées) ;
 * - choix sous localStorage "alternly_consent" = {value, at}, redemandé après 13 mois.
 * posthog-js est chargé via le proxy /ingest (Vercel → eu-assets.i.posthog.com).
 * Configuration : <script src="/static/analytics.js" data-key="phc_…" data-lang="fr|en" defer>.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var KEY = script && script.getAttribute('data-key');
  if (!KEY) return;
  var LANG = (script.getAttribute('data-lang') || document.documentElement.lang || 'fr').slice(0, 2) === 'en' ? 'en' : 'fr';
  var HOST = '/ingest';
  var CONSENT_KEY = 'alternly_consent';
  var MAX_AGE = 395 * 24 * 3600 * 1000; // 13 mois (CNIL)
  var ATTR_KEY = 'alternly_attribution';
  var ATTR_PARAMS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_term', 'utm_content', 'gclid', 'fbclid'];

  var T = {
    fr: {
      title: "Mesure d'audience",
      body: "Nous mesurons la fréquentation du site de façon anonyme, sans cookie. Avec votre accord, nous utilisons aussi des cookies pour comprendre les parcours et enregistrer des sessions (saisies masquées) afin d'améliorer Alternly. Hébergé en UE, jamais revendu.",
      more: 'En savoir plus', privacy: '/privacy', accept: 'Accepter', refuse: 'Refuser'
    },
    en: {
      title: 'Analytics',
      body: 'We measure site traffic anonymously, without cookies. With your consent, we also use cookies to understand user journeys and record sessions (inputs masked) to improve Alternly. Hosted in the EU, never sold.',
      more: 'Learn more', privacy: '/en/privacy', accept: 'Accept', refuse: 'Decline'
    }
  }[LANG];

  // ------------------------------------------------------------ consentement
  function readConsent() {
    try {
      var raw = JSON.parse(localStorage.getItem(CONSENT_KEY) || 'null');
      if (!raw || (raw.value !== 'granted' && raw.value !== 'denied')) return null;
      if (typeof raw.at !== 'number' || Date.now() - raw.at > MAX_AGE) return null;
      return raw.value;
    } catch (e) { return null; }
  }
  var consent = readConsent();

  // ------------------------------------------------------------ attribution
  function urlAttribution() {
    var out = {}, params = new URLSearchParams(location.search), any = false;
    ATTR_PARAMS.forEach(function (p) {
      var v = params.get(p);
      if (v) { out[p] = v.slice(0, 100); any = true; }
    });
    return any ? out : null;
  }
  var attribution = urlAttribution();
  function storedAttribution() {
    if (consent !== 'granted') return null;
    try { return JSON.parse(sessionStorage.getItem(ATTR_KEY) || 'null'); } catch (e) { return null; }
  }
  function persistAttribution() {
    // sessionStorage = stockage au sens ePrivacy : seulement après consentement.
    if (consent !== 'granted' || !attribution) return;
    try { if (!sessionStorage.getItem(ATTR_KEY)) sessionStorage.setItem(ATTR_KEY, JSON.stringify(attribution)); } catch (e) {}
  }
  // Les UTM de l'URL d'arrivée suivent le visiteur jusqu'à l'inscription (SPA),
  // sans stockage : on les ajoute aux liens /register et /login.
  function forwardAttribution() {
    var attr = attribution || storedAttribution();
    if (!attr) return;
    // Une vraie source d'arrivée (pub, e-mail…) remplace les UTM « internes »
    // posés en dur sur certains CTA (ex. utm_source=outil sur l'outil vacances) :
    // sinon une inscription venue d'une pub serait attribuée à l'outil.
    var external = !!(attr.utm_source || attr.gclid || attr.fbclid);
    var links = document.querySelectorAll('a[href^="/register"], a[href^="/login"]');
    Array.prototype.forEach.call(links, function (a) {
      var url = new URL(a.getAttribute('href'), location.origin);
      if (external) ATTR_PARAMS.forEach(function (k) { url.searchParams.delete(k); });
      Object.keys(attr).forEach(function (k) { if (!url.searchParams.has(k)) url.searchParams.set(k, attr[k]); });
      a.setAttribute('href', url.pathname + url.search + url.hash);
    });
  }

  // ------------------------------------------------------------ PostHog
  var ph = null;
  var queue = [];
  function withPH(fn) { if (ph) { try { fn(ph); } catch (e) {} } else queue.push(fn); }
  function track(event, props) { withPH(function (p) { p.capture(event, props); }); }

  function applyConsent(previous) {
    withPH(function (p) {
      if (consent === 'granted') {
        if (!p.has_opted_in_capturing()) p.opt_in_capturing({ captureEventName: false });
        p.startSessionRecording();
      } else if (previous === 'granted' || p.has_opted_in_capturing()) {
        p.stopSessionRecording();
        p.reset();
        p.opt_out_capturing();
      }
    });
  }

  function scrub(v) {
    return typeof v === 'string'
      ? v.replace(/(\/join\/)[^/?#"'\s]+/g, '$1[token]').replace(/([?&](?:token|t)=)[^&#"'\s]+/g, '$1[token]')
      : v;
  }

  function loadPostHog() {
    var s = document.createElement('script');
    s.async = true;
    s.crossOrigin = 'anonymous';
    s.src = HOST + '/static/array.js';
    s.onload = function () {
      var p = window.posthog;
      if (!p || typeof p.init !== 'function') return;
      p.init(KEY, {
        api_host: HOST,
        ui_host: 'https://eu.posthog.com',
        defaults: '2026-01-30',
        cookieless_mode: 'on_reject',
        opt_out_capturing_by_default: true,
        opt_out_capturing_persistence_type: 'localStorage',
        consent_persistence_name: 'alternly_ph_optin',
        persistence: 'localStorage+cookie',
        person_profiles: 'identified_only',
        capture_pageview: true,
        capture_pageleave: true,
        autocapture: true,
        capture_exceptions: true,
        disable_session_recording: consent !== 'granted',
        session_recording: { maskAllInputs: true, maskTextSelector: '.ph-mask', blockSelector: '.ph-no-capture' },
        disable_surveys: true,
        advanced_disable_feature_flags: true,
        before_send: function (cr) {
          if (!cr) return cr;
          [cr.properties, cr.$set, cr.$set_once].forEach(function (o) {
            if (o) Object.keys(o).forEach(function (k) { o[k] = scrub(o[k]); });
          });
          return cr;
        }
      });
      p.register({ site_lang: LANG, site_section: 'marketing' });
      ph = p;
      applyConsent(null);
      var pending = queue; queue = [];
      pending.forEach(function (fn) { try { fn(p); } catch (e) {} });
    };
    document.head.appendChild(s);
  }

  function setConsent(value) {
    var previous = consent;
    consent = value;
    try { localStorage.setItem(CONSENT_KEY, JSON.stringify({ value: value, at: Date.now() })); } catch (e) {}
    if (value === 'granted') persistAttribution();
    else { try { sessionStorage.removeItem(ATTR_KEY); } catch (e) {} }
    applyConsent(previous);
    hideBanner();
  }

  // ------------------------------------------------------------ bannière
  var banner = null;
  function showBanner() {
    if (banner) return;
    banner = document.createElement('section');
    banner.className = 'consent-banner';
    banner.setAttribute('role', 'dialog');
    banner.setAttribute('aria-live', 'polite');
    banner.setAttribute('aria-labelledby', 'consent-title');
    banner.innerHTML =
      '<div class="consent-text"><strong id="consent-title"></strong><p><span></span> <a></a></p></div>' +
      '<div class="consent-actions"><button type="button" data-choice="denied"></button>' +
      '<button type="button" data-choice="granted"></button></div>';
    banner.querySelector('strong').textContent = T.title;
    banner.querySelector('p span').textContent = T.body;
    var more = banner.querySelector('p a');
    more.textContent = T.more;
    more.href = T.privacy;
    banner.querySelector('[data-choice="denied"]').textContent = T.refuse;
    banner.querySelector('[data-choice="granted"]').textContent = T.accept;
    banner.addEventListener('click', function (e) {
      var choice = e.target && e.target.getAttribute && e.target.getAttribute('data-choice');
      if (choice) setConsent(choice);
    });
    document.body.appendChild(banner);
  }
  function hideBanner() {
    if (banner) { banner.remove(); banner = null; }
  }

  // ------------------------------------------------------------ événements marketing
  function ctaLocation(el) {
    var tagged = el.closest('[data-cta]');
    if (tagged) return tagged.getAttribute('data-cta');
    if (el.closest('.site-header')) return 'nav';
    if (el.closest('.site-footer')) return 'footer';
    if (el.closest('.post-cta')) return 'blog_post';
    var section = el.closest('section');
    if (section) return section.id || (section.className || 'section').split(' ')[0];
    return 'other';
  }

  function blogSlug() {
    var article = document.querySelector('[data-blog-slug]');
    return article ? article.getAttribute('data-blog-slug') : null;
  }

  // Outils gratuits (ex. /outils/vacances-garde-alternee) : événements relayés
  // depuis la page via CustomEvent, filtrés (noms et propriétés autorisés seulement).
  var TOOL_EVENTS = { tool_used: ['zone', 'period', 'mode'] };
  function toolName() {
    var el = document.querySelector('[data-tool]');
    return el ? el.getAttribute('data-tool') : null;
  }

  function bindEvents() {
    var slug = blogSlug();
    var tool = toolName();
    if (slug) track('blog_article_viewed', { slug: slug, lang: LANG });

    document.addEventListener('alternly:track', function (e) {
      var d = e.detail || {};
      var allowed = TOOL_EVENTS[d.event];
      if (!allowed || !tool) return;
      var props = { tool: tool, lang: LANG };
      allowed.forEach(function (k) {
        var v = d.props && d.props[k];
        if (typeof v === 'string') props[k] = v.slice(0, 40);
      });
      track(d.event, props);
    });

    document.addEventListener('click', function (e) {
      var a = e.target && e.target.closest ? e.target.closest('a') : null;
      if (!a) {
        var opener = e.target && e.target.closest ? e.target.closest('[data-consent-open]') : null;
        if (opener) { e.preventDefault(); showBanner(); }
        return;
      }
      if (a.hasAttribute('data-consent-open')) { e.preventDefault(); showBanner(); return; }
      var href = a.getAttribute('href') || '';
      if (a.hasAttribute('data-lang-switch')) {
        track('language_switched', { from: LANG, to: a.getAttribute('data-lang-switch') });
      } else if (href.indexOf('/register') === 0) {
        var props = { location: ctaLocation(a), lang: LANG };
        if (slug) { props.slug = slug; track('blog_cta_clicked', props); }
        else if (tool) { props.tool = tool; track('tool_cta_clicked', props); }
        else track('landing_cta_clicked', props);
      }
    });

    // FAQ : index de la question ouverte (jamais son texte).
    var faq = document.querySelectorAll('.faq details');
    Array.prototype.forEach.call(faq, function (d, i) {
      d.addEventListener('toggle', function () {
        if (d.open) track('faq_opened', { question_index: i, lang: LANG });
      });
    });

    // Section tarifs vue (une fois par page).
    var pricing = document.querySelector('section.pricing');
    if (pricing && 'IntersectionObserver' in window) {
      var io = new IntersectionObserver(function (entries) {
        if (entries.some(function (en) { return en.isIntersecting; })) {
          track('pricing_viewed', { lang: LANG });
          io.disconnect();
        }
      }, { threshold: 0.4 });
      io.observe(pricing);
    }
  }

  function start() {
    forwardAttribution();
    persistAttribution();
    bindEvents();
    if (consent === null) showBanner();
    loadPostHog();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else start();
})();
