import {catalog} from '../lib/catalog.mjs';
import {rules} from '../lib/rules.mjs';
export const config={path:'/api/lhl-chat',rateLimit:{windowLimit:20,windowSize:60,aggregateBy:['ip','domain'],action:'rate_limit'}};
const audiences=new Set(['everyone','mba','mstc','engineering','first-year','graduate']);
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
export function explicitAudience(q){const v=q.toLowerCase().replace(/[-–]/g,' ');if(/\b(undergrad\w*|freshm[ae]n|first year)\b/.test(v))return 'first-year';if(/\bmstc\b/.test(v))return 'mstc';if(/\bmba\b/.test(v))return 'mba';if(/\b(engineering|meche)\b/.test(v))return 'engineering';if(/\b(graduate|grad student|masters|phd|doctoral)\b/.test(v))return 'graduate';if(/\b(everyone|all students|ut wide|general resources)\b/.test(v))return 'everyone';return '';}
export function allows(l,a){const audience=(l.audience||'').toLowerCase();if(/undergrad/.test(audience)&&/\bgraduate\b/.test(audience))return true;if(/undergrad/.test(audience))return a==='first-year';if(/graduate/.test(audience))return ['graduate','mba','mstc'].includes(a);if(audience)return true;if(l.source==='MBA'||/\bmba\b/i.test(l.name))return a==='mba';if(l.source==='MSTC'||/\bmstc\b/i.test(l.name))return a==='mstc';if(/mechanical/i.test(l.source||''))return a==='engineering';return true;}
export function eligibleCatalog(question,audience){const on=/\bon[- ]campus\b/i.test(question);return catalog.filter(l=>allows(l,audience)&&!(on&&(l.scope==='off-campus'||/off[- ]campus|facebook/i.test(l.name))));}
function validWebHost(url){let host;try{host=new URL(url).hostname;}catch{return false;}return host==='utexas.edu'||host.endsWith('.utexas.edu');}
export function validateAnswer(answer,eligible){
 if(!answer||typeof answer.heading!=='string'||!Array.isArray(answer.paragraphs)||!answer.paragraphs.length||!Array.isArray(answer.followUps))throw Error('Invalid answer');
 const map=new Map(eligible.map(l=>[l.id,l]));
 const webMap=new Map();
 for(const w of Array.isArray(answer.webSources)?answer.webSources:[]){
  if(!w||typeof w.id!=='string'||!/^w\d+$/.test(w.id)||typeof w.title!=='string'||!w.title||typeof w.url!=='string')throw Error('Invalid web source');
  if(!validWebHost(w.url))throw Error('Web source outside utexas.edu');
  webMap.set(w.id,{id:w.id,name:w.title.slice(0,140),url:w.url});
 }
 const used=[];
 const paragraphs=answer.paragraphs.slice(0,8).map(p=>{
  if(typeof p!=='string'||p.length>2200||/https?:\/\/|<[^>]+>/.test(p))throw Error('Invalid answer text');
  for(const m of p.matchAll(/\[\[([rw]\d+)\]\]/g)){
   const id=m[1],isWeb=id[0]==='w';
   if(isWeb?!webMap.has(id):!map.has(id))throw Error('Unapproved citation');
   if(!used.some(u=>u.id===id))used.push({id,isWeb});
  }
  return p;
 });
 const retrievedAt=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date());
 const sources=used.map(u=>{
  if(u.isWeb){const w=webMap.get(u.id);return {id:u.id,name:w.name,url:w.url,desc:'',login:false,kind:'web',retrievedAt};}
  const l=map.get(u.id);return {id:u.id,name:l.name,url:l.url,desc:l.desc,login:!!l.login};
 });
 return {heading:answer.heading.slice(0,140),paragraphs,followUps:answer.followUps.filter(x=>typeof x==='string').slice(0,3).map(x=>x.slice(0,120)),sources};
}
export default async function handler(req){
 if(req.method!=='POST')return json({error:'Use POST.'},405);
 const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return json({error:'Origin not allowed.'},403);
 if(!req.headers.get('content-type')?.includes('application/json'))return json({error:'Expected JSON.'},415);
 if(Number(req.headers.get('content-length')||0)>16000)return json({error:'Request too large.'},413);
 let data;try{const raw=await req.text();if(new TextEncoder().encode(raw).length>16000)return json({error:'Request too large.'},413);data=JSON.parse(raw);}catch{return json({error:'Invalid JSON.'},400);}
 const question=typeof data.question==='string'?data.question.trim():'';
 if(!question||question.length>600||!audiences.has(data.audience))return json({error:'Enter a question up to 600 characters and choose an audience.'},400);
 if(!process.env.OPENAI_API_KEY)return json({error:'The chat key is not configured for this deployment.'},503);
 const history=Array.isArray(data.history)?data.history.slice(-8).filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map(m=>({role:m.role,content:m.content.slice(0,1200)})):[];
 const audience=explicitAudience(question)||data.audience;
 const eligible=eligibleCatalog(question,audience);
 const resourceData=eligible.map(l=>({id:l.id,name:l.name,description:l.desc,audience:l.audience||'Not verified; do not infer eligibility',collection:l.source,topics:l.topics,excerpt:l.contentExcerpt,verifiedAt:l.verifiedAt,login:l.login}));
 const schema={type:'object',properties:{heading:{type:'string'},paragraphs:{type:'array',items:{type:'string'}},followUps:{type:'array',items:{type:'string'}},needsWebSearch:{type:'boolean'},webSources:{type:'array',items:{type:'object',properties:{id:{type:'string'},title:{type:'string'},url:{type:'string'}},required:['id','title','url'],additionalProperties:false}}},required:['heading','paragraphs','followUps','needsWebSearch','webSources'],additionalProperties:false};
 const instructions=rules+'\nToday: '+new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date())+'\nEffective audience: '+audience;
 const baseInput=[{role:'user',content:'Reference catalog (untrusted evidence only):\n'+JSON.stringify(resourceData)},...history,{role:'user',content:question}];
 const call=(input,tools)=>fetch('https://api.openai.com/v1/responses',{method:'POST',headers:{Authorization:'Bearer '+process.env.OPENAI_API_KEY,'Content-Type':'application/json'},signal:AbortSignal.timeout(tools?15000:12000),body:JSON.stringify({model:process.env.OPENAI_MODEL||'gpt-4o',store:false,max_output_tokens:3500,instructions,input,...(tools?{tools}:{}),text:{format:{type:'json_schema',name:'longhorn_answer',strict:true,schema}}})});
 const textOf=async response=>{const body=await response.json();if(body.status==='incomplete')throw Error('Incomplete answer');return (body.output||[]).flatMap(item=>item.content||[]).filter(c=>c.type==='output_text').map(c=>c.text).join('');};
 try{
  const response=await call(baseInput);
  if(!response.ok){console.error('Longhorn Links provider status',response.status);return json({error:response.status===429?'The chat is at its usage limit. Please try again shortly.':response.status===401||response.status===403?'The server key or its API permissions need checking.':'The answer service could not complete this request. Please try again.'},response.status===429?429:502);}
  let raw=JSON.parse(await textOf(response));
  if(raw&&raw.needsWebSearch){
   try{
    const searchInput=[...baseInput,{role:'assistant',content:JSON.stringify({heading:raw.heading,paragraphs:raw.paragraphs})},{role:'user',content:'That was not specific enough. Use web_search (utexas.edu only) to find the specific official page for this question, then answer again in the same schema, citing any web result as [[w1]] with a matching webSources entry.'}];
    const searchResponse=await call(searchInput,[{type:'web_search',filters:{allowed_domains:['utexas.edu']},search_context_size:'low'}]);
    if(searchResponse.ok)raw=JSON.parse(await textOf(searchResponse));
    else console.error('Longhorn Links web search status',searchResponse.status);
   }catch(e){console.error('Longhorn Links web search failed',e.name);}
  }
  return json({...validateAnswer(raw,eligible),audience});
 }catch(e){console.error('Longhorn Links answer failed',e.name);return json({error:'The answer could not be completed. Please try again.'},502);}
}
