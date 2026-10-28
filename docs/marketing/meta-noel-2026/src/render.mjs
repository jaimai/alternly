// Rendu des visuels de l'annonce V1 : node render.mjs "$PWD/.."  (Playwright + Chromium)
import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
const here = path.dirname(fileURLToPath(import.meta.url))
const out = process.argv[2] || path.join(here, '..')
const browser = await chromium.launch({ executablePath: process.env.CHROME || '/opt/pw-browsers/chromium' })
for (const [f, h] of [['feed', 1350], ['story', 1920]]) {
  const page = await browser.newPage({ viewport: { width: 1080, height: h }, deviceScaleFactor: 1 })
  await page.goto(`file://${here}/visuel.html?f=${f}`)
  await page.waitForSelector('body[data-ready="1"]')
  await page.waitForTimeout(200)
  await page.screenshot({ path: path.join(out, `v1-${f}.png`) })
  await page.close()
}
await browser.close()
