// Registry of Longhorn Links' specialized program/department pages. This is the
// single place that teaches page-aware retrieval about a new page: adding one
// entry here (and, if it has its own event feed, a matching key in events.mjs)
// is enough for lhl-chat.mjs to prioritize that page's content - no new code
// path or hardcoded prompt per page.
//
// Keyed by the same string the frontend sends as `audience` (see ask/index.html) -
// this repo's chat has no separate per-page embed, so the existing
// audience/program selector already doubles as the "selected page" signal for
// this feature. `eligibilityAudience` is what catalog audience checks
// (allows()/eligibleCatalog() in lhl-chat.mjs) should use instead of the raw key,
// since a page can be a narrower slice of a broader eligibility bucket (MBA
// Entrepreneurship is still an MBA audience for eligibility purposes, just a
// different page for retrieval priority).
export const pages = {
 mstc: {
  label: 'MSTC',
  eligibilityAudience: 'mstc',
  catalogSources: ['MSTC'],
  url: 'https://longhornlinks.com/mstc',
  eventsKey: 'mstc',
  calendarUrl: 'https://longhornlinks.com/mstc#opportunities',
  calendarLabel: 'the MSTC event calendar on the MSTC page'
 },
 mba: {
  label: 'MBA',
  eligibilityAudience: 'mba',
  catalogSources: ['MBA'],
  url: 'https://longhornlinks.com/mba',
  eventsKey: null,
  calendarUrl: 'https://longhornlinks.com/mba',
  calendarLabel: 'the MBA page'
 },
 mbae: {
  label: 'MBA Entrepreneurship',
  eligibilityAudience: 'mba',
  catalogSources: ['MBA'],
  url: 'https://longhornlinks.com/mbae',
  eventsKey: 'mbae',
  calendarUrl: 'https://longhornlinks.com/mbae',
  calendarLabel: 'the Events tile on the MBA Entrepreneurship page'
 },
 engineering: {
  label: 'Engineering',
  eligibilityAudience: 'engineering',
  catalogSources: ['Mechanical Engineering'],
  url: 'https://longhornlinks.com/mechanical-engineering',
  eventsKey: null,
  calendarUrl: 'https://longhornlinks.com/mechanical-engineering',
  calendarLabel: 'the Mechanical Engineering page'
 }
};
export function pageFor(key){return pages[key]||null;}
// Explicit-override detection: a question naming campus-wide scope, or naming a
// *different* program than the one selected, should search that scope instead -
// never force a differently-scoped request into the selected page's context.
const CAMPUS_WIDE_RE=/\bcampus[- ]wide\b|\ball (?:of )?campus\b|\bevery(?:thing|where) (?:on|at) campus\b/i;
// Ordered most specific to least specific, and checked in order so a more
// specific match (e.g. "mbae") wins over a less specific one that's also
// textually present (e.g. "mba", a substring of "mba entrepreneurship").
const PROGRAM_NAME_CHECKS=[
 ['mbae', /\bmba entrepreneurship\b|\bmbae\b/i],
 ['mstc', /\bmstc\b/i],
 ['engineering', /\b(cockrell|mechanical engineering|meche)\b/i],
 ['mba', /\bmba\b/i]
];
export function effectivePage(question, selectedPageKey){
 if(CAMPUS_WIDE_RE.test(question))return null;
 for(const [key,re] of PROGRAM_NAME_CHECKS){
  if(!re.test(question))continue;
  if(key===selectedPageKey)return selectedPageKey;
  // A bare "mba" mention is not a signal to leave the more specific mbae page -
  // every MBA Entrepreneurship question legitimately mentions "MBA" too.
  if(key==='mba'&&selectedPageKey==='mbae')return selectedPageKey;
  if(pages[key])return key;
 }
 return selectedPageKey && pages[selectedPageKey] ? selectedPageKey : null;
}
