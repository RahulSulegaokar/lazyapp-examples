/**
 * Every interactive id this example sends, in one place. Ids carry their argument after a
 * prefix (`home:view:blr-aurora`), so a tap is self-describing even on an old message.
 */

export const MENU_IDS = {
  search: 'menu:search',
  near: 'menu:near',
  more: 'menu:more',
  shortlist: 'menu:shortlist',
  visits: 'menu:visits',
  emi: 'menu:emi',
  advisor: 'menu:advisor',
} as const;

export const SEARCH_IDS = {
  start: 'search:start',
  purpose: 'search:purpose:',
  city: 'search:city:',
  budget: 'search:budget:',
} as const;

export const HOME_IDS = {
  view: 'home:view:',
  save: 'home:save:',
  unsave: 'home:unsave:',
  brochure: 'home:brochure:',
  emi: 'home:emi:',
  results: 'home:results',
} as const;

export const VISIT_IDS = {
  book: 'visit:book:',
  slot: 'visit:slot:',
  open: 'visit:open:',
  reschedule: 'visit:reschedule:',
  cancel: 'visit:cancel:',
  cancelConfirmed: 'visit:cancel-yes:',
  directions: 'visit:directions:',
} as const;

/** `feedback:<rating>:<visitId>`, also the payload of the feedback template's quick replies. */
export const FEEDBACK_PREFIX = 'feedback:';
