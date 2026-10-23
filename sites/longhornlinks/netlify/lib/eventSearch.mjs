// Cross-program event search: finds events by place, day and topic across every
// event source (program pages + the email inbox), deterministically in code, so
// the model only has to describe what it is handed.
//
// "What's happening in Rowling Hall today?" or "events in the MBA building this
// week" should surface any matching event - MBA, MBA Entrepreneurship, MSTC or
// campus-wide - not only the selected page's own. A named place widens the
// search to every program; without one, a selected program keeps its own pool
// (so MBA Entrepreneurship stays narrow, per pages.mjs/events.mjs).
import {events,mergeProgramEvents,parseMonthYear} from './events.mjs';
import {pages} from './pages.mjs';

// Buildings and how students refer to them. Matched against the question AND
// against each event's own location/title/description, so "MBA building" finds
// an event whose location says "RRH Crum Auditorium". Add a row to teach it a
// new place - no other code changes needed.
export const LOCATIONS=[
 {name:'Rowling Hall',aliases:['rowling hall','rowling','rrh','robert b rowling','mba building','graduate business building','mba school']},
 {name:'CBA (McCombs undergraduate building)',aliases:['cba','college of business administration','business administration building','gsb','graduate school of business building']},
 {name:'Etter-Harbin Alumni Center',aliases:['etter harbin','alumni center']},
 {name:'STATION Austin',aliases:['station austin']},
 {name:'Capital Factory',aliases:['capital factory']},
 {name:'Herb Kelleher Entrepreneurship Center',aliases:['kelleher center','herb kelleher']},
 {name:'Online',aliases:['virtual','online','zoom','webinar']}
];

// Program labels the model shows next to each event, and the catalog id of
// that program's Longhorn Links hub, which is the link it may cite.
const PROGRAM_INFO={
 mba:{label:'MBA',cite:'r168'},
 mbae:{label:'MBA Entrepreneurship',cite:'r92'},
 mstc:{label:'MSTC',cite:'r165'},
 general:{label:'Open to all UT students',cite:'r26'},
 engineering:{label:'Engineering',cite:''}
};

const EVENT_INTENT=/\b(events?|happening|going on|going down|what'?s on|activit(y|ies)|talks?|workshops?|panels?|info sessions?|happy hours?|mixers?|socials?|networking|competitions?|fairs?|seminars?|calendar|deadlines?|anything (on|going))\b/i;
export function isEventQuestion(q){return EVENT_INTENT.test(q);}

const norm=s=>' '+String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim()+' ';
const hasPhrase=(text,phrase)=>norm(text).includes(norm(phrase));

export function detectLocation(question){
 return LOCATIONS.find(l=>l.aliases.some(a=>hasPhrase(question,a)))||null;
}
function eventAt(e,loc){
 const text=(e.where||'')+' '+e.title+' '+(e.desc||'');
 return loc.aliases.some(a=>hasPhrase(text,a));
}

// ISO date arithmetic in UTC, so the server's own time zone never shifts a day.
function addDays(iso,n){const d=new Date(iso+'T00:00:00Z');d.setUTCDate(d.getUTCDate()+n);return d.toISOString().slice(0,10);}
function weekday(iso){return new Date(iso+'T00:00:00Z').getUTCDay();} // 0=Sun

// Day/week phrases -> an inclusive [from,to] range. Months fall back to the
// existing month parser. null means no date was asked for.
export function dateRangeFor(question,todayISO){
 const q=question.toLowerCase();
 if(/\b(today|tonight|this (morning|afternoon|evening))\b/.test(q))return {from:todayISO,to:todayISO,label:'today'};
 if(/\btomorrow\b/.test(q)){const t=addDays(todayISO,1);return {from:t,to:t,label:'tomorrow'};}
 const toSunday=(7-weekday(todayISO))%7;
 if(/\bthis weekend\b|\bweekend\b/.test(q)){const sat=addDays(todayISO,(6-weekday(todayISO)+7)%7);const from=weekday(todayISO)===0?todayISO:sat;return {from,to:addDays(todayISO,toSunday),label:'this weekend'};}
 if(/\bnext week\b/.test(q)){const mon=addDays(todayISO,toSunday+1);return {from:mon,to:addDays(mon,6),label:'next week'};}
 if(/\b(this week|rest of the week)\b/.test(q))return {from:todayISO,to:addDays(todayISO,toSunday),label:'this week'};
 const my=parseMonthYear(question,todayISO);
 if(my){const mm=String(my.month).padStart(2,'0');const start=`${my.year}-${mm}-01`;const next=my.month===12?`${my.year+1}-01-01`:`${my.year}-${String(my.month+1).padStart(2,'0')}-01`;return {from:start,to:addDays(next,-1),label:'month'};}
 return null;
}

const STOP=new Set(['the','a','an','is','are','what','whats','which','any','anything','there','events','event','going','on','in','at','for','of','to','this','that','today','tonight','tomorrow','week','weekend','next','happening','me','show','find','i','my','can','do','does','be','will','some','with','and','or','mba','mstc','building','hall','ut','campus']);
function topicWords(question,loc){
 const locWords=new Set((loc?loc.aliases:[]).flatMap(a=>norm(a).trim().split(' ')));
 return [...new Set(norm(question).trim().split(' ').filter(w=>w.length>2&&!STOP.has(w)&&!locWords.has(w)))];
}

/**
 * Returns null when this isn't an event question, otherwise
 * {location, range, scope, events} with at most `limit` events, soonest first.
 * programKey: the effective program (pages.mjs key) or null.
 * pools: event pools by program (defaults to events.mjs; injectable for tests).
 */
export function searchEvents(question,todayISO,{programKey=null,limit=15,pools=events}={}){
 if(!isEventQuestion(question))return null;
 const location=detectLocation(question);
 const range=dateRangeFor(question,todayISO);
 const programPool=!location&&programKey&&pages[programKey]?.eventsKey?pools[pages[programKey].eventsKey]:null;
 const pool=programPool||mergeProgramEvents(pools.mba||[],pools.mstc||[],pools.general||[],pools.engineering||[]);
 let list=pool.filter(e=>(e.endDate||e.date)>=(range?range.from:todayISO));
 if(range)list=list.filter(e=>e.date<=range.to);
 if(location)list=list.filter(e=>eventAt(e,location));
 // Topic words ("pitch", "networking", "blood drive") rank matches first but
 // never filter, so an odd word can't hide every event.
 const words=topicWords(question,location);
 const stem=w=>w.length>4?w.replace(/(es|s)$/,''):w;
 const score=e=>{const t=norm(e.title+' '+(e.desc||''));return words.filter(w=>t.includes(' '+stem(w))).length;};
 list=list.map(e=>({e,s:score(e)})).sort((a,b)=>b.s-a.s||a.e.date.localeCompare(b.e.date)).slice(0,limit).map(x=>x.e)
  .sort((a,b)=>a.date.localeCompare(b.date));
 return {
  location:location?location.name:null,
  range,
  scope:programPool?pages[programKey].label:'all Longhorn Links programs and campus-wide events',
  events:list.map(e=>({title:e.title,date:e.date,endDate:e.endDate,dateLabel:e.dateLabel,time:e.time,where:e.where,desc:e.desc,
   program:(PROGRAM_INFO[e.program]||{}).label||e.program,cite:(PROGRAM_INFO[e.program]||{}).cite||''}))
 };
}
// Words the forced-web-search check should treat as covered once an event
// search ran (place names and event titles are answered by this data).
export function eventSearchWords(result){
 if(!result)return [];
 const loc=LOCATIONS.find(l=>l.name===result.location);
 return ['events event going happening activities',...(loc?loc.aliases:[]),...result.events.map(e=>e.title+' '+(e.where||'')+' '+(e.desc||''))];
}
