import Phaser from 'phaser'
import { type Appearance, saveNew, HairStyle, OutfitStyle } from '../state/save'

const HAIRS: HairStyle[] = ['none', 'spike', 'bob']
const OUTFITS: OutfitStyle[] = ['suit', 'robe', 'armor']

export class CharacterBuilderScene extends Phaser.Scene {
  private preview!: Phaser.GameObjects.Container
  private head!: Phaser.GameObjects.Arc
  private torsoG?: Phaser.GameObjects.Graphics
  private hairG?: Phaser.GameObjects.Graphics
  private outfitG?: Phaser.GameObjects.Graphics

  private iHair = 0
  private iOutfit = 0

  private activeTarget: 'body' | 'hair' = 'body'
  private bodyColorValue = 0x00d9ff
  private hairColorValue = 0x2b2b2b

  private labelHair!: Phaser.GameObjects.Text
  private labelOutfit!: Phaser.GameObjects.Text
  private targetText!: Phaser.GameObjects.Text
  private bodySwatch!: Phaser.GameObjects.Rectangle
  private hairSwatch!: Phaser.GameObjects.Rectangle
  private wheelCanvas!: HTMLCanvasElement
  private wheelImage!: Phaser.GameObjects.Image
  private wheelKey = 'color-wheel'

  // In-canvas name input
  private nameValue = 'Mike'
  private nameText!: Phaser.GameObjects.Text
  private nameBox!: Phaser.GameObjects.Rectangle
  private caret!: Phaser.GameObjects.Rectangle
  private caretBlink?: Phaser.Time.TimerEvent
  private nameFocused = true

  constructor() { super('CharacterBuilderScene') }

  create(): void {
    const cx = this.scale.width / 2
    const cy = this.scale.height / 2
    this.add.text(cx, 36, 'Character Builder', { fontSize: '28px', fontFamily: 'monospace', color: '#cbd5e1' }).setOrigin(0.5, 0)
    this.add.text(cx, 64, 'Pick hair, outfit, and colors', { fontSize: '14px', fontFamily: 'monospace', color: '#94a3b8' }).setOrigin(0.5, 0)

    // Preview
    this.preview = this.add.container(cx - 300, cy - 28)
    this.head = this.add.circle(0, -8, 10, this.bodyColorValue)
    this.preview.add(this.head)
    this.rebuildPreview()
    // Ensure correct initial size and keep it responsive
    this.rescalePreview()
    this.scale.on('resize', () => this.rescalePreview())

    const style: Phaser.Types.GameObjects.Text.TextStyle = { fontSize: '18px', fontFamily: 'monospace', color: '#cbd5e1' }
    const sub: Phaser.Types.GameObjects.Text.TextStyle = { fontSize: '14px', fontFamily: 'monospace', color: '#94a3b8' }

    // Name input (canvas)
    const nameY = cy - 8
    this.add.text(cx - 160, nameY, 'Name', style).setOrigin(1, 0.5)
    this.nameBox = this.add.rectangle(cx - 140, nameY, 260, 26, 0x0b0f15, 1).setStrokeStyle(1, 0x64748b).setOrigin(0, 0.5).setInteractive({ useHandCursor: true })
    this.nameText = this.add.text(cx - 134, nameY, this.nameValue, { ...style, color: '#e2e8f0' }).setOrigin(0, 0.5)
    this.caret = this.add.rectangle(this.nameText.x + this.nameText.width + 2, nameY, 2, 18, 0xa7f3d0).setOrigin(0, 0.5)
    this.caretBlink = this.time.addEvent({ delay: 480, loop: true, callback: () => this.caret.setVisible(!this.caret.visible) })
    this.nameBox.on('pointerdown', () => { this.nameFocused = true })

    // Hair row
    let y = cy + 28
    this.add.text(cx - 160, y, 'Hair', style).setOrigin(1, 0.5)
    const hLeft = this.add.text(cx - 140, y, '<', style).setOrigin(0, 0.5).setInteractive({ useHandCursor: true })
    this.labelHair = this.add.text(cx - 120, y, HAIRS[this.iHair], style).setOrigin(0, 0.5)
    const hRight = this.add.text(cx + 60, y, '>', style).setOrigin(0, 0.5).setInteractive({ useHandCursor: true })
    hLeft.on('pointerdown', () => { this.iHair = (this.iHair + HAIRS.length - 1) % HAIRS.length; this.syncUI() })
    hRight.on('pointerdown', () => { this.iHair = (this.iHair + 1) % HAIRS.length; this.syncUI() })

    // Outfit row
    y += 36
    this.add.text(cx - 160, y, 'Outfit', style).setOrigin(1, 0.5)
    const oLeft = this.add.text(cx - 140, y, '<', style).setOrigin(0, 0.5).setInteractive({ useHandCursor: true })
    this.labelOutfit = this.add.text(cx - 120, y, OUTFITS[this.iOutfit], style).setOrigin(0, 0.5)
    const oRight = this.add.text(cx + 60, y, '>', style).setOrigin(0, 0.5).setInteractive({ useHandCursor: true })
    oLeft.on('pointerdown', () => { this.iOutfit = (this.iOutfit + OUTFITS.length - 1) % OUTFITS.length; this.syncUI() })
    oRight.on('pointerdown', () => { this.iOutfit = (this.iOutfit + 1) % OUTFITS.length; this.syncUI() })

    // Editing target row
    y += 36
    this.add.text(cx - 160, y, 'Editing:', style).setOrigin(1, 0.5)
    this.targetText = this.add.text(cx - 120, y, 'Body', style).setOrigin(0, 0.5)
    const bodyBtn = this.add.text(cx - 60, y, '[ Body ]', { ...style, color: '#a7f3d0' }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true })
    const hairBtn = this.add.text(cx + 40, y, '[ Hair ]', { ...style, color: '#cbd5e1' }).setOrigin(0, 0.5).setInteractive({ useHandCursor: true })
    bodyBtn.on('pointerdown', () => { this.activeTarget = 'body'; this.targetText.setText('Body'); bodyBtn.setColor('#a7f3d0'); hairBtn.setColor('#cbd5e1') })
    hairBtn.on('pointerdown', () => { this.activeTarget = 'hair'; this.targetText.setText('Hair'); hairBtn.setColor('#a7f3d0'); bodyBtn.setColor('#cbd5e1') })

    // Swatches row
    y += 36
    this.add.text(cx - 160, y, 'Body Color', sub).setOrigin(1, 0.5)
    this.bodySwatch = this.add.rectangle(cx - 120, y, 30, 18, this.bodyColorValue).setOrigin(0, 0.5).setStrokeStyle(1, 0x94a3b8)
    this.add.text(cx - 70, y, 'Hair Color', sub).setOrigin(0, 0.5)
    this.hairSwatch = this.add.rectangle(cx + 20, y, 30, 18, this.hairColorValue).setOrigin(0, 0.5).setStrokeStyle(1, 0x94a3b8)

    // Color wheel
    this.createWheelTexture(280)
    this.wheelImage = this.add.image(cx + 260, cy - 6, this.wheelKey).setInteractive({ useHandCursor: true })
    this.wheelImage.on('pointerdown', (p: Phaser.Input.Pointer) => this.pickFromWheel(p))
    this.wheelImage.on('pointermove', (p: Phaser.Input.Pointer) => { if (p.isDown) this.pickFromWheel(p) })

    // Confirm button
    const confirm = this.add.text(cx, this.scale.height - 48, '[ Confirm ]', { ...style, color: '#a7f3d0' }).setOrigin(0.5, 0.5).setInteractive({ useHandCursor: true })
    confirm.on('pointerdown', () => this.saveAndStart())

    // Keyboard
    this.input.keyboard?.on('keydown', (evt: KeyboardEvent) => this.handleTyping(evt))
    this.input.keyboard?.on('keydown-F', () => { if (this.scale.isFullscreen) this.scale.stopFullscreen(); else this.scale.startFullscreen() })
    this.input.keyboard?.on('keydown-ESC', () => { this.scene.start('SaveSelectScene') })
  }

  private handleTyping(e: KeyboardEvent): void {
    if (!this.nameFocused) return
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const k = e.key
    if (k === 'Enter') { this.saveAndStart(); return }
    if (k === 'Backspace') { this.nameValue = this.nameValue.slice(0, -1); this.updateName(); return }
    if (k.length === 1 && /[a-zA-Z0-9 _-]/.test(k)) {
      if (this.nameValue.length < 16) { this.nameValue += k; this.updateName() }
    }
  }

  private updateName(): void {
    this.nameText.setText(this.nameValue)
    this.caret.setPosition(this.nameText.x + this.nameText.width + 2, this.nameText.y)
  }

  private rescalePreview(): void {
    const w = this.scale.width, h = this.scale.height
    const scale = Phaser.Math.Clamp(Math.min(w, h) / 220, 2.0, 4.0)
    this.preview.setScale(scale)
  }

  private rebuildPreview(): void {
    const bodyColor = this.bodyColorValue
    this.head.setFillStyle(bodyColor)
    this.hairG?.destroy(); this.outfitG?.destroy(); this.torsoG?.destroy()
    const torso = this.add.graphics()
    torso.fillStyle(bodyColor, 1)
    torso.fillRoundedRect(-14, -2, 28, 22, 6)
    torso.fillRoundedRect(-16, -4, 6, 16, 3)
    torso.fillRoundedRect(10, -4, 6, 16, 3)
    this.preview.add(torso)
    this.torsoG = torso

    const hair = HAIRS[this.iHair]
    if (hair !== 'none') {
      const g = this.add.graphics(); g.fillStyle(this.hairColorValue, 1)
      if (hair === 'spike') { g.fillTriangle(-12, -12, -4, -18, 4, -12); g.fillTriangle(0, -12, 8, -18, 14, -12) }
      else if (hair === 'bob') { g.fillRoundedRect(-16, -18, 32, 8, { tl: 6, tr: 6, bl: 0, br: 0 }) }
      this.preview.add(g); this.hairG = g
    }

    const og = this.add.graphics(); og.fillStyle(0x9097a5, 1)
    const outfit = OUTFITS[this.iOutfit]
    if (outfit === 'suit') og.fillRect(-12, 8, 24, 8)
    else if (outfit === 'robe') og.fillRoundedRect(-14, 2, 28, 18, 6)
    else if (outfit === 'armor') og.fillTriangle(-12, 8, 12, 8, 0, 20)
    this.preview.add(og); this.outfitG = og
  }

  private syncUI(): void {
    this.labelHair.setText(HAIRS[this.iHair])
    this.labelOutfit.setText(OUTFITS[this.iOutfit])
    this.bodySwatch.setFillStyle(this.bodyColorValue)
    this.hairSwatch.setFillStyle(this.hairColorValue)
    this.rebuildPreview()
    this.rescalePreview()
  }

  private hsvToRgb(h: number, s: number, v: number): { r: number; g: number; b: number } {
    const c = v * s; const hp = h / 60; const x = c * (1 - Math.abs((hp % 2) - 1))
    let r1 = 0, g1 = 0, b1 = 0
    if (hp >= 0 && hp < 1) { r1 = c; g1 = x; b1 = 0 }
    else if (hp < 2) { r1 = x; g1 = c; b1 = 0 }
    else if (hp < 3) { r1 = 0; g1 = c; b1 = x }
    else if (hp < 4) { r1 = 0; g1 = x; b1 = c }
    else if (hp < 5) { r1 = x; g1 = 0; b1 = c }
    else { r1 = c; g1 = 0; b1 = x }
    const m = v - c
    return { r: Math.round((r1 + m) * 255), g: Math.round((g1 + m) * 255), b: Math.round((b1 + m) * 255) }
  }

  private createWheelTexture(size: number): void {
    const canvas = document.createElement('canvas')
    canvas.width = size; canvas.height = size
    const ctx = canvas.getContext('2d')!
    const cx = size / 2, cy = size / 2, rMax = size / 2 - 1
    const imageData = ctx.createImageData(size, size); const data = imageData.data
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const dx = x - cx, dy = y - cy, r = Math.sqrt(dx * dx + dy * dy)
        const idx = (y * size + x) * 4
        if (r > rMax) { data[idx + 3] = 0; continue }
        let h = Math.atan2(dy, dx) * 180 / Math.PI; if (h < 0) h += 360
        const s = Math.min(1, r / rMax), v = 1
        const { r: rr, g: gg, b: bb } = this.hsvToRgb(h, s, v)
        data[idx] = rr; data[idx + 1] = gg; data[idx + 2] = bb; data[idx + 3] = 255
      }
    }
    ctx.putImageData(imageData, 0, 0)
    if (this.textures.exists(this.wheelKey)) this.textures.remove(this.wheelKey)
    this.textures.addCanvas(this.wheelKey, canvas)
    this.wheelCanvas = canvas
  }

  private pickFromWheel(p: Phaser.Input.Pointer): void {
    const img = this.wheelImage
    const rect = new Phaser.Geom.Rectangle(img.x - img.displayWidth / 2, img.y - img.displayHeight / 2, img.displayWidth, img.displayHeight)
    if (!Phaser.Geom.Rectangle.Contains(rect, p.worldX, p.worldY)) return
    const u = (p.worldX - rect.x) / rect.width
    const v = (p.worldY - rect.y) / rect.height
    const x = Math.floor(u * this.wheelCanvas.width)
    const y = Math.floor(v * this.wheelCanvas.height)
    const px = this.wheelCanvas.getContext('2d')!.getImageData(x, y, 1, 1).data
    if (px[3] === 0) return
    const color = (px[0] << 16) | (px[1] << 8) | px[2]
    if (this.activeTarget === 'body') this.bodyColorValue = color; else this.hairColorValue = color
    this.syncUI()
  }

  private saveAndStart(): void {
    const appearance: Appearance = { hair: HAIRS[this.iHair], bodyColor: this.bodyColorValue, hairColor: this.hairColorValue, outfit: OUTFITS[this.iOutfit] }
    const name = this.nameValue.trim() || 'Mike'
    saveNew(appearance, name)
    this.scene.start('MainScene', { safeMode: true })
  }
}
