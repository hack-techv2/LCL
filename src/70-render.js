// =============================================================================
// Render — core orchestration + small shared helpers
// =============================================================================

function renderAll() {
  renderChatList(); renderTopbar(); renderMessages(); renderDocPanel(); updateDocsBtn()
  updateSendBtn()
  renderSkillPicker(); renderSkillChip()
}

function renderTopbar() {
  const chat = curChat()
  const subEl = document.getElementById('tb-chat-title'); if(subEl) subEl.textContent = (chat && chat.title && chat.title !== 'New chat') ? chat.title : ''
}

// Returns the appropriate "Connected" status label based on whether the
// embedding key is also configured. Used by setHealth() callers.
function connectedLabel() {
  if (!creds) return 'Idle'
  return (creds.embedApiKey && creds.embedModelId)
    ? 'Chat + embed'
    : 'Chat only'
}
