import { icalLinks } from '../ical'

it('construit les liens https, webcal et Google Agenda', () => {
  const l = icalLinks('abc123')
  expect(l.https).toBe('https://alternly.com/ical/abc123.ics')
  expect(l.webcal).toBe('webcal://alternly.com/ical/abc123.ics')
  expect(l.google).toBe('https://calendar.google.com/calendar/render?cid=webcal%3A%2F%2Falternly.com%2Fical%2Fabc123.ics')
})
