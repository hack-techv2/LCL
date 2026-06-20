// =============================================================================
// Auto-update — checks GitHub releases via the local server (server.txt does
// the network + file work; this is the display + consent layer).
// =============================================================================
let lclUpdate = { checked:false, channel:'stable', current:'', latest:'', tag:'', newer:false, notes:'', html_url:'', error:null, ref:'alpha', inSync:true, changed:[], hash:'', installedAt:null }

// Normalize any partial update payload into the full lclUpdate shape so every
// assignment site carries the same keys (the error path used to drop most of
// them, and `applied` could go stale). Always resets `applied` unless provided.
function makeUpdateState(d){ d=d||{}; return { checked:true, channel:d.channel||'stable', current:d.current||'', latest:d.latest||'', tag:d.tag||'', newer:!!d.newer, notes:d.notes||'', html_url:d.html_url||'', error:d.error||null, ref:d.ref||'alpha', inSync:!!d.inSync, changed:d.changed||[], hash:d.hash||'', installedAt:d.installedAt||null, simulated:!!d.simulated, sameAsStable:!!d.sameAsStable, applied:d.applied||null } }

// Compact "updated <date>" for the experimental build line (e.g. 21 Jun 2026).
function fmtUpdated(ms){
  if (!ms) return ''
  try { return new Date(ms).toLocaleString([], { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) }
  catch { return '' }
}

function setUpdateAuto(on){ try{ localStorage.setItem('lcl_upd_auto', on?'1':'0') }catch{} }
function updateAutoOn(){ try{ return (localStorage.getItem('lcl_upd_auto') ?? '1') === '1' }catch{ return true } }

async function checkForUpdate(manual){
  if (typeof demoOn === 'function' && demoOn()) { if (manual) toast('Demo mode \u2014 update check simulated', 'info'); return }
  // Dev/test: if a simulation is armed (armSimulate), report that file as an
  // available alpha update instead of hitting the network. "Update & restart"
  // then runs the real self-copy apply+restart (simulateUpdate).
  if (typeof _simArmed !== 'undefined' && _simArmed && _simArmed.length) {
    lclUpdate = makeUpdateState({ channel:'alpha', ref:'alpha', inSync:false, changed:_simArmed.slice(),
      hash:'sim' + Date.now().toString(36).slice(-5), installedAt:Date.now(), simulated:true })
    renderUpdateBadge(); renderUpdateSettings()
    if (manual) toast('Simulated update available (' + _simArmed.join(', ') + ')', 'ok')
    return
  }
  try{
    const r = await httpGet('/api/update/check')
    const d = await r.json()
    lclUpdate = makeUpdateState(d)
  }catch(e){ lclUpdate = makeUpdateState({ channel: lclUpdate.channel || 'stable', error:e.message, hash:lclUpdate.hash, installedAt:lclUpdate.installedAt }) }
  renderUpdateBadge(); renderUpdateSettings()
  if (manual){
    if (lclUpdate.error) toast('Update check failed: '+lclUpdate.error,'err')
    else if (lclUpdate.channel==='alpha') toast(lclUpdate.inSync ? ('Alpha: in sync ('+lclUpdate.hash+')') : ('Alpha: changes on @'+lclUpdate.ref+' — restart Node to apply'),'ok')
    else if (lclUpdate.newer) toast('Update available: '+lclUpdate.tag,'ok')
    else toast("You're on the latest version",'ok')
  }
}

function renderUpdateBadge(){
  const va = document.getElementById('ver-alpha')
  if (va) va.style.display = (lclUpdate.channel === 'alpha') ? 'inline-block' : 'none'
  const el = document.getElementById('footer-upd')
  if (!el) return
  // Stable only: the footer "new" badge shows for a version update. Alpha tracks
  // a build hash and doesn't surface the green footer badge.
  const show = lclUpdate.channel === 'alpha' ? false : !!lclUpdate.newer
  if (show){ el.style.display='inline-block'; el.setAttribute('data-tip', 'Update available: '+lclUpdate.tag) }
  else el.style.display='none'
}

function initUpdates(){ if (updateAutoOn()) checkForUpdate(false) }
