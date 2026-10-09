// Règle de garde et vacances : même parcours que l'onboarding, prérempli. Avec deux
// parents, la modification part en demande et s'applique quand l'autre l'accepte.
import { router } from 'expo-router'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { BackButton } from '@/components/BackButton'
import { pendingMessage } from '@/components/ChangeRequests'
import { RuleWizard, type RuleValue } from '@/components/RuleWizard'
import { Body, Button, Card, ErrorBanner, Loading, Screen, Title } from '@/components/ui'
import { api, isPendingChange } from '@/lib/api'
import { useHousehold, useHouseholdAction, useMe } from '@/lib/queries'
import { colors } from '@/lib/theme'

export default function RulesSettings() {
  const { t } = useTranslation()
  const household = useHousehold().data
  const meId = useMe().data?.id
  const [result, setResult] = useState<string | null>(null)

  const save = useHouseholdAction(
    async (value: RuleValue) => {
      const custody = await api.setCustodyRule(household!.id, value.custody)
      const vacation = await api.setVacationRule(household!.id, value.vacation)
      return isPendingChange(custody) || isPendingChange(vacation)
    },
    (pending) => setResult(pending ? pendingMessage() : t('onboarding.rules.saved')),
  )

  if (!household || meId === undefined) return <Loading />

  if (result) {
    return (
      <Screen edges={['top', 'bottom']}>
        <Title>{t('onboarding.rules.title')}</Title>
        <Card style={{ backgroundColor: colors.pineSoft, borderColor: colors.pineSoft }}>
          <Body>{result}</Body>
        </Card>
        <Button title={t('onboarding.rules.backToSettings')} onPress={() => router.back()} />
      </Screen>
    )
  }

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <ErrorBanner message={save.error?.message} />
      <RuleWizard
        members={household.members}
        myId={meId}
        childNames={household.children.map((c) => c.first_name)}
        initial={{ custody: household.custody_rule, vacation: household.vacation_rule }}
        stepOffset={0}
        stepTotal={4}
        busy={save.isPending}
        submitLabel={t('onboarding.rules.submit')}
        onSubmit={(v) => save.mutate(v)}
      />
    </Screen>
  )
}
