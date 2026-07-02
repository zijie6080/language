// 感知层单元测试:完全脱离画面,只用合成轨迹验证编码的判别力。
// 断言的核心:相似手势的向量距离小,不同手势的距离大。

import { describe, expect, it } from 'vitest'
import { FEATURE_DIM, type RawSample } from '../types'
import { GestureEncoder } from './GestureEncoder'

// —— 合成轨迹工具(确定性,含可复现伪随机噪声)——

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

function circle(
  cx: number, cy: number, r: number,
  { n = 64, durMs = 1000, t0 = 0, dir = 1, noise = 0, seed = 1 } = {},
): RawSample[] {
  const rnd = prng(seed)
  const out: RawSample[] = []
  for (let i = 0; i < n; i++) {
    const a = dir * 2 * Math.PI * (i / (n - 1))
    out.push({
      x: cx + r * Math.cos(a) + (rnd() - 0.5) * noise,
      y: cy + r * Math.sin(a) + (rnd() - 0.5) * noise,
      t: t0 + (durMs * i) / (n - 1),
    })
  }
  return out
}

function line(
  x0: number, y0: number, x1: number, y1: number,
  { n = 64, durMs = 800, t0 = 0, noise = 0, seed = 1 } = {},
): RawSample[] {
  const rnd = prng(seed)
  const out: RawSample[] = []
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1)
    out.push({
      x: x0 + (x1 - x0) * u + (rnd() - 0.5) * noise,
      y: y0 + (y1 - y0) * u + (rnd() - 0.5) * noise,
      t: t0 + durMs * u,
    })
  }
  return out
}

/** 水平方向锯齿:方向反复急转,与圆、直线在曲率统计上应当判然有别。 */
function zigzag(
  x0: number, y0: number, width: number, amp: number,
  { peaks = 5, perSeg = 12, durMs = 1200 } = {},
): RawSample[] {
  const out: RawSample[] = []
  const segs = peaks * 2
  const totalPts = segs * perSeg + 1
  for (let i = 0; i < totalPts; i++) {
    const u = i / (totalPts - 1)
    const saw = Math.abs(((u * segs) % 2) - 1) // 1→0→1 三角波
    out.push({ x: x0 + width * u, y: y0 + amp * (1 - saw), t: durMs * u })
  }
  return out
}

/** 在轨迹中段插入一次原地停顿(位置不变,时间流逝)。 */
function withPause(samples: RawSample[], pauseMs: number, ticks = 10): RawSample[] {
  const mid = Math.floor(samples.length / 2)
  const at = samples[mid]
  const held: RawSample[] = []
  for (let i = 1; i <= ticks; i++) {
    held.push({ x: at.x, y: at.y, t: at.t + (pauseMs * i) / ticks })
  }
  const after = samples.slice(mid + 1).map((s) => ({ ...s, t: s.t + pauseMs }))
  return [...samples.slice(0, mid + 1), ...held, ...after]
}

const dist = (a: number[], b: number[]): number =>
  Math.sqrt(a.reduce((acc, v, i) => acc + (v - b[i]) * (v - b[i]), 0))

const enc = new GestureEncoder()
const vec = (s: RawSample[]): number[] => enc.encode(s).vec

// —— 测试 ——

describe('GestureEncoder 基本契约', () => {
  it('输出定长向量,每一维有界且有限', () => {
    const gestures = [
      circle(0.5, 0.5, 0.2),
      line(0.1, 0.1, 0.9, 0.9),
      zigzag(0.1, 0.5, 0.8, 0.2),
      [{ x: 0.5, y: 0.5, t: 100 }], // 单点(轻触)
      [],                            // 空输入
      [{ x: 0.3, y: 0.3, t: 0 }, { x: 0.3, y: 0.3, t: 500 }], // 原地按住
    ]
    for (const g of gestures) {
      const f = enc.encode(g)
      expect(f.vec).toHaveLength(FEATURE_DIM)
      for (const v of f.vec) {
        expect(Number.isFinite(v)).toBe(true)
        expect(v).toBeGreaterThanOrEqual(0)
        expect(v).toBeLessThanOrEqual(1)
      }
    }
  })

  it('编码是确定性的:同一输入产生同一输出', () => {
    const g = circle(0.5, 0.5, 0.2, { noise: 0.01, seed: 7 })
    expect(vec(g)).toEqual(vec(g))
  })

  it('时间戳取手势结束时刻', () => {
    const g = line(0.1, 0.1, 0.9, 0.9, { t0: 5000, durMs: 800 })
    expect(enc.encode(g).t).toBe(5800)
  })
})

describe('判别力:相似手势距离小,不同手势距离大', () => {
  it('两个带噪、不同位置的圆,远比圆与直线接近', () => {
    const a = circle(0.5, 0.5, 0.2, { noise: 0.008, seed: 2 })
    const b = circle(0.4, 0.6, 0.24, { noise: 0.008, seed: 9, durMs: 1100 })
    const l = line(0.1, 0.1, 0.9, 0.9)
    const dSim = dist(vec(a), vec(b))
    const dDiff = Math.min(dist(vec(a), vec(l)), dist(vec(b), vec(l)))
    expect(dSim * 3).toBeLessThan(dDiff)
  })

  it('两条带噪、平移过的直线,远比直线与锯齿接近', () => {
    const a = line(0.1, 0.2, 0.8, 0.3, { noise: 0.006, seed: 3 })
    const b = line(0.2, 0.6, 0.9, 0.7, { noise: 0.006, seed: 11, durMs: 900 })
    const z = zigzag(0.1, 0.5, 0.8, 0.2)
    const dSim = dist(vec(a), vec(b))
    const dDiff = Math.min(dist(vec(a), vec(z)), dist(vec(b), vec(z)))
    expect(dSim * 3).toBeLessThan(dDiff)
  })

  it('圆与锯齿判然有别', () => {
    const c = circle(0.5, 0.5, 0.2)
    const z = zigzag(0.1, 0.5, 0.8, 0.2)
    expect(dist(vec(c), vec(z))).toBeGreaterThan(0.5)
  })

  it('中途长停顿改变节奏指纹:带停顿的圆离原圆,比两个不带停顿的圆彼此更远', () => {
    const a = circle(0.5, 0.5, 0.2, { noise: 0.005, seed: 4 })
    const b = circle(0.5, 0.5, 0.2, { noise: 0.005, seed: 13 })
    const paused = withPause(circle(0.5, 0.5, 0.2, { noise: 0.005, seed: 4 }), 600)
    expect(dist(vec(a), vec(paused))).toBeGreaterThan(dist(vec(a), vec(b)) * 2)
  })

  it('快圆与慢圆有可感的距离(节奏本身是媒介)', () => {
    const fast = circle(0.5, 0.5, 0.2, { durMs: 400 })
    const slow = circle(0.5, 0.5, 0.2, { durMs: 2400 })
    const twin = circle(0.48, 0.52, 0.21, { durMs: 450 })
    expect(dist(vec(fast), vec(slow))).toBeGreaterThan(dist(vec(fast), vec(twin)) * 2)
  })
})
