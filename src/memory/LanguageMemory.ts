// LanguageMemory —— store 的唯一写入者。emergence 的事件流经编排层落到这里,
// 由它翻译成状态变更与语言树的追记。expression 与 tree 层永远只读。
//
// 树的法则:只追记,不回写,不删除。
//  - Symbol 诞生 → 加 TreeNode(若有出处,加一条演化边);
//  - Symbol 死亡 → 活体表中移除,但树上的节点保留,只记下死期——死词也是文明痕迹;
//  - 组合/演化 → 节点之间追加边,边只说"谁从谁生长出来",不解释为什么。
//
// 写入纪律:所有传入的数据都深拷贝后入库,所有被改动的容器都整体替换。
// 引擎、绑定器与 store 三者之间没有任何共享引用,谁也污染不了谁。

import type { Expression, Symbol, TreeEdge, TreeNode } from '../types'
import { languageStore, type LanguageStore } from '../store'

const copySymbol = (s: Symbol): Symbol => ({ ...s, centroid: [...s.centroid] })

export class LanguageMemory {
  private readonly store: LanguageStore

  constructor(store: LanguageStore = languageStore) {
    this.store = store
  }

  /**
   * 记录一次诞生:活体表登记 Symbol 与其表达,语言树追加节点。
   * parentSymbolId 给出这个新词的"出处"(例如它从哪个旧词的用法上分化而来),则同时追加演化边。
   */
  recordBirth(symbol: Symbol, expression: Expression, parentSymbolId?: string): void {
    this.store.setState((state) => {
      if (state.symbols.has(symbol.id)) {
        throw new Error(`symbol ${symbol.id} already recorded: birth happens once`)
      }
      const symbols = new Map(state.symbols)
      symbols.set(symbol.id, copySymbol(symbol))
      const bindings = new Map(state.bindings)
      bindings.set(symbol.id, { ...expression })

      const node: TreeNode = {
        id: `n-${state.tree.nodes.length.toString(36)}`,
        symbolId: symbol.id,
        born: symbol.born,
        died: null,
      }
      const nodes = [...state.tree.nodes, node]
      let edges = state.tree.edges
      if (parentSymbolId !== undefined) {
        const parent = state.tree.nodes.find((n) => n.symbolId === parentSymbolId)
        if (parent === undefined) {
          throw new Error(`parent symbol ${parentSymbolId} has no tree node`)
        }
        edges = [...edges, { from: parent.id, to: node.id, born: symbol.born }]
      }
      return { symbols, bindings, tree: { nodes, edges } }
    })
  }

  /** 记录一次强化:刷新活体 Symbol(count/strength/质心)与其当前表达。树不动——强化不是事件史,是状态。 */
  recordReinforce(symbol: Symbol, expression: Expression): void {
    this.store.setState((state) => {
      if (!state.symbols.has(symbol.id)) {
        throw new Error(`cannot reinforce unknown symbol ${symbol.id}`)
      }
      const symbols = new Map(state.symbols)
      symbols.set(symbol.id, copySymbol(symbol))
      const bindings = new Map(state.bindings)
      bindings.set(symbol.id, { ...expression })
      return { symbols, bindings }
    })
  }

  /**
   * 记录一次死亡:从活体表移除,树上节点保留并记下死期。
   * 幂等:重复报丧不改写第一次的死期——死亡只有一次。
   */
  recordDeath(symbolId: string, t: number): void {
    this.store.setState((state) => {
      const symbols = new Map(state.symbols)
      const bindings = new Map(state.bindings)
      symbols.delete(symbolId)
      bindings.delete(symbolId)
      const nodes = state.tree.nodes.map((n) =>
        n.symbolId === symbolId && n.died === null ? { ...n, died: t } : n,
      )
      return { symbols, bindings, tree: { nodes, edges: state.tree.edges } }
    })
  }

  /** 记录一次组合/演化:两个已在树上的概念之间生出血缘。可以指向死词——新词从遗迹上生长,也是演化。 */
  recordEvolution(fromSymbolId: string, toSymbolId: string, t: number): void {
    this.store.setState((state) => {
      const from = state.tree.nodes.find((n) => n.symbolId === fromSymbolId)
      const to = state.tree.nodes.find((n) => n.symbolId === toSymbolId)
      if (from === undefined || to === undefined) {
        throw new Error(`evolution needs both nodes on the tree: ${fromSymbolId} -> ${toSymbolId}`)
      }
      return {
        tree: {
          nodes: state.tree.nodes,
          edges: [...state.tree.edges, { from: from.id, to: to.id, born: t } satisfies TreeEdge],
        },
      }
    })
  }

  /**
   * 整体刷新活体 Symbol 的连续状态(strength 在两次事件之间也在衰减)。
   * 只更新已登记的活体,不做诞生也不做死亡——那两件事必须走各自的仪式。
   */
  syncSymbols(symbols: readonly Symbol[]): void {
    this.store.setState((state) => {
      const next = new Map(state.symbols)
      for (const s of symbols) {
        if (next.has(s.id)) next.set(s.id, copySymbol(s))
      }
      return { symbols: next }
    })
  }
}
