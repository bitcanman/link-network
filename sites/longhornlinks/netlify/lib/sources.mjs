// Changing facts (dates, deadlines, responsible offices), kept separate from the
// behavioral rules in rules.mjs so one can be updated without touching the other.
// Each entry below was reachability-checked (not content-verified line by line) on
// verifiedAt. Re-check at the start of every long semester at minimum, and whenever
// a deadline-related eval question is flagged pending-verification.
export const sources = {
  academicCalendar: {
    url: 'https://registrar.utexas.edu/calendars',
    note: 'The official academic calendar. Does not contain an individual student\'s personal dates - only university-wide ones (add/drop, holidays, census date).',
    verifiedAt: '2026-10-20',
    refresh: 'At the start of every long semester (fall/spring), and before answering any date-specific registration question.'
  },
  registrationAccess: {
    url: 'https://utdirect.utexas.edu/registrar/ris.WBX',
    note: 'Individual registration access times and holds live only here (RIS), behind UT EID login. There is no single access time that applies to "everyone" - never state one as if it does.',
    verifiedAt: '2026-10-20',
    refresh: 'Reachability only; this is a login-gated personal portal, not a page with content to verify.'
  },
  paymentDeadlines: {
    url: 'https://onestop.utexas.edu/managing-costs/paying-your-tuition/payment-deadlines/',
    personalAccountUrl: 'https://utdirect.utexas.edu/acct/rec/wio/wio_home.WBX',
    note: 'General payment deadline information is here. A specific student\'s current balance and due amount is only in My Tuition Bill (the personalAccountUrl), behind login.',
    verifiedAt: '2026-10-20',
    refresh: 'At the start of every term, before answering a tuition-deadline question.'
  },
  mstcProgramOffice: {
    url: 'https://calendly.com/ian-bidot/office-hours',
    note: 'No public, MSTC-specific handbook or events page exists - MSTC program materials (class calendars, weekend schedules) are distributed per-cohort through Canvas, not a general public URL. This is the responsible-office fallback: use it to acknowledge the gap, not to imply it is the handbook itself.',
    verifiedAt: '2026-10-20',
    refresh: 'Re-check this gap periodically - a public handbook/events page may be added later.'
  }
};
