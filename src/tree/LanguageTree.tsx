// LanguageTree —— 语言树的可视化:悬浮在光点四周的一片星座。
// 每颗星是一个涌现过的词(用它自己的表达参数上色),星与星之间的暗线是血缘。
// 活着的词随呼吸明灭;死去的词退成灰烬,但不消失——死词也是文明痕迹。
//
// 这一层对 store 只读。它不学习、不协商,只凝视历史。
// 没有面板、没有图例:把指针悬在一颗星上,才浮现一行极淡的铭文(诞生 · 次数/死期)。

import { useFrame, useThree } from '@react-three/fiber'
import { Html } from '@react-three/drei'
import { useMemo, useRef, useState } from 'react'
import * as THREE from 'three'
import { useLanguage } from '../store'
import type { TreeEdge, TreeNode } from '../types'

const GOLDEN = 2.399963229728653 // 黄金角:自然的疏密

/** 不透明 id → [0,1) 的确定性散列,给每颗星一点属于自己的偏斜。 */
function hash01(id: string): number {
  let h = 2166136261
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 100000) / 100000
}

/** 由血缘推出每颗星的位置:根在内圈,后代沿父辈的方向向外生长。 */
function layout(
  nodes: readonly TreeNode[],
  edges: readonly TreeEdge[],
  half: number,
): Map<string, { x: number; y: number; depth: number }> {
  const parentOf = new Map<string, string>()
  for (const e of edges) if (!parentOf.has(e.to)) parentOf.set(e.to, e.from)

  const depthCache = new Map<string, number>()
  const depthOf = (id: string): number => {
    const cached = depthCache.get(id)
    if (cached !== undefined) return cached
    const p = parentOf.get(id)
    const d = p === undefined ? 0 : depthOf(p) + 1
    depthCache.set(id, d)
    return d
  }

  const angleCache = new Map<string, number>()
  let rootIndex = 0
  const siblingIndex = new Map<string, number>()
  const angleOf = (id: string): number => {
    const cached = angleCache.get(id)
    if (cached !== undefined) return cached
    const p = parentOf.get(id)
    let a: number
    if (p === undefined) {
      a = rootIndex++ * GOLDEN + hash01(id) * 0.6
    } else {
      const idx = siblingIndex.get(p) ?? 0
      siblingIndex.set(p, idx + 1)
      a = angleOf(p) + (idx - 0.5) * 0.5 + (hash01(id) - 0.5) * 0.35
    }
    angleCache.set(id, a)
    return a
  }

  const out = new Map<string, { x: number; y: number; depth: number }>()
  for (const n of nodes) {
    const depth = depthOf(n.id)
    const a = angleOf(n.id)
    const r = Math.min(half * (0.60 + depth * 0.13 + hash01(n.id) * 0.05), half * 0.95)
    out.set(n.id, { x: Math.cos(a) * r, y: Math.sin(a) * r, depth })
  }
  return out
}

// 柔光贴图:星星是一团渐隐的光,不是一枚圆片。整个星座共享一张。
let softTexture: THREE.Texture | null = null
function softDot(): THREE.Texture {
  if (softTexture !== null) return softTexture
  const c = document.createElement('canvas')
  c.width = c.height = 128
  const ctx = c.getContext('2d')!
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64)
  g.addColorStop(0, 'rgba(255,255,255,1)')
  g.addColorStop(0.22, 'rgba(255,255,255,0.5)')
  g.addColorStop(0.55, 'rgba(255,255,255,0.1)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 128, 128)
  softTexture = new THREE.CanvasTexture(c)
  return softTexture
}

/** 铭文的时间刻法:毫秒 → m:ss(这场相遇内部的纪年)。 */
const stamp = (ms: number): string => {
  const s = Math.max(0, Math.floor(ms / 1000))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function Star({
  node,
  pos,
  hue,
  strength,
  count,
  onHover,
}: {
  node: TreeNode
  pos: { x: number; y: number }
  hue: number | null
  strength: number
  count: number | null
  onHover: (id: string | null) => void
}) {
  const alive = node.died === null
  const mat = useRef<THREE.MeshBasicMaterial>(null)
  const halo = useRef<THREE.MeshBasicMaterial>(null)
  const [hovered, setHovered] = useState(false)
  const phase = useMemo(() => hash01(node.id) * Math.PI * 2, [node.id])

  const color = useMemo(() => {
    const c = new THREE.Color()
    if (alive && hue !== null) c.setHSL(hue, 0.5, 0.62)
    else c.set('#5a5a5a') // 灰烬
    return c
  }, [alive, hue])

  useFrame(({ clock }) => {
    if (mat.current === null || halo.current === null) return
    const t = clock.elapsedTime
    const breath = alive ? 0.75 + 0.25 * Math.sin(t * 0.9 + phase) : 1
    const base = alive ? 0.28 + 0.55 * strength : 0.14
    const lift = hovered ? 1.6 : 1
    mat.current.opacity = Math.min(1, base * breath * lift)
    halo.current.opacity = Math.min(0.5, base * 0.35 * breath * lift)
  })

  const size = alive ? 0.055 + 0.03 * strength : 0.04
  return (
    <group position={[pos.x, pos.y, 0]}>
      <mesh scale={[size * 4, size * 4, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          ref={mat}
          map={softDot()}
          color={color}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      <mesh scale={[size * 11, size * 11, 1]}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial
          ref={halo}
          map={softDot()}
          color={color}
          transparent
          opacity={0}
          blending={THREE.AdditiveBlending}
          depthWrite={false}
        />
      </mesh>
      {/* 更大的不可见触区:星星太小,不该考验指针的准头 */}
      <mesh
        onPointerOver={() => {
          setHovered(true)
          onHover(node.id)
        }}
        onPointerOut={() => {
          setHovered(false)
          onHover(null)
        }}
      >
        <circleGeometry args={[size * 5, 12]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      {hovered && (
        <Html center position={[0, size * 8, 0]} style={{ pointerEvents: 'none' }}>
          <div
            style={{
              fontFamily: 'ui-monospace, monospace',
              fontSize: '10px',
              letterSpacing: '0.12em',
              color: 'rgba(255,255,255,0.38)',
              whiteSpace: 'nowrap',
              userSelect: 'none',
            }}
          >
            {alive
              ? `${stamp(node.born)} · ×${count ?? '·'}`
              : `${stamp(node.born)} — ${stamp(node.died!)} †`}
          </div>
        </Html>
      )}
    </group>
  )
}

export function LanguageTree() {
  const nodes = useLanguage((s) => s.tree.nodes)
  const edges = useLanguage((s) => s.tree.edges)
  const bindings = useLanguage((s) => s.bindings)
  const symbols = useLanguage((s) => s.symbols)
  const { viewport } = useThree()
  const group = useRef<THREE.Group>(null)
  const hoverRef = useRef<string | null>(null)

  const half = viewport.height / 2
  const positions = useMemo(() => layout(nodes, edges, half), [nodes, edges, half])

  const edgeGeometry = useMemo(() => {
    const pts: number[] = []
    for (const e of edges) {
      const a = positions.get(e.from)
      const b = positions.get(e.to)
      if (a && b) pts.push(a.x, a.y, 0, b.x, b.y, 0)
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3))
    return g
  }, [edges, positions])

  // 整片星座极缓慢地转动——语言在时间里,不在坐标系里。悬停时屏息静止。
  useFrame((_, dt) => {
    if (group.current !== null && hoverRef.current === null) {
      group.current.rotation.z += Math.min(dt, 0.1) * 0.008
    }
  })

  return (
    <group ref={group}>
      {edges.length > 0 && (
        <lineSegments geometry={edgeGeometry}>
          <lineBasicMaterial
            color="#888888"
            transparent
            opacity={0.10}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </lineSegments>
      )}
      {nodes.map((n) => {
        const pos = positions.get(n.id)
        if (pos === undefined) return null
        const sym = symbols.get(n.symbolId)
        return (
          <Star
            key={n.id}
            node={n}
            pos={pos}
            hue={bindings.get(n.symbolId)?.hue ?? null}
            strength={sym?.strength ?? 0}
            count={sym?.count ?? null}
            onHover={(id) => (hoverRef.current = id)}
          />
        )
      })}
    </group>
  )
}
