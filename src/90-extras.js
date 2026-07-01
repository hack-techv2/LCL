// =============================================================================
// Drag and drop
// =============================================================================
function initDragDrop() {
  const overlay = document.getElementById('drop-overlay')

  document.addEventListener('dragover', e => {
    e.preventDefault()
    // Reflect where the drop will go: docs (embed) when the panel is open or Shift
    // is held, else the message (attach) — same routing as the drop handler below.
    const msg = overlay.querySelector('.drop-msg')
    if (msg) msg.textContent = ((typeof dpOpen !== 'undefined' && dpOpen) || e.shiftKey) ? 'Drop files to embed' : 'Drop files to attach'
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
  // A horizontal streak sweeps left->right along the top bar, BEHIND the bar's
  // content (logo/title/controls) exactly like the ambient 10s streak. A moment
  // later the version-badge comet (the click) rises up from below, and the two
  // clash in the open gap between the LCL title and the right-side controls,
  // then burst. The ambient top-bar streak is left running.
  const tb  = document.getElementById('topbar')
  const tbr = tb ? tb.getBoundingClientRect() : { left: 0, top: 0, width: window.innerWidth, height: 48 }
  const topY = tbr.top + tbr.height / 2

  // Clash point: midway between the LCL title's right edge and the right-side
  // controls (the Demo pill / Search), i.e. the open gap to the right of LCL.
  const brand = document.querySelector('.tb-brand-name')
  const right = document.querySelector('.tb-right')
  const br = brand ? brand.getBoundingClientRect() : null
  const rr = right ? right.getBoundingClientRect() : null
  const clashX = (br && rr) ? (br.right + rr.left) / 2 : window.innerWidth * 0.62

  // BACK layer: a canvas inside .tb-comets (z-index 0, clipped to the bar) so the
  // streak is occluded by the bar's opaque content plates, like the ambient one.
  const host  = (tb && tb.querySelector('.tb-comets')) || tb || document.body
  const cBack = document.createElement('canvas')
  cBack.style.cssText = 'position:absolute;inset:0;pointer-events:none'
  cBack.width  = Math.round(tbr.width)
  cBack.height = Math.round(tbr.height)
  host.appendChild(cBack)
  const ctxB = cBack.getContext('2d')
  const bX0 = -170, bY = tbr.height / 2, bMx = clashX - tbr.left   // back-canvas local coords

  // FRONT layer: a full-screen overlay for the rising badge comet and the burst.
  const cFront = document.createElement('canvas')
  cFront.style.cssText = 'position:fixed;inset:0;z-index:9999;pointer-events:none'
  cFront.width  = window.innerWidth
  cFront.height = window.innerHeight
  document.body.appendChild(cFront)
  const ctxF = cFront.getContext('2d')

  const A0 = { x: startX, y: startY }
  const Mx = clashX, My = topY
  // The horizontal streak cruises at the SAME speed as the ambient top-bar comet
  // (derived from the tbStreak keyframes: -180px -> 110vw over 17% of 30s = 5.1s).
  // The badge comet then travels faster so it arrives at the clash at the same time.
  const ambientSpeed = (1.10 * window.innerWidth + 180) / 5100   // px per ms
  const IMPACT = (bMx - bX0) / ambientSpeed                      // streak reaches the clash at ambient pace
  const D_A    = 900                                             // badge-comet travel time (sped up)
  const startA = Math.max(0, IMPACT - D_A)                       // launches later, fast enough to meet the streak
  const BURST  = 950
  const start = performance.now()
  const trailA = [], trailB = [], TRAIL_PX = 170  // match the ambient streak tail length
  let particles = null

  const drawTail = (ctx, tr, wMax = 4) => {
    for (let i = 0; i < tr.length - 1; i++) {
      const a = i / tr.length
      ctx.beginPath()
      ctx.moveTo(tr[i].x, tr[i].y); ctx.lineTo(tr[i+1].x, tr[i+1].y)
      ctx.strokeStyle = `rgba(${232 + Math.floor(a*23)}, ${97 + Math.floor(a*108)}, ${10 + Math.floor(a*130)}, ${a * 0.75})`
      ctx.lineWidth = a * wMax; ctx.lineCap = 'round'; ctx.stroke()
    }
  }
  const drawHead = (ctx, x, y, glowR = 9, coreR = 3) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, glowR)
    g.addColorStop(0, 'rgba(255,255,235,1)'); g.addColorStop(0.3, 'rgba(255,200,120,0.9)'); g.addColorStop(1, 'rgba(232,97,10,0)')
    ctx.beginPath(); ctx.arc(x, y, glowR, 0, Math.PI*2); ctx.fillStyle = g; ctx.fill()
    ctx.beginPath(); ctx.arc(x, y, coreR, 0, Math.PI*2); ctx.fillStyle = 'rgba(255,255,255,0.95)'; ctx.fill()
  }
  // Trim a trail so its on-screen path length stays at TRAIL_PX (the ambient
  // streak's tail length), regardless of the comet's speed. Keeps it bounded too.
  const trimTrail = (tr) => {
    let acc = 0
    for (let i = tr.length - 1; i > 0; i--) {
      acc += Math.hypot(tr[i].x - tr[i-1].x, tr[i].y - tr[i-1].y)
      if (acc > TRAIL_PX) { tr.splice(0, i); return }
    }
  }

  function draw(now) {
    const el = now - start
    ctxB.clearRect(0, 0, cBack.width, cBack.height)
    ctxF.clearRect(0, 0, cFront.width, cFront.height)

    if (el < IMPACT) {
      // Horizontal streak B (behind the bar content), linear like the ambient one.
      const eb = el / IMPACT
      const bx = bX0 + (bMx - bX0) * eb
      trailB.push({ x: bx, y: bY }); trimTrail(trailB)
      drawTail(ctxB, trailB); drawHead(ctxB, bx, bY)
      // Badge comet A (front), launches later, eases in; both reach the gap together.
      if (el >= startA) {
        const ta = (el - startA) / (IMPACT - startA), ea = ta * ta
        const ax = A0.x + (Mx - A0.x) * ea, ay = A0.y + (My - A0.y) * ea
        trailA.push({ x: ax, y: ay }); trimTrail(trailA)
        drawTail(ctxF, trailA); drawHead(ctxF, ax, ay)
      }
      requestAnimationFrame(draw)
    } else if (el < IMPACT + BURST) {
      // Burst at the clash point (front layer). The gap has little to occlude it.
      if (!particles) {
        particles = []
        const N = 40
        for (let i = 0; i < N; i++) {
          const ang = (i / N) * Math.PI * 2
          const sp  = (i % 2 === 0) ? 9 : 5.5
          particles.push({ x: Mx, y: My, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: (i % 2 === 0) ? 2.6 : 1.8 })
        }
      }
      const b = (el - IMPACT) / BURST
      const fade = 1 - b
      const bloom = ctxF.createRadialGradient(Mx, My, 0, Mx, My, 44 + b * 130)
      bloom.addColorStop(0,   `rgba(255,250,235,${fade * 0.9})`)
      bloom.addColorStop(0.4, `rgba(255,170,80,${fade * 0.5})`)
      bloom.addColorStop(1,   'rgba(232,97,10,0)')
      ctxF.beginPath(); ctxF.arc(Mx, My, 44 + b * 130, 0, Math.PI*2); ctxF.fillStyle = bloom; ctxF.fill()
      for (let k = 0; k < 3; k++) {
        const rb = b - k * 0.12
        if (rb <= 0) continue
        ctxF.beginPath(); ctxF.arc(Mx, My, 8 + rb * 165, 0, Math.PI*2)
        ctxF.strokeStyle = `rgba(255,${180 - k*30},${100 - k*20},${(1 - rb) * 0.55})`
        ctxF.lineWidth = 3 - k; ctxF.stroke()
      }
      if (b < 0.28) {
        const f = (0.28 - b) / 0.28
        ctxF.beginPath(); ctxF.arc(Mx, My, f * 30, 0, Math.PI*2)
        ctxF.fillStyle = `rgba(255,255,255,${f * 0.95})`; ctxF.fill()
      }
      for (const p of particles) {
        const px = p.x, py = p.y
        p.x += p.vx; p.y += p.vy; p.vy += 0.08; p.vx *= 0.985; p.vy *= 0.985
        ctxF.beginPath(); ctxF.moveTo(px, py); ctxF.lineTo(p.x, p.y)
        ctxF.strokeStyle = `rgba(255, ${150 + Math.floor(fade * 90)}, 70, ${fade * 0.9})`
        ctxF.lineWidth = p.r * fade; ctxF.lineCap = 'round'; ctxF.stroke()
        ctxF.beginPath(); ctxF.arc(p.x, p.y, p.r * fade, 0, Math.PI*2)
        ctxF.fillStyle = `rgba(255,235,190,${fade * 0.9})`; ctxF.fill()
      }
      requestAnimationFrame(draw)
    } else {
      cBack.remove(); cFront.remove()
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
