// 映射层单元测试:纯逻辑,不渲染。
// 验证:诞生随机绑定、重复强化 confidence、变化引起轻微漂移、边界恒成立、深拷贝隔离。

import { describe, expect, it } from 'vitest'
import type { Expression } from '../types'
import { ExpressionBinder } from './ExpressionBinder'

/** 表达参数的合法范围断言(物理边界,不是意义)。 */
function expectValid(e: Expression): void {
  expect(e.hue).toBeGreaterThanOrEqual(0)
  expect(e.hue).toBeLessThan(1)
  expect(e.brightness).toBeGreaterThanOrEqual(0)
  expect(e.brightness).toBeLessThanOrEqual(1)
  expect(e.breathHz).toBeGreaterThan(0)
  expect(e.breathHz).toBeLessThanOrEqual(1.2)
  expect(e.flickerHz).toBeGreaterThanOrEqual(0)
  expect(e.flickerHz).toBeLessThanOrEqual(4)
  expect(e.form).toBeGreaterThanOrEqual(0)
  expect(e.form).toBeLessThanOrEqual(1)
  expect(e.scatter).toBeGreaterThanOrEqual(0)
  expect(e.scatter).toBeLessThanOrEqual(1)
  expect(e.toneHz).toBeGreaterThanOrEqual(80)
  expect(e.toneHz).toBeLessThanOrEqual(1500)
  expect(e.confidence).toBeGreaterThanOrEqual(0)
  expect(e.confidence).toBeLessThanOrEqual(1)
  for (const v of Object.values(e)) expect(Number.isFinite(v)).toBe(true)
}

describe('ExpressionBinder 意义协商', () => {
  it('诞生绑定:参数合法、新生试探(confidence 低),同种子完全可复现', () => {
    const a = new ExpressionBinder(42)
    const b = new ExpressionBinder(42)
    const ea = a.bind('s-0')
    const eb = b.bind('s-0')
    expectValid(ea)
    expect(ea).toEqual(eb) // 同种子同序列:随机是可复现的,不是不可控的
    expect(ea.confidence).toBeLessThanOrEqual(0.25)
  })

  it('不同 Symbol 抽到不同的表达(随机不查表)', () => {
    const binder = new ExpressionBinder(7)
    const e1 = binder.bind('s-0')
    const e2 = binder.bind('s-1')
    const e3 = binder.bind('s-2')
    for (const e of [e1, e2, e3]) expectValid(e)
    expect(e1).not.toEqual(e2)
    expect(e2).not.toEqual(e3)
  })

  it('bind 幂等:同一 Symbol 只诞生一次,重复 bind 返回既有绑定', () => {
    const binder = new ExpressionBinder(7)
    const first = binder.bind('s-0')
    const again = binder.bind('s-0')
    expect(again).toEqual(first)
  })

  it('reinforce:confidence 单调上升趋向 1,其余参数纹丝不动', () => {
    const binder = new ExpressionBinder(11)
    const born = binder.bind('s-0')
    let prev = born.confidence
    for (let i = 0; i < 20; i++) {
      const e = binder.reinforce('s-0')!
      expect(e.confidence).toBeGreaterThan(prev)
      prev = e.confidence
      const { confidence: _c1, ...rest } = e
      const { confidence: _c2, ...bornRest } = born
      expect(rest).toEqual(bornRest)
    }
    expect(prev).toBeGreaterThan(0.9)
  })

  it('drift:参数发生可感但轻微的变化,confidence 不升反微降', () => {
    const binder = new ExpressionBinder(13)
    const before = binder.bind('s-0')
    const after = binder.drift('s-0')!
    expectValid(after)
    expect(after).not.toEqual(before)
    expect(after.confidence).toBeLessThanOrEqual(before.confidence)
    // 轻微:单次漂移不会面目全非
    expect(Math.abs(after.form - before.form)).toBeLessThanOrEqual(0.06)
    expect(Math.abs(after.scatter - before.scatter)).toBeLessThanOrEqual(0.08)
    expect(Math.abs(after.brightness - before.brightness)).toBeLessThanOrEqual(0.05)
  })

  it('长期漂移:300 次随机游走后一切仍在物理边界内', () => {
    const binder = new ExpressionBinder(17)
    binder.bind('s-0')
    for (let i = 0; i < 300; i++) expectValid(binder.drift('s-0')!)
  })

  it('返回的都是深拷贝:篡改返回值不影响内部绑定(单向数据流)', () => {
    const binder = new ExpressionBinder(19)
    const e = binder.bind('s-0')
    e.hue = 999
    e.confidence = 999
    const real = binder.getExpression('s-0')!
    expectValid(real)
    expect(real.hue).not.toBe(999)
  })

  it('未绑定与已解除的 id:getExpression/reinforce/drift 一律返回 undefined', () => {
    const binder = new ExpressionBinder(23)
    expect(binder.getExpression('ghost')).toBeUndefined()
    expect(binder.reinforce('ghost')).toBeUndefined()
    expect(binder.drift('ghost')).toBeUndefined()
    binder.bind('s-0')
    binder.unbind('s-0')
    expect(binder.getExpression('s-0')).toBeUndefined()
  })
})
