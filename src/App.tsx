// 组合根:把指针事件送进 Session 闭环,把光点该说的话交给 Stage。
// 这里只做接线,不做逻辑——逻辑都在各层里。

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Expression, RawSample } from './types'
import { Stage, type PresenceState } from './expression'
import { Session } from './session'

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

const now = () => performance.now()

const toSample = (ev: PointerEvent): RawSample => ({
  x: ev.clientX / window.innerWidth,
  y: ev.clientY / window.innerHeight,
  t: now(),
})

export default function App() {
  const session = useMemo(() => new Session(), [])
  const presence = useRef<PresenceState>({ x: 0.5, y: 0.5, down: false })
  const [spoken, setSpoken] = useState<Expression | null>(null)
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const down = (ev: PointerEvent) => {
      presence.current = { x: ev.clientX / window.innerWidth, y: ev.clientY / window.innerHeight, down: true }
      session.begin(toSample(ev))
    }
    const move = (ev: PointerEvent) => {
      presence.current = {
        x: ev.clientX / window.innerWidth,
        y: ev.clientY / window.innerHeight,
        down: presence.current.down,
      }
      if (presence.current.down) session.move(toSample(ev))
    }
    const up = (ev: PointerEvent) => {
      presence.current = { ...presence.current, down: false }
      const utterance = session.end(toSample(ev))
      if (utterance !== null) {
        // 它开口说这句话;说完,慢慢退回沉默的呼吸。
        setSpoken(utterance.expression)
        if (fadeTimer.current !== null) clearTimeout(fadeTimer.current)
        fadeTimer.current = setTimeout(() => setSpoken(null), utterance.holdMs)
      }
    }
    window.addEventListener('pointerdown', down)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', up)

    // 沉默期的心跳:时间流逝,遗忘继续。
    const heartbeat = setInterval(() => session.tick(now()), 5000)
    return () => {
      window.removeEventListener('pointerdown', down)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', up)
      clearInterval(heartbeat)
      if (fadeTimer.current !== null) clearTimeout(fadeTimer.current)
    }
  }, [session])

  return <Stage expression={spoken ?? BASELINE} presence={presence} />
}
