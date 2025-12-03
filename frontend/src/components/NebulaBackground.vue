<template>
  <canvas ref="nebulaCanvas" class="nebula-canvas"></canvas>
</template>

<script>
export default {
  name: 'NebulaBackground',
  data() {
    return {
      ctx: null,
      width: 0,
      height: 0,
      nebulaClouds: [],
      stars: [],
      animationId: null
    }
  },
  mounted() {
    this.initCanvas()
    window.addEventListener('resize', this.resizeCanvas)
  },
  beforeUnmount() {
    window.removeEventListener('resize', this.resizeCanvas)
    if (this.animationId) {
      cancelAnimationFrame(this.animationId)
    }
  },
  methods: {
    initCanvas() {
      const canvas = this.$refs.nebulaCanvas
      this.ctx = canvas.getContext('2d')
      this.resizeCanvas()
      this.animate()
    },

    resizeCanvas() {
      const canvas = this.$refs.nebulaCanvas
      this.width = window.innerWidth
      this.height = window.innerHeight
      canvas.width = this.width
      canvas.height = this.height
      this.createStars()
      this.createNebulaClouds()
    },

    createStars() {
      this.stars = []
      // Create more stars with varying properties for a softer look
      for (let i = 0; i < 350; i++) {
        this.stars.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          size: Math.random() * 2 + 0.5,
          speed: Math.random() * 0.02 + 0.003,
          brightness: Math.random(),
          twinkleSpeed: Math.random() * 0.002 + 0.001,
          twinkleOffset: Math.random() * Math.PI * 2,
          // Add color tint for some stars
          hue: Math.random() > 0.7 ? (Math.random() * 60 + 200) : 0 // Some blue/purple tinted stars
        })
      }
    },

    createNebulaClouds() {
      this.nebulaClouds = []
      const colors = [
        'rgba(65, 105, 225, 0.08)',   // Royal Blue
        'rgba(138, 43, 226, 0.08)',   // Blue Violet
        'rgba(255, 20, 147, 0.06)',   // Deep Pink
        'rgba(75, 0, 130, 0.08)',     // Indigo
        'rgba(147, 112, 219, 0.07)', // Medium Purple
        'rgba(218, 112, 214, 0.06)'  // Orchid
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

        this.nebulaClouds.push({
          x: Math.random() * this.width,
          y: Math.random() * this.height,
          radius,
          color: colors[Math.floor(Math.random() * colors.length)],
          points,
          angle: 0,
          rotationSpeed: (Math.random() - 0.5) * 0.0005
        })
      }
    },

    drawBackground() {
      const gradient = this.ctx.createRadialGradient(
        this.width / 2,
        this.height / 2,
        0,
        this.width / 2,
        this.height / 2,
        Math.max(this.width, this.height) / 2
      )
      gradient.addColorStop(0, '#0c0d1d')
      gradient.addColorStop(1, '#000000')
      this.ctx.fillStyle = gradient
      this.ctx.fillRect(0, 0, this.width, this.height)
    },

    updateStar(star) {
      star.y -= star.speed
      if (star.y < 0) {
        star.x = Math.random() * this.width
        star.y = this.height
        star.size = Math.random() * 2 + 0.5
        star.speed = Math.random() * 0.02 + 0.003
      }
      // Softer, slower twinkling
      star.brightness = Math.sin(Date.now() * star.twinkleSpeed + star.twinkleOffset) * 0.3 + 0.7
    },

    drawStar(star) {
      const ctx = this.ctx
      
      // Draw soft glow around star
      if (star.size > 0.8) {
        const glowSize = star.size * 6
        const glow = ctx.createRadialGradient(star.x, star.y, 0, star.x, star.y, glowSize)
        
        if (star.hue > 0) {
          // Colored star glow
          glow.addColorStop(0, `hsla(${star.hue}, 70%, 85%, ${star.brightness * 0.6})`)
          glow.addColorStop(0.3, `hsla(${star.hue}, 60%, 75%, ${star.brightness * 0.3})`)
          glow.addColorStop(0.6, `hsla(${star.hue}, 50%, 70%, ${star.brightness * 0.1})`)
          glow.addColorStop(1, 'transparent')
        } else {
          // White star glow
          glow.addColorStop(0, `rgba(255, 255, 255, ${star.brightness * 0.6})`)
          glow.addColorStop(0.3, `rgba(220, 220, 255, ${star.brightness * 0.3})`)
          glow.addColorStop(0.6, `rgba(180, 180, 255, ${star.brightness * 0.1})`)
          glow.addColorStop(1, 'transparent')
        }
        
        ctx.beginPath()
        ctx.arc(star.x, star.y, glowSize, 0, Math.PI * 2)
        ctx.fillStyle = glow
        ctx.fill()
      }
      
      // Draw star core
      ctx.beginPath()
      ctx.arc(star.x, star.y, star.size * 0.6, 0, Math.PI * 2)
      if (star.hue > 0) {
        ctx.fillStyle = `hsla(${star.hue}, 80%, 95%, ${star.brightness})`
      } else {
        ctx.fillStyle = `rgba(255, 255, 255, ${star.brightness})`
      }
      ctx.fill()
    },

    drawNebulaCloud(cloud) {
      cloud.angle += cloud.rotationSpeed

      this.ctx.save()
      this.ctx.translate(cloud.x, cloud.y)
      this.ctx.rotate(cloud.angle)

      this.ctx.beginPath()
      this.ctx.moveTo(cloud.points[0].x, cloud.points[0].y)
      for (let i = 1; i < cloud.points.length; i++) {
        this.ctx.lineTo(cloud.points[i].x, cloud.points[i].y)
      }
      this.ctx.closePath()

      const gradient = this.ctx.createRadialGradient(0, 0, 0, 0, 0, cloud.radius)
      gradient.addColorStop(0, cloud.color)
      gradient.addColorStop(1, 'transparent')

      this.ctx.fillStyle = gradient
      this.ctx.globalCompositeOperation = 'screen'
      this.ctx.fill()

      this.ctx.restore()
    },

    animate() {
      this.ctx.clearRect(0, 0, this.width, this.height)
      this.drawBackground()

      this.nebulaClouds.forEach(cloud => this.drawNebulaCloud(cloud))
      this.stars.forEach(star => {
        this.updateStar(star)
        this.drawStar(star)
      })

      this.animationId = requestAnimationFrame(() => this.animate())
    }
  }
}
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
