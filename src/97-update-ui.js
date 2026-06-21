// =============================================================================
// Auto-update — Settings card UI + stable update dialog
// =============================================================================

function renderUpdateSettings(){
  const body = document.getElementById('upd-body')
  if (!body) return
  const u = lclUpdate
  const vb = document.getElementById('ver-badge')
  const cur = u.current || (vb ? vb.textContent.replace(/^v/i,'') : '')
  const v = cur ? ('v'+esc(cur)) : '\u2014'
  const pill = (cls,txt)=> '<span class="upd-pill '+cls+'">'+txt+'</span>'
  // Condensed: a single version line + status pill (no separate "Version" header
  // or "Installed" tile), then the two toggle rows.
  const verRow = (verHtml,p)=> '<div class="upd-top"><span class="upd-ver">'+verHtml+'</span>'+p+'</div>'
  const autoRow = (right)=> '<div class="upd-row"><label class="upd-auto"><input type="checkbox" id="upd-auto" '+(updateAutoOn()?'checked':'')+' onchange="setUpdateAuto(this.checked)"><span class="upd-sw"></span>Check on launch</label>'+right+'</div>'
  // Dev/test (alpha only): real apply+restart, reusing the current file (server
  // copies it onto itself). Exercises the reload (index.html) / restart (server.txt) flow.
  const simBtn = (file)=> '<button class="upd-btn upd-sim-btn' + ((typeof _simArmed!=='undefined' && _simArmed.indexOf(file)>=0)?' on':'') + '" onclick="armSimulate(\''+file+'\')">'+file+'</button>'
  const simRow = ()=> '<div class="upd-row upd-sim"><span class="upd-sim-lbl">Simulate update <span class="upd-dev">dev</span></span>'
    + '<span class="upd-sim-btns">' + simBtn('index.html') + simBtn('server.txt') + '</span></div>'
  const expRow = (on)=> '<div class="upd-row"><label class="upd-auto"><input type="checkbox" '+(on?'checked':'')+' onchange="setChannel(this.checked?\'alpha\':\'stable\')"><span class="upd-sw"></span>Alpha updates</label><span class="upd-exp">Experimental</span></div>'

  if (!u.checked){
    body.innerHTML = verRow(v, pill('neutral','Not checked'))
      + autoRow('<button class="upd-btn" onclick="checkForUpdate(true)">Check now</button>')
      + (alphaUnlocked() && !u.sameAsStable ? expRow(u.channel === 'alpha') : '')
    return
  }

  // ALPHA channel — experimental builds are identified by a commit hash, not a
  // version number, so the line leads with #hash (not vX.Y).
  if (u.channel === 'alpha'){
    const h = u.hash ? ('#'+esc(u.hash)) : 'alpha'
    const when = u.installedAt ? ' <span class="upd-when">\u00b7 updated '+esc(fmtUpdated(u.installedAt))+'</span>' : ''
    let p, build, primary = ''
    if (u.error){ p = pill('err','Check failed'); build = (u.hash ? '#'+esc(u.hash) : '\u2014') + when }
    else if (u.applied){ p = pill('ok','Updated'); build = h + when; if (u.applied.refreshNeeded) primary = '<button class="upd-btn pri" onclick="location.reload()">Reload now</button>' }
    else if (u.inSync){ p = pill('ok','Up to date'); build = h + when }
    else { p = pill('warn','Update available'); build = '<span class="upd-sub">'+(u.changed||[]).map(esc).join(', ')+' changed</span>'
      const applyAct = u.simulated ? ('simulateUpdate([' + (u.changed||[]).map(fn => "'" + fn + "'").join(',') + '])') : 'applyAlphaNow()'
      primary = '<button class="upd-btn pri" onclick="'+applyAct+'">Update &amp; restart</button>' }
    body.innerHTML = '<div class="upd-top"><span class="upd-build">'+build+'</span>'+p+'</div>'
      + autoRow(primary || '<button class="upd-btn" onclick="checkForUpdate(true)">Check now</button>')
      + expRow(true)
      + simRow()
      + (u.error ? '<div style="font-size:11px;color:var(--tx3);margin-top:9px">'+esc(u.error)+'</div>' : '')
    return
  }

  // STABLE channel
  if (u.error){
    body.innerHTML = verRow(v, pill('err','Check failed'))
      + autoRow('<button class="upd-btn" onclick="checkForUpdate(true)">Retry</button>')
      + (alphaUnlocked() && !u.sameAsStable ? expRow(false) : '')
      + '<div style="font-size:11px;color:var(--tx3);margin-top:9px">'+esc(u.error)+'</div>'
    return
  }
  const verHtml = u.newer ? (v + ' <span class="upd-arrow">&rarr;</span> <span class="upd-new">v'+esc(u.latest||'')+'</span>') : v
  body.innerHTML = verRow(verHtml, u.newer ? pill('warn','Update available') : pill('ok','Up to date'))
    + autoRow(u.newer ? '<button class="upd-btn pri" onclick="openUpdateDialog()">Update to v'+esc(u.latest||'')+'</button>' : '<button class="upd-btn" onclick="checkForUpdate(true)">Check now</button>')
    + (alphaUnlocked() && !u.sameAsStable ? expRow(false) : '')
}

function openUpdateDialog(){
  if (!lclUpdate.newer){ toast('No update available','info'); return }
  closeUpdateDialog()
  const bd = document.createElement('div')
  bd.id='update-bd'
  bd.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.55);display:flex;align-items:center;justify-content:center;z-index:250;backdrop-filter:blur(6px)'
  bd.innerHTML =
    '<div style="width:440px;max-width:92vw;background:var(--bg2);border:1px solid var(--bdr2);border-radius:16px;overflow:hidden;box-shadow:0 30px 80px var(--modal-shadow)">'+
      '<div style="display:flex;align-items:center;gap:9px;padding:16px 18px;border-bottom:1px solid var(--bdr)">'+
        '<svg width="18" height="18" viewBox="0 0 16 16" fill="var(--ok)"><path d="M8 0a8 8 0 100 16A8 8 0 008 0zm0 3.5l3.5 3.5h-2V11h-3V7H4L8 3.5z"/></svg>'+
        '<div style="font-size:15px;font-weight:600;font-family:var(--display)">Update available — '+esc(lclUpdate.tag)+'</div>'+
      '</div>'+
      '<div style="padding:14px 18px;max-height:38vh;overflow-y:auto"><div style="font-size:11px;color:var(--tx3);margin-bottom:6px">What is new</div>'+
        '<div class="msg-body" style="font-size:13px;padding-left:0">'+fmt(lclUpdate.notes || '_No release notes provided._')+'</div></div>'+
      '<div style="display:flex;align-items:flex-start;gap:7px;padding:0 18px 12px;font-size:11px;color:var(--tx2);line-height:1.5">'+
        '<span style="color:var(--ok);flex-shrink:0">✓</span>'+
        '<span>Each file is downloaded to a temp copy and checksum-verified before it replaces anything. The app updates on refresh; the server needs a Node restart.</span></div>'+
      '<div id="update-result" style="padding:0 18px;font-size:12px"></div>'+
      '<div style="display:flex;justify-content:flex-end;gap:8px;padding:12px 18px;border-top:1px solid var(--bdr);background:var(--bg3)">'+
        '<button class="btn-s" onclick="closeUpdateDialog()">Later</button>'+
        '<button class="btn-sv" id="update-apply-btn" onclick="applyUpdate()">Download &amp; apply</button>'+
      '</div></div>'
  document.body.appendChild(bd)
  // #demo: the notes are seeded placeholders — fetch the REAL release notes from
  // GitHub (read-only, via the server check endpoint) so "What is new" is genuine.
  if (typeof demoOn === 'function' && demoOn()) {
    const notesEl = bd.querySelector('.msg-body')
    if (notesEl) {
      notesEl.innerHTML = '<div style="color:var(--tx3);padding:6px 0">Loading release notes from GitHub\u2026</div>'
      httpGet('/api/update/check').then(r => r.json()).then(d => {
        notesEl.innerHTML = fmt(d.notes || '_No release notes provided._')
      }).catch(e => { notesEl.innerHTML = '<div style="color:var(--red);padding:6px 0">Could not load notes: ' + esc(e.message) + '</div>' })
    }
  }
  bd.addEventListener('click', e=>{ if(e.target===bd) closeUpdateDialog() })
}

function closeUpdateDialog(){ const el=document.getElementById('update-bd'); if(el) el.remove() }

async function applyUpdate(){
  if (typeof demoOn === 'function' && demoOn()) {
    // Emulate the full download -> restart -> updated sequence (no network). The
    // floating "Reset demo" button re-seeds the one-version-behind state.
    const out = document.getElementById('update-result')
    const btn = document.getElementById('update-apply-btn')
    if (btn){ btn.disabled = true; btn.textContent = 'Working\u2026' }
    if (out) out.innerHTML = '<div style="color:var(--tx3);padding:6px 0">Downloading and verifying\u2026 (demo)</div>'
    setTimeout(() => { if (out) out.innerHTML = '<div style="color:var(--ok);padding:6px 0">Updated to v0.67d. Restarting Node\u2026</div>' }, 1000)
    setTimeout(() => {
      const vb = document.getElementById('ver-badge'); if (vb) vb.textContent = 'v0.67d'
      lclUpdate = { checked:true, channel:'stable', current:'0.67d', latest:'0.67d', tag:'v0.67d', newer:false, error:null, ref:'alpha', inSync:true, changed:[], hash:'' }
      renderUpdateBadge(); renderUpdateSettings(); closeUpdateDialog()
      toast('Updated to v0.67d (demo) \u2014 Reset demo to replay', 'ok')
    }, 2100)
    return
  }
  const btn = document.getElementById('update-apply-btn')
  const out = document.getElementById('update-result')
  if (btn){ btn.disabled=true; btn.textContent='Working…' }
  if (out) out.innerHTML='<div style="color:var(--tx3);padding:6px 0">Downloading and verifying…</div>'
  try{
    const r = await httpPost('/api/update/apply')
    const d = await r.json()
    if (d.error){
      if (out) out.innerHTML='<div style="color:var(--red);padding:6px 0">'+esc(d.error)+'</div>'
      if (btn){ btn.disabled=false; btn.textContent='Retry' }
      return
    }
    let msg='<div style="color:var(--ok);padding:6px 0">Updated to '+esc(d.tag)+'.'
    if (d.applied && d.applied.length) msg+=' ('+esc(d.applied.join(', '))+')'
    if (d.unchanged && d.unchanged.length && !(d.applied&&d.applied.length)) msg+=' Already current.'
    msg+='</div>'
    if (d.restartNeeded) msg+='<div style="color:var(--pin);padding:2px 0">Restart Node (Ctrl+C, re-run) to load the new server.</div>'
    if (out) out.innerHTML=msg
    if (btn) btn.style.display='none'
    if (d.refreshNeeded){
      const rb=document.createElement('button'); rb.className='btn-sv'; rb.style.marginTop='6px'
      rb.textContent='Reload now'; rb.onclick=()=>location.reload()
      if (out) out.appendChild(rb)
    }
    lclUpdate.newer=false; renderUpdateBadge(); renderUpdateSettings()
  }catch(e){
    if (out) out.innerHTML='<div style="color:var(--red);padding:6px 0">'+esc(e.message)+'</div>'
    if (btn){ btn.disabled=false; btn.textContent='Retry' }
  }
}

// ---------------------------------------------------------------------------
// update — channel enrolment (merged from 98-update-channel.js)
// ---------------------------------------------------------------------------

// =============================================================================
// Auto-update — channel switch (stable/alpha) + alpha apply/restart
// =============================================================================

// Channel switch (alpha tester channel <-> stable). Persisted server-side.
async function setChannel(ch){
  if (typeof demoOn === 'function' && demoOn()) {
    // Demo: flip the in-memory state so both the version-based (stable) and
    // hash-based (experimental) update cards can be previewed. Touches nothing.
    if (ch === 'alpha') {
      // Preview sticky enrolment: enrolled on the experimental channel and already
      // on the latest build (the alpha == stable case).
      lclUpdate = { checked:true, channel:'alpha', current:'0.67d', ref:'alpha', inSync:true, changed:[], hash:'a1b2c3d', installedAt:Date.now(), error:null, sameAsStable:true }
      if (typeof toast === 'function') toast('Enrolled in Experimental updates \u2014 already on the latest build','ok')
    } else {
      lclUpdate = { checked:true, channel:'stable', current:'0.67c', latest:'0.67d', tag:'v0.67d', newer:true, inSync:true, changed:[], hash:'', error:null }
      relockAlpha()
    }
    if (typeof renderUpdateBadge === 'function') renderUpdateBadge()
    renderUpdateSettings()
    return
  }
  toast('Switching to ' + (ch==='alpha' ? 'experimental' : 'stable') + '\u2026', 'info')
  try{
    const r = await httpPost('/api/update/channel', { channel: ch })
    const d = await r.json()
    if (d.error){ const stay = (d.channel === 'alpha') ? 'experimental' : 'stable'; toast('Channel switch failed: '+d.error+' \u2014 staying on '+stay,'err'); await checkForUpdate(true); return }
    if (d.sameAsStable){
      // Enrolled in Experimental even though the current build already matches stable;
      // future alpha builds will be offered. Render from this response - no second
      // check (the toggle stays on and the ALPHA pill shows).
      lclUpdate = makeUpdateState({ channel:'alpha', ref:'alpha', inSync:true, changed:[], hash:d.hash||'', installedAt:d.installedAt||null })
      toast('Enrolled in Experimental updates \u2014 already on the latest build','ok')
      if (typeof renderUpdateBadge === 'function') renderUpdateBadge()
      renderUpdateSettings()
      return
    }
    if (ch === 'stable') relockAlpha()
    if (d.restartNeeded){
      const msg = ch==='alpha'
        ? 'Experimental build applied'
        : (d.restoredFromBackup ? 'Offline \u2014 restored local stable backup' : ('Restored stable '+((d.restored&&d.restored.tag)||'')))
      toast(msg+' \u2014 restarting Node\u2026','ok')
      try{ await httpPost('/api/update/restart') }catch{}
      waitForServerThenReload(); return
    }
    if (d.refreshNeeded){ toast('Experimental build applied \u2014 reloading\u2026','ok'); setTimeout(()=>location.reload(),700); return }
    if (d.restoreError){ toast('Switched to stable; restore failed: '+d.restoreError,'err') }
    await checkForUpdate(true)
  }catch(e){ toast('Channel switch failed: '+e.message,'err') }
}

// Alpha enrolment is gated behind the easter egg: 7 clicks on the version badge
// unlock the "Try alpha updates" toggle inside Settings -> Updates.
// #demo: gate on an in-memory flag (default locked) and never touch localStorage,
// so demo always starts locked regardless of the real profile's unlock state, the
// easter egg can demonstrate the unlock live, and nothing leaks into normal mode.
let _demoAlphaUnlocked = false
function alphaUnlocked(){
  if (typeof demoOn === 'function' && demoOn()) return _demoAlphaUnlocked
  try { return localStorage.getItem('lcl_alpha_unlocked') === '1' } catch { return false }
}
function unlockAlpha(){
  // Only announce on the first unlock. If already unlocked (e.g. already on the
  // alpha channel), the 7-click egg is a no-op rather than re-popping the toast.
  if (alphaUnlocked()) return
  if (typeof demoOn === 'function' && demoOn()) { _demoAlphaUnlocked = true }
  else { try { localStorage.setItem('lcl_alpha_unlocked', '1') } catch {} }
  if (typeof toast === 'function') toast('Developer mode enabled','ok')
  if (typeof renderUpdateSettings === 'function') renderUpdateSettings()
}

// #demo only: re-lock the easter-egg alpha channel so a Reset demo starts
// locked again. In-memory only (never touches localStorage), so it cannot
// leak the unlocked state into normal mode.
function relockDemoAlpha(){ _demoAlphaUnlocked = false }
// Opting out of alpha re-locks the easter egg: the 'Experimental' toggle
// hides again until the 7-click unlock is repeated. Demo uses the in-memory
// flag; real installs clear the localStorage unlock.
function relockAlpha(){ if (typeof demoOn === 'function' && demoOn()) { _demoAlphaUnlocked = false } else { try { localStorage.removeItem('lcl_alpha_unlocked') } catch {} } }

// Front-end alpha apply: download + verify the alpha pair via the server, then
// prompt reload (index) / restart (server). Boot-time auto-update still exists.
async function applyAlphaNow(){
  if (typeof demoOn === 'function' && demoOn()) {
    toast('Downloading alpha build\u2026 (demo)', 'info')
    setTimeout(() => {
      lclUpdate = { checked:true, channel:'alpha', current:'0.67c', ref:'alpha', inSync:true, changed:[], hash:'e4f5a6b', installedAt:Date.now(), error:null }
      renderUpdateBadge(); renderUpdateSettings()
      toast('Alpha updated to #e4f5a6b (demo) \u2014 Reset demo to replay', 'ok')
    }, 1200)
    return
  }
  try{
    toast('Downloading alpha update...','info')
    const r = await httpPost('/api/update/apply')
    const d = await r.json()
    if (d.error){ toast('Update failed: '+d.error,'err'); return }
    const applied = (d.applied||[]).join(', ') || 'no changes'
    if (d.restartNeeded){
      toast('Applied ('+applied+'). Restarting Node…','ok')
      try { await httpPost('/api/update/restart') } catch {}
      waitForServerThenReload()
      return
    }
    if (d.refreshNeeded){ toast('Applied ('+applied+'). Reloading…','ok'); setTimeout(()=>location.reload(), 700); return }
    lclUpdate.applied = { applied:d.applied||[], restartNeeded:false, refreshNeeded:false }
    lclUpdate.inSync = true; lclUpdate.changed = []
    renderUpdateBadge(); renderUpdateSettings()
    toast('Already current','ok')
  }catch(e){ toast('Update failed: '+e.message,'err') }
}

// Dev/test (alpha): a two-step simulation that mirrors the real UX. Clicking a
// file ARMS it (no apply yet); the next "Check now" reports it as an available
// update; "Update & restart" then runs the real apply+restart, reusing the current
// file (server copies it onto itself instead of downloading).
let _simArmed = []   // set of files armed for simulation (multi-select)
function armSimulate(file){
  const i = _simArmed.indexOf(file)
  if (i >= 0) _simArmed.splice(i, 1); else _simArmed.push(file)
  // Changing the armed set invalidates any prior simulated "available" result, so
  // a stale "Update & restart" doesn't linger - drop back to a neutral state until
  // the next "Check now".
  if (typeof lclUpdate !== 'undefined' && lclUpdate && lclUpdate.simulated) {
    lclUpdate = makeUpdateState({ channel:'alpha', ref:'alpha', inSync:true, hash:lclUpdate.hash, installedAt:lclUpdate.installedAt })
    if (typeof renderUpdateBadge === 'function') renderUpdateBadge()
  }
  if (typeof toast === 'function') toast(_simArmed.length ? ('Armed: ' + _simArmed.join(', ') + ' \u2014 click "Check now" to simulate') : 'Simulation cleared', 'info')
  if (typeof renderUpdateSettings === 'function') renderUpdateSettings()
}

async function simulateUpdate(files){
  files = Array.isArray(files) ? files : (files ? [files] : [])
  _simArmed = []
  if (!files.length) return
  if (typeof demoOn === 'function' && demoOn()) { toast('Demo mode \u2014 simulate is a no-op','info'); return }
  const label = files.join(', ')
  try{
    toast('Simulating update (' + label + ')\u2026','info')
    const r = await httpPost('/api/update/simulate', { files })
    const d = await r.json()
    if (d.error){ toast('Simulate failed: ' + d.error,'err'); return }
    if (d.restartNeeded){
      toast('Applied (' + label + '). Restarting Node.js\u2026','ok')
      try { await httpPost('/api/update/restart') } catch {}
      waitForServerThenReload()
      return
    }
    if (d.refreshNeeded){ toast('Applied (' + label + '). Reloading\u2026','ok'); setTimeout(()=>location.reload(), 700); return }
    toast('Simulated apply done','ok')
  }catch(e){ toast('Simulate failed: ' + e.message,'err') }
}

// After a server restart request, poll /api/health until the new server answers,
// then reload so the page picks up the new index.html.
async function waitForServerThenReload(){
  for (let i=0;i<60;i++){
    await new Promise(r=>setTimeout(r,500))
    try { const h = await httpGet('/api/health',{cache:'no-store'}); if (h.ok){ location.reload(); return } } catch {}
  }
  toast('Server still restarting — reload when ready','info')
}
