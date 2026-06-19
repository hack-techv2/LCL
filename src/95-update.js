// =============================================================================
// Auto-update — checks GitHub releases via the local server (server.txt does
// the network + file work; this is the display + consent layer).
// =============================================================================
let lclUpdate = { checked:false, current:'', latest:'', tag:'', newer:false, notes:'', html_url:'', error:null }

function setUpdateAuto(on){ try{ localStorage.setItem('lcl_upd_auto', on?'1':'0') }catch{} }
function updateAutoOn(){ try{ return (localStorage.getItem('lcl_upd_auto') ?? '1') === '1' }catch{ return true } }

async function checkForUpdate(manual){
  try{
    const r = await fetch('/api/update/check')
    const d = await r.json()
    lclUpdate = { checked:true, current:d.current||'', latest:d.latest||'', tag:d.tag||'',
                  newer:!!d.newer, notes:d.notes||'', html_url:d.html_url||'', error:d.error||null }
  }catch(e){ lclUpdate = { checked:true, error:e.message } }
  renderUpdateBadge(); renderUpdateSettings()
  if (manual){
    if (lclUpdate.error) toast('Update check failed: '+lclUpdate.error,'err')
    else if (lclUpdate.newer) toast('Update available: '+lclUpdate.tag,'ok')
    else toast("You're on the latest version",'ok')
  }
}

function renderUpdateBadge(){
  const el = document.getElementById('footer-upd')
  if (!el) return
  if (lclUpdate.newer){ el.style.display='inline-block'; el.setAttribute('data-tip','Update available: '+lclUpdate.tag) }
  else el.style.display='none'
}

function renderUpdateSettings(){
  const auto = document.getElementById('upd-auto')
  if (auto) auto.checked = updateAutoOn()
  const body = document.getElementById('sp-update-body')
  const btn  = document.getElementById('sp-update-btn')
  if (!body) return
  if (!lclUpdate.checked){ body.textContent='Not checked yet.'; if(btn)btn.style.display='none'; return }
  if (lclUpdate.error){
    body.innerHTML="Couldn't reach GitHub (<span style=\"color:var(--tx3)\">"+esc(lclUpdate.error)+"</span>). Check network access to api.github.com."
    if(btn)btn.style.display='none'; return
  }
  let html = 'Installed: <span style="font-family:var(--mono);color:var(--tx)">v'+esc(lclUpdate.current)+'</span><br>'+
    'Latest: <span style="font-family:var(--mono);color:'+(lclUpdate.newer?'var(--ok)':'var(--tx)')+'">'+(lclUpdate.latest?('v'+esc(lclUpdate.latest)):'—')+'</span>'
  if (!lclUpdate.newer) html += '<br><span style="color:var(--tx3)">You are up to date.</span>'
  body.innerHTML = html
  if (btn) btn.style.display = lclUpdate.newer ? 'inline-flex' : 'none'
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
  bd.addEventListener('click', e=>{ if(e.target===bd) closeUpdateDialog() })
}

function closeUpdateDialog(){ const el=document.getElementById('update-bd'); if(el) el.remove() }

async function applyUpdate(){
  const btn = document.getElementById('update-apply-btn')
  const out = document.getElementById('update-result')
  if (btn){ btn.disabled=true; btn.textContent='Working…' }
  if (out) out.innerHTML='<div style="color:var(--tx3);padding:6px 0">Downloading and verifying…</div>'
  try{
    const r = await fetch('/api/update/apply',{ method:'POST' })
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

function initUpdates(){ if (updateAutoOn()) checkForUpdate(false) }
