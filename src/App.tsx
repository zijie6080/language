// 组合根:把指针事件送进 Session 闭环,把光点该说的话交给 Stage。
// 这里只做接线,不做逻辑——逻辑都在各层里。

import { useEffect, useMemo, useRef, useState } from 'react'
import type { Expression, RawSample } from './types'
import { Stage, Voice, type PresenceState } from './expression'
import { LanguageTree } from './tree'
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
  const voice = useMemo(() => new Voice(), [])
  const presence = useRef<PresenceState>({ x: 0.5, y: 0.5, down: false })
  const [spoken, setSpoken] = useState<Expression | null>(null)
  const fadeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // 你在黑暗中的存在:一粒替代光标的微光。静止太久便隐去——不动,就融入黑暗。
  const ember = useRef<HTMLDivElement>(null)
  const emberTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const showEmber = (ev: PointerEvent) => {
      const el = ember.current
      if (el === null) return
      el.style.transform = `translate3d(${ev.clientX}px, ${ev.clientY}px, 0) translate(-50%, -50%)`
      el.style.opacity = presence.current.down ? '0.9' : '0.55'
      if (emberTimer.current !== null) clearTimeout(emberTimer.current)
      emberTimer.current = setTimeout(() => {
        if (ember.current !== null) ember.current.style.opacity = '0'
      }, 2600)
    }
    const down = (ev: PointerEvent) => {
      presence.current = { x: ev.clientX / window.innerWidth, y: ev.clientY / window.innerHeight, down: true }
      void voice.wake(BASELINE) // 声音只能由第一次触碰唤醒(浏览器如此,倒也像一种仪式)
      session.begin(toSample(ev))
      showEmber(ev)
    }
    const move = (ev: PointerEvent) => {
      presence.current = {
        x: ev.clientX / window.innerWidth,
        y: ev.clientY / window.innerHeight,
        down: presence.current.down,
      }
      if (presence.current.down) session.move(toSample(ev))
      showEmber(ev)
    }
    const up = (ev: PointerEvent) => {
      presence.current = { ...presence.current, down: false }
      const utterance = session.end(toSample(ev))
      if (utterance !== null) {
        // 它开口说这句话;说完,慢慢退回沉默的呼吸。光与声共用同一句话。
        setSpoken(utterance.expression)
        voice.speak(utterance.expression, utterance.holdMs)
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
      if (emberTimer.current !== null) clearTimeout(emberTimer.current)
    }
  }, [session, voice])

  return (
    <>
      <Stage expression={spoken ?? BASELINE} presence={presence}>
        <LanguageTree />
      </Stage>
      <div
        ref={ember}
        style={{
          position: 'fixed',
          left: 0,
          top: 0,
          width: '7px',
          height: '7px',
          borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,255,255,0.65) 0%, rgba(255,255,255,0) 70%)',
          pointerEvents: 'none',
          opacity: 0,
          transition: 'opacity 1.6s ease',
          zIndex: 10,
        }}
      />
    </>
  )
}
