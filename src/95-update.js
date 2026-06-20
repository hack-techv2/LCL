// =============================================================================
// Auto-update — checks GitHub releases via the local server (server.txt does
// the network + file work; this is the display + consent layer).
// =============================================================================
let lclUpdate = { checked:false, channel:'stable', current:'', latest:'', tag:'', newer:false, notes:'', html_url:'', error:null, ref:'alpha', inSync:true, changed:[], hash:'' }

// Normalize any partial update payload into the full lclUpdate shape so every
// assignment site carries the same keys (the error path used to drop most of
// them, and `applied` could go stale). Always resets `applied` unless provided.
function makeUpdateState(d){ d=d||{}; return { checked:true, channel:d.channel||'stable', current:d.current||'', latest:d.latest||'', tag:d.tag||'', newer:!!d.newer, notes:d.notes||'', html_url:d.html_url||'', error:d.error||null, ref:d.ref||'alpha', inSync:!!d.inSync, changed:d.changed||[], hash:d.hash||'', sameAsStable:!!d.sameAsStable, applied:d.applied||null } }

function setUpdateAuto(on){ try{ localStorage.setItem('lcl_upd_auto', on?'1':'0') }catch{} }
function updateAutoOn(){ try{ return (localStorage.getItem('lcl_upd_auto') ?? '1') === '1' }catch{ return true } }

async function checkForUpdate(manual){
  if (typeof demoOn === 'function' && demoOn()) { if (manual) toast('Demo mode \u2014 update check simulated', 'info'); return }
  try{
    const r = await fetch('/api/update/check')
    const d = await r.json()
    lclUpdate = makeUpdateState(d)
  }catch(e){ lclUpdate = makeUpdateState({ channel:'stable', error:e.message }) }
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
