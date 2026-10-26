// Explicit semantic allowlist. Unknown envelopes remain available in Swarm.
export const SEMANTIC_EVENT_TYPES = new Set([
  'MESSAGE_FINAL', 'INTER_AGENT_MESSAGE', 'INTER_AGENT_HANDOFF', 'TASK_DELEGATED', 'MISSION_STATE'
]);
const idOf = value => String(value || '').replace(/^(agent|user):/, '');
const text = value => typeof value === 'string' ? value.trim().slice(0, 240) : '';
const missionLabels = {
  running: 'Misi mulai berjalan', paused: 'Misi dijeda', waiting_approval: 'Misi menunggu persetujuan',
  waiting_input: 'Misi menunggu jawaban', succeeded: 'Misi berhasil', completed: 'Misi selesai',
  failed: 'Misi gagal', cancelled: 'Misi dibatalkan', canceled: 'Misi dibatalkan'
};
export function selectOverviewActivities(state, limit = 8) {
  const mainIds = new Set((state.agents || []).filter(agent =>
    agent.is_main === true || agent.role === 'main' || idOf(agent.id) === 'main').map(agent => idOf(agent.id)));
  const sessionAgents = new Map((state.sessions || []).filter(session => mainIds.has(idOf(session.agent_id))).map(session => [session.id, idOf(session.agent_id)]));
  for (const agent of state.agents || []) if (mainIds.has(idOf(agent.id)) && agent.active_direct_session_id) sessionAgents.set(agent.active_direct_session_id, idOf(agent.id));
  const result = new Map();
  const addMessage = (message, event = null) => {
    const id = message.id || message.message_id;
    const session = message.session_id;
    const sender = idOf(message.sender_id || event?.sender);
    const kind = message.sender_kind || (String(event?.sender || '').startsWith('user:') ? 'user' : 'agent');
    if (!id || !sessionAgents.has(session) || !['user', 'agent'].includes(kind) || kind === 'agent' && !mainIds.has(sender)) return;
    result.set(`message:${id}`, {
      id: `message:${id}`, kind: 'chat', title: kind === 'user' ? 'Anda mengirim pesan ke Main' : 'Main membalas pesan',
      description: text(message.content) || 'Pesan diterima backend.', timestamp: message.created_at || event?.timestamp,
      action: 'chat', targetId: sessionAgents.get(session), sessionId: session
    });
  };
  // Walk chronologically so repeated reports of the same mission state collapse.
  const missionStatus = new Map();
  for (const event of [...(state.activityEvents || state.events || [])].reverse()) {
    const payload = event.payload || {};
    if (event.event_type === 'MESSAGE_FINAL') {
      const message = payload.message || payload;
      addMessage(message, event);
    } else if (['INTER_AGENT_MESSAGE', 'INTER_AGENT_HANDOFF', 'TASK_DELEGATED'].includes(event.event_type)) {
      const from = idOf(payload.from_agent_id || payload.source_agent_id || event.sender);
      const to = idOf(payload.to_agent_id || payload.target_agent_id || payload.assigned_agent_id);
      if (!from || !to || !(mainIds.has(from) || mainIds.has(to))) continue;
      const name = id => state.agents?.find(agent => idOf(agent.id) === id)?.name || id;
      result.set(`handoff:${event.event_id}`, {
        id: `handoff:${event.event_id}`, kind: 'handoff', title: `${name(from)} → ${name(to)}`,
        description: text(payload.content || payload.summary) || 'Delegasi atau komunikasi antaragen.',
        timestamp: event.timestamp, action: 'navigate', page: 'swarm'
      });
    } else if (event.event_type === 'MISSION_STATE') {
      const mission = payload.mission || payload;
      const id = mission.id || payload.mission_id;
      const status = mission.status;
      if (!id || !missionLabels[status] || missionStatus.get(id) === status) continue;
      missionStatus.set(id, status);
      result.set(`mission:${event.event_id}`, {
        id: `mission:${event.event_id}`, kind: 'mission', title: missionLabels[status],
        description: text(mission.title) || state.missions?.find(record => record.id === id)?.title || id,
        timestamp: event.timestamp, action: 'mission-detail', targetId: id
      });
    }
  }
  for (const messages of Object.values(state.messages || {})) for (const message of messages) {
    if (message.status !== 'streaming') addMessage(message);
  }
  return [...result.values()].sort((a, b) => (Date.parse(b.timestamp) || 0) - (Date.parse(a.timestamp) || 0) || a.id.localeCompare(b.id)).slice(0, limit);
}
