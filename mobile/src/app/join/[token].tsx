// Lien d'invitation (alternly.com/join/<jeton>) ouvert dans l'app, connecté ou non.
// Pas encore de compte : l'invitation est gardée, et (app)/_layout ramène ici après
// l'inscription ou la connexion, avant tout onboarding.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { router, useLocalSearchParams } from 'expo-router'
import { useEffect } from 'react'
import { View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Body, Button, Card, ErrorBanner, ErrorState, Loading, Screen, Title } from '@/components/ui'
import { ApiError, api } from '@/lib/api'
import { useAuth } from '@/lib/auth'
import { usePendingInvite } from '@/lib/pendingInvite'
import { keys } from '@/lib/queries'
import { fonts } from '@/lib/theme'

export default function Join() {
  const { token } = useLocalSearchParams<{ token: string }>()
  const { status } = useAuth()
  const signedIn = status === 'signedIn'
  const pending = usePendingInvite()
  const qc = useQueryClient()

  const preview = useQuery({
    queryKey: ['invitation', token, signedIn],
    queryFn: () => api.previewInvitation(token),
    enabled: !!token,
    retry: false,
  })
  const invalid = invalidState(preview.error)
  const alreadyMember = preview.data?.already_member || (preview.error instanceof ApiError && preview.error.data?.already_member === true)

  // Gardée tant qu'elle est valable ; oubliée dès qu'elle ne peut plus servir.
  const { set: setPending, token: pendingToken } = pending
  useEffect(() => {
    if (!token) return
    if (invalid || alreadyMember) {
      if (pendingToken) void setPending(null)
    } else if (!signedIn && pendingToken !== token) {
      void setPending(token)
    }
  }, [token, invalid, alreadyMember, signedIn, pendingToken, setPending])

  useEffect(() => {
    if (signedIn && alreadyMember) router.replace('/')
  }, [signedIn, alreadyMember])

  const accept = useMutation({
    mutationFn: () => api.acceptInvitation(token),
    onSuccess: async () => {
      await setPending(null)
      await qc.invalidateQueries({ queryKey: keys.household })
      router.replace('/')
    },
  })

  async function leave() {
    await setPending(null)
    if (router.canGoBack()) router.back()
    else router.replace('/')
  }

  if (preview.isPending) return <Loading />

  if (invalid) {
    return (
      <Screen edges={['top', 'bottom']}>
        <BackButton onPress={leave} />
        <Title>Lien plus valable</Title>
        <Card>
          <Body>{invalid.message}</Body>
          {invalid.code !== 'used' ? (
            <Body muted style={{ fontSize: 14 }}>Demandez un nouveau lien à l’autre parent depuis son application.</Body>
          ) : null}
        </Card>
        <Button title={signedIn ? 'Ouvrir mon calendrier' : 'Retour'} variant="secondary" onPress={leave} />
      </Screen>
    )
  }

  if (preview.isError) {
    return <ErrorState message={preview.error.message} onRetry={() => preview.refetch()} />
  }

  const invite = preview.data

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton onPress={leave} />
      <View style={{ gap: 6 }}>
        <Title>Invitation</Title>
        <Body>
          <Body style={{ fontFamily: fonts.bodySemiBold }}>{invite.invited_by_name}</Body> vous invite à rejoindre le foyer{' '}
          <Body style={{ fontFamily: fonts.bodySemiBold }}>{invite.household_name}</Body> sur Alternly : le calendrier de garde,
          les vacances et les échanges, partagés entre vous deux.
        </Body>
      </View>

      <ErrorBanner message={accept.error?.message} />

      {signedIn ? (
        <>
          <Button title="Rejoindre le foyer" onPress={() => accept.mutate()} loading={accept.isPending} />
          <Button title="Plus tard" variant="ghost" onPress={leave} disabled={accept.isPending} />
        </>
      ) : (
        <>
          <Body muted>Créez votre compte gratuit (ou connectez-vous) : vous rejoindrez le foyer juste après.</Body>
          <Button title="Créer un compte" onPress={() => router.push('/register')} />
          <Button title="J'ai déjà un compte" variant="secondary" onPress={() => router.push('/login')} />
        </>
      )}
    </Screen>
  )
}

function invalidState(error: unknown): { code: 'expired' | 'used' | 'unknown'; message: string } | null {
  if (!(error instanceof ApiError)) return null
  if (error.status === 404) return { code: 'unknown', message: 'Cette invitation est introuvable. Vérifiez le lien reçu.' }
  if (error.status !== 410) return null
  if (error.data?.code === 'used') {
    return { code: 'used', message: 'Cette invitation a déjà été utilisée. Si c’était vous, connectez-vous pour retrouver le foyer.' }
  }
  const inviter = typeof error.data?.inviter_first_name === 'string' ? error.data.inviter_first_name : ''
  return {
    code: 'expired',
    message: inviter ? `Cette invitation a expiré. Demandez-en une nouvelle à ${inviter}.` : 'Cette invitation a expiré.',
  }
}
