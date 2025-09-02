import Phaser from 'phaser'
import { loadSave, getDefaultAppearance, type Appearance, getCurrentSlotId, loadSlot, saveSlot, type SaveData } from '../state/save'

// Lightweight typed aliases for common entities
interface Bullet { g: Phaser.GameObjects.Arc; vx: number; vy: number; life: number; pierce: number }
interface Enemy { g: Phaser.GameObjects.Arc; speed: number }

const DASH_SPEED = 1400 // px/s — snappy/powerful feel
const COOLDOWN_MS = 0 // ms — no cooldown for maximum control
const PLAYER_RADIUS = 16

// Combat prototype constants (Level 1)
const BULLET_SPEED = 1100
const BULLET_RADIUS = 4
const BULLET_LIFETIME_MS = 900
const FIRE_COOLDOWN_MS = 90 // ms, cap very-fast spam to avoid stacked start frames
const BULLET_SPAWN_OFFSET = PLAYER_RADIUS + BULLET_RADIUS + 2
const ENEMY_RADIUS = 14
const ENEMY_SPEED = 110
const ENEMY_SPAWN_INTERVAL_MS = 1400
const PLAYER_MAX_HP = 5
const ENEMY_DAMAGE = 1
const LEVEL1_SPAWN_BUDGET = 12

export class MainScene extends Phaser.Scene {
  private player!: Phaser.GameObjects.Container
  private playerBody!: Phaser.GameObjects.Arc
  private head?: Phaser.GameObjects.Arc
  private bodyG?: Phaser.GameObjects.Graphics
  private hairG?: Phaser.GameObjects.Graphics
  private outfitG?: Phaser.GameObjects.Graphics
  private canDash = true
  private dashing = false
  private dashTween?: Phaser.Tweens.Tween

  private bullets: Bullet[] = []
  private enemies: Enemy[] = []
  private bulletArcPool: Phaser.GameObjects.Arc[] = []
  private enemyArcPool: Phaser.GameObjects.Arc[] = []
  private invulnerable = false
  private playerColor = 0x00d9ff
  private lastAimX = 1
  private lastAimY = 0
  private lastShotAt = -Infinity
  private appearance!: Appearance
  private safeMode = false
  private slotId: string | null = null
  private saveData?: SaveData
  private upgradesCache: { maxHp: number; bulletSpeedPct: number; dashSpeedPct: number; fireRatePct: number; pierce: number; healOnClear: number } = { maxHp: 0, bulletSpeedPct: 0, dashSpeedPct: 0, fireRatePct: 0, pierce: 0, healOnClear: 0 }
  private dashSpeedCache = DASH_SPEED
  private bulletSpeedCache = BULLET_SPEED
  private fireCooldownMsCache = FIRE_COOLDOWN_MS

  // Safe room objects
  private portal?: Phaser.GameObjects.Container
  private portalRadius = 34
  private terminal?: Phaser.GameObjects.Container
  private terminalRadius = 36
  private panel?: Phaser.GameObjects.Container
  private panelOpen = false
  private dummies: Array<{ g: Phaser.GameObjects.Container; hp: number; maxHp: number; x: number; y: number }> = []
  private bed?: Phaser.GameObjects.Container
  private roomMargin = 64
  private vaultLayer?: Phaser.GameObjects.Graphics
  private wallThickness = 12
  private gridSize = 32
  private doorCenterY = 0
  private doorHeight = 160
  private bedSize = { w: 90, h: 40 }
  private terminalSize = { w: 56, h: 42 }
  private dummyColliderRadius = 18
  private portalSlack = 6

  // Dev/Debug
  private devUI?: Phaser.GameObjects.Container
  private debugG?: Phaser.GameObjects.Graphics
  private debugText?: Phaser.GameObjects.Text
  private showDebug = false
  private showPath = false
  private uiStyle: Phaser.Types.GameObjects.Text.TextStyle = { fontSize: '16px', fontFamily: 'monospace', color: '#cbd5e1' }
  private lastClick: { x: number; y: number; button: number } = { x: 0, y: 0, button: -1 }
  private keyShift?: Phaser.Input.Keyboard.Key

  // Simple nav-grid for Safe Room pathing
  private grid?: { originX: number; originY: number; cols: number; rows: number; cell: number; block: Uint8Array }
  private plannedPath: Array<{ x: number; y: number }> = []
  private route: Array<{ x: number; y: number }> = []
  private routeIndex = 0
  private routeStartTime = 0
  private routeStartX = 0
  private routeStartY = 0
  private smartGoal?: { x: number; y: number }
  private smartSteps = 0
  private smartMaxSteps = 24

  // HUD & level state
  private hp = PLAYER_MAX_HP
  private hpText!: Phaser.GameObjects.Text
  private level = 1
  private levelText!: Phaser.GameObjects.Text
  private remainingText!: Phaser.GameObjects.Text
  private statusText!: Phaser.GameObjects.Text
  private spawnTimer?: Phaser.Time.TimerEvent
  private spawnBudget = 0
  private spawnedCount = 0
  private isLevelActive = false
  private awaitingNext = false
  private gameOver = false

  constructor() {
    super('MainScene')
  }

  init(data: { safeMode?: boolean } = {}): void {
    this.safeMode = !!data.safeMode
  }

  create(): void {
    const { width, height } = this.scale

    // Load appearance
    this.appearance = loadSave()?.appearance ?? getDefaultAppearance()
    this.playerColor = this.appearance.bodyColor

    // Centered player container with body + appearance layers
    this.player = this.add.container(width / 2, height / 2)
    this.playerBody = this.add.circle(0, 0, PLAYER_RADIUS, this.playerColor)
    // Keep base circle invisible; used for simple hit flash if desired
    this.playerBody.setAlpha(0)
    this.player.add(this.playerBody)
    this.rebuildAppearanceLayers()

    // Allow right-click without browser menu
    this.input.mouse?.disableContextMenu()
    // Replace any existing pointerdown listeners with a robust handler
    this.input.removeAllListeners('pointerdown')
    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.isInputLocked()) return
      if (!this.scale.isFullscreen) { try { this.scale.startFullscreen() } catch {} }
      if (this.gameOver || this.awaitingNext) return
      const bx = pointer.worldX, by = pointer.worldY
      this.lastClick = { x: bx, y: by, button: pointer.button }
      const shift = !!(this.keyShift?.isDown || ((pointer.event as any)?.shiftKey))
      if (pointer.button === 2 || pointer.rightButtonDown()) {
        this.fireBullet(bx, by)
      } else {
        // Show planned path again for debug/preview, even though movement uses direct dash for reliability
        if (this.safeMode) {
          const sx = this.player.x, sy = this.player.y
          const path = this.findPath(sx, sy, bx, by)
          this.plannedPath = path || []
          this.refreshDebug()
        }
        if (shift) this.directDash(bx, by)
        else this.tryDash(bx, by)
      }
    })

    // (duplicate pointerdown handler removed)

    // F toggles fullscreen on/off
    this.input.keyboard?.on('keydown-F', () => {
      if (this.isInputLocked()) return
      if (this.scale.isFullscreen) {
        this.scale.stopFullscreen()
      } else {
        this.scale.startFullscreen()
      }
    })
    // F6 opens Save Select from anywhere (dev convenience)
    this.input.keyboard?.on('keydown-F6', () => {
      if (this.isInputLocked()) return
      this.scene.start('SaveSelectScene')
    })
    // Track Shift for direct-dash override
    this.keyShift = this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SHIFT)

    // N advances to next level when ready
    this.input.keyboard?.on('keydown-N', () => {
      if (this.isInputLocked()) return
      if (this.awaitingNext && !this.gameOver) {
        this.startLevel(this.level + 1)
      }
    })

    // R restarts after game over
    this.input.keyboard?.on('keydown-R', () => {
      if (this.isInputLocked()) return
      if (this.gameOver) {
        this.restartGame()
      }
    })

    // Update camera bounds on resize (no scrolling for now)
    this.scale.on('resize', () => {
      this.cameras.main.setBounds(0, 0, this.scale.width, this.scale.height)
      // Keep player fully visible after any resize
      this.clampPlayerToScreen()
      // Re-layout safe room props if present
      this.layoutSafeRoom()
      this.drawVaultRoom()
      this.buildNavGrid()
      this.refreshDebug()
    })

    // Set camera bounds to current view (no scrolling for now)
    this.cameras.main.setBounds(0, 0, this.scale.width, this.scale.height)
    this.cameras.main.roundPixels = true
    this.cameras.main.setBackgroundColor(0x161d25)

    // HUD
    const style = this.uiStyle
    this.hpText = this.add.text(12, 12, '', style).setDepth(10)
    this.levelText = this.add.text(12, 32, '', style).setDepth(10)
    this.remainingText = this.add.text(12, 52, '', style).setDepth(10)
    this.statusText = this.add.text(this.scale.width / 2, 80, '', { ...style, fontSize: '20px' }).setOrigin(0.5, 0).setDepth(10)
    // Debug text is created on-demand by toggleDebug()
    if (this.showDebug) {
      this.debugText = this.add.text(12, 96, '', { fontSize: '12px', fontFamily: 'monospace', color: '#94a3b8' }).setDepth(50)
    }

    if (this.safeMode) {
      // Load save for meta progression
      this.slotId = getCurrentSlotId()
      if (this.slotId) this.saveData = loadSlot(this.slotId) ?? undefined
      this.refreshUpgrades()
      this.setupSafeRoom()
      // Hide HUD in safe room
      this.hpText.setVisible(false)
      this.levelText.setVisible(false)
      this.remainingText.setVisible(false)
      this.statusText.setVisible(false)
      this.updateHud()
      this.installDevShortcuts()
    } else {
      // Start Level 1
      this.refreshUpgrades()
      this.startLevel(1)
    }

    // Global debug toggle for both modes
    this.input.keyboard?.on('keydown-F3', () => this.toggleDebug())
  }

  private tryDash(targetX: number, targetY: number): void {
    if (this.isInputLocked()) return
    // Reliable move regardless of any stale state
    if (this.safeMode) {
      this.resetDashState()
    } else if (!this.dashing && !this.canDash) {
      return
    }

    // Keep the circle fully visible: clamp center inside screen by radius
    const { x: finalX, y: finalY } = this.clampToScreen(targetX, targetY)

    // In Safe Room: plan and follow a smart route with solid fallback
    if (this.safeMode) {
      this.startSmartMove(finalX, finalY)
      return
    }

    const startX = this.player.x
    const startY = this.player.y
    const dashDist = Math.hypot(finalX - startX, finalY - startY)
    if (dashDist < 0.5) return // already at spot

    const duration = Math.max(40, (dashDist / this.getDashSpeed()) * 1000) // ms

    // Cancel any existing dash tween; latest click has priority
    this.dashTween?.stop()

    this.canDash = false
    this.dashing = true
    // In safe room, plan a path around obstacles first
    if (this.safeMode) {
      const path = this.findPath(startX, startY, finalX, finalY)
      if (path && path.length > 1) {
        this.plannedPath = path
        this.refreshDebug()
        this.route = path
        this.routeIndex = 0
        // Stop any existing tween just in case
        this.dashTween?.stop(); this.dashTween = undefined
        return
      }
    }
    // Fallback: Try glide dash (slide along first obstacle)
    if (this.safeMode && this.tryGlideDash(startX, startY, finalX, finalY, duration)) return

    this.dashTween = this.tweens.add({
      targets: this.player,
      x: finalX,
      y: finalY,
      duration,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.dashing = false
        if (COOLDOWN_MS > 0) {
          this.time.delayedCall(COOLDOWN_MS, () => { this.canDash = true })
        } else {
          this.canDash = true
        }
      }
    })
  }

  private fireBullet(targetX: number, targetY: number): void {
    // Simple fire-rate cap to avoid overlap near the player when clicking extremely fast
    if (this.isInputLocked()) return
    if (this.time.now - this.lastShotAt < this.getFireCooldownMs()) return
    const x = this.player.x
    const y = this.player.y
    const dx = targetX - x
    const dy = targetY - y
    const dist = Math.hypot(dx, dy)
    // Use last aim if the click is exactly on the player
    const nx = dist > 0.0001 ? dx / dist : this.lastAimX
    const ny = dist > 0.0001 ? dy / dist : this.lastAimY
    if (dist > 0.0001) {
      this.lastAimX = nx
      this.lastAimY = ny
    }
    const startX = x + nx * BULLET_SPAWN_OFFSET
    const startY = y + ny * BULLET_SPAWN_OFFSET
    const bs = this.getBulletSpeed()
    const vx = nx * bs
    const vy = ny * bs
    // Single solid pellet (no outline to avoid any visual afterimage)
    const g = this.acquireBulletArc()
    g.setPosition(startX, startY)
    g.setBlendMode(Phaser.BlendModes.NORMAL)
    this.bullets.push({ g, vx, vy, life: BULLET_LIFETIME_MS, pierce: this.getPierce() })
    this.lastShotAt = this.time.now
  }

  private spawnEnemy(): void {
    const { width, height } = this.scale
    // Spawn along edges
    const side = Math.floor(Math.random() * 4) // 0:top,1:bottom,2:left,3:right
    let x = 0, y = 0
    if (side === 0) { // top
      x = Phaser.Math.Between(ENEMY_RADIUS, width - ENEMY_RADIUS)
      y = ENEMY_RADIUS
    } else if (side === 1) { // bottom
      x = Phaser.Math.Between(ENEMY_RADIUS, width - ENEMY_RADIUS)
      y = height - ENEMY_RADIUS
    } else if (side === 2) { // left
      x = ENEMY_RADIUS
      y = Phaser.Math.Between(ENEMY_RADIUS, height - ENEMY_RADIUS)
    } else { // right
      x = width - ENEMY_RADIUS
      y = Phaser.Math.Between(ENEMY_RADIUS, height - ENEMY_RADIUS)
    }
    const g = this.acquireEnemyArc()
    g.setPosition(x, y)
    this.enemies.push({ g, speed: ENEMY_SPEED })
  }

  // ===== Pools =====
  private acquireBulletArc(): Phaser.GameObjects.Arc {
    const arc = this.bulletArcPool.pop()
    if (arc) { arc.setVisible(true).setActive(true); arc.setRadius(BULLET_RADIUS); arc.setFillStyle(0xffc857, 1); return arc }
    return this.add.circle(0, 0, BULLET_RADIUS, 0xffc857)
  }

  private releaseBulletArc(arc: Phaser.GameObjects.Arc): void {
    arc.setVisible(false).setActive(false)
    this.bulletArcPool.push(arc)
  }

  private acquireEnemyArc(): Phaser.GameObjects.Arc {
    const arc = this.enemyArcPool.pop()
    if (arc) {
      arc.setVisible(true).setActive(true)
      arc.setRadius(ENEMY_RADIUS)
      arc.setFillStyle(0xff5a5a, 1)
      arc.setStrokeStyle(2, 0x8b2a2a, 0.9)
      return arc
    }
    const g = this.add.circle(0, 0, ENEMY_RADIUS, 0xff5a5a)
    g.setStrokeStyle(2, 0x8b2a2a, 0.9)
    return g
  }

  private releaseEnemyArc(arc: Phaser.GameObjects.Arc): void {
    arc.setVisible(false).setActive(false)
    this.enemyArcPool.push(arc)
  }

  private onPlayerHit(): void {
    if (this.invulnerable || this.gameOver) return
    this.invulnerable = true
    // Damage and feedback
    this.hp = Math.max(0, this.hp - ENEMY_DAMAGE)
    this.updateHud()
    this.playerBody.setFillStyle(0xff3b3b)
    this.cameras.main.shake(80, 0.002)
    this.time.delayedCall(140, () => this.playerBody.setFillStyle(this.playerColor))
    if (this.hp <= 0) {
      this.gameOverSequence()
    } else {
      // Brief i-frames to prevent instant re-hit
      this.time.delayedCall(550, () => { this.invulnerable = false })
    }
  }

  update(_time: number, delta: number): void {
    const dt = delta / 1000

    // Update bullets
    for (const b of this.bullets) {
      b.g.x += b.vx * dt
      b.g.y += b.vy * dt
      b.life -= delta
    }

    // Cull bullets
    const w = this.scale.width
    const h = this.scale.height
    this.bullets = this.bullets.filter(b => {
      const onScreen = b.g.x >= -20 && b.g.x <= w + 20 && b.g.y >= -20 && b.g.y <= h + 20
      const alive = b.life > 0 && onScreen
      if (!alive) this.releaseBulletArc(b.g)
      return alive
    })

    // Enemies chase player
    for (const e of this.enemies) {
      const dx = this.player.x - e.g.x
      const dy = this.player.y - e.g.y
      const dist = Math.hypot(dx, dy) || 1
      const nx = dx / dist
      const ny = dy / dist
      e.g.x += nx * e.speed * dt
      e.g.y += ny * e.speed * dt
      // Keep fully on screen
      const clamped = this.clampToScreen(e.g.x, e.g.y, ENEMY_RADIUS)
      e.g.setPosition(clamped.x, clamped.y)
    }

    // Bullet-enemy collisions
    const deadEnemies = new Set<number>()
    const deadBullets = new Set<number>()
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i]
      for (let j = 0; j < this.enemies.length; j++) {
        if (deadEnemies.has(j)) continue
        const e = this.enemies[j]
        const dx = e.g.x - b.g.x
        const dy = e.g.y - b.g.y
        const r = ENEMY_RADIUS + BULLET_RADIUS
        if (dx * dx + dy * dy <= r * r) {
          // Hit
          deadEnemies.add(j)
          if (b.pierce > 0) {
            b.pierce -= 1
          } else {
            deadBullets.add(i)
          }
        }
      }
    }
    // Apply deaths
    if (deadEnemies.size > 0 || deadBullets.size > 0) {
      for (let i = this.enemies.length - 1; i >= 0; i--) {
        if (deadEnemies.has(i)) { this.releaseEnemyArc(this.enemies[i].g); this.enemies.splice(i, 1) }
      }
      for (let i = this.bullets.length - 1; i >= 0; i--) {
        if (deadBullets.has(i)) { this.releaseBulletArc(this.bullets[i].g); this.bullets.splice(i, 1) }
      }
      this.updateHud()
    }

    // Enemy-player contact damage
    if (!this.invulnerable) {
      for (const e of this.enemies) {
        const dx = e.g.x - this.player.x
        const dy = e.g.y - this.player.y
        const r = ENEMY_RADIUS + PLAYER_RADIUS
        if (dx * dx + dy * dy <= r * r) {
          this.onPlayerHit()
          break
        }
      }
    }

    // Check level completion
    if (this.isLevelActive && this.spawnedCount >= this.spawnBudget && this.enemies.length === 0) {
      this.endLevel()
    }

    // Dummy-bullet collisions (safe room only)
    if (this.safeMode && this.dummies.length > 0) {
      const deadBullets = new Set<number>()
      for (let i = 0; i < this.bullets.length; i++) {
        const b = this.bullets[i]
        for (const d of this.dummies) {
          const dx = d.g.x - b.g.x
          const dy = d.g.y - b.g.y
          const r = 18 + 4
          if (dx * dx + dy * dy <= r * r) {
            if (b.pierce > 0) {
              b.pierce -= 1
            } else {
              deadBullets.add(i)
            }
            this.damageDummy(d, 1)
            break
          }
        }
      }
      if (deadBullets.size > 0) {
        for (let i = this.bullets.length - 1; i >= 0; i--) { if (deadBullets.has(i)) { this.releaseBulletArc(this.bullets[i].g); this.bullets.splice(i, 1) } }
      }
    }

    // Safe room interactions and nav following
    if (this.safeMode) {
      this.updateSafeRoom()
      // Gentle separation from obstacles to avoid getting stuck
      const sep = this.resolveOverlap(this.player.x, this.player.y)
      if (sep.moved) this.player.setPosition(sep.x, sep.y)
    }

    if (this.safeMode && this.route.length > 0) {
      this.followRouteStep(delta)
    }

    // Debug HUD update
    if (this.debugText) {
      const tweenState = this.dashTween ? ((this.dashTween as any).isPlaying ? 'playing' : 'stopped') : 'none'
      const tprog = this.dashTween ? (Math.round(((this.dashTween as any).totalProgress || 0) * 100)) : 0
      const pathLen = this.plannedPath ? this.plannedPath.length : 0
      const gridInfo = this.grid ? `${this.grid.cols}x${this.grid.rows}@${this.grid.cell}` : 'none'
      this.debugText.setText(
        `safe:${this.safeMode} dashing:${this.dashing} can:${this.canDash}\n`+
        `player: (${this.player.x.toFixed(1)}, ${this.player.y.toFixed(1)})\n`+
        `lastClick: (${this.lastClick.x.toFixed(1)}, ${this.lastClick.y.toFixed(1)}) b=${this.lastClick.button}\n`+
        `tween:${tweenState} prog:${tprog}% path:${pathLen} grid:${gridInfo}`
      )
    }
  }

  private clampPlayerToScreen(): void {
    const { x, y } = this.clampToScreen(this.player.x, this.player.y)
    this.player.setPosition(x, y)
  }

  private clampToScreen(x: number, y: number, radius: number = PLAYER_RADIUS): { x: number; y: number } {
    const b = this.getClampBounds(radius)
    return { x: Phaser.Math.Clamp(x, b.minX, b.maxX), y: Phaser.Math.Clamp(y, b.minY, b.maxY) }
  }

  private getClampBounds(radius: number) {
    if (this.safeMode) {
      const minX = this.roomMargin + radius
      const minY = this.roomMargin + radius
      const maxX = this.scale.width - this.roomMargin - radius
      const maxY = this.scale.height - this.roomMargin - radius
      return { minX, minY, maxX, maxY }
    }
    const minX = radius
    const minY = radius
    const maxX = Math.max(radius, this.scale.width - radius)
    const maxY = Math.max(radius, this.scale.height - radius)
    return { minX, minY, maxX, maxY }
  }

  private startLevel(lvl: number): void {
    // Reset any previous timer
    this.spawnTimer?.remove(false)
    this.level = lvl
    this.isLevelActive = true
    this.awaitingNext = false
    this.statusText.setText('')

    // Level-specific setup (simple ramp; tweak as you prefer)
    this.spawnBudget = lvl === 1 ? LEVEL1_SPAWN_BUDGET : LEVEL1_SPAWN_BUDGET + (lvl - 1) * 4
    this.spawnedCount = 0

    // Clear remaining enemies/bullets from prior level
    this.clearEntities()

    // Center player and clamp
    this.player.setPosition(this.scale.width / 2, this.scale.height / 2)
    this.clampPlayerToScreen()
    // Ensure HP respects upgrades when a level starts
    this.hp = Math.min(this.hp, this.maxHp())

    // Spawn loop that respects budget
    this.spawnTimer = this.time.addEvent({
      delay: ENEMY_SPAWN_INTERVAL_MS,
      loop: true,
      callback: () => {
        if (!this.isLevelActive) return
        if (this.spawnedCount < this.spawnBudget) {
          this.spawnEnemy()
          this.spawnedCount++
          this.updateHud()
        }
      }
    })

    this.updateHud()
  }

  private endLevel(): void {
    this.isLevelActive = false
    this.awaitingNext = true
    // Heal on clear if upgrade purchased
    const heal = this.getUpgrades().healOnClear || 0
    if (heal > 0) this.hp = Math.min(this.maxHp(), this.hp + heal)
    this.updateHud()
    this.statusText.setText(`Level ${this.level} complete! Press N for next`) 
  }

  private updateHud(): void {
    this.hpText.setText(`HP: ${this.hp}/${this.maxHp()}`)
    this.levelText.setText(`Level: ${this.level}`)
    const remaining = Math.max(0, this.spawnBudget - this.spawnedCount) + this.enemies.length
    this.remainingText.setText(`Enemies left: ${remaining}`)
  }

  private gameOverSequence(): void {
    this.gameOver = true
    this.isLevelActive = false
    this.awaitingNext = false
    this.spawnTimer?.remove(false)
    // Brief feedback, then return to Safe Room
    this.cameras.main.shake(120, 0.004)
    this.time.delayedCall(250, () => this.goToSafeRoom())
  }

  private restartGame(): void {
    // Restart sends you to the Safe Room as well
    this.goToSafeRoom()
  }

  private goToSafeRoom(): void {
    // Clear combat state
    this.spawnTimer?.remove(false)
    this.clearEntities()
    this.plannedPath = []
    this.route = []
    this.routeIndex = 0
    this.resetDashState()
    this.isLevelActive = false
    this.awaitingNext = false
    this.gameOver = false
    this.invulnerable = false
    // Restore HP and body color feedback
    this.hp = this.maxHp()
    this.playerBody.setFillStyle(this.playerColor)
    this.statusText.setText('')

    // Switch to Safe Room mode
    this.safeMode = true

    // Hide HUD in safe room
    this.hpText.setVisible(false)
    this.levelText.setVisible(false)
    this.remainingText.setVisible(false)
    this.statusText.setVisible(false)

    // Build Safe Room afresh
    this.setupSafeRoom()
    this.updateHud()
  }

  private clearEntities(): void {
    this.clearEnemies(); this.clearBullets()
  }
  private clearEnemies(): void {
    for (const e of this.enemies) this.releaseEnemyArc(e.g)
    this.enemies = []
  }
  private clearBullets(): void {
    for (const b of this.bullets) this.releaseBulletArc(b.g)
    this.bullets = []
  }

  private rebuildAppearanceLayers(): void {
    // Clear old layers
    this.hairG?.destroy(); this.hairG = undefined
    this.outfitG?.destroy(); this.outfitG = undefined
    this.head?.destroy(); this.head = undefined
    this.bodyG?.destroy(); this.bodyG = undefined

    // Top-down body: head + torso + arms within a 32px circle footprint
    this.head = this.add.circle(0, -8, 7, this.appearance.bodyColor)
    this.player.add(this.head)

    const g = this.add.graphics()
    g.fillStyle(this.appearance.bodyColor, 1)
    // Torso
    g.fillRoundedRect(-11, -2, 22, 18, 6)
    // Arms
    g.fillRoundedRect(-13, -4, 6, 14, 3)
    g.fillRoundedRect(7, -4, 6, 14, 3)
    this.player.add(g)
    this.bodyG = g

    // Hair overlay
    if (this.appearance.hair !== 'none') {
      const hg = this.add.graphics()
      hg.fillStyle(this.appearance.hairColor, 1)
      if (this.appearance.hair === 'spike') {
        hg.fillTriangle(-10, -12, -4, -16, 2, -12)
        hg.fillTriangle(-2, -12, 4, -16, 10, -12)
      } else if (this.appearance.hair === 'bob') {
        hg.fillRoundedRect(-14, -16, 28, 8, { tl: 6, tr: 6, bl: 0, br: 0 })
      }
      this.player.add(hg)
      this.hairG = hg
    }

    // Outfit overlay on torso region
    const og = this.add.graphics()
    og.fillStyle(0x9097a5, 1)
    if (this.appearance.outfit === 'suit') {
      og.fillRect(-11, 6, 22, 6)
    } else if (this.appearance.outfit === 'robe') {
      og.fillRoundedRect(-12, 1, 24, 16, 6)
    } else if (this.appearance.outfit === 'armor') {
      og.fillTriangle(-10, 6, 10, 6, 0, 16)
    }
    this.player.add(og)
    this.outfitG = og
  }

  // ===== Safe Room =====
  private setupSafeRoom(): void {
    // Portal (animated rings) — positioned by layout
    const portal = this.add.container(0, 0)
    const r1 = this.add.circle(0, 0, this.portalRadius, 0x72e8ff, 0.3)
    const r2 = this.add.circle(0, 0, this.portalRadius - 8, 0x72e8ff, 0.2)
    const core = this.add.circle(0, 0, 6, 0xffffff, 0.8)
    portal.add([r1, r2, core])
    this.tweens.add({ targets: r1, scale: 1.15, yoyo: true, duration: 900, repeat: -1, ease: 'Sine.inOut' })
    this.tweens.add({ targets: r2, scale: 0.88, yoyo: true, duration: 800, repeat: -1, ease: 'Sine.inOut' })
    this.portal = portal

    // Bed + Upgrade terminal (next to the bed)
    const bed = this.add.container(0, 0)
    const bedBase = this.add.rectangle(0, 0, 90, 40, 0x2b3440, 1).setStrokeStyle(2, 0x475569)
    const mattress = this.add.rectangle(0, 0, 84, 34, 0xbcd0e4, 1)
    const pillow = this.add.rectangle(-24, -10, 24, 14, 0xe2e8f0, 1)
    bed.add([bedBase, mattress, pillow])
    this.bed = bed

    const terminal = this.add.container(0, 0)
    const base = this.add.rectangle(0, 0, 56, 42, 0x202b36, 0.9).setStrokeStyle(2, 0x334155)
    const screen = this.add.rectangle(0, -6, 40, 16, 0x1e293b, 1).setStrokeStyle(1, 0x3b82f6)
    const light = this.add.circle(0, 12, 4, 0x22c55e, 0.9)
    terminal.add([base, screen, light])
    this.tweens.add({ targets: light, alpha: 0.4, yoyo: true, duration: 900, repeat: -1, ease: 'Sine.inOut' })
    this.terminal = terminal

    // Training dummies (spawn arbitrary; layout will line them up)
    for (let i = 0; i < 3; i++) this.spawnDummy(0, 0)

    // Final layout pass for all
    this.layoutSafeRoom()
    this.drawVaultRoom()
    this.buildNavGrid()

    // Place player at a guaranteed free spot near the bed (not touching terminal)
    this.ensureSafeSpawn()
  }

  private updateSafeRoom(): void {
    // Portal overlap → start level 1
    if (this.portal) {
      // Trigger when player's circle overlaps a thin rectangle at the door gap
      const b = this.getClampBounds(PLAYER_RADIUS)
      const doorX = b.maxX
      const rx = doorX - 8
      const ry = this.doorCenterY - this.doorHeight / 2 - this.portalSlack
      const rw = 16
      const rh = this.doorHeight + this.portalSlack * 2
      const circle = new Phaser.Geom.Circle(this.player.x, this.player.y, PLAYER_RADIUS)
      const rect = new Phaser.Geom.Rectangle(rx, ry, rw, rh)
      if (Phaser.Geom.Intersects.CircleToRectangle(circle, rect)) {
        this.safeMode = false
        this.portal.destroy(); this.portal = undefined
        this.terminal?.destroy(); this.terminal = undefined
        if (this.bed) { this.bed.destroy(); this.bed = undefined }
        for (const d of this.dummies) d.g.destroy(); this.dummies = []
        this.vaultLayer?.destroy(); this.vaultLayer = undefined
        // Show HUD
        this.hpText.setVisible(true)
        this.levelText.setVisible(true)
        this.remainingText.setVisible(true)
        this.statusText.setVisible(true)
        this.startLevel(1)
        return
      }
    }
    // Terminal proximity → open panel
    if (!this.panelOpen && this.terminal) {
      const dx = this.player.x - this.terminal.x
      const dy = this.player.y - this.terminal.y
      if (dx * dx + dy * dy <= (this.terminalRadius + PLAYER_RADIUS) * (this.terminalRadius + PLAYER_RADIUS)) {
        this.openMetaPanel()
      }
    }
  }

  private spawnDummy(x: number, y: number): void {
    const cont = this.add.container(x, y)
    const body = this.add.circle(0, 0, 18, 0xcccccc, 1).setStrokeStyle(2, 0x94a3b8)
    const hpBarBg = this.add.rectangle(0, -26, 28, 5, 0x334155).setOrigin(0.5)
    const hpBar = this.add.rectangle(0, -26, 28, 5, 0x22c55e).setOrigin(0.5)
    cont.add([body, hpBarBg, hpBar])
    const dummy = { g: cont, hp: 3, maxHp: 3, x, y }
    this.dummies.push(dummy)
    // Save reference to hpBar width update via data
    ;(cont as any)._hpBar = hpBar
  }

  private damageDummy(d: { g: Phaser.GameObjects.Container; hp: number; maxHp: number; x: number; y: number }, amt: number): void {
    d.hp = Math.max(0, d.hp - amt)
    const bar = (d.g as any)._hpBar as Phaser.GameObjects.Rectangle
    bar.width = (28 * d.hp) / d.maxHp
    if (d.hp <= 0) {
      const x = d.x, y = d.y
      d.g.destroy()
      this.dummies = this.dummies.filter(dd => dd !== d)
      this.time.delayedCall(1200, () => this.spawnDummy(x, y))
    }
  }

  private layoutSafeRoom(): void {
    if (!this.safeMode) return
    const w = this.scale.width
    const h = this.scale.height
    const left = this.roomMargin
    const right = w - this.roomMargin
    const top = this.roomMargin
    const bottom = h - this.roomMargin
    const midY = (top + bottom) / 2

    // Portal on right wall; align with door gap center
    // Keep door metrics in sync with drawVaultRoom()
    const innerH = h - this.roomMargin * 2
    this.doorHeight = Math.min(200, innerH * 0.45)
    this.doorCenterY = midY
    if (this.portal) this.portal.setPosition(right - (this.portalRadius + 8), this.doorCenterY)

    // Bed near left wall, slightly above center; terminal to its right
    if (this.bed) {
      this.bed.setPosition(left + 120, midY - 40)
    }
    if (this.terminal && this.bed) {
      const bedPos = { x: this.bed.x, y: this.bed.y }
      this.terminal.setPosition(bedPos.x + 200, bedPos.y + 6)
    }

    // Line up dummies in bottom-left corner, vertically
    if (this.dummies.length > 0) {
      const startX = left + 120
      const startY = bottom - 80
      const spacing = 48
      this.dummies.forEach((d, i) => {
        const x = startX
        const y = startY - i * spacing
        d.g.setPosition(x, y)
        d.x = x; d.y = y
      })
    }
  }

  private ensureSafeSpawn(): void {
    // Build candidate spots: right of bed (farther than terminal), above bed, then inner-left mid
    const g = this.grid
    const innerLeft = this.roomMargin
    const innerRight = this.scale.width - this.roomMargin
    const innerTop = this.roomMargin
    const innerBottom = this.scale.height - this.roomMargin
    const midY = (innerTop + innerBottom) / 2
    const candidates: Array<{ x: number; y: number }> = []
    if (this.bed) {
      candidates.push({ x: this.bed.x + (this.bedSize.w / 2 + PLAYER_RADIUS + 240), y: this.bed.y + 6 }) // right of bed, beyond terminal
      candidates.push({ x: this.bed.x, y: this.bed.y - (this.bedSize.h / 2 + PLAYER_RADIUS + 48) }) // above bed
    }
    candidates.push({ x: innerLeft + 160, y: midY })
    // Evaluate candidates; pick first free cell
    for (const c of candidates) {
      const cl = this.clampToScreen(c.x, c.y)
      const sep = this.resolveOverlap(cl.x, cl.y)
      const wc = this.worldToCell(sep.x, sep.y)
      if (!wc || !this.grid) { this.player.setPosition(sep.x, sep.y); return }
      const idx = wc.r * this.grid.cols + wc.c
      if (this.grid.block[idx] === 0) {
        this.player.setPosition(sep.x, sep.y)
        return
      }
    }
    // Fallback: place center-left
    this.player.setPosition(innerLeft + 180, midY)
    const sep = this.resolveOverlap(this.player.x, this.player.y)
    this.player.setPosition(sep.x, sep.y)
  }

  private drawVaultRoom(): void {
    if (!this.safeMode) return
    this.vaultLayer?.destroy()
    const g = this.add.graphics().setDepth(-5)
    this.vaultLayer = g
    const w = this.scale.width
    const h = this.scale.height
    const m = this.roomMargin
    const t = this.wallThickness
    const innerX = m
    const innerY = m
    const innerW = w - m * 2
    const innerH = h - m * 2

    // Floor base
    g.fillStyle(0x1a2430, 1)
    g.fillRect(innerX, innerY, innerW, innerH)

    // Subtle grid
    g.lineStyle(1, 0x233041, 0.25)
    for (let x = innerX + this.gridSize; x < innerX + innerW; x += this.gridSize) {
      g.beginPath(); g.moveTo(x + 0.5, innerY); g.lineTo(x + 0.5, innerY + innerH); g.strokePath()
    }
    for (let y = innerY + this.gridSize; y < innerY + innerH; y += this.gridSize) {
      g.beginPath(); g.moveTo(innerX, y + 0.5); g.lineTo(innerX + innerW, y + 0.5); g.strokePath()
    }

    // Walls with door gap on right side
    g.fillStyle(0x233241, 1)
    // Top
    g.fillRect(innerX - t, innerY - t, innerW + t * 2, t)
    // Bottom
    g.fillRect(innerX - t, innerY + innerH, innerW + t * 2, t)
    // Left
    g.fillRect(innerX - t, innerY - t, t, innerH + t * 2)
    // Right with door gap
    const doorH = Math.min(200, innerH * 0.45)
    const doorY = innerY + innerH / 2
    this.doorHeight = doorH
    this.doorCenterY = doorY
    const topSegH = doorY - doorH / 2 - innerY + t
    const botSegY = doorY + doorH / 2
    const botSegH = innerY + innerH - botSegY + t
    g.fillRect(innerX + innerW, innerY - t, t, topSegH)
    g.fillRect(innerX + innerW, botSegY, t, botSegH)

    // Door frame highlight
    g.lineStyle(3, 0x3b82f6, 0.8)
    g.strokeRect(innerX + innerW - 2, doorY - doorH / 2, 4, doorH)

    // Corner braces
    g.fillStyle(0x2a394a, 1)
    const brace = 18
    g.fillRect(innerX - t, innerY - t, brace, t)
    g.fillRect(innerX - t, innerY - t, t, brace)
    g.fillRect(innerX + innerW + t - brace, innerY - t, brace, t)
    g.fillRect(innerX + innerW + t - t, innerY - t, t, brace)
    g.fillRect(innerX - t, innerY + innerH, brace, t)
    g.fillRect(innerX - t, innerY + innerH + t - brace, t, brace)
    g.fillRect(innerX + innerW + t - brace, innerY + innerH, brace, t)
    g.fillRect(innerX + innerW + t - t, innerY + innerH + t - brace, t, brace)
  }

  private segmentHitsObstacle(x1: number, y1: number, x2: number, y2: number): boolean {
    if (!this.safeMode) return false
    const line = new Phaser.Geom.Line(x1, y1, x2, y2)
    // Bed
    if (this.bed && this.lineHitsRectInflated(line, this.bed.x, this.bed.y, this.bedSize.w, this.bedSize.h)) return true
    // Terminal
    if (this.terminal && this.lineHitsRectInflated(line, this.terminal.x, this.terminal.y, this.terminalSize.w, this.terminalSize.h)) return true
    // Dummies
    for (const d of this.dummies) {
      const circle = new Phaser.Geom.Circle(d.x, d.y, this.dummyColliderRadius + PLAYER_RADIUS)
      if (Phaser.Geom.Intersects.LineToCircle(line, circle)) return true
    }
    return false
  }

  private lineHitsRectInflated(line: Phaser.Geom.Line, cx: number, cy: number, w: number, h: number): boolean {
    const rect = new Phaser.Geom.Rectangle(cx - w / 2 - PLAYER_RADIUS, cy - h / 2 - PLAYER_RADIUS, w + PLAYER_RADIUS * 2, h + PLAYER_RADIUS * 2)
    return Phaser.Geom.Intersects.LineToRectangle(line, rect)
  }

  // ===== Nav Grid + Pathfinding (Safe Room) =====
  private buildNavGrid(): void {
    if (!this.safeMode) { this.grid = undefined; return }
    const cell = Math.max(16, Math.min(48, this.gridSize))
    const ox = this.roomMargin
    const oy = this.roomMargin
    const iw = this.scale.width - this.roomMargin * 2
    const ih = this.scale.height - this.roomMargin * 2
    const cols = Math.max(2, Math.floor(iw / cell))
    const rows = Math.max(2, Math.floor(ih / cell))
    const block = new Uint8Array(cols * rows)

    const isBlocked = (wx: number, wy: number): boolean => {
      if (this.bed && this.pointInRectInflated(wx, wy, this.bed.x, this.bed.y, this.bedSize.w, this.bedSize.h)) return true
      if (this.terminal && this.pointInRectInflated(wx, wy, this.terminal.x, this.terminal.y, this.terminalSize.w, this.terminalSize.h)) return true
      for (const d of this.dummies) {
        const R = this.dummyColliderRadius + PLAYER_RADIUS
        if (Phaser.Math.Distance.Between(wx, wy, d.x, d.y) < R) return true
      }
      return false
    }

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const wx = ox + c * cell + cell / 2
        const wy = oy + r * cell + cell / 2
        const idx = r * cols + c
        block[idx] = isBlocked(wx, wy) ? 1 : 0
      }
    }
    this.grid = { originX: ox, originY: oy, cols, rows, cell, block }
  }

  private worldToCell(x: number, y: number): { c: number; r: number } | null {
    if (!this.grid) return null
    const { originX: ox, originY: oy, cols, rows, cell } = this.grid
    const cx = Math.floor((x - ox) / cell)
    const cy = Math.floor((y - oy) / cell)
    if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) return null
    return { c: cx, r: cy }
  }

  private cellToWorld(c: number, r: number): { x: number; y: number } {
    const g = this.grid!
    return { x: g.originX + c * g.cell + g.cell / 2, y: g.originY + r * g.cell + g.cell / 2 }
  }

  private findPath(sx: number, sy: number, tx: number, ty: number): Array<{ x: number; y: number }> | null {
    if (!this.grid) return null
    const g = this.grid
    const start = this.worldToCell(sx, sy)
    let goal = this.worldToCell(tx, ty)
    if (!start || !goal) return null

    const isFree = (c: number, r: number) => g!.block[r * g!.cols + c] === 0
    if (!isFree(goal.c, goal.r)) {
      let found = false
      for (let rad = 1; rad < Math.max(g.cols, g.rows) && !found; rad++) {
        for (let dr = -rad; dr <= rad; dr++) {
          for (let dc = -rad; dc <= rad; dc++) {
            const nc: number = goal.c + dc
            const nr: number = goal.r + dr
            if (nc < 0 || nr < 0 || nc >= g.cols || nr >= g.rows) continue
            if (isFree(nc, nr)) { goal = { c: nc, r: nr }; found = true; break }
          }
          if (found) break
        }
      }
      if (!found) return null
    }

    const cols = g.cols, rows = g.rows
    const open: number[] = []
    const came = new Int32Array(cols * rows).fill(-1)
    const gScore = new Float32Array(cols * rows).fill(Infinity)
    const fScore = new Float32Array(cols * rows).fill(Infinity)

    const idx = (c: number, r: number) => r * cols + c
    const h = (c: number, r: number) => Math.hypot(c - goal.c, r - goal.r)
    const pushOpen = (i: number) => { open.push(i) }
    const popLowest = () => { let bi = 0, bv = Infinity; for (let i = 0; i < open.length; i++) { const id = open[i]; const v = fScore[id]; if (v < bv) { bv = v; bi = i } } const id = open[bi]; open.splice(bi, 1); return id }
    const inOpen = (i: number) => open.indexOf(i) >= 0

    const sIdx = idx(start.c, start.r)
    gScore[sIdx] = 0
    fScore[sIdx] = h(start.c, start.r)
    pushOpen(sIdx)

    const dirs = [ [1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1] ] as const

    while (open.length > 0) {
      const current = popLowest()
      const cr = Math.floor(current / cols)
      const cc = current % cols
      if (cc === goal.c && cr === goal.r) {
        const path: Array<{ x: number; y: number }> = []
        let cur = current
        while (cur !== -1) {
          const r = Math.floor(cur / cols), c = cur % cols
          path.push(this.cellToWorld(c, r))
          cur = came[cur]
        }
        path.reverse()
        return this.smoothPath(path)
      }
      for (const [dc, dr] of dirs) {
        const nc = cc + dc, nr = cr + dr
        if (nc < 0 || nr < 0 || nc >= cols || nr >= rows) continue
        if (g.block[idx(nc, nr)] === 1) continue
        if (dc !== 0 && dr !== 0) { if (g.block[idx(cc + dc, cr)] === 1 || g.block[idx(cc, cr + dr)] === 1) continue }
        const nid = idx(nc, nr)
        const tentative = gScore[current] + Math.hypot(dc, dr)
        if (tentative < gScore[nid]) { came[nid] = current; gScore[nid] = tentative; fScore[nid] = tentative + h(nc, nr); if (!inOpen(nid)) pushOpen(nid) }
      }
    }
    return null
  }

  private smoothPath(path: Array<{ x: number; y: number }>): Array<{ x: number; y: number }> {
    if (path.length <= 2) return path
    const out: Array<{ x: number; y: number }> = [path[0]]
    let i = 0
    while (i < path.length - 1) {
      let j = path.length - 1
      for (; j > i + 1; j--) {
        if (this.segmentClear(out[out.length - 1].x, out[out.length - 1].y, path[j].x, path[j].y)) break
      }
      out.push(path[j])
      i = j
    }
    return out
  }

  private segmentClear(x1: number, y1: number, x2: number, y2: number): boolean {
    return !this.segmentHitsObstacle(x1, y1, x2, y2)
  }

  // ===== Dev UI / Debug =====
  private installDevShortcuts(): void {
    this.input.keyboard?.on('keydown-BACKTICK', () => this.toggleDevUI())
    this.input.keyboard?.on('keydown-P', () => { this.showDebug = !this.showDebug; this.refreshDebug() })
  }

  private toggleDevUI(): void {
    if (this.devUI && this.devUI.active) { this.devUI.destroy(); this.devUI = undefined; return }
    const cx = this.scale.width - 12
    const cy = 12
    const panel = this.add.container(cx, cy).setDepth(50)
    const bg = this.add.rectangle(0, 0, 280, 180, 0x0b1220, 0.92).setOrigin(1, 0).setStrokeStyle(2, 0x334155)
    panel.add(bg)
    const style = { fontFamily: 'monospace', fontSize: '14px', color: '#cbd5e1' as const }
    const addBtn = (y: number, label: string, onClick: () => void) => {
      const t = this.add.text(-8, y, label, style).setOrigin(1, 0).setInteractive({ useHandCursor: true })
      t.on('pointerdown', onClick); panel.add(t); return t
    }
    panel.add(this.add.text(-270, 6, 'Dev Panel (toggle `)', { ...style, fontSize: '16px', color: '#a7f3d0' }).setOrigin(0, 0))
    panel.add(this.add.text(-270, 28, 'P: toggle debug draw', style).setOrigin(0, 0))
    addBtn(50, `portalSlack: ${this.portalSlack}  [+]`, () => { this.portalSlack += 2; this.refreshDebug(); this.toggleDevUI(); this.toggleDevUI() })
    addBtn(72, 'Rebuild nav grid', () => { this.buildNavGrid(); this.refreshDebug() })
    addBtn(94, 'Toggle path preview', () => { this.showPath = !this.showPath; this.refreshDebug() })
    addBtn(116, 'Close', () => { this.toggleDevUI() })
    this.devUI = panel
  }

  private refreshDebug(): void {
    this.debugG?.destroy(); this.debugG = undefined
    if (!this.showDebug || !this.safeMode) return
    const g = this.add.graphics().setDepth(40)
    this.debugG = g
    // Draw door gap
    const m = this.roomMargin
    const innerX = m
    const innerW = this.scale.width - m * 2
    const doorY = this.doorCenterY
    const doorH = this.doorHeight
    g.lineStyle(2, 0x3b82f6, 0.8)
    g.strokeRect(innerX + innerW - 4, doorY - doorH / 2, 8, doorH)
    // Draw colliders
    g.lineStyle(1, 0xf97316, 0.8)
    if (this.bed) g.strokeRect(this.bed.x - this.bedSize.w / 2 - PLAYER_RADIUS, this.bed.y - this.bedSize.h / 2 - PLAYER_RADIUS, this.bedSize.w + PLAYER_RADIUS * 2, this.bedSize.h + PLAYER_RADIUS * 2)
    if (this.terminal) g.strokeRect(this.terminal.x - this.terminalSize.w / 2 - PLAYER_RADIUS, this.terminal.y - this.terminalSize.h / 2 - PLAYER_RADIUS, this.terminalSize.w + PLAYER_RADIUS * 2, this.terminalSize.h + PLAYER_RADIUS * 2)
    for (const d of this.dummies) g.strokeCircle(d.x, d.y, this.dummyColliderRadius + PLAYER_RADIUS)
    // Draw nav grid
    if (this.grid) {
      const gr = this.grid
      g.lineStyle(1, 0x94a3b8, 0.2)
      for (let r = 0; r < gr.rows; r++) {
        for (let c = 0; c < gr.cols; c++) {
          const idx = r * gr.cols + c
          const wx = gr.originX + c * gr.cell
          const wy = gr.originY + r * gr.cell
          g.strokeRect(wx, wy, gr.cell, gr.cell)
          if (gr.block[idx] === 1) { g.fillStyle(0x64748b, 0.2); g.fillRect(wx, wy, gr.cell, gr.cell) }
        }
      }
    }
    // Draw last path
    if (this.showPath && this.plannedPath.length > 1) {
      g.lineStyle(2, 0x22c55e, 0.9)
      g.beginPath(); g.moveTo(this.plannedPath[0].x, this.plannedPath[0].y)
      for (let i = 1; i < this.plannedPath.length; i++) g.lineTo(this.plannedPath[i].x, this.plannedPath[i].y)
      g.strokePath()
      for (const p of this.plannedPath) { g.fillStyle(0x22c55e, 1); g.fillCircle(p.x, p.y, 3) }
    }
  }

  private toggleDebug(force?: boolean): void {
    const enable = force !== undefined ? force : !this.showDebug
    this.showDebug = enable
    this.showPath = enable && this.showPath // keep current preference; default off unless enabled
    if (enable) {
      if (!this.debugText) {
        this.debugText = this.add.text(12, 96, '', { fontSize: '12px', fontFamily: 'monospace', color: '#94a3b8' }).setDepth(50)
      }
      this.refreshDebug()
    } else {
      this.debugG?.destroy(); this.debugG = undefined
      this.debugText?.destroy(); this.debugText = undefined
    }
  }

  private tryGlideDash(sx: number, sy: number, tx: number, ty: number, baseDuration: number): boolean {
    // If starting overlapped (e.g., spawned inside an inflated rect), resolve first
    const startResolved = this.resolveOverlap(sx, sy)
    if (startResolved.moved) {
      sx = startResolved.x; sy = startResolved.y
    }

    const hit = this.raycastFirstObstacle(sx, sy, tx, ty)
    if (!hit) return false

    const eps = 3
    const p1x = hit.x - hit.nx * eps
    const p1y = hit.y - hit.ny * eps

    const vx = tx - sx
    const vy = ty - sy
    const vLen = Math.hypot(vx, vy) || 1
    const dot = (vx * hit.nx + vy * hit.ny) / vLen
    let txv = vx - dot * hit.nx * vLen
    let tyv = vy - dot * hit.ny * vLen
    const tLen = Math.hypot(txv, tyv)
    if (tLen < 1e-3) {
      // No tangential component; just stop at p1
      const seg1 = Math.hypot(p1x - sx, p1y - sy)
      const d1 = Math.max(20, (seg1 / DASH_SPEED) * 1000)
      this.dashTween = this.tweens.add({ targets: this.player, x: p1x, y: p1y, duration: d1, ease: 'Sine.easeOut', onComplete: () => this.onDashEnd() })
      return true
    }
    txv /= tLen; tyv /= tLen
    const totalLen = Math.hypot(tx - sx, ty - sy)
    const seg1Len = Math.hypot(p1x - sx, p1y - sy)
    const rem = Math.max(0, totalLen - seg1Len)
    let p2x = p1x + txv * rem
    let p2y = p1y + tyv * rem
    // Clamp end to room bounds
    const c2 = this.clampToScreen(p2x, p2y)
    p2x = c2.x; p2y = c2.y

    const speed = this.getDashSpeed()
    const d1 = Math.max(20, (seg1Len / speed) * 1000)
    const d2 = Math.max(20, (Math.hypot(p2x - p1x, p2y - p1y) / speed) * 1000)

    const first = this.tweens.add({
      targets: this.player,
      x: p1x,
      y: p1y,
      duration: d1,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.dashTween = this.tweens.add({
          targets: this.player,
          x: p2x,
          y: p2y,
          duration: d2,
          ease: 'Sine.easeOut',
          onComplete: () => this.onDashEnd()
        })
      }
    })
    this.dashTween = first
    return true
  }

  private onDashEnd(): void {
    this.dashing = false
    if (COOLDOWN_MS > 0) {
      this.time.delayedCall(COOLDOWN_MS, () => { this.canDash = true })
    } else {
      this.canDash = true
    }
  }

  private resetDashState(): void {
    this.dashTween?.stop(); this.dashTween = undefined
    this.route = []; this.routeIndex = 0
    this.dashing = false; this.canDash = true
  }

  private dashTo(targetX: number, targetY: number, onDone: () => void): void {
    const { x: fx, y: fy } = this.clampToScreen(targetX, targetY)
    const sx = this.player.x, sy = this.player.y
    const dist = Math.hypot(fx - sx, fy - sy)
    if (dist < 0.5) { onDone(); return }
    const duration = Math.max(40, (dist / this.getDashSpeed()) * 1000)
    this.dashTween?.stop();
    this.dashing = true; this.canDash = false
    if (this.safeMode && this.glideDashTo(sx, sy, fx, fy, duration, onDone)) return
    this.dashTween = this.tweens.add({ targets: this.player, x: fx, y: fy, duration, ease: 'Sine.easeInOut', onComplete: onDone })
  }

  private startSmartMove(tx: number, ty: number): void {
    this.resetDashState()
    this.smartGoal = { x: tx, y: ty }
    this.smartSteps = 0
    // Draw initial planned path for feedback
    this.plannedPath = this.findPath(this.player.x, this.player.y, tx, ty) || []
    this.refreshDebug()
    this.smartFollowNext()
  }

  private smartFollowNext(): void {
    if (!this.smartGoal) { this.onDashEnd(); return }
    if (this.smartSteps++ > this.smartMaxSteps) { this.directDash(this.smartGoal.x, this.smartGoal.y); this.smartGoal = undefined; return }
    const sx = this.player.x, sy = this.player.y
    const path = this.findPath(sx, sy, this.smartGoal.x, this.smartGoal.y)
    this.plannedPath = path || []
    this.refreshDebug()
    if (!path || path.length < 2) { this.directDash(this.smartGoal.x, this.smartGoal.y); this.smartGoal = undefined; return }
    const next = path[1]
    this.route = path; this.routeIndex = 1
    this.dashTo(next.x, next.y, () => this.smartFollowNext())
  }

  private glideDashTo(sx: number, sy: number, tx: number, ty: number, baseDuration: number, onDone: () => void): boolean {
    const hit = this.raycastFirstObstacle(sx, sy, tx, ty)
    if (!hit) return false
    const eps = 1.5
    const p1x = hit.x - hit.nx * eps
    const p1y = hit.y - hit.ny * eps
    const vx = tx - sx
    const vy = ty - sy
    const vLen = Math.hypot(vx, vy) || 1
    const dot = (vx * hit.nx + vy * hit.ny) / vLen
    let txv = vx - dot * hit.nx * vLen
    let tyv = vy - dot * hit.ny * vLen
    const tLen = Math.hypot(txv, tyv)
    if (tLen < 1e-3) {
      const seg1 = Math.hypot(p1x - sx, p1y - sy)
      const d1 = Math.max(20, (seg1 / DASH_SPEED) * 1000)
      this.dashTween = this.tweens.add({ targets: this.player, x: p1x, y: p1y, duration: d1, ease: 'Sine.easeOut', onComplete: onDone })
      return true
    }
    txv /= tLen; tyv /= tLen
    const totalLen = Math.hypot(tx - sx, ty - sy)
    const seg1Len = Math.hypot(p1x - sx, p1y - sy)
    const rem = Math.max(0, totalLen - seg1Len)
    let p2x = p1x + txv * rem
    let p2y = p1y + tyv * rem
    const c2 = this.clampToScreen(p2x, p2y)
    p2x = c2.x; p2y = c2.y
    const d1 = Math.max(20, (seg1Len / DASH_SPEED) * 1000)
    const d2 = Math.max(20, (Math.hypot(p2x - p1x, p2y - p1y) / DASH_SPEED) * 1000)
    const first = this.tweens.add({
      targets: this.player,
      x: p1x,
      y: p1y,
      duration: d1,
      ease: 'Sine.easeOut',
      onComplete: () => {
        this.dashTween = this.tweens.add({
          targets: this.player,
          x: p2x,
          y: p2y,
          duration: d2,
          ease: 'Sine.easeOut',
          onComplete: onDone
        })
      }
    })
    this.dashTween = first
    return true
  }

  private followRouteStep(dtMS: number): void {
    if (this.route.length === 0) return
    const dt = dtMS / 1000
    this.dashing = true
    this.canDash = false
    const speed = this.getDashSpeed()
    let remaining = speed * dt
    let movedThis = 0
    while (remaining > 0 && this.routeIndex < this.route.length) {
      const target = this.route[this.routeIndex]
      const dx = target.x - this.player.x
      const dy = target.y - this.player.y
      const dist = Math.hypot(dx, dy)
      if (dist <= remaining) {
        this.player.setPosition(target.x, target.y)
        this.routeIndex++
        remaining -= dist
        movedThis += dist
      } else {
        const nx = dx / (dist || 1), ny = dy / (dist || 1)
        const step = remaining
        this.player.setPosition(this.player.x + nx * step, this.player.y + ny * step)
        movedThis += step
        remaining = 0
      }
    }
    if (movedThis > 0.5) {
      this.routeStartTime = this.safeNow()
      this.routeStartX = this.player.x
      this.routeStartY = this.player.y
    }
    if (this.routeIndex >= this.route.length) {
      this.route = []
      this.routeIndex = 0
      this.onDashEnd()
    } else {
      // Stall fallback after 300ms with <1px progress
      const moved = Math.hypot(this.player.x - this.routeStartX, this.player.y - this.routeStartY)
      if (this.safeNow() - this.routeStartTime > 300 && moved < 1) {
        const last = this.route[this.route.length - 1]
        this.route = []; this.routeIndex = 0
        this.directDash(last.x, last.y)
      }
    }
  }

  private safeNow(): number {
    try { return this.time ? (this.time as any).now ?? performance.now() : performance.now() } catch { return performance.now() }
  }

  // Force a direct dash tween to a destination (Shift+Left click)
  private directDash(targetX: number, targetY: number): void {
    this.route = []; this.routeIndex = 0
    this.dashTo(targetX, targetY, () => this.onDashEnd())
  }

  private raycastFirstObstacle(sx: number, sy: number, tx: number, ty: number): { x: number; y: number; nx: number; ny: number } | null {
    if (!this.safeMode) return null
    const dx = tx - sx
    const dy = ty - sy
    let bestT = Infinity
    let out: { x: number; y: number; nx: number; ny: number } | null = null

    // Rect helpers
    const testRect = (cx: number, cy: number, w: number, h: number) => {
      const w2 = w / 2 + PLAYER_RADIUS
      const h2 = h / 2 + PLAYER_RADIUS
      const minX = cx - w2, maxX = cx + w2
      const minY = cy - h2, maxY = cy + h2
      const invDx = dx !== 0 ? 1 / dx : Number.POSITIVE_INFINITY
      const invDy = dy !== 0 ? 1 / dy : Number.POSITIVE_INFINITY
      const t1 = (minX - sx) * invDx
      const t2 = (maxX - sx) * invDx
      const t3 = (minY - sy) * invDy
      const t4 = (maxY - sy) * invDy
      const tNearX = Math.min(t1, t2)
      const tFarX = Math.max(t1, t2)
      const tNearY = Math.min(t3, t4)
      const tFarY = Math.max(t3, t4)
      const tNear = Math.max(tNearX, tNearY)
      const tFar = Math.min(tFarX, tFarY)
      if (tFar < 0 || tNear > tFar) return
      const tHit = tNear
      if (tHit <= 0 || tHit >= 1) return
      let nx = 0, ny = 0
      if (tNearX > tNearY) nx = (dx > 0 ? -1 : 1)
      else ny = (dy > 0 ? -1 : 1)
      if (tHit < bestT) { bestT = tHit; out = { x: sx + dx * tHit, y: sy + dy * tHit, nx, ny } }
    }

    // Circle helper
    const testCircle = (cx: number, cy: number, r: number) => {
      const R = r + PLAYER_RADIUS
      const ox = sx - cx
      const oy = sy - cy
      const a = dx * dx + dy * dy
      const b = 2 * (ox * dx + oy * dy)
      const c = ox * ox + oy * oy - R * R
      const disc = b * b - 4 * a * c
      if (disc < 0 || a === 0) return
      const sqrt = Math.sqrt(disc)
      const t0 = (-b - sqrt) / (2 * a)
      const t1 = (-b + sqrt) / (2 * a)
      const tHit = t0 > 0 ? t0 : t1
      if (tHit <= 0 || tHit >= 1) return
      const hx = sx + dx * tHit
      const hy = sy + dy * tHit
      const nx = (hx - cx) / (R || 1)
      const ny = (hy - cy) / (R || 1)
      if (tHit < bestT) { bestT = tHit; out = { x: hx, y: hy, nx, ny } }
    }

    // Bed
    if (this.bed) testRect(this.bed.x, this.bed.y, this.bedSize.w, this.bedSize.h)
    // Terminal
    if (this.terminal) testRect(this.terminal.x, this.terminal.y, this.terminalSize.w, this.terminalSize.h)
    // Dummies
    for (const d of this.dummies) testCircle(d.x, d.y, this.dummyColliderRadius)

    return out
  }

  private resolveOverlap(x: number, y: number): { x: number; y: number; moved: boolean } {
    // Push the point out of any overlapping colliders in the safe room
    if (!this.safeMode) return { x, y, moved: false }
    let px = x, py = y
    let moved = false
    const push = 6
    // Bed
    if (this.bed && this.pointInRectInflated(px, py, this.bed.x, this.bed.y, this.bedSize.w, this.bedSize.h)) {
      const dx = px - this.bed.x
      const dy = py - this.bed.y
      const w2 = this.bedSize.w / 2 + PLAYER_RADIUS
      const h2 = this.bedSize.h / 2 + PLAYER_RADIUS
      const sx = dx >= 0 ? 1 : -1
      const sy = dy >= 0 ? 1 : -1
      if (Math.abs(w2 - Math.abs(dx)) < Math.abs(h2 - Math.abs(dy))) px = this.bed.x + sx * (w2 + push)
      else py = this.bed.y + sy * (h2 + push)
      moved = true
    }
    // Terminal
    if (this.terminal && this.pointInRectInflated(px, py, this.terminal.x, this.terminal.y, this.terminalSize.w, this.terminalSize.h)) {
      const dx = px - this.terminal.x
      const dy = py - this.terminal.y
      const w2 = this.terminalSize.w / 2 + PLAYER_RADIUS
      const h2 = this.terminalSize.h / 2 + PLAYER_RADIUS
      const sx = dx >= 0 ? 1 : -1
      const sy = dy >= 0 ? 1 : -1
      if (Math.abs(w2 - Math.abs(dx)) < Math.abs(h2 - Math.abs(dy))) px = this.terminal.x + sx * (w2 + push)
      else py = this.terminal.y + sy * (h2 + push)
      moved = true
    }
    // Dummies
    for (const d of this.dummies) {
      const R = this.dummyColliderRadius + PLAYER_RADIUS
      const dx = px - d.x
      const dy = py - d.y
      const dist = Math.hypot(dx, dy)
      if (dist < R) {
        const nx = (dx || 1) / (dist || 1)
        const ny = (dy || 0) / (dist || 1)
        px = d.x + nx * (R + push)
        py = d.y + ny * (R + push)
        moved = true
      }
    }
    // Clamp to room
    const c = this.clampToScreen(px, py)
    if (c.x !== px || c.y !== py) moved = true
    return { x: c.x, y: c.y, moved }
  }

  private pointInRectInflated(x: number, y: number, cx: number, cy: number, w: number, h: number): boolean {
    const w2 = w / 2 + PLAYER_RADIUS
    const h2 = h / 2 + PLAYER_RADIUS
    return x >= cx - w2 && x <= cx + w2 && y >= cy - h2 && y <= cy + h2
  }

  private openMetaPanel(): void {
    if (this.panelOpen) return
    const cx = this.scale.width / 2
    const cy = this.scale.height / 2
    const cont = this.add.container(cx, cy).setDepth(20)
    // Dim background scrim
    const scrim = this.add.rectangle(0, 0, this.scale.width, this.scale.height, 0x0b1220, 0.6)
    scrim.setInteractive() // swallow clicks
    const bg = this.add.rectangle(0, 0, Math.min(560, this.scale.width - 80), 360, 0x0b1220, 0.96).setStrokeStyle(2, 0x3b82f6)
    const title = this.add.text(-bg.width / 2 + 16, -bg.height / 2 + 12, 'Upgrade Terminal', { fontFamily: 'monospace', fontSize: '18px', color: '#cbd5e1' })
    const cores = this.add.text(bg.width / 2 - 16, -bg.height / 2 + 12, this.metaText(), { fontFamily: 'monospace', fontSize: '16px', color: '#a7f3d0' }).setOrigin(1, 0)
    const hint = this.add.text(0, bg.height / 2 - 14, 'Press [E] or [Esc] to close', { fontFamily: 'monospace', fontSize: '12px', color: '#64748b' }).setOrigin(0.5, 1)
    const rowsCont = this.add.container(0, 0)
    cont.add([scrim, bg, title, cores, hint, rowsCont])

    const addRow = (y: number, label: string, desc: string, cost: number, apply: () => boolean, enabled = true) => {
      const color = enabled ? '#e2e8f0' : '#64748b'
      const l = this.add.text(-bg.width / 2 + 16, y, label, { fontFamily: 'monospace', fontSize: '16px', color })
      const d = this.add.text(-bg.width / 2 + 16, y + 18, desc, { fontFamily: 'monospace', fontSize: '12px', color: '#94a3b8' })
      const btnLabel = enabled ? `[ Buy ${cost} ]` : `[ Locked ]`
      const b = this.add.text(bg.width / 2 - 16, y + 9, btnLabel, { fontFamily: 'monospace', fontSize: '16px', color: enabled ? '#a7f3d0' : '#64748b' }).setOrigin(1, 0)
      if (enabled) b.setInteractive({ useHandCursor: true }).on('pointerdown', () => { if (apply()) { cores.setText(this.metaText()); renderRows() } })
      rowsCont.add([l, d, b])
    }

    const renderRows = () => {
      // Clear previous rows from rows container
      rowsCont.removeAll(true)
      const up = this.getUpgrades()
      let y = -bg.height / 2 + 48
      // Branch A: Defense path
      addRow(y, '+1 Max HP', 'Increase base max HP permanently', 2, () => this.trySpend('maxHp', 1, 2)); y += 48
      const canRegen = (up.maxHp >= 2)
      addRow(y, '+1 Heal on Clear', 'Heal when a level ends (req: +2 Max HP)', 3, () => this.trySpend('healOnClear', 1, 3), canRegen); y += 52

      // Branch B: Offense path
      addRow(y, '+5% Bullet Speed', 'Bullets travel faster', 2, () => this.trySpend('bulletSpeedPct', 5, 2)); y += 48
      const canFireRate = (up.bulletSpeedPct >= 10)
      addRow(y, '+10% Fire Rate', 'Shoot faster (req: +10% Bullet Speed)', 3, () => this.trySpend('fireRatePct', 10, 3), canFireRate); y += 48
      const canPierce = (up.fireRatePct >= 10)
      addRow(y, '+1 Bullet Pierce', 'Bullets pass through one extra enemy (req: +10% Fire Rate)', 4, () => this.trySpend('pierce', 1, 4), canPierce); y += 52

      // Branch C: Mobility path
      addRow(y, '+5% Dash Speed', 'Dash reaches target quicker', 2, () => this.trySpend('dashSpeedPct', 5, 2)); y += 48

      // If content exceeds panel, expand height and reposition hint once
      const contentBottom = y
      const desiredHalf = Math.max(bg.height / 2, Math.min(this.scale.height / 2 - 40, contentBottom + 36))
      if (desiredHalf > bg.height / 2) {
        bg.setSize(bg.width, desiredHalf * 2)
        // Reposition static elements relative to new height
        title.setY(-bg.height / 2 + 12)
        cores.setY(-bg.height / 2 + 12)
        hint.setY(bg.height / 2 - 14)
      }
    }

    renderRows()

    // Close only via keys (no click-to-close)
    const close = () => { cont.destroy(); this.panelOpen = false }
    bg.setInteractive().on('pointerdown', (p: Phaser.Input.Pointer) => p.event.stopPropagation())
    this.input.keyboard?.once('keydown-ESC', close)
    this.input.keyboard?.once('keydown-E', close)
    this.panel = cont
    this.panelOpen = true
  }

  private metaText(): string {
    const cores = this.saveData?.meta?.cores ?? 0
    return `Cores: ${cores}`
  }

  private trySpend(key: 'maxHp' | 'bulletSpeedPct' | 'dashSpeedPct' | 'fireRatePct' | 'pierce' | 'healOnClear', amount: number, cost: number): boolean {
    if (!this.slotId) return false
    const data = loadSlot(this.slotId)
    if (!data) return false
    if ((data.meta.cores ?? 0) < cost) return false
    data.meta.cores -= cost
    ;(data.meta.upgrades as any)[key] = ((data.meta.upgrades as any)[key] ?? 0) + amount
    saveSlot(this.slotId, data)
    this.saveData = data
    this.refreshUpgrades()
    // If max HP increased, keep current HP bounded by new max
    this.hp = Math.min(this.hp, this.maxHp())
    return true
  }

  // ===== Meta helpers =====
  private getUpgrades(): { maxHp: number; bulletSpeedPct: number; dashSpeedPct: number; fireRatePct: number; pierce: number; healOnClear: number } {
    return this.upgradesCache
  }

  private maxHp(): number { return PLAYER_MAX_HP + (this.upgradesCache.maxHp || 0) }
  private getBulletSpeed(): number { return this.bulletSpeedCache }
  private getDashSpeed(): number { return this.dashSpeedCache }
  private getFireCooldownMs(): number { return this.fireCooldownMsCache }
  private getPierce(): number { return this.upgradesCache.pierce || 0 }

  private refreshUpgrades(): void {
    const d = this.slotId ? (this.saveData ?? loadSlot(this.slotId)) : loadSave()
    const u = (d?.meta?.upgrades as any) || {}
    this.upgradesCache = {
      maxHp: u.maxHp ?? 0,
      bulletSpeedPct: u.bulletSpeedPct ?? 0,
      dashSpeedPct: u.dashSpeedPct ?? 0,
      fireRatePct: u.fireRatePct ?? 0,
      pierce: u.pierce ?? 0,
      healOnClear: u.healOnClear ?? 0
    }
    this.bulletSpeedCache = BULLET_SPEED * (1 + (this.upgradesCache.bulletSpeedPct || 0) / 100)
    this.dashSpeedCache = DASH_SPEED * (1 + (this.upgradesCache.dashSpeedPct || 0) / 100)
    const mult = 1 + (this.upgradesCache.fireRatePct || 0) / 100
    this.fireCooldownMsCache = Math.max(20, Math.round(FIRE_COOLDOWN_MS / mult))
  }

  // Central gate for input while menus are open
  private isInputLocked(): boolean { return !!this.panelOpen }
}
