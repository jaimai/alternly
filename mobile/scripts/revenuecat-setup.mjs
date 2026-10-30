#!/usr/bin/env node
// Configure le projet RevenueCat d'Alternly via l'API v2, sans rien dupliquer (relançable) :
// produits App Store / Google Play, entitlement « premium », offre « default » (paquets
// annuel et mensuel, offre courante) et webhook vers le backend.
//
// Usage (depuis mobile/) :
//   REVENUECAT_V2_SECRET=sk_… REVENUECAT_WEBHOOK_SECRET='Bearer …' node scripts/revenuecat-setup.mjs
// Variables facultatives : REVENUECAT_PROJECT_ID (sinon le seul projet du compte),
// API_URL (défaut : l'API de production), et les identifiants produits ci-dessous.
// Sortie : les clés publiques des apps (appl_…, goog_…) à mettre dans EXPO_PUBLIC_REVENUECAT_*.
// Le secret du webhook n'est jamais affiché.

const API = 'https://api.revenuecat.com/v2'
const SECRET = process.env.REVENUECAT_V2_SECRET
const WEBHOOK_AUTH = process.env.REVENUECAT_WEBHOOK_SECRET
const API_URL = process.env.API_URL || 'https://web-production-d1aa3.up.railway.app/api'

// Identifiants des abonnements dans les stores (à créer à l'identique dans App Store Connect
// et la Play Console). Play : « idAbonnement:idForfaitDeBase ».
const PRODUCTS = {
  annual: {
    app_store: process.env.IOS_ANNUAL_ID || 'com.alternly.premium.annual',
    play_store: process.env.PLAY_ANNUAL_ID || 'premium:annual',
    package: '$rc_annual',
    label: 'Annuel',
    position: 1,
  },
  monthly: {
    app_store: process.env.IOS_MONTHLY_ID || 'com.alternly.premium.monthly',
    play_store: process.env.PLAY_MONTHLY_ID || 'premium:monthly',
    package: '$rc_monthly',
    label: 'Mensuel',
    position: 2,
  },
}
const ENTITLEMENT = 'premium'
const OFFERING = 'default'

if (!SECRET) {
  console.error('REVENUECAT_V2_SECRET manquant (clé secrète API v2, droits « Project configuration » en écriture).')
  process.exit(1)
}

async function rc(method, path, body) {
  const resp = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${SECRET}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await resp.text()
  const data = text ? JSON.parse(text) : {}
  if (!resp.ok) throw new Error(`${method} ${path} → ${resp.status} ${data.message ?? text}`)
  return data
}

/** Toutes les pages d'une liste. */
async function list(path) {
  const items = []
  let url = `${path}${path.includes('?') ? '&' : '?'}limit=100`
  while (url) {
    const page = await rc('GET', url)
    items.push(...page.items)
    url = page.next_page ? page.next_page.replace(/^.*\/v2/, '') : null
  }
  return items
}

async function main() {
  let projectId = process.env.REVENUECAT_PROJECT_ID
  if (!projectId) {
    const projects = await list('/projects')
    if (projects.length !== 1) {
      throw new Error(`${projects.length} projets trouvés : préciser REVENUECAT_PROJECT_ID (${projects.map((p) => `${p.id} « ${p.name} »`).join(', ')})`)
    }
    projectId = projects[0].id
  }
  const p = `/projects/${projectId}`
  console.log(`Projet : ${projectId}`)

  // Apps du projet (créées dans le tableau de bord, avec leurs identifiants de store).
  const apps = await list(`${p}/apps`)
  const appOf = (type) => apps.find((a) => a.type === type)
  const stores = ['app_store', 'play_store'].filter((t) => appOf(t))
  if (stores.length === 0) throw new Error('Aucune app App Store ni Google Play dans ce projet : les ajouter d’abord dans RevenueCat.')
  for (const t of ['app_store', 'play_store']) console.log(`App ${t} : ${appOf(t) ? appOf(t).id : 'absente (ignorée)'}`)

  // Produits.
  const existing = await list(`${p}/products`)
  const productIds = {} // { annual: { app_store: id, play_store: id }, … }
  for (const [plan, def] of Object.entries(PRODUCTS)) {
    productIds[plan] = {}
    for (const store of stores) {
      const app = appOf(store)
      let product = existing.find((x) => x.app_id === app.id && x.store_identifier === def[store])
      if (!product) {
        product = await rc('POST', `${p}/products`, {
          store_identifier: def[store],
          app_id: app.id,
          type: 'subscription',
          display_name: `Alternly Premium — ${def.label}`,
        })
        console.log(`+ produit ${store} ${def[store]}`)
      } else {
        console.log(`= produit ${store} ${def[store]}`)
      }
      productIds[plan][store] = product.id
    }
  }
  const allProducts = Object.values(productIds).flatMap((byStore) => Object.values(byStore))

  // Entitlement « premium » : le backend n'accorde Premium que pour lui (REVENUECAT_ENTITLEMENT).
  let entitlement = (await list(`${p}/entitlements`)).find((e) => e.lookup_key === ENTITLEMENT)
  if (!entitlement) {
    entitlement = await rc('POST', `${p}/entitlements`, { lookup_key: ENTITLEMENT, display_name: 'Alternly Premium' })
    console.log(`+ entitlement ${ENTITLEMENT}`)
  }
  const attached = new Set((await list(`${p}/entitlements/${entitlement.id}/products`)).map((x) => x.id))
  const toAttach = allProducts.filter((id) => !attached.has(id))
  if (toAttach.length) {
    await rc('POST', `${p}/entitlements/${entitlement.id}/actions/attach_products`, { product_ids: toAttach })
    console.log(`+ ${toAttach.length} produit(s) rattaché(s) à ${ENTITLEMENT}`)
  }

  // Offre « default », courante, avec ses deux paquets.
  let offering = (await list(`${p}/offerings`)).find((o) => o.lookup_key === OFFERING)
  if (!offering) {
    offering = await rc('POST', `${p}/offerings`, { lookup_key: OFFERING, display_name: 'Alternly Premium' })
    console.log(`+ offre ${OFFERING}`)
  }
  if (!offering.is_current) {
    await rc('POST', `${p}/offerings/${offering.id}`, { display_name: offering.display_name, is_current: true })
    console.log(`= offre ${OFFERING} rendue courante`)
  }
  const packages = await list(`${p}/offerings/${offering.id}/packages?expand=items.product`)
  for (const [plan, def] of Object.entries(PRODUCTS)) {
    let pkg = packages.find((x) => x.lookup_key === def.package)
    if (!pkg) {
      pkg = await rc('POST', `${p}/offerings/${offering.id}/packages`, {
        lookup_key: def.package,
        display_name: def.label,
        position: def.position,
      })
      console.log(`+ paquet ${def.package}`)
    }
    const inPackage = new Set((pkg.products?.items ?? []).map((x) => x.product?.id ?? x.product_id))
    const missing = Object.values(productIds[plan]).filter((id) => !inPackage.has(id))
    if (missing.length) {
      await rc('POST', `${p}/packages/${pkg.id}/actions/attach_products`, {
        products: missing.map((product_id) => ({ product_id, eligibility_criteria: 'all' })),
      })
      console.log(`+ ${missing.length} produit(s) dans ${def.package}`)
    }
  }

  // Webhook vers le backend (en-tête Authorization = REVENUECAT_WEBHOOK_SECRET de Railway).
  if (WEBHOOK_AUTH) {
    const url = `${API_URL}/billing/revenuecat-webhook`
    const hooks = await list(`${p}/integrations/webhooks`)
    const hook = hooks.find((h) => h.url === url)
    const body = { name: 'Alternly backend', url, authorization_header: WEBHOOK_AUTH }
    if (hook) await rc('POST', `${p}/integrations/webhooks/${hook.id}`, body)
    else await rc('POST', `${p}/integrations/webhooks`, body)
    console.log(`${hook ? '=' : '+'} webhook ${url} (en-tête d’autorisation mis à jour, non affiché)`)
  } else {
    console.log('Webhook ignoré : REVENUECAT_WEBHOOK_SECRET non fourni.')
  }

  // Clés publiques (non secrètes) pour l'app.
  for (const store of stores) {
    const keys = await list(`${p}/apps/${appOf(store).id}/public_api_keys`)
    const prod = keys.find((k) => k.environment === 'production') ?? keys[0]
    const name = store === 'app_store' ? 'EXPO_PUBLIC_REVENUECAT_IOS_KEY' : 'EXPO_PUBLIC_REVENUECAT_ANDROID_KEY'
    console.log(`${name}=${prod?.key ?? '(introuvable)'}`)
  }
}

main().catch((e) => {
  console.error(e.message)
  process.exit(1)
})
