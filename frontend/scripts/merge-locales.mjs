// Fusionne les fichiers de traduction partiels (src/locales/parts/<ns>.<lang>.json)
// en src/locales/fr.json et src/locales/en.json. Clés plates (keySeparator:false).
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const partsDir = join(root, 'src/locales/parts')
const localesDir = join(root, 'src/locales')

for (const lang of ['fr', 'en']) {
  const merged = {}
  const files = readdirSync(partsDir).filter((f) => f.endsWith(`.${lang}.json`)).sort()
  for (const f of files) {
    const obj = JSON.parse(readFileSync(join(partsDir, f), 'utf8'))
    for (const [k, v] of Object.entries(obj)) {
      if (k in merged && merged[k] !== v) console.warn(`⚠ clé en double: ${k} (${f})`)
      merged[k] = v
    }
  }
  const sorted = Object.fromEntries(Object.entries(merged).sort(([a], [b]) => a.localeCompare(b)))
  writeFileSync(join(localesDir, `${lang}.json`), JSON.stringify(sorted, null, 2) + '\n')
  console.log(`${lang}.json : ${Object.keys(sorted).length} clés depuis ${files.length} fichiers`)
}
