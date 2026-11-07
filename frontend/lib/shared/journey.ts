export const JOURNEY_STEPS = ["profile", "eligibility", "quote", "review", "complete"] as const;
export type JourneyStep = typeof JOURNEY_STEPS[number];
export function isJourneyStep(value: unknown): value is JourneyStep {
  return typeof value === "string" && JOURNEY_STEPS.some(step => step === value);
}
export function canAdvanceJourney(current: JourneyStep, next: JourneyStep) {
  return JOURNEY_STEPS.indexOf(next) === JOURNEY_STEPS.indexOf(current) + 1;
}
export function journeyDestination(step: JourneyStep) {
  return step === "complete" ? "/dashboard" : "/journey";
}
