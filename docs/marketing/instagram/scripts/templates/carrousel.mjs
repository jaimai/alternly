// Carrousel 1080×1350. Chaque slide a un `layout` :
//   couverture { kicker, titre, sous, emoji }            fond vert
//   texte      { kicker, titre, paragraphes[], fond }
//   liste      { kicker, titre, items[], puce }          puce : ✓ (défaut), 1 (numéros), ou un emoji
//   duo        { kicker, titre, non, oui }               ❌ / ✅
//   colonnes   { kicker, titre, gauche:{titre,items[]}, droite:{titre,items[]} }
//   cartes     { kicker, titre, cartes:[{label, valeur, sous}], texte }
//   citation   { kicker, citation, texte }
//   cta        { titre, texte, options:[{emoji, label}], bas }   fond vert
import { css, md, wordmark } from './commun.mjs'

const head = (s) => `${s.kicker ? `<div class="kicker">${md(s.kicker)}</div>` : ''}${s.titre ? `<h2 class="serif">${md(s.titre)}</h2>` : ''}`
const ps = (arr = []) => arr.map((p) => `<p>${md(p)}</p>`).join('')

const layouts = {
  couverture: (s) => `${s.emoji ? `<div class="emoji">${s.emoji}</div>` : ''}
    ${s.kicker ? `<div class="kicker">${md(s.kicker)}</div>` : ''}
    <h1 class="serif">${md(s.titre)}</h1>${s.sous ? `<p class="sous">${md(s.sous)}</p>` : ''}
    <div class="swipe">Fais défiler →</div>`,
  texte: (s) => head(s) + ps(s.paragraphes),
  liste: (s) => head(s) + `<ul class="liste">${s.items.map((it, i) =>
    `<li><span class="puce">${s.puce === '1' ? i + 1 : s.puce || '✓'}</span><span>${md(it)}</span></li>`).join('')}</ul>${ps(s.paragraphes)}`,
  duo: (s) => head(s) + `<div class="duo"><div class="non"><i>❌</i>${md(s.non)}</div><div class="oui"><i>✅</i>${md(s.oui)}</div></div>${ps(s.paragraphes)}`,
  colonnes: (s) => head(s) + `<div class="cols">${['gauche', 'droite'].map((k) =>
    `<div class="col ${k}"><h3>${md(s[k].titre)}</h3><ul>${s[k].items.map((it) => `<li>${md(it)}</li>`).join('')}</ul></div>`).join('')}</div>${ps(s.paragraphes)}`,
  cartes: (s) => head(s) + `<div class="cartes">${s.cartes.map((c) =>
    `<div class="carte"><small>${md(c.label)}</small><strong>${md(c.valeur)}</strong>${c.sous ? `<span>${md(c.sous)}</span>` : ''}</div>`).join('')}</div>${s.texte ? `<p>${md(s.texte)}</p>` : ''}`,
  citation: (s) => head(s) + `<blockquote>${md(s.citation)}</blockquote>${s.texte ? `<p>${md(s.texte)}</p>` : ''}`,
  cta: (s) => `<h2 class="serif">${md(s.titre)}</h2>${s.texte ? `<p>${md(s.texte)}</p>` : ''}
    ${s.options ? `<div class="options">${s.options.map((o) => `<div><i>${o.emoji}</i>${md(o.label)}</div>`).join('')}</div>` : ''}
    <p class="bas">${md(s.bas ?? '📌 **Enregistre** ce post et **partage-le** à un parent qui en a besoin.')}</p>`,
}

export function carrouselHtml(post) {
  const n = post.slides.length
  const slides = post.slides.map((s, i) => {
    const fond = s.fond ?? (['couverture', 'cta'].includes(s.layout) ? 'pine' : '')
    const pied = i === n - 1 ? (s.pied ?? 'Lien en bio') : `${i + 1} / ${n}`
    return `<section class="slide l-${s.layout} ${fond}" data-n="${i + 1}">${layouts[s.layout](s)}
      <div class="foot">${wordmark}<span>${md(pied)}</span></div></section>`
  }).join('\n')
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${css}
html, body { width: 1080px; height: 1350px; }
.slide { display: none; position: relative; width: 1080px; height: 1350px; padding: 110px 96px 150px; flex-direction: column; justify-content: center; }
.slide.on { display: flex; }
.kicker { font-size: 30px; font-weight: 700; letter-spacing: .12em; text-transform: uppercase; color: var(--terra); margin-bottom: 32px; }
.pine .kicker { color: #f0b597; }
h1 { font-size: 112px; line-height: 1.03; }
h2 { font-size: 80px; line-height: 1.07; margin-bottom: 44px; }
p { font-size: 40px; line-height: 1.42; color: var(--ink-soft); font-weight: 500; }
.pine p { color: #d6e3dc; }
p + p { margin-top: 26px; }
.sous { margin-top: 44px; }
.swipe { font-size: 34px; font-weight: 700; color: #f0b597; margin-top: 60px; }
.emoji { position: absolute; right: 80px; top: 90px; font-size: 140px; transform: rotate(8deg); }
.foot { position: absolute; left: 96px; right: 96px; bottom: 70px; display: flex; justify-content: space-between; align-items: center; font-size: 28px; font-weight: 600; color: var(--ink-soft); }
.foot .wm { font-size: 40px; }
.pine .foot { color: #a9c2b6; }
.liste { list-style: none; display: flex; flex-direction: column; gap: 26px; margin-bottom: 30px; }
.liste li { display: flex; gap: 26px; align-items: flex-start; font-size: 40px; line-height: 1.35; font-weight: 500; color: var(--ink); }
.liste .puce { flex: none; width: 60px; height: 60px; border-radius: 50%; background: var(--pine-soft); color: var(--pine); display: grid; place-items: center; font-size: 30px; font-weight: 700; margin-top: -2px; }
.duo { display: flex; flex-direction: column; gap: 26px; margin-bottom: 36px; }
.duo > div { border-radius: 32px; padding: 36px 44px 36px 110px; position: relative; font-size: 38px; line-height: 1.38; font-weight: 500; }
.duo i { position: absolute; left: 36px; top: 36px; font-style: normal; font-size: 46px; }
.duo .non { background: #fff; border: 2px solid var(--line); color: var(--ink-soft); }
.duo .oui { background: var(--pine-soft); color: var(--ink); }
.cols { display: flex; gap: 24px; margin-bottom: 30px; }
.col { flex: 1; border-radius: 32px; padding: 36px 34px; }
.col.gauche { background: var(--pine-soft); }
.col.droite { background: var(--terra-soft); }
.col h3 { font-size: 34px; font-weight: 700; margin-bottom: 22px; }
.col.gauche h3 { color: var(--pine); } .col.droite h3 { color: var(--terra); }
.col ul { list-style: none; display: flex; flex-direction: column; gap: 16px; }
.col li { font-size: 33px; line-height: 1.3; font-weight: 500; }
.col li::before { content: '· '; font-weight: 700; }
.cartes { display: flex; gap: 24px; margin: 6px 0 40px; }
.carte { flex: 1; background: #fff; border: 2px solid var(--line); border-radius: 32px; padding: 38px 40px; }
.carte small { display: block; font-size: 26px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--ink-soft); margin-bottom: 12px; }
.carte strong { display: block; font-family: 'Fraunces', serif; font-size: 50px; font-weight: 500; line-height: 1.06; }
.carte span { display: block; font-size: 30px; color: var(--ink-soft); margin-top: 8px; }
blockquote { background: #fff; border: 2px solid var(--line); border-radius: 32px; padding: 44px 48px; font-family: 'Fraunces', serif; font-style: italic; font-size: 54px; line-height: 1.38; margin-bottom: 40px; }
.options { display: flex; gap: 22px; margin-top: 50px; }
.options div { flex: 1; text-align: center; background: rgba(255,255,255,.08); border: 2px solid rgba(255,255,255,.18); border-radius: 28px; padding: 32px 18px; font-size: 31px; font-weight: 600; line-height: 1.3; color: var(--paper); }
.options i { display: block; font-style: normal; font-size: 62px; margin-bottom: 12px; }
.bas { margin-top: 54px; }
</style></head><body>${slides}
<script>window.show = (i) => { document.querySelectorAll('.slide').forEach((s) => s.classList.toggle('on', +s.dataset.n === i)) }; show(1)</script>
</body></html>`
}
