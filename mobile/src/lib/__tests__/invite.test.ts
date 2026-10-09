import { inviteMessage } from '../invite'

describe('inviteMessage', () => {
  it('nomme les enfants et termine par le lien', () => {
    const msg = inviteMessage(['Léa', 'Hugo'], 'https://alternly.com/join/abc')
    expect(msg).toContain('pour Léa et Hugo sur Alternly')
    expect(msg.endsWith('https://alternly.com/join/abc')).toBe(true)
  })

  it('a une variante sans enfant', () => {
    expect(inviteMessage([], 'L')).toContain('notre calendrier de garde sur Alternly')
  })
})
