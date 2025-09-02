import Phaser from 'phaser'
import { listSlots, setCurrentSlot, deleteSlot, type SlotMeta } from '../state/save'

export class SaveSelectScene extends Phaser.Scene {
  private slots: SlotMeta[] = []

  constructor() { super('SaveSelectScene') }

  create(): void {
    const cx = this.scale.width / 2
    const title = this.add.text(cx, 40, 'Save Slots', { fontSize: '28px', fontFamily: 'monospace', color: '#cbd5e1' }).setOrigin(0.5, 0)
    this.add.text(cx, 72, 'Select a save or create a new character', { fontSize: '14px', fontFamily: 'monospace', color: '#94a3b8' }).setOrigin(0.5, 0)

    this.refreshList()

    const newBtn = this.add.text(cx, this.scale.height - 80, '[ New Character ]', { fontSize: '20px', fontFamily: 'monospace', color: '#a7f3d0' }).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true })
    newBtn.on('pointerdown', () => this.scene.start('CharacterBuilderScene'))

    // Dev convenience: Esc goes back to Save Select from other scenes; here it does nothing
    this.input.keyboard?.on('keydown-ESC', () => {})

    // Ensure fullscreen activation on first gesture (some browsers require user action)
    const tryFS = () => { if (!this.scale.isFullscreen) { try { this.scale.startFullscreen() } catch {} } }
    this.input.once('pointerdown', tryFS)
    this.input.keyboard?.once('keydown', tryFS)
  }

  private refreshList(): void {
    const cx = this.scale.width / 2
    const startY = 130
    const style = { fontSize: '18px', fontFamily: 'monospace', color: '#cbd5e1' as const }
    const sub = { fontSize: '14px', fontFamily: 'monospace', color: '#94a3b8' as const }
    this.slots = listSlots()
    if (this.slots.length === 0) {
      this.add.text(cx, startY, 'No saves yet', sub).setOrigin(0.5, 0)
      return
    }
    let y = startY
    this.slots.forEach((s, i) => {
      const cont = this.add.container(cx, y)
      const idx = i + 1
      const label = this.add.text(-180, 0, `${idx}. ${s.name ?? 'Unnamed'}`, style).setOrigin(0, 0.5)
      const created = new Date(s.createdAt).toLocaleString()
      const subText = this.add.text(-180, 18, `Slot ${s.id} • Created ${created}`, sub).setOrigin(0, 0)
      const btn = this.add.text(160, 0, '[ Continue ]', { ...style, color: '#a7f3d0' }).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true })
      const del = this.add.text(280, 0, '[ Delete ]', { ...style, color: '#fca5a5' }).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true })
      btn.on('pointerdown', () => { setCurrentSlot(s.id); this.scene.start('MainScene', { safeMode: true }) })
      del.on('pointerdown', () => { deleteSlot(s.id); this.scene.restart() })
      cont.add([label, subText, btn, del])
      y += 60
    })
  }
}
