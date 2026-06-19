// =============================================================================
// Auto-update — channel switch (stable/alpha) + alpha apply/restart
// =============================================================================

// Channel switch (alpha tester channel <-> stable). Persisted server-side.
async function setChannel(ch){
  try{
    const r = await fetch('/api/update/channel',{ method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({channel:ch}) })
    const d = await r.json()
    if (ch==='stable' && d.restored) toast('Restored stable '+(d.restored.tag||'')+' — restart Node & refresh','ok')
    else if (ch==='stable' && d.restoreError) toast('Switched to stable; restore failed: '+d.restoreError,'err')
    else if (ch==='alpha') toast('Alpha on — restart Node to begin auto-updating','ok')
  }catch(e){ toast('Channel switch failed: '+e.message,'err') }
  await checkForUpdate(true)
}

// Alpha enrolment is gated behind the easter egg: 7 clicks on the version badge
// unlock the "Try alpha updates" toggle inside Settings -> Updates.
function alphaUnlocked(){ try { return localStorage.getItem('lcl_alpha_unlocked') === '1' } catch { return false } }
function unlockAlpha(){ try { localStorage.setItem('lcl_alpha_unlocked', '1') } catch {}; if (typeof toast === 'function') toast('Tester options unlocked - Open Settings','ok'); if (typeof renderUpdateSettings === 'function') renderUpdateSettings() }

// Front-end alpha apply: download + verify the alpha pair via the server, then
// prompt reload (index) / restart (server). Boot-time auto-update still exists.
async function applyAlphaNow(){
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
