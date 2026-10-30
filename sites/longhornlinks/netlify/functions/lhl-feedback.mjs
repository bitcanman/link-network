export const config={path:'/api/lhl-feedback',rateLimit:{windowLimit:10,windowSize:60,aggregateBy:['ip','domain'],action:'rate_limit'}};
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
// Same best-effort posture as lhl-chat.mjs's Supabase writes: a missing env
// var or an outage must never surface to the caller, and navigator.sendBeacon
// (the click path) can't see the response anyway.
function supabaseConfigured(){return !!(process.env.SUPABASE_URL&&process.env.SUPABASE_SERVICE_KEY);}
function supabaseHeaders(){const key=process.env.SUPABASE_SERVICE_KEY;return {apikey:key,Authorization:'Bearer '+key,'Content-Type':'application/json',Prefer:'return=minimal'};}
async function supabaseInsert(table,row){
 if(!supabaseConfigured())return;
 try{
  await fetch(process.env.SUPABASE_URL+'/rest/v1/'+table,{method:'POST',headers:supabaseHeaders(),body:JSON.stringify(row),signal:AbortSignal.timeout(4000)});
 }catch(e){console.error('Supabase insert failed',table,e.name);}
}
// The id is a full UUID minted by lhl-chat (ask_questions.id) - both ask_clicks
// and ask_feedback reference it as question_id, so anything that isn't a real
// UUID would fail those inserts outright.
const UUID_RE=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export default async function handler(req){
 if(req.method!=='POST')return json({error:'Use POST.'},405);
 const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return json({error:'Origin not allowed.'},403);
 if(Number(req.headers.get('content-length')||0)>2000)return json({error:'Request too large.'},413);
 let data;try{const raw=await req.text();if(raw.length>2000)return json({error:'Request too large.'},413);data=JSON.parse(raw);}catch{return json({error:'Invalid JSON.'},400);}
 const id=typeof data.id==='string'?data.id.trim():'';
 if(!UUID_RE.test(id))return json({error:'Invalid feedback.'},400);
 // Same validation lhl-chat.mjs applies to the sessionId it echoes back to the
 // client - sessionStorage-sourced, per-tab, non-identifying; null is always
 // legal (clicks fired before a session id existed, or with it disabled).
 const sessionId=typeof data.sessionId==='string'&&UUID_RE.test(data.sessionId)?data.sessionId:null;
 // Clicks are fired via navigator.sendBeacon, which can't see the response and
 // doesn't need the Apps Script round trip this file otherwise keeps for
 // thumbs up/down - a click is logged to Supabase only.
 if(data.type==='click'){
  const url=typeof data.url==='string'?data.url.trim().slice(0,500):'';
  const resource=typeof data.resource==='string'?data.resource.trim().slice(0,200):'';
  if(!url)return json({error:'Invalid click.'},400);
  await supabaseInsert('ask_clicks',{question_id:id,url,resource:resource||null,session_id:sessionId});
  return json({ok:true});
 }
 const rating=data.rating==='up'||data.rating==='down'?data.rating:'';
 if(!rating)return json({error:'Invalid feedback.'},400);
 const note=typeof data.note==='string'?data.note.trim().slice(0,300):'';
 // Dual-write, same as lhl-chat.mjs: both best-effort and independent of each
 // other, fired together so neither's latency stacks on top of the other's.
 await Promise.allSettled([
  supabaseInsert('ask_feedback',{question_id:id,rating,note:note||null}),
  process.env.ASK_LOG_URL?fetch(process.env.ASK_LOG_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({type:'feedback',id,satisfied:rating==='up'?'yes':'no',note}),signal:AbortSignal.timeout(9000)}).catch(e=>console.error('Longhorn Links feedback log failed',e.name)):Promise.resolve()
 ]);
 return json({ok:true});
}
