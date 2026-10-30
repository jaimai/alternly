// Charte Alternly partagée par les templates (polices de docs/marketing/videos/src).
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const FONTS = pathToFileURL(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../videos/src')).href

export const css = `
@font-face { font-family: 'Fraunces'; src: url(${FONTS}/fraunces-latin-full-normal.woff2) format('woff2'); font-weight: 100 900; }
@font-face { font-family: 'Fraunces'; src: url(${FONTS}/fraunces-latin-full-italic.woff2) format('woff2'); font-weight: 100 900; font-style: italic; }
@font-face { font-family: 'Instrument Sans'; src: url(${FONTS}/instrument-sans-latin-500-normal.woff2) format('woff2'); font-weight: 500; }
@font-face { font-family: 'Instrument Sans'; src: url(${FONTS}/instrument-sans-latin-600-normal.woff2) format('woff2'); font-weight: 600; }
@font-face { font-family: 'Instrument Sans'; src: url(${FONTS}/instrument-sans-latin-700-normal.woff2) format('woff2'); font-weight: 700; }
:root {
  --paper: #faf6ef; --paper-deep: #f3ecdf; --ink: #24312b; --ink-soft: #5d6b63;
  --pine: #1f4d3f; --pine-soft: #e4ede7; --terra: #c96f4a; --terra-soft: #f5e0d5; --line: #e7dfd0;
  --out: cubic-bezier(0.23, 1, 0.32, 1);
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: 'Instrument Sans', sans-serif; color: var(--ink); -webkit-font-smoothing: antialiased; background: var(--paper); overflow: hidden; }
.serif { font-family: 'Fraunces', Georgia, serif; font-variation-settings: 'opsz' 72; letter-spacing: -0.02em; font-weight: 500; }
em { font-style: italic; color: var(--terra); }
b { font-weight: 700; color: var(--ink); }
.pine { background: var(--pine); color: var(--paper); }
.pine em { color: #f0b597; }
.pine b { color: var(--paper); }
.wm { font-family: 'Fraunces', serif; letter-spacing: -0.02em; color: var(--ink); }
.wm span { font-style: italic; color: var(--pine); }
.pine .wm, .pine .wm span { color: var(--paper); }
`

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
// **gras**, *italique terracotta*, retour à la ligne
export const md = (s) => esc(s)
  .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
  .replace(/\*(.+?)\*/g, '<em>$1</em>')
  .replace(/\n/g, '<br>')
  .replace(/ ([?!:;»])/g, '&nbsp;$1').replace(/« /g, '«&nbsp;')

export const wordmark = '<span class="wm">Altern<span>ly</span></span>'
