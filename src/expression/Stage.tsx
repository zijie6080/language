// Stage —— 纯黑空间本身。装下 Orb 与(由上层注入的)其他可见之物。
// 这里没有 UI、没有控件、没有文字,只有黑与光。

import { Canvas } from '@react-three/fiber'
import type { ReactNode, RefObject } from 'react'
import type { Expression } from '../types'
import { Orb, type PresenceState } from './Orb'

export function Stage({
  expression,
  presence,
  children,
}: {
  /** 光点此刻的目标表达。切换由 Orb 内部缓动,不跳变。 */
  expression: Expression
  /** 指针的物理存在(可选)。 */
  presence?: RefObject<PresenceState>
  /** 上层注入的其他场景成员(如语言树)。Stage 不认识它们是什么。 */
  children?: ReactNode
}) {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: false }}
      camera={{ position: [0, 0, 5], fov: 60 }}
      style={{ position: 'fixed', inset: 0, background: '#000' }}
    >
      <color attach="background" args={['#000000']} />
      <Orb expression={expression} presence={presence} />
      {children}
    </Canvas>
  )
}
