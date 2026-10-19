'use strict';
const $=id=>document.getElementById(id);
const KEYS=['demo','boot_id','state_version','capacity_mah','charge_enabled','discharge_enabled','soc_pct','pack_voltage','current_a','temperature_c','last_source','uptime_s','rssi','cell_1_v','cell_2_v','cell_3_v','cell_4_v','cell_5_v','cell_6_v','cell_7_v'];
const demoInitial=()=>({demo:true,boot_id:'browser-demo',state_version:0,capacity_mah:18000,charge_enabled:false,discharge_enabled:false,soc_pct:72,pack_voltage:23.56,current_a:0,temperature_c:29,last_source:'web-demo',uptime_s:0,rssi:-48,cell_1_v:3.36,cell_2_v:3.37,cell_3_v:3.36,cell_4_v:3.37,cell_5_v:3.36,cell_6_v:3.37,cell_7_v:3.37});
let state=demoInitial(),session=null,epoch=0,lastTs=0,healthy=false,pending=false,polling=false,connecting=false,history=[],lastHistoryTs=0;
function decode(raw){
  // Select the active schema by measurement timestamps, not by stale key presence.
  const legacyTs=Number(raw.packVoltage?.[0]?.ts)||0;
  const modernTs=Number(raw.pack_voltage?.[0]?.ts)||0;
  if(legacyTs>0 && legacyTs>modernTs && raw.simulation?.length)return decodeLegacy(raw);

  const s={};let ts=Infinity;
  for(const k of KEYS){if(!raw[k]?.length)throw Error('Thiếu telemetry '+k+'. Hãy nạp firmware trong bộ code và kiểm tra Latest telemetry.');const x=raw[k][0];s[k]=x.value;ts=Math.min(ts,Number(x.ts));}
  for(const k of ['demo','charge_enabled','discharge_enabled']){
    const value=typeof s[k]==='string'?s[k].trim().toLowerCase():s[k];
    if([true,1,'true','1'].includes(value))s[k]=true;
    else if([false,0,'false','0'].includes(value))s[k]=false;
    else throw Error('Đã đọc được ThingsBoard, nhưng trường '+k+' không đúng định dạng. Cần true/false hoặc 1/0. Kiểm tra trường này trong Latest telemetry.');
  }
  for(const k of KEYS.filter(k=>!['demo','charge_enabled','discharge_enabled','boot_id','last_source'].includes(k))){s[k]=Number(s[k]);if(!Number.isFinite(s[k]))throw Error('Telemetry không hợp lệ: '+k);}
  if(!Number.isFinite(ts)||![6000,12000,18000,24000].includes(s.capacity_mah))throw Error('Telemetry không đúng phiên bản firmware.');
  return {state:s,ts};
}
function decodeLegacy(raw){
  const map={demo:'simulation',pack_voltage:'packVoltage',current_a:'current',temperature_c:'temperature',soc_pct:'soc',charge_enabled:'chargeFet',discharge_enabled:'dischargeFet'};
  for(let i=1;i<=7;i++)map['cell_'+i+'_v']='cell'+i;
  const out={protocol:'legacy',boot_id:'legacy-no-boot-id',state_version:null,capacity_mah:null,last_source:'ESP (firmware giám sát)',uptime_s:null,rssi:null};
  let ts=Infinity;
  for(const [key,source] of Object.entries(map)){
    const item=raw[source]?.[0];
    if(!item || item.value===null || item.value===undefined || item.value==='')throw Error('Thiếu giá trị '+source+' trong Latest telemetry.');
    let v=item.value;
    if(['demo','charge_enabled','discharge_enabled'].includes(key)){
      if(typeof v==='string')v=v.trim().toLowerCase();
      if([true,1,'true','1'].includes(v))v=true;
      else if([false,0,'false','0'].includes(v))v=false;
      else throw Error('Trường '+source+' cần true/false hoặc 1/0.');
    }else{v=Number(v);if(!Number.isFinite(v))throw Error('Trường '+source+' phải là số.');}
    out[key]=v;ts=Math.min(ts,Number(item.ts));
  }
  if(!Number.isFinite(ts)||ts<=0)throw Error('Telemetry thiếu thời gian cập nhật hợp lệ.');
  // Extended fields are optional for older firmware; never substitute zero for missing data.
  const numberFields=['socCc','socOcv','ocvCell','restSeconds','temperatureTs1','temperatureTs2','safetyA','safetyB','safetyC'];
  const boolFields=['socOcvValid','atRest','bqOnline','alarm'];
  out.detail={};
  for(const k of [...numberFields,...boolFields]){
    const item=raw[k]?.[0];if(!item||Math.abs(Number(item.ts)-ts)>2000)continue;
    let v=item.value;if(v===null||v===undefined||v==='')continue;
    if(boolFields.includes(k)){if(typeof v==='string')v=v.trim().toLowerCase();if([true,1,'true','1'].includes(v))v=true;else if([false,0,'false','0'].includes(v))v=false;else continue;}
    else{v=Number(v);if(!Number.isFinite(v))continue;}
    out.detail[k]=v;
  }
  return {state:out,ts};
}
function isFresh(){return !!session&&healthy&&lastTs>0&&Date.now()-lastTs<15000;}
function mergeMeasurements(rows){const map=new Map(history.map(p=>[p.ts,p]));for(const p of rows)map.set(p.ts,p);history=[...map.values()].sort((a,b)=>a.ts-b.ts).slice(-7200);}
function takeSample(ts){if(ts===lastHistoryTs)return;lastHistoryTs=ts;if(!state.demo&&state.detail?.bqOnline!==true)return;mergeMeasurements([{ts,voltage:state.pack_voltage,current:state.current_a,soc:state.soc_pct,capacity:state.capacity_mah,source:state.demo?'esp_simulation':'esp_hardware'}]);}

function accept(next,ts){
  // Ignore earlier telemetry still being stored after an RPC reply.
  if(next.boot_id===state.boot_id&&next.state_version<state.state_version)return;
  if(next.boot_id!==state.boot_id){history=[];lastHistoryTs=0;}
  state=next;lastTs=ts;takeSample(ts);
}
function fmt(n,d){return Number.isFinite(n)?n.toFixed(d):'—';}
function render(){
  if(typeof globalThis.updateOcvTelemetry==='function'){try{globalThis.updateOcvTelemetry(state,{connected:!!session,fresh:isFresh(),ts:lastTs,sessionKey:session?session.id+':'+epoch:null});}catch{}}
  $('soc').textContent=fmt(state.soc_pct,0);$('socBar').style.width=Math.max(0,Math.min(100,state.soc_pct))+'%';
  $('voltage').textContent=fmt(state.pack_voltage,2);$('current').textContent=fmt(state.current_a,2);$('temperature').textContent=fmt(state.temperature_c,1);
  const cells=[1,2,3,4,5,6,7].map(i=>state['cell_'+i+'_v']);
  $('cellRows').replaceChildren(...cells.map((v,i)=>{const row=document.createElement('div');row.className='cell-row';const label=document.createElement('label');label.textContent='C0'+(i+1);const bar=document.createElement('div');bar.className='cell-track';const fill=document.createElement('i');fill.style.width=Math.max(0,Math.min(100,(v-2.8)/0.85*100))+'%';bar.append(fill);const value=document.createElement('strong');value.textContent=fmt(v,3)+' V';row.append(label,bar,value);return row;}));
  $('delta').textContent=fmt((Math.max(...cells)-Math.min(...cells))*1000,0)+' mV';
  let voltagePath='',previous=0;const first=history[0]?.ts||0,last=history.at(-1)?.ts||first;
  for(const p of history){const x=45+(p.ts-first)*475/Math.max(1,last-first),y=155-Math.max(0,Math.min(1,(p.voltage-20.8)/4.8))*135;voltagePath+=(previous&&p.ts-previous<=15000?'L':'M')+x+' '+y+' ';previous=p.ts;}
  $('line').setAttribute('d',voltagePath);
  $('chartLabel').textContent=history.length?history.length+' mẫu · '+new Date(first).toLocaleTimeString('vi-VN')+' – '+new Date(last).toLocaleTimeString('vi-VN'):'Chờ lịch sử đo';
  const good=isFresh()&&(state.demo||state.detail?.bqOnline!==false),d=state.detail||{};
  $('cellSource').textContent=!session?'CHƯA CÓ DỮ LIỆU':state.demo?'MÔ PHỎNG TỪ ESP':'PHẦN CỨNG';
  $('fetCharge').textContent=good?(state.charge_enabled?'Bật':'Tắt'):'—';$('fetDischarge').textContent=good?(state.discharge_enabled?'Bật':'Tắt'):'—';
  $('bqState').textContent=!session?'—':state.demo?'Chưa sử dụng':d.bqOnline===true?'Đọc thành công':d.bqOnline===false?'Đọc lỗi':'Chưa có trạng thái';
  $('hardwareMode').textContent=!session?'Chờ kết nối':state.demo?'Nguồn dữ liệu: mô phỏng':'Nguồn dữ liệu: phần cứng';
  $('alarmState').textContent=!good?'—':d.alarm===true?'Có cảnh báo':d.alarm===false?'Không có':'Chưa có trạng thái';
  $('safetyState').textContent=good&&[d.safetyA,d.safetyB,d.safetyC].every(Number.isFinite)?'Thanh ghi A / B / C: '+[d.safetyA,d.safetyB,d.safetyC].join(' / '):'Chưa có dữ liệu bảo vệ';
  if(!good){for(const id of ['soc','voltage','current','temperature','delta'])$(id).textContent='—';$('socBar').style.width='0%';$('cellRows').replaceChildren();}
  $('disconnect').hidden=!session;
  if(session){
    const fresh=isFresh();$('statusDot').className='dot '+(fresh?'':'red');
    $('connection').textContent=fresh?(state.demo?'ESP · DỮ LIỆU MÔ PHỎNG':'ESP · CHẾ ĐỘ PHẦN CỨNG THẬT'):lastTs?'DỮ LIỆU CŨ / MẤT KẾT NỐI':'CHỜ DỮ LIỆU ESP';
    $('updated').textContent=lastTs?'Mẫu gần nhất: '+new Date(lastTs).toLocaleTimeString('vi-VN')+' · '+Math.max(0,Math.floor((Date.now()-lastTs)/1000))+' giây trước':'Chưa có mẫu';
    $('deviceDetail').textContent=session.id.slice(0,8)+'… · '+(state.rssi===null?'Chỉ giám sát':state.rssi+' dBm');
    $('notice').textContent=state.demo?'Đang nhận dữ liệu mô phỏng do ESP gửi lên ThingsBoard.':'ESP báo chế độ phần cứng thật. Web hiển thị dữ liệu và trạng thái do ESP gửi.';
    
    if(!state.demo&&state.detail?.bqOnline===false)$('notice').textContent='ESP còn gửi cloud nhưng BQ mất kết nối / đọc lỗi. Các số đo có thể là giá trị cũ; không coi là phép đo mới.';
    $('connectOpen').textContent='⚙ Thiết lập kết nối';
  }else{
    $('statusDot').className='dot amber';$('connection').textContent='CHƯA KẾT NỐI ESP';$('updated').textContent='Chưa có mẫu dữ liệu';$('deviceDetail').textContent='Chờ kết nối thiết bị';
    $('notice').textContent='Kết nối ThingsBoard để theo dõi số đo và trạng thái của ESP32.';$('connectOpen').textContent='⚙ Kết nối ThingsBoard';
  }
}
async function request(s,path,body,login=false){
  const headers={'Content-Type':'application/json'};if(!login)headers['X-Authorization']=s.auth;
  let r;try{r=await fetch(s.server+path,{method:body?'POST':'GET',headers,body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(16000),credentials:'omit',cache:'no-store',redirect:'error'});}catch(e){throw Error(e.name==='TimeoutError'?'Máy chủ không phản hồi trong 16 giây.':'Không truy cập được máy chủ. Kiểm tra URL HTTPS, mạng và cấu hình CORS của ThingsBoard.');}
  if(!r.ok){const messages={401:'Phiên đăng nhập hết hạn hoặc thông tin xác thực sai. Kết nối lại.',403:'Tài khoản không có quyền truy cập thiết bị hoặc gửi RPC.',404:'Không tìm thấy thiết bị / API. Kiểm tra Device ID và lựa chọn RPC API.',504:'ESP chưa trả lời. Lệnh có thể đã đến ESP; hãy xem trạng thái báo về trước khi thử lại.',408:'Hết thời gian chờ ESP trả lời.'};throw Error(messages[r.status]||'ThingsBoard trả lỗi HTTP '+r.status+'.');}
  return r.json();
}
async function readLatest(s){const raw=await request(s,'/api/plugins/telemetry/DEVICE/'+s.id+'/values/timeseries');const result=decode(raw);return result;}
// Re-read the rolling window, including older timestamps: queued data arrives out of order.
const HISTORY_SPAN=2*60*60*1000;
const HISTORY_KEYS=[...KEYS,'simulation','packVoltage','current','temperature','soc','chargeFet','dischargeFet',...Array.from({length:7},(_,i)=>'cell'+(i+1)),'socCc','socOcv','ocvCell','restSeconds','socOcvValid','atRest','bqOnline','alarm'];
let historyLoadingEpoch=null;
async function historyWindow(s,start,end,e,depth=0){
 const query=new URLSearchParams({keys:HISTORY_KEYS.join(','),startTs:String(start),endTs:String(end),agg:'NONE',orderBy:'ASC',limit:'2000'});
 const raw=await request(s,'/api/plugins/telemetry/DEVICE/'+s.id+'/values/timeseries?'+query);
 if(e!==epoch)return [];
 if(Object.values(raw).some(v=>Array.isArray(v)&&v.length>=2000)){
   if(end-start<=1||depth>=20)throw Error('Khoảng lịch sử có quá nhiều mẫu.');
   const mid=Math.floor((start+end)/2);
   return [...await historyWindow(s,start,mid,e,depth+1),...await historyWindow(s,mid+1,end,e,depth+1)];
 }
 const rows=new Map();
 for(const [key,values] of Object.entries(raw))if(Array.isArray(values))for(const item of values){
   const ts=Number(item.ts);if(!Number.isFinite(ts)||ts<start||ts>end)continue;
   if(!rows.has(ts))rows.set(ts,{});rows.get(ts)[key]=[{ts,value:item.value}];
 }
 const decoded=[];for(const row of rows.values()){try{decoded.push(decode(row));}catch{/* Do not combine measurements from different timestamps. */}}
 return decoded;
}
async function refreshHistory(){
 if(!session||historyLoadingEpoch===epoch)return;
 const s=session,e=epoch;historyLoadingEpoch=e;$('historyStatus').textContent='Đang tải lịch sử 2 giờ gần nhất…';
 try{
   const end=Date.now(),rows=await historyWindow(s,end-HISTORY_SPAN,end,e);if(e!==epoch)return;
   const graph=[],measurements=[];
   for(const {state:v,ts} of rows){
     const d=v.detail||{},valid=v.demo||d.bqOnline===true;
     graph.push({ts,soc:valid&&v.soc_pct>=0&&v.soc_pct<=100?v.soc_pct:null,ocv:valid&&d.atRest===true&&d.socOcvValid===true&&Number.isFinite(d.ocvCell)&&d.ocvCell>0&&Number.isFinite(d.socOcv)&&d.socOcv>=0&&d.socOcv<=100?d.socOcv:null,current:valid?v.current_a:null,rest:d.atRest===true,source:v.demo?'simulation':'hardware'});
     if(valid)measurements.push({ts,voltage:v.pack_voltage,current:v.current_a,soc:v.soc_pct,capacity:v.capacity_mah,source:v.demo?'esp_simulation':'esp_hardware'});
   }
   mergeMeasurements(measurements);globalThis.mergeSocHistory?.(graph,s.id+':'+e);render();
   $('historyStatus').textContent='Đã đồng bộ '+rows.length+' mẫu trong 2 giờ gần nhất · '+new Date().toLocaleTimeString('vi-VN');
 }catch(err){if(e===epoch)$('historyStatus').textContent='Chưa tải được lịch sử: '+err.message;}
 finally{if(historyLoadingEpoch===e)historyLoadingEpoch=null;}
}
$('historyRefresh').onclick=refreshHistory;
setInterval(refreshHistory,30000);

async function poll(){
  if(!session||polling)return;polling=true;const s=session,e=epoch;
  try{const result=await readLatest(s);if(e!==epoch)return;healthy=true;accept(result.state,result.ts);}
  catch(err){if(e===epoch){healthy=false;$('commandStatus').textContent=err.message;}}
  finally{polling=false;render();}
}
$('connectOpen').onclick=()=>$('connectDialog').showModal();$('closeDialog').onclick=()=>$('connectDialog').close();
$('connectDialog').addEventListener('close',()=>{$('password').value='';$('apiKey').value='';});
function updateAuthMode(){const key=$('authMode').value==='key';$('loginFields').hidden=key;$('keyField').hidden=!key;$('username').disabled=key;$('password').disabled=key;$('apiKey').disabled=!key;}
$('authMode').onchange=updateAuthMode;updateAuthMode();
$('connectForm').onsubmit=async e=>{
  e.preventDefault();if(connecting)return;connecting=true;$('formError').textContent='Đang kiểm tra thông tin kết nối…';$('submitConnect').disabled=true;$('submitConnect').textContent='Đang kết nối…';
  const connectEpoch=epoch;
  try{
    render();
    const url=new URL($('server').value.trim());if(url.protocol!=='https:'||url.username||url.password||url.pathname!=='/'||url.search||url.hash)throw Error('Nhập URL gốc HTTPS, ví dụ https://thingsboard.cloud');
    const id=$('deviceId').value.trim();if(!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))throw Error('Device ID phải là UUID, không phải Device access token.');
    const candidate={server:url.origin,id,auth:''};
    if($('authMode').value==='key'){
      const key=$('apiKey').value.trim();if(!key)throw Error('Chưa nhập API key.');candidate.auth='ApiKey '+key;
    }else{
      if(!$('username').value||!$('password').value)throw Error('Nhập email và mật khẩu ThingsBoard.');
      const r=await request(candidate,'/api/auth/login',{username:$('username').value.trim(),password:$('password').value},true);
      if(!r.token)throw Error('Đăng nhập không trả về token. Kiểm tra yêu cầu xác thực bổ sung.');candidate.auth='Bearer '+r.token;
    }
    $('formError').textContent='Đang đọc dữ liệu thiết bị từ ThingsBoard…';
    const latest=await readLatest(candidate);if(connectEpoch!==epoch)return;
    $('formError').textContent='';
    epoch++;session=candidate;pending=false;healthy=true;history=[];lastHistoryTs=0;state=latest.state;lastTs=latest.ts;takeSample(lastTs);
    $('commandStatus').textContent=isFresh()?'Đã kết nối · cập nhật theo dữ liệu ESP.':'Mẫu dữ liệu đã cũ. Kiểm tra kết nối ESP.';
    $('password').value='';$('apiKey').value='';
    $('connectDialog').close();render();refreshHistory();
  }catch(err){$('formError').textContent=err.message;}
  finally{connecting=false;$('submitConnect').disabled=false;$('submitConnect').textContent='Kết nối và đọc trạng thái →';render();}
};
$('disconnect').onclick=()=>{epoch++;session=null;$('historyStatus').textContent='Chưa kết nối ThingsBoard';pending=false;healthy=false;lastTs=0;history=[];lastHistoryTs=0;state=demoInitial();$('commandStatus').textContent='Đã xóa thông tin xác thực khỏi bộ nhớ. Đã ngắt kết nối thiết bị.';render();};
$('export').onclick=()=>{
  const csv='source,time_iso,voltage_v,current_a,soc_pct,capacity_mah\n'+history.map(r=>[r.source||'unknown',new Date(r.ts).toISOString(),r.voltage,r.current,r.soc,r.capacity].join(',')).join('\n');
  const a=document.createElement('a'),url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}));a.href=url;a.download='bms-lab-session.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
};
setInterval(()=>{if(session)poll();render();},2000);
render();
