<template>
  <canvas ref="nebulaCanvas" class="nebula-canvas"></canvas>
</template>

<script setup>
/**
 * The drifting starfield and nebula behind the app. It is decoration, so it
 * is kept cheap: nothing in it is reactive, each star's glow is a sprite
 * drawn once (not a new gradient per star per frame), it draws at most ~30
 * frames a second, stops while the tab is hidden, and with reduced motion
 * draws one still frame.
 */
import { onBeforeUnmount, onMounted, ref } from 'vue'

const STAR_COUNT = 350
const FRAME_MS = 1000 / 30
// Speeds below were tuned per 60 fps frame; scaled by the real frame time.
const BASE_FRAME_MS = 1000 / 60
const SPRITE_RADIUS = 32
const HUE_STEP = 5

const nebulaCanvas = ref(null)

let ctx = null
let width = 0
let height = 0
let stars = []
let clouds = []
let background = null
let animationId = 0
let lastFrame = 0
const sprites = new Map()
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)')

// A star's glow at full brightness: drawn with globalAlpha = brightness it is
// the same as the gradient it replaces (every stop scales with brightness).
function glowSprite(hue) {
  const key = hue > 0 ? Math.round(hue / HUE_STEP) * HUE_STEP : 0
  let sprite = sprites.get(key)
  if (sprite) return sprite
  sprite = document.createElement('canvas')
  sprite.width = sprite.height = SPRITE_RADIUS * 2
  const sctx = sprite.getContext('2d')
  const glow = sctx.createRadialGradient(SPRITE_RADIUS, SPRITE_RADIUS, 0, SPRITE_RADIUS, SPRITE_RADIUS, SPRITE_RADIUS)
  if (key > 0) {
    glow.addColorStop(0, `hsla(${key}, 70%, 85%, 0.6)`)
    glow.addColorStop(0.3, `hsla(${key}, 60%, 75%, 0.3)`)
    glow.addColorStop(0.6, `hsla(${key}, 50%, 70%, 0.1)`)
  } else {
    glow.addColorStop(0, 'rgba(255, 255, 255, 0.6)')
    glow.addColorStop(0.3, 'rgba(220, 220, 255, 0.3)')
    glow.addColorStop(0.6, 'rgba(180, 180, 255, 0.1)')
  }
  glow.addColorStop(1, 'transparent')
  sctx.fillStyle = glow
  sctx.fillRect(0, 0, sprite.width, sprite.height)
  sprites.set(key, sprite)
  return sprite
}

function createStars() {
  stars = []
  for (let i = 0; i < STAR_COUNT; i++) {
    stars.push({
      x: Math.random() * width,
      y: Math.random() * height,
      size: Math.random() * 2 + 0.5,
      speed: Math.random() * 0.02 + 0.003,
      brightness: Math.random(),
      twinkleSpeed: Math.random() * 0.002 + 0.001,
      twinkleOffset: Math.random() * Math.PI * 2,
      hue: Math.random() > 0.7 ? (Math.random() * 60 + 200) : 0
    })
  }
}

function createNebulaClouds() {
  clouds = []
  const colors = [
    'rgba(65, 105, 225, 0.08)',
    'rgba(138, 43, 226, 0.08)',
    'rgba(255, 20, 147, 0.06)',
    'rgba(75, 0, 130, 0.08)',
    'rgba(147, 112, 219, 0.07)',
    'rgba(218, 112, 214, 0.06)'
  ]

  for (let i = 0; i < 6; i++) {
    const radius = Math.random() * 400 + 200
    const numberOfPoints = 12
    const angleStep = (Math.PI * 2) / numberOfPoints
    const points = []

    for (let j = 0; j <= numberOfPoints; j++) {
      const angle = j * angleStep
      const distortion = Math.random() * 0.5 + 0.5
      points.push({
        x: Math.cos(angle) * radius * distortion,
        y: Math.sin(angle) * radius * distortion
      })
    }

    const color = colors[Math.floor(Math.random() * colors.length)]
    // Drawn around the cloud's own origin, so it never changes: made once.
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, radius)
    gradient.addColorStop(0, color)
    gradient.addColorStop(1, 'transparent')

    clouds.push({
      x: Math.random() * width,
      y: Math.random() * height,
      points,
      gradient,
      angle: 0,
      rotationSpeed: (Math.random() - 0.5) * 0.0005
    })
  }
}

function resizeCanvas() {
  const canvas = nebulaCanvas.value
  width = window.innerWidth
  height = window.innerHeight
  canvas.width = width
  canvas.height = height

  background = ctx.createRadialGradient(width / 2, height / 2, 0, width / 2, height / 2, Math.max(width, height) / 2)
  background.addColorStop(0, '#0c0d1d')
  background.addColorStop(1, '#000000')

  createStars()
  createNebulaClouds()
  if (reducedMotion.matches) draw(0)
}

function drawCloud(cloud, step) {
  cloud.angle += cloud.rotationSpeed * step

  ctx.save()
  ctx.translate(cloud.x, cloud.y)
  ctx.rotate(cloud.angle)

  ctx.beginPath()
  ctx.moveTo(cloud.points[0].x, cloud.points[0].y)
  for (let i = 1; i < cloud.points.length; i++) {
    ctx.lineTo(cloud.points[i].x, cloud.points[i].y)
  }
  ctx.closePath()

  ctx.fillStyle = cloud.gradient
  ctx.globalCompositeOperation = 'screen'
  ctx.fill()

  ctx.restore()
}

function updateStar(star, step, now) {
  star.y -= star.speed * step
  if (star.y < 0) {
    star.x = Math.random() * width
    star.y = height
    star.size = Math.random() * 2 + 0.5
    star.speed = Math.random() * 0.02 + 0.003
  }
  star.brightness = Math.sin(now * star.twinkleSpeed + star.twinkleOffset) * 0.3 + 0.7
}

function drawStar(star) {
  if (star.size > 0.8) {
    const glowSize = star.size * 6
    ctx.globalAlpha = star.brightness
    ctx.drawImage(glowSprite(star.hue), star.x - glowSize, star.y - glowSize, glowSize * 2, glowSize * 2)
    ctx.globalAlpha = 1
  }

  ctx.beginPath()
  ctx.arc(star.x, star.y, star.size * 0.6, 0, Math.PI * 2)
  ctx.fillStyle = star.hue > 0
    ? `hsla(${star.hue}, 80%, 95%, ${star.brightness})`
    : `rgba(255, 255, 255, ${star.brightness})`
  ctx.fill()
}

// `step` is how many 60 fps frames have passed (0 for a still frame).
function draw(step) {
  const now = Date.now()
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = background
  ctx.fillRect(0, 0, width, height)

  clouds.forEach(cloud => drawCloud(cloud, step))
  stars.forEach(star => {
    updateStar(star, step, now)
    drawStar(star)
  })
}

function frame(time) {
  animationId = requestAnimationFrame(frame)
  const elapsed = time - lastFrame
  if (elapsed < FRAME_MS) return
  // After a pause (hidden tab) don't jump: move one frame's worth.
  const step = lastFrame && elapsed < 250 ? elapsed / BASE_FRAME_MS : 1
  lastFrame = time
  draw(step)
}

function start() {
  stop()
  if (reducedMotion.matches || document.hidden) {
    draw(0)
    return
  }
  lastFrame = 0
  animationId = requestAnimationFrame(frame)
}

function stop() {
  if (animationId) cancelAnimationFrame(animationId)
  animationId = 0
}

function onVisibilityChange() {
  if (document.hidden) stop()
  else start()
}

onMounted(() => {
  ctx = nebulaCanvas.value.getContext('2d')
  resizeCanvas()
  start()
  window.addEventListener('resize', resizeCanvas)
  document.addEventListener('visibilitychange', onVisibilityChange)
  reducedMotion.addEventListener('change', start)
})

onBeforeUnmount(() => {
  stop()
  window.removeEventListener('resize', resizeCanvas)
  document.removeEventListener('visibilitychange', onVisibilityChange)
  reducedMotion.removeEventListener('change', start)
})
</script>

<style scoped>
.nebula-canvas {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  z-index: -1;
  pointer-events: none;
}
</style>
