/** Mêmes règles que le backend : 8 caractères minimum, 72 octets maximum (bcrypt
 *  tronque au-delà ; un mot de passe accentué atteint la limite avant 72 caractères).
 *  Renvoie la clé de traduction du problème, ou null. */
export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'auth.passwordTooShort'
  if (new TextEncoder().encode(pw).length > 72) return 'auth.passwordTooLong'
  return null
}
