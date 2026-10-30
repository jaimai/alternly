// Journal de garde : notes factuelles, datées, privées (mêmes règles que
// frontend/src/pages/Journal.tsx). Fonction Premium (402 sinon). Partage en texte ;
// l'export PDF se fait sur le web.
import { router } from 'expo-router'
import { Pressable, RefreshControl, ScrollView, Share, StyleSheet, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { BackButton } from '@/components/BackButton'
import { Icon } from '@/components/Icon'
import { Paywall } from '@/components/Paywall'
import { Body, Button, ErrorState, Loading, SectionLabel } from '@/components/ui'
import { parseIso, parseTimestamp } from '@/lib/dates'
import { JOURNAL_LABEL, groupByMonth, journalText } from '@/lib/journal'
import { useHousehold, useJournal, useMe } from '@/lib/queries'
import { colors, fonts, radius } from '@/lib/theme'

export default function Journal() {
  const household = useHousehold().data ?? undefined
  const me = useMe().data
  const { journal, locked } = useJournal(household?.id)
  const childName = (id: number | null) => household?.children.find((c) => c.id === id)?.first_name ?? null

  let body
  if (locked) {
    body = (
      <Paywall
        title="Le journal de garde, avec Premium"
        intro="Notez les passages, retards, changements, rendez-vous de santé ou d’école. Privé : l’autre parent ne le voit jamais."
      />
    )
  } else if (journal.isError) body = <ErrorState message={journal.error.message} onRetry={() => journal.refetch()} />
  else if (!household || !journal.data) body = <Loading />
  else if (journal.data.length === 0) {
    body = (
      <View style={{ gap: 12 }}>
        <Body muted>
          Votre journal est vide. Ajoutez une première note : un passage de relais, un retard, un rendez-vous médical…
          Chaque note est datée et horodatée à sa saisie.
        </Body>
        <Button title="Nouvelle note" onPress={() => router.push('/journal/edit')} />
      </View>
    )
  } else {
    const entries = journal.data
    body = (
      <>
        <Button
          title="Partager le journal (texte)"
          variant="secondary"
          onPress={() => Share.share({ message: journalText(entries, me?.display_name ?? '', childName) })}
        />
        <Body muted style={{ fontSize: 13 }}>Pour un PDF à imprimer, ouvrez le journal sur alternly.com.</Body>
        {groupByMonth(entries).map((g) => (
          <View key={g.month} style={{ gap: 8 }}>
            <SectionLabel>{g.label}</SectionLabel>
            <View style={s.group}>
              {g.entries.map((e, i) => (
                <Pressable
                  key={e.id}
                  accessibilityRole="button"
                  accessibilityLabel={`Modifier la note du ${e.day}`}
                  onPress={() => router.push({ pathname: '/journal/edit', params: { id: String(e.id) } })}
                  style={({ pressed }) => [s.row, i > 0 && s.border, pressed && { backgroundColor: colors.paperDeep }]}
                >
                  <View style={s.meta}>
                    <Text style={s.day}>
                      {parseIso(e.day).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' })}
                      {e.time ? ` · ${e.time}` : ''}
                    </Text>
                    <Text style={s.kind}>{JOURNAL_LABEL[e.kind]}</Text>
                    {childName(e.child_id) ? <Text style={s.child}>{childName(e.child_id)}</Text> : null}
                  </View>
                  <Text style={s.body}>{e.body}</Text>
                  <Text style={s.stamp}>
                    Saisie le{' '}
                    {parseTimestamp(e.created_at).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                    {e.edited_at ? ' · modifiée' : ''}
                  </Text>
                </Pressable>
              ))}
            </View>
          </View>
        ))}
      </>
    )
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.paper }} edges={['top', 'bottom']}>
      <ScrollView
        contentContainerStyle={s.content}
        refreshControl={<RefreshControl refreshing={journal.isRefetching} onRefresh={() => journal.refetch()} tintColor={colors.pine} />}
      >
        <BackButton />
        <View style={s.header}>
          <Text accessibilityRole="header" style={s.title}>Journal de garde</Text>
          {!locked && household ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Nouvelle note" onPress={() => router.push('/journal/edit')} style={s.add}>
              <Icon name="plus" color="#fff" strokeWidth={2.4} />
            </Pressable>
          ) : null}
        </View>
        {!locked ? (
          <View style={s.private}>
            <Text style={s.privateText}>Privé : l’autre parent ne voit jamais votre journal.</Text>
          </View>
        ) : null}
        {body}
      </ScrollView>
    </SafeAreaView>
  )
}

const s = StyleSheet.create({
  content: { padding: 20, gap: 14, paddingBottom: 40 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontFamily: fonts.display, fontSize: 28, color: colors.ink },
  add: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.pine, alignItems: 'center', justifyContent: 'center' },
  private: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    backgroundColor: colors.pineSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5,
  },
  privateText: { fontFamily: fonts.bodyMedium, fontSize: 13, color: colors.pine },
  group: { backgroundColor: colors.surface, borderRadius: radius.lg, borderWidth: 1, borderColor: colors.line, overflow: 'hidden' },
  row: { padding: 14, gap: 4 },
  border: { borderTopWidth: 1, borderTopColor: colors.line },
  meta: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  day: { fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink },
  kind: {
    fontFamily: fonts.bodySemiBold, fontSize: 12, color: colors.pineDeep, backgroundColor: colors.pineSoft,
    borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden',
  },
  child: { fontFamily: fonts.body, fontSize: 13, color: colors.inkSoft },
  body: { fontFamily: fonts.body, fontSize: 15, color: colors.ink, lineHeight: 21 },
  stamp: { fontFamily: fonts.body, fontSize: 12, color: colors.inkSoft },
})
