// Overview "aktif" means executing; queued/paused/unknown stay visible in waiting.
export const ACTIVE_STATUSES = new Set(['running']);
export const TERMINAL_STATUSES = new Set(['succeeded', 'completed', 'failed', 'cancelled', 'canceled']);
const statusOf = mission => String(mission?.status || '').toLowerCase().trim();
export const isActiveMission = mission => ACTIVE_STATUSES.has(statusOf(mission));
export const isTerminalMission = mission => TERMINAL_STATUSES.has(statusOf(mission));
const timestamp = mission => Date.parse(mission.updated_at || '') || 0;
const newestFirst = (a, b) => timestamp(b) - timestamp(a) || a.id.localeCompare(b.id);
const normalized = missions => Array.isArray(missions) ? missions.map(normalizeMission).filter(Boolean) : [];

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
  return normalized(missions).filter(isActiveMission).sort(newestFirst);
}

export function selectPrimaryMission(missions) {
  return selectActiveMissions(missions)[0] || null;
}
export function selectMissionQueue(missions) {
  return normalized(missions).filter(m => !isActiveMission(m) && !isTerminalMission(m)).sort(newestFirst);
}
export function selectMissionHistory(missions) {
  return normalized(missions).filter(isTerminalMission).sort(newestFirst);
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
