export const ACTIVE_STATUSES = new Set([
  'running',
  'queued',
  'planning',
  'paused',
  'waiting_approval',
  'waiting_input',
  'waiting',
  'active'
]);

export const TERMINAL_STATUSES = new Set([
  'succeeded',
  'completed',
  'failed',
  'cancelled'
]);

export function isActiveMission(mission) {
  if (!mission || typeof mission !== 'object') return false;
  const status = String(mission.status || '').toLowerCase().trim();
  if (ACTIVE_STATUSES.has(status)) return true;
  if (TERMINAL_STATUSES.has(status)) return false;
  // If status is unknown, don't automatically treat as running if it looks terminal
  return !status.includes('fail') && !status.includes('cancel') && !status.includes('done') && !status.includes('complete');
}

export function isTerminalMission(mission) {
  if (!mission || typeof mission !== 'object') return false;
  const status = String(mission.status || '').toLowerCase().trim();
  return TERMINAL_STATUSES.has(status);
}

export function normalizeMission(record) {
  if (!record || typeof record !== 'object') return null;
  const id = String(record.id || record.mission_id || '');
  const title = String(record.title || record.name || 'Untitled Mission');
  const prompt = String(record.prompt || record.description || '');
  const status = String(record.status || 'unknown').toLowerCase().trim();
  
  let progress = null;
  if (record.progress_percent !== undefined && record.progress_percent !== null) {
    const num = Number(record.progress_percent);
    if (!Number.isNaN(num)) {
      progress = Math.max(0, Math.min(100, Math.round(num)));
    }
  }

  return {
    id,
    title,
    prompt,
    status,
    progress_percent: progress,
    current_milestone_id: record.current_milestone_id || null,
    updated_at: record.updated_at || null,
    allowed_actions: Array.isArray(record.allowed_actions) ? record.allowed_actions : ['pause', 'resume', 'cancel'],
    milestones: Array.isArray(record.milestones) ? record.milestones : [],
    tasks: Array.isArray(record.tasks) ? record.tasks : [],
    detail_complete: Boolean(record.detail_complete)
  };
}

export function selectActiveMissions(missions) {
  if (!Array.isArray(missions)) return [];
  const normalized = missions.map(normalizeMission).filter(Boolean);
  const active = normalized.filter(isActiveMission);
  
  return active.sort((a, b) => {
    const aRunning = a.status === 'running' ? 1 : 0;
    const bRunning = b.status === 'running' ? 1 : 0;
    if (aRunning !== bRunning) return bRunning - aRunning;

    const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    if (aTime !== bTime) return bTime - aTime;

    return a.id.localeCompare(b.id);
  });
}

export function selectMissionHistory(missions) {
  if (!Array.isArray(missions)) return [];
  const normalized = missions.map(normalizeMission).filter(Boolean);
  const history = normalized.filter(m => !isActiveMission(m));
  
  return history.sort((a, b) => {
    const aTime = a.updated_at ? new Date(a.updated_at).getTime() : 0;
    const bTime = b.updated_at ? new Date(b.updated_at).getTime() : 0;
    return bTime - aTime;
  });
}

export function selectMissionAssignments(detail, agentsById = {}) {
  if (!detail || !Array.isArray(detail.tasks)) return [];
  const result = [];
  for (const task of detail.tasks) {
    const agentId = task.assigned_agent_id || task.agent_id;
    if (!agentId) continue;
    const agent = agentsById[agentId];
    result.push({
      taskId: task.id,
      taskTitle: task.title || task.name || '',
      agentId,
      agentName: agent ? (agent.name || agent.title || agentId) : agentId,
      status: task.status || 'unknown',
      executionState: task.execution_state || (task.status === 'running' ? 'executing' : 'assigned'),
      nodeId: task.node_id || null,
      attemptId: task.attempt_id || null
    });
  }
  return result;
}

export function selectExecutingAgents(detail, agentsById = {}) {
  const assignments = selectMissionAssignments(detail, agentsById);
  const map = new Map();
  for (const item of assignments) {
    const isExecuting = item.executionState === 'executing' || item.status === 'running';
    if (!isExecuting) continue;
    if (!map.has(item.agentId)) {
      map.set(item.agentId, {
        agentId: item.agentId,
        agentName: item.agentName,
        taskCount: 0
      });
    }
    map.get(item.agentId).taskCount++;
  }
  return Array.from(map.values());
}
