// Reel 1080×1920 en motion design. `scenes` : liste de scènes, chacune avec `duree` (ms, défaut 3000) et un `layout` :
//   hook     { texte, sous, emoji }                 grosse phrase d'accroche
//   texte    { kicker, titre, texte }
//   liste    { titre, items[] }                     les items apparaissent un par un
//   sms      { contact, messages:[{ de: moi|ex, texte }] }   bulles qui arrivent une par une
//   duo      { titre, non, oui }                    ❌ puis ✅
//   cta      { titre, texte }                       fond vert, logo
// Option de scène : fond: pine. Le contenu reste entre y=260 et y=1500 (zones masquées par l'interface Instagram).
import { css, md, wordmark } from './commun.mjs'

const D = 3000
export const reelDuree = (post) => post.scenes.reduce((t, s) => t + (s.duree ?? D), 0)

const a = (t, html, cls = '') => `<div class="a ${cls}" style="--t:${t}ms">${html}</div>`

const layouts = {
  hook: (s, t) => `${s.emoji ? a(t, `<div class="emo">${s.emoji}</div>`) : ''}${a(t + 80, `<h1 class="serif">${md(s.texte)}</h1>`)}${s.sous ? a(t + 500, `<p class="sous">${md(s.sous)}</p>`) : ''}`,
  texte: (s, t) => `${s.kicker ? a(t, `<div class="kicker">${md(s.kicker)}</div>`) : ''}${a(t + 80, `<h2 class="serif">${md(s.titre)}</h2>`)}${s.texte ? a(t + 450, `<p class="sous">${md(s.texte)}</p>`) : ''}`,
  liste: (s, t, d) => {
    const step = Math.min(700, (d - 900) / s.items.length)
    return `${a(t, `<h2 class="serif">${md(s.titre)}</h2>`)}<ul class="liste">${s.items.map((it, i) =>
      a(t + 400 + i * step, `<li><span class="puce">${i + 1}</span><span>${md(it)}</span></li>`)).join('')}</ul>`
  },
  sms: (s, t, d) => {
    const step = Math.min(1300, (d - 600) / s.messages.length)
    return `<div class="phone">${a(t, `<div class="contact"><span class="av">${(s.contact || '?')[0]}</span>${md(s.contact)}</div>`)}
      <div class="bulles">${s.messages.map((m, i) => a(t + 300 + i * step, `<div class="bulle ${m.de}">${md(m.texte)}</div>`, `ligne ${m.de}`)).join('')}</div></div>`
  },
  duo: (s, t, d) => `${s.titre ? a(t, `<h2 class="serif">${md(s.titre)}</h2>`) : ''}<div class="duo">${a(t + 300, `<div class="non"><i>❌</i>${md(s.non)}</div>`)}${a(t + d / 2, `<div class="oui"><i>✅</i>${md(s.oui)}</div>`)}</div>`,
  cta: (s, t) => `${a(t, `<h2 class="serif">${md(s.titre)}</h2>`)}${s.texte ? a(t + 400, `<p class="sous">${md(s.texte)}</p>`) : ''}${a(t + 800, `<div class="logo">${wordmark}</div>`)}`,
}

export function reelHtml(post) {
  let t = 0
  const n = post.scenes.length
  const scenes = post.scenes.map((s, i) => {
    const d = s.duree ?? D
    const fond = s.fond ?? (s.layout === 'cta' ? 'pine' : '')
    const html = `<div class="sc l-${s.layout} ${fond}" style="--s:${t}ms; --e:${i === n - 1 ? 999999 : t + d - 250}ms; z-index:${i + 1}">
      <div class="in">${layouts[s.layout](s, t + 150, d)}</div></div>`
    t += d
    return html
  }).join('\n')
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><style>${css}
html, body { width: 1080px; height: 1920px; }
.blob { position: absolute; border-radius: 50%; filter: blur(90px); opacity: .45; }
.b1 { width: 760px; height: 760px; background: var(--pine-soft); top: -200px; left: -260px; animation: d1 ${t}ms linear both; }
.b2 { width: 700px; height: 700px; background: var(--terra-soft); bottom: -160px; right: -240px; animation: d2 ${t}ms linear both; }
@keyframes d1 { to { transform: translate(180px, 260px); } }
@keyframes d2 { to { transform: translate(-160px, -300px); } }
.sc { position: absolute; inset: 0; animation: scIn 1ms linear var(--s) both, scOut 250ms ease var(--e) both; }
.sc:not(.pine) { background: transparent; }
.sc .in { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: 260px 90px 420px; text-align: center; }
@keyframes scIn { from { visibility: hidden; } to { visibility: visible; } }
@keyframes scOut { from { opacity: 1; } to { opacity: 0; } }
.a { animation: up 550ms var(--out) var(--t) both; }
@keyframes up { from { opacity: 0; transform: translateY(50px); } to { opacity: 1; transform: none; } }
h1 { font-size: 104px; line-height: 1.05; }
h2 { font-size: 84px; line-height: 1.08; margin-bottom: 50px; }
.kicker { font-size: 36px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: var(--terra); margin-bottom: 36px; }
.sous { font-size: 46px; line-height: 1.38; color: var(--ink-soft); font-weight: 500; margin-top: 46px; }
.pine .sous { color: #d6e3dc; }
.emo { font-size: 150px; margin-bottom: 40px; }
.liste { list-style: none; display: flex; flex-direction: column; gap: 26px; width: 100%; text-align: left; }
.liste li { display: flex; gap: 28px; align-items: center; background: #fff; border-radius: 32px; padding: 30px 36px; font-size: 42px; line-height: 1.3; font-weight: 600; box-shadow: 0 20px 40px -28px rgba(36,49,43,.45); }
.puce { flex: none; width: 70px; height: 70px; border-radius: 50%; background: var(--pine); color: #fff; display: grid; place-items: center; font-size: 36px; font-weight: 700; }
.phone { width: 900px; background: #fff; border-radius: 60px; padding: 40px 36px 50px; box-shadow: 0 50px 100px -40px rgba(36,49,43,.45), 0 0 0 14px #1d2622; text-align: left; }
.contact { display: flex; align-items: center; gap: 20px; font-size: 38px; font-weight: 700; padding-bottom: 28px; border-bottom: 2px solid var(--line); margin-bottom: 30px; }
.av { width: 70px; height: 70px; border-radius: 50%; background: var(--terra-soft); color: var(--terra); display: grid; place-items: center; }
.bulles { display: flex; flex-direction: column; gap: 20px; }
.ligne { display: flex; } .ligne.moi { justify-content: flex-end; }
.bulle { max-width: 78%; padding: 24px 32px; border-radius: 36px; font-size: 38px; line-height: 1.32; font-weight: 500; }
.bulle.ex { background: #ecebe8; border-bottom-left-radius: 10px; }
.bulle.moi { background: var(--pine); color: #fff; border-bottom-right-radius: 10px; }
.bulle.moi b { color: #fff; }
.duo { display: flex; flex-direction: column; gap: 30px; width: 100%; text-align: left; }
.duo .a > div { border-radius: 36px; padding: 40px 44px 40px 120px; position: relative; font-size: 42px; line-height: 1.35; font-weight: 500; }
.duo i { position: absolute; left: 40px; top: 40px; font-style: normal; font-size: 50px; }
.duo .non { background: #fff; color: var(--ink-soft); text-decoration: line-through; text-decoration-color: rgba(201,111,74,.5); }
.duo .oui { background: var(--pine-soft); }
.logo .wm { font-size: 96px; }
.l-cta .logo { margin-top: 80px; }
</style></head><body><div class="blob b1"></div><div class="blob b2"></div>${scenes}</body></html>`
}
