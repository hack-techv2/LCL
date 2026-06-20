// =============================================================================
// Auto-update — channel switch (stable/alpha) + alpha apply/restart
// =============================================================================

// Channel switch (alpha tester channel <-> stable). Persisted server-side.
async function setChannel(ch){
  if (typeof demoOn === 'function' && demoOn()) {
    // Demo: flip the in-memory state so both the version-based (stable) and
    // hash-based (experimental) update cards can be previewed. Touches nothing.
    if (ch === 'alpha') lclUpdate = { checked:true, channel:'alpha', current:'0.67c', ref:'alpha', inSync:false, changed:['index.html','server.txt','styles.css'], hash:'a1b2c3d', installedAt:Date.now()-86400000, error:null }
    else lclUpdate = { checked:true, channel:'stable', current:'0.67c', latest:'0.67d', tag:'v0.67d', newer:true, inSync:true, changed:[], hash:'', error:null }
    if (ch !== 'alpha') relockAlpha()
    if (typeof renderUpdateBadge === 'function') renderUpdateBadge()
    renderUpdateSettings()
    return
  }
  toast('Switching to ' + (ch==='alpha' ? 'experimental' : 'stable') + '\u2026', 'info')
  try{
    const r = await httpPost('/api/update/channel', { channel: ch })
    const d = await r.json()
    if (d.error){ const stay = (d.channel === 'alpha') ? 'experimental' : 'stable'; toast('Channel switch failed: '+d.error+' \u2014 staying on '+stay,'err'); await checkForUpdate(true); return }
    if (d.sameAsStable){ toast('Experimental build is identical to stable \u2014 nothing to switch','info'); await checkForUpdate(true); return }
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

// Dev/test (alpha): run the REAL apply+restart pipeline but reuse the current file
// (the server copies it onto itself instead of downloading), so the restart/reload
// flow can be exercised on a live alpha build without a new build.
async function simulateUpdate(file){
  if (typeof demoOn === 'function' && demoOn()) { toast('Demo mode \u2014 simulate is a no-op','info'); return }
  try{
    toast('Simulating update (' + file + ')\u2026','info')
    const r = await httpPost('/api/update/simulate', { file })
    const d = await r.json()
    if (d.error){ toast('Simulate failed: ' + d.error,'err'); return }
    if (d.restartNeeded){
      toast('Applied (' + file + '). Restarting Node.js\u2026','ok')
      try { await httpPost('/api/update/restart') } catch {}
      waitForServerThenReload()
      return
    }
    if (d.refreshNeeded){ toast('Applied (' + file + '). Reloading\u2026','ok'); setTimeout(()=>location.reload(), 700); return }
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
