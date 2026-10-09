// Liens d'abonnement au calendrier de garde (flux iCal privé, servi sous alternly.com/ical/…).
import { WEB_URL } from './colors'

export function icalLinks(token: string): { https: string; webcal: string; google: string } {
  const https = `${WEB_URL}/ical/${token}.ics`
  const webcal = https.replace(/^https?:\/\//, 'webcal://')
  return {
    https,
    // iPhone : ouvre « S'abonner au calendrier » dans Calendrier.
    webcal,
    // Google Agenda : page « Ajouter un agenda à partir d'une URL », pré-remplie.
    google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(webcal)}`,
  }
}
