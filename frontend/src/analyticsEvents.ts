/**
 * Taxonomie des événements produit (côté SPA). Dictionnaire complet, propriétés
 * et événements serveur : docs/analytics.md.
 *
 * Règle : jamais de texte libre en propriété (libellés, notes, messages, prénoms,
 * e-mails) — seulement des énumérations, booléens et nombres.
 */
export const EV = {
  // Acquisition / compte
  signupStarted: 'signup_started', // method: email|google
  signedUp: 'signed_up', // method, via_invite, utm_*
  login: 'login', // method
  passwordResetRequested: 'password_reset_requested',
  passwordChanged: 'password_changed', // first_password
  dataExported: 'data_exported',
  languageChanged: 'language_changed', // from, to
  consentChanged: 'consent_changed', // value (envoyé seulement après acceptation)

  // Onboarding / activation
  onboardingStepCompleted: 'onboarding_step_completed', // step
  onboardingCompleted: 'onboarding_completed', // country, children_count
  childAdded: 'child_added', // source: onboarding|settings
  inviteCreated: 'invite_created',
  inviteShared: 'invite_shared', // channel: native|whatsapp|sms|email|copy|qr|alternly_email, source
  inviteMessageEdited: 'invite_message_edited', // source
  inviteOpened: 'invite_opened', // valid, already_member (page /join)
  inviteAccepted: 'invite_accepted',

  // Calendrier / échanges
  exchangeProposed: 'exchange_proposed', // days, lead_days
  exchangeCountered: 'exchange_countered',
  exchangeAccepted: 'exchange_accepted',
  exchangeRefused: 'exchange_refused',
  exchangeWithdrawn: 'exchange_withdrawn',
  exchangeDeleted: 'exchange_deleted',
  changeRequestCreated: 'change_request_created', // kind
  changeRequestAccepted: 'change_request_accepted', // kind
  changeRequestRefused: 'change_request_refused', // kind
  changeRequestWithdrawn: 'change_request_withdrawn', // kind
  custodyRuleSaved: 'custody_rule_saved', // pattern, pending, source
  calendarNavigated: 'calendar_navigated', // direction (limité à 1 / 10 s)
  historyViewed: 'history_viewed',
  feedbackOpened: 'feedback_opened', // source (fab, settings) ; l'envoi est compté côté serveur (feedback_sent)
  tipCompleted: 'tip_completed', // tip (day, tabs, sync), via (button, action)
  tipsDismissed: 'tips_dismissed', // at
  notificationOpened: 'notification_opened', // type

  // Dépenses
  expenseAdded: 'expense_added', // category, split, amount, has_child
  expenseDisputed: 'expense_disputed',
  expenseSettled: 'expense_settled',
  settlementRecorded: 'settlement_recorded', // amount

  // Mur
  wallPostCreated: 'wall_post_created', // kind, has_due_date, assigned
  wallReplyCreated: 'wall_reply_created',
  taskCompleted: 'task_completed',

  // Synchronisation agenda
  icalLinkGenerated: 'ical_link_generated',
  icalLinkCopied: 'ical_link_copied',

  // Monétisation
  paywallViewed: 'paywall_viewed', // feature
  checkoutOpened: 'checkout_opened', // plan, source
  checkoutCompleted: 'checkout_completed', // plan
  planChanged: 'plan_changed', // plan
  // (subscription_canceled est émis par le serveur, webhook Paddle)
  subscriptionCancelRequested: 'subscription_cancel_requested',
} as const

export type AnalyticsEvent = (typeof EV)[keyof typeof EV]
