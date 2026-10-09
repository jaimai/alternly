import { pushTarget } from '../pushTarget'

describe('pushTarget', () => {
  it('ouvre la réponse à un échange proposé', () => {
    expect(pushTarget({ type: 'exchange_proposed', id: 12 })).toEqual({ pathname: '/exchange/[id]', params: { id: '12' } })
  })

  it('ouvre la zone concernée pour les autres types', () => {
    expect(pushTarget({ type: 'exchange_accepted', id: 3 })).toEqual({ pathname: '/calendar' })
    expect(pushTarget({ type: 'expense_added' })).toEqual({ pathname: '/expenses' })
    expect(pushTarget({ type: 'wall_task_assigned' })).toEqual({ pathname: '/wall' })
    expect(pushTarget({ type: 'parent_joined' })).toEqual({ pathname: '/settings' })
    expect(pushTarget({ type: 'handover_reminder' })).toEqual({ pathname: '/calendar' })
  })

  it('ouvre la dépense concernée', () => {
    expect(pushTarget({ type: 'expense_disputed', id: 7 })).toEqual({ pathname: '/expense/[id]', params: { id: '7' } })
    expect(pushTarget({ type: 'settlement_recorded', id: 4 })).toEqual({ pathname: '/expenses' })
  })

  it('ouvre le post du tableau, y compris pour une réponse', () => {
    expect(pushTarget({ type: 'wall_task_assigned', id: 5 })).toEqual({ pathname: '/wall/[id]', params: { id: '5' } })
    expect(pushTarget({ type: 'wall_reply_added', post_id: 8 })).toEqual({ pathname: '/wall/[id]', params: { id: '8' } })
  })

  it('retombe sur le centre de notifications sans type', () => {
    expect(pushTarget(undefined)).toEqual({ pathname: '/notifications' })
  })
})
