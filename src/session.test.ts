// 闭环集成测试:指针样本 → 感知 → 学习 → 映射 → 记忆,全程离屏。
// 这是"和光点互动并看到它学习"的无画面版本。

import { describe, expect, it } from 'vitest'
import { Session } from './session'
import { createLanguageStore } from './store'
import type { RawSample } from './types'

/** 模拟画一个圆(带确定性抖动)。 */
function drawCircle(session: Session, t0: number, seed: number, cx = 0.5, cy = 0.5, r = 0.2) {
  let a = seed >>> 0
  const rnd = () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
  const n = 48
  const pt = (i: number): RawSample => ({
    x: cx + r * Math.cos((2 * Math.PI * i) / (n - 1)) + (rnd() - 0.5) * 0.006,
    y: cy + r * Math.sin((2 * Math.PI * i) / (n - 1)) + (rnd() - 0.5) * 0.006,
    t: t0 + (900 * i) / (n - 1),
  })
  session.begin(pt(0))
  for (let i = 1; i < n - 1; i++) session.move(pt(i))
  return session.end(pt(n - 1))
}

/** 模拟画一条直线。 */
function drawLine(session: Session, t0: number) {
  const n = 32
  const pt = (i: number): RawSample => ({
    x: 0.1 + (0.8 * i) / (n - 1),
    y: 0.2 + (0.1 * i) / (n - 1),
    t: t0 + (600 * i) / (n - 1),
  })
  session.begin(pt(0))
  for (let i = 1; i < n - 1; i++) session.move(pt(i))
  return session.end(pt(n - 1))
}

describe('Session 闭环', () => {
  it('第一次画:一个词诞生,光点得到一句可说的话,树上有了第一个节点', () => {
    const store = createLanguageStore()
    const session = new Session(store, 42)
    const u = drawCircle(session, 0, 1)!
    expect(u).not.toBeNull()
    expect(u.expression.confidence).toBeLessThanOrEqual(0.25) // 新生是试探的
    const s = store.getState()
    expect(s.symbols.size).toBe(1)
    expect(s.tree.nodes).toHaveLength(1)
    expect(s.tree.edges).toHaveLength(0) // 第一个词是根,没有出处
  })

  it('重复同一手势:同一个词被强化,confidence 上升,不再有新词', () => {
    const store = createLanguageStore()
    const session = new Session(store, 42)
    const u1 = drawCircle(session, 0, 1)!
    let last = u1
    for (let i = 1; i <= 5; i++) last = drawCircle(session, i * 5000, 100 + i)!
    const s = store.getState()
    expect(s.symbols.size).toBe(1) // 还是那一个词
    const sym = [...s.symbols.values()][0]
    expect(sym.count).toBe(6)
    expect(last.expression.confidence).toBeGreaterThan(u1.expression.confidence)
    expect(last.holdMs).toBeGreaterThan(u1.holdMs) // 越笃定,说得越从容
    // 强化不换说法:核心表达参数保持连续(这里没漂移过,应逐字段一致)
    expect(last.expression.hue).toBe(u1.expression.hue)
    expect(last.expression.form).toBe(u1.expression.form)
  })

  it('画出明显不同的手势:第二个词诞生,并从最近的旧词上分化(树上有边)', () => {
    const store = createLanguageStore()
    const session = new Session(store, 42)
    drawCircle(session, 0, 1)
    const u2 = drawLine(session, 5000)!
    const s = store.getState()
    expect(s.symbols.size).toBe(2)
    expect(s.tree.nodes).toHaveLength(2)
    expect(s.tree.edges).toHaveLength(1) // 新词的出处
    // 两个词的表达不同
    const exprs = [...s.bindings.values()]
    expect(exprs[0]).not.toEqual(exprs[1])
    expect(u2.expression.confidence).toBeLessThanOrEqual(0.25)
  })

  it('长期冷落:沉默的 tick 让词死亡,活体清空,树上节点保留并记下死期', () => {
    const store = createLanguageStore()
    const session = new Session(store, 42)
    drawCircle(session, 0, 1)
    session.tick(60_000) // 一分钟:还活着
    expect(store.getState().symbols.size).toBe(1)
    session.tick(1_000_000) // 漫长的沉默
    const s = store.getState()
    expect(s.symbols.size).toBe(0)
    expect(s.bindings.size).toBe(0)
    expect(s.tree.nodes).toHaveLength(1) // 死词也是文明痕迹
    expect(s.tree.nodes[0].died).toBe(1_000_000)
  })

  it('空手势(没有 begin 的 end)不打扰任何层', () => {
    const store = createLanguageStore()
    const session = new Session(store, 42)
    expect(session.end({ x: 0.5, y: 0.5, t: 100 })).toBeNull()
    expect(store.getState().tree.nodes).toHaveLength(0)
  })
})
