const $ = (s,root=document)=>root.querySelector(s);
const icons={
download:'<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
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

export { $, icon, esc, brand };
