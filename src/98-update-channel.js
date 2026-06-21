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
