export type HairStyle = 'none' | 'spike' | 'bob'
export type OutfitStyle = 'suit' | 'robe' | 'armor'

export interface AppearanceV2 {
  hair: HairStyle
  bodyColor: number
  hairColor: number
  outfit: OutfitStyle
}

export type Appearance = AppearanceV2

export interface SaveDataV1 {
  version: 1
  appearance: { hair: HairStyle; color: number; outfit: OutfitStyle }
}

export interface MetaProgress {
  cores: number
  upgrades: {
    maxHp: number
    bulletSpeedPct: number
    dashSpeedPct: number
    fireRatePct: number
    pierce: number
    healOnClear: number
  }
}

export interface SaveDataV2 {
  version: 2
  name: string
  appearance: AppearanceV2
  meta: MetaProgress
}

export type SaveData = SaveDataV2

export interface SlotMeta {
  id: string
  createdAt: number
  name?: string
}

const INDEX_KEY = 'mfg:slots:index'
const SLOT_PREFIX = 'mfg:slot:'
const CURRENT_KEY = 'mfg:currentSlot'

export function getDefaultAppearance(): Appearance {
  return { hair: 'none', bodyColor: 0x00d9ff, hairColor: 0x2b2b2b, outfit: 'suit' }
}

function readIndex(): SlotMeta[] {
  try {
    const raw = localStorage.getItem(INDEX_KEY)
    if (!raw) return []
    let arr = JSON.parse(raw) as SlotMeta[]
    if (!Array.isArray(arr)) arr = []
    // Hydrate names if missing
    let needsWrite = false
    const filled = arr.map(meta => {
      if (!meta.name) {
        const s = loadSlot(meta.id)
        const name = (s as any)?.name ?? 'Unnamed'
        const withName = { ...meta, name }
        needsWrite = true
        return withName
      }
      return meta
    })
    if (needsWrite) writeIndex(filled as any)
    return filled
  } catch { return [] }
}

function writeIndex(list: SlotMeta[]): void {
  localStorage.setItem(INDEX_KEY, JSON.stringify(list))
}

export function listSlots(): SlotMeta[] { return readIndex() }

export function getCurrentSlotId(): string | null { try { return localStorage.getItem(CURRENT_KEY) } catch { return null } }
export function setCurrentSlot(id: string | null): void { if (id === null) localStorage.removeItem(CURRENT_KEY); else localStorage.setItem(CURRENT_KEY, id) }

export function loadSlot(id: string): SaveData | null {
  try {
    const raw = localStorage.getItem(SLOT_PREFIX + id)
    if (!raw) return null
    const parsed = JSON.parse(raw) as any
    if (parsed.version === 2) {
      // Fill missing fields if older v2 structure
      if (!parsed.name) parsed.name = 'Unnamed'
      if (!parsed.appearance?.hairColor) parsed.appearance.hairColor = 0x2b2b2b
      if (!parsed.appearance?.bodyColor && parsed.appearance?.color) parsed.appearance.bodyColor = parsed.appearance.color
      if (!parsed.meta) parsed.meta = { cores: 0, upgrades: { maxHp: 0, bulletSpeedPct: 0, dashSpeedPct: 0, fireRatePct: 0, pierce: 0, healOnClear: 0 } }
      // Fill newly added upgrade keys if missing
      if (!parsed.meta.upgrades) parsed.meta.upgrades = { maxHp: 0, bulletSpeedPct: 0, dashSpeedPct: 0, fireRatePct: 0, pierce: 0, healOnClear: 0 }
      if (parsed.meta.upgrades.fireRatePct === undefined) parsed.meta.upgrades.fireRatePct = 0
      if (parsed.meta.upgrades.pierce === undefined) parsed.meta.upgrades.pierce = 0
      if (parsed.meta.upgrades.healOnClear === undefined) parsed.meta.upgrades.healOnClear = 0
      localStorage.setItem(SLOT_PREFIX + id, JSON.stringify(parsed))
      return parsed as SaveDataV2
    }
    if (parsed.version === 1) {
      const v1 = parsed as SaveDataV1
      const up: SaveDataV2 = {
        version: 2,
        name: 'Unnamed',
        appearance: {
          hair: v1.appearance.hair,
          bodyColor: v1.appearance.color,
          hairColor: 0x2b2b2b,
          outfit: v1.appearance.outfit
        },
        meta: { cores: 0, upgrades: { maxHp: 0, bulletSpeedPct: 0, dashSpeedPct: 0, fireRatePct: 0, pierce: 0, healOnClear: 0 } }
      }
      localStorage.setItem(SLOT_PREFIX + id, JSON.stringify(up))
      return up
    }
    return null
  } catch { return null }
}

export function loadCurrent(): SaveData | null { const id = getCurrentSlotId(); return id ? loadSlot(id) : null }

export function createSlot(appearance: Appearance, name: string): string {
  const id = 's-' + Date.now().toString(36)
  const meta: SlotMeta = { id, createdAt: Date.now(), name }
  const list = readIndex(); list.push(meta); writeIndex(list)
  const data: SaveDataV2 = { version: 2, appearance, name, meta: { cores: 0, upgrades: { maxHp: 0, bulletSpeedPct: 0, dashSpeedPct: 0, fireRatePct: 0, pierce: 0, healOnClear: 0 } } }
  localStorage.setItem(SLOT_PREFIX + id, JSON.stringify(data))
  setCurrentSlot(id)
  return id
}

export function deleteSlot(id: string): void {
  try {
    const list = readIndex().filter(s => s.id !== id)
    writeIndex(list)
    localStorage.removeItem(SLOT_PREFIX + id)
    if (getCurrentSlotId() === id) setCurrentSlot(list[0]?.id ?? null)
  } catch {}
}

export function hasAnySlots(): boolean { return readIndex().length > 0 }

// Shims for earlier code
export function hasSave(): boolean { return hasAnySlots() }
export function loadSave(): SaveData | null { return loadCurrent() }
export function saveNew(appearance: Appearance, name: string): void { createSlot(appearance, name) }
export function deleteSave(): void { const id = getCurrentSlotId(); if (id) deleteSlot(id) }

export function saveSlot(id: string, data: SaveData): void {
  localStorage.setItem(SLOT_PREFIX + id, JSON.stringify(data))
}
