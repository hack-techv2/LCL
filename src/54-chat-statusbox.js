// =============================================================================
// Shared status box — the error / retry / rate-limit panel rendered inside an
// AI bubble's body. Single source of truth for this styling, used by the 5xx
// auto-retry (53), the 429 rate-limit wait (52), and the #demo previews (96).
// =============================================================================
const STATUS_ICON = {
  err:   '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a7 7 0 100 14A7 7 0 008 1zm0 1a6 6 0 110 12A6 6 0 018 2zm-.75 3.75a.75.75 0 011.5 0v3.5a.75.75 0 01-1.5 0v-3.5zm.75 6a.75.75 0 110-1.5.75.75 0 010 1.5z"/></svg>',
  clock: '<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 3.5a.5.5 0 01.5.5v4.5l3 1.5a.5.5 0 01-.4.9l-3.3-1.65A.5.5 0 017.5 8.5V4a.5.5 0 01.5-.5z"/><path d="M8 16A8 8 0 108 0a8 8 0 000 16zM1 8a7 7 0 1114 0A7 7 0 011 8z"/></svg>'
}

// tone: 'err' (red) | 'warn' (amber). title: header text. bodyHtml: inner body.
// opts: { icon:'err'|'clock' (defaults by tone), cancel: a JS expression string that adds a Cancel button }
function statusBox(tone, title, bodyHtml, opts) {
  opts = opts || {}
  const c = tone === 'warn'
    ? { bg: 'var(--pinbg)',            border: 'rgba(240,165,0,.35)', fg: 'var(--pin)' }
    : { bg: 'rgba(220,60,60,.08)',     border: 'rgba(220,60,60,.3)',  fg: '#e05050'   }
  const icon = STATUS_ICON[opts.icon || (tone === 'warn' ? 'clock' : 'err')] || ''
  const cancel = opts.cancel
    ? '<div style="margin-top:10px"><button class="btn-s" style="font-size:11px;padding:4px 12px" onclick="' + opts.cancel + '">Cancel retry</button></div>'
    : ''
  return '<div style="background:' + c.bg + ';border:1px solid ' + c.border + ';border-radius:10px;padding:14px 16px;margin-top:14px;">' +
    '<div style="display:flex;align-items:center;gap:8px;font-weight:600;color:' + c.fg + ';margin-bottom:8px;font-size:13px">' + icon + title + '</div>' +
    '<div style="font-size:12px;color:var(--tx2);line-height:1.7">' + bodyHtml + '</div>' +
    cancel + '</div>'
}
