/** Every interactive id this example sends. Template quick replies reuse them as payloads. */

export const LEAD_IDS = {
  book: 'lead:book',
  pricing: 'lead:pricing',
  guide: 'lead:guide',
} as const;

/** Button fallback for the qualification flow: `q:<question>:<answer>`. */
export const QUALIFY_PREFIX = {
  need: 'q:need:',
  size: 'q:size:',
  budget: 'q:budget:',
  timeline: 'q:timeline:',
} as const;

export const MEETING_IDS = {
  slot: 'meeting:slot:',
  reschedule: 'meeting:reschedule',
  cancel: 'meeting:cancel',
  cancelConfirmed: 'meeting:cancel-yes',
  keep: 'meeting:keep',
  attending: 'meeting:attending',
} as const;

export const NURTURE_IDS = {
  optIn: 'nurture:optin',
  decline: 'nurture:no',
  stop: 'nurture:stop',
} as const;
