// 组合根。此刻:纯黑空间,中央一个会呼吸的光点。
// 它还没有学会任何东西——这是语言诞生之前的样子。

import type { Expression } from './types'
import { Stage } from './expression'

// 前语言状态的基线表达:安静、微弱、缓慢呼吸。
// 色相在每次相遇时随机——它没有"本来的颜色",正如它没有本来的语言。
const BASELINE: Expression = {
  hue: Math.random(),
  brightness: 0.34,
  breathHz: 0.13,
  flickerHz: 0,
  form: 0.18,
  scatter: 0.08,
  toneHz: 0,
  confidence: 0.5,
}

export default function App() {
  return <Stage expression={BASELINE} />
}
