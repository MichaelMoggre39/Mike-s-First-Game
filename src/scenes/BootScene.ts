import Phaser from 'phaser'
import { hasSave } from '../state/save'

export class BootScene extends Phaser.Scene {
  constructor() {
    super('BootScene')
  }

  create(): void {
    const tryFS = () => { if (!this.scale.isFullscreen) { try { this.scale.startFullscreen() } catch {} } }
    // Go fullscreen on first user gesture anywhere (canvas or window)
    this.input.once('pointerdown', tryFS)
    window.addEventListener('pointerdown', tryFS, { once: true })
    window.addEventListener('keydown', tryFS, { once: true })

    // Small delay to ensure Phaser input is ready before switching scenes
    this.time.delayedCall(10, () => {
      this.scene.launch('SaveSelectScene')
      this.scene.stop()
    })
  }
}
