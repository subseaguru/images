/**
 * Best-effort keyword classifier for questions that arrive without an NCLEX category.
 *
 * Question sets written by other tools (ChatGPT, a spreadsheet, a study group) usually carry the
 * question and the answer but no NCLEX classification. Rather than reject them or dump them all in
 * one category, the importer guesses from the wording so the bank stays roughly balanced, and
 * flags the question `needsReview` so the guess is never mistaken for a curated label.
 *
 * The guess is deliberately simple and explainable: weighted keyword hits, first match wins ties in
 * blueprint order. "Enrich with Claude" replaces it with a considered classification.
 */
import type { CategoryId } from "../../shared/types.js";

/** Terms that point at a category, strongest first. Matched case-insensitively on word boundaries. */
const KEYWORDS: Record<CategoryId, string[]> = {
  management_of_care: [
    "delegate", "delegation", "assign", "assignment", "supervis", "which client should the nurse see first",
    "prioriti", "advance directive", "living will", "informed consent", "confidential", "hipaa",
    "advocacy", "advocate", "case manage", "referral", "scope of practice", "chain of command",
    "incident report to the manager", "charge nurse", "unlicensed assistive", "interpreter",
    "quality improvement", "ethical", "power of attorney", "discharge planning",
  ],
  safety_and_infection_control: [
    "precaution", "isolation", "personal protective", "ppe", "n95", "hand hygiene", "sterile",
    "asepsis", "restraint", "safety device", "fall", "fire", "rapid response", "disaster",
    "triage", "hazard", "spill", "sharps", "needlestick", "bed alarm", "identification band",
    "two identifiers", "security", "abduction", "car seat", "poison", "smoke detector", "oxygen safety",
  ],
  health_promotion_and_maintenance: [
    "screening", "immuniz", "vaccin", "well-child", "developmental", "milestone", "growth chart",
    "prenatal", "antepartum", "postpartum", "newborn", "breastfeed", "lactation", "menopause",
    "health promotion", "prevention", "exercise", "diet teaching for a healthy", "self-care",
    "aging", "puberty", "family planning", "contracept", "mammogram", "colonoscopy",
  ],
  psychosocial_integrity: [
    "therapeutic communication", "which response by the nurse is most therapeutic", "anxiety",
    "depress", "suicid", "grief", "bereave", "coping", "crisis", "abuse", "neglect", "violence",
    "substance use", "withdrawal from alcohol", "hallucination", "delusion", "psychiatric",
    "mental health", "bipolar", "schizophren", "end of life", "hospice", "spiritual", "cultural",
    "restraint-free behavioral", "de-escalat", "support group",
  ],
  basic_care_and_comfort: [
    "activities of daily living", "hygiene", "bathing", "ambulat", "crutch", "walker", "cane",
    "transfer", "range of motion", "pressure injury", "repositioning", "constipation", "ostomy",
    "catheter care", "incontinen", "enteral feeding", "nutrition", "aspiration precautions while eating",
    "sleep", "rest", "nonpharmacologic", "heat and cold", "massage", "positioning for comfort",
  ],
  pharmacological_and_parenteral_therapies: [
    "medication", "dose", "dosage", "milligram", "administer", "intravenous", "iv push", "infusion",
    "drip rate", "insulin", "heparin", "warfarin", "digoxin", "opioid", "morphine", "antibiotic",
    "adverse effect", "side effect", "drug interaction", "blood transfusion", "central line",
    "total parenteral nutrition", "patient-controlled analgesia", "peak and trough", "pharmac",
  ],
  reduction_of_risk_potential: [
    "laboratory value", "lab result", "diagnostic test", "before the procedure", "after the procedure",
    "postoperative complication", "preoperative", "biopsy", "endoscopy", "catheterization",
    "vital signs change", "monitor for complications", "chest tube", "tracheostomy care",
    "nasogastric tube placement", "potassium level", "creatinine", "prothrombin", "platelet",
    "contrast dye", "informed of the risks", "telemetry", "pulse oximetry",
  ],
  physiological_adaptation: [
    "shock", "sepsis", "hemorrhage", "cardiac arrest", "myocardial infarction", "stroke",
    "respiratory failure", "acidosis", "alkalosis", "fluid and electrolyte", "hyperkalemia",
    "hypokalemia", "hyponatremia", "dehydration", "heart failure exacerbation", "copd exacerbation",
    "diabetic ketoacidosis", "hypoglycemia", "seizure", "increased intracranial pressure", "burn",
    "pathophysiolog", "medical emergency", "unexpected response to therapy", "arrhythmia", "dialysis",
    "heart failure", "shortness of breath", "dyspnea", "oxygen saturation", "respiratory distress",
    "chest pain", "pulmonary edema", "crackles", "hypotension", "hypoxia", "bradycardia", "tachycardia",
  ],
};

const ORDER = Object.keys(KEYWORDS) as CategoryId[];

export interface ClassifyResult {
  category: CategoryId;
  /** Number of keyword hits behind the guess; 0 means nothing matched and the default was used. */
  score: number;
  matched: string[];
}

/**
 * Guesses the category of a question from its stem and option texts. Always returns a category
 * (the caller flags the question for review); `score === 0` means it was a pure fallback.
 */
export function classifyQuestion(stem: string, optionTexts: readonly string[] = []): ClassifyResult {
  const haystack = [stem, ...optionTexts].join("\n").toLowerCase();
  let best: ClassifyResult = { category: "management_of_care", score: 0, matched: [] };
  for (const category of ORDER) {
    const matched: string[] = [];
    for (const term of KEYWORDS[category]) {
      if (haystack.includes(term)) matched.push(term);
    }
    // Longer phrases are stronger evidence than single words.
    const score = matched.reduce((sum, term) => sum + (term.includes(" ") ? 2 : 1), 0);
    if (score > best.score) best = { category, score, matched };
  }
  return best;
}
