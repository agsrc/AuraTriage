import { RED_FLAG_CATEGORIES, type RedFlagCategory } from "../contracts.js";

/**
 * Deterministic red-flag detection. It runs before any LLM call, needs no network, and errs on
 * the side of escalating: it does not try to understand negation ("I do not have chest pain" still
 * matches). A false positive costs a nurse a minute; a miss can cost a life.
 *
 * The pattern list is clinical content. It needs clinical review before any real use.
 */
const PATTERNS: Record<RedFlagCategory, readonly RegExp[]> = {
  chest_pain: [
    /\bchest (pain|pains|tightness|pressure|discomfort|hurts?|aches?|is (tight|heavy)|feels (tight|heavy))\b/,
    /\b(pain|pressure|tightness|crushing|squeezing|heaviness) (in|on|across|around) (my |the )?chest\b/,
    /\bheart attack\b/,
    /\btight chest\b/,
    /\bangina\b/,
  ],
  stroke_signs: [
    /\bstroke\b/,
    /\bslurred speech\b/,
    /\bslurring (my )?words\b/,
    /\b(face|facial) (is |feels |has )?(droop\w*|numb\w*)\b/,
    /\bsudden(ly)? (weakness|numbness|confusion|trouble (speaking|seeing|walking)|vision loss|loss of vision|severe headache)\b/,
    /\bworst headache of my life\b/,
    /\b(can'?t|cannot|unable to) (move|lift|feel) (my )?(arm|leg|face|hand)\b/,
    /\b(weakness|numbness) (on|in) (one|my left|my right)( side)?\b/,
    /\bone sided weakness\b/,
  ],
  breathing_difficulty: [
    /\b(can'?t|cannot|unable to|struggling to|hard to|difficult to) breathe\b/,
    /\b(can'?t|cannot) catch (my )?breath\b/,
    /\b(shortness|short) of breath\b/,
    /\b(difficulty|trouble|struggling) breathing\b/,
    /\bgasping( for (air|breath))?\b/,
    /\bchoking\b/,
    /\b(stopped|not) breathing\b/,
    /\bturning blue\b/,
  ],
  severe_bleeding: [
    /\b(severe|heavy|massive|uncontrolled|profuse) (bleeding|blood loss)\b/,
    /\bbleeding (heavily|badly|a lot|profusely|won'?t stop|will not stop|through|everywhere)\b/,
    /\b(won'?t|will not|doesn'?t|does not) stop bleeding\b/,
    /\bcan'?t stop (the )?bleeding\b/,
    /\b(coughing|vomiting|throwing up|spitting) (up )?blood\b/,
    /\bblood (is )?(pouring|gushing|spurting)\b/,
  ],
  suicidal_ideation: [
    /\bsuicid\w*\b/,
    /\bkill myself\b/,
    /\b(end|ending|take|taking) (my own |my )?life\b/,
    /\bend it all\b/,
    /\b(want|wish|going) to die\b/,
    /\bwant to be dead\b/,
    /\b(don'?t|do not) want to (live|be alive|be here)( anymore)?\b/,
    /\bself harm\b/,
    /\b(hurt|harm|cut) myself\b/,
    /\bbetter off (dead|without me)\b/,
  ],
  anaphylaxis: [
    /\banaphyla\w*\b/,
    /\b(throat|tongue|lips|face) (is |are |feels )?(closing|swelling|swollen|tight)\b/,
    /\b(swollen|swelling) (tongue|lips|throat)\b/,
    /\bsevere allergic reaction\b/,
    /\bhives (all over|everywhere)\b/,
    /\bepipen\b/,
  ],
  loss_of_consciousness: [
    /\b(passed out|pass out|passing out|fainted|fainting|blacked out|black out|collapsed|unconscious|unresponsive|not responding)\b/,
    /\b(won'?t|can'?t|cannot) wake( up)?\b/,
    /\bloss of consciousness\b/,
    /\bseizures?\b/,
    /\bconvuls\w+\b/,
  ],
};

/** Lower-cases, strips accents, unifies apostrophes and turns punctuation into spaces. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[‘’`´]/g, "'")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectRedFlags(text: string): RedFlagCategory[] {
  const normalized = normalize(text);
  return RED_FLAG_CATEGORIES.filter((category) =>
    PATTERNS[category].some((pattern) => pattern.test(normalized)),
  );
}

/** Static text shown to the patient the moment a red flag fires. It never waits for the LLM or a nurse. */
export const EMERGENCY_NOTICE =
  "If you think this may be a medical emergency, call your local emergency number now (911 in the US) " +
  "or go to the nearest emergency department. If you are thinking about harming yourself, call or text " +
  "988 (US) or your local crisis line. A nurse has been alerted and will review your message.";
