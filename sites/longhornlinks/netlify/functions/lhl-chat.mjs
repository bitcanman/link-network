import {catalog} from '../lib/catalog.mjs';
import {rules} from '../lib/rules.mjs';
import {sources} from '../lib/sources.mjs';
import {pages,effectivePage} from '../lib/pages.mjs';
import {events,eventsForQuestion} from '../lib/events.mjs';
import {fetchPdfEvents,mergeEvents} from '../lib/pdfEvents.mjs';
import {searchEvents,eventSearchWords} from '../lib/eventSearch.mjs';
export const config={path:'/api/lhl-chat',rateLimit:{windowLimit:60,windowSize:60,aggregateBy:['ip','domain'],action:'rate_limit'}};
// 'mbae' (MBA Entrepreneurship) is a page/program value, not a separate catalog
// eligibility bucket - see pages.mjs's eligibilityAudience mapping below.
const audiences=new Set(['everyone','mba','mbae','mstc','engineering','first-year','undergraduate','graduate']);
const json=(data,status=200)=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
// Claude Sonnet 5 pricing per million tokens ($2 in / $10 out, permanent since
// 2026-08-10, per Anthropic's "Introducing Claude Sonnet 5" announcement).
// cacheReadMult/cacheWriteMult are Anthropic's standard prompt-caching
// convention (0.1x/1.25x of base input) - not used today (no cache_control
// breakpoints are set below), kept so the cost formula is correct the day
// caching is added without needing a second pricing-table change.
// Web search is billed separately at $0.01/search (Anthropic's web-search-
// tool docs).
const PRICE_CLAUDE={in:2,out:10,cacheReadMult:0.1,cacheWriteMult:1.25,perSearch:0.01};
const ANTHROPIC_VERSION='2023-06-01';
// Claude's web_search is a server tool it can call autonomously inside one
// messages.create() response, same as OpenAI's Responses API - but forcing
// tool_choice to this specific client tool would make it the model's very
// first action, blocking it from searching first. So tool_choice stays
// "auto" and the system prompt (below) instructs the model to always finish
// by calling this tool, with a plain-text/citations fallback parser in the
// handler for the rare case where it answers in prose instead.
const answerTool={
 name:'longhorn_answer',
 description:'Submit the final structured answer to the student. Always call this to finish - never give your final answer as plain text.',
 input_schema:{
  type:'object',
  properties:{
   heading:{type:'string'},
   paragraphs:{type:'array',items:{type:'string'}},
   followUps:{type:'array',items:{type:'object',properties:{label:{type:'string'},message:{type:'string'}},required:['label','message']}},
   webSources:{type:'array',items:{type:'object',properties:{id:{type:'string'},title:{type:'string'},url:{type:'string'}},required:['id','title','url']}},
   primaryId:{type:'string'}
  },
  required:['heading','paragraphs','followUps','webSources','primaryId']
 }
};
// Strip anything that could identify a student before the question leaves this function.
// Course codes (CS311, M408C) are deliberately kept; the letter+digit pattern is only
// treated as a UT EID when the question actually mentions an EID.
export function scrubQuestion(text){
 let out=text.replace(/[\w.+-]+@[\w.-]+\.\w+/g,'[email]').replace(/\b\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/g,'[phone]');
 if(/\beid\b/i.test(out))out=out.replace(/\b[a-z]{2,4}\d{3,5}\b/gi,'[id]');
 return out;
}
// Awaited on purpose: Netlify freezes the function once the handler returns, so a
// detached fetch here would drop rows at random.
// 4s: a measured round trip to Apps Script is 2.0-2.4s warm, more when cold - this
// stays above that floor without letting one slow write meaningfully delay the
// chat response. Any failure is still swallowed so the sheet cannot take the chat down.
async function logAsk(fields){
 if(!process.env.ASK_LOG_URL)return;
 try{
  await fetch(process.env.ASK_LOG_URL,{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams(fields),signal:AbortSignal.timeout(4000)});
 }catch(e){console.error('Longhorn Links ask log failed',e.name);}
}
export function explicitAudience(q){const v=q.toLowerCase().replace(/[-–]/g,' ');if(/\b(freshm[ae]n|first year)\b/.test(v))return 'first-year';if(/\bundergrad\w*\b/.test(v))return 'undergraduate';if(/\bmstc\b/.test(v))return 'mstc';if(/\bmba\b/.test(v))return 'mba';if(/\b(engineering|meche)\b/.test(v))return 'engineering';if(/\b(graduate|grad student|masters|phd|doctoral)\b/.test(v))return 'graduate';if(/\b(everyone|all students|ut wide|general resources)\b/.test(v))return 'everyone';return '';}
export function allows(l,a){const audience=(l.audience||'').toLowerCase();if(/undergrad/.test(audience)&&/\bgraduate\b/.test(audience))return true;if(/undergrad/.test(audience))return a==='first-year'||a==='undergraduate';if(/graduate/.test(audience))return ['graduate','mba','mstc'].includes(a);if(audience)return true;if(l.source==='MBA'||/\bmba\b/i.test(l.name))return a==='mba';if(l.source==='MSTC'||/\bmstc\b/i.test(l.name))return a==='mstc';if(/mechanical/i.test(l.source||''))return a==='engineering';return true;}
export function eligibleCatalog(question,audience){const on=/\bon[- ]campus\b/i.test(question);return catalog.filter(l=>allows(l,audience)&&!(on&&(l.scope==='off-campus'||/off[- ]campus|facebook/i.test(l.name))));}
const STOPWORDS=new Set(['the','a','an','is','are','do','does','did','i','my','me','to','for','of','in','on','at','how','what','when','where','who','can','need','get','find','about','with','and','or','it','this','that','ut','utexas','texas','austin']);
// Bridges a handful of real wording gaps found by testing, not a general stemmer:
// "funded"/"funding"/"funds" are the same ask, and "company"/"business"/"venture"
// mean the same thing as "startup" in this catalog's topics. Without this,
// "how to get my company funded" scored zero against every entry (no catalog text
// literally contains "funded" or "company") and silently fell back to an arbitrary
// slice of the catalog - a real bug, not a hypothetical one.
// "reserve"/"reservation" and "book"/"booking" are the same ask for room-booking
// questions but don't share a stem ("reserve" doesn't end in a stripped suffix),
// so without this a phrasing like "reserve a room" scored differently than "book a
// room" even though they mean the same thing to a student.
const WORD_SYNONYMS={company:'startup',companies:'startup',business:'startup',businesses:'startup',venture:'startup',ventures:'startup',firm:'startup',firms:'startup',reserve:'book',reservation:'book'};
// Excluded only from the web-search *forcing* decision below, not from STOPWORDS/
// relevantCatalog()'s scoring - these can still legitimately match a resource's
// own name/desc (an event titled "Spring Career Fair" should still score on
// "spring"), they just must not, on their own, make an otherwise-satisfied
// request ("please show me where I pay tuition") look like it needs a search.
const GENERIC_ACTION_RE=/^(please|show|tell|explain|help|want|like|give|let|know|see|looking|thanks|thank|quickly|asap|real|really|actually|literally|basically|honestly|seriously)$/;
const DATEY_RE=/^(january|february|march|april|may|june|july|august|september|october|november|december|today|tomorrow|yesterday|week|weeks|month|months|year|years|day|days|semester|spring|fall|summer|winter|now|soon|morning|afternoon|evening|night)$/;
function stem(w){if(w.length>5&&w.endsWith('ing'))return w.slice(0,-3);if(w.length>5&&w.endsWith('ies'))return w.slice(0,-3)+'y';if(w.length>4&&w.endsWith('ed'))return w.slice(0,-2);if(w.length>4&&w.endsWith('es'))return w.slice(0,-2);if(w.length>3&&w.endsWith('s')&&!w.endsWith('ss'))return w.slice(0,-1);return w;}
function canon(w){const s=stem(w);return WORD_SYNONYMS[w]||WORD_SYNONYMS[s]||s;}
function questionWords(question){return question.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>1&&!STOPWORDS.has(w));}
function textWords(text){return (text||'').toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>1);}
// Orders the eligible catalog by likely relevance - it no longer drops anything.
// Literal word matching with a small hand-written stemmer has no concept of
// meaning, so a resource that's exactly right can still score zero here ("how
// to make friends" scores zero against every entry; "how do i find clubs"
// scores zero against HornsLink specifically, since its name/desc say
// "organization" and only its aliases say "club"). Truncating to a scored
// top-N on that basis was a selection failure, not a model failure - the model
// can tell a real match from a coincidence; literal scoring can't tell a real
// miss from a wording gap. So this only sorts; `limit` (unset/0 by default)
// exists purely as a reversible cost knob - see RETRIEVAL_LIMIT in the handler.
export function relevantCatalog(question,eligible,{limit=0,boostSources=[]}={}){
 const words=[...new Set(questionWords(question).map(canon))];
 const qNorm=' '+question.toLowerCase().replace(/[^a-z0-9\s]/g,' ')+' ';
 const scored=eligible.map((l,i)=>{
  let score=0;
  const aliasHit=(l.aliases||[]).some(a=>qNorm.includes(' '+a.toLowerCase().replace(/[^a-z0-9\s]/g,' ').replace(/\s+/g,' ').trim()+' '));
  if(aliasHit)score+=50;
  const nameCanon=new Set(textWords(l.name).map(canon));
  const aliasCanon=new Set(textWords((l.aliases||[]).join(' ')).map(canon));
  const topicsCanon=new Set(textWords((l.topics||[]).join(' ')).map(canon));
  const descCanon=new Set(textWords(l.desc).map(canon));
  for(const w of words){
   if(nameCanon.has(w))score+=3;
   if(aliasCanon.has(w))score+=2;
   if(topicsCanon.has(w))score+=2;
   if(descCanon.has(w))score+=1;
  }
  // A modest nudge for the selected/effective program's own resources, so a
  // page-relevant entry ranks higher on a generic question - not enough to
  // beat an entry that's actually more topically relevant (an alias hit, or
  // several real word matches) just because of where it's filed.
  if(boostSources.length&&boostSources.includes(l.source))score+=6;
  return {l,score,i};
 });
 // Ties (including every zero-score entry) keep their original catalog order
 // rather than sorting arbitrarily - Array.prototype.sort is not guaranteed
 // stable across engines on every input shape, so this is explicit, not relied
 // on implicitly.
 scored.sort((a,b)=>b.score-a.score||a.i-b.i);
 const ordered=scored.map(s=>s.l);
 return limit>0?ordered.slice(0,limit):ordered;
}
// Coverage diagnostic, not proof that web search is needed on its own - a term
// coming back here just means no eligible catalog entry's name/aliases/topics/desc
// mentions it at all. Reuses the same STOPWORDS/canon()/questionWords() as
// relevantCatalog() so "covered" means the same thing in both places: a question
// word that would have scored a hit there. Callers (the handler) decide what to
// do with an uncovered term - e.g. a program's own event data, or a generic/date/
// action word, can still make it a non-issue (see the handler's own filtering),
// which is deliberately kept out of this function so it stays a plain, reusable
// coverage check rather than a decision.
export function unmatchedSalientTerms(question,eligible){
 const words=[...new Set(questionWords(question).map(canon))];
 const covered=new Set();
 for(const l of eligible){
  for(const w of textWords(l.name).map(canon))covered.add(w);
  for(const a of l.aliases||[])for(const w of textWords(a).map(canon))covered.add(w);
  for(const w of textWords((l.topics||[]).join(' ')).map(canon))covered.add(w);
  for(const w of textWords(l.desc).map(canon))covered.add(w);
 }
 return words.filter(w=>!covered.has(w));
}
// Resolves the matching internal events for a program page, if it has its own
// event feed (see pages.mjs/events.mjs). `pdfFetch` is injectable so tests can
// simulate a failed PDF fetch deterministically, without a real network call -
// no real page configures calendarPdfUrl today (see pdfEvents.mjs), so in
// production this never actually awaits a network request.
export async function resolveProgramEvents(programKey,question,todayISO,{pdfFetch=fetchPdfEvents}={}){
 const page=programKey&&pages[programKey];
 if(!page||!page.eventsKey)return null;
 const programEvents=events[page.eventsKey]||[];
 const {monthYear,matches}=eventsForQuestion(programEvents,question,todayISO);
 let merged=matches,pdfIssue=null;
 if(page.calendarPdfUrl){
  const pdfResult=await pdfFetch(page.calendarPdfUrl,{program:page.eventsKey,verifiedAt:todayISO});
  if(pdfResult.ok){
   merged=mergeEvents(matches,eventsForQuestion(pdfResult.events,question,todayISO).matches);
  }else{
   pdfIssue=pdfResult.reason;
  }
 }
 return {program:page.eventsKey,label:page.label,calendarUrl:page.calendarUrl,calendarLabel:page.calendarLabel,monthYear,events:merged,pdfIssue};
}
// Narrow on purpose: only fires when the whole question (ignoring punctuation) is
// one of a resource's own aliases and no other resource shares it - a real student
// sentence almost never matches this exactly, so it can't misfire on anything with
// actual interpretation to do. Lets a handful of pure administrative lookups (EID
// reset, DUO setup) skip the model call entirely.
export function singleUnambiguousMatch(question,eligible){
 const qNorm=question.toLowerCase().trim().replace(/[^a-z0-9\s]/g,'');
 const hits=eligible.filter(l=>(l.aliases||[]).some(a=>a.toLowerCase().replace(/[^a-z0-9\s]/g,'')===qNorm));
 return hits.length===1?hits[0]:null;
}
// Gates the no-model instant path on a later turn: the path itself only ever fires on
// a clean, unambiguous alias match (singleUnambiguousMatch already guarantees that),
// but on turn 1 that's also guaranteed self-contained since there's no prior turn to
// depend on. On a later turn the exact same words could be shorthand for something
// upstream in the conversation ("that", "what about X"), or too short a fragment to
// mean anything on its own - this is the additional gate for those cases specifically,
// not a replacement for singleUnambiguousMatch's own strictness.
const ANAPHORA_RE=/\b(it|that|this|them)\b|\b(what|how) about\b/i;
export function isSelfContained(question){
 if(ANAPHORA_RE.test(question))return false;
 return questionWords(question).length>=3;
}
// Exact match or a genuine dot-suffix subdomain only - never a plain endsWith/
// substring check on the raw URL, which would let a lookalike host like
// "texaslonghorns.com.evil.example" through.
function validWebHost(url){let host;try{host=new URL(url).hostname;}catch{return false;}return host==='utexas.edu'||host.endsWith('.utexas.edu')||host==='texaslonghorns.com'||host.endsWith('.texaslonghorns.com');}
export function validateAnswer(answer,eligible){
 if(!answer||typeof answer.heading!=='string'||!Array.isArray(answer.paragraphs)||!answer.paragraphs.length||!Array.isArray(answer.followUps))throw Error('Invalid answer');
 const map=new Map(eligible.map(l=>[l.id,l]));
 const webMap=new Map();
 for(const w of Array.isArray(answer.webSources)?answer.webSources:[]){
  if(!w||typeof w.id!=='string'||!/^w\d+$/.test(w.id)||typeof w.title!=='string'||!w.title||typeof w.url!=='string')continue;
  if(!validWebHost(w.url))continue;
  webMap.set(w.id,{id:w.id,name:w.title.slice(0,140),url:w.url});
 }
 const used=[];
 let stripped=0;
 // 40, not 8: each bullet/step is now its own entry (see rules.mjs), so a
 // legitimately long, multi-section list (several requirement groups, several
 // course bullets each) can genuinely need more entries than a handful of prose
 // paragraphs ever did - 8 silently truncated a real multi-section answer
 // mid-list during testing.
 const paragraphs=answer.paragraphs.slice(0,40).flatMap(p=>{
  if(typeof p!=='string')return [];
  let text=p.length>2200?p.slice(0,2200):p;
  // Markdown links are never valid output (rule 14), but the model occasionally writes
  // one anyway, and output can also get cut off mid-link by the token limit - leaving a
  // dangling "[lib.utexas.edu](" fragment with no closing paren. Collapse both the
  // complete and truncated forms down to their bracket text before the raw-URL strip
  // below, instead of leaving broken syntax visible to the student.
  text=text.replace(/\[([^\]\n]{0,120})\]\([^)\n]{0,300}$/,'$1');
  text=text.replace(/\[([^\]\n]{0,120})\]\(https?:\/\/[^)\s\n]{0,300}\)/g,'$1');
  text=text.replace(/https?:\/\/\S*/g,'').replace(/<[^>]+>/g,'');
  // A model occasionally packs several list items into one paragraphs[] entry
  // separated by literal newlines instead of one entry each (see rules.mjs) -
  // split those back out here, in the same pass that normalizes each resulting
  // line's leading marker, rather than letting a packed entry render as one run-on
  // paragraph with junk markers inside it.
  return text.split(/\r?\n+/).map(line=>{
   let t=line;
   // The frontend renders a constrained markdown-like subset only: **bold**, a
   // leading "- " as one bullet-list item, a leading "N. " as one numbered step -
   // each is its own paragraphs[] entry (see rules.mjs). Everything else the model
   // might write has no renderer and would show up as literal characters, so it's
   // still unwrapped here: single-*italic*/_underscore_ emphasis and # headers. The
   // single-asterisk strip uses lookaround so it can't eat into **bold** - matching
   // "*x*" but never the inner text of "**x**".
   t=t.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g,'$1').replace(/(?<![a-z0-9])_(.+?)_(?![a-z0-9])/gi,'$1').replace(/^#+\s*/,'');
   // Rather than teaching the renderer more list-marker syntax, fold every marker
   // meaning "- " onto the one it already understands, and drop markers with no
   // list meaning at all so they don't render as literal leading junk ("> The
   // official term..." / "— Office of the Registrar...", both observed live).
   t=t.replace(/^[*•+]\s+/,'- ').replace(/^[>—–]\s+/,'');
   t=t.replace(/\[\[([rw]\d+)\]\]/g,(full,id)=>{
    const isWeb=id[0]==='w';
    if(isWeb?!webMap.has(id):!map.has(id)){stripped++;return'';}
    if(!used.some(u=>u.id===id))used.push({id,isWeb,text:t});
    return full;
   });
   return t;
  });
 }).filter(p=>p!==null&&p.trim());
 if(!paragraphs.length)throw Error('No usable content after sanitizing.');
 // primaryId is a reliability backstop: models forget inline [[r123]] tokens more often than they skip a
 // required field. But a multi-turn conversation can leave a stale id in that field with no connection to
 // what this specific answer actually says (observed live: primaryId pointed at a previous turn's resource,
 // or once at an entirely unrelated one, while the text discussed something else) - only trust it when the
 // resource's own name is actually mentioned somewhere in this answer, not just schema-valid.
 const primaryId=typeof answer.primaryId==='string'?answer.primaryId:'';
 if(primaryId&&!used.some(u=>u.id===primaryId)){
  const isWeb=primaryId[0]==='w';
  const resource=isWeb?webMap.get(primaryId):map.get(primaryId);
  if(resource){
   const allText=(answer.heading+' '+paragraphs.join(' ')).toLowerCase();
   const nameWords=resource.name.toLowerCase().replace(/[^a-z0-9\s]/g,' ').split(/\s+/).filter(w=>w.length>3);
   if(nameWords.some(w=>allText.includes(w)))used.unshift({id:primaryId,isWeb});
  }
 }
 // Log-only misdescription guard: a cited catalog entry whose name/aliases/topics/desc
 // share no content word with the paragraph it's attached to is suspect - the observed
 // case was a football-ticket answer citing r4 (Canvas) as "the athletics website" while
 // r29 (The Big Ticket) sat unused at retrieval rank 1. This does not strip or reject
 // anything yet; it only counts, so the false-positive rate is measurable (via
 // ASK_LOG_URL) before a suspect citation starts getting removed. A generous extra link
 // offered as a plausible alternative is not flagged by this on its own - only a
 // citation whose entry shares literally no content word with its own paragraph is.
 let suspectCitations=0;
 for(const u of used){
  if(u.isWeb||!u.text)continue;
  const entry=map.get(u.id);
  if(!entry)continue;
  const contentCanon=text=>new Set(textWords(text).filter(w=>!STOPWORDS.has(w)).map(canon));
  const resourceWords=new Set([...contentCanon(entry.name),...contentCanon((entry.aliases||[]).join(' ')),...contentCanon((entry.topics||[]).join(' ')),...contentCanon(entry.desc)]);
  const paraWords=contentCanon(u.text);
  if(![...paraWords].some(w=>resourceWords.has(w)))suspectCitations++;
 }
 const retrievedAt=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date());
 const sources=used.map(u=>{
  if(u.isWeb){const w=webMap.get(u.id);return {id:u.id,name:w.name,url:w.url,desc:'',login:false,kind:'web',retrievedAt};}
  const l=map.get(u.id);return {id:u.id,name:l.name,url:l.url,desc:l.desc,login:!!l.login};
 });
 // Each follow-up is a short label (what the button shows) plus a fuller message (what
 // actually gets submitted) - keeps buttons scannable while the request stays unambiguous.
 // A plain string is still accepted (label===message) for callers/tests that predate this.
 const followUps=answer.followUps.map(f=>{
  if(typeof f==='string')return f.trim()?{label:f.slice(0,60),message:f.slice(0,200)}:null;
  if(!f||typeof f.label!=='string'||typeof f.message!=='string'||!f.label.trim()||!f.message.trim())return null;
  return {label:f.label.slice(0,60),message:f.message.slice(0,200)};
 }).filter(Boolean).slice(0,3);
 return {heading:answer.heading.slice(0,140),paragraphs,followUps,sources,stripped,suspectCitations};
}
// Best-effort, in-memory only: a Map inside this module's scope. Helps while a
// given Netlify Function container stays warm; resets on cold start and is not
// shared across concurrent instances. Never keyed on or storing anything personal -
// only no-history, non-web-search public answers, keyed by question+audience.
const answerCache=new Map();
export function _clearAnswerCacheForTests(){answerCache.clear();}
const CACHE_TTL_MS=10*60*1000;
function cacheGet(key){const hit=answerCache.get(key);if(!hit)return null;if(Date.now()>hit.expiresAt){answerCache.delete(key);return null;}return hit.value;}
function cacheSet(key,value){answerCache.set(key,{value,expiresAt:Date.now()+CACHE_TTL_MS});}
export default async function handler(req){
 if(req.method!=='POST')return json({error:'Use POST.'},405);
 const origin=req.headers.get('origin');if(origin&&origin!==new URL(req.url).origin)return json({error:'Origin not allowed.'},403);
 if(!req.headers.get('content-type')?.includes('application/json'))return json({error:'Expected JSON.'},415);
 if(Number(req.headers.get('content-length')||0)>16000)return json({error:'Request too large.'},413);
 let data;try{const raw=await req.text();if(new TextEncoder().encode(raw).length>16000)return json({error:'Request too large.'},413);data=JSON.parse(raw);}catch{return json({error:'Invalid JSON.'},400);}
 const question=typeof data.question==='string'?data.question.trim():'';
 if(!question||question.length>600||!audiences.has(data.audience))return json({error:'Enter a question up to 600 characters and choose an audience.'},400);
 const history=Array.isArray(data.history)?data.history.slice(-8).filter(m=>m&&['user','assistant'].includes(m.role)&&typeof m.content==='string').map(m=>({role:m.role,content:m.content.slice(0,1200)})):[];
 const audience=explicitAudience(question)||data.audience;
 // `audience` doubles as the selected page/program (this chat has no separate
 // per-page embed - see pages.mjs). `effectiveProgram` applies the explicit-
 // override rule (a named different program, or "campus-wide", wins over the
 // selected one); `eligibilityAudience` maps a page like mbae back to the
 // catalog audience bucket it shares with mba, since it isn't a separate
 // eligibility tier.
 const effectiveProgram=effectivePage(question,pages[audience]?audience:null);
 const eligibilityAudience=pages[audience]?.eligibilityAudience||audience;
 const eligible=eligibleCatalog(question,eligibilityAudience);
 const id=crypto.randomUUID().slice(0,8);
 const cacheKey=history.length===0?audience+'|'+question.toLowerCase().trim():null;
 if(cacheKey){const cached=cacheGet(cacheKey);if(cached)return json({...cached,audience,id});}
 // Pure administrative lookup with exactly one unambiguous resource - skip the model call
 // (and the OpenAI key requirement entirely - this path never needs either). Turn 1 is
 // always eligible (nothing upstream to depend on); a later turn only qualifies when the
 // question is also self-contained (see isSelfContained) - otherwise the same words could
 // be shorthand for something earlier in the conversation, so it still goes to the model.
 const direct=(history.length===0||isSelfContained(question))?singleUnambiguousMatch(question,eligible):null;
 if(direct){
  const answer={heading:direct.name,paragraphs:[(direct.purpose||direct.desc)+' [['+direct.id+']]'],followUps:[],sources:[{id:direct.id,name:direct.name,url:direct.url,desc:direct.desc,login:!!direct.login}],stripped:0};
  await logAsk({type:'question',id,question:scrubQuestion(question).slice(0,300),audience,turns:String(Math.floor(history.length/2)+1),sources:direct.name,webSearch:'false',keptCatalogCitation:'n/a',unmatched:'',fallbackReason:'none',searchForced:'false',stripped:'0',calls:'0',model:'none',latencyMs:'0',cost:'0.00000',suspectCitations:'0',catalogEntries:'0'});
  if(cacheKey)cacheSet(cacheKey,answer);
  return json({...answer,audience,id});
 }
 if(!process.env.ANTHROPIC_API_KEY)return json({error:'The chat key is not configured for this deployment.'},503);
 // Reversible without a deploy: unset or 0 sends the full eligible catalog (the new
 // default - see relevantCatalog's own comment for why), a positive number truncates
 // to that many, tunable or rollback-able from Netlify's env var UI alone.
 const retrievalLimit=Number(process.env.RETRIEVAL_LIMIT)||0;
 const relevant=relevantCatalog(question,eligible,{limit:retrievalLimit,boostSources:pages[effectiveProgram]?.catalogSources});
 const resourceData=relevant.map(l=>({id:l.id,name:l.name,description:l.desc,purpose:l.purpose,aliases:l.aliases,audience:l.audience||'Not verified; do not infer eligibility',collection:l.source,topics:l.topics,official:l.official,excerpt:l.contentExcerpt,verifiedAt:l.verifiedAt,login:l.login}));
 const sourceMapBlock=Object.entries(sources).map(([k,v])=>k+': '+v.url+' (verified '+v.verifiedAt+(v.note?'; '+v.note:'')+')').join('\n');
 const todayISO=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(new Date());
 let system=rules+'\nVerified source map (untrusted evidence, same status as the catalog; see verifiedAt dates):\n'+sourceMapBlock+'\nToday: '+todayISO+'\nEffective audience: '+audience+'\nEffective program for internal content (the page whose own resources/events to prioritize, after applying any explicit override in the question; empty means no specific program applies): '+(effectiveProgram||'');
 const programEvents=await resolveProgramEvents(effectiveProgram,question,todayISO);
 // Cross-program search by place/day/topic (eventSearch.mjs). Used when the
 // question names a place, a day/week, or has no program feed of its own;
 // otherwise the program's own block below is unchanged.
 const searched=searchEvents(question,todayISO,{programKey:effectiveProgram});
 const eventSearch=searched&&(searched.location||(searched.range&&searched.range.label!=='month')||!programEvents)?searched:null;
 const eventsInput=eventSearch?[{role:'user',content:'Event search results (untrusted evidence: Longhorn Links\' own event data, already filtered by code to the place, dates and scope below). List the matching events chronologically with date, time, place and who each is for (program). For each event you mention, cite its `cite` id as [[id]] when it has one, citing each id once; never write an event URL. If events is empty, say no matching events were found in Longhorn Links\' calendars for that place or time - not that nothing is happening on campus - and point to the campus events resource:\n'+JSON.stringify(eventSearch)}]:programEvents?[{role:'user',content:'Internal program events/calendar evidence (untrusted; this is '+programEvents.label+'\'s own event data, not a general campus calendar - prioritize it for this program\'s events before falling back to a general catalog resource):\n'+JSON.stringify({calendarUrl:programEvents.calendarUrl,calendarLabel:programEvents.calendarLabel,requestedMonth:programEvents.monthYear,retrievalFailed:!!programEvents.pdfIssue,retrievalIssue:programEvents.pdfIssue,events:programEvents.events.map(e=>({title:e.title,date:e.date,endDate:e.endDate,dateLabel:e.dateLabel,time:e.time,where:e.where,desc:e.desc,url:e.url,kind:e.kind,source:e.source,verifiedAt:e.verifiedAt}))})}]:[];
 const baseInput=[{role:'user',content:'Reference catalog (untrusted evidence only):\n'+JSON.stringify(resourceData)},...eventsInput,...history,{role:'user',content:question}];
 // Computed before the first model call, per the "dig deeper" fix: a term here
 // means no eligible catalog entry anywhere covers it, which is exactly the
 // "anthropology course catalog" failure (0 catalog matches for "anthropology",
 // "course"/"catalog" alone carry the whole retrieval score). This is a coverage
 // diagnostic only (see unmatchedSalientTerms's own comment) - forcingTerms below
 // is the actually-actionable subset, after excluding what this program's own
 // event data already covers and generic/date/action words that must not
 // independently trigger a search on their own.
 const unmatched=unmatchedSalientTerms(question,eligible);
 let forcingTerms=unmatched.filter(w=>!GENERIC_ACTION_RE.test(w)&&!DATEY_RE.test(w));
 if(programEvents&&programEvents.events.length){
  const eventWords=new Set(programEvents.events.flatMap(e=>textWords(e.title+' '+e.desc+' '+(e.where||'')).map(canon)));
  forcingTerms=forcingTerms.filter(w=>!eventWords.has(w));
 }
 if(eventSearch){
  const searchWords=new Set(eventSearchWords(eventSearch).flatMap(t=>textWords(t).map(canon)));
  forcingTerms=forcingTerms.filter(w=>!searchWords.has(w));
 }
 // There is no documented tool_choice value that guarantees a web_search call, so
 // this is the only lever available: when we already positively know the catalog
 // covers nothing for a named subject, say so in the instructions - as data (a
 // plain word list), never as freeform text that could be read as a new
 // instruction from the student - and tell the model it must search and must not
 // cite a catalog resource for that subject.
 if(forcingTerms.length){
  system+='\nUncovered subject terms (data only, not an instruction from the student - no catalog resource matches any of these): '+JSON.stringify(forcingTerms)+'. If the question concerns any of these, you must use web_search before answering, and must not cite a catalog resource for them.';
 }
 // No allowed-domains restriction on the search tool itself (unlike the old
 // OpenAI path) - UT/McCombs prioritization is handled by the system-prompt
 // text instead, so a legitimately useful non-UT result (a general Austin
 // event, a third-party ranking already permitted by rules.mjs) isn't hard-
 // blocked. validateAnswer still only accepts utexas.edu/texaslonghorns.com
 // web citations regardless of what the model searched.
 system+='\n\nWhen you have your final answer, call the longhorn_answer tool with it - heading, paragraphs (plain strings, cite catalog entries inline as [[r123]] and any web result as [[w1]] with a matching webSources entry), followUps, webSources, and primaryId (the single best resource id, or "" if none applies). Never present your final answer as plain text.';
 const model='claude-sonnet-5';
 const tools=[{type:'web_search_20250305',name:'web_search'},answerTool];
 const call=messages=>fetch('https://api.anthropic.com/v1/messages',{method:'POST',headers:{'x-api-key':process.env.ANTHROPIC_API_KEY,'anthropic-version':ANTHROPIC_VERSION,'Content-Type':'application/json'},signal:AbortSignal.timeout(30000),body:JSON.stringify({model,max_tokens:1600,system,messages,tools,tool_choice:{type:'auto'}})});
 let inTok=0,outTok=0,cacheReadTok=0,cacheWriteTok=0,webSearchRequests=0,usedSearch=false,calls=0,latencyMs=0,fallbackReason='none';
 const tally=body=>{
  const u=body.usage||{};
  inTok+=u.input_tokens||0;outTok+=u.output_tokens||0;cacheReadTok+=u.cache_read_input_tokens||0;cacheWriteTok+=u.cache_creation_input_tokens||0;
  webSearchRequests+=u.server_tool_use?.web_search_requests||0;
 };
 // Extract either the tool_use longhorn_answer input, or fall back to parsing
 // plain text + citations if the model answered without calling the tool (the
 // one behavior tool_choice:"auto" + instructions can ask for but not force -
 // see answerTool's own comment above).
 const extract=body=>{
  const content=Array.isArray(body.content)?body.content:[];
  const toolUse=content.filter(b=>b.type==='tool_use'&&b.name==='longhorn_answer').pop();
  if(toolUse)return toolUse.input;
  const text=content.filter(b=>b.type==='text').map(b=>b.text).join('\n\n');
  const citedSources=new Map();
  for(const b of content){
   if(b.type!=='text'||!Array.isArray(b.citations))continue;
   for(const c of b.citations){
    if(c.type==='web_search_result_location'&&c.url&&!citedSources.has(c.url))citedSources.set(c.url,{id:'w'+(citedSources.size+1),title:(c.title||c.url).slice(0,140),url:c.url});
   }
  }
  const webSources=[...citedSources.values()];
  let withTokens=text;
  for(const w of webSources)withTokens+=' [['+w.id+']]';
  return {heading:'Answer',paragraphs:[withTokens||'No answer was returned.'],followUps:[],webSources,primaryId:webSources[0]?.id||''};
 };
 try{
  const t0=Date.now();
  calls++;
  // Search is available on this first call, not just a retry - the two most
  // expensive failures are a wrong link and making the student ask twice, and
  // giving the model the tool (plus the compelling system-prompt line above,
  // when we already know the catalog is empty) lets most questions that used
  // to need a retry get answered correctly in one call.
  const response=await call(baseInput);
  latencyMs+=Date.now()-t0;
  if(!response.ok){
   // Anthropic's error body names the offending parameter explicitly - logging
   // it turns a generic-looking outage into a diagnosis in seconds. Server-side
   // console only; never returned to the student, since it may contain request
   // details.
   let bodyText='';
   try{bodyText=(await response.text()).slice(0,500);}catch{}
   console.error('Longhorn Links provider status',response.status,bodyText);
   return json({error:response.status===429?'The chat is at its usage limit. Please try again shortly.':response.status===401||response.status===403?'The server key or its API permissions need checking.':'The answer service could not complete this request. Please try again.'},response.status===429?429:502);
  }
  const body=await response.json();
  tally(body);
  let raw=extract(body);
  usedSearch=webSearchRequests>0;
  let answer=validateAnswer(raw,eligible);
  // Backstop only, not a routine second pass: fires only when we already
  // positively know the catalog has nothing for a named subject (forcingTerms),
  // the model still didn't search despite the tool being attached and the
  // system prompt compelling it, and the answer it gave carries no surviving
  // web citation either - a genuine miss. Any other case (no forcingTerms, or
  // the model already searched, or it already cited a web source) makes no
  // second call at all.
  const citesWeb=answer.sources.some(s=>s.kind==='web');
  if(forcingTerms.length>0&&!usedSearch&&!citesWeb){
   fallbackReason='forced-unmatched-subject-no-search';
   try{
    // Each messages.create() call carries its own full conversation - the
    // model has no memory of call one's catalog message unless it's resent
    // here. Omitting it meant the second pass could only ever cite [[w#]],
    // even when the first pass had good [[r#]] catalog matches (observed: an
    // MSTC "course catalog" question lost r1/r162/r165 entirely once the
    // search pass ran). resourceData here is already the ~20-entry retrieved
    // subset, not the full catalog, so resending it is cheap.
    // forcingTerms is non-empty on every path that reaches here, so this note
    // is unconditional - passed as a plain, clearly-delimited data sentence (a
    // comma-joined word list, already stripped of punctuation by
    // questionWords()), never as freeform user text that could be read as a
    // new instruction.
    const unmatchedNote=' No specific resource was found for the requested subject: '+forcingTerms.join(', ')+'.';
    const searchInput=[...baseInput,{role:'assistant',content:JSON.stringify({heading:raw.heading,paragraphs:raw.paragraphs})},{role:'user',content:'That was not specific enough.'+unmatchedNote+' Use web_search to find the specific official page for this question. Keep any catalog [[r123]] citations from your last answer that are still correct, and add the web result as a new [[w1]] citation with a matching webSources entry for the specific page you found - this should add to your last answer, not replace it, unless the catalog citation was actually wrong.'}];
    const t1=Date.now();
    calls++;
    const searchResponse=await call(searchInput);
    latencyMs+=Date.now()-t1;
    if(searchResponse.ok){
     const secondBody=await searchResponse.json();
     tally(secondBody);
     raw=extract(secondBody);
     usedSearch=webSearchRequests>0;
     answer=validateAnswer(raw,eligible);
    }else console.error('Longhorn Links web search status',searchResponse.status);
   }catch(e){console.error('Longhorn Links web search failed',e.name);}
  }
  const tokenCost=(inTok*PRICE_CLAUDE.in+cacheReadTok*PRICE_CLAUDE.in*PRICE_CLAUDE.cacheReadMult+cacheWriteTok*PRICE_CLAUDE.in*PRICE_CLAUDE.cacheWriteMult+outTok*PRICE_CLAUDE.out)/1e6;
  const searchCost=webSearchRequests*PRICE_CLAUDE.perSearch;
  await logAsk({
   type:'question',id,
   question:scrubQuestion(question).slice(0,300),
   audience,
   turns:String(Math.floor(history.length/2)+1),
   // Names, not ids, so the column is readable and pivots cleanly. Empty means the
   // catalog had no answer, which is the signal worth watching.
   sources:answer.sources.map(x=>x.name).join(' | ').slice(0,500),
   webSearch:String(usedSearch),
   // Whether a search-path answer kept at least one catalog ([[r123]]) citation
   // alongside the web result, vs. losing it entirely once the search pass ran -
   // 'n/a' when no search happened, so a regression here shows up as a drop in
   // 'true' rather than silently blending into rows where it never applied.
   keptCatalogCitation:usedSearch?String(answer.sources.some(s=>s.kind!=='web')):'n/a',
   // Raw coverage diagnostic (see unmatchedSalientTerms) - distinct from whether
   // a search actually ran, so "unmatched vocabulary with no search" and "unmatched
   // vocabulary that genuinely triggered one" are both visible separately.
   unmatched:unmatched.join(','),
   fallbackReason,
   // Whether the compelling system-prompt line (step 2) was added at all -
   // compare against webSearch to see how often it was actually needed vs. the
   // model already searching on its own once the tool was simply available.
   searchForced:String(forcingTerms.length>0),
   stripped:String(answer.stripped),
   // Log-only misdescription guard (see validateAnswer) - counted for a week to
   // measure the false-positive rate before it starts removing anything.
   suspectCitations:String(answer.suspectCitations),
   // How many catalog entries were actually sent to the model - visible alongside
   // cost now that the default is the full eligible set, not a top-N cut.
   catalogEntries:String(relevant.length),
   calls:String(calls),
   model,
   latencyMs:String(latencyMs),
   cost:(tokenCost+searchCost).toFixed(5)
  });
  if(cacheKey&&!usedSearch)cacheSet(cacheKey,answer);
  return json({...answer,audience,id});
 }catch(e){console.error('Longhorn Links answer failed',e.name);return json({error:'The answer could not be completed. Please try again.'},502);}
}
