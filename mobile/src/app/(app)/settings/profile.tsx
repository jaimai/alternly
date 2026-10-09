// Mon profil : prénom et couleur sur le calendrier (visibles par l'autre parent).
import { router } from 'expo-router'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'
import { BackButton } from '@/components/BackButton'
import { Body, Button, ErrorBanner, Field, Loading, Screen, Title } from '@/components/ui'
import { PARENT_COLORS } from '@/lib/colors'
import { useHousehold, useMe, useUpdateMe } from '@/lib/queries'
import { colors, fonts } from '@/lib/theme'

export default function Profile() {
  const me = useMe().data
  const household = useHousehold().data
  if (!me) return <Loading />
  const taken = household?.members.find((m) => m.id !== me.id)?.color
  return <Form initialName={me.display_name} initialColor={me.color} taken={taken} />
}

function Form({ initialName, initialColor, taken }: { initialName: string; initialColor: string; taken?: string }) {
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState(initialColor)
  const save = useUpdateMe(() => router.back())
  const changed = name.trim() !== initialName || color !== initialColor

  return (
    <Screen edges={['top', 'bottom']}>
      <BackButton />
      <Title>Mon profil</Title>
      <ErrorBanner message={save.error?.message} />

      <Field label="Prénom" value={name} onChangeText={setName} maxLength={50} autoComplete="given-name" textContentType="givenName" />

      <View style={{ gap: 8 }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSoft }}>Ma couleur sur le calendrier</Text>
        <View style={{ flexDirection: 'row', gap: 10, flexWrap: 'wrap' }} accessibilityRole="radiogroup">
          {PARENT_COLORS.map((c) => {
            const selected = c.value === color
            const isTaken = c.value === taken
            return (
              <Pressable
                key={c.value}
                accessibilityRole="radio"
                accessibilityLabel={isTaken ? `${c.label} (couleur de l’autre parent)` : c.label}
                accessibilityState={{ selected, disabled: isTaken }}
                disabled={isTaken}
                onPress={() => setColor(c.value)}
                style={{
                  width: 44, height: 44, borderRadius: 22, backgroundColor: c.value, opacity: isTaken ? 0.25 : 1,
                  borderWidth: 3, borderColor: selected ? colors.ink : colors.paper,
                }}
              />
            )
          })}
        </View>
        {taken ? <Body muted style={{ fontSize: 13 }}>La couleur de l’autre parent n’est pas proposée, pour bien vous distinguer.</Body> : null}
      </View>

      <Button
        title="Enregistrer"
        onPress={() => save.mutate({ display_name: name.trim(), color })}
        loading={save.isPending}
        disabled={!changed || !name.trim()}
      />
    </Screen>
  )
}
