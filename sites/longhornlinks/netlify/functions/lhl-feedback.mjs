export const config={path:'/api/lhl-feedback',rateLimit:{windowLimit:10,windowSize:60,aggregateBy:['ip','domain'],action:'rate_limit'}};
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export default async function handler(req){
 if(req.method!=='POST')return json({error:'Use POST.'},405);
 const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return json({error:'Origin not allowed.'},403);
 if(Number(req.headers.get('content-length')||0)>2000)return json({error:'Request too large.'},413);
 let data;try{const raw=await req.text();if(raw.length>2000)return json({error:'Request too large.'},413);data=JSON.parse(raw);}catch{return json({error:'Invalid JSON.'},400);}
 const id=typeof data.id==='string'?data.id.trim():'';
 const rating=data.rating==='up'||data.rating==='down'?data.rating:'';
 // The id is minted by lhl-chat as 8 hex chars. Anything else is not one of ours.
 if(!/^[0-9a-f]{8}$/.test(id)||!rating)return json({error:'Invalid feedback.'},400);
 const note=typeof data.note==='string'?data.note.trim().slice(0,300):'';
 if(!process.env.ASK_LOG_URL)return json({ok:true,logged:false});
 try{
  await fetch(process.env.ASK_LOG_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({type:'feedback',id,satisfied:rating==='up'?'yes':'no',note}),signal:AbortSignal.timeout(2500)});
 }catch(e){console.error('Longhorn Links feedback log failed',e.name);return json({ok:true,logged:false});}
 return json({ok:true,logged:true});
}
