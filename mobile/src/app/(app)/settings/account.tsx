// Compte : mot de passe (ou un premier mot de passe pour un compte Apple / Google) et
// suppression du compte, exigée dans l'app par l'App Store.
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
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

const REASONS: { value: DepartureReason; label: string }[] = [
  { value: 'not_my_situation', label: 'Le calendrier ne correspond pas à ma situation' },
  { value: 'start_over', label: 'Je voulais recommencer la configuration' },
  { value: 'other_parent', label: 'L’autre parent ne l’utilisera pas' },
  { value: 'price', label: 'C’est trop cher / trop de fonctions payantes' },
  { value: 'just_testing', label: 'Je testais l’application' },
  { value: 'other', label: 'Autre raison' },
]

export default function Account() {
  const me = useMe().data
  if (!me) return <Loading />
  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <Title>Compte</Title>
      <Body muted>{`Connecté·e avec ${me.email}`}</Body>
      <PasswordSection hasPassword={me.has_password !== false} />
      <DeleteSection />
    </Screen>
  )
}

function PasswordSection({ hasPassword }: { hasPassword: boolean }) {
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
      <SectionLabel>{hasPassword ? 'Changer de mot de passe' : 'Définir un mot de passe'}</SectionLabel>
      {!hasPassword ? (
        <Body muted style={{ fontSize: 14 }}>Pour vous connecter aussi avec votre e-mail, en plus d’Apple ou Google.</Body>
      ) : null}
      <ErrorBanner message={change.error?.message} />
      {done ? (
        <Card style={{ backgroundColor: colors.pineSoft, borderColor: colors.pineSoft }}>
          <Body>Mot de passe enregistré. Vos autres appareils ont été déconnectés.</Body>
        </Card>
      ) : null}
      {hasPassword ? (
        <Field label="Mot de passe actuel" value={current} onChangeText={setCurrent} secureTextEntry autoComplete="current-password" textContentType="password" />
      ) : null}
      <Field
        label={`Nouveau mot de passe (${MIN_PASSWORD} caractères min.)`}
        value={next}
        onChangeText={(v) => {
          setNext(v)
          setDone(false)
        }}
        secureTextEntry
        autoComplete="new-password"
        textContentType="newPassword"
        error={tooShort ? `${MIN_PASSWORD} caractères minimum` : null}
      />
      <Button
        title="Enregistrer"
        variant="secondary"
        onPress={() => change.mutate()}
        loading={change.isPending}
        disabled={next.length < MIN_PASSWORD || (hasPassword && !current)}
      />
    </View>
  )
}

function DeleteSection() {
  const { signOut } = useAuth()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState<DepartureReason | null>(null)
  const [comment, setComment] = useState('')
  const remove = useMutation({
    mutationFn: () => api.deleteAccount(reason, comment.trim()),
    onSuccess: () => signOut(),
  })

  function confirm() {
    Alert.alert('Supprimer définitivement votre compte ?', 'Vos données personnelles seront effacées. Cette action est irréversible.', [
      { text: 'Annuler', style: 'cancel' },
      { text: 'Supprimer', style: 'destructive', onPress: () => remove.mutate() },
    ])
  }

  return (
    <View style={{ gap: 10 }}>
      <SectionLabel>Supprimer mon compte</SectionLabel>
      <Body muted style={{ fontSize: 14 }}>
        Vos données personnelles sont effacées définitivement. Si vous êtes le seul parent du foyer, tout le foyer et son
        historique sont supprimés. Un abonnement pris dans l’App Store ou Google Play se résilie dans le store : la
        suppression du compte ne l’arrête pas.
      </Body>
      {!open ? (
        <Button title="Supprimer mon compte" variant="danger" onPress={() => setOpen(true)} />
      ) : (
        <>
          <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSoft }}>Pourquoi partez-vous ? (facultatif)</Text>
          {REASONS.map((r) => (
            <ChoiceCard key={r.value} title={r.label} selected={reason === r.value} onPress={() => setReason(r.value)} />
          ))}
          {reason === 'start_over' ? (
            <Card style={{ backgroundColor: colors.pineSoft, borderColor: colors.pineSoft }}>
              <Body>
                Pas besoin de supprimer votre compte : la règle de garde se reprend pas à pas dans Réglages › Garde et vacances,
                et les enfants dans Réglages › Enfants et zone.
              </Body>
            </Card>
          ) : (
            <TextInput
              value={comment}
              onChangeText={setComment}
              placeholder="Un mot pour nous aider à améliorer Alternly ? (facultatif)"
              placeholderTextColor={colors.inkSoft}
              multiline
              maxLength={500}
              accessibilityLabel="Commentaire"
              style={{
                minHeight: 80, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12,
                fontFamily: fonts.body, fontSize: 15, color: colors.ink, backgroundColor: colors.surface, textAlignVertical: 'top',
              }}
            />
          )}
          <ErrorBanner message={remove.error ? 'La suppression a échoué. Réessayez.' : null} />
          <Button title="Supprimer définitivement" variant="danger" onPress={confirm} loading={remove.isPending} />
          <Button title="Annuler" variant="ghost" onPress={() => setOpen(false)} disabled={remove.isPending} />
        </>
      )}
    </View>
  )
}
