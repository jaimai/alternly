import { addDays, addMonths, daysBetween, formatAgo, formatRange, monthGrid, weekStart } from '../dates'

describe('dates', () => {
  it('additionne les jours en traversant les mois et le changement d’heure', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDays('2026-10-24', 2)).toBe('2026-10-26') // passage à l'heure d'hiver le 25
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })

  it('compte les jours entre deux dates', () => {
    expect(daysBetween('2026-10-09', '2026-10-16')).toBe(7)
  })

  it('trouve le lundi de la semaine', () => {
    expect(weekStart('2026-10-09')).toBe('2026-10-05') // vendredi → lundi
    expect(weekStart('2026-10-11')).toBe('2026-10-05') // dimanche → lundi précédent
    expect(weekStart('2026-10-05')).toBe('2026-10-05')
  })

  it('ajoute des mois depuis le premier du mois', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-01')
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-01')
  })

  it('construit une grille de semaines complètes', () => {
    const grid = monthGrid('2026-10-09') // octobre 2026 commence un jeudi
    expect(grid[0]).toBe('2026-09-28')
    expect(grid[grid.length - 1]).toBe('2026-11-01')
    expect(grid).toHaveLength(35)
    expect(monthGrid('2026-08-01')).toHaveLength(42) // août 2026 : samedi 1er, 6 semaines
  })

  it('formate les plages', () => {
    expect(formatRange('2026-10-24', '2026-10-25')).toBe('24 → 25 oct.')
    expect(formatRange('2026-09-30', '2026-10-02')).toBe('30 sept. → 2 oct.')
  })

  it('formate les horodatages relatifs (UTC naïf du serveur)', () => {
    const now = new Date('2026-10-09T12:00:00Z')
    expect(formatAgo('2026-10-09T11:59:40', now)).toBe("à l'instant")
    expect(formatAgo('2026-10-09T11:15:00', now)).toBe('il y a 45 min')
  })
})
