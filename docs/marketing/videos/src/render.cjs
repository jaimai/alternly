// Rendu image par image d'une composition HTML/CSS → MP4 H.264.
// usage : node render.cjs page.html W H durée_ms sortie.mp4 [fps] [--stills t1,t2,…]
const { chromium } = require('playwright')
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const [, , page, W, H, DUR, OUT, FPS = '30', ...rest] = process.argv
const stills = (rest[rest.indexOf('--stills') + 1] || '').split(',').filter(Boolean).map(Number)
const FFMPEG = process.env.FFMPEG
const fps = Number(FPS)
const frames = Math.round((Number(DUR) / 1000) * fps)

;(async () => {
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' })
  const ctx = await browser.newContext({ viewport: { width: +W, height: +H }, deviceScaleFactor: 1 })
  const p = await ctx.newPage()
  await p.goto('file://' + path.resolve(page))
  await p.evaluate(() => document.fonts.ready)
  const seek = (t) => p.evaluate((t) => { for (const a of document.getAnimations()) a.currentTime = t }, t)
  await seek(9000)
  await p.evaluate(() => window.layout && window.layout())

  if (stills.length) {
    for (const t of stills) { await seek(t); await p.screenshot({ path: `${OUT}-${t}.png` }) }
    await browser.close(); return
  }
  const dir = OUT + '.frames'
  fs.rmSync(dir, { recursive: true, force: true }); fs.mkdirSync(dir)
  for (let i = 0; i < frames; i++) {
    await seek((i * 1000) / fps)
    await p.screenshot({ path: path.join(dir, String(i).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 95 })
  }
  await browser.close()
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', path.join(dir, '%05d.jpg'),
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', '-movflags', '+faststart', OUT])
  fs.rmSync(dir, { recursive: true, force: true })
  console.log('ok', OUT, frames, 'images')
})()
