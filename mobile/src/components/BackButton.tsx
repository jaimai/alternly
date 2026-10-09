import { router } from 'expo-router'
import { Pressable } from 'react-native'
import { colors } from '@/lib/theme'
import { Icon } from './Icon'

export function BackButton({ onPress }: { onPress?: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Retour"
      hitSlop={8}
      onPress={onPress ?? (() => router.back())}
      style={({ pressed }) => ({
        width: 44,
        height: 44,
        borderRadius: 22,
        borderWidth: 1,
        borderColor: colors.line,
        backgroundColor: pressed ? colors.paperDeep : colors.surface,
        alignItems: 'center',
        justifyContent: 'center',
      })}
    >
      <Icon name="back" />
    </Pressable>
  )
}
