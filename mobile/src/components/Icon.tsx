import type { ColorValue } from 'react-native'
import Svg, { Circle, Path, Rect } from 'react-native-svg'
import { colors } from '@/lib/theme'

export type IconName =
  | 'home' | 'calendar' | 'wall' | 'wallet' | 'settings' | 'bell' | 'back' | 'chevron'
  | 'swap' | 'check' | 'close' | 'eye' | 'mail' | 'logout'

const paths: Record<IconName, React.ReactNode> = {
  home: <Path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />,
  calendar: (
    <>
      <Rect x={3} y={5} width={18} height={16} rx={2} />
      <Path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  wall: <Path d="M4 5h16v11H9l-5 4z" />,
  wallet: (
    <>
      <Rect x={3} y={6} width={18} height={14} rx={2} />
      <Path d="M3 10h18M16 15h2" />
    </>
  ),
  settings: (
    <>
      <Path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
      <Circle cx={16} cy={7} r={2} />
      <Circle cx={10} cy={17} r={2} />
    </>
  ),
  bell: <Path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4zM10 21h4" />,
  back: <Path d="M15 5l-7 7 7 7" />,
  chevron: <Path d="M9 5l7 7-7 7" />,
  swap: <Path d="M7 7h12l-3-3M17 17H5l3 3" />,
  check: <Path d="M5 12l5 5 9-10" />,
  close: <Path d="M6 6l12 12M18 6L6 18" />,
  eye: (
    <>
      <Path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" />
      <Circle cx={12} cy={12} r={3} />
    </>
  ),
  mail: (
    <>
      <Rect x={3} y={5} width={18} height={14} rx={2} />
      <Path d="M3 7l9 6 9-6" />
    </>
  ),
  logout: <Path d="M15 4h4v16h-4M10 8l-4 4 4 4M6 12h10" />,
}

export function Icon({ name, size = 22, color = colors.ink, strokeWidth = 1.8 }: {
  name: IconName
  size?: number
  color?: ColorValue
  strokeWidth?: number
}) {
  return (
    <Svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {paths[name]}
    </Svg>
  )
}

/** Logo Alternly (docs/marketing/brand/alternly-logo-icone-1080.png) redessiné en vectoriel. */
export function LogoMark({ size = 40 }: { size?: number }) {
  return (
    <Svg width={size} height={(size * 585) / 630} viewBox="0 0 630 585" accessibilityLabel="Alternly">
      <Rect x={0} y={60} width={630} height={525} rx={130} fill={colors.pine} />
      <Rect x={0} y={0} width={630} height={180} rx={90} fill={colors.terra} />
      <Rect x={90} y={247} width={202} height={113} rx={33} fill="#eeede6" />
      <Rect x={337} y={247} width={203} height={113} rx={33} fill="#99a99e" />
      <Rect x={90} y={405} width={202} height={112} rx={33} fill="#99a99e" />
      <Rect x={337} y={405} width={203} height={112} rx={33} fill="#eeede6" />
    </Svg>
  )
}
