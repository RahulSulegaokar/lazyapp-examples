import { DEMO_FOOTER } from '@lazyapp-examples/demo-kit';
import type { Ctx } from './context.js';
import { firstName } from './context.js';

export const MENU_IDS = {
  finder: 'menu:finder',
  shortlist: 'menu:shortlist',
  scholarships: 'menu:scholarships',
  counselling: 'menu:counselling',
  documents: 'menu:documents',
  application: 'menu:application',
  parent: 'menu:parent',
  alerts: 'menu:alerts',
} as const;

/** The student menu: discovery, then applying, then the people around the student. */
export async function showMenu(ctx: Ctx, intro?: string): Promise<void> {
  ctx.setState((state) => ({ ...state, step: 'menu', awaitingDocument: null }));
  const name = firstName(ctx);
  const { shortlist, application } = ctx.state;
  await ctx.send.list({
    header: 'BrightPath Overseas Education',
    body:
      intro ??
      `Hi${name === null ? '' : ` ${name}`}! 🎓 Planning to study abroad? Find programs that fit your profile and budget, talk to a counsellor for free, send your documents and pay the application fee, all in this chat.`,
    button: 'Get started',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Explore',
        rows: [
          {
            id: MENU_IDS.finder,
            title: 'Find a program',
            description: '18 programs · UK, Canada, Australia, Germany, US, Ireland',
          },
          {
            id: MENU_IDS.shortlist,
            title: 'My shortlist',
            description:
              shortlist.length === 0
                ? 'Nothing shortlisted yet'
                : `${shortlist.length} program${shortlist.length === 1 ? '' : 's'}`,
          },
          {
            id: MENU_IDS.scholarships,
            title: 'Scholarships',
            description: 'Chevening, Fulbright, DAAD and more',
          },
        ],
      },
      {
        title: 'Apply',
        rows: [
          {
            id: MENU_IDS.counselling,
            title: 'Free counselling call',
            description: '30 minutes with a country expert',
          },
          { id: MENU_IDS.documents, title: 'Documents', description: 'Checklist and upload' },
          {
            id: MENU_IDS.application,
            title: 'My application',
            description:
              application === null
                ? 'Not started'
                : application.status === 'submitted'
                  ? 'Submitted'
                  : 'Fee pending',
          },
        ],
      },
      {
        title: 'Stay in the loop',
        rows: [
          { id: MENU_IDS.parent, title: 'Add a parent', description: 'Let them follow your progress' },
          { id: MENU_IDS.alerts, title: 'Intake alerts', description: 'Deadlines and new intakes, opt-in' },
        ],
      },
    ],
  });
}

export async function nudge(ctx: Ctx): Promise<void> {
  await showMenu(ctx, "Sorry, I didn't catch that. Pick an option below, or type *MENU* any time.");
}
