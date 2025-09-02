import Phaser from 'phaser'
import { SaveSelectScene } from './scenes/SaveSelectScene'
import { CharacterBuilderScene } from './scenes/CharacterBuilderScene'
import { MainScene } from './scenes/MainScene'

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: 'app',
  backgroundColor: '#161d25',
  pixelArt: true,
  antialias: false,
  render: {
    clearBeforeRender: true,
    roundPixels: true,
    antialias: false,
    pixelArt: true
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH
  },
  fps: { target: 60, forceSetTimeOut: false },
  scene: [SaveSelectScene, CharacterBuilderScene, MainScene]
}

export const game = new Phaser.Game(config)

