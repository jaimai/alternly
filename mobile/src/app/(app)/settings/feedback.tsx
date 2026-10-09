// Signaler un problème, proposer une idée, poser une question : arrive à l'équipe
// (même canal que le formulaire du web). La réponse part à l'e-mail du compte.
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { StyleSheet, TextInput, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Chips } from '@/components/form'
import { Body, Button, Card, ErrorBanner, Screen, Title } from '@/components/ui'
import { api } from '@/lib/api'
import { colors, fonts, radius } from '@/lib/theme'

type Kind = 'problem' | 'idea' | 'question'
const KINDS: Kind[] = ['problem', 'idea', 'question']

export default function Feedback() {
  const { t } = useTranslation()
  const [kind, setKind] = useState<Kind>('problem')
  const [message, setMessage] = useState('')
  const send = useMutation({ mutationFn: () => api.sendFeedback({ kind, message: message.trim(), page: 'mobile/settings' }) })

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <View style={{ gap: 6 }}>
        <Title>{t('settings.feedback.title')}</Title>
        <Body muted>{t('settings.feedback.intro')}</Body>
      </View>
      <ErrorBanner message={send.error?.message} />
      {send.isSuccess ? (
        <Card style={{ backgroundColor: colors.pineSoft, borderColor: colors.pineSoft }}>
          <Body>{t('settings.feedback.thanks')}</Body>
        </Card>
      ) : (
        <>
          <Chips
            options={KINDS.map((k) => ({ value: k, label: t(`settings.feedback.kinds.${k}`) }))}
            value={kind}
            onChange={setKind}
          />
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder={t(`settings.feedback.placeholders.${kind}`)}
            placeholderTextColor={colors.inkSoft}
            multiline
            maxLength={2000}
            accessibilityLabel={t('settings.feedback.messageA11y')}
            style={s.input}
          />
          <Button title={t('common.send')} onPress={() => send.mutate()} loading={send.isPending} disabled={message.trim().length < 3} />
        </>
      )}
    </Screen>
  )
}

const s = StyleSheet.create({
  input: {
    minHeight: 140, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, padding: 12,
    fontFamily: fonts.body, fontSize: 15, color: colors.ink, backgroundColor: colors.surface, textAlignVertical: 'top',
  },
})
