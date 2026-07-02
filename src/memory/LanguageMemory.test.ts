// 记忆层单元测试:每个测试用独立的 store,验证追记法则与单向数据流。

import { describe, expect, it } from 'vitest'
import { FEATURE_DIM, type Expression, type Symbol } from '../types'
import { createLanguageStore } from '../store'
import { LanguageMemory } from './LanguageMemory'

const makeSymbol = (id: string, born = 0): Symbol => ({
  id,
  centroid: new Array(FEATURE_DIM).fill(0.5),
  born,
  count: 1,
  strength: 0.3,
})

const makeExpr = (hue = 0.5): Expression => ({
  hue,
  brightness: 0.4,
  breathHz: 0.2,
  flickerHz: 0,
  form: 0.5,
  scatter: 0.1,
  toneHz: 220,
  confidence: 0.15,
})

const setup = () => {
  const store = createLanguageStore()
  return { store, mem: new LanguageMemory(store) }
}

describe('LanguageMemory 追记法则', () => {
  it('诞生:活体表登记 Symbol 与绑定,树上长出存活节点', () => {
    const { store, mem } = setup()
    mem.recordBirth(makeSymbol('s-0', 1000), makeExpr())
    const s = store.getState()
    expect(s.symbols.get('s-0')?.born).toBe(1000)
    expect(s.bindings.get('s-0')?.toneHz).toBe(220)
    expect(s.tree.nodes).toHaveLength(1)
    expect(s.tree.nodes[0]).toMatchObject({ symbolId: 's-0', born: 1000, died: null })
    expect(s.tree.edges).toHaveLength(0)
    expect(() => mem.recordBirth(makeSymbol('s-0'), makeExpr())).toThrow() // 诞生只有一次
  })

  it('带出处的诞生:自动追加一条演化边(父节点 → 新节点)', () => {
    const { store, mem } = setup()
    mem.recordBirth(makeSymbol('s-0', 0), makeExpr())
    mem.recordBirth(makeSymbol('s-1', 5000), makeExpr(0.8), 's-0')
    const { tree } = store.getState()
    expect(tree.edges).toHaveLength(1)
    expect(tree.edges[0]).toEqual({ from: tree.nodes[0].id, to: tree.nodes[1].id, born: 5000 })
    expect(() => mem.recordBirth(makeSymbol('s-9'), makeExpr(), 'ghost')).toThrow()
  })

  it('强化:活体状态刷新,树纹丝不动', () => {
    const { store, mem } = setup()
    mem.recordBirth(makeSymbol('s-0'), makeExpr())
    const treeBefore = store.getState().tree
    const grown = { ...makeSymbol('s-0'), count: 7, strength: 0.9 }
    mem.recordReinforce(grown, { ...makeExpr(), confidence: 0.6 })
    const s = store.getState()
    expect(s.symbols.get('s-0')?.count).toBe(7)
    expect(s.bindings.get('s-0')?.confidence).toBe(0.6)
    expect(s.tree).toBe(treeBefore) // 引用未变:强化不是事件史
    expect(() => mem.recordReinforce(makeSymbol('ghost'), makeExpr())).toThrow()
  })

  it('死亡:活体表移除,节点保留且记下死期——死词也是文明痕迹;报丧幂等', () => {
    const { store, mem } = setup()
    mem.recordBirth(makeSymbol('s-0', 0), makeExpr())
    mem.recordBirth(makeSymbol('s-1', 100), makeExpr())
    mem.recordDeath('s-0', 60_000)
    let s = store.getState()
    expect(s.symbols.has('s-0')).toBe(false)
    expect(s.bindings.has('s-0')).toBe(false)
    expect(s.tree.nodes).toHaveLength(2) // 节点不删
    expect(s.tree.nodes.find((n) => n.symbolId === 's-0')?.died).toBe(60_000)
    expect(s.tree.nodes.find((n) => n.symbolId === 's-1')?.died).toBeNull()
    mem.recordDeath('s-0', 99_999) // 重复报丧
    s = store.getState()
    expect(s.tree.nodes.find((n) => n.symbolId === 's-0')?.died).toBe(60_000) // 死期不被改写
  })

  it('演化边:两个在树上的概念之间生出血缘,死词也可以是出处', () => {
    const { store, mem } = setup()
    mem.recordBirth(makeSymbol('s-0', 0), makeExpr())
    mem.recordBirth(makeSymbol('s-1', 100), makeExpr())
    mem.recordDeath('s-0', 50_000)
    mem.recordEvolution('s-0', 's-1', 51_000) // 新词从遗迹上生长
    const { tree } = store.getState()
    expect(tree.edges).toHaveLength(1)
    expect(tree.edges[0].born).toBe(51_000)
    expect(() => mem.recordEvolution('ghost', 's-1', 0)).toThrow()
  })

  it('syncSymbols:只刷新已登记的活体,不偷偷诞生新词', () => {
    const { store, mem } = setup()
    mem.recordBirth(makeSymbol('s-0'), makeExpr())
    mem.syncSymbols([
      { ...makeSymbol('s-0'), strength: 0.12 },
      makeSymbol('stranger'), // 未经诞生仪式的陌生者
    ])
    const s = store.getState()
    expect(s.symbols.get('s-0')?.strength).toBe(0.12)
    expect(s.symbols.has('stranger')).toBe(false)
  })

  it('单向数据流:入库即深拷贝,事后篡改入参不污染 store;写入替换容器实例', () => {
    const { store, mem } = setup()
    const sym = makeSymbol('s-0')
    const expr = makeExpr()
    mem.recordBirth(sym, expr)
    const before = store.getState()
    sym.centroid[0] = 999
    expr.hue = 999
    expect(store.getState().symbols.get('s-0')?.centroid[0]).toBe(0.5)
    expect(store.getState().bindings.get('s-0')?.hue).toBe(0.5)

    mem.recordReinforce({ ...makeSymbol('s-0'), count: 2 }, makeExpr())
    const after = store.getState()
    expect(after.symbols).not.toBe(before.symbols) // 容器替换,旧快照不被原地篡改
    expect(before.symbols.get('s-0')?.count).toBe(1) // 旧快照保持旧值
    expect(after.symbols.get('s-0')?.count).toBe(2)
  })
})
