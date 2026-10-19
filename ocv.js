(function(root){
'use strict';
const el=id=>document.getElementById(id);let samples=[],shown=[],key=null,last=0,selected=-1;
const validSoc=n=>Number.isFinite(n)&&n>=0&&n<=100;
const fmt=(n,d=2)=>Number.isFinite(n)?n.toFixed(d):'—';
const clock=t=>new Date(t).toLocaleTimeString('vi-VN');
let limits={start:0,end:1,lo:0,hi:100};
const x=t=>80+890*(t-limits.start)/(limits.end-limits.start);
const y=v=>335-290*(v-limits.lo)/(limits.hi-limits.lo);
function inspect(index){
 if(!shown.length)return;selected=Math.max(0,Math.min(shown.length-1,index));const p=shown[selected];
 el('socCursor').setAttribute('d',`M${x(p.ts)} 45V335`);
 el('socTooltip').textContent=clock(p.ts)+' · SOC kết hợp: '+fmt(p.soc)+'% · SOC OCV lúc nghỉ: '+fmt(p.ocv)+'% · Dòng: '+fmt(p.current,3)+' A · '+(p.rest?'Đủ điều kiện nghỉ':'Chưa đủ điều kiện nghỉ');
}
function draw(){
 const seconds=Number(el('socRange').value)||0,end=samples.at(-1)?.ts||Date.now();
 shown=samples.filter(p=>!seconds||p.ts>=end-seconds*1000);
 const values=shown.flatMap(p=>[p.soc,p.ocv]).filter(Number.isFinite);let lo=0,hi=100;
 if(el('socScale').value==='detail'&&values.length){const mn=Math.min(...values),mx=Math.max(...values),pad=Math.max(.5,(mx-mn)*.15);lo=Math.max(0,Math.floor((mn-pad)*10)/10);hi=Math.min(100,Math.ceil((mx+pad)*10)/10);}
 limits={start:shown[0]?.ts||end-60000,end:Math.max(end,(shown[0]?.ts||end-60000)+1000),lo,hi};
 let grid='';for(let i=0;i<=5;i++){const py=45+i*58,val=hi-(hi-lo)*i/5;grid+=`<path d="M80 ${py}H970" stroke="#e3eae5"/><text x="65" y="${py+5}" text-anchor="end" fill="#657d74" font-size="15">${val.toFixed(hi-lo<5?2:0)}%</text>`;}
 for(let i=0;i<=5;i++){const px=80+i*178,t=limits.start+(limits.end-limits.start)*i/5;grid+=`<path d="M${px} 45V335" stroke="#eef2ee"/><text x="${px}" y="365" text-anchor="middle" fill="#657d74" font-size="14">${shown.length?clock(t):'—'}</text>`;}
 grid+='<text x="80" y="22" fill="#657d74" font-size="14">SOC (%)</text><text x="525" y="395" text-anchor="middle" fill="#657d74" font-size="14">Thời gian</text>';
 el('socGrid').innerHTML=grid;let path='',gap=true,prev=0;
 for(const p of shown){if(p.soc===null){gap=true;continue;}path+=(gap||p.ts-prev>15000?'M':'L')+x(p.ts)+' '+y(p.soc)+' ';gap=false;prev=p.ts;}
 el('socFinalPath').setAttribute('d',path);
 el('socFinalPoints').innerHTML=shown.filter(p=>p.soc!==null).map(p=>`<circle cx="${x(p.ts)}" cy="${y(p.soc)}" r="2"/>`).join('');
 el('socOcvPoints').innerHTML=shown.filter(p=>p.ocv!==null).map(p=>`<circle cx="${x(p.ts)}" cy="${y(p.ocv)}" r="4"/>`).join('');
 el('socEmpty').textContent=values.length?'':'Chưa có dữ liệu hợp lệ từ ESP';el('socCount').textContent=shown.length+' mẫu';
 el('socExtent').textContent=samples.length?clock(samples[0].ts)+' – '+clock(samples.at(-1).ts)+' · lịch sử ThingsBoard và mẫu trực tiếp':'Chờ dữ liệu lịch sử';
 el('socCursor').setAttribute('d','');selected=-1;
}
el('socRange').onchange=draw;el('socScale').onchange=draw;
el('socPlot').addEventListener('pointermove',e=>{if(!shown.length)return;const box=el('socPlot').getBoundingClientRect();const fraction=Math.max(0,Math.min(1,((e.clientX-box.left)/box.width*1000-80)/890));const target=limits.start+fraction*(limits.end-limits.start);let index=0;for(let i=1;i<shown.length;i++)if(Math.abs(shown[i].ts-target)<Math.abs(shown[index].ts-target))index=i;inspect(index);});
el('socPlot').addEventListener('keydown',e=>{if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();inspect(selected<0?shown.length-1:selected+(e.key==='ArrowRight'?1:-1));}});
el('socCsv').onclick=()=>{const csv='time_iso,soc_combined_pct,soc_ocv_rest_pct,current_a,at_rest,source\n'+samples.map(p=>[new Date(p.ts).toISOString(),p.soc??'',p.ocv??'',p.current??'',p.rest,p.source].join(',')).join('\n');const url=URL.createObjectURL(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='bms-soc-session.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
root.updateOcvTelemetry=(s,meta)=>{
 if(key!==meta.sessionKey){key=meta.sessionKey;samples=[];last=0;el('socTooltip').textContent='Di chuột hoặc chạm để đọc mẫu; dùng phím ← → để di chuyển.';draw();}
 const d=s.detail||{},has=Number.isFinite(d.socCc),bqBad=!s.demo&&d.bqOnline!==true;
 const usable=meta.connected&&meta.fresh&&!bqBad;
 const ocvValid=d.socOcvValid===true&&validSoc(d.socOcv)&&Number.isFinite(d.ocvCell)&&d.ocvCell>0;
 el('socSource').textContent=!meta.connected?'CHƯA KẾT NỐI':!meta.fresh?'DỮ LIỆU CŨ':s.demo?'MÔ PHỎNG TỪ ESP':'PHẦN CỨNG · ESP';
 el('liveSoc').textContent=usable&&validSoc(s.soc_pct)?fmt(s.soc_pct)+' %':'—';el('liveOcv').textContent=usable&&ocvValid?fmt(d.socOcv)+' %':'—';el('liveVoltage').textContent=usable&&ocvValid?fmt(d.ocvCell,4)+' V':'—';el('liveRest').textContent=usable&&Number.isFinite(d.restSeconds)?d.restSeconds+' s':'—';
 el('socLiveStatus').textContent=!meta.connected?'Chưa kết nối thiết bị.':!meta.fresh?'Dữ liệu cũ / mất kết nối.':bqBad?'BQ chưa xác nhận đọc thành công; ngừng thêm số đo.':!has?'Chưa có các trường SOC mở rộng từ ESP.':d.atRest===true?'ESP báo đủ điều kiện nghỉ · cập nhật OCV.':ocvValid?'Đang chạy CC · OCV lưu từ lần nghỉ trước.':'Đang chạy CC · chờ lần nghỉ đầu tiên.';
 if(meta.connected&&meta.ts>0&&meta.ts!==last){last=meta.ts;root.mergeSocHistory([{ts:meta.ts,soc:!bqBad&&validSoc(s.soc_pct)?s.soc_pct:null,ocv:!bqBad&&ocvValid&&d.atRest===true?d.socOcv:null,current:!bqBad?s.current_a:null,rest:d.atRest===true,source:s.demo?'simulation':'hardware'}],meta.sessionKey);}

};
root.mergeSocHistory=(rows,sessionKey)=>{
 if(!sessionKey||sessionKey!==key)return;
 const map=new Map(samples.map(p=>[p.ts,p]));
 for(const p of rows)if(Number.isFinite(p.ts)&&p.ts>0)map.set(p.ts,p);
 samples=[...map.values()].sort((a,b)=>a.ts-b.ts).slice(-7200);draw();
};
draw();
})(globalThis);
