// Achats intégrés (App Store / Google Play) via RevenueCat. Le backend reste la seule
// source de vérité : après un achat ou une restauration, l'app demande au backend de
// relire RevenueCat (POST /billing/store-sync) et affiche le statut qu'il renvoie.
// Conception : docs/mobile/architecture-technique.md §7.3.
import { Platform } from 'react-native'
import Purchases, { PURCHASES_ERROR_CODE, type PurchasesPackage } from 'react-native-purchases'
import { api } from './api'
import { t } from './i18n'
import type { BillingStatus } from './types'

// Clés publiques RevenueCat (une par store), pas des secrets.
const API_KEY = Platform.select({
  ios: process.env.EXPO_PUBLIC_REVENUECAT_IOS_KEY,
  android: process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_KEY,
})

export class PurchaseCancelled extends Error {}

/** Achat intégré possible ici ? (iPhone / Android avec la clé RevenueCat du store) */
export function iapAvailable(): boolean {
  return !!API_KEY
}

let configured = false

/** Rattache les achats au compte Alternly : l'app_user_id RevenueCat est notre id. */
export async function identifyPurchaser(userId: number): Promise<void> {
  if (!API_KEY) return
  if (!configured) {
    Purchases.configure({ apiKey: API_KEY, appUserID: String(userId) })
    configured = true
  } else {
    await Purchases.logIn(String(userId))
  }
}

/** À la déconnexion : le prochain compte connecté sur ce téléphone repart de zéro. */
export async function forgetPurchaser(): Promise<void> {
  if (!configured) return
  try {
    await Purchases.logOut()
  } catch {
    // déjà anonyme : rien à oublier
  }
}

/** Offres du moment (annuelle, mensuelle), avec les prix du store dans la devise locale. */
export async function loadPackages(): Promise<PurchasesPackage[]> {
  const offerings = await Purchases.getOfferings()
  const order = ['ANNUAL', 'MONTHLY']
  return [...(offerings.current?.availablePackages ?? [])].sort(
    (a, b) => order.indexOf(a.packageType) - order.indexOf(b.packageType),
  )
}

export async function purchase(pkg: PurchasesPackage): Promise<BillingStatus> {
  try {
    await Purchases.purchasePackage(pkg)
  } catch (e) {
    if ((e as { userCancelled?: boolean })?.userCancelled) throw new PurchaseCancelled()
    if ((e as { code?: string })?.code === PURCHASES_ERROR_CODE.PAYMENT_PENDING_ERROR) {
      throw new Error(t('premium.paymentPending'))
    }
    throw e
  }
  return api.storeSync()
}

/** « Restaurer les achats » (obligatoire pour l'App Store) : nouveau téléphone, réinstallation. */
export async function restore(): Promise<BillingStatus> {
  await Purchases.restorePurchases()
  return api.storeSync()
}

export function manageSubscription(): Promise<void> {
  return Purchases.showManageSubscriptions()
}
