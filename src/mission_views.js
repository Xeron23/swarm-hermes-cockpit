import { esc } from './ui.js';
import { selectMissionAssignments, selectExecutingAgents } from './mission_model.js';

export function renderMissionProgress(progress) {
  if (progress === null || progress === undefined) {
    return '<span class="progress-label">Progress: <em>Belum dilaporkan</em></span>';
  }
  return `
    <div class="mission-progress-block">
      <div class="progress-label">
        <span>Progress</span>
        <strong>${progress}%</strong>
      </div>
      <div class="segmented-progress">
        <span class="${progress >= 20 ? 'filled' : ''}"></span>
        <span class="${progress >= 40 ? 'filled' : ''}"></span>
        <span class="${progress >= 60 ? 'filled' : ''}"></span>
        <span class="${progress >= 80 ? 'filled' : ''}"></span>
        <span class="${progress >= 100 ? 'filled' : ''}"></span>
      </div>
    </div>
  `;
}

export function renderMissionCard(mission, agentsById = {}) {
  const executing = selectExecutingAgents(mission, agentsById);
  const assignments = selectMissionAssignments(mission, agentsById);
  const waitingAgents = assignments.filter(a => a.executionState !== 'executing' && a.status !== 'running');
  
  const statusClass = (mission.status || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
  const allowedActions = mission.allowed_actions || [];

  return `
    <article class="mission-card" data-key="mission:${esc(mission.id)}" data-mission-id="${esc(mission.id)}">
      <div class="mission-head">
        <div>
          <span class="mission-id">ID: ${esc(mission.id)}</span>
          <h2>${esc(mission.title)}</h2>
        </div>
        <span class="status-pill ${esc(statusClass)}">
          <i class="dot"></i>
          ${esc(mission.status)}
        </span>
      </div>

      ${mission.prompt ? `<p class="mission-desc">${esc(mission.prompt)}</p>` : ''}

      ${renderMissionProgress(mission.progress_percent)}

      ${mission.current_milestone_id ? `
        <div class="mission-milestone-preview">
          <small class="muted">Milestone Aktif:</small>
          <span>${esc(mission.current_milestone_id)}</span>
        </div>
      ` : ''}

      <div class="mission-agents-summary">
        ${executing.length > 0 ? `
          <div class="agent-group executing">
            <span class="group-label">Sedang bekerja:</span>
            <div class="agent-tags">
              ${executing.map(a => `<span class="agent-tag active" title="${esc(a.taskCount)} task">${esc(a.agentName)}</span>`).join('')}
            </div>
          </div>
        ` : ''}

        ${waitingAgents.length > 0 ? `
          <div class="agent-group waiting">
            <span class="group-label">Ditugaskan:</span>
            <div class="agent-tags">
              ${waitingAgents.map(a => `<span class="agent-tag" title="Status: ${esc(a.status)}">${esc(a.agentName)}</span>`).join('')}
            </div>
          </div>
        ` : ''}
      </div>

      <div class="mission-footer">
        <div class="mission-actions">
          <button type="button" class="secondary-button" data-action="mission-detail" data-mission-id="${esc(mission.id)}">Detail</button>
          ${allowedActions.includes('pause') && mission.status === 'running' ? `
            <button type="button" class="text-button" data-action="mission-action" data-command="pause" data-id="${esc(mission.id)}">Pause</button>
          ` : ''}
          ${allowedActions.includes('resume') && mission.status === 'paused' ? `
            <button type="button" class="primary-button" data-action="mission-action" data-command="resume" data-id="${esc(mission.id)}">Resume</button>
          ` : ''}
          ${allowedActions.includes('cancel') && !['succeeded', 'completed', 'failed', 'cancelled'].includes(mission.status) ? `
            <button type="button" class="text-button danger-button" data-action="mission-cancel" data-id="${esc(mission.id)}">Batal</button>
          ` : ''}
        </div>
      </div>
    </article>
  `;
}

export function renderMissionDetailDialog(mission, agentsById = {}) {
  if (!mission) return '';
  const assignments = selectMissionAssignments(mission, agentsById);
  const milestones = mission.milestones || [];

  return `
    <div class="overlay sheet-overlay" id="mission-detail-backdrop" data-mission-backdrop>
      <section class="sheet mission-detail-sheet" role="dialog" aria-modal="true" aria-labelledby="mission-dialog-title">
        <div class="sheet-header">
          <div>
            <span class="mission-id">ID: ${esc(mission.id)}</span>
            <h2 id="mission-dialog-title">${esc(mission.title)}</h2>
          </div>
          <button type="button" class="icon-button" data-action="sheet-dismiss" aria-label="Tutup">✕</button>
        </div>

        <div class="sheet-body">
          <div class="detail-block">
            <span>Tujuan / Prompt</span>
            <p>${esc(mission.prompt || 'Tidak ada deskripsi.')}</p>
          </div>

          <div class="detail-grid">
            <div class="detail-item">
              <span class="muted">Status Backend</span>
              <strong>${esc(mission.status)}</strong>
            </div>
            <div class="detail-item">
              <span class="muted">Progress</span>
              <strong>${Number.isFinite(mission.progress_percent) ? `${mission.progress_percent}%` : 'Belum dilaporkan'}</strong>
            </div>
            ${mission.updated_at ? `
              <div class="detail-item">
                <span class="muted">Terakhir Diperbarui</span>
                <strong>${esc(new Date(mission.updated_at).toLocaleString())}</strong>
              </div>
            ` : ''}
          </div>

          <div class="mission-milestones-section">
            <h3 class="sheet-section-title">Milestones (${milestones.length})</h3>
            ${milestones.length === 0 ? `
              <p class="muted">Belum ada milestone yang dilaporkan backend.</p>
            ` : `
              <div class="milestones-timeline">
                ${milestones.map((m, idx) => `
                  <div class="milestone-row ${m.status === 'completed' ? 'done' : m.status === 'running' ? 'active' : ''}">
                    <span class="step-num">${idx + 1}</span>
                    <div class="milestone-content">
                      <strong>${esc(m.title || m.name || `Milestone ${idx + 1}`)}</strong>
                      <span class="muted">${esc(m.status || 'pending')}</span>
                    </div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>

          <div class="mission-tasks-section">
            <h3 class="sheet-section-title">Penugasan Task &amp; Agent (${assignments.length})</h3>
            ${assignments.length === 0 ? `
              <p class="muted">Belum ada task atau assignment agent untuk mission ini.</p>
            ` : `
              <div class="tasks-table">
                ${assignments.map(a => `
                  <div class="task-row">
                    <div class="task-info">
                      <strong>${esc(a.taskTitle || a.taskId)}</strong>
                      <small class="muted">ID: ${esc(a.taskId)}</small>
                    </div>
                    <div class="task-agent">
                      <span class="agent-tag ${a.executionState === 'executing' ? 'active' : ''}">${esc(a.agentName)}</span>
                      <small class="muted">${esc(a.executionState)}</small>
                    </div>
                  </div>
                `).join('')}
              </div>
            `}
          </div>
        </div>

        <div class="sheet-footer">
          <button type="button" class="secondary-button" data-action="sheet-dismiss">Tutup</button>
        </div>
      </section>
    </div>
  `;
}
