import { hermesApi } from './api_client.js';

const $ = (s,root=document)=>root.querySelector(s);
const icons={
grid:'<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
agents:'<circle cx="9" cy="7" r="3"/><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 4a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 4v3"/>',
swarm:'<circle cx="5" cy="6" r="2.5"/><circle cx="19" cy="6" r="2.5"/><circle cx="12" cy="19" r="2.5"/><path d="M7.5 6h9M6.5 8l4 8.5m7-8.5-4 8.5"/>',
server:'<rect x="3" y="3" width="18" height="7" rx="2"/><rect x="3" y="14" width="18" height="7" rx="2"/><path d="M7 6.5h.01M7 17.5h.01M12 6.5h5M12 17.5h5"/>',
monitor:'<rect x="2.5" y="3.5" width="19" height="13" rx="2"/><path d="M12 17v4m-4 0h8"/>',
terminal:'<path d="m5 6 5 6-5 6m8 0h6"/>',
code:'<path d="m8 6-6 6 6 6m8-12 6 6-6 6m-3-15-2 18"/>',
compass:'<circle cx="12" cy="12" r="9"/><path d="m16 8-2.5 5.5L8 16l2.5-5.5Z"/>',
shield:'<path d="M12 2 3.5 6v6c0 5 8.5 10 8.5 10S20.5 17 20.5 12V6L12 2Z"/><path d="m8 12 3 3 5-6"/>',
search:'<circle cx="10" cy="10" r="6.5"/><path d="m15 15 6 6"/>',
bell:'<path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9m-11 12a2 2 0 0 0 4 0"/>',
plus:'<path d="M12 5v14M5 12h14"/>',
arrow:'<path d="M5 12h14m-5-5 5 5-5 5"/>',
upRight:'<path d="M6 18 18 6M6 6h12v12"/>',
down:'<path d="m6 9 6 6 6-6"/>',
back:'<path d="m15 5-7 7 7 7"/>',
close:'<path d="m6 6 12 12M6 18 18 6"/>',
check:'<path d="m5 12 4 4L19 6"/>',
activity:'<path d="M2 12h5l3-8 4 16 3-8h5"/>',
bolt:'<path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z"/>',
clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
send:'<path d="M12 20V4m-6 6 6-6 6 6"/>',
settings:'<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3" fill="var(--surface)"/><circle cx="16" cy="17" r="3" fill="var(--surface)"/>',
info:'<circle cx="12" cy="12" r="9"/><path d="M12 11v6m0-10h.01"/>',
network:'<rect x="8" y="3" width="8" height="6" rx="1"/><rect x="2" y="16" width="7" height="5" rx="1"/><rect x="15" y="16" width="7" height="5" rx="1"/><path d="M12 9v4H5.5v3M12 13h6.5v3"/>',
copy:'<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
pause:'<path d="M8 5v14M16 5v14"/>',
play:'<path d="m7 4 14 8-14 8V4Z"/>',
power:'<path d="M12 2v10M6 5a9 9 0 1 0 12 0"/>',
moon:'<path d="M20.5 14A9 9 0 0 1 10 3.5 9 9 0 1 0 20.5 14Z"/>',
file:'<path d="M14 2H5v20h14V7l-5-5v5h5M8 12h8m-8 4h6"/>',
browser:'<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M2 8h20M6 5.5h.01M9 5.5h.01"/>',
cpu:'<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 2v4m6-4v4M9 18v4m6-4v4M2 9h4m-4 6h4m12-6h4m-4 6h4"/>'
};
const icon=(name,cls='')=>`<svg class="icon ${cls}" viewBox="0 0 24 24" aria-hidden="true">${icons[name]||icons.bolt}</svg>`;
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const brand=`<div class="brand"><div class="brand-mark"><svg viewBox="0 0 36 38" fill="none" aria-hidden="true"><path d="m18 2 14 8v18l-14 8L4 28V10L18 2Z" stroke="currentColor" stroke-width="1.3"/><path d="M12 11v16m12-16v16M12 19h12" stroke="currentColor" stroke-width="2.8"/><path d="m2 17 2-1m28 6 2-1" stroke="currentColor"/></svg></div><div><div class="brand-title">HERMES</div><div class="brand-sub">MULTI-AGENT SYSTEM</div></div></div>`;
const agents=[
 {id:'main',name:'Main',role:'Orchestrator',status:'Orchestrating',color:'#70463b',bg:'#FFB6A6',icon:'compass',description:'Memecah misi menjadi milestone dan mengoordinasikan seluruh agent fleet.',tools:['task_dispatch','planner','node_router'],instruction:'Terima tujuan pengguna, susun milestone yang dapat diverifikasi, pilih agen dan node sesuai kebutuhan, lalu rangkum hasil eksekusi. Minta persetujuan untuk operasi yang berdampak besar.',greeting:'Semua agen sudah terhubung. Ada misi apa hari ini? Saya bisa membagi pekerjaan, memilih node yang sesuai, dan memantau hasil setiap agen.',prompts:['Rencanakan deploy webhook','Ringkas progres misi']},
 {id:'coder',name:'Coder',role:'Fullstack engineer',status:'Working',color:'#315b73',bg:'#c6deeb',icon:'code',description:'Menulis kode, melakukan refactoring, dan menjalankan pengujian di node pilihan.',tools:['terminal','write_file','git','tests'],instruction:'Fokus pada perubahan kode yang terukur. Tinjau struktur proyek, implementasikan perubahan, jalankan pengujian yang relevan, dan sertakan patch serta exit code.',greeting:'Endpoint webhook sudah dibuat. Saya sedang menyiapkan pengujian sebelum diteruskan ke QA. Mau review perubahan atau mulai task baru?',prompts:['Compile project ini di PC','Tampilkan hasil pengujian']},
 {id:'devops',name:'DevOps',role:'Infrastructure & SRE',status:'Monitoring',color:'#6b503e',bg:'#FFEBD3',icon:'terminal',description:'Menjaga service tetap sehat, memantau container, log audit, dan konektivitas node.',tools:['docker','pm2','audit_logs','ssh'],instruction:'Pantau service 24/7 di VPS. Laporkan CPU, RAM, disk, dan uptime. Konfirmasikan tindakan shutdown atau perubahan firewall sebelum eksekusi.',greeting:'Kedua node sehat. Docker dan PM2 di VPS berjalan normal; Windows PC terhubung melalui SSH bridge. Apa yang ingin diperiksa?',prompts:['Periksa kesehatan kedua node','Cek log backend :3450']},
 {id:'researcher',name:'Researcher',role:'Research & knowledge',status:'Standby',color:'#355f55',bg:'#9BCEC1',icon:'search',description:'Mencari referensi web dan konteks relevan dari Obsidian Brain menggunakan RAG.',tools:['web_search','semantic_search','obsidian'],instruction:'Cari sumber yang relevan, pisahkan fakta dari asumsi, cantumkan sumber, dan gunakan semantic search di Obsidian Brain untuk konteks internal.',greeting:'Siap mencari referensi dan menelusuri Obsidian Brain. Berikan topik, pertanyaan, atau nama catatan yang ingin Anda telusuri.',prompts:['Cari referensi webhook security','Telusuri Obsidian Brain']},
 {id:'qa',name:'QA',role:'Quality & security',status:'Reviewing',color:'#315b73',bg:'#d1e3eb',icon:'shield',description:'Meninjau perubahan, memeriksa keamanan, dan memvalidasi acceptance criteria.',tools:['test_runner','security_scan','pr_review'],instruction:'Periksa acceptance criteria, uji alur penting, jalankan security scan, dan laporkan temuan beserta bukti. Tandai hasil review secara jelas.',greeting:'Saya siap meninjau perubahan Coder. Pengujian fungsional dan security scan akan ditampilkan di execution trace.',prompts:['Review webhook integration','Jalankan security scan']}
];
const getAgent=id=>agents.find(a=>a.id===id)||agents[0];
const avatar=(id,cls='',dot=true)=>{const a=getAgent(id);return `<span class="agent-avatar ${cls}" style="background:${a.bg};color:${a.color}">${icon(a.icon)}${dot?`<i class="dot" style="background:${a.status==='Standby'?'#83b2c8':a.color}"></i>`:''}</span>`};
const feedAvatar=id=>{const a=getAgent(id);return `<span class="feed-avatar" style="color:${a.color};background:${a.bg}">${icon(a.icon)}</span>`};
const initialFeed=[
 {id:1,from:'coder',to:'qa',text:'Endpoint ready. Bisa review PR #12 sebelum deploy?',time:'Just now',tag:'PR #12',type:'handoff',node:'vps',tokens:1248},
 {id:2,from:'coder',text:'Semua pengujian lolos. Webhook siap untuk security review.',time:'1m ago',tag:'12 tests passed · exit 0',type:'tool',node:'vps',tokens:2184},
 {id:3,from:'main',to:'coder',text:'Buat endpoint webhook di port 3456. Jalankan di VPS.',time:'3m ago',tag:'Task dispatched',type:'handoff',node:'vps',tokens:856},
 {id:4,from:'devops',text:'SSH bridge terhubung. Windows PC siap menerima task GPU dan browser.',time:'5m ago',tag:'PC · bridge healthy',type:'system',node:'pc',tokens:320},
 {id:5,from:'researcher',to:'main',text:'Ringkasan referensi webhook authentication sudah tersedia di workspace.',time:'7m ago',tag:'3 sources indexed',type:'handoff',node:'vps',tokens:3120}
];
const initialMission={title:'Deploy webhook integration',description:'Coder is running the final checks',id:'MSN-024',stage:3,node:'vps',paused:false,prompt:'Buat endpoint webhook di port 3456, jalankan test dan security review sebelum deploy.'};
let saved={};try{saved=JSON.parse(localStorage.getItem('hermes-cockpit-v1')||'{}')}catch{}
const state={page:'overview',agent:'main',fleetFilter:'all',swarmFilter:'all',mission:saved.mission||{...initialMission},messages:saved.messages||{},feed:saved.feed||initialFeed.map(f=>({...f})),pcState:saved.pcState||'online',route:'auto',overlay:null,traceTab:'timeline',execTab:'terminal',chatBusy:{},newRoute:'auto'};
function persist(){try{localStorage.setItem('hermes-cockpit-v1',JSON.stringify({mission:state.mission,messages:state.messages,feed:state.feed.slice(0,30),pcState:state.pcState}))}catch{}}
function now(){return new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',hour:'2-digit',minute:'2-digit',hour12:false}).format(new Date()).replace('.',':')}
function toast(s){const t=$('#toast');t.textContent=s;t.classList.add('visible');clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.classList.remove('visible'),3200)}
const navItems=[['overview','grid','Overview'],['agents','agents','Agents'],['swarm','swarm','Swarm'],['nodes','server','Nodes']];
function nav(){return navItems.map(([id,ic,label])=>`<button data-action="navigate" data-page="${id}" class="${(state.page==='chat'?'agents':state.page)===id?'active':''}" ${((state.page==='chat'?'agents':state.page)===id)?'aria-current="page"':''}>${icon(ic)}<span>${label}</span>${id==='agents'?'<span class="count">5</span>':''}</button>`).join('')}
function shell(){document.body.classList.toggle('chat-mode',state.page==='chat');$('#app').innerHTML=`<div class="shell"><aside class="sidebar">${brand}<div class="side-label">WORKSPACE</div><nav class="side-nav" aria-label="Main navigation">${nav()}</nav><div class="side-label">TOOLS</div><nav class="side-nav"><button data-action="execution">${icon('terminal')}<span>Execution logs</span><span class="count">3</span></button><button data-action="about">${icon('info')}<span>About this preview</span></button></nav><div class="side-bottom"><div class="workspace"><span class="tiny-logo">H</span><div><strong>Personal workspace</strong><small>Dual-node environment</small></div><i class="dot" style="margin-left:auto"></i></div><div class="side-user"><span class="user-avatar">RA</span><div><strong>Rifki Anandita</strong><small>Workspace owner</small></div></div></div></aside><main class="app-main"><header class="topbar"><div class="mobile-brand">${brand}</div><div class="breadcrumb">Workspace ${icon('arrow')}<span>${state.page==='chat'?'Agent workspace':navItems.find(n=>n[0]===state.page)?.[2]||'Overview'}</span></div>    <div class="top-actions">
      <span class="online-label"><i class="dot"></i> ${state.pcState==='online'?'All systems operational':'VPS online · PC '+(state.pcState==='sleep'?'sleeping':'offline')}</span>
      <button class="demo-tag" data-action="pair-dialog" aria-label="Backend status" style="${hermesApi.accessToken?'background:#9bcec1;color:#244653':''}">${hermesApi.accessToken?'ONLINE':'CONNECT'}</button>
      <button class="icon-button" data-action="notifications" aria-label="Notifications">${icon('bell')}<span class="notification-dot"></span></button>
    </div></header><div id="page-content">${renderPage()}</div></main><nav class="bottom-nav" aria-label="Mobile navigation">${nav()}</nav></div>`;if(state.page==='chat')scrollChat();window.HermesUI.paint({page:state.page,agent:state.agent,messageCount:state.messages[state.agent]?.length||0,feedId:state.feed[0]?.id})}
function pageHeading(title,subtitle,action=true){return `<div class="page-heading"><div><h1>${title}</h1><p>${subtitle}</p></div>${action?`<button class="primary-button" data-action="new-mission" aria-label="Create new mission">${icon('plus')}<span>New mission</span></button>`:''}</div>`}
function renderPage(){if(state.page==='overview')return dashboard();if(state.page==='agents')return fleetPage();if(state.page==='swarm')return swarmPage();if(state.page==='nodes')return nodesPage();if(state.page==='chat')return chatPage();return dashboard()}
function constellation(){return `<svg class="constellation" viewBox="0 0 220 220" fill="none" aria-hidden="true"><circle cx="120" cy="104" r="77" stroke="#9bcec1" stroke-opacity=".1"/><circle cx="120" cy="104" r="53" stroke="#9bcec1" stroke-opacity=".1"/><path d="m120 104 43-48m-43 48 63 33m-63-33-48 48m48-48-59-29m59 29 16 76m-16-76 3-76" stroke="#ffebd3" stroke-opacity=".2" stroke-dasharray="3 4"/><circle cx="120" cy="104" r="20" fill="#ffebd3" fill-opacity=".04" stroke="#ffebd3" stroke-opacity=".3"/><path d="M113 96v16m14-16v16m-14-8h14" stroke="#ffebd3" stroke-width="2" opacity=".7"/><g fill="#244653" stroke="#9bcec1" stroke-opacity=".6"><circle cx="163" cy="56" r="10"/><circle cx="183" cy="137" r="8"/><circle cx="72" cy="152" r="9"/><circle cx="61" cy="75" r="7"/><circle cx="136" cy="180" r="6"/><circle cx="123" cy="28" r="5"/></g><g fill="#ffebd3"><circle cx="163" cy="56" r="2"/><circle cx="183" cy="137" r="2"/><circle cx="72" cy="152" r="2"/></g></svg>`}
function missionCard(){const m=state.mission;const complete=m.stage>=5;return `<button class="mission-card" data-action="mission-detail">${constellation()}<div class="mission-top"><span class="status-pill"><i class="dot ${!m.paused&&!complete?'pulse':''}"></i>${m.paused?'PAUSED':complete?'MISSION COMPLETE':'ACTIVE MISSION'}</span><span class="mission-id">${esc(m.id)}</span></div><h2>${esc(m.title)}</h2><p class="mission-desc">${esc(m.paused?'Mission paused. Resume when you are ready.':complete?'All checks passed. Your mission is complete.':m.description)}</p><div class="mission-progress"><div class="progress-label"><span>Milestone <strong>${Math.min(m.stage,5)} of 5</strong></span><strong>${m.stage*20}%</strong></div><div class="segmented-progress">${Array.from({length:5},(_,i)=>`<span class="${i<m.stage?'filled':i===m.stage&&!complete?'current':''}"></span>`).join('')}</div></div><div class="mission-footer"><div class="avatar-stack">${['main','coder','qa'].map(id=>{const a=getAgent(id);return `<span class="mini-avatar" style="background:${a.bg};color:${a.color}">${a.name.slice(0,1)}</span>`}).join('')}<span>3 agents assigned</span></div><span class="text-button">View mission ${icon('upRight')}</span></div></button>`}
function nodeCard(id,full=false){const pc=id==='pc',offline=pc&&state.pcState!=='online';const cpu=offline?0:pc?18:42,ram=offline?0:pc?38:64;return `<button class="node-card" data-action="node-detail" data-node="${id}"><div class="row between"><span class="node-icon ${pc?'blue':''}">${icon(pc?'monitor':'server')}</span><span class="node-status" style="${offline?'color:#785043':''}"><i class="dot" style="${offline?'background:#FFEBD3':''}"></i>${offline?(state.pcState==='sleep'?'Sleeping':'Offline'):'Online'}</span></div><div class="node-name"><h3>${pc?'Windows PC':'VPS Server'}</h3>${full?icon('upRight'):''}</div><div class="hostname">${pc?'192.168.1.26':'webserver-xeron · Linux'}</div><div class="metric-line"><span>CPU</span><strong>${cpu}%</strong></div><div class="metric-track ${pc?'blue':''}"><i style="width:${cpu}%"></i></div><div class="metric-line"><span>Memory</span><strong>${ram}%</strong></div><div class="metric-track ${pc?'blue':''}"><i style="width:${ram}%"></i></div>${full?`<div class="metric-line"><span>Disk</span><strong>${pc?'46':'32'}%</strong></div><div class="metric-track ${pc?'blue':''}"><i style="width:${pc?'46':'32'}%"></i></div><div class="node-full-stats"><div><strong>${offline?'—':pc?'4 ms':'21 ms'}</strong><small>Latency</small></div><div><strong>${offline?'—':pc?'6h 42m':'14d 8h'}</strong><small>Uptime</small></div><div><strong>${pc?'RTX 4070':'8 vCPU'}</strong><small>${pc?'GPU':'Compute'}</small></div></div>`:`<div class="node-card-bottom"><span>${icon('activity')}${offline?'No signal':pc?'4 ms':'21 ms'}</span><span>${icon('clock')}${offline?'—':pc?'6h 42m':'14d 8h'}</span></div>`}</button>`}
function fleetRows(){return `<div class="fleet-list">${agents.map(a=>`<button class="fleet-row" data-action="chat" data-agent="${a.id}">${avatar(a.id)}<div class="agent-info"><div class="agent-name">${a.name}</div><div class="agent-role">${a.role}</div></div><span class="agent-status ${a.status==='Standby'?'idle':''}">${a.status==='Working'?'<span class="typing-dots"><i></i><i></i><i></i></span>':''}${a.status}</span></button>`).join('')}</div>`}
function feedItem(f){return `<button class="feed-item" data-action="trace" data-id="${f.id}">${feedAvatar(f.from)}<div class="feed-body"><div class="feed-who"><span>${getAgent(f.from).name}</span>${f.to?`${icon('arrow')}<span>${getAgent(f.to).name}</span>`:''}<time>${esc(f.time)}</time></div><p>${esc(f.text)}</p><span class="feed-tag ${f.type==='tool'?'success':''}">${icon(f.type==='tool'?'check':f.type==='handoff'?'network':'activity')}<span class="feed-tag-label">${esc(f.tag)}</span></span></div></button>`}
function executionBar(){return `<button class="execution-bar" data-action="execution" data-node="vps"><span class="terminal-icon">${icon('terminal')}</span><div style="flex:1"><strong>Execution console</strong><p title="coder / vps · python -m pytest tests/"><span class="mint">●</span> coder / vps &nbsp; python -m pytest tests/</p></div><span class="feed-tag success">exit 0</span>${icon('upRight')}</button>`}
function dashboard(){return `${pageHeading('Mission control','Your agents. Your nodes. One command.')}<div class="dashboard-grid"><div class="column primary">${missionCard()}<div class="quick-stats"><div class="quick-stat"><div><strong>05</strong>${icon('agents')}</div><p>Agents online</p></div><div class="quick-stat"><div><strong>${state.pcState==='online'?'02':'01'}</strong>${icon('server')}</div><p>Connected nodes</p></div><div class="quick-stat"><div><strong>${state.mission.stage===5?'13':'12'}</strong>${icon('check')}</div><p>Completed today</p></div></div><section><div class="section-head"><h2>Execution nodes</h2><button class="text-button" data-action="navigate" data-page="nodes">Manage ${icon('arrow')}</button></div><div class="node-grid">${nodeCard('vps')}${nodeCard('pc')}</div></section></div><div class="column secondary"><section><div class="section-head"><div class="row"><h2>Agent fleet</h2><span class="count-badge">5</span></div><button class="text-button" data-action="navigate" data-page="agents">View all ${icon('arrow')}</button></div>${fleetRows()}</section><section><div class="section-head"><h2>Swarm activity</h2><span class="live-label"><i class="dot pulse"></i>LIVE</span></div><div class="feed-list">${state.feed.slice(0,3).map(feedItem).join('')}</div><button class="view-all-feed" data-action="navigate" data-page="swarm">Open swarm feed ${icon('arrow')}</button></section></div></div>${executionBar()}<div class="footer-note">${icon('shield')}Interactive preview · simulated telemetry</div>`}
function fleetPage(){const list=agents.filter(a=>state.fleetFilter==='all'||(state.fleetFilter==='active'?a.status!=='Standby':a.status==='Standby'));return `${pageHeading('Agent fleet','Five specialists. Independent workspaces.')}<div class="filter-row">${[['all','All agents · 5'],['active','Active · 4'],['standby','Standby · 1']].map(([v,l])=>`<button class="filter-chip ${state.fleetFilter===v?'active':''}" data-action="fleet-filter" data-filter="${v}" aria-pressed="${state.fleetFilter===v}"><span>${l}</span></button>`).join('')}</div><div class="agent-cards">${list.map(a=>`<article class="agent-card"><div class="agent-card-top">${avatar(a.id,'large')}<button class="profile-badge" data-action="profile" data-agent="${a.id}">View profile ${icon('upRight')}</button></div><h3>${a.name} <span style="font-size:11px;color:${a.color};font-weight:400">/ ${a.role}</span></h3><p class="description">${a.description}</p><div class="tool-tags">${a.tools.map(t=>`<span>${t}</span>`).join('')}</div><div class="agent-card-foot"><span class="row"><i class="dot" style="background:${a.color}"></i>${a.status}</span><button class="row" data-action="chat" data-agent="${a.id}">Open chat ${icon('arrow')}</button></div></article>`).join('')}</div><div class="footer-note">${icon('shield')}Each agent keeps its own conversation context</div>`}
function swarmPage(){
  const list=state.feed.filter(f=>state.swarmFilter==='all'||f.type===state.swarmFilter);
  const totalTokens=state.feed.reduce((sum,f)=>sum+(Number(f.tokens)||0),0);
  const tokenLabel=totalTokens>=1000?`${(totalTokens/1000).toFixed(1)}k`:String(totalTokens);
  const filters=[['all','All activity'],['handoff','Agent handoffs'],['tool','Tool execution'],['system','System']];
  return `${pageHeading('Swarm feed','A shared view of every handoff and execution.',false)}
    <div class="summary-strip" aria-label="Session summary">
      <div><strong>${state.feed.length.toString().padStart(2,'0')}</strong><span>Session events</span></div>
      <div><strong>${tokenLabel}</strong><span>Session tokens</span></div>
      <div><strong class="mint">0</strong><span>Failed runs</span></div>
    </div>
    <div class="swarm-controls">
      <div class="filter-row swarm-filters" role="group" aria-label="Filter swarm activity">
        ${filters.map(([v,l])=>`<button class="filter-chip ${state.swarmFilter===v?'active':''}" data-action="swarm-filter" data-filter="${v}" aria-pressed="${state.swarmFilter===v}"><span>${l}</span></button>`).join('')}
      </div>
      <button class="secondary-button demo-event-button" data-action="demo-event">${icon('plus')}<span>Demo event</span></button>
    </div>
    <div class="swarm-layout"><div class="section-head"><span class="eyebrow muted">TODAY · SESSION LOG</span><span class="live-label"><i class="dot pulse"></i>LIVE</span></div><div class="feed-list">${list.map(feedItem).join('')||'<div class="empty-state">No events in this filter yet.</div>'}</div><div class="footer-note">${icon('info')}Tap an event to inspect its execution trace</div></div>`;
}

function nodesPage(){return `${pageHeading('Execution nodes','One workspace, two execution environments.',false)}<div class="nodes-page"><div class="node-grid">${nodeCard('vps',true)}${nodeCard('pc',true)}</div><section class="routing-panel"><div class="row between"><h2>Dual-node bridge</h2><span class="status-pill">${state.pcState==='online'?'CONNECTED':'PC UNAVAILABLE'}</span></div><p>Service 24/7 di VPS, komputasi GPU dan browser desktop di PC. Pilih target node saat mengirim task.</p><div class="routing-diagram"><div class="routing-end">${icon('server')}VPS Server</div><div class="routing-line"><span>SSH BRIDGE</span></div><div class="routing-end">${icon('monitor')}Windows PC</div></div><div class="tool-tags"><span>Encrypted channel</span><span>Auto routing</span><span>Wake-on-LAN</span></div></section><div class="section-head" style="margin-top:26px"><h2>Services & capabilities</h2><span class="eyebrow muted">DEMO</span></div><div class="service-list">${[['server','Hermes cockpit','FastAPI · VPS :3450','Healthy'],['network','Automation services','Docker · n8n · PM2 · VPS','Running'],['monitor','Desktop bridge','SSH · Playwright · Windows PC',state.pcState==='online'?'Connected':'Offline'],['cpu','GPU worker','NVIDIA RTX 4070 · Windows PC',state.pcState==='online'?'Ready':'Offline']].map(([ic,t,d,s])=>`<div class="service-row">${icon(ic)}<div><strong>${t}</strong><p>${d}</p></div><span class="node-status"><i class="dot" style="${s==='Offline'?'background:#FFEBD3':''}"></i>${s}</span></div>`).join('')}</div></div><div class="footer-note">${icon('info')}Tap a node for metrics and power controls</div>`}
function getMessages(id){if(!state.messages[id])state.messages[id]=[{role:'agent',text:getAgent(id).greeting,time:'20:42'}];return state.messages[id]}
function chatPage(){const a=getAgent(state.agent),msgs=getMessages(a.id);return `<section class="chat-layout"><header class="chat-header"><button class="icon-button back" data-action="navigate" data-page="agents" aria-label="Back to agents">${icon('back')}</button>${avatar(a.id)}<div class="chat-header-info"><h2>${a.name} <span style="color:#654e46;font-weight:400">/ ${a.role}</span></h2><p><span class="mint">●</span> Online · Isolated workspace</p></div><button class="icon-button" data-action="profile" data-agent="${a.id}" aria-label="Agent profile">${icon('settings')}</button><button class="icon-button" data-action="execution" aria-label="Execution console">${icon('terminal')}</button></header><div class="chat-messages" id="chat-messages"><div class="chat-date">Today · ${a.name} workspace</div>${msgs.map(m=>`<div class="message ${m.role==='user'?'user':''}">${m.role==='user'?'<span class="feed-avatar" style="color:#785043;background:#FFB6A6;font-size:8px">YOU</span>':feedAvatar(a.id)}<div class="message-content"><div class="message-label"><span>${m.role==='user'?'You':a.name}</span><time>${esc(m.time)}</time></div><div class="bubble">${esc(m.text)}</div>${m.node?`<span class="feed-tag">${icon(m.node==='pc'?'monitor':'server')}${m.node==='pc'?'Windows PC':'VPS Server'} · ${m.role==='user'?'target node':'demo execution'}</span>`:''}${m.execution?`<button class="feed-tag success" data-action="execution" data-node="${m.node}">${icon('terminal')}Inspect execution ${icon('arrow')}</button>`:''}</div></div>`).join('')}${state.chatBusy[a.id]?`<div class="message">${feedAvatar(a.id)}<div class="bubble"><span class="typing-dots"><i></i><i></i><i></i></span> <span style="font-size:10px;color:var(--muted)">Processing demo task...</span></div></div>`:''}</div><div class="chat-prompts">${a.prompts.map((p,i)=>`<button data-action="chat-prompt" data-index="${i}">${p}</button>`).join('')}</div><form class="chat-composer" id="chat-form"><label class="composer-route" for="chat-route">${icon('network')}Execute on <select id="chat-route" aria-label="Target execution node"><option value="auto" ${state.route==='auto'?'selected':''}>Auto route</option><option value="vps" ${state.route==='vps'?'selected':''}>VPS Server</option><option value="pc" ${state.route==='pc'?'selected':''}>Windows PC${state.pcState!=='online'?' (offline)':''}</option></select></label><div class="compose-box"><textarea id="chat-input" rows="1" placeholder="Message ${a.name}..." aria-label="Message ${a.name}" required maxlength="3000"></textarea><button class="send-button" type="submit" ${state.chatBusy[a.id]?'disabled':''} aria-label="Send message">${icon('send')}</button></div><p class="composer-note">Demo workspace · Responses and executions are simulated</p></form></section>`}
function scrollChat(){requestAnimationFrame(()=>{const c=$('#chat-messages');if(c)c.scrollTop=c.scrollHeight})}
function openSheet(title,subtitle,body,footer='',wide=false){
  state.overlay=title;
  window.HermesUI.openSheet({title,subtitle,body,footer,wide,onDismiss:()=>{state.overlay=null}});
}
function closeSheet(){state.overlay=null;window.HermesUI.closeSheet()}
function openNewMission(){state.newRoute='auto';openSheet('New mission','Give your swarm a goal. Hermes handles the handoffs.',`<form id="mission-form"><label class="field"><span class="field-label">Mission name</span><input id="mission-title" name="title" placeholder="e.g. Build a customer dashboard" required maxlength="90" autocomplete="off"></label><label class="field"><span class="field-label">What should the agents do?</span><textarea id="mission-prompt" name="prompt" placeholder="Describe the outcome, constraints, and acceptance criteria..." required maxlength="3000"></textarea></label><div class="field-label">Execution target</div><div class="route-selector">${[['auto','compass','Auto route'],['vps','server','VPS Server'],['pc','monitor','Windows PC']].map(([v,i,t])=>`<button type="button" class="route-option ${v==='auto'?'selected':''}" data-action="new-route" data-route="${v}">${icon(i)}${t}</button>`).join('')}</div><p class="new-mission-hint">Main will break down your mission and assign specialists. This preview runs a simulated workflow.</p></form>`,`<button class="primary-button" type="submit" form="mission-form">${icon('bolt')} Launch mission</button>`)}
const milestones=['Plan & assign agents','Implement webhook endpoint','Run automated tests','Security & code review','Deploy & verify'];
function missionDetail(){const m=state.mission;openSheet(esc(m.title),`${esc(m.id)} · ${m.node==='pc'?'Windows PC':'VPS Server'} · ${m.stage===5?'Complete':m.paused?'Paused':'In progress'}`,`<div class="detail-grid"><div class="detail-block"><span>Progress</span><strong>${m.stage*20}% <small>· ${m.stage}/5 milestones</small></strong></div><div class="detail-block"><span>Assigned agents</span><strong>Main, Coder, QA</strong></div></div><p>${esc(m.prompt)}</p><div class="sheet-section-title">${icon('network')}Milestone plan</div>${milestones.map((t,i)=>`<div class="milestone"><span class="step-icon ${i>=m.stage?'pending':''}">${i<m.stage?icon('check'):i+1}</span><div><strong>${i===1&&m.id!=='MSN-024'?'Implement requested changes':t}</strong><small>${i<m.stage?'Completed':i===m.stage?(m.paused?'Paused':'In progress'):'Queued'}</small></div><span class="mini-avatar muted">${['Main','Coder','Coder','QA','DevOps'][i]}</span></div>`).join('')}`,m.stage<5?`<button class="secondary-button" data-action="pause-mission">${icon(m.paused?'play':'pause')}${m.paused?'Resume':'Pause'}</button><button class="primary-button" data-action="complete-mission">${icon('check')}Complete demo run</button>`:`<button class="primary-button" data-action="new-mission">${icon('plus')}Start another mission</button>`)}
function profile(id){const a=getAgent(id);openSheet(`${a.name} / Profile`,a.role,`<div class="row between" style="margin-bottom:20px">${avatar(id,'large')}<span class="status-pill">${a.status.toUpperCase()}</span></div><p>${a.description}</p><div class="sheet-section-title">${icon('file')}Agent instructions</div><div class="profile-instructions">${a.instruction}</div><div class="sheet-section-title">${icon('bolt')}Available tools</div><div class="tool-tags">${a.tools.map(t=>`<span>${t}</span>`).join('')}</div><div class="notice">Percakapan agen ini memiliki workspace terpisah. Aktivitas yang dibagikan antar agen tampil di Swarm feed.</div>`,`<button class="primary-button" data-action="chat" data-agent="${id}">Open direct chat ${icon('arrow')}</button>`)}
function addFeed(f){state.feed.unshift({id:Date.now()+Math.random(),time:'Just now',tokens:640,...f});persist()}
function openTrace(id,tab='timeline'){const f=state.feed.find(x=>String(x.id)===String(id));if(!f)return;state.traceId=f.id;state.traceTab=tab;let body=`<div class="trace-tabs">${[['timeline','Trace'],['tree','Task tree'],['payload','Payload'],['tokens','Tokens']].map(([v,t])=>`<button class="${tab===v?'active':''}" data-action="trace-tab" data-tab="${v}">${t}</button>`).join('')}</div>`;if(tab==='timeline')body+=`<div class="detail-grid"><div class="detail-block"><span>Execution node</span><strong>${f.node==='pc'?'Windows PC':'VPS Server'}</strong></div><div class="detail-block"><span>Run status</span><strong class="mint">${f.type==='handoff'?'Dispatched':'Succeeded'}</strong></div></div><div class="trace-event"><small>01 · INPUT</small><p>${esc(f.text)}</p></div><div class="trace-event"><small>02 · TASK ASSIGNMENT</small><p>${getAgent(f.from).name}${f.to?` → ${getAgent(f.to).name}`:''}. Target: ${f.node==='pc'?'Windows PC via SSH bridge':'VPS · webserver-xeron'}.</p></div><div class="trace-event"><small>03 · OBSERVABLE RESULT</small><p>${esc(f.tag)}. ${f.type==='handoff'?'Task added to the recipient agent workspace.':'Output captured in the execution console.'}</p></div><div class="notice">Trace menampilkan ringkasan langkah, handoff, dan hasil eksekusi yang dapat diamati. Data pada preview ini merupakan simulasi.</div>`;
 if(tab==='tree'){body+=`<div class="task-tree"><div class="tree-root">${icon('network')}<div><strong>${f.type==='system'?'Node operations':'Mission orchestration'}</strong><small>Shared workspace</small></div></div><div class="tree-branch"><div class="tree-leaf">${feedAvatar(f.from)}<div><strong>${getAgent(f.from).name}</strong><small>${f.type==='system'?'Inspect node connectivity':'Receive task and execute assigned work'}</small></div><span class="feed-tag success">done</span></div><div class="tree-branch"><div class="tree-leaf">${icon(f.type==='tool'?'terminal':f.to?getAgent(f.to).icon:'server')}<div><strong>${f.to?getAgent(f.to).name:f.type==='tool'?'Tool execution':'Node health check'}</strong><small>${esc(f.tag)}</small></div></div><div class="tree-leaf">${icon('check')}<div><strong>Capture result</strong><small>Payload, output, and token footprint</small></div></div></div></div></div><div class="notice">Pohon task contoh memperlihatkan hubungan parent dan subtask, handoff agen, serta hasil yang dapat diperiksa.</div>`}
 if(tab==='payload'){const payload={event:f.type,from:f.from,to:f.to||null,node:f.node,input:{task:f.text},output:{status:f.type==='handoff'?'dispatched':'success',summary:f.tag},tokens:f.tokens,mode:'demo'};body+=`<div class="terminal"><div class="terminal-top">event.payload.json<button data-action="copy-payload">${icon('copy')}</button></div><pre>${esc(JSON.stringify(payload,null,2))}</pre></div>`;state.copyPayload=JSON.stringify(payload,null,2)}
 if(tab==='tokens'){const input=Math.round(f.tokens*.67),output=f.tokens-input;body+=`<div class="detail-grid"><div class="detail-block"><span>Input tokens</span><strong>${input.toLocaleString()}</strong></div><div class="detail-block"><span>Output tokens</span><strong>${output.toLocaleString()}</strong></div><div class="detail-block"><span>Total footprint</span><strong class="mint">${f.tokens.toLocaleString()} tokens</strong></div><div class="detail-block"><span>Execution duration</span><strong>${f.type==='tool'?'2.84s':'1.26s'}</strong></div></div><div class="metric-line"><span>Input / Output</span><strong>67% / 33%</strong></div><div class="metric-track" style="height:8px"><i style="width:67%"></i></div><div class="notice">Token counts dan durasi adalah data contoh untuk menunjukkan observability per run.</div>`}
 openSheet('Execution trace',`${getAgent(f.from).name}${f.to?' → '+getAgent(f.to).name:''} · ${f.type}`,body,`<button class="primary-button" data-action="execution" data-node="${f.node}">${icon('terminal')}Open execution console</button>`,true)}
function execution(tab='terminal'){state.execTab=tab;const pc=state.executionNode==='pc';let body=`<div class="trace-tabs">${[['terminal','Terminal'],['patch','File diff'],['browser','Browser']].map(([v,t])=>`<button class="${tab===v?'active':''}" data-action="exec-tab" data-tab="${v}">${icon(v==='patch'?'file':v==='browser'?'browser':'terminal')}${t}</button>`).join('')}</div><div class="row between" style="margin-bottom:16px"><span class="node-status"><i class="dot"></i>Coder · ${pc?'Windows PC':'VPS Server'}</span><span class="header-time">Run #024 · demo</span></div>`;
 if(tab==='terminal')body+=`<div class="terminal"><div class="terminal-top"><span>${pc?'C:/hermes-cockpit':'~/hermes-cockpit'}</span><span>${pc?'PowerShell':'bash'}</span></div><pre><span class="dim">20:44:12  coder@${pc?'192.168.1.26':'webserver-xeron'}</span>\n<span class="command">$ python -m pytest tests/ -v</span>\n\n<span class="dim">platform ${pc?'win32':'linux'} · Python 3.12.3</span>\ncollected 12 items\n\ntest_webhook.py::test_receive       <span class="success">PASSED</span>\ntest_webhook.py::test_auth          <span class="success">PASSED</span>\ntest_webhook.py::test_bad_payload   <span class="success">PASSED</span>\ntest_webhook.py::test_retry         <span class="success">PASSED</span>\n<span class="dim">... 8 more tests</span>\n\n<span class="success">============ 12 passed in 2.84s ============</span>\n<span class="command">Process finished with exit code 0</span>\n<span class="dim">20:44:15  Handing off to QA agent.</span></pre></div>`;
 if(tab==='patch')body+=`<div class="terminal"><div class="terminal-top"><span>api/routes/webhook.py</span><span class="mint">+18 −2</span></div><pre><span class="dim">@@ -12,2 +12,18 @@</span>\n<span class="removed">- @router.post("/webhook")\n- async def webhook(data: dict): ...</span>\n<span class="added">+ @router.post("/webhook", status_code=202)\n+ async def webhook(\n+     payload: WebhookPayload,\n+     request: Request,\n+     signature: str = Header(...),\n+ ):\n+     verify_signature(\n+         await request.body(), signature\n+     )\n+     await queue.enqueue(payload)\n+     return {"status": "accepted"}</span></pre></div><div class="notice">Patch preview · sample code for the webhook integration.</div>`;
 if(tab==='browser')body+=`<div class="terminal"><div class="terminal-top"><span>127.0.0.1:3456/docs</span><span>Playwright · sample</span></div><div style="background:#FFEBD3;color:#244653;padding:24px;min-height:240px"><div style="font-size:22px;font-weight:700;margin-bottom:4px">Hermes Webhook API <small style="font-size:9px;background:#67a2c5;padding:3px 6px;border-radius:6px;color:white">v1.0</small></div><div style="font-size:11px;color:#654e46;margin-bottom:26px">OpenAPI 3.1 · Interactive documentation</div><div style="padding:13px;border:1px solid #67a2c5;border-radius:7px;background:#dfeae2;font:10px var(--mono)"><b style="background:#244653;color:white;padding:4px 8px;border-radius:4px">POST</b> /webhook <span style="float:right">202</span></div><div style="margin-top:16px;font:10px var(--mono);line-height:1.8">Response body<br>{ "status": "accepted" }<br><span style="color:#244653">✓ Browser validation passed</span></div></div></div><div class="notice">Contoh snapshot browser dari alur validasi. Belum terhubung ke browser atau PC Anda.</div>`;
 openSheet('Execution console','Tool calls, patches, and browser output in one place.',body,`<button class="secondary-button" data-action="close">Close</button><button class="primary-button" data-action="chat" data-agent="coder">${icon('code')}Chat with Coder</button>`,true)}
function nodeDetail(id){state.nodeId=id;const pc=id==='pc',offline=pc&&state.pcState!=='online';openSheet(pc?'Windows PC':'VPS Server',pc?'192.168.1.26 · SSH / internal agent bridge':'webserver-xeron · Linux · service node',`<div class="detail-grid"><div class="detail-block"><span>CPU usage</span><strong>${offline?'0':pc?'18':'42'}%</strong><small> / ${pc?'16 threads':'8 vCPU'}</small></div><div class="detail-block"><span>Memory</span><strong>${offline?'—':pc?'12.2 / 32 GB':'5.1 / 8 GB'}</strong></div><div class="detail-block"><span>Disk</span><strong>${pc?'460 / 1,000 GB':'64 / 200 GB'}</strong></div><div class="detail-block"><span>Connectivity</span><strong class="${offline?'':'mint'}">${offline?state.pcState==='sleep'?'Sleeping':'Offline':pc?'4 ms · SSH healthy':'21 ms · Connected'}</strong></div></div><div class="sheet-section-title">${icon('bolt')}Workload capabilities</div><div class="tool-tags">${(pc?['GPU processing','Playwright · headed','Windows desktop','Wake-on-LAN']:['Docker containers','n8n workflows','PM2 daemons','Cron & webhooks']).map(s=>`<span>${s}</span>`).join('')}</div><div class="sheet-section-title">${icon('activity')}Health checks</div>${(pc?['SSH bridge','GPU availability','Desktop session']:['Hermes cockpit :3450','Docker engine','PM2 process manager']).map(t=>`<div class="milestone"><span class="step-icon ${offline?'pending':''}">${icon(offline?'moon':'check')}</span><div><strong>${t}</strong><small>${offline?'Waiting for node':'Healthy · last check just now'}</small></div></div>`).join('')}<div class="node-actions"><button class="secondary-button" data-action="diagnostic" data-node="${id}">${icon('activity')}Run diagnostics</button>${pc?`<button class="secondary-button" data-action="pc-power" data-power="${offline?'online':'sleep'}">${icon(offline?'power':'moon')}${offline?'Wake on LAN':'Sleep'}</button>${!offline?`<button class="secondary-button danger-button" data-action="confirm-shutdown">${icon('power')}Shutdown</button>`:''}`:''}</div><div class="notice">Kontrol node dan health check pada preview ini disimulasikan. Tidak ada perintah yang dikirim ke perangkat Anda.</div>`,`<button class="primary-button" data-action="node-task" data-node="${id}">${icon('plus')}Assign a task to this node</button>`)}
function pairDialog(){
  const currentHost = localStorage.getItem('hermes_base_url') || 'http://192.168.1.4:3450';
  const isPaired = !!hermesApi.accessToken;
  openSheet(
    isPaired ? 'Backend Connected' : 'Connect to Backend',
    isPaired ? `Workspace: ${hermesApi.workspaceId?.slice(0,8)}...` : 'Pair this device with your Hermes VPS server',
    `<form id="pair-form">
      <label class="field">
        <span class="field-label">Server Host URL</span>
        <input id="server-url" name="url" value="${esc(currentHost)}" placeholder="http://192.168.1.4:3450" required autocomplete="off">
      </label>
      ${!isPaired ? `
      <label class="field">
        <span class="field-label">26-Character Pairing Code</span>
        <input id="pair-code" name="code" placeholder="e.g. M24GGV2DTPTJDX32RTMK45QCJN" required maxlength="32" style="text-transform:uppercase" autocomplete="off">
      </label>
      <label class="field">
        <span class="field-label">Device Name</span>
        <input id="device-name" name="device" value="Cockpit Client" required maxlength="50" autocomplete="off">
      </label>
      ` : `
      <div class="notice">Perangkat ini sudah terautentikasi dan menerima data live dari backend PostgreSQL & WebSocket telemetry.</div>
      `}
    </form>`,
    isPaired 
      ? `<button class="secondary-button" data-action="disconnect-backend">Disconnect</button><button class="primary-button" data-action="close">Done</button>`
      : `<button class="primary-button" type="submit" form="pair-form">${icon('network')} Pair & Connect</button>`
  );
}

function about(){openSheet('Meet your mission control','Hermes · Demo app',`<div style="margin-bottom:23px">${brand}</div><p>Kelola agent fleet, pantau komunikasi antar agen, dan arahkan eksekusi ke VPS atau Windows PC dari satu tampilan mobile.</p><div class="sheet-section-title">${icon('bolt')}Try the prototype</div>${[['New mission','Buat misi dan pilih node tujuan.'],['Agent workspaces','Buka chat terpisah untuk setiap agen.'],['Swarm feed','Ketuk event untuk melihat trace, payload, dan token.'],['Execution nodes','Periksa metrik dan coba kontrol daya PC.']].map(([a,b])=>`<div class="milestone"><span class="step-icon">${icon('check')}</span><div><strong>${a}</strong><small>${b}</small></div></div>`).join('')}<div class="notice">Aplikasi ini berjalan dalam mode demo. Percakapan, telemetry, terminal, dan kontrol perangkat menggunakan data simulasi. Riwayat demo disimpan secara lokal di perangkat ini.</div>`,`<button class="secondary-button" data-action="reset-demo">Reset demo</button><button class="primary-button" data-action="close">Explore Hermes ${icon('arrow')}</button>`)}
function notifications(){openSheet('Notifications','Recent activity in your workspace',state.feed.slice(0,4).map(feedItem).join(''),`<button class="primary-button" data-action="navigate" data-page="swarm">Open swarm feed ${icon('arrow')}</button>`)}
function chatReply(id,text,node){const lower=text.toLowerCase();if(node==='pc'&&state.pcState!=='online')return 'Windows PC sedang '+(state.pcState==='sleep'?'sleep':'offline')+'. Bangunkan node melalui Nodes → Windows PC → Wake on LAN, lalu kirim kembali task ini. Task belum dieksekusi.';if(id==='main')return `Misi diterima. Rencana demo saya:\n\n1. Researcher menyiapkan konteks dan kebutuhan.\n2. Coder mengerjakan implementasi di ${node==='pc'?'Windows PC':'VPS'}.\n3. QA memeriksa hasil dan pengujian.\n4. DevOps memverifikasi service.\n\nHandoff contoh sudah ditambahkan ke Swarm feed. Gunakan New mission untuk melacak milestone-nya.`;if(id==='coder')return /test|pengujian|hasil/.test(lower)?'Hasil pengujian contoh: 12 passed, 0 failed dalam 2.84 detik. Exit code 0.\n\nPerubahan sudah diteruskan ke QA untuk code review. Buka execution console untuk memeriksa terminal dan file diff.':`Task diterima untuk ${node==='pc'?'Windows PC (192.168.1.26)':'VPS (webserver-xeron)'}.\n\nPada alur demo ini, saya menyiapkan workspace, menjalankan build, lalu memvalidasi hasilnya. Build contoh selesai dengan exit code 0. Detail dapat Anda lihat di execution console.`;if(id==='devops')return /log|3450/.test(lower)?'Log contoh hermes-cockpit :3450:\n\n[INFO] Application startup complete\n[INFO] GET /health → 200 OK\n[INFO] Agent bridge connected\n[INFO] Task queue healthy\n\nTidak ada error pada cuplikan log demo ini.':'Health check demo selesai:\n\nVPS · CPU 42% · RAM 64% · Disk 32%\nUptime 14d 8h · Ping 21 ms\n\nPC · CPU 18% · RAM 38% · Disk 46%\nUptime 6h 42m · Ping 4 ms\n\nBuka Nodes untuk detail metrik dan kontrol daya.';if(id==='researcher')return 'Saya sudah menyiapkan alur pencarian demo:\n\n1. Telusuri referensi yang sesuai dengan permintaan Anda.\n2. Cari konteks terkait di Obsidian Brain.\n3. Susun ringkasan, sumber, dan rekomendasi.\n\nPada prototipe ini belum ada pencarian web atau akses vault sungguhan; hasil dan handoff yang tampil adalah contoh.';return 'Review demo selesai.\n\n✓ Acceptance criteria tervalidasi\n✓ 12 automated tests passed\n✓ Signature validation tersedia\n✓ Tidak ada temuan pada security scan contoh\n\nHasil review telah diteruskan ke Main melalui Swarm feed.'}
async function sendChat(text){
  text = text.trim();
  if(!text || state.chatBusy[state.agent]) return;
  const id = state.agent;
  let node = state.route==='auto'?(/\bpc\b|gpu|windows|desktop|compile/i.test(text)?'pc':'vps'):state.route;

  getMessages(id).push({role:'user',text,time:now(),node});
  state.chatBusy[id]=true;
  persist();
  shell();

  try {
    // If paired with real backend, send via API Client
    if (hermesApi.accessToken) {
      if (!state.sessionIds) state.sessionIds = {};
      let sessId = state.sessionIds[id];
      if (!sessId) {
        const newSess = await hermesApi.createSession(id, `Direct chat: ${id}`, true);
        sessId = newSess.id;
        state.sessionIds[id] = sessId;
      }
      await hermesApi.sendMessage(sessId, text, { target_node: node });
    } else {
      // Fallback demo response if not paired yet
      setTimeout(()=>{
        const failed=node==='pc'&&state.pcState!=='online';
        getMessages(id).push({role:'agent',text:chatReply(id,text,node),time:now(),node,execution:['coder','devops','qa'].includes(id)&&!failed});
        state.chatBusy[id]=false;
        if(!failed)addFeed({from:id,to:id==='main'?'coder':id==='qa'?'main':undefined,text:id==='main'?'Rencana demo dibuat; implementasi diteruskan ke Coder.':`${getAgent(id).name} menyelesaikan task: ${text.slice(0,95)}`,tag:id==='main'?'Task dispatched':'Task complete · exit 0',type:id==='main'?'handoff':'tool',node,tokens:1280});
        persist();
        if(state.page==='chat'&&state.agent===id)shell();
        else toast(`${getAgent(id).name} completed task`);
      },1100);
    }
  } catch(err) {
    state.chatBusy[id]=false;
    toast(`Backend error: ${err.message}`);
    shell();
  }
}
document.addEventListener('click',async e=>{if(e.target.id==='overlay-backdrop'){closeSheet();return}const b=e.target.closest('[data-action]');if(!b)return;const action=b.dataset.action;
 if(action==='navigate'){closeSheet();state.page=b.dataset.page;shell();window.scrollTo(0,0)}
 if(action==='chat'){closeSheet();state.agent=b.dataset.agent;state.page='chat';shell();window.scrollTo(0,0)}
 if(action==='new-mission')openNewMission();
 if(action==='close')closeSheet();
 if(action==='about')about();
 if(action==='pair-dialog')pairDialog();
 if(action==='disconnect-backend'){
   hermesApi.clearTokens();
   closeSheet();
   shell();
   toast('Disconnected from backend. Switched to local mode.');
 }
 if(action==='notifications')notifications();
 if(action==='mission-detail')missionDetail();
 if(action==='execution'){state.executionNode=b.dataset.node||(state.page==='chat'?(getMessages(state.agent).filter(m=>m.execution).at(-1)?.node||'vps'):'vps');execution()}
 if(action==='profile')profile(b.dataset.agent);
 if(action==='node-detail')nodeDetail(b.dataset.node);
 if(action==='trace')openTrace(b.dataset.id);
 if(action==='trace-tab')openTrace(state.traceId,b.dataset.tab);
 if(action==='exec-tab')execution(b.dataset.tab);
 if(action==='fleet-filter'){state.fleetFilter=b.dataset.filter;shell()}
 if(action==='swarm-filter'){state.swarmFilter=b.dataset.filter;shell()}
 if(action==='new-route'){state.newRoute=b.dataset.route;document.querySelectorAll('.route-option').forEach(el=>el.classList.toggle('selected',el.dataset.route===state.newRoute))}
 if(action==='pause-mission'){state.mission.paused=!state.mission.paused;persist();shell();missionDetail();toast(state.mission.paused?'Mission paused':'Mission resumed')}
 if(action==='complete-mission'){state.mission.stage=5;state.mission.paused=false;addFeed({from:'qa',to:'main',text:'Security review dan verifikasi demo lolos. Misi selesai.',tag:'Mission completed',type:'handoff',node:state.mission.node,tokens:780});persist();shell();missionDetail();toast('Demo mission complete. All 5 milestones passed.')}
 if(action==='chat-prompt'){const a=getAgent(state.agent);$('#chat-input').value=a.prompts[Number(b.dataset.index)];$('#chat-input').focus()}
 if(action==='demo-event'){state.swarmFilter='all';addFeed({from:'qa',to:'main',text:'Security scan lolos. Tidak ada temuan pada review contoh; siap deploy.',tag:'Review approved',type:'handoff',node:'vps',tokens:960});shell();toast('Demo event added to the swarm feed')}
 if(action==='diagnostic'){b.disabled=true;b.innerHTML=icon('activity')+'Checking...';setTimeout(()=>{addFeed({from:'devops',text:`Diagnostik contoh ${b.dataset.node==='pc'?'Windows PC':'VPS'} selesai. ${b.dataset.node==='pc'&&state.pcState!=='online'?'Node belum online.':'Semua health check lolos.'}`,tag:'Diagnostic complete',type:'system',node:b.dataset.node,tokens:320});if(state.overlay)nodeDetail(b.dataset.node);toast('Demo diagnostics complete')},850)}
 if(action==='pc-power'){state.pcState=b.dataset.power;addFeed({from:'devops',text:state.pcState==='online'?'Wake-on-LAN demo berhasil. Windows PC kembali terhubung.':'Windows PC masuk mode sleep pada simulasi.',tag:state.pcState==='online'?'PC online':'PC sleeping',type:'system',node:'pc',tokens:120});shell();nodeDetail('pc');toast(state.pcState==='online'?'Demo: Windows PC is online':'Demo: Windows PC is sleeping')}
 if(action==='confirm-shutdown')openSheet('Shutdown Windows PC?','Simulated power action',`<p>Node PC akan ditandai offline pada demo. Task baru perlu menunggu node dinyalakan kembali. VPS tetap tersedia.</p><div class="notice">Tindakan ini hanya mengubah status di prototipe.</div>`,`<button class="secondary-button" data-action="close">Cancel</button><button class="primary-button" data-action="shutdown">${icon('power')}Simulate shutdown</button>`);
 if(action==='shutdown'){state.pcState='offline';addFeed({from:'devops',text:'Shutdown demo selesai. Windows PC sekarang offline.',tag:'PC offline',type:'system',node:'pc',tokens:120});shell();nodeDetail('pc');toast('Demo: Windows PC shut down')}
 if(action==='node-task'){const id=b.dataset.node;if(id==='pc'&&state.pcState!=='online'){toast('Wake the PC before assigning a task');return}closeSheet();state.agent='main';state.route=id;state.page='chat';shell();$('#chat-input').focus()}
 if(action==='copy-payload'){try{await window.HermesNative.copyText(state.copyPayload);toast('Payload copied')}catch{toast('Copy is unavailable in this browser')}}
 if(action==='reset-demo'){state.mission={...initialMission};state.feed=initialFeed.map(f=>({...f}));state.messages={};state.pcState='online';state.route='auto';state.page='overview';persist();closeSheet();shell();toast('Demo reset to its initial state')}
});
document.addEventListener('change',e=>{if(e.target.id==='chat-route')state.route=e.target.value});
document.addEventListener('submit',async e=>{
  if(e.target.id==='pair-form'){
    e.preventDefault();
    const url = $('#server-url').value.trim();
    const code = $('#pair-code')?.value.trim();
    const device = $('#device-name')?.value.trim() || 'Cockpit Client';
    if(!url || !code){ toast('Enter server URL and pairing code'); return; }
    
    localStorage.setItem('hermes_base_url', url);
    hermesApi.baseUrl = url.replace(/\/$/, '');
    hermesApi.wsUrl = hermesApi.baseUrl.replace(/^http/, 'ws');
    
    try {
      toast('Connecting to backend...');
      await hermesApi.pair(code, device);
      await initBackendTelemetry();
      closeSheet();
      shell();
      toast('Paired successfully! Real backend connected.');
    } catch(err) {
      toast(`Pairing failed: ${err.message}`);
    }
    return;
  }
  if(e.target.id==='chat-form'){e.preventDefault();sendChat($('#chat-input').value)}  if(e.target.id==='mission-form'){
    e.preventDefault();
    const title=$('#mission-title').value.trim(), prompt=$('#mission-prompt').value.trim();
    if(!title||!prompt){ toast('Fill in the mission name and instructions'); return; }
    if(state.newRoute==='pc'&&state.pcState!=='online'){ toast('Wake the PC in Nodes before launching'); return; }
    const node=state.newRoute==='auto'?(/\bpc\b|gpu|windows|desktop/i.test(prompt)?'pc':'vps'):state.newRoute;
    if(node==='pc'&&state.pcState!=='online'){ toast('Auto route selected PC. Wake the node first.'); return; }
    
    if (hermesApi.accessToken) {
      try {
        toast('Submitting mission to backend...');
        const res = await hermesApi.createMission(title, prompt, { target_node: node });
        const m = res.mission;
        state.mission = {
          title: m.title,
          prompt: m.prompt,
          node: m.requested_node || node,
          id: m.id?.slice(0, 8) || 'MSN-NEW',
          stage: 1,
          paused: false,
          description: 'Mission queued on central durable scheduler'
        };
        toast('Mission created & dispatched!');
      } catch(err) {
        toast(`Failed to create mission: ${err.message}`);
      }
    } else {
      state.mission={title,prompt,node,id:'MSN-'+String(25+state.feed.filter(f=>f.tag==='Mission created').length).padStart(3,'0'),stage:1,paused:false,description:'Main has assigned specialists to your mission'};
      addFeed({from:'main',to:'coder',text:prompt,tag:'Mission created',type:'handoff',node,tokens:840});
      toast('Mission launched (demo)');
    }
    persist();
    closeSheet();
    state.page='overview';
    shell();
    window.scrollTo(0,0);
  }});
async function initBackendTelemetry() {
  if (!hermesApi.accessToken) return;
  try {
    const bootstrap = await hermesApi.getBootstrap();
    if (bootstrap.agents) {
      for (const ba of bootstrap.agents) {
        const local = agents.find(a => a.id === ba.id);
        if (local) {
          local.status = ba.status === 'idle' ? 'Standby' : ba.status === 'busy' ? 'Working' : ba.status;
          if (ba.tools) local.tools = ba.tools;
          if (ba.instructions) local.instruction = ba.instructions;
        }
      }
    }
    if (bootstrap.nodes) {
      for (const bn of bootstrap.nodes) {
        if (bn.id === 'pc') {
          state.pcState = bn.status === 'online' ? 'online' : 'offline';
        }
      }
    }
    // Fetch initial swarm events from backend
    try {
      const evPage = await hermesApi.getSwarmEvents();
      if (evPage.items && evPage.items.length > 0) {
        state.feed = evPage.items.map(ev => ({
          id: ev.event_id,
          from: ev.sender || 'system',
          to: ev.target !== 'all' ? ev.target : undefined,
          text: ev.payload?.content || ev.payload?.prompt || `Event ${ev.event_type}`,
          tag: ev.event_type,
          type: ev.event_type.includes('DISPATCH') ? 'handoff' : 'tool',
          node: ev.node || 'vps',
          tokens: 500,
          time: new Date(ev.timestamp).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })
        }));
      }
    } catch(e) {
      console.warn('Initial events load error:', e);
    }
    await hermesApi.connectTelemetry((envelope) => {
      if (envelope.event_type === 'MESSAGE_FINAL') {
        const payload = envelope.payload || {};
        const agentId = envelope.sender;
        if (agentId && payload.content) {
          getMessages(agentId).push({
            role: 'agent',
            text: payload.content,
            time: now(),
            node: envelope.node || 'vps'
          });
          state.chatBusy[agentId] = false;
          persist();
          shell();
        }
      } else if (envelope.event_type === 'TASK_STATE') {
        const payload = envelope.payload || {};
        addFeed({
          from: envelope.sender,
          text: `Task ${payload.task_id?.slice(0,8)} status updated to ${payload.status}`,
          tag: `Task ${payload.status}`,
          type: 'tool',
          node: envelope.node || 'vps',
          tokens: 500
        });
        shell();
      }
    });
  } catch(e) {
    console.warn('Telemetry init error:', e);
  }
}

initBackendTelemetry();

document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.overlay)closeSheet();if(e.target.id==='chat-input'&&e.key==='Enter'&&!e.shiftKey){e.preventDefault();$('#chat-form').requestSubmit()}if(e.key==='Tab'&&state.overlay){const els=[...document.querySelectorAll('#overlay-root button:not([disabled]), #overlay-root input, #overlay-root textarea, #overlay-root select, #overlay-root [tabindex="0"]')].filter(el=>el.getClientRects().length&&!el.closest('[inert]'));const first=els[0],last=els.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus()}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus()}}});
shell();
