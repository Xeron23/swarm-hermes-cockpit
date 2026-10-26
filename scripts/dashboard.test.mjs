import test from 'node:test';
import assert from 'node:assert/strict';
import { Workspace } from '../src/workspace.js';
import { selectOverviewActivities } from '../src/activity_model.js';
import { render } from '../src/views.js';
const pause = () => new Promise(resolve => setImmediate(resolve));
function fixture(options = {}) {
  const agents = [{ id: 'main', name: 'Hermes', role: 'main', active_direct_session_id: 'chat' }, { id: 'coder', name: 'Coder' }];
  const api = {
    accessToken: 'fixture', workspaceId: 'workspace', deviceId: 'device', socket: {}, auth: {}, stopTelemetry() {},
    getBootstrap: async () => ({ workspace_id: 'workspace', device_id: 'device', nodes: [], agents, active_missions: [], last_event_seq: '0', features: { real_mode: true, runtime_ready: true } }),
    getMissions: async () => ({ items: [] }), getSessions: async () => ({ items: [{ id: 'chat', agent_id: 'main' }] }),
    getApprovals: async () => ({ items: [] }), getQuestions: async () => ({ items: [] }), getMessages: async () => ({ items: [] }),
    sendMessage: async id => ({ id: 'user-message', session_id: id, sender_kind: 'user', content: 'Halo' }), ...options.api
  };
  const workspace = new Workspace(api, options);
  Object.assign(workspace.state, { status: 'connected', agents, features: { real_mode: true, runtime_ready: true } });
  return workspace;
}
const event = (type, payload = {}, extra = {}) => ({ event_type: type, event_id: `event-${type}`, sender: 'agent:main', timestamp: '2026-10-26T10:00:00Z', payload, ...extra });
const ui = { page: 'overview', pending: new Set(), draft: '', agentFilter: 'all', eventFilter: 'all', target: 'auto' };

test('live telemetry throttles snapshots, offline fallback and visibility remain effective', () => {
  let now = 15000, visible = true, calls = 0;
  const w = fixture({ now: () => now, isVisible: () => visible }); w.refresh = async () => { calls++; };
  w.poll(); assert.equal(calls, 0);
  now = 120000; w.poll(); assert.equal(calls, 1);
  w.state.status = 'offline'; w.poll(); assert.equal(calls, 2);
  visible = false; w.poll(); assert.equal(calls, 2);
  visible = true; w.api.auth.refresh_uncertain = true; w.poll(); assert.equal(calls, 3);
  w.telemetryStarted = true; w.state.telemetryConnected = false; w.poll(); assert.equal(calls, 3);
});

test('one refresh emits loading then one complete snapshot and retains mission history', async () => {
  const w = fixture({ api: { getMissions: async () => ({ items: [{ id: 'done', status: 'completed' }] }) } });
  const frames = []; w.subscribe(s => frames.push({ busy: s.syncing, ids: s.missions.map(m => m.id) }));
  await Promise.all([w.refresh(), w.refresh()]);
  assert.deepEqual(frames, [{ busy: true, ids: [] }, { busy: false, ids: ['done'] }]);
});

test('raw events do not change Overview markup and semantic activities survive the raw buffer', () => {
  const w = fixture(); w.applyEvent(event('MISSION_STATE', { mission_id: 'm', status: 'running', title: 'Ship' }));
  clearTimeout(w.eventRefresh);
  const first = render(w.state, ui, w.api, w.writable);
  for (let i = 0; i < 350; i++) w.applyEvent(event('METRIC_SAMPLE', { cpu: i }, { event_id: String(i) }));
  assert.equal(render(w.state, ui, w.api, w.writable), first); assert.equal(w.state.events.length, 300);
  assert.equal(selectOverviewActivities(w.state)[0].title, 'Misi mulai berjalan'); w.disconnect();
});

test('event bursts have a bounded flush; deltas and tool logs never fetch snapshots', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  const w = fixture(); let calls = 0; w.refresh = async () => { calls++; };
  for (let i = 0; i < 6; i++) { w.applyEvent(event('TASK_STATE')); t.mock.timers.tick(500); }
  await pause(); assert.equal(calls, 1);
  w.applyEvent(event('MESSAGE_DELTA')); w.applyEvent(event('TOOL_LOG_CHUNK'));
  t.mock.timers.tick(5000); await pause(); assert.equal(calls, 1); w.disconnect();
});

test('typing starts after POST, ignores foreign sessions/agents, and ends on matching delta', async () => {
  let accept; const w = fixture({ api: { sendMessage: () => new Promise(resolve => { accept = resolve; }) } });
  const sending = w.send('chat', 'Halo', 'auto', 'main'); assert.equal(w.state.pendingReplies.chat.phase, 'sending');
  accept({ id: 'u', session_id: 'chat', sender_kind: 'user' }); await sending;
  assert.equal(w.state.pendingReplies.chat.phase, 'waiting');
  assert.match(render(w.state, { ...ui, page: 'chat', agentId: 'main', sessionId: 'chat' }, w.api, true), /Hermes sedang mengetik/);
  w.applyEvent(event('MESSAGE_DELTA', { session_id: 'other', message_id: 'r1', delta: 'x' }));
  w.applyEvent(event('MESSAGE_DELTA', { session_id: 'chat', message_id: 'r2', delta: 'x' }, { sender: 'agent:coder' }));
  assert.equal(w.state.pendingReplies.chat.phase, 'waiting');
  w.applyEvent(event('MESSAGE_DELTA', { session_id: 'chat', message_id: 'r3', delta: 'Halo' }));
  assert.equal(w.state.pendingReplies.chat, undefined); w.disconnect();
});

test('a delta before POST resolves cannot resurrect typing', async () => {
  let accept; const w = fixture({ api: { sendMessage: () => new Promise(resolve => { accept = resolve; }) } });
  const sending = w.send('chat', 'Halo', 'auto', 'main');
  w.applyEvent(event('MESSAGE_DELTA', { session_id: 'chat', message_id: 'r', delta: 'Halo' }));
  accept({ id: 'u', session_id: 'chat', sender_kind: 'user' }); await sending;
  assert.equal(w.state.pendingReplies.chat, undefined); assert.equal(w.replyTimers.size, 0);
});

test('final-only and REST replies stop typing; old history cannot stop a new request', async () => {
  const w = fixture();
  w.state.messages.chat = [{ id: 'old', sender_kind: 'agent', sender_id: 'main', created_at: '2026-10-26T09:00:00Z' }];
  await w.send('chat', 'Halo', 'auto', 'main');
  w.acceptReply('chat', { id: 'old-unloaded', sender_kind: 'agent', sender_id: 'main', created_at: '2026-10-26T08:00:00Z' });
  assert.equal(w.state.pendingReplies.chat.phase, 'waiting');
  w.applyEvent(event('MESSAGE_FINAL', { message: { id: 'r', session_id: 'chat', sender_kind: 'agent', sender_id: 'main' } }));
  assert.equal(w.state.pendingReplies.chat, undefined); await pause();
  await w.send('chat', 'Again', 'auto', 'main');
  w.api.getMessages = async () => ({ items: [{ id: 'recovered', session_id: 'chat', sender_kind: 'agent', sender_id: 'main', content: 'Done', status: 'complete' }] });
  await w.loadMessages('chat'); assert.equal(w.state.pendingReplies.chat, undefined); w.disconnect();
});

test('failed sends never type; accepted POST plus failed GET remains an accepted send', async () => {
  const w = fixture({ api: { sendMessage: async () => { throw new Error('transport'); } } });
  await assert.rejects(w.send('chat', 'Halo', 'auto', 'main'), /transport/); assert.equal(w.state.pendingReplies.chat, undefined);
  w.api.sendMessage = async () => ({ id: 'u', session_id: 'chat', sender_kind: 'user' });
  w.api.getMessages = async () => { throw new Error('history offline'); };
  await w.send('chat', 'Halo', 'auto', 'main'); assert.equal(w.state.pendingReplies.chat.phase, 'waiting');
  assert.match(w.state.sectionErrors.messages, /history offline/); w.disconnect();
});

test('typing expires to a delayed notice and disconnect clears timers', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const w = fixture(); await w.send('chat', 'Halo', 'auto', 'main');
  t.mock.timers.tick(90000); assert.equal(w.state.pendingReplies.chat.phase, 'delayed');
  w.disconnect(); assert.equal(w.replyTimers.size, 0); assert.deepEqual(w.state.pendingReplies, {});
});

test('semantic feed includes Main chat, handoff and mission status without raw names', () => {
  const w = fixture(); w.state.sessions = [{ id: 'chat', agent_id: 'main' }];
  w.state.messages.chat = [{ id: 'u', session_id: 'chat', sender_kind: 'user', content: '<script>x</script>' }];
  w.state.activityEvents = [
    event('MESSAGE_FINAL', { message: { id: 'reply', session_id: 'chat', sender_kind: 'agent', sender_id: 'main', content: 'Done' } }),
    event('INTER_AGENT_MESSAGE', { from_agent_id: 'main', to_agent_id: 'coder', content: 'Review' }),
    event('MISSION_STATE', { mission_id: 'm', status: 'completed', title: 'Ship' }), event('TASK_STATE'), event('MESSAGE_DELTA'), event('NODE_STATE')
  ];
  const activities = selectOverviewActivities(w.state); assert.equal(activities.length, 4);
  assert.deepEqual(new Set(activities.map(a => a.kind)), new Set(['chat', 'handoff', 'mission']));
  const markup = render(w.state, ui, w.api, true); assert.doesNotMatch(markup, /TASK_STATE|MESSAGE_FINAL|seq /); assert.match(markup, /&lt;script&gt;/);
  w.state.activityEvents = [event('INTER_AGENT_MESSAGE', { from_agent_id: 'coder', to_agent_id: 'other' })];
  assert.equal(selectOverviewActivities(w.state).filter(a => a.kind === 'handoff').length, 0);
});

test('duplicate messages and repeated mission states collapse', () => {
  const w = fixture(); const message = { id: 'reply', session_id: 'chat', sender_kind: 'agent', sender_id: 'main', content: 'Done' };
  w.state.messages.chat = [message];
  w.state.activityEvents = [event('MESSAGE_FINAL', { message }), event('MISSION_STATE', { mission_id: 'm', status: 'running' }, { event_id: 'new' }), event('MISSION_STATE', { mission_id: 'm', status: 'running' }, { event_id: 'old' })];
  assert.equal(selectOverviewActivities(w.state).length, 2);
});

test('a delta during bootstrap/full-list reconciliation cannot erase known history', async () => {
  let finish;
  const w = fixture({ api: { getMissions: () => new Promise(resolve => { finish = resolve; }) } });
  w.state.missions = [{ id: 'history', status: 'completed' }];
  const refresh = w.refresh(); await pause();
  w.applyEvent(event('MESSAGE_DELTA', { session_id: 'chat', message_id: 'r', delta: 'x' }));
  assert.equal(w.state.missions[0].id, 'history');
  finish({ items: [{ id: 'history', status: 'completed' }] }); await refresh;
});
