// Briques d'interface partagées par les écrans (charte « papier chaleureux »).
import { forwardRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type ViewStyle,
} from 'react-native'
import { SafeAreaView, type Edge } from 'react-native-safe-area-context'
import { colors, fonts, radius } from '@/lib/theme'

export function Screen({ children, scroll = true, edges = ['top'], contentStyle }: {
  children: ReactNode
  scroll?: boolean
  edges?: Edge[]
  contentStyle?: StyleProp<ViewStyle>
}) {
  return (
    <SafeAreaView style={styles.screen} edges={edges}>
      {scroll ? (
        <ScrollView contentContainerStyle={[styles.content, contentStyle]} keyboardShouldPersistTaps="handled">
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, { flex: 1 }, contentStyle]}>{children}</View>
      )}
    </SafeAreaView>
  )
}

export function Title({ style, ...props }: TextProps) {
  return <Text accessibilityRole="header" style={[styles.title, style]} {...props} />
}

export function Body({ style, muted, ...props }: TextProps & { muted?: boolean }) {
  return <Text style={[styles.body, muted && { color: colors.inkSoft }, style]} {...props} />
}

export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <Text accessibilityRole="header" style={styles.section}>
      {children}
    </Text>
  )
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost'

export function Button({ title, onPress, variant = 'primary', loading, disabled, icon, style }: {
  title: string
  onPress?: () => void
  variant?: ButtonVariant
  loading?: boolean
  disabled?: boolean
  icon?: ReactNode
  style?: StyleProp<ViewStyle>
}) {
  const v = buttonVariants[variant]
  const inactive = disabled || loading
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: !!inactive, busy: !!loading }}
      onPress={inactive ? undefined : onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: v.bg },
        pressed && !inactive && { transform: [{ scale: 0.97 }], opacity: 0.92 },
        inactive && { opacity: 0.55 },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={v.fg} /> : icon}
      <Text style={[styles.buttonText, { color: v.fg }]}>{title}</Text>
    </Pressable>
  )
}

const buttonVariants: Record<ButtonVariant, { bg: string; fg: string }> = {
  primary: { bg: colors.pine, fg: '#ffffff' },
  secondary: { bg: colors.pineSoft, fg: colors.pine },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  ghost: { bg: 'transparent', fg: colors.pine },
}

export const Field = forwardRef<TextInput, TextInputProps & { label: string; error?: string | null }>(
  function Field({ label, error, style, ...props }, ref) {
    return (
      <View style={{ gap: 6 }}>
        <Text style={styles.label}>{label}</Text>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.inkSoft}
          style={[styles.input, error ? { borderColor: colors.danger } : null, style]}
          {...props}
        />
        {error ? <Text style={styles.fieldError}>{error}</Text> : null}
      </View>
    )
  },
)

export function ErrorBanner({ message }: { message: string | null | undefined }) {
  if (!message) return null
  return (
    <View accessibilityRole="alert" style={styles.errorBanner}>
      <Text style={{ color: colors.danger, fontFamily: fonts.bodyMedium, fontSize: 14 }}>{message}</Text>
    </View>
  )
}

export function Loading() {
  return (
    <View style={styles.center}>
      <ActivityIndicator color={colors.pine} size="large" />
    </View>
  )
}

/** État d'erreur plein écran avec « Réessayer ». */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  const { t } = useTranslation()
  return (
    <View style={[styles.center, { padding: 24, gap: 16 }]}>
      <Body muted style={{ textAlign: 'center' }}>{message}</Body>
      {onRetry ? <Button title={t('common.retry')} variant="secondary" onPress={onRetry} /> : null}
    </View>
  )
}

export function Avatar({ name, color, size = 36 }: { name: string; color: string; size?: number }) {
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Text style={{ color: '#fff', fontFamily: fonts.bodyBold, fontSize: size * 0.4 }}>
        {name.trim().charAt(0).toUpperCase() || '?'}
      </Text>
    </View>
  )
}

export const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.paper },
  content: { padding: 20, gap: 16 },
  title: { fontFamily: fonts.display, fontSize: 28, lineHeight: 34, color: colors.ink, letterSpacing: -0.2 },
  body: { fontFamily: fonts.body, fontSize: 15, lineHeight: 22, color: colors.ink },
  section: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 0.7,
    textTransform: 'uppercase',
    color: colors.inkSoft,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 16,
    gap: 10,
  },
  button: {
    minHeight: 52,
    borderRadius: radius.pill,
    paddingHorizontal: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  buttonText: { fontFamily: fonts.bodySemiBold, fontSize: 16 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 13, color: colors.inkSoft },
  input: {
    minHeight: 50,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    fontFamily: fonts.body,
    fontSize: 16,
    color: colors.ink,
  },
  fieldError: { fontFamily: fonts.body, fontSize: 13, color: colors.danger },
  errorBanner: { backgroundColor: colors.dangerSoft, borderRadius: 12, padding: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.paper },
})
