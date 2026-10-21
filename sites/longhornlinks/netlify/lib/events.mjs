// Internal event/calendar data for Longhorn Links' specialized program pages,
// reused from each page's own structured data (never scraped from rendered HTML).
//
// mstc: copied verbatim from the `events` array inside mstc.html's own inline
//   `DATA` object (the page's actual calendar-panel data source). mstc.html also
//   links out to several "calendar PDFs" (e.g. "MSTC Class of 2027 Program
//   Calendar.pdf") - those are Canvas module-item links that require an
//   MSTC-student Canvas login. This server has no such credentials and must not
//   pretend otherwise, so none of their contents are indexed here; the real,
//   publicly-describable MSTC event data is this `events` array, which the page
//   itself already uses to render its "Event calendar" section (id="opportunities").
// mbae: copied from the literal arguments passed to the `res(date, title, desc,
//   url, cta)` helper inside mbae.html's `topics.events.html` template - the
//   underlying structured values the page's own "Events" tile is built from, not
//   a scrape of rendered text. That tile opens a JS <dialog> with no URL/hash of
//   its own, so `url` is the mbae.html page itself for entries with no link target.
//
// Each event: id, program, title, date (ISO, first occurrence), endDate (ISO,
// only for true multi-day ranges), dateLabel (original display string - kept so
// a two-date or ranged event isn't misrepresented as a single day), year, time,
// where, desc, url (the event's own link, or null if the source page has none),
// kind, cost, source ('page' | 'pdf'), sourceUrl (the internal LHL page/anchor
// this came from), pdfUrl (set only for source:'pdf'), verifiedAt (last time this
// file was hand-synced against the live page - see MAINTENANCE.md for the
// refresh procedure, since there is no build step to automate it).
const MSTC_SOURCE_URL = 'https://longhornlinks.com/mstc#opportunities';
const MBAE_SOURCE_URL = 'https://longhornlinks.com/mbae';
const VERIFIED_AT = '2026-10-21';

export const events = {
 mstc: [
  {id:'mstc-1', program:'mstc', title:'Launch Pad: Startup Pitches & Networking', date:'2026-10-15', endDate:null, dateLabel:'Thursday, October 15, 2026', year:2026, time:'5:00–7:00 PM', where:'STATION Austin · 701 Brazos St.', desc:'An evening of startup pitches and networking with founders, builders, investors, and innovation leaders.', url:'https://stationaustin.org/event/%F0%9F%9A%80-launch-pad/', kind:'Event', cost:'Free', source:'page', sourceUrl:MSTC_SOURCE_URL, pdfUrl:null, verifiedAt:VERIFIED_AT},
  {id:'mstc-2', program:'mstc', title:'Forty Acres Founders Program', date:'2026-10-16', endDate:null, dateLabel:'Friday, October 16, 2026', year:2026, time:'Deadline: October 16', where:'Herb Kelleher Entrepreneurship Center', desc:'Mentorship, seminars, and venture-building support for UT student entrepreneurs. Explore customer discovery, product-market fit, MVP testing, and startup strategy.', url:'https://herbkellehercenter.mccombs.utexas.edu/faf/', kind:'Application deadline', cost:'', source:'page', sourceUrl:MSTC_SOURCE_URL, pdfUrl:null, verifiedAt:VERIFIED_AT},
  {id:'mstc-3', program:'mstc', title:'Nucleate Activator', date:'2026-10-20', endDate:null, dateLabel:'Tuesday, October 20, 2026', year:2026, time:'Deadline: October 20', where:'Biotech, life sciences & healthcare innovation', desc:'An equity-free accelerator for early-stage biotech founders, with team formation, venture-building workshops, mentorship, and pitch showcases.', url:'https://www.nucleate.org/', kind:'Application deadline', cost:'', source:'page', sourceUrl:MSTC_SOURCE_URL, pdfUrl:null, verifiedAt:VERIFIED_AT},
  {id:'mstc-4', program:'mstc', title:'FIESTA Austin Startup Pitch & Networking Night', date:'2026-10-20', endDate:null, dateLabel:'Tuesday, October 20, 2026', year:2026, time:'5:30–8:30 PM', where:'STATION Austin · 701 Brazos St.', desc:'Meet founders, investors, entrepreneurs, and startup professionals. Discover early-stage ventures and hear founder pitches.', url:'https://stationaustin.org/event/fiesta-community-meetup/', kind:'Event', cost:'', source:'page', sourceUrl:MSTC_SOURCE_URL, pdfUrl:null, verifiedAt:VERIFIED_AT},
  {id:'mstc-5', program:'mstc', title:'Austin Tech Week', date:'2026-10-26', endDate:'2026-10-30', dateLabel:'Monday–Friday, October 26–30, 2026', year:2026, time:'Five days of programming', where:'Various locations throughout Austin', desc:'Workshops, founder discussions, investor networking, startup showcases, and emerging technology programming across Austin.', url:'https://www.austintech.com/', kind:'Save the date', cost:'', source:'page', sourceUrl:MSTC_SOURCE_URL, pdfUrl:null, verifiedAt:VERIFIED_AT},
  {id:'mstc-6', program:'mstc', title:'Impact Chat: From Semiconductors to Sustainability', date:'2026-10-27', endDate:null, dateLabel:'Tuesday, October 27, 2026', year:2026, time:'5:30–7:15 PM', where:'RRH Crum Auditorium · UT Austin', desc:'Dr. Alyson Freeman of Dell Technologies and GSLI Managing Director RoseAnne Franco discuss AI, sustainable innovation, and environmental challenges.', url:'https://www.eventbrite.com/e/impact-chat-from-semiconductors-to-sustainability-with-alyson-freeman-tickets-1992606998171', kind:'Event', cost:'', source:'page', sourceUrl:MSTC_SOURCE_URL, pdfUrl:null, verifiedAt:VERIFIED_AT},
  {id:'mstc-7', program:'mstc', title:'AITX Community Monthly Meetup', date:'2026-10-27', endDate:null, dateLabel:'Tuesday, October 27, 2026', year:2026, time:'5:30–7:30 PM', where:'Antler VC · 800 Brazos St., Suite 340', desc:'Part of Austin Tech Week: meet AI entrepreneurs and engineers, see real-world AI demonstrations, and explore emerging products.', url:'https://www.austintech.com/agenda', kind:'Event', cost:'', source:'page', sourceUrl:MSTC_SOURCE_URL, pdfUrl:null, verifiedAt:VERIFIED_AT},
  {id:'mstc-8', program:'mstc', title:'Activate Fellowship · Cohort 2027', date:'2026-10-30', endDate:null, dateLabel:'Friday, October 30, 2026', year:2026, time:'Deadline: October 30', where:'Deep tech, energy, materials, robotics, computing & life sciences', desc:'A two-year fellowship supporting scientists and engineers who want to turn breakthrough research into companies. Review eligibility and program details.', url:'https://activate.org/the-fellowship/', kind:'Application deadline', cost:'', source:'page', sourceUrl:MSTC_SOURCE_URL, pdfUrl:null, verifiedAt:VERIFIED_AT}
 ],
 mbae: [
  {id:'mbae-1', program:'mbae', title:'Entrepreneurship Concentration Bid Days', date:'2026-10-27', endDate:null, dateLabel:'October 27 and 29, 2026', year:2026, time:'', where:'', desc:'Bid into the Full-Time MBA concentration.', url:null, kind:'Deadline', cost:'', source:'page', sourceUrl:MBAE_SOURCE_URL, pdfUrl:null, verifiedAt:VERIFIED_AT},
  {id:'mbae-2', program:'mbae', title:'Startup Consulting Practicum deadline', date:'2026-11-01', endDate:null, dateLabel:'Nov 1, 2026', year:2026, time:'', where:'', desc:'Application-based MAN 385 practicum.', url:'https://www.mccombs.utexas.edu/centers-initiatives/brumley-institute/startup-practicum/Full', kind:'Deadline', cost:'', source:'page', sourceUrl:MBAE_SOURCE_URL, pdfUrl:null, verifiedAt:VERIFIED_AT},
  {id:'mbae-3', program:'mbae', title:'TVLIC application deadline', date:'2026-11-08', endDate:null, dateLabel:'Nov 8, 2026', year:2026, time:'', where:'', desc:'Application deadline for the Texas Venture Labs Investment Competition.', url:'https://www.mccombs.utexas.edu/centers-initiatives/brumley-institute/tvl-investment-competition/', kind:'Deadline', cost:'', source:'page', sourceUrl:MBAE_SOURCE_URL, pdfUrl:null, verifiedAt:VERIFIED_AT},
  {id:'mbae-4', program:'mbae', title:'Texas Venture Labs Investment Competition', date:'2026-12-11', endDate:null, dateLabel:'Dec 11, 2026', year:2026, time:'', where:'', desc:'Graduate student venture pitches and investor feedback.', url:'https://www.mccombs.utexas.edu/centers-initiatives/brumley-institute/tvl-investment-competition/', kind:'Event', cost:'', source:'page', sourceUrl:MBAE_SOURCE_URL, pdfUrl:null, verifiedAt:VERIFIED_AT}
 ]
};

const MONTH_NAMES=['january','february','march','april','may','june','july','august','september','october','november','december'];
// No month named ("what's coming up") returns null - callers should then show
// the soonest upcoming events rather than filtering to a specific month/year.
export function parseMonthYear(question, todayISO){
 const q=question.toLowerCase();
 const idx=MONTH_NAMES.findIndex(name=>new RegExp('\\b'+name+'\\b').test(q));
 if(idx<0)return null;
 const month=idx+1;
 const yearMatch=q.match(/\b(20\d{2})\b/);
 let year;
 if(yearMatch)year=Number(yearMatch[1]);
 else{
  // No year stated: pick whichever upcoming occurrence is next, so "November"
  // asked in October means this year, but asked in December means next year -
  // never a month that has already passed this year.
  const today=new Date(todayISO+'T00:00:00');
  const todayMonth=today.getMonth()+1,todayYear=today.getFullYear();
  year=month>=todayMonth?todayYear:todayYear+1;
 }
 return {month,year,explicitYear:!!yearMatch};
}
// Matches events whose [date,endDate] range overlaps the requested month/year;
// with no month named, returns every event for the program sorted chronologically
// so the caller can present "what's coming up" without a date filter.
export function eventsForQuestion(programEvents, question, todayISO){
 const monthYear=parseMonthYear(question, todayISO);
 const sorted=programEvents.slice().sort((a,b)=>a.date.localeCompare(b.date));
 if(!monthYear)return {monthYear:null, matches:sorted};
 const monthStart=`${monthYear.year}-${String(monthYear.month).padStart(2,'0')}-01`;
 const next=monthYear.month===12?{y:monthYear.year+1,m:1}:{y:monthYear.year,m:monthYear.month+1};
 const monthEndExclusive=`${next.y}-${String(next.m).padStart(2,'0')}-01`;
 const matches=sorted.filter(e=>e.date<monthEndExclusive && (e.endDate||e.date)>=monthStart);
 return {monthYear, matches};
}
