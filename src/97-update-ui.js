// =============================================================================
// Auto-update — Settings card UI + stable update dialog
// =============================================================================

function renderUpdateSettings(){
  const body = document.getElementById('upd-body')
  if (!body) return
  const u = lclUpdate
  const vb = document.getElementById('ver-badge')
  const cur = u.current || (vb ? vb.textContent.replace(/^v/i,'') : '')
  const pill = (cls,txt)=> '<span class="upd-pill '+cls+'">'+txt+'</span>'
  const tile = (k,val,col)=> '<div class="upd-metric"><div class="upd-mk">'+k+'</div><div class="upd-mv"'+(col?(' style="color:'+col+'"'):'')+'>'+val+'</div></div>'
  const top  = (lbl,p)=> '<div class="upd-top"><span style="font-size:12px;color:var(--tx2)">'+lbl+'</span>'+p+'</div>'
  const autoRow = (right)=> '<div class="upd-row"><label class="upd-auto"><input type="checkbox" id="upd-auto" '+(updateAutoOn()?'checked':'')+' onchange="setUpdateAuto(this.checked)"><span class="upd-sw"></span>Check on launch</label>'+right+'</div>'
  const testerRow = ()=> '<div class="upd-row"><label class="upd-auto"><input type="checkbox" onchange="setChannel(this.checked?\'alpha\':\'stable\')"><span class="upd-sw"></span>Try alpha updates</label><span style="font-size:11px;color:var(--tx3)">tester</span></div>'
  if (!u.checked){ body.innerHTML = top('Updates', pill('neutral','Not checked')) + autoRow('<button class="upd-btn" onclick="checkForUpdate(true)">Check now</button>'); return }
  if (u.channel === 'alpha'){
    if (u.error){
      body.innerHTML = top('Channel', pill('err','Alpha · check failed'))
        + '<div style="font-size:11px;color:var(--tx3);margin-top:9px">'+esc(u.error)+'</div>'
        + '<div class="upd-row"><span style="font-size:11px;color:var(--tx3)">tracking @'+esc(u.ref||'alpha')+'</span><span style="display:flex;gap:8px"><button class="upd-btn" onclick="checkForUpdate(true)">Retry</button><button class="upd-btn" onclick="setChannel(\'stable\')">Switch to stable</button></span></div>'
      return
    }
    if (u.applied){
      const ap = u.applied
      const note = (ap.refreshNeeded?'Reload for new index':'') + (ap.refreshNeeded&&ap.restartNeeded?' · ':'') + (ap.restartNeeded?'restart Node for new server':'')
      body.innerHTML = top('Channel', pill('ok','Alpha · updated'))
        + '<div style="font-size:12px;color:var(--ok);margin-top:11px">Downloaded &amp; verified '+esc((ap.applied||[]).join(', ')||'(already current)')+'</div>'
        + (note ? '<div style="font-size:11px;color:var(--pin);margin-top:6px">'+note+'</div>' : '')
        + '<div class="upd-row">'+(ap.refreshNeeded?'<button class="upd-btn pri" onclick="location.reload()">Reload now</button>':'<span></span>')+'<button class="upd-btn" onclick="setChannel(\'stable\')">Switch to stable</button></div>'
      return
    }
    // Compact one-liner: Channel | Alpha · status · build/changed
    const sPill = u.inSync ? pill('ok','Up to date') : pill('warn','Update available')
    const buildBit = u.inSync
      ? '<span class="upd-build">'+esc(u.hash||'—')+'</span>'
      : '<span class="upd-build" title="'+esc((u.changed||[]).join(', '))+'">'+esc((u.changed||[]).join(', ')||'—')+'</span>'
    body.innerHTML = top('Channel', '<span class="upd-line">'+pill('alpha','Alpha')+sPill+buildBit+'</span>')
      + '<div class="upd-row"><span style="display:flex;gap:8px"><button class="upd-btn" onclick="checkForUpdate(true)">Check updates</button>'+(u.inSync?'':'<button class="upd-btn pri" onclick="applyAlphaNow()">Update &amp; restart</button>')+'</span><button class="upd-btn" onclick="setChannel(\'stable\')">Switch to stable</button></div>'
    return
  }
  if (u.error){
    body.innerHTML = top('Version', pill('err','Check failed'))
      + '<div style="font-size:11px;color:var(--tx3);margin-top:9px">'+esc(u.error)+'</div>'
      + autoRow('<button class="upd-btn" onclick="checkForUpdate(true)">Retry</button>')
    return
  }
  body.innerHTML = top('Version', u.newer ? pill('warn','Update available') : pill('ok','Up to date'))
    + '<div class="upd-mets">'+tile('Installed', cur?('v'+esc(cur)):'—')+tile('Latest', u.latest?('v'+esc(u.latest)):'—', u.newer?'var(--ok)':'var(--tx)')+'</div>'
    + autoRow(u.newer ? '<button class="upd-btn pri" onclick="openUpdateDialog()">Update to v'+esc(u.latest||'')+'</button>' : '<button class="upd-btn" onclick="checkForUpdate(true)">Check now</button>') + (alphaUnlocked() ? testerRow() : '')
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
