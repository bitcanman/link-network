#!/usr/bin/env node
// Chatbot eval runner. Two modes:
//
//   node tests/eval/run-eval.mjs
//     Structural mode (default). Free, fast, fully deterministic. Checks only the
//     "correct resource selection" and "audience/eligibility" dimensions by calling
//     eligibleCatalog()/relevantCatalog()/explicitAudience() directly - no model call,
//     no network, no cost. This is what CI/regression should run.
//
//   node tests/eval/run-eval.mjs --live
//     Drives the real handler() for every question (including multi-turn history),
//     which means it WILL make real OpenAI API calls and spend real money if
//     OPENAI_API_KEY is set in this environment. Never run this without deciding to -
//     it is not wired into `node --test` and nothing in this repo invokes it
//     automatically. Prints each full answer for human review of the
//     factual-support/clarification/clarity dimensions, which require judgment, not
//     string matching - this script deliberately does not auto-grade prose quality.
//
// Reports passed / failed / pending-verification separately. A question whose
// status is 'pending-verification' is never counted as a pass, even if its
// resource-selection check succeeds - the underlying factual claim is still unverified.

import {eligibleCatalog, relevantCatalog, explicitAudience, allows} from '../../netlify/functions/lhl-chat.mjs';
import {questions} from './questions.mjs';

function checkResourceSelection(q) {
  const audience = explicitAudience(q.question) || q.audience || 'everyone';
  const eligible = eligibleCatalog(q.question, audience);
  const relevant = relevantCatalog(q.question, eligible);
  const relevantIds = new Set(relevant.map(l => l.id));
  const eligibleIds = new Set(eligible.map(l => l.id));
  if (!q.expectedResourceId) return {skipped: true, reason: 'no single expected resource id - behavioral-only case, needs --live/human review'};
  if (q.history && q.history.length) return {skipped: true, reason: 'depends on carrying context through conversation history, which only the model does - explicitAudience()/eligibleCatalog() only look at the current question text, so this needs --live/human review, not a structural check'};
  const candidates = [q.expectedResourceId, ...(q.candidateResourceIds || [])];
  const inEligible = candidates.some(id => eligibleIds.has(id));
  const inRelevant = candidates.some(id => relevantIds.has(id));
  return {
    skipped: false,
    inEligible, inRelevant,
    pass: inEligible && inRelevant,
    audience,
    detail: inEligible ? (inRelevant ? 'expected resource is eligible and in the relevant subset sent to the model' : 'expected resource is eligible but the relevance filter dropped it - would not be cited') : 'expected resource is not eligible for this audience at all'
  };
}

function runStructural() {
  const results = {pass: [], fail: [], pendingVerification: [], skipped: []};
  for (const q of questions) {
    const check = checkResourceSelection(q);
    if (check.skipped) { results.skipped.push({q, check}); continue; }
    const bucket = q.status === 'pending-verification' ? 'pendingVerification' : (check.pass ? 'pass' : 'fail');
    results[bucket].push({q, check});
  }
  return results;
}

function printReport(results) {
  console.log(`\nStructural eval: ${questions.length} questions\n`);
  console.log(`  passed:                ${results.pass.length}`);
  console.log(`  failed:                ${results.fail.length}`);
  console.log(`  pending-verification:  ${results.pendingVerification.length}  (resource check may pass, but the underlying fact is not confirmed - never counted as a pass)`);
  console.log(`  skipped (needs --live):${results.skipped.length}\n`);
  if (results.fail.length) {
    console.log('FAILED:');
    for (const {q, check} of results.fail) console.log(`  #${q.id} [${q.category}] "${q.question}" -> ${check.detail}`);
    console.log('');
  }
  if (results.pendingVerification.length) {
    console.log('PENDING VERIFICATION (resource check result shown, but not a pass until the fact is confirmed):');
    for (const {q, check} of results.pendingVerification) console.log(`  #${q.id} [${q.category}] "${q.question}" -> resource check: ${check.pass ? 'ok' : 'FAILED - ' + check.detail} | ${q.notes || ''}`);
    console.log('');
  }
  if (results.skipped.length) {
    console.log('SKIPPED (no single expected resource - behavioral-only, needs --live or human review):');
    for (const {q} of results.skipped) console.log(`  #${q.id} [${q.category}] "${q.question}"`);
    console.log('');
  }
}

async function runLive() {
  const handlerModule = await import('../../netlify/functions/lhl-chat.mjs');
  const handler = handlerModule.default;
  console.log('\nLIVE MODE: this will call the real OpenAI endpoint if OPENAI_API_KEY is set in this environment, and will incur real cost. Proceeding because --live was explicitly passed.\n');
  for (const q of questions) {
    const req = new Request('https://longhornlinks.com/api/lhl-chat', {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Origin: 'https://longhornlinks.com'},
      body: JSON.stringify({question: q.question, audience: q.audience || 'everyone', history: q.history || []})
    });
    try {
      const res = await handler(req);
      const body = await res.json();
      console.log(`#${q.id} [${q.category}] "${q.question}"`);
      console.log(`  status: ${res.status}  audience: ${body.audience || '-'}`);
      if (body.heading) console.log(`  heading: ${body.heading}`);
      if (body.sources) console.log(`  sources: ${body.sources.map(s => s.id).join(', ') || '(none)'}`);
      if (body.error) console.log(`  error: ${body.error}`);
      console.log(`  expected: ${q.expectedResourceId || '(behavioral only)'}  status flag: ${q.status}`);
      console.log('');
    } catch (e) {
      console.log(`#${q.id} [${q.category}] "${q.question}" -> THREW: ${e.message}\n`);
    }
  }
}

const live = process.argv.includes('--live');
if (live) {
  await runLive();
} else {
  printReport(runStructural());
}
