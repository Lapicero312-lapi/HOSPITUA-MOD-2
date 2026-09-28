// Utilidades compartidas por las dos vistas del wireframe.
function toast(msg, isErr){
  const t = document.getElementById('toast');
  if(!t) return;
  t.textContent = msg;
  t.className = 'toast' + (isErr ? ' err' : '');
  t.hidden = false;
  clearTimeout(window._tt);
  window._tt = setTimeout(() => t.hidden = true, 3400);
}
function openModal(id){ document.getElementById(id).hidden = false; }
function closeModal(id){ document.getElementById(id).hidden = true; }
function money(n){ return '$' + Math.round(n).toLocaleString('es-CO'); }
function nightsBetween(startISO, endISO){
  const a = new Date(startISO), b = new Date(endISO);
  const ms = b - a;
  return Math.round(ms / 86400000);
}
// Avatar circle con iniciales, color estable por nombre.
const AVATAR_PALETTE = ['#4f46e5','#0891b2','#b45309','#be185d','#15803d','#6d28d9','#0369a1','#c2410c'];
function initials(name){
  return (name || '').split(' ').filter(Boolean).slice(0,2).map(w => w[0].toUpperCase()).join('');
}
function avatarHTML(name){
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  const color = AVATAR_PALETTE[hash % AVATAR_PALETTE.length];
  return `<span class="av" style="background:${color}">${initials(name)}</span>`;
}
// Menú lateral en pantallas angostas: botón ☰ + fondo que cierra al tocarlo fuera.
function toggleSide(){
  document.getElementById('side').classList.toggle('open');
  document.getElementById('sideBackdrop').hidden = !document.getElementById('side').classList.contains('open');
}
function closeSide(){
  const side = document.getElementById('side');
  if (!side) return;
  side.classList.remove('open');
  const bd = document.getElementById('sideBackdrop');
  if (bd) bd.hidden = true;
}
