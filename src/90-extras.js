// =============================================================================
// Drag and drop
// =============================================================================
function initDragDrop() {
  const overlay = document.getElementById('drop-overlay')

  document.addEventListener('dragover', e => {
    e.preventDefault()
    overlay.classList.add('active')
  })

  document.addEventListener('dragleave', e => {
    if (e.relatedTarget === null || !document.contains(e.relatedTarget)) {
      overlay.classList.remove('active')
    }
  })

  document.addEventListener('drop', e => {
    e.preventDefault()
    overlay.classList.remove('active')
    const files = e.dataTransfer?.files
    if (!files || !files.length) return
    // if doc panel open or modifier key held, upload to docs; else attach to message
    if (dpOpen || e.shiftKey) {
      uploadDocs(files)
    } else {
      handleAttach(files)
    }
  })
}

// =============================================================================
// Easter egg — comet
// =============================================================================
let eggClicks = 0
let eggTimer  = null

function eggClick(e) {
  clearTimeout(eggTimer)
  eggClicks++
  eggTimer = setTimeout(() => { eggClicks = 0 }, 2000)
  if (eggClicks >= 7) {
    eggClicks = 0
    if (typeof unlockAlpha === 'function') unlockAlpha()
    launchComet(e.clientX, e.clientY)
  }
}

function launchComet(startX, startY) {
  // Create full-screen canvas overlay
  const canvas = document.createElement('canvas')
  canvas.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none'
  canvas.width  = window.innerWidth
  canvas.height = window.innerHeight
  document.body.appendChild(canvas)
  const ctx = canvas.getContext('2d')

  const duration = 3000  // ms
  const start    = performance.now()

  // Travel vector: from click point toward top-right, far enough to exit viewport
  const dist  = Math.max(canvas.width, canvas.height) * 1.6
  const angle = -Math.PI / 4   // 45° toward top-right
  const endX  = startX + Math.cos(angle) * dist
  const endY  = startY + Math.sin(angle) * dist

  // Trail history
  const trail = []
  const TRAIL_LEN = 38

  function draw(now) {
    const t    = Math.min((now - start) / duration, 1)
    const ease = t < 0.5 ? 2*t*t : -1+(4-2*t)*t  // ease in-out

    const x = startX + (endX - startX) * ease
    const y = startY + (endY - startY) * ease

    trail.push({ x, y })
    if (trail.length > TRAIL_LEN) trail.shift()

    ctx.clearRect(0, 0, canvas.width, canvas.height)

    // Draw tail segments from oldest to newest
    for (let i = 0; i < trail.length - 1; i++) {
      const a = i / trail.length        // 0 = oldest, 1 = newest
      const p = trail[i]
      const width = a * 6

      ctx.beginPath()
      ctx.moveTo(trail[i].x, trail[i].y)
      ctx.lineTo(trail[i+1].x, trail[i+1].y)
      ctx.strokeStyle = `rgba(255, ${160 + Math.floor(a*80)}, 60, ${a * 0.7})`
      ctx.lineWidth   = width
      ctx.lineCap     = 'round'
      ctx.stroke()
    }

    // Glow head
    if (trail.length) {
      const grd = ctx.createRadialGradient(x, y, 0, x, y, 18)
      grd.addColorStop(0,   'rgba(255, 255, 220, 1)')
      grd.addColorStop(0.3, 'rgba(255, 180, 60, 0.9)')
      grd.addColorStop(1,   'rgba(232, 97, 10, 0)')
      ctx.beginPath()
      ctx.arc(x, y, 18, 0, Math.PI * 2)
      ctx.fillStyle = grd
      ctx.fill()

      // Bright core
      ctx.beginPath()
      ctx.arc(x, y, 4, 0, Math.PI * 2)
      ctx.fillStyle = 'rgba(255,255,255,0.95)'
      ctx.fill()
    }

    if (t < 1) {
      requestAnimationFrame(draw)
    } else {
      canvas.remove()
      unlockSmiley()
    }
  }

  requestAnimationFrame(draw)
}

function unlockSmiley() {
  localStorage.setItem('lcl_egg', '1')
  const el = document.getElementById('footer-smiley')
  if (el) {
    el.style.display = 'inline'
    el.style.opacity = '0'
    el.style.transition = 'opacity 1.2s'
    setTimeout(() => el.style.opacity = '1', 50)
  }
}

function initEgg() {
  if (localStorage.getItem('lcl_egg') === '1') {
    const el = document.getElementById('footer-smiley')
    if (el) el.style.display = 'inline'
  }
}

// Subtle typewriter placeholder in the composer. Only animates while the input
// is empty and unfocused; pauses (shows "Message LCL...") the moment you focus.
function initComposerPlaceholder() {
  const el = document.getElementById('msg-in')
  if (!el) return
  const base = 'Message LCL\u2026'
  const phrases = ['Summarise a report\u2026','Draft a policy email\u2026','Explain a concept\u2026','Review some code\u2026']
  let pi = 0, ci = 0, erasing = false
  const tick = () => {
    if (el === document.activeElement || el.value) { setTimeout(tick, 700); return }
    // Only show the rotating example prompts on an empty/new chat. In an existing
    // conversation just keep the plain placeholder.
    const c = (typeof curChat === 'function') ? curChat() : null
    if (c && c.messages && c.messages.length) { el.setAttribute('placeholder', base); ci = 0; erasing = false; setTimeout(tick, 1200); return }
    const w = phrases[pi]
    if (!erasing) {
      ci++; el.setAttribute('placeholder', w.slice(0, ci))
      if (ci >= w.length) { erasing = true; return setTimeout(tick, 1700) }
      setTimeout(tick, 55)
    } else {
      ci--; el.setAttribute('placeholder', ci > 0 ? w.slice(0, ci) : base)
      if (ci <= 0) { erasing = false; pi = (pi + 1) % phrases.length; return setTimeout(tick, 500) }
      setTimeout(tick, 28)
    }
  }
  el.addEventListener('focus', () => el.setAttribute('placeholder', base))
  el.addEventListener('blur', () => { if (!el.value) { ci = 0; erasing = false } })
  setTimeout(tick, 1500)
}
