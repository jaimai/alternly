// Compte : mot de passe (ou un premier mot de passe pour un compte Apple / Google) et
// suppression du compte, exigée dans l'app par l'App Store.
import { useMutation } from '@tanstack/react-query'
import { File, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, Text, TextInput, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { ChoiceCard } from '@/components/form'
import { Body, Button, Card, ErrorBanner, Field, Loading, Screen, SectionLabel, Title } from '@/components/ui'
import { api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { useMe } from '@/lib/queries'
import { colors, fonts, radius } from '@/lib/theme'
import type { DepartureReason } from '@/lib/types'

const MIN_PASSWORD = 8

// Libellés : settings.account.delete.reasons.<valeur>
const REASONS: DepartureReason[] = ['not_my_situation', 'start_over', 'other_parent', 'price', 'just_testing', 'other']

export default function Account() {
  const { t } = useTranslation()
  const me = useMe().data
  if (!me) return <Loading />
  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <Title>{t('settings.account.title')}</Title>
      <Body muted>{t('settings.account.signedInAs', { email: me.email })}</Body>
      <PasswordSection hasPassword={me.has_password !== false} />
      <DataSection />
      <DeleteSection />
    </Screen>
  )
}

function PasswordSection({ hasPassword }: { hasPassword: boolean }) {
  const { t } = useTranslation()
  const { signIn } = useAuth()
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [done, setDone] = useState(false)
  // Le serveur déconnecte les autres appareils et renvoie un nouveau jeton pour celui-ci.
  const change = useMutation({
    mutationFn: () => api.changePassword(hasPassword ? current : '', next),
    onSuccess: async (resp) => {
      await signIn(resp)
      setCurrent('')
      setNext('')
      setDone(true)
    },
  })
  const tooShort = next.length > 0 && next.length < MIN_PASSWORD

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>{hasPassword ? t('settings.account.password.change') : t('settings.account.password.set')}</SectionLabel>
      {!hasPassword ? (
        <Body muted style={{ fontSize: 14 }}>{t('settings.account.password.setHint')}</Body>
      ) : null}
      <ErrorBanner message={change.error?.message} />
      {done ? (
        <Card style={{ backgroundColor: colors.pineSoft, borderColor: colors.pineSoft }}>
          <Body>{t('settings.account.password.done')}</Body>
        </Card>
      ) : null}
      {hasPassword ? (
        <Field label={t('settings.account.password.current')} value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" textContentType="password" />
      ) : null}
      <Field
        label={t('settings.account.password.new', { min: MIN_PASSWORD })}
        value={next}
        onChangeText={(v) => {
          setNext(v)
          setDone(false)
        }}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        error={tooShort ? t('settings.account.password.tooShort', { min: MIN_PASSWORD }) : null}
      />
      <Button
        title={t('common.save')}
        variant="secondary"
        onPress={() => change.mutate()}
        loading={change.isPending}
        disabled={next.length < MIN_PASSWORD || (hasPassword && !current)}
      />
    </View>
  )
}

/** Export RGPD (fichier JSON partagé) et déconnexion de tous les appareils. */
function DataSection() {
  const { t } = useTranslation()
  const { signOut } = useAuth()
  const exportData = useMutation({
    mutationFn: async () => {
      const data = await api.exportData()
      const file = new File(Paths.cache, `alternly-export-${new Date().toISOString().slice(0, 10)}.json`)
      file.create({ overwrite: true })
      file.write(JSON.stringify(data, null, 2))
      await Sharing.shareAsync(file.uri, { mimeType: 'application/json', dialogTitle: t('settings.account.data.shareTitle') })
    },
  })
  const logoutAll = useMutation({ mutationFn: api.logoutAll, onSuccess: () => signOut() })

  function confirmLogoutAll() {
    Alert.alert(t('settings.account.data.logoutAllTitle'), t('settings.account.data.logoutAllBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('settings.account.data.logoutAllAction'), style: 'destructive', onPress: () => logoutAll.mutate() },
    ])
  }

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>{t('settings.account.data.title')}</SectionLabel>
      <ErrorBanner message={exportData.error?.message ?? logoutAll.error?.message} />
      <Button title={t('settings.account.data.export')} variant="secondary" onPress={() => exportData.mutate()} loading={exportData.isPending} />
      <Body muted style={{ fontSize: 13 }}>{t('settings.account.data.exportHint')}</Body>
      <Button title={t('settings.account.data.logoutAll')} variant="secondary" onPress={confirmLogoutAll} loading={logoutAll.isPending} />
      <Body muted style={{ fontSize: 13 }}>{t('settings.account.data.logoutAllHint')}</Body>
    </View>
  )
}

function DeleteSection() {
  const { t } = useTranslation()
  const { signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<DepartureReason | null>(null)
  const [comment, setComment] = useState('')
  const remove = useMutation({
    mutationFn: () => api.deleteAccount(reason, comment.trim()),
    onSuccess: () => signOut(),
  })

  function confirm() {
    Alert.alert(t('settings.account.delete.confirmTitle'), t('settings.account.delete.confirmBody'), [
      { text: t('common.cancel'), style: 'cancel' },
      { text: t('common.delete'), style: 'destructive', onPress: () => remove.mutate() },
    ])
  }

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>{t('settings.account.delete.title')}</SectionLabel>
      <Body muted style={{ fontSize: 14 }}>{t('settings.account.delete.body')}</Body>
      {!open ? (
        <Button title={t('settings.account.delete.title')} variant="danger" onPress={() => setOpen(true)} />
      ) : (
        <>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSoft }}>{t('settings.account.delete.why')}</Text>
          {REASONS.map((r) => (
            <ChoiceCard key={r} title={t(`settings.account.delete.reasons.${r}`)} selected={reason === r} onPress={() => setReason(r)} />
          ))}
          {reason === 'start_over' ? (
            <Card style={{ backgroundColor: colors.pineSoft, borderColor: colors.pineSoft }}>
              <Body>{t('settings.account.delete.startOver')}</Body>
            </Card>
          ) : (
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder={t('settings.account.delete.commentPlaceholder')}
              placeholderTextColor={colors.inkSoft}
              multiline
              maxLength={500}
              accessibilityLabel={t('settings.account.delete.commentA11y')}
              style={{
                minHeight: 80, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12,
                fontFamily: fonts.body, fontSize: 15, color: colors.ink, backgroundColor: colors.surface, textAlignVertical: 'top',
              }}
            />
          )}
          <ErrorBanner message={remove.error ? t('settings.account.delete.failed') : null} />
          <Button title={t('settings.account.delete.confirm')} variant="danger" onPress={confirm} loading={remove.isPending} />
          <Button title={t('common.cancel')} variant="ghost" onPress={() => setOpen(false)} disabled={remove.isPending} />
        </>
      )}
    </View>
  )
}
