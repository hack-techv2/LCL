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
    if (u.error){ p = pill('err','Check failed'); build = '\u2014' }
    else if (u.applied){ p = pill('ok','Updated'); build = h + when; if (u.applied.refreshNeeded) primary = '<button class="upd-btn pri" onclick="location.reload()">Reload now</button>' }
    else if (u.inSync){ p = pill('ok','Up to date'); build = h + when }
    else { p = pill('warn','Update available'); build = h + ' <span class="upd-sub">'+(u.changed||[]).map(esc).join(', ')+' changed</span>'
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
