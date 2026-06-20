// =============================================================================
// Auto-update — channel switch (stable/alpha) + alpha apply/restart
// =============================================================================

// Channel switch (alpha tester channel <-> stable). Persisted server-side.
async function setChannel(ch){
  if (typeof demoOn === 'function' && demoOn()) {
    // Demo: flip the in-memory state so both the version-based (stable) and
    // hash-based (experimental) update cards can be previewed. Touches nothing.
    if (ch === 'alpha') lclUpdate = { checked:true, channel:'alpha', current:'0.67c', ref:'alpha', inSync:false, changed:['index.html','server.txt','styles.css'], hash:'a1b2c3d', error:null }
    else lclUpdate = { checked:true, channel:'stable', current:'0.67c', latest:'0.67d', tag:'v0.67d', newer:true, inSync:true, changed:[], hash:'', error:null }
    if (typeof renderUpdateBadge === 'function') renderUpdateBadge()
    renderUpdateSettings()
    return
  }
  toast('Switching to ' + (ch==='alpha' ? 'experimental' : 'stable') + '\u2026', 'info')
  try{
    const r = await fetch('/api/update/channel',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({channel:ch}) })
    const d = await r.json()
    if (d.error){ toast('Experimental switch failed: '+d.error+' \u2014 staying on stable','err'); await checkForUpdate(true); return }
    if (d.restartNeeded){
      const msg = ch==='alpha'
        ? 'Experimental build applied'
        : (d.restoredFromBackup ? 'Offline \u2014 restored local stable backup' : ('Restored stable '+((d.restored&&d.restored.tag)||'')))
      toast(msg+' \u2014 restarting Node\u2026','ok')
      try{ await fetch('/api/update/restart',{ method:'POST' }) }catch{}
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
  if (typeof demoOn === 'function' && demoOn()) { _demoAlphaUnlocked = true }
  else { try { localStorage.setItem('lcl_alpha_unlocked', '1') } catch {} }
  if (typeof toast === 'function') toast('Developer mode enabled','ok')
  if (typeof renderUpdateSettings === 'function') renderUpdateSettings()
}

// Front-end alpha apply: download + verify the alpha pair via the server, then
// prompt reload (index) / restart (server). Boot-time auto-update still exists.
async function applyAlphaNow(){
  if (typeof demoOn === 'function' && demoOn()) {
    toast('Downloading alpha build\u2026 (demo)', 'info')
    setTimeout(() => {
      lclUpdate = { checked:true, channel:'alpha', current:'0.67c', ref:'alpha', inSync:true, changed:[], hash:'e4f5a6b', error:null }
      renderUpdateBadge(); renderUpdateSettings()
      toast('Alpha updated to #e4f5a6b (demo) \u2014 Reset demo to replay', 'ok')
    }, 1200)
    return
  }
  try{
    toast('Downloading alpha update...','info')
    const r = await fetch('/api/update/apply', { method:'POST' })
    const d = await r.json()
    if (d.error){ toast('Update failed: '+d.error,'err'); return }
    const applied = (d.applied||[]).join(', ') || 'no changes'
    if (d.restartNeeded){
      toast('Applied ('+applied+'). Restarting Node…','ok')
      try { await fetch('/api/update/restart', { method:'POST' }) } catch {}
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

// After a server restart request, poll /api/health until the new server answers,
// then reload so the page picks up the new index.html.
async function waitForServerThenReload(){
  for (let i=0;i<60;i++){
    await new Promise(r=>setTimeout(r,500))
    try { const h = await fetch('/api/health',{cache:'no-store'}); if (h.ok){ location.reload(); return } } catch {}
  }
  toast('Server still restarting — reload when ready','info')
}
