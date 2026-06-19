function initTheme() {
  const saved = localStorage.getItem('lcl_theme') || 'light'
  document.documentElement.setAttribute('data-theme', saved)
  const moonEl = document.getElementById('icon-moon')
  const sunEl  = document.getElementById('icon-sun')
  if (moonEl) moonEl.style.display = saved === 'dark' ? '' : 'none'
  if (sunEl)  sunEl.style.display  = saved === 'light' ? '' : 'none'

  // Inject comet logo into sidebar header
  const COMET = '<svg width="28" height="28" viewBox="0 0 22 22" fill="none" xmlns=\"http://www.w3.org/2000/svg\"><line x1=\"10\" y1=\"10\" x2=\"2\" y2=\"18\" stroke=\"white\" stroke-width=\"1.5\" stroke-linecap=\"round\" opacity=\"0.7\"/><line x1=\"11.5\" y1=\"10\" x2=\"4\" y2=\"18\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.45\"/><line x1=\"10\" y1=\"11.5\" x2=\"2\" y2=\"20\" stroke=\"white\" stroke-width=\"0.6\" stroke-linecap=\"round\" opacity=\"0.28\"/><rect x=\"9\" y=\"1\" width=\"11\" height=\"11\" rx=\"1.5\" fill=\"white\" opacity=\"0.95\"/><rect x=\"11\" y=\"3\" width=\"7\" height=\"7\" rx=\"0.5\" fill=\"#e8610a\"/><line x1=\"13.3\" y1=\"3\" x2=\"13.3\" y2=\"10\" stroke=\"white\" stroke-width=\"0.5\" opacity=\"0.6\"/><line x1=\"15.7\" y1=\"3\" x2=\"15.7\" y2=\"10\" stroke=\"white\" stroke-width=\"0.5\" opacity=\"0.6\"/><line x1=\"11\" y1=\"5.3\" x2=\"18\" y2=\"5.3\" stroke=\"white\" stroke-width=\"0.5\" opacity=\"0.6\"/><line x1=\"11\" y1=\"7.7\" x2=\"18\" y2=\"7.7\" stroke=\"white\" stroke-width=\"0.5\" opacity=\"0.6\"/><line x1=\"12.5\" y1=\"1\" x2=\"12.5\" y2=\"0\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"15\" y1=\"1\" x2=\"15\" y2=\"0\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"17.5\" y1=\"1\" x2=\"17.5\" y2=\"0\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"12.5\" y1=\"12\" x2=\"12.5\" y2=\"13.5\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"15\" y1=\"12\" x2=\"15\" y2=\"13.5\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"17.5\" y1=\"12\" x2=\"17.5\" y2=\"13.5\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"20\" y1=\"3.5\" x2=\"21.5\" y2=\"3.5\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"20\" y1=\"6.5\" x2=\"21.5\" y2=\"6.5\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"20\" y1=\"9.5\" x2=\"21.5\" y2=\"9.5\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"9\" y1=\"3.5\" x2=\"7.5\" y2=\"3.5\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"9\" y1=\"6.5\" x2=\"7.5\" y2=\"6.5\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/><line x1=\"9\" y1=\"9.5\" x2=\"7.5\" y2=\"9.5\" stroke=\"white\" stroke-width=\"1\" stroke-linecap=\"round\" opacity=\"0.8\"/></svg>'
  const iconEl = document.getElementById('tb-brand-icon')
  if (iconEl) iconEl.innerHTML = COMET
}

// Sidebar minimise / expand (state persisted in localStorage)
function toggleSidebar() {
  const collapsed = document.body.classList.toggle('sb-collapsed')
  localStorage.setItem('lcl_sb_collapsed', collapsed ? '1' : '0')
  updateSidebarToggle(collapsed)
}

function updateSidebarToggle(collapsed) {
  const btn = document.getElementById('sb-toggle')
  if (btn) btn.setAttribute('data-tip-bottom', collapsed ? 'Expand sidebar' : 'Collapse sidebar')
}

function initSidebar() {
  const collapsed = localStorage.getItem('lcl_sb_collapsed') === '1'
  document.body.classList.toggle('sb-collapsed', collapsed)
  updateSidebarToggle(collapsed)
}
