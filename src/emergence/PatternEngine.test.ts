// 学习引擎单元测试:完全脱离渲染,只用手工构造的特征向量。
// 验证三条生命法则:重复 → 强化;新异 → 诞生;冷落 → 死亡。

import { describe, expect, it } from 'vitest'
import { FEATURE_DIM, type EmergenceEvent, type FeatureVector } from '../types'
import { PatternEngine } from './PatternEngine'

/** mulberry32:种子化伪随机数,保证测试可复现。 */
function prng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** 以 base 为中心、按种子加微小抖动的特征向量——模拟"同一手势的自然变化"。 */
function jittered(base: number[], t: number, seed: number, amp = 0.03): FeatureVector {
  const rnd = prng(seed)
  return { vec: base.map((v) => v + (rnd() - 0.5) * amp), t }
}

/** 两个在特征空间里相距明显的基准模式(距离远大于诞生阈值)。 */
const A = Array.from({ length: FEATURE_DIM }, (_, i) => (i % 2 === 0 ? 0.2 : 0.7))
const B = Array.from({ length: FEATURE_DIM }, (_, i) => (i % 3 === 0 ? 0.9 : 0.1))

const only = (events: EmergenceEvent[], type: EmergenceEvent['type']) =>
  events.filter((e) => e.type === type)

describe('PatternEngine 生命法则', () => {
  it('反复喂相似向量:只诞生一个 Symbol,count 持续上升,strength 增强', () => {
    const eng = new PatternEngine()
    const born: string[] = []
    let lastId = ''
    for (let i = 0; i < 12; i++) {
      const events = eng.observe(jittered(A, i * 1000, 100 + i))
      for (const e of events) {
        expect(e.type).not.toBe('died')
        if (e.type === 'born') born.push(e.symbolId)
        lastId = e.symbolId
      }
    }
    expect(born).toHaveLength(1)
    const sym = eng.get(lastId)!
    expect(sym.id).toBe(born[0])
    expect(sym.count).toBe(12)
    expect(sym.strength).toBeGreaterThan(0.8)
    expect(eng.snapshot()).toHaveLength(1)
  })

  it('喂明显不同的向量:诞生第二个 Symbol,且互不干扰地各自强化', () => {
    const eng = new PatternEngine()
    const e1 = eng.observe(jittered(A, 0, 1))
    const e2 = eng.observe(jittered(B, 1000, 2))
    expect(only(e1, 'born')).toHaveLength(1)
    expect(only(e2, 'born')).toHaveLength(1)
    const [idA, idB] = [e1[0].symbolId, e2[0].symbolId]
    expect(idA).not.toBe(idB)

    // 交替喂:各自 reinforced,不再有新生。
    for (let i = 0; i < 6; i++) {
      const ea = eng.observe(jittered(A, 2000 + i * 1000, 10 + i))[0]
      const eb = eng.observe(jittered(B, 2500 + i * 1000, 20 + i))[0]
      expect(ea).toEqual({ type: 'reinforced', symbolId: idA })
      expect(eb).toEqual({ type: 'reinforced', symbolId: idB })
    }
    expect(eng.snapshot()).toHaveLength(2)
  })

  it('质心吸附:词的用法漂移,质心跟着漂移', () => {
    const eng = new PatternEngine()
    const id = eng.observe({ vec: [...A], t: 0 })[0].symbolId
    // 持续喂一个略偏但仍在阈值内的变体。
    const shifted = A.map((v) => v + 0.06)
    const before = eng.get(id)!
    const d0 = Math.hypot(...before.centroid.map((c, i) => c - shifted[i]))
    for (let i = 0; i < 8; i++) eng.observe({ vec: [...shifted], t: 1000 + i * 1000 })
    const after = eng.get(id)!
    const d1 = Math.hypot(...after.centroid.map((c, i) => c - shifted[i]))
    expect(d1).toBeLessThan(d0 * 0.2)
    expect(eng.snapshot()).toHaveLength(1) // 漂移被归入旧词,没有裂成新词
  })

  it('冷落导致死亡:停喂的模式衰减归零,died 事件带出它的 id,幸存者无恙', () => {
    const eng = new PatternEngine()
    const idA = eng.observe(jittered(A, 0, 3))[0].symbolId
    eng.observe(jittered(A, 1000, 4))
    eng.observe(jittered(A, 2000, 5))
    const idB = eng.observe(jittered(B, 3000, 6))[0].symbolId

    // 此后只喂 B,时间一路推进 20 分钟。
    const died: string[] = []
    for (let i = 0; i < 40; i++) {
      const events = eng.observe(jittered(B, 4000 + i * 30_000, 30 + i))
      for (const e of events) if (e.type === 'died') died.push(e.symbolId)
    }
    expect(died).toEqual([idA])
    expect(eng.get(idA)).toBeUndefined()
    const b = eng.get(idB)!
    expect(b.strength).toBeGreaterThan(0.5)
    expect(eng.snapshot().map((s) => s.id)).toEqual([idB])
  })

  it('新生不即死:诞生后短暂沉默不会立刻抹掉胚胎', () => {
    const eng = new PatternEngine()
    const id = eng.observe(jittered(A, 0, 7))[0].symbolId
    // 30 秒后回来,胚胎应当还在(衰减了,但活着)。
    const events = eng.observe(jittered(A, 30_000, 8))
    expect(events).toEqual([{ type: 'reinforced', symbolId: id }])
  })

  it('快照是深拷贝:篡改快照不影响引擎(单向数据流)', () => {
    const eng = new PatternEngine()
    const id = eng.observe({ vec: [...A], t: 0 })[0].symbolId
    const snap = eng.snapshot()[0]
    snap.centroid[0] = 999
    snap.strength = -1
    const real = eng.get(id)!
    expect(real.centroid[0]).not.toBe(999)
    expect(real.strength).toBeGreaterThan(0)
  })

  it('strength 始终在 (0,1] 内;错误维度的向量被拒绝', () => {
    const eng = new PatternEngine()
    for (let i = 0; i < 50; i++) {
      eng.observe(jittered(A, i * 500, 60 + i))
      for (const s of eng.snapshot()) {
        expect(s.strength).toBeGreaterThan(0)
        expect(s.strength).toBeLessThanOrEqual(1)
      }
    }
    expect(() => eng.observe({ vec: [0.5, 0.5], t: 0 })).toThrow()
  })
})
