// Signaler un problème, proposer une idée, poser une question : arrive à l'équipe
// (même canal que le formulaire du web). La réponse part à l'e-mail du compte.
import { useMutation } from '@tanstack/react-query'
import { useState } from 'react'
import { StyleSheet, TextInput, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Chips } from '@/components/form'
import { Body, Button, Card, ErrorBanner, Screen, Title } from '@/components/ui'
import { api } from '@/lib/api'
import { colors, fonts, radius } from '@/lib/theme'

type Kind = 'problem' | 'idea' | 'question'
const PLACEHOLDER: Record<Kind, string> = {
  problem: 'Ce qui ne marche pas, sur quel écran, et ce que vous attendiez…',
  idea: 'Ce qui vous manque, ou ce qui vous simplifierait la vie…',
  question: 'Votre question…',
}

export default function Feedback() {
  const [kind, setKind] = useState<Kind>('problem')
  const [message, setMessage] = useState('')
  const send = useMutation({ mutationFn: () => api.sendFeedback({ kind, message: message.trim(), page: 'mobile/settings' }) })

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <View style={{ gap: 6 }}>
        <Title>Nous écrire</Title>
        <Body muted>Un problème, une idée, une question : nous lisons tout, et répondons à l’e-mail de votre compte.</Body>
      </View>
      <ErrorBanner message={send.error?.message} />
      {send.isSuccess ? (
        <Card style={{ backgroundColor: colors.pineSoft, borderColor: colors.pineSoft }}>
          <Body>Merci ! Votre message est bien arrivé.</Body>
        </Card>
      ) : (
        <>
          <Chips
            options={[
              { value: 'problem' as const, label: 'Un problème' },
              { value: 'idea' as const, label: 'Une idée' },
              { value: 'question' as const, label: 'Une question' },
            ]}
            value={kind}
            onChange={setKind}
          />
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder={PLACEHOLDER[kind]}
            placeholderTextColor={colors.inkSoft}
            multiline
            maxLength={2000}
            accessibilityLabel="Message"
            style={s.input}
          />
          <Button title="Envoyer" onPress={() => send.mutate()} loading={send.isPending} disabled={message.trim().length < 3} />
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
