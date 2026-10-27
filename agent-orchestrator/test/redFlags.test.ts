import { describe, expect, it } from "vitest";
import { RED_FLAG_CATEGORIES, type RedFlagCategory } from "../src/contracts.js";
import { detectRedFlags, EMERGENCY_NOTICE, normalize } from "../src/safety/redFlags.js";

/**
 * Golden set. Recall on this list must stay at 100%: if a phrase here stops matching, the safety
 * gate has regressed. Add phrases freely; never delete one to make a change pass.
 */
const GOLDEN: Record<RedFlagCategory, string[]> = {
  chest_pain: [
    "I have chest pain",
    "My chest hurts when I walk upstairs",
    "there is a crushing pressure in my chest",
    "i think i'm having a heart attack",
    "Chest tightness since this morning!",
    "It feels like my chest is tight and heavy",
    "sharp pain across my chest",
  ],
  stroke_signs: [
    "I think I'm having a stroke",
    "My speech is slurred, slurred speech since an hour",
    "my face is drooping on one side",
    "I can't lift my arm",
    "cant move my leg",
    "sudden weakness in my left side",
    "this is the worst headache of my life",
    "Suddenly confusion and trouble speaking",
  ],
  breathing_difficulty: [
    "I can't breathe",
    "cant breathe properly",
    "I'm short of breath even sitting still",
    "shortness of breath and wheezing",
    "I have difficulty breathing",
    "my son is choking",
    "she stopped breathing",
    "I can’t catch my breath",
  ],
  severe_bleeding: [
    "I'm bleeding heavily from my leg",
    "severe bleeding that won't stop",
    "the cut won't stop bleeding",
    "I am vomiting blood",
    "coughing up blood this morning",
    "Heavy bleeding after the procedure",
  ],
  suicidal_ideation: [
    "I want to kill myself",
    "I've been thinking about suicide",
    "I don't want to live anymore",
    "I want to die",
    "thinking of ending my life",
    "I might hurt myself tonight",
    "Self-harm thoughts again",
  ],
  anaphylaxis: [
    "I think it's anaphylaxis",
    "my throat is closing after the injection",
    "my tongue is swelling up",
    "swollen lips and hives all over",
    "I had a severe allergic reaction to the antibiotic",
    "I used my epipen",
  ],
  loss_of_consciousness: [
    "my husband passed out in the kitchen",
    "I fainted this morning",
    "she collapsed and is unresponsive",
    "he is unconscious",
    "I think she had a seizure",
    "he won't wake up",
    "Loss of consciousness for a few seconds",
  ],
};

/** Everyday phrases that must not fire. Not a promise of zero false positives, just a sanity check. */
const BENIGN = [
  "I have a mild headache since yesterday",
  "I would like to book an appointment with cardiology",
  "My knee hurts when I climb the stairs",
  "Can you tell me my appointment time?",
  "I have a sore throat and a runny nose",
  "I feel a bit tired this week",
  "I need to refill my blood pressure medication",
  "Could I move my appointment to Friday?",
];

describe("red-flag golden set", () => {
  for (const category of RED_FLAG_CATEGORIES) {
    describe(category, () => {
      for (const phrase of GOLDEN[category]) {
        it(`flags: ${phrase}`, () => {
          expect(detectRedFlags(phrase)).toContain(category);
        });
      }
    });
  }

  it("has at least five phrases for every category", () => {
    for (const category of RED_FLAG_CATEGORIES) {
      expect(GOLDEN[category].length).toBeGreaterThanOrEqual(5);
    }
  });

  it("reaches 100% recall over the whole set", () => {
    const all = RED_FLAG_CATEGORIES.flatMap((category) =>
      GOLDEN[category].map((phrase) => ({ category, phrase })),
    );
    const missed = all.filter(({ category, phrase }) => !detectRedFlags(phrase).includes(category));
    expect(missed).toEqual([]);
  });
});

describe("benign phrases", () => {
  for (const phrase of BENIGN) {
    it(`does not flag: ${phrase}`, () => {
      expect(detectRedFlags(phrase)).toEqual([]);
    });
  }
});

describe("detection behaviour", () => {
  it("is case, punctuation and accent insensitive", () => {
    expect(detectRedFlags("CHEST—PAIN!!!")).toContain("chest_pain");
    expect(detectRedFlags("Chést pain")).toContain("chest_pain");
  });

  it("ignores negation on purpose and escalates anyway", () => {
    expect(detectRedFlags("I do not have chest pain")).toContain("chest_pain");
  });

  it("reports several categories at once", () => {
    expect(detectRedFlags("chest pain and I can't breathe")).toEqual([
      "chest_pain",
      "breathing_difficulty",
    ]);
  });

  it("returns nothing for empty input", () => {
    expect(detectRedFlags("")).toEqual([]);
    expect(detectRedFlags("   ")).toEqual([]);
  });

  it("normalizes curly apostrophes", () => {
    expect(normalize("I can’t breathe")).toBe("i can't breathe");
  });

  it("has an emergency notice that names an emergency number", () => {
    expect(EMERGENCY_NOTICE).toMatch(/911/);
  });
});
