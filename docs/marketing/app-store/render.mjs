import { chromium } from '/opt/node-tools/node_modules/playwright/index.mjs'
const dir = process.argv[2]
const jobs = [
  { layout: 'wide169', vw: 1311, vh: 738, h: 738, dpr: 4, out: 'alternly-entete-5244x2950.png' },
  { layout: 'wide233', vw: 1280, vh: 549, h: 549, dpr: 3, out: 'alternly-entete-3840x1646.png' },
  { layout: 'search32', vw: 1280, vh: 854, h: 854, dpr: 3, out: 'alternly-recherche-3840x2560.png' },
]
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' })
for (const j of jobs) {
  const page = await browser.newPage({ viewport: { width: j.vw, height: j.vh }, deviceScaleFactor: j.dpr })
  await page.goto(`file://${dir}/entete.html?layout=${j.layout}`)
  await page.waitForSelector('body[data-ready="1"]')
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${dir}/${j.out}`, clip: { x: 0, y: 0, width: j.vw, height: j.h } })
  await page.close()
}
await browser.close()
