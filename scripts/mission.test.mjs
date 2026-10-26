import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isActiveMission,
  isTerminalMission,
  normalizeMission,
  selectActiveMissions,
  selectMissionHistory,
  selectMissionQueue,
  selectPrimaryMission,
  selectMissionAssignments,
  selectExecutingAgents
} from '../src/mission_model.js';

test('mission status categorization correctly differentiates active from terminal', () => {
  assert.equal(isActiveMission({ status: 'running' }), true);
  assert.equal(isActiveMission({ status: 'queued' }), false);
  assert.equal(isActiveMission({ status: 'paused' }), false);
  assert.equal(isActiveMission({ status: 'planning' }), false);

  assert.equal(isActiveMission({ status: 'completed' }), false);
  assert.equal(isActiveMission({ status: 'succeeded' }), false);
  assert.equal(isActiveMission({ status: 'failed' }), false);
  assert.equal(isActiveMission({ status: 'cancelled' }), false);

  assert.equal(isTerminalMission({ status: 'completed' }), true);
  assert.equal(isTerminalMission({ status: 'succeeded' }), true);
  assert.equal(isTerminalMission({ status: 'running' }), false);
});

test('normalizeMission clamps progress_percent to 0-100 or keeps null', () => {
  assert.equal(normalizeMission({ id: 'm1', progress_percent: 120 }).progress_percent, 100);
  assert.equal(normalizeMission({ id: 'm2', progress_percent: -10 }).progress_percent, 0);
  assert.equal(normalizeMission({ id: 'm3', progress_percent: 45.6 }).progress_percent, 46);
  assert.equal(normalizeMission({ id: 'm4', progress_percent: null }).progress_percent, null);
  assert.equal(normalizeMission({ id: 'm5' }).progress_percent, null);
});

test('selectActiveMissions and selectMissionHistory separate active from history', () => {
  const missions = [
    { id: 'm1', status: 'completed', updated_at: '2026-10-26T10:00:00Z' },
    { id: 'm2', status: 'running', updated_at: '2026-10-26T09:00:00Z' },
    { id: 'm3', status: 'paused', updated_at: '2026-10-26T11:00:00Z' },
    { id: 'm4', status: 'running', updated_at: '2026-10-26T12:00:00Z' },
    { id: 'm5', status: 'failed', updated_at: '2026-10-26T08:00:00Z' }
  ];

  const active = selectActiveMissions(missions);
  const history = selectMissionHistory(missions);

  assert.equal(active.length, 2);
  // Running missions come first, sorted by updated_at desc
  assert.equal(active[0].id, 'm4'); // running, 12:00
  assert.equal(active[1].id, 'm2'); // running, 09:00
  assert.deepEqual(selectMissionQueue(missions).map(m => m.id), ['m3']);
  assert.equal(selectPrimaryMission(missions).id, 'm4');

  assert.equal(history.length, 2);
  assert.equal(history[0].id, 'm1'); // completed, 10:00
  assert.equal(history[1].id, 'm5'); // failed, 08:00
});

test('selectMissionAssignments and selectExecutingAgents distinguish executing from assigned', () => {
  const agentsById = {
    'agent-1': { id: 'agent-1', name: 'Lead Architect' },
    'agent-2': { id: 'agent-2', name: 'Senior Coder' }
  };

  const detail = {
    id: 'm1',
    tasks: [
      { id: 't1', title: 'Task 1', assigned_agent_id: 'agent-1', status: 'running', execution_state: 'executing' },
      { id: 't2', title: 'Task 2', assigned_agent_id: 'agent-1', status: 'running', execution_state: 'executing' },
      { id: 't3', title: 'Task 3', assigned_agent_id: 'agent-2', status: 'queued', execution_state: 'assigned' },
      { id: 't4', title: 'Task 4', assigned_agent_id: 'agent-unknown', status: 'queued', execution_state: 'assigned' }
    ]
  };

  const assignments = selectMissionAssignments(detail, agentsById);
  assert.equal(assignments.length, 4);
  assert.equal(assignments[0].agentName, 'Lead Architect');
  assert.equal(assignments[3].agentName, 'agent-unknown'); // Fallback to ID

  const executing = selectExecutingAgents(detail, agentsById);
  assert.equal(executing.length, 1);
  assert.equal(executing[0].agentId, 'agent-1');
  assert.equal(executing[0].agentName, 'Lead Architect');
  assert.equal(executing[0].taskCount, 2);
});

test('unknown statuses remain waiting and invalid timestamps have deterministic ordering', () => {
  const missions = [{ id: 'b', status: 'running', updated_at: 'invalid' }, { id: 'a', status: 'running' }, { id: 'q', status: 'queued' }, { id: 'u', status: 'unrecognized' }, { id: 'c', status: 'canceled' }];
  assert.deepEqual(selectActiveMissions(missions).map(m => m.id), ['a', 'b']);
  assert.deepEqual(selectMissionQueue(missions).map(m => m.id), ['q', 'u']);
  assert.deepEqual(selectMissionHistory(missions).map(m => m.id), ['c']);
  assert.equal(selectPrimaryMission([]), null);
});
