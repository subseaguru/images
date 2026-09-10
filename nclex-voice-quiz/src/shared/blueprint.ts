/**
 * NCLEX-RN Test Plan blueprint (effective April 2026).
 *
 * The 2026 plan keeps the 2023 Client Needs structure and percentage ranges; it is built on the
 * NCSBN 2024 RN Practice Analysis. The eight subcategories below are the content areas the exam
 * samples from, and the percentages are the share of scored items each contributes. These data
 * drive question selection (so a mixed quiz mirrors the exam) and question generation (so Claude
 * writes to the same activity statements the exam tests).
 *
 * Shared between server and browser: keep it free of Node/DOM APIs.
 */
import type { Blueprint, BlueprintCategory, CategoryId, ClinicalJudgmentStep } from "./types.js";
import { CATEGORY_IDS } from "./types.js";

export const NCLEX_RN_BLUEPRINT: Blueprint = {
  name: "NCLEX-RN Test Plan",
  effective: "April 2026 through March 2029",
  source: "NCSBN, 2026 NCLEX-RN Test Plan (based on the 2024 RN Practice Analysis)",
  examFormat:
    "Computerized adaptive test of 85 to 150 items (15 are unscored pretest items) with a 5-hour time " +
    "limit. Items include Next Generation NCLEX case studies (six items each following one client " +
    "through the six clinical-judgment steps) and standalone items: multiple choice, multiple response " +
    "(select all that apply / select N), matrix, drag-and-drop, drop-down (cloze), highlight, bow-tie " +
    "and trend items. This app practices the underlying content with spoken three-option (A/B/C) " +
    "multiple-choice questions.",
  categories: [
    {
      id: "management_of_care",
      name: "Management of Care",
      group: "Safe and Effective Care Environment",
      minPercent: 15,
      maxPercent: 21,
      description:
        "The nurse provides and directs nursing care that enhances the care delivery setting in order to " +
        "protect the client and health care personnel.",
      activityStatements: [
        "Advance Directives/Self-Determination/Life Planning",
        "Advocacy",
        "Assignment, Delegation and Supervision",
        "Case Management",
        "Client Rights",
        "Collaboration with Multidisciplinary Team",
        "Concepts of Management",
        "Confidentiality/Information Security",
        "Continuity of Care",
        "Establishing Priorities",
        "Ethical Practice",
        "Informed Consent",
        "Information Technology",
        "Legal Rights and Responsibilities",
        "Performance Improvement (Quality Improvement)",
        "Referrals",
      ],
    },
    {
      id: "safety_and_infection_control",
      name: "Safety and Infection Control",
      group: "Safe and Effective Care Environment",
      minPercent: 10,
      maxPercent: 16,
      description:
        "The nurse protects clients and health care personnel from health and environmental hazards.",
      activityStatements: [
        "Accident/Error/Injury Prevention",
        "Emergency Response Plan",
        "Ergonomic Principles",
        "Handling Hazardous and Infectious Materials",
        "Home Safety",
        "Reporting of Incident/Event/Irregular Occurrence/Variance",
        "Safe Use of Equipment",
        "Security Plan",
        "Standard Precautions/Transmission-Based Precautions/Surgical Asepsis",
        "Use of Restraints/Safety Devices",
      ],
    },
    {
      id: "health_promotion_and_maintenance",
      name: "Health Promotion and Maintenance",
      group: "Health Promotion and Maintenance",
      minPercent: 6,
      maxPercent: 12,
      description:
        "The nurse provides and directs nursing care of the client that incorporates knowledge of expected " +
        "growth and development, prevention and early detection of health problems, and strategies to " +
        "achieve optimal health.",
      activityStatements: [
        "Aging Process",
        "Ante/Intra/Postpartum and Newborn Care",
        "Developmental Stages and Transitions",
        "Health Promotion/Disease Prevention",
        "Health Screening",
        "High Risk Behaviors",
        "Lifestyle Choices",
        "Self-Care",
        "Techniques of Physical Assessment",
      ],
    },
    {
      id: "psychosocial_integrity",
      name: "Psychosocial Integrity",
      group: "Psychosocial Integrity",
      minPercent: 6,
      maxPercent: 12,
      description:
        "The nurse provides and directs nursing care that promotes and supports the emotional, mental and " +
        "social well-being of the client experiencing stressful events, as well as clients with acute or " +
        "chronic mental illness.",
      activityStatements: [
        "Abuse/Neglect",
        "Behavioral Interventions",
        "Coping Mechanisms",
        "Crisis Intervention",
        "Cultural Awareness/Cultural Influences on Health",
        "End of Life Care",
        "Family Dynamics",
        "Grief and Loss",
        "Mental Health Concepts",
        "Religious and Spiritual Influences on Health",
        "Sensory/Perceptual Alterations",
        "Stress Management",
        "Substance Use Disorders/Dependencies",
        "Support Systems",
        "Therapeutic Communication",
        "Therapeutic Environment",
      ],
    },
    {
      id: "basic_care_and_comfort",
      name: "Basic Care and Comfort",
      group: "Physiological Integrity",
      minPercent: 6,
      maxPercent: 12,
      description:
        "The nurse provides comfort to clients and assistance in the performance of activities of daily living.",
      activityStatements: [
        "Assistive Devices",
        "Elimination",
        "Mobility/Immobility",
        "Non-Pharmacological Comfort Interventions",
        "Nutrition and Oral Hydration",
        "Personal Hygiene",
        "Rest and Sleep",
      ],
    },
    {
      id: "pharmacological_and_parenteral_therapies",
      name: "Pharmacological and Parenteral Therapies",
      group: "Physiological Integrity",
      minPercent: 13,
      maxPercent: 19,
      description:
        "The nurse provides care related to the administration of medications and parenteral therapies.",
      activityStatements: [
        "Adverse Effects/Contraindications/Side Effects/Interactions",
        "Blood and Blood Products",
        "Central Venous Access Devices",
        "Dosage Calculation",
        "Expected Actions/Outcomes",
        "Medication Administration",
        "Parenteral/Intravenous Therapies",
        "Pharmacological Pain Management",
        "Total Parenteral Nutrition",
      ],
    },
    {
      id: "reduction_of_risk_potential",
      name: "Reduction of Risk Potential",
      group: "Physiological Integrity",
      minPercent: 9,
      maxPercent: 15,
      description:
        "The nurse reduces the likelihood that clients will develop complications or health problems related " +
        "to existing conditions, treatments or procedures.",
      activityStatements: [
        "Changes/Abnormalities in Vital Signs",
        "Diagnostic Tests",
        "Laboratory Values",
        "Potential for Alterations in Body Systems",
        "Potential for Complications of Diagnostic Tests/Treatments/Procedures",
        "Potential for Complications from Surgical Procedures and Health Alterations",
        "System Specific Assessments",
        "Therapeutic Procedures",
      ],
    },
    {
      id: "physiological_adaptation",
      name: "Physiological Adaptation",
      group: "Physiological Integrity",
      minPercent: 11,
      maxPercent: 17,
      description:
        "The nurse manages and provides care for clients with acute, chronic or life-threatening physical " +
        "health conditions.",
      activityStatements: [
        "Alterations in Body Systems",
        "Fluid and Electrolyte Imbalances",
        "Hemodynamics",
        "Illness Management",
        "Medical Emergencies",
        "Pathophysiology",
        "Unexpected Response to Therapies",
      ],
    },
  ],
  integratedProcesses: [
    "Caring",
    "Clinical Judgment",
    "Communication and Documentation",
    "Culture and Spirituality",
    "Nursing Process (Assessment, Analysis, Planning, Implementation, Evaluation)",
    "Teaching/Learning",
  ],
  clinicalJudgmentSteps: [
    {
      id: "recognize_cues",
      name: "Recognize Cues",
      description:
        "Identify relevant and important information from different sources (history, assessment findings, " +
        "vital signs, laboratory results, the environment).",
    },
    {
      id: "analyze_cues",
      name: "Analyze Cues",
      description:
        "Organize and link the recognized cues to the client's clinical presentation; decide what the cues " +
        "mean and which are most concerning.",
    },
    {
      id: "prioritize_hypotheses",
      name: "Prioritize Hypotheses",
      description:
        "Evaluate and rank possible explanations by urgency, likelihood, risk, difficulty and time.",
    },
    {
      id: "generate_solutions",
      name: "Generate Solutions",
      description:
        "Identify expected outcomes and the set of interventions (including what to avoid) that could " +
        "achieve them.",
    },
    {
      id: "take_action",
      name: "Take Action",
      description:
        "Implement the solution(s) that address the highest priority: the action, how, when, and by whom.",
    },
    {
      id: "evaluate_outcomes",
      name: "Evaluate Outcomes",
      description:
        "Compare observed outcomes against expected outcomes and decide whether the plan is working.",
    },
  ],
};

/** Short id prefixes used for bundled question ids, e.g. `moc-001`. */
export const CATEGORY_PREFIX: Record<CategoryId, string> = {
  management_of_care: "moc",
  safety_and_infection_control: "sic",
  health_promotion_and_maintenance: "hpm",
  psychosocial_integrity: "psi",
  basic_care_and_comfort: "bcc",
  pharmacological_and_parenteral_therapies: "ppt",
  reduction_of_risk_potential: "rrp",
  physiological_adaptation: "pa",
};

const BY_ID: Map<CategoryId, BlueprintCategory> = new Map(
  NCLEX_RN_BLUEPRINT.categories.map((c) => [c.id, c]),
);

export function isCategoryId(value: unknown): value is CategoryId {
  return typeof value === "string" && (CATEGORY_IDS as readonly string[]).includes(value);
}

export function getCategory(id: CategoryId): BlueprintCategory {
  const category = BY_ID.get(id);
  if (!category) throw new Error(`Unknown category: ${id}`);
  return category;
}

export function categoryName(id: CategoryId): string {
  return getCategory(id).name;
}

/** Midpoint of the subcategory's percentage range; the eight midpoints sum to 100. */
export function categoryMidpoint(id: CategoryId): number {
  const c = getCategory(id);
  return (c.minPercent + c.maxPercent) / 2;
}

export function clinicalJudgmentStepName(id: ClinicalJudgmentStep): string {
  return NCLEX_RN_BLUEPRINT.clinicalJudgmentSteps.find((s) => s.id === id)?.name ?? id;
}

/**
 * Split `count` items across categories in proportion to the blueprint midpoints, using the
 * largest-remainder method so the parts always sum to `count`. When `categories` is given, only
 * those categories receive items (still weighted relative to each other).
 */
export function blueprintDistribution(
  count: number,
  categories?: readonly CategoryId[],
): Record<CategoryId, number> {
  const chosen: CategoryId[] =
    categories && categories.length > 0 ? [...new Set(categories)] : [...CATEGORY_IDS];
  const result = Object.fromEntries(CATEGORY_IDS.map((id) => [id, 0])) as Record<CategoryId, number>;
  if (count <= 0) return result;
  const totalWeight = chosen.reduce((sum, id) => sum + categoryMidpoint(id), 0);
  const exact = chosen.map((id) => ({ id, share: (count * categoryMidpoint(id)) / totalWeight }));
  let assigned = 0;
  for (const e of exact) {
    const whole = Math.floor(e.share);
    result[e.id] = whole;
    assigned += whole;
  }
  const byRemainder = [...exact].sort((a, b) => b.share - Math.floor(b.share) - (a.share - Math.floor(a.share)));
  let i = 0;
  while (assigned < count) {
    const next = byRemainder[i % byRemainder.length];
    if (!next) break;
    result[next.id] += 1;
    assigned += 1;
    i += 1;
  }
  return result;
}
