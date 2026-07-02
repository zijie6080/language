// store —— 全项目唯一的状态容器,三块状态:symbols / bindings / tree。
//
// 写入纪律(架构铁律):只有 memory 层(LanguageMemory)允许写入这个 store。
// expression 与 tree 只读、只订阅。状态类型刻意声明为 ReadonlyMap / readonly[],
// 让"反向偷改"在类型层面就不成立;每次写入都替换整个容器实例,旧快照永不被原地篡改。

import { useStore } from 'zustand'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type { Expression, Symbol, TreeEdge, TreeNode } from '../types'

export interface LanguageState {
  /** 活体词汇:当前存活的 Symbol。死亡即移出,历史去 tree 里找。 */
  symbols: ReadonlyMap<string, Symbol>
  /** 活体绑定:每个存活 Symbol 当前"如何被说出来"。 */
  bindings: ReadonlyMap<string, Expression>
  /** 语言树:只增不删的文明痕迹。死词保留节点,died 记下死期。 */
  tree: {
    nodes: readonly TreeNode[]
    edges: readonly TreeEdge[]
  }
}

export type LanguageStore = StoreApi<LanguageState>

/** 建一个空白的语言状态容器。测试用它隔离;正式运行用下面的单例。 */
export function createLanguageStore(): LanguageStore {
  return createStore<LanguageState>(() => ({
    symbols: new Map(),
    bindings: new Map(),
    tree: { nodes: [], edges: [] },
  }))
}

/** 全局单例:一次相遇,一份记忆。 */
export const languageStore: LanguageStore = createLanguageStore()

/** React 侧的只读订阅入口(expression / tree 用它选取所需切片)。 */
export function useLanguage<T>(selector: (state: LanguageState) => T): T {
  return useStore(languageStore, selector)
}
