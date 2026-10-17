import { router, useLocalSearchParams } from 'expo-router'
import { useTranslation } from 'react-i18next'
import { Text, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Icon } from '@/components/Icon'
import { Avatar, Body, Button, Card, ErrorBanner, ErrorState, Loading, Screen, Title } from '@/components/ui'
import { memberById, whoName } from '@/lib/custody'
import { addDays, formatLong, parseIso } from '@/lib/dates'
import { useAnswerExchange, useMe, useUpcoming } from '@/lib/queries'
import { colors, fonts, tint } from '@/lib/theme'

export default function AnswerExchange() {
  const { t } = useTranslation()
  const { id } = useLocalSearchParams<{ id: string }>()
  const meId = useMe().data?.id
  const { household, calendar } = useUpcoming()
  const answer = useAnswerExchange(household?.id)

  if (calendar.isPending) return <Loading />
  if (calendar.isError) return <ErrorState message={calendar.error.message} onRetry={() => calendar.refetch()} />

  const cal = calendar.data
  const exchange = cal.pending_exchanges.find((e) => String(e.id) === id)

  if (answer.isSuccess) {
    return (
      <Screen edges={['top', 'bottom']}>
        <BackButton />
        <Card style={{ backgroundColor: colors.pineSoft, borderColor: colors.pineSoft, flexDirection: 'row', gap: 12 }}>
          <Icon name="check" color={colors.pine} strokeWidth={2.4} />
          <Body style={{ flex: 1 }}>
            {answer.variables?.accept
              ? t('calendar.exchangeAnswer.accepted')
              : t('calendar.exchangeAnswer.refused')}
          </Body>
        </Card>
        <Button title={t('calendar.exchangeAnswer.backHome')} onPress={() => router.back()} />
      </Screen>
    )
  }

  if (!exchange) {
    return (
      <Screen edges={['top', 'bottom']}>
        <BackButton />
        <Body muted>{t('calendar.exchangeAnswer.gone')}</Body>
      </Screen>
    )
  }

  const proposer = memberById(cal.members, exchange.proposed_by)
  const target = memberById(cal.members, exchange.proposed_parent_id)
  const targetName = whoName(cal.members, exchange.proposed_parent_id, meId)
  // Aperçu jour par jour (7 jours max) : couleur actuelle → couleur proposée.
  const span: string[] = []
  for (let d = exchange.date_start; d <= exchange.date_end && span.length < 7; d = addDays(d, 1)) span.push(d)

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
        <Avatar name={proposer?.display_name ?? '?'} color={proposer?.color ?? colors.terra} size={48} />
        <Title style={{ flex: 1, fontSize: 24, lineHeight: 30 }}>
          {t('calendar.exchangeAnswer.proposes', { name: proposer?.display_name ?? t('calendar.exchangeAnswer.otherParent') })}
        </Title>
      </View>

      <ErrorBanner message={answer.error?.message} />

      <Card>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'flex-start' }}>
          <Icon name="swap" color={colors.terraText} strokeWidth={2} />
          <View style={{ flex: 1, gap: 2 }}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink }}>
              {t('calendar.exchangeAnswer.range', { start: formatLong(exchange.date_start), end: formatLong(exchange.date_end) })}
            </Text>
            <Text style={{ fontFamily: fonts.body, fontSize: 14, color: colors.inkSoft }}>
              {t('calendar.exchangeAnswer.kidsWouldBe', { name: targetName })}
            </Text>
          </View>
        </View>
        {exchange.note ? (
          <View style={{ backgroundColor: colors.paper, borderRadius: 12, padding: 12 }}>
            <Body style={{ fontSize: 14 }}>{t('calendar.exchangeAnswer.note', { note: exchange.note })}</Body>
          </View>
        ) : null}
      </Card>

      <Card>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSoft }}>{t('calendar.exchangeAnswer.beforeAfter')}</Text>
        {[
          { label: t('calendar.exchangeAnswer.before'), color: (d: string) => memberById(cal.members, cal.days.find((x) => x.date === d)?.parent_id)?.color },
          { label: t('calendar.exchangeAnswer.after'), color: () => target?.color },
        ].map((row) => (
          <View key={row.label} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ width: 48, fontFamily: fonts.bodyBold, fontSize: 12, color: colors.inkSoft }}>{row.label}</Text>
            <View style={{ flex: 1, flexDirection: 'row', gap: 4 }}>
              {span.map((d) => {
                const c = row.color(d) ?? colors.line
                return (
                  <View key={d} style={{ flex: 1, height: 32, borderRadius: 8, backgroundColor: tint(c, 0.35), alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
                    <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.ink }}>{parseIso(d).getDate()}</Text>
                    <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, backgroundColor: c }} />
                  </View>
                )
              })}
            </View>
          </View>
        ))}
      </Card>

      <View style={{ gap: 10 }}>
        <Button
          title={t('calendar.exchangeAnswer.accept')}
          onPress={() => answer.mutate({ id: exchange.id, accept: true })}
          loading={answer.isPending && answer.variables?.accept}
          disabled={answer.isPending}
        />
        <Button
          title={t('calendar.exchangeAnswer.refuse')}
          variant="danger"
          onPress={() => answer.mutate({ id: exchange.id, accept: false })}
          loading={answer.isPending && !answer.variables?.accept}
          disabled={answer.isPending}
        />
        <Button
          title={t('calendar.exchangeAnswer.counter')}
          variant="ghost"
          onPress={() => router.replace({ pathname: '/exchange/new', params: { replaces: String(exchange.id) } })}
          disabled={answer.isPending}
        />
      </View>
    </Screen>
  )
}
