import { useState } from 'react'
import { Share, Text, View } from 'react-native'
import { inviteMessage } from '@/lib/invite'
import { useInviteLink } from '@/lib/queries'
import { colors, fonts } from '@/lib/theme'
import { Button, Card } from './ui'

/** Foyer solo : invite l'autre parent via la feuille de partage du téléphone. */
export function InviteCard({ householdId, childNames }: { householdId: number; childNames: string[] }) {
  const invite = useInviteLink(householdId)
  // Partage indisponible (navigateur sans Web Share) : on affiche le lien à copier.
  const [fallback, setFallback] = useState<string | null>(null)

  const share = () =>
    invite.mutate(undefined, {
      onSuccess: (inv) => {
        Share.share({ message: inviteMessage(childNames, inv.invite_url) }).catch(() => setFallback(inv.invite_url))
      },
    })

  return (
    <Card style={{ backgroundColor: colors.pineSoft, borderColor: colors.pineSoft }}>
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: colors.ink }}>
        Pour l’instant, vous êtes seul·e à voir ce calendrier.
      </Text>
      <Text style={{ fontFamily: fonts.body, fontSize: 14, lineHeight: 20, color: colors.ink }}>
        Invitez l’autre parent : il voit ses jours à l’avance, et les échanges se règlent dans l’app. Gratuit pour lui ou
        elle.
      </Text>
      {invite.error ? (
        <Text style={{ fontFamily: fonts.body, fontSize: 13, color: colors.danger }}>{invite.error.message}</Text>
      ) : null}
      {fallback ? (
        <Text selectable style={{ fontFamily: fonts.bodySemiBold, fontSize: 14, color: colors.pine }}>
          {fallback}
        </Text>
      ) : null}
      <View>
        <Button title="Inviter l’autre parent" onPress={share} loading={invite.isPending} />
      </View>
    </Card>
  )
}
