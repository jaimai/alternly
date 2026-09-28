/*
 * Alternly — site marketing : parent déjà connecté.
 *
 * Le site et l'app partagent l'origine alternly.com : si un jeton de session
 * valide est présent (même clé que la SPA), les CTA « Essayer gratuitement »
 * deviennent « Ouvrir mon calendrier » et « Se connecter » disparaît. Évite
 * qu'un parent revenu sur l'accueil (retour arrière mobile) se réinscrive.
 */
(function () {
  var token
  try {
    token = localStorage.getItem('coparent_token')
  } catch (e) {
    return
  }
  if (!token) return
  try {
    var payload = JSON.parse(atob(token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')))
    if (payload.exp && payload.exp * 1000 < Date.now()) return
  } catch (e) {
    return
  }
  var en = (document.documentElement.lang || '').indexOf('en') === 0
  var label = en ? 'Open my calendar' : 'Ouvrir mon calendrier'
  function apply() {
    var links = document.querySelectorAll('a[href^="/register"]')
    for (var i = 0; i < links.length; i++) {
      links[i].setAttribute('href', '/app')
      links[i].textContent = label
    }
    var logins = document.querySelectorAll('a[href^="/login"]')
    for (var j = 0; j < logins.length; j++) logins[j].style.display = 'none'
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', apply)
  else apply()
})()
