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
 // Same validation lhl-chat.mjs applies to the sessionId it echoes back to the
 // client - sessionStorage-sourced, per-tab, non-identifying; null is always
 // legal (clicks fired before a session id existed, or with it disabled).
 const sessionId=typeof data.sessionId==='string'&&UUID_RE.test(data.sessionId)?data.sessionId:null;
 // A question answered purely by the instant tier - no model call, no
 // existing ask_questions row to attach to (unlike click/feedback below,
 // which reference a row lhl-chat already created). This is its own new
 // row, fired via sendBeacon the moment local scoring completes, on every
 // submit that doesn't go to deep search - otherwise "we answered it
 // instantly" and "nobody asked" are indistinguishable in the data.
 // deep_search_requested is always false here; lhl-chat.mjs sets it true on
 // every row it creates, since every call there is a deep search by
 // construction now.
 if(data.type==='instant'){
  const question=typeof data.question==='string'?data.question.trim().slice(0,600):'';
  if(!question)return json({error:'Invalid instant log.'},400);
  const audience=typeof data.audience==='string'&&data.audience.trim()?data.audience.trim().slice(0,20):'everyone';
  const turns=Number.isInteger(data.turns)&&data.turns>=0?data.turns:null;
  const seq=Number.isInteger(data.seq)&&data.seq>=0?data.seq:null;
  const catalogEntries=Number.isInteger(data.catalogEntries)&&data.catalogEntries>=0?data.catalogEntries:null;
  const topScore=Number.isFinite(data.topScore)?data.topScore:null;
  const sourceIds=Array.isArray(data.sourceIds)?data.sourceIds.filter(x=>typeof x==='string').slice(0,5):[];
  const sourceUrls=Array.isArray(data.sourceUrls)?data.sourceUrls.filter(x=>typeof x==='string').slice(0,5):[];
  await supabaseInsert('ask_questions',{id:crypto.randomUUID(),status:'ok',question,audience,turns,catalog_entries:catalogEntries,top_score:topScore,answered:false,calls:0,cost_usd:0,primary_url:sourceUrls[0]||null,source_urls:sourceUrls,source_ids:sourceIds,deep_search_requested:false,session_id:sessionId,seq});
  return json({ok:true});
 }
 const id=typeof data.id==='string'?data.id.trim():'';
 if(!UUID_RE.test(id))return json({error:'Invalid feedback.'},400);
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
