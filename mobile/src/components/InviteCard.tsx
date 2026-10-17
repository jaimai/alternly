import { useMutation } from '@tanstack/react-query'
import * as Clipboard from 'expo-clipboard'
import { useState } from 'react'
import { Share, Text, View } from 'react-native'
import { api } from '@/lib/api'
import { formatShort, isoLocal, parseTimestamp } from '@/lib/dates'
import { inviteMessage } from '@/lib/invite'
import { useInviteLink } from '@/lib/queries'
import { colors, fonts } from '@/lib/theme'
import type { Invitation } from '@/lib/types'
import { Button, Card, Field } from './ui'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Foyer solo : invite l'autre parent (feuille de partage, lien copié, ou e-mail envoyé par Alternly). */
export function InviteCard({ householdId, childNames }: { householdId: number; childNames: string[] }) {
  const invite = useInviteLink(householdId)
  const [link, setLink] = useState<Invitation | null>(null)
  const [copied, setCopied] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [email, setEmail] = useState('')
  const send = useMutation({ mutationFn: () => api.emailInvitation(householdId, email.trim()), onSuccess: setLink })

  // Lien actif (ou nouveau) puis action : partager ou copier.
  const withLink = (fn: (inv: Invitation) => void) =>
    invite.mutate(undefined, {
      onSuccess: (inv) => {
        setLink(inv)
        fn(inv)
      },
    })
  const share = () => withLink((inv) => void Share.share({ message: inviteMessage(childNames, inv.invite_url) }).catch(() => {}))
  const copy = () =>
    withLink(async (inv) => {
      await Clipboard.setStringAsync(inv.invite_url)
      setCopied(true)
    })

  const error = invite.error?.message ?? send.error?.message

  return (
    <Card style={{ backgroundColor: colors.pineSoft, borderColor: colors.pineSoft }}>
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink }}>
        Pour l’instant, vous êtes seul·e à voir ce calendrier.
      </Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink }}>
        Invitez l’autre parent : il voit ses jours à l’avance, et les échanges se règlent dans l’app. Gratuit pour lui ou
        elle.
      </Text>
      {error ? <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.danger }}>{error}</Text> : null}

      <Button title="Inviter l’autre parent" onPress={share} loading={invite.isPending} />
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <Button title={copied ? 'Lien copié ✓' : 'Copier le lien'} variant="secondary" onPress={copy} style={{ flex: 1 }} />
        <Button title="Par e-mail" variant="secondary" onPress={() => setEmailOpen((v) => !v)} style={{ flex: 1 }} />
      </View>

      {emailOpen ? (
        send.isSuccess ? (
          <Text style={{ fontFamily: fonts.body, fontSize: 14, color: colors.ink }}>
            {`Invitation envoyée à ${email.trim()}. Elle arrive de la part d’Alternly, avec votre prénom.`}
          </Text>
        ) : (
          <View style={{ gap: 8 }}>
            <Field
              label="E-mail de l’autre parent"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <Button title="Envoyer l’invitation" onPress={() => send.mutate()} loading={send.isPending} disabled={!EMAIL.test(email.trim())} />
          </View>
        )
      ) : null}

      {link ? (
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: colors.inkSoft }}>
          {`Lien valable jusqu’au ${formatShort(isoLocal(parseTimestamp(link.expires_at)))}.`}
        </Text>
      ) : null}
    </Card>
  )
}
