// post.yaml → PNG (carrousel) ou MP4 + couverture (reel), et caption.txt.
// usage : node scripts/build.mjs [dossier-de-post …]   (sans argument : tous les posts)
//         --force   reconstruit même si out/ est à jour
import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath, pathToFileURL } from 'node:url'
import YAML from 'yaml'
import { chromium } from 'playwright-core'
import { carrouselHtml } from './templates/carrousel.mjs'
import { reelHtml, reelDuree } from './templates/reel.mjs'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'
const FFMPEG = process.env.FFMPEG || 'ffmpeg'
const FPS = 30
const HASHTAGS = YAML.parse(fs.readFileSync(path.join(ROOT, 'hashtags.yaml'), 'utf8'))

const args = process.argv.slice(2)
const force = args.includes('--force')
let dirs = args.filter((a) => !a.startsWith('--')).map((d) => path.resolve(d))
if (!dirs.length) {
  const postsDir = path.join(ROOT, 'posts')
  dirs = fs.readdirSync(postsDir).sort().map((d) => path.join(postsDir, d))
    .filter((d) => fs.existsSync(path.join(d, 'post.yaml')))
}

const caption = (post) => {
  const tags = (HASHTAGS[post.hashtags] || [post.hashtags]).concat(post.hashtags_extra || [], '#alternly')
  return `${post.legende.trim()}\n.\n.\n${[...new Set(tags)].join(' ')}\n`
}

const browser = await chromium.launch({ executablePath: CHROME })
for (const dir of dirs) {
  const post = YAML.parse(fs.readFileSync(path.join(dir, 'post.yaml'), 'utf8'))
  const out = path.join(dir, 'out')
  const src = path.join(dir, 'post.yaml')
  const stamp = path.join(out, '.built')
  if (!force && fs.existsSync(stamp) && fs.statSync(stamp).mtimeMs > fs.statSync(src).mtimeMs) {
    console.log('à jour', post.id); continue
  }
  fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out, { recursive: true })
  fs.writeFileSync(path.join(out, 'caption.txt'), caption(post))
  const page = path.join(out, '_page.html')

  if (post.format === 'carrousel') {
    fs.writeFileSync(page, carrouselHtml(post))
    const p = await browser.newPage({ viewport: { width: 1080, height: 1350 } })
    await p.goto(pathToFileURL(page).href); await p.evaluate(() => document.fonts.ready)
    for (let i = 1; i <= post.slides.length; i++) {
      await p.evaluate((i) => window.show(i), i)
      await p.screenshot({ path: path.join(out, `slide-${i}.png`) })
    }
    await p.close()
  } else {
    fs.writeFileSync(page, reelHtml(post))
    const dur = reelDuree(post)
    const p = await browser.newPage({ viewport: { width: 1080, height: 1920 } })
    await p.goto(pathToFileURL(page).href); await p.evaluate(() => document.fonts.ready)
    const seek = (t) => p.evaluate((t) => { for (const a of document.getAnimations()) { a.pause(); a.currentTime = t } }, t)
    const frames = path.join(out, '_frames'); fs.mkdirSync(frames)
    const n = Math.round((dur / 1000) * FPS)
    for (let i = 0; i < n; i++) {
      await seek((i * 1000) / FPS)
      await p.screenshot({ path: path.join(frames, String(i).padStart(5, '0') + '.jpg'), type: 'jpeg', quality: 92 })
    }
    await seek(post.couverture_ms ?? 1600)
    await p.screenshot({ path: path.join(out, 'couverture.png') })
    await p.close()
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', path.join(frames, '%05d.jpg'),
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=stereo', '-shortest',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', '-preset', 'medium', '-c:a', 'aac',
      '-movflags', '+faststart', path.join(out, 'reel.mp4')])
    fs.rmSync(frames, { recursive: true, force: true })
  }
  fs.rmSync(page)
  fs.writeFileSync(stamp, '')
  console.log('ok', post.id)
}
await browser.close()
