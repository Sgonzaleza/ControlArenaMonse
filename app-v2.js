/* Arena Control 2.0 — lotes FIFO, ventas rápidas, cobranza y respaldo local. */
"use strict";
const KEY_V2 = "arenaControlSingleHTML_v20";
const KEY_V1 = "arenaControlSingleHTML_v11";
const $ = id => document.getElementById(id);
const uid = () => crypto.randomUUID();
const num = v => Number(v || 0);
const money = v => new Intl.NumberFormat("es-CL",{style:"currency",currency:"CLP",maximumFractionDigits:0}).format(num(v));
const today = () => { const d = new Date(); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-"); };
const esc = v => String(v ?? "").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]));
const fmt = v => v ? v.split("-").reverse().join("-") : "Sin fecha";
const addDays = (date,days) => { const d=new Date(date+"T12:00:00"); d.setDate(d.getDate()+num(days)); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,"0"),String(d.getDate()).padStart(2,"0")].join("-"); };
const cleanPhone = v => String(v||"").replace(/\D/g,"");
const fresh = () => ({
  version:2,
  settings:{businessName:"Arena Control",fixedCosts:0,whatsappMessage:"Hola {nombre}, ¿cómo estás? ¿Necesitas nuevamente arena para tu gato?"},
  clients:[],products:[],sales:[],lots:[],adjustments:[],
  selectedLotId:"",createdAt:new Date().toISOString()
});
function load(){
  try {
    const saved=localStorage.getItem(KEY_V2);
    if(saved) return normalize(JSON.parse(saved));
    const d=fresh(), old=localStorage.getItem(KEY_V1);
    if(old){
      const v=JSON.parse(old);
      d.clients=Array.isArray(v.clients)?v.clients:[];
      d.products=Array.isArray(v.products)?v.products.map(p=>({...p,brand:p.brand||"",format:p.format||""})):[];
      d.settings={...d.settings,...(v.settings||{})};
    }
    localStorage.setItem(KEY_V2,JSON.stringify(d));
    return d;
  } catch(err){
    alert("No se pudieron leer los datos locales. No se ha borrado el respaldo anterior. Revisa el almacenamiento antes de registrar ventas.");
    return fresh();
  }
}
function normalize(v){
  if(!v || v.version!==2 || !Array.isArray(v.clients) || !Array.isArray(v.products) ||
     !Array.isArray(v.sales) || !Array.isArray(v.lots) || !Array.isArray(v.adjustments))
     throw Error("El archivo no tiene el formato de Arena Control v2.");
  return {...fresh(),...v,settings:{...fresh().settings,...v.settings}};
}
let data=load();
// Cada apertura inicia en el pedido abierto más reciente, sin impedir
// que se consulte otro lote durante la sesión.
data.selectedLotId="";
const product = id => data.products.find(x=>x.id===id);
const client = id => data.clients.find(x=>x.id===id);
const lot = id => data.lots.find(x=>x.id===id);
const sortedLots = () => [...data.lots].sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt||"").localeCompare(b.createdAt||"")||a.id.localeCompare(b.id));
const sortedSales = () => [...data.sales].sort((a,b)=>a.date.localeCompare(b.date)||(a.createdAt||"").localeCompare(b.createdAt||"")||a.id.localeCompare(b.id));
const lotAdjustment = id => data.adjustments.filter(a=>a.lotId===id).reduce((n,a)=>n+num(a.qty),0);
const paymentsOf = s => (s.payments||[]).reduce((n,p)=>n+num(p.amount),0);
const balanceOf = s => Math.max(0,num(s.total)-paymentsOf(s));
const lotAvailable = l => num(l.qty)+lotAdjustment(l.id)-data.sales.reduce((n,s)=>n+(s.allocations||[]).filter(a=>a.lotId===l.id).reduce((v,a)=>v+num(a.qty),0),0);
const pendingFor = id => data.sales.filter(s=>s.productId===id).reduce((n,s)=>n+num(s.pendingQty),0);
const availableFor = id => data.lots.filter(l=>l.productId===id).reduce((n,l)=>n+num(l.qty)+lotAdjustment(l.id),0)-data.sales.filter(s=>s.productId===id).reduce((n,s)=>n+num(s.qty),0);
function recompute(){
  // Reconstrucción determinista por producto y antigüedad de venta/lote.
  // Unidades sin lote quedan pendientes hasta un futuro ingreso.
  const remaining=new Map(data.lots.map(l=>[l.id,Math.max(0,num(l.qty)+lotAdjustment(l.id))]));
  for(const s of data.sales){s.allocations=[];s.pendingQty=0;}
  for(const s of sortedSales()){
    let need=num(s.qty);
    for(const l of sortedLots()){
      if(l.productId!==s.productId || need<=0) continue;
      const left=remaining.get(l.id)||0;
      if(left<=0) continue;
      const take=Math.min(need,left);
      s.allocations.push({lotId:l.id,qty:take,unitCost:num(l.totalCost)/Math.max(1,num(l.qty))});
      remaining.set(l.id,left-take);
      need-=take;
    }
    s.pendingQty=need;
  }
}
function save(){
  recompute();
  try{localStorage.setItem(KEY_V2,JSON.stringify(data));}
  catch(e){alert("No se pudo guardar en este navegador. Exporta un respaldo y verifica el espacio disponible.");return;}
  render();
}
let toastTimer;
function toast(message){const el=$("toast");el.textContent=message;el.classList.add("show");clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.classList.remove("show"),3000);}
function goTo(id){
  document.querySelectorAll(".view").forEach(x=>x.classList.toggle("active",x.id===id));
  document.querySelectorAll(".tab").forEach(x=>x.classList.toggle("active",x.dataset.tab===id));
  if(id==="ventas") updateCalc();
}
document.querySelectorAll(".tab").forEach(t=>t.addEventListener("click",()=>goTo(t.dataset.tab)));
function render(){
  $("appTitle").textContent=data.settings.businessName||"Arena Control";
  renderSelects();renderDashboard();renderClients();renderProducts();renderSales();renderStock();renderHistory();renderSettings();
}
function renderSelects(){
  const selected = ids => ids.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.label)+'</option>').join("");
  const clientVal=$("saleClient").value, saleProductVal=$("saleProduct").value,
        stockProductVal=$("stockProduct").value, adjustVal=$("adjustLot").value;
  $("saleClient").innerHTML=selected(data.clients.map(c=>({id:c.id,label:c.name})));
  $("saleProduct").innerHTML=selected(data.products.map(p=>({id:p.id,label:p.name})));
  $("stockProduct").innerHTML=selected(data.products.map(p=>({id:p.id,label:p.name})));
  $("adjustLot").innerHTML=selected(data.lots.filter(l=>!l.closed).map(l=>({id:l.id,label:(product(l.productId)?.name||"Producto")+' · '+fmt(l.date)})));
  for(const [id,val] of [["saleClient",clientVal],["saleProduct",saleProductVal],["stockProduct",stockProductVal],["adjustLot",adjustVal]])
    if([...$(id).options].some(o=>o.value===val)) $(id).value=val;
  if(!$("saleId").value) fillProductPrice(false);
}
function selectDashboardLot(id){data.selectedLotId=id;save();}
function selectedLot(){
  let l=lot(data.selectedLotId);
  if(!l) l=[...data.lots].filter(x=>!x.closed).sort((a,b)=>b.date.localeCompare(a.date)||(b.createdAt||"").localeCompare(a.createdAt||""))[0]||[...sortedLots()].reverse()[0];
  return l;
}
function lotStats(l){
  const splits=data.sales.flatMap(s=>(s.allocations||[]).filter(a=>a.lotId===l.id).map(a=>({sale:s,...a})));
  const sold=splits.reduce((n,a)=>n+a.qty,0);
  const income=splits.reduce((n,a)=>n+a.qty*num(a.sale.price),0);
  const cost=splits.reduce((n,a)=>n+a.qty*a.unitCost,0);
  const lost=data.adjustments.filter(a=>a.lotId===l.id && a.qty<0).reduce((n,a)=>n+(-a.qty),0);
  return {sold,income,cost,profit:income-cost,available:lotAvailable(l),lost};
}
function renderDashboard(){
  const l=selectedLot(), select=$("dashboardLot");
  if(l && data.selectedLotId!==l.id) data.selectedLotId=l.id;
  select.innerHTML=[...data.lots].sort((a,b)=>b.date.localeCompare(a.date)).map(x=>`<option value="${esc(x.id)}">${esc(product(x.productId)?.name||"Producto")} · ${fmt(x.date)} ${x.closed?"(Finalizado)":"(Abierto)"}</option>`).join("")||'<option value="">Sin pedidos</option>';
  if(l) select.value=l.id;
  const st=l?lotStats(l):{sold:0,income:0,profit:0,available:0};
  $("mVentas").textContent=money(st.income);$("mUtilidad").textContent=money(st.profit);
  $("mSacos").textContent=st.sold;$("mStock").textContent=st.available;
  $("dashboardLotStatus").textContent=l?`${l.closed?"Finalizado":"Abierto"} · ${fmt(l.date)} · ${num(l.qty)} sacos ingresados · Costo total ${money(l.totalCost)}`:"Registra el primer pedido para comenzar.";
  const allPending=data.sales.reduce((n,s)=>n+balanceOf(s),0);
  $("dashboardCash").innerHTML=`<span>Cuentas por cobrar: <strong>${money(allPending)}</strong></span><span>Unidades por asignar: <strong>${data.sales.reduce((n,s)=>n+num(s.pendingQty),0)}</strong></span>`;
  $("peCostos").textContent=data.products.reduce((n,p)=>n+availableFor(p.id),0)+" sacos";
  $("peMargen").textContent=data.sales.reduce((n,s)=>n+num(s.pendingQty),0)+" sacos";
  $("peSacos").textContent=money(allPending);
  const due=data.clients.map(c=>{
    const s=[...data.sales].filter(s=>s.clientId===c.id).sort((a,b)=>b.date.localeCompare(a.date))[0];
    return {c,s,due:s?addDays(s.date,c.frequency||20):null};
  }).filter(x=>x.s && x.due<=today());
  $("contactList").innerHTML=due.length?due.map(({c,due})=>`<article class="item"><strong>${esc(c.name)}</strong><p class="item-meta">Recompra estimada: ${fmt(due)}</p>${c.phone?`<a class="button btn-secondary" target="_blank" rel="noopener" href="https://wa.me/${cleanPhone(c.phone)}">WhatsApp</a>`:""}</article>`).join(""):'<div class="empty">No hay recordatorios pendientes.</div>';
  $("lastSales").innerHTML=salesTable([...sortedSales()].reverse().slice(0,5),true);
}
function toggleBuyer(){
  const quick=$("saleBuyerType").value==="quick";
  $("saleBuyerNameWrap").classList.toggle("hidden",!quick);
  $("saleBuyerClientWrap").classList.toggle("hidden",quick);
  $("saleBuyerName").required=quick;
  $("saleClient").required=!quick;
}
function fillProductPrice(recalculate=true){
  const p=product($("saleProduct").value);
  if(p && !$("saleId").value) $("salePrice").value=p.price||0;
  if(recalculate) updateCalc();
}
function updateCalc(){
  const qty=num($("saleQty").value),price=num($("salePrice").value),del=num($("saleDelivery").value);
  const total=qty*price+del;
  $("calcTotal").textContent=money(total);
  $("calcBalance").textContent=money(Math.max(0,total-num($("saleInitialPayment").value)));
  $("calcProfit").textContent="Se calcula según los lotes disponibles";
}
function clearSale(){
  $("saleForm").reset();$("saleId").value="";$("saleDate").value=today();
  $("saleInitialPayment").disabled=false;
  $("saleSaveButton").textContent="Guardar venta";$("saleBuyerType").value="quick";toggleBuyer();fillProductPrice();
}
function buyerName(s){return s.clientId?(client(s.clientId)?.name||s.buyerName||"Cliente eliminado"):(s.buyerName||"Comprador");}
function saveSale(e){
  e.preventDefault();
  const id=$("saleId").value,existing=data.sales.find(s=>s.id===id);
  const qty=num($("saleQty").value),price=num($("salePrice").value),delivery=num($("saleDelivery").value);
  const total=qty*price+delivery,initial=num($("saleInitialPayment").value);
  const useClient=$("saleBuyerType").value==="client";
  const buyer=useClient?client($("saleClient").value)?.name:$("saleBuyerName").value.trim();
  if(!buyer || !product($("saleProduct").value) || !Number.isInteger(qty) || qty<1 || price<0 || delivery<0) return alert("Completa el comprador, producto, cantidad y precios válidos.");
  const payments=existing?(existing.payments||[]):(initial>0?[{id:uid(),date:$("saleDate").value,amount:initial,method:$("salePayment").value}]:[]);
  if(!existing && initial>total) return alert("El abono inicial no puede superar el total.");
  if(existing && payments.reduce((n,p)=>n+num(p.amount),0)>total) return alert("El nuevo total es menor que los abonos ya recibidos. Corrige los abonos primero.");
  const obj={id:id||uid(),createdAt:existing?.createdAt||new Date().toISOString(),date:$("saleDate").value,
    clientId:useClient?$("saleClient").value:null,buyerName:buyer,productId:$("saleProduct").value,
    qty,price,delivery,total,payment:$("salePayment").value,notes:$("saleNotes").value.trim(),payments};
  const before=existing?data.sales.filter(s=>s.id!==id):data.sales;
  const stock=data.lots.filter(l=>l.productId===obj.productId).reduce((n,l)=>n+num(l.qty)+lotAdjustment(l.id),0)-before.filter(s=>s.productId===obj.productId).reduce((n,s)=>n+num(s.qty),0);
  if(qty>stock && !confirm(`Hay ${stock} sacos disponibles. ${qty-stock} quedarán pendientes de asignar a un lote futuro. ¿Continuar?`)) return;
  if(existing) data.sales=data.sales.map(s=>s.id===id?obj:s); else data.sales.push(obj);
  clearSale();save();toast(existing?"Venta actualizada":"Venta registrada");
}
function editSale(id){
  const s=data.sales.find(x=>x.id===id);if(!s)return;
  $("saleId").value=s.id;$("saleDate").value=s.date;
  $("saleBuyerType").value=s.clientId?"client":"quick";toggleBuyer();
  $("saleBuyerName").value=s.buyerName||"";$("saleClient").value=s.clientId||"";
  $("saleProduct").value=s.productId;$("saleQty").value=s.qty;$("salePrice").value=s.price;
  $("saleDelivery").value=s.delivery||0;$("saleInitialPayment").value=paymentsOf(s);
  $("saleInitialPayment").disabled=true;$("salePayment").value=s.payment||"Transferencia";$("saleNotes").value=s.notes||"";
  $("saleSaveButton").textContent="Guardar cambios";updateCalc();goTo("ventas");window.scrollTo({top:0,behavior:"smooth"});
}
function cancelEdit(){clearSale();$("saleInitialPayment").disabled=false;}
function deleteSale(id){
  const s=data.sales.find(x=>x.id===id);if(!s)return;
  if(!confirm("¿Eliminar esta venta y todos sus abonos? Se recalculará el inventario."))return;
  data.sales=data.sales.filter(x=>x.id!==id);save();toast("Venta eliminada");
}
function addPayment(id){
  const s=data.sales.find(x=>x.id===id);if(!s)return;
  const pending=balanceOf(s);if(pending<=0)return alert("Esta venta ya está pagada.");
  const answer=prompt(`Saldo pendiente: ${money(pending)}. ¿Cuánto desea abonar?`,String(pending));
  if(answer===null)return;
  const amount=Number(answer);
  if(!Number.isFinite(amount)||amount<=0||amount>pending)return alert("El abono debe ser mayor que cero y no superar el saldo.");
  const date=prompt("Fecha del abono (AAAA-MM-DD)",today());if(date===null)return;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||Number.isNaN(Date.parse(date)))return alert("Fecha inválida.");
  const method=prompt("Medio de pago (Transferencia, Efectivo, Débito, Crédito, Otro)","Transferencia");if(method===null)return;
  s.payments.push({id:uid(),date,amount,method:method.trim()||"Otro"});save();toast("Abono registrado");
}
function paymentDetails(id){
  const s=data.sales.find(x=>x.id===id);if(!s)return;
  alert((s.payments||[]).map(p=>`${fmt(p.date)} · ${money(p.amount)} · ${p.method}`).join("\n")||"No registra abonos.");
}
function salesTable(rows,compact=false){
  if(!rows.length)return '<div class="empty">No hay ventas registradas.</div>';
  return `<div class="table-wrap"><table><thead><tr><th>Fecha</th><th>Comprador</th><th>Producto</th><th>Cant.</th><th>Total</th><th>Saldo</th><th>Estado</th>${compact?"":"<th>Acciones</th>"}</tr></thead><tbody>${rows.map(s=>{
    const paid=paymentsOf(s),balance=balanceOf(s),status=balance===0?"Pagada":paid>0?"Abonada":"Pendiente";
    return `<tr><td>${fmt(s.date)}</td><td>${esc(buyerName(s))}${!s.clientId&&!compact?`<br><button class="btn-secondary" onclick="registerBuyer('${s.id}')">Crear cliente</button>`:""}</td><td>${esc(product(s.productId)?.name||"Producto eliminado")}</td><td>${s.qty}${s.pendingQty?` ⚠ ${s.pendingQty} pendiente(s)`:""}</td><td>${money(s.total)}</td><td>${money(balance)}</td><td>${status}</td>${compact?"":`<td><div class="mini-actions"><button onclick="editSale('${s.id}')">Editar</button><button onclick="addPayment('${s.id}')">Abonar</button><button onclick="paymentDetails('${s.id}')">Pagos</button><button onclick="deleteSale('${s.id}')">Eliminar</button></div></td>`}</tr>`;
  }).join("")}</tbody></table></div>`;
}
function renderSales(){$("salesTable").innerHTML=salesTable([...sortedSales()].reverse());}
function registerBuyer(id){
  const s=data.sales.find(x=>x.id===id);if(!s||s.clientId)return;
  const match=data.clients.find(c=>c.name.toLocaleLowerCase("es")===s.buyerName.toLocaleLowerCase("es"));
  if(match){
    if(!confirm(`Ya existe el cliente ${match.name}. ¿Asociar esta venta a ese cliente?`))return;
    s.clientId=match.id;
  }else{
    const c={id:uid(),name:s.buyerName,phone:"",address:"",sector:"",cats:1,frequency:20,notes:""};
    data.clients.push(c);s.clientId=c.id;
  }
  save();toast("Comprador asociado a Clientes");
}
function saveStock(e){
  e.preventDefault();
  const id=$("stockProduct").value,qty=num($("stockQty").value),cost=num($("stockCost").value);
  if(!product(id)||!Number.isInteger(qty)||qty<=0||!Number.isFinite(cost)||cost<0)return alert("Selecciona un producto, cantidad entera positiva y costo total válido.");
  const l={id:uid(),createdAt:new Date().toISOString(),date:$("stockDate").value,productId:id,qty,totalCost:cost,notes:$("stockNotes").value.trim(),closed:false};
  data.lots.push(l);data.selectedLotId=l.id;
  $("stockQty").value=1;$("stockCost").value=0;$("stockNotes").value="";$("stockDate").value=today();
  save();toast("Nuevo lote creado");
}
function saveAdjustment(e){
  e.preventDefault();
  const l=lot($("adjustLot").value),qty=num($("adjustQty").value),type=$("adjustType").value;
  if(!l||l.closed||!Number.isInteger(qty)||qty===0)return alert("Selecciona un lote abierto y una variación entera distinta de cero.");
  if(type==="loss"&&qty>=0)return alert("Una pérdida debe ser negativa.");
  if(qty<0 && -qty>lotAvailable(l))return alert("No se pueden descontar más sacos que los disponibles en el lote.");
  data.adjustments.push({id:uid(),lotId:l.id,date:$("adjustDate").value,type,qty,notes:$("adjustNotes").value.trim()});
  $("adjustQty").value=-1;$("adjustNotes").value="";save();toast("Ajuste registrado");
}
function toggleLot(id){
  const l=lot(id);if(!l)return;
  if(!l.closed && lotAvailable(l)!==0)return alert("Para cerrar un lote, su saldo debe ser cero. Registra primero los ajustes necesarios.");
  if(!confirm(l.closed?"¿Reabrir este lote?":"¿Finalizar este lote?"))return;
  l.closed=!l.closed;save();toast(l.closed?"Pedido finalizado":"Pedido reabierto");
}
function renderStock(){
  $("stockTable").innerHTML=data.lots.length?`<div class="table-wrap"><table><thead><tr><th>Ingreso</th><th>Producto</th><th>Sacos</th><th>Costo total</th><th>Disponible</th><th>Estado</th><th>Acción</th></tr></thead><tbody>${[...sortedLots()].reverse().map(l=>{
    const st=lotStats(l);return `<tr><td>${fmt(l.date)}</td><td>${esc(product(l.productId)?.name||"Producto")}</td><td>${l.qty}</td><td>${money(l.totalCost)}</td><td>${st.available}</td><td>${l.closed?"Finalizado":st.available===0?"Sin stock · abierto":"En curso"}</td><td><button class="btn-secondary" onclick="toggleLot('${l.id}')">${l.closed?"Reabrir":"Cerrar"}</button></td></tr>`;
  }).join("")}</tbody></table></div>`:'<div class="empty">Aún no hay pedidos.</div>';
}
function renderHistory(){
  $("lotHistory").innerHTML=data.lots.length?[...sortedLots()].reverse().map(l=>{
    const st=lotStats(l);const lossCost=data.adjustments.filter(a=>a.lotId===l.id&&a.qty<0).reduce((n,a)=>n-a.qty*num(l.totalCost)/Math.max(1,l.qty),0);
    return `<article class="item"><div class="item-top"><div><strong>${esc(product(l.productId)?.name||"Producto")}</strong><p class="item-meta">${fmt(l.date)} · ${l.qty} sacos · ${l.closed?"Finalizado":"Abierto"}</p></div><span class="badge">${st.available} disponibles</span></div><div class="calc"><span>Ingresos: <strong>${money(st.income)}</strong></span><span>Costo vendido: <strong>${money(st.cost)}</strong></span><span>Utilidad bruta: <strong>${money(st.profit)}</strong></span><span>Costo pérdidas: <strong>${money(lossCost)}</strong></span><span>Resultado tras pérdidas: <strong>${money(st.profit-lossCost)}</strong></span></div><p class="item-meta">Comprados: ${l.qty} · Vendidos: ${st.sold} · Ajustes netos: ${lotAdjustment(l.id)}</p></article>`;
  }).join(""):'<div class="empty">Los lotes aparecerán aquí cuando registres un pedido.</div>';
}
function renderClients(){
  const q=($("clientSearch").value||"").toLocaleLowerCase("es");
  const rows=data.clients.filter(c=>[c.name,c.phone,c.address,c.sector].join(" ").toLocaleLowerCase("es").includes(q));
  $("clientList").innerHTML=rows.length?rows.map(c=>`<article class="item"><div class="item-top"><strong>${esc(c.name)}</strong><span class="badge">${num(c.cats)} gato(s)</span></div><p class="item-meta">${esc(c.phone||"Sin teléfono")} · ${esc(c.address||"Sin dirección")} · ${esc(c.sector||"Sin sector")}</p><p class="item-meta">Recompra cada ${c.frequency||20} días</p><div class="mini-actions"><button onclick="editClient('${c.id}')">Editar</button><button onclick="deleteClient('${c.id}')">Eliminar</button></div></article>`).join(""):'<div class="empty">Sin clientes.</div>';
}
function showClientForm(){$("clientForm").reset();$("clientId").value="";$("clientForm").classList.remove("hidden");}
function hideClientForm(){$("clientForm").classList.add("hidden");}
function saveClient(e){
  e.preventDefault();
  const id=$("clientId").value||uid();
  const c={id,name:$("clientName").value.trim(),phone:$("clientPhone").value.trim(),address:$("clientAddress").value.trim(),sector:$("clientSector").value.trim(),cats:num($("clientCats").value),frequency:num($("clientFrequency").value),notes:$("clientNotes").value.trim()};
  if(!c.name)return;
  const i=data.clients.findIndex(x=>x.id===id);if(i>=0)data.clients[i]=c;else data.clients.push(c);
  hideClientForm();save();toast("Cliente guardado");
}
function editClient(id){
  const c=client(id);if(!c)return;
  for(const [field,val] of Object.entries({clientId:c.id,clientName:c.name,clientPhone:c.phone,clientAddress:c.address,clientSector:c.sector,clientCats:c.cats,clientFrequency:c.frequency,clientNotes:c.notes}))$(field).value=val??"";
  $("clientForm").classList.remove("hidden");goTo("clientes");
}
function deleteClient(id){
  if(data.sales.some(s=>s.clientId===id))return alert("Este cliente tiene ventas asociadas. Puedes editar sus datos.");
  if(!confirm("¿Eliminar cliente?"))return;
  data.clients=data.clients.filter(c=>c.id!==id);save();
}
function renderProducts(){
  $("productList").innerHTML=data.products.length?data.products.map(p=>`<article class="item"><div class="item-top"><strong>${esc(p.name)}</strong><span class="badge ${availableFor(p.id)<=num(p.min)?"orange":"green"}">Stock ${availableFor(p.id)}</span></div><p class="item-meta">${esc(p.brand||"")} · ${esc(p.format||"")} · Precio sugerido ${money(p.price)}</p><div class="mini-actions"><button onclick="editProduct('${p.id}')">Editar</button><button onclick="deleteProduct('${p.id}')">Eliminar</button></div></article>`).join(""):'<div class="empty">No hay productos registrados.</div>';
}
function showProductForm(){$("productForm").reset();$("productId").value="";$("productForm").classList.remove("hidden");}
function hideProductForm(){$("productForm").classList.add("hidden");}
function saveProduct(e){
  e.preventDefault();
  const id=$("productId").value||uid();
  const p={id,name:$("productName").value.trim(),brand:$("productBrand").value.trim(),format:$("productFormat").value.trim(),price:num($("productPrice").value),min:num($("productMin").value)};
  if(!p.name||p.price<0||p.min<0)return alert("Revisa los datos del producto.");
  const i=data.products.findIndex(x=>x.id===id);if(i>=0)data.products[i]=p;else data.products.push(p);
  hideProductForm();save();toast("Producto guardado");
}
function editProduct(id){
  const p=product(id);if(!p)return;
  for(const [field,val] of Object.entries({productId:p.id,productName:p.name,productBrand:p.brand,productFormat:p.format,productPrice:p.price,productMin:p.min}))$(field).value=val??"";
  $("productForm").classList.remove("hidden");goTo("productos");
}
function deleteProduct(id){
  if(data.sales.some(s=>s.productId===id)||data.lots.some(l=>l.productId===id))return alert("Producto con movimientos: edita sus datos en vez de eliminarlo.");
  if(!confirm("¿Eliminar producto?"))return;
  data.products=data.products.filter(p=>p.id!==id);save();
}
function renderSettings(){
  if(document.activeElement?.closest("#ajustes form"))return;
  $("businessName").value=data.settings.businessName||"";
  $("fixedCosts").value=data.settings.fixedCosts||0;
  $("whatsappMessage").value=data.settings.whatsappMessage||"";
}
function saveSettings(e){
  e.preventDefault();
  data.settings.businessName=$("businessName").value.trim()||"Arena Control";
  data.settings.fixedCosts=num($("fixedCosts").value);
  data.settings.whatsappMessage=$("whatsappMessage").value.trim();
  save();toast("Ajustes guardados");
}
function download(name,content,type){
  const url=URL.createObjectURL(new Blob([content],{type}));
  const a=document.createElement("a");a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function exportJSON(){download(`arena-control-v2-${today()}.json`,JSON.stringify(data,null,2),"application/json");toast("Respaldo generado");}
const csv = rows => rows.map(r=>r.map(x=>'"'+String(x??"").replaceAll('"','""')+'"').join(";")).join("\r\n");
function exportClientsCSV(){
  download(`clientes-${today()}.csv`,csv([["Nombre","WhatsApp","Dirección","Sector","Gatos","Frecuencia","Notas"],...data.clients.map(c=>[c.name,c.phone,c.address,c.sector,c.cats,c.frequency,c.notes])]),"text/csv;charset=utf-8");
}
function exportSalesCSV(){
  download(`ventas-${today()}.csv`,csv([["Fecha","Comprador","Producto","Cantidad","Venta arena","Despacho","Total","Abonado","Pendiente","Unidades sin lote"],...data.sales.map(s=>[s.date,buyerName(s),product(s.productId)?.name,s.qty,s.qty*s.price,s.delivery,s.total,paymentsOf(s),balanceOf(s),s.pendingQty])]),"text/csv;charset=utf-8");
}
function openImportPicker(){$("importFile").click();}
function importJSON(e){
  const f=e.target.files[0];if(!f)return;
  const reader=new FileReader();
  reader.onload=()=>{
    try{
      const next=normalize(JSON.parse(reader.result));
      if(!confirm(`Importar ${next.clients.length} clientes, ${next.products.length} productos, ${next.sales.length} ventas y ${next.lots.length} lotes? Esto reemplazará TODOS los datos actuales de v2 en este navegador. Exporta un respaldo antes de continuar.`))return;
      data=next;save();goTo("inicio");toast("Respaldo cargado");
    }catch(err){alert("No se pudo cargar: "+err.message);}
  };
  reader.readAsText(f);e.target.value="";
}
function resetData(){
  if(!confirm("¿Borrar todos los datos de Arena Control v2 de este navegador? Exporta un respaldo primero."))return;
  if(!confirm("Segunda confirmación: este borrado no se puede deshacer sin un respaldo JSON."))return;
  data=fresh();save();toast("Datos v2 reiniciados");
}
recompute();
for(const id of ["saleDate","stockDate","adjustDate"])$(id).value=today();
toggleBuyer();render();
