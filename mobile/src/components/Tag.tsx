import { Text, View } from 'react-native'
import { fonts, radius } from '@/lib/theme'

/** Pastille d'état (« Contestée », « Remboursée »…). */
export function Tag({ label, bg, fg }: { label: string; bg: string; fg: string }) {
  return (
    <View style={{ backgroundColor: bg, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 }}>
      <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 11, color: fg }}>{label}</Text>
    </View>
  )
}
