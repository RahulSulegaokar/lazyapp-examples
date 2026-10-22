import { createHarness } from '@lazyapp-examples/demo-kit/testing';
import type { Harness } from '@lazyapp-examples/demo-kit/testing';
import { afterEach, describe, expect, it } from 'vitest';
import admissions from '../src/index.js';
import { TEMPLATES } from '../src/manifest.js';
import { deadlineFor, intakeOptions, matchPrograms, nextIntakes } from '../src/finder.js';
import { findProgram } from '../src/catalog.js';
import { provisionIntakeTemplate } from '../src/provision-intake-template.js';
import type { AdmissionsState } from '../src/state.js';

/** Friday 23 Oct 2026, 09:00 IST (the harness default). */
const HOUR = 60 * 60 * 1000;
const PARENT = '+919811112222';
const harnesses: { close(): void }[] = [];
const setup = (options?: Parameters<typeof createHarness>[1]) => {
  const harness = createHarness(admissions, { displayName: 'Rahul Verma', ...options });
  harnesses.push(harness);
  return harness;
};
afterEach(() => {
  for (const harness of harnesses.splice(0)) {
    harness.close();
  }
});

type H = Harness<AdmissionsState>;

const flowData = (result: Awaited<ReturnType<H['flowExchange']>>) => {
  if (result.status !== 200) {
    throw new Error(`flow exchange failed: ${result.status}`);
  }
  return result.body as { screen: string; data: Record<string, unknown> };
};

const SEARCH = {
  trigger: 'search',
  country: 'uk',
  level: 'pg',
  field: 'data',
  intake: '2027-fall',
  budget: 'b35',
  ielts: '6.5',
};

/** Start → finder Flow → search UK data science → shortlist Leeds → flow submitted. */
async function shortlistLeeds(h: H): Promise<void> {
  await h.user.send('DEMO ADMISSIONS');
  await h.user.choose('menu:finder');
  await h.flowExchange('finder', { action: 'data_exchange', screen: 'PREFS', data: SEARCH });
  await h.flowExchange('finder', {
    action: 'data_exchange',
    screen: 'RESULTS',
    data: { trigger: 'shortlist', shortlist: ['leeds-msc-ds'] },
  });
  await h.user.submitFlow({ shortlist: ['leeds-msc-ds'] });
}

describe('education admissions', () => {
  it('stays silent until the start code', async () => {
    const h = setup();
    expect(await h.user.send('I want to study in the UK')).toEqual({
      status: 'ignored',
      reason: 'not in a demo',
    });
    expect(h.calls).toHaveLength(0);
  });

  it('opens with the admissions menu', async () => {
    const h = setup();
    await h.user.send('Demo Admissions');
    expect(h.lastInteractive()).toMatchObject({
      type: 'list',
      header: { text: 'BrightPath Overseas Education' },
      body: { text: expect.stringContaining('Hi Rahul!') },
      footer: { text: 'MENU · EXIT · STOP' },
    });
    expect(h.lastChoices()).toEqual([
      'menu:finder',
      'menu:shortlist',
      'menu:scholarships',
      'menu:counselling',
      'menu:documents',
      'menu:application',
      'menu:parent',
      'menu:alerts',
    ]);
  });

  describe('course finder Flow', () => {
    it('sends a data_exchange flow and fills the dropdowns on INIT', async () => {
      const h = setup();
      await h.user.send('DEMO ADMISSIONS');
      await h.user.choose('menu:finder');
      expect(h.lastInteractive()).toMatchObject({
        type: 'flow',
        action: {
          parameters: { flow_id: 'meta-flow-education-admissions-finder', flow_action: 'data_exchange' },
        },
      });

      const init = flowData(await h.flowExchange('finder', { action: 'INIT' }));
      expect(init.screen).toBe('PREFS');
      expect(init.data.intakes).toEqual([
        { id: '2027-spring', title: 'Jan–Apr 2027' },
        { id: '2027-summer', title: 'May–Aug 2027' },
        { id: '2027-fall', title: 'Sep–Dec 2027' },
      ]);
      expect(init.data.countries).toHaveLength(7);
    });

    it('matches live and shortlists', async () => {
      const h = setup();
      await h.user.send('DEMO ADMISSIONS');
      await h.user.choose('menu:finder');

      const results = flowData(
        await h.flowExchange('finder', { action: 'data_exchange', screen: 'PREFS', data: SEARCH }),
      );
      expect(results).toMatchObject({
        screen: 'RESULTS',
        data: {
          heading: '1 program match',
          summary:
            "Master's (PG) · Data Science & Analytics · United Kingdom · Sep–Dec 2027 · ₹25–35 lakh / year",
          programs: [
            {
              id: 'leeds-msc-ds',
              title: 'MSc Data Science · Leeds',
              description: expect.stringContaining('~₹31 lakh / year · IELTS 6.5 · Sep 2027'),
            },
          ],
          has_note: false,
        },
      });
      expect(h.state()?.profile).toMatchObject({ country: 'uk', level: 'pg', field: 'data', ielts: '6.5' });

      const done = flowData(
        await h.flowExchange('finder', {
          action: 'data_exchange',
          screen: 'RESULTS',
          data: { trigger: 'shortlist', shortlist: ['leeds-msc-ds', 'not-a-program'] },
        }),
      );
      expect(done).toMatchObject({
        screen: 'SUCCESS',
        data: { extension_message_response: { params: { shortlist: ['leeds-msc-ds'] } } },
      });
      expect(h.state()?.shortlist).toEqual(['leeds-msc-ds']);
    });

    it('shows the closest options, with a note, when nothing matches exactly', async () => {
      const h = setup();
      await h.user.send('DEMO ADMISSIONS');
      await h.user.choose('menu:finder');
      const results = flowData(
        await h.flowExchange('finder', {
          action: 'data_exchange',
          screen: 'PREFS',
          data: { ...SEARCH, country: 'germany', level: 'mba', ielts: 'none' },
        }),
      );
      expect(results.data).toMatchObject({
        heading: 'Closest matches',
        has_note: true,
        note: expect.stringMatching(/closest options[\s\S]*IELTS or PTE score/),
      });
      expect((results.data.programs as { id: string }[]).map((program) => program.id)).toEqual([
        'coventry-mba',
        'deakin-mba',
      ]);
    });

    it('re-shows results when nothing valid was ticked, and refuses stale tokens', async () => {
      const h = setup();
      await h.user.send('DEMO ADMISSIONS');
      await h.user.choose('menu:finder');
      const again = flowData(
        await h.flowExchange('finder', {
          action: 'data_exchange',
          screen: 'RESULTS',
          data: { trigger: 'shortlist', shortlist: [] },
        }),
      );
      expect(again.screen).toBe('RESULTS');
      expect(
        await h.flowExchange('finder', { action: 'INIT', flow_token: 'education-admissions.nope' }),
      ).toMatchObject({
        status: 427,
      });
    });

    it('shows a single shortlisted program as an image card and tags the lead', async () => {
      const h = setup();
      await h.user.send('DEMO ADMISSIONS');
      await h.user.choose('menu:finder');
      await h.flowExchange('finder', { action: 'data_exchange', screen: 'PREFS', data: SEARCH });
      await h.flowExchange('finder', {
        action: 'data_exchange',
        screen: 'RESULTS',
        data: { trigger: 'shortlist', shortlist: ['leeds-msc-ds'] },
      });
      h.clear();

      await h.user.submitFlow({ shortlist: ['leeds-msc-ds'] });

      expect(h.callsTo('POST', /^\/v1\/contacts\/[^/]+\/tags$/)[0]?.body).toEqual({
        tags: ['admissions:lead', 'admissions:country-uk'],
      });
      expect(h.lastInteractive()).toMatchObject({
        type: 'button',
        header: { type: 'image' },
        body: { text: expect.stringContaining('*MSc Data Science*\nUniversity of Leeds') },
      });
      expect(h.lastChoices()).toEqual([
        'prog:brochure:leeds-msc-ds',
        'prog:apply:leeds-msc-ds',
        'menu:counselling',
      ]);
    });
  });

  describe('without the Flow', () => {
    it('asks four questions as lists and shows a carousel', async () => {
      const h = setup({ flowsPublished: false });
      await h.user.send('DEMO ADMISSIONS');
      await h.user.choose('menu:finder');
      expect(h.lastInteractive()).toMatchObject({
        type: 'list',
        body: { text: expect.stringContaining('not published on this number') },
      });

      await h.user.choose('finder:country:uk');
      expect(h.lastChoices()).toEqual(['finder:level:ug', 'finder:level:pg', 'finder:level:mba']);
      await h.user.tap('finder:level:pg');
      await h.user.choose('finder:budget:b35');
      await h.user.choose('finder:ielts:6.5');

      const carousel = h.lastInteractive();
      expect(carousel).toMatchObject({
        type: 'carousel',
        body: { text: expect.stringContaining("Programs that fit: Master's (PG)") },
      });
      if (carousel?.type !== 'carousel') {
        throw new Error('expected a carousel');
      }
      expect(carousel.action.cards).toHaveLength(2);
      expect(carousel.action.cards[0]).toMatchObject({
        header: { type: 'image' },
        body: { text: expect.stringContaining('MSc Data Science') },
        action: {
          buttons: [
            { quick_reply: { id: 'prog:brochure:leeds-msc-ds', title: 'Brochure' } },
            { quick_reply: { id: 'prog:apply:leeds-msc-ds', title: 'Apply' } },
          ],
        },
      });
      expect(h.state()?.shortlist).toEqual(['leeds-msc-ds', 'glasgow-msc-finance']);
    });

    it('restarts the finder on a stale step id', async () => {
      const h = setup({ flowsPublished: false });
      await h.user.send('DEMO ADMISSIONS');
      await h.user.choose('finder:country:mars');
      expect(h.lastChoices()[0]).toBe('finder:country:uk');
    });
  });

  describe('programs and scholarships', () => {
    it('sends the country brochure PDF with the program facts', async () => {
      const h = setup();
      await shortlistLeeds(h);
      h.clear();
      await h.user.tap('prog:brochure:leeds-msc-ds');
      expect(h.messages()[0]).toMatchObject({
        type: 'document',
        media_url: 'https://demo.test/public/education-admissions/brochure-uk.pdf',
        filename: 'BrightPath-Study-in-United-Kingdom-2027.pdf',
        caption: expect.stringContaining('Next intakes: Sep 2027, Sep 2028'),
      });
      expect(h.lastChoices()).toEqual(['prog:apply:leeds-msc-ds', 'menu:counselling', 'menu:scholarships']);
    });

    it('lists scholarships for the shortlisted countries and links to the official page', async () => {
      const h = setup();
      await shortlistLeeds(h);
      await h.user.choose('menu:scholarships');
      expect(h.lastChoices()).toEqual(['sch:chevening', 'sch:great', 'sch:university-merit']);

      await h.user.choose('sch:chevening');
      expect(h.lastInteractive()).toMatchObject({
        type: 'cta_url',
        action: {
          parameters: { display_text: 'Official page', url: 'https://www.chevening.org/scholarships/' },
        },
      });

      await h.user.choose('sch:university-merit');
      expect(h.lastChoices()).toEqual(['menu:counselling', 'menu:scholarships']);
    });

    it('shows every scholarship before a shortlist, and an empty shortlist prompt', async () => {
      const h = setup();
      await h.user.send('DEMO ADMISSIONS');
      await h.user.send('any scholarships?');
      expect(h.lastChoices()).toHaveLength(6);
      await h.user.choose('menu:shortlist');
      expect(h.lastChoices()).toEqual(['menu:finder', 'demo:menu']);
    });
  });

  describe('counselling', () => {
    it('books a phone session with the right counsellor and shares their card', async () => {
      const h = setup();
      await shortlistLeeds(h);
      await h.user.choose('menu:counselling');

      expect(h.lastInteractive()).toMatchObject({
        type: 'list',
        body: { text: expect.stringContaining('*Priya Sharma*') },
      });
      const sessions = h.lastChoices();
      expect(sessions).toHaveLength(9);
      expect(sessions[0]).toBe('counsel:slot:2026-10-23:11:00');
      expect(sessions).not.toContain('counsel:slot:2026-10-25:11:00'); // Sunday

      await h.user.choose('counsel:slot:2026-10-23:15:00');
      expect(h.lastChoices()).toEqual(['counsel:mode:phone', 'counsel:mode:office']);
      h.clear();

      await h.user.tap('counsel:mode:phone');
      expect(h.messages()[0]).toMatchObject({
        type: 'contacts',
        contacts: [
          { name: { formatted_name: 'Priya Sharma (BrightPath)' }, phones: [{ phone: '+910000000000' }] },
        ],
      });
      expect(h.lastInteractive()).toMatchObject({
        header: { text: 'Counselling booked ✅' },
        body: { text: expect.stringContaining('Fri, 23 Oct · 3:00 PM') },
      });

      // Another student no longer sees 3 PM with Priya.
      const other = h.as('+919800000009');
      await other.send('DEMO ADMISSIONS');
      await other.choose('menu:counselling');
      expect(h.lastChoices()).not.toContain('counsel:slot:2026-10-23:15:00');
    });

    it('sends the office pin for in-person sessions, and moves the booking on change', async () => {
      const h = setup();
      await h.user.send('DEMO ADMISSIONS');
      await h.user.choose('menu:counselling');
      await h.user.choose('counsel:slot:2026-10-24:11:00');
      h.clear();
      await h.user.tap('counsel:mode:office');
      expect(h.messages()[0]).toMatchObject({ type: 'location', name: 'BrightPath Overseas Education' });

      await h.user.choose('menu:counselling');
      expect(h.lastChoices()).toEqual(['counsel:change', 'counsel:remind', 'demo:menu']);
      await h.user.tap('counsel:change');
      await h.user.choose('counsel:slot:2026-10-26:15:00');
      await h.user.tap('counsel:mode:phone');
      const kv = h.store.keyValue('example:education-admissions', () => h.now());
      expect(kv.list('counsel:').map((entry) => entry.key)).toEqual(['counsel:priya:2026-10-26:15:00']);
    });

    it('schedules a reminder an hour before on request, and EXIT cancels it', async () => {
      const h = setup();
      await h.user.send('DEMO ADMISSIONS');
      await h.user.choose('menu:counselling');
      await h.user.choose('counsel:slot:2026-10-23:18:30');
      await h.user.tap('counsel:mode:phone');
      h.clear();

      await h.user.tap('counsel:remind');
      const [scheduled] = h.callsTo('POST', '/v1/messages');
      expect(scheduled?.body).toMatchObject({
        type: 'template',
        send_at: new Date('2026-10-23T17:30:00+05:30').toISOString(),
        template: {
          name: TEMPLATES.counselling,
          components: [
            { type: 'body', parameters: [{ text: 'Rahul' }, { text: 'Priya Sharma' }, { text: '6:30 PM' }] },
            { sub_type: 'quick_reply', parameters: [{ payload: 'menu:documents' }] },
          ],
        },
      });
      h.clear();
      await h.user.send('EXIT');
      expect(h.callsTo('DELETE', /^\/v1\/messages\/scheduled\//)).toHaveLength(1);
    });
  });

  describe('documents', () => {
    it('shows the checklist and files a requested document, then asks for the next one', async () => {
      const h = setup();
      await shortlistLeeds(h);
      await h.user.choose('menu:documents');
      expect(h.lastInteractive()).toMatchObject({ header: { text: 'Documents 0/9' } });
      expect(h.lastChoices()).toHaveLength(10);
      expect(h.lastChoices().at(-1)).toBe('docs:pdf');

      await h.user.choose('docs:upload:passport');
      expect(h.texts().at(-1)).toContain('Send your *Passport*');
      h.clear();

      await h.user.sendMedia('image', { mime_type: 'image/jpeg', caption: 'passport' });

      expect(h.messages()[0]).toMatchObject({ type: 'reaction', reaction: { emoji: '✅' } });
      expect(h.callsTo('POST', /\/tags$/)[0]?.body).toEqual({ tags: ['admissions:docs-in-progress'] });
      expect(h.lastInteractive()).toMatchObject({
        body: {
          text: expect.stringMatching(/Passport received \(1\/9\)[\s\S]*Next: \*Class 10 marksheet\*/),
        },
      });
      expect(h.state()).toMatchObject({
        awaitingDocument: 'class10',
        documents: { passport: expect.anything() },
      });

      await h.user.sendMedia('document', { mime_type: 'application/pdf', filename: 'class10.pdf' });
      expect(h.state()?.documents.class10).toMatchObject({ filename: 'class10.pdf' });
    });

    it('asks what an unrequested file is, and rejects unsupported formats', async () => {
      const h = setup();
      await h.user.send('DEMO ADMISSIONS');
      await h.user.sendMedia('document', { mime_type: 'application/pdf', filename: 'transcripts.pdf' });
      expect(h.lastInteractive()).toMatchObject({
        body: { text: 'Got transcripts.pdf. Which document is this?' },
      });

      await h.user.choose('docs:is:degree');
      expect(h.state()?.documents.degree).toMatchObject({ filename: 'transcripts.pdf' });
      h.clear();

      await h.user.sendMedia('document', { mime_type: 'application/zip', filename: 'all.zip' });
      expect(h.messages()[0]).toMatchObject({ type: 'reaction', reaction: { emoji: '⚠️' } });
      expect(h.texts()[0]).toContain('photos (JPG, PNG) or PDFs');

      await h.user.sendMedia('audio');
      expect(h.texts().at(-1)).toContain('photos (JPG, PNG) or PDFs');
    });

    it('celebrates and re-tags when every document is in', async () => {
      const h = setup();
      await h.user.send('DEMO ADMISSIONS');
      await h.user.choose('docs:upload:passport');
      for (let index = 0; index < 9; index += 1) {
        await h.user.sendMedia('image', { mime_type: 'image/png' });
      }
      expect(h.lastInteractive()).toMatchObject({
        body: { text: expect.stringContaining("That's all 9 documents!") },
      });
      const tagCalls = h.calls.filter((call) => call.path.endsWith('/tags'));
      expect(tagCalls.at(-2)).toMatchObject({
        method: 'DELETE',
        body: { tags: ['admissions:docs-in-progress'] },
      });
      expect(tagCalls.at(-1)).toMatchObject({ method: 'POST', body: { tags: ['admissions:docs-complete'] } });

      await h.user.choose('menu:documents');
      expect(h.lastInteractive()).toMatchObject({ header: { text: 'Documents 9/9 ✅' } });
    });

    it('sends the checklist PDF and nudges text while waiting for a file', async () => {
      const h = setup();
      await h.user.send('DEMO ADMISSIONS');
      await h.user.choose('docs:pdf');
      expect(h.lastMessage()).toMatchObject({
        type: 'document',
        filename: 'BrightPath-Document-Checklist.pdf',
      });
      await h.user.choose('docs:upload:sop');
      await h.user.send('I will send it tomorrow');
      expect(h.texts().at(-1)).toContain('Please send the document as a photo or a PDF');
      await h.user.tap('docs:skip');
      expect(h.state()?.awaitingDocument).toBeNull();
    });
  });

  describe('application and fee', () => {
    it('goes straight to the summary when the chosen intake has one start', async () => {
      const h = setup();
      await shortlistLeeds(h);
      await h.user.tap('prog:apply:leeds-msc-ds');
      expect(h.lastInteractive()).toMatchObject({
        header: { text: expect.stringMatching(/^Application BP27-[A-Z2-9]{6}$/) },
        body: { text: expect.stringContaining('Sep 2027 intake · deadline *23 Jun 2027*') },
      });
      expect(h.lastChoices()).toEqual(['apply:pay', 'apply:later', 'menu:documents']);
      expect(h.callsTo('POST', /\/tags$/).at(-1)?.body).toEqual({
        tags: ['admissions:applicant', 'admissions:intake-2027-09'],
      });
    });

    it('asks for the intake when several are open', async () => {
      const h = setup();
      await h.user.send('DEMO ADMISSIONS');
      await h.user.tap('prog:apply:coventry-mba');
      // January 2027 is already inside the ten-week application window, so it is not offered.
      expect(h.lastChoices()).toEqual([
        'apply:intake:coventry-mba:2027-05',
        'apply:intake:coventry-mba:2027-09',
        'apply:intake:coventry-mba:2028-01',
      ]);
      await h.user.tap('apply:intake:coventry-mba:2027-05');
      expect(h.state()?.application).toMatchObject({
        programId: 'coventry-mba',
        intake: '2027-05',
        status: 'fee_pending',
      });
    });

    it('collects the fee with a WhatsApp order and files on payment.captured', async () => {
      const h = setup({ paymentConfiguration: 'brightpath-razorpay' });
      await shortlistLeeds(h);
      await h.user.tap('prog:apply:leeds-msc-ds');
      const ref = h.state()!.application!.ref;
      h.clear();

      await h.user.tap('apply:pay');
      expect(h.callsTo('POST', '/v1/payments')[0]?.body).toMatchObject({
        reference_id: ref,
        goods_type: 'digital-goods',
        items: [{ name: 'Application fee · Leeds', amount: 250000, quantity: 1 }],
        payment: { method: 'payment_gateway', configuration: 'brightpath-razorpay' },
        metadata: { application_ref: ref },
      });
      expect(h.state()?.application?.status).toBe('awaiting_payment');
      h.clear();

      await h.payPayment();
      expect(h.callsTo('POST', /\/status$/)[0]?.body).toMatchObject({ status: 'processing' });
      expect(h.callsTo('POST', /\/tags$/)[0]?.body).toEqual({ tags: ['admissions:fee-paid'] });
      expect(h.lastInteractive()).toMatchObject({ header: { text: 'Fee received ✅' } });
      expect(h.state()?.application).toMatchObject({ status: 'submitted', payMode: 'online' });
      h.clear();

      await h.user.tap('apply:remind');
      const sendAts = h
        .callsTo('POST', '/v1/messages')
        .flatMap((call) => ((call.body as { send_at?: string }).send_at === undefined ? [] : [call.body]));
      expect(sendAts).toMatchObject([
        {
          send_at: new Date('2027-06-16T00:00:00Z').toISOString(),
          template: {
            name: TEMPLATES.deadline,
            components: [
              {
                parameters: [
                  { text: 'Rahul' },
                  { text: 'MSc Data Science, University of Leeds' },
                  { text: 'Sep 2027' },
                  { text: '23 Jun 2027' },
                ],
              },
              { parameters: [{ payload: 'menu:documents' }] },
              { parameters: [{ payload: 'menu:counselling' }] },
            ],
          },
        },
        { send_at: new Date('2027-06-22T00:00:00Z').toISOString() },
      ]);
    });

    it('offers a retry with a new reference when the payment fails', async () => {
      const h = setup({ paymentConfiguration: 'brightpath-razorpay' });
      await shortlistLeeds(h);
      await h.user.tap('prog:apply:leeds-msc-ds');
      await h.user.tap('apply:pay');
      const order = [...h.api.payments.values()].at(-1)!;
      await h.event('payment.failed', {
        payment: { ...order, payment_status: 'failed', last_error: 'Bank declined' },
      });
      expect(h.lastInteractive()).toMatchObject({
        body: { text: expect.stringContaining('(Bank declined)') },
      });
      expect(h.state()?.application?.status).toBe('fee_pending');
      h.clear();
      await h.user.tap('apply:pay');
      expect(h.callsTo('POST', '/v1/payments')[0]?.body).toMatchObject({
        reference_id: `${order.reference_id}-2`,
      });
    });

    it('falls back to paying at counselling when payments are not set up, and says so', async () => {
      const h = setup();
      await shortlistLeeds(h);
      await h.user.tap('prog:apply:leeds-msc-ds');
      h.clear();
      await h.user.tap('apply:pay');
      expect(h.callsTo('POST', '/v1/payments')).toHaveLength(0);
      expect(h.texts()[0]).toContain("Online payment isn't set up on this demo number");
      expect(h.state()?.application).toMatchObject({ status: 'submitted', payMode: 'counselling' });

      await h.user.choose('menu:application');
      expect(h.lastInteractive()).toMatchObject({
        body: { text: expect.stringContaining('Fee due at counselling') },
      });
    });

    it('explains an empty application', async () => {
      const h = setup();
      await h.user.send('DEMO ADMISSIONS');
      await h.user.choose('menu:application');
      expect(h.lastChoices()).toEqual(['menu:finder', 'demo:menu']);
    });
  });

  describe('parent view', () => {
    async function invite(h: H): Promise<string> {
      await shortlistLeeds(h);
      await h.user.choose('menu:parent');
      expect(h.texts().at(-1)).toContain('contact card');
      await h.user.message('contacts', {
        contacts: [
          {
            name: { formatted_name: 'Sunita Verma' },
            phones: [{ phone: '+91 98111 12222', wa_id: '919811112222' }],
          },
        ],
      });
      const cta = h.lastInteractive();
      if (cta?.type !== 'cta_url') {
        throw new Error('expected a link');
      }
      const code = /PARENT%20([A-Z2-9]{6})$/.exec(cta.action.parameters.url)?.[1];
      expect(cta).toMatchObject({
        body: { text: expect.stringContaining('Only +91 98••••222 can use it') },
        action: {
          parameters: {
            url: expect.stringMatching(/^https:\/\/wa\.me\/910000000000\?text=DEMO%20ADMISSIONS%20PARENT%20/),
          },
        },
      });
      return code!;
    }

    it('lets the invited parent follow progress, refreshed as the student moves', async () => {
      const h = setup();
      const code = await invite(h);
      const parent = h.as(PARENT, 'Sunita Verma');

      await parent.send(`DEMO ADMISSIONS PARENT ${code}`);
      expect(h.state(PARENT)).toMatchObject({
        role: 'guardian',
        linkedStudent: { name: 'Rahul Verma', code },
      });
      expect(h.lastInteractive()).toMatchObject({
        header: { text: "Rahul Verma's application" },
        body: { text: expect.stringMatching(/Application: not started[\s\S]*Documents: 0 of 9/) },
      });
      expect(h.lastChoices()).toEqual(['guardian:refresh', 'guardian:counsellor', 'demo:exit']);

      await h.user.tap('prog:apply:leeds-msc-ds');
      await h.user.tap('apply:later');
      await parent.tap('guardian:refresh');
      expect(h.lastInteractive()).toMatchObject({
        body: {
          text: expect.stringMatching(
            /MSc Data Science, University of Leeds · Sep 2027 intake[\s\S]*being filed \(fee due at counselling\)/,
          ),
        },
      });

      await parent.send('MENU');
      expect(h.lastInteractive()).toMatchObject({ header: { text: "Rahul Verma's application" } });
      await parent.tap('guardian:counsellor');
      expect(h.lastMessage()).toMatchObject({ type: 'contacts' });
      await parent.sendMedia('image');
      expect(h.texts().at(-1)).toContain('uploaded by Rahul Verma');
    });

    it('refuses the link from another number, an unknown code, and the student themself', async () => {
      const h = setup();
      const code = await invite(h);
      await h.as('+919822223333').send(`DEMO ADMISSIONS PARENT ${code}`);
      expect(h.texts().at(-1)).toContain('This link was created for +91 98••••222');
      expect(h.state('+919822223333')?.role).toBe('student');

      await h.as('+919833334444').send('DEMO ADMISSIONS PARENT ZZZZZZ');
      expect(h.texts().at(-1)).toContain('expired or is not valid');

      h.advance(8 * 24 * HOUR);
      await h.as(PARENT).send(`DEMO ADMISSIONS PARENT ${code}`);
      expect(h.texts().at(-1)).toContain('expired or is not valid');
    });

    it('accepts a typed number and rejects nonsense', async () => {
      const h = setup();
      await h.user.send('DEMO ADMISSIONS');
      await h.user.choose('menu:parent');
      await h.user.send('mom');
      expect(h.texts().at(-1)).toContain('does not look like a phone number');
      await h.user.send('98111 12222');
      expect(h.state()?.guardianInvite).toMatchObject({ phone: '919811112222' });
    });
  });

  describe('intake alerts', () => {
    it('records consent, tags the contact and sends the image-header announcement', async () => {
      const h = setup();
      await h.user.send('DEMO ADMISSIONS');
      await h.user.choose('menu:alerts');
      expect(h.lastChoices()).toEqual(['alerts:yes', 'alerts:no']);
      h.clear();

      await h.user.tap('alerts:yes');

      expect(h.callsTo('POST', /\/consent$/)[0]?.body).toMatchObject({ granted: true, purpose: 'marketing' });
      expect(h.callsTo('POST', /\/tags$/)[0]?.body).toEqual({ tags: ['admissions:intake-alerts'] });
      expect(h.templates()).toMatchObject([
        {
          name: TEMPLATES.intake,
          components: [
            {
              type: 'header',
              parameters: [{ type: 'image', image: { link: expect.stringContaining('unsplash') } }],
            },
            {
              type: 'body',
              parameters: [{ text: 'Rahul' }, { text: 'Sep–Dec 2027' }, { text: '18' }, { text: '₹10 lakh' }],
            },
            { parameters: [{ payload: 'menu:finder' }] },
            { parameters: [{ payload: 'alerts:stop' }] },
          ],
        },
      ]);
      expect(h.session()?.meta.marketingOptIn).toBe(true);

      await h.user.choose('menu:alerts');
      expect(h.lastChoices()).toEqual(['alerts:stop', 'demo:menu']);
      h.clear();

      await h.user.tap('alerts:stop', 'Stop alerts');
      expect(h.callsTo('POST', /\/consent$/)[0]?.body).toMatchObject({ granted: false });
      expect(h.callsTo('DELETE', /\/tags$/)[0]?.body).toEqual({ tags: ['admissions:intake-alerts'] });
      expect(h.session()?.meta.marketingOptIn).toBe(false);
    });

    it('previews the announcement interactively when the template is not approved', async () => {
      const h = setup();
      let sequence = 0;
      h.api.on('POST', '/v1/messages', (call) => {
        const body = call.body as { type: string };
        if (body.type === 'template') {
          return {
            status: 422,
            body: { message: 'Template is not approved.', code: 'template_not_approved' },
          };
        }
        sequence += 1;
        return {
          status: 201,
          body: {
            uuid: `m${sequence}`,
            status: 'sent',
            type: body.type,
            provider_message_id: `wamid.m${sequence}`,
          },
        };
      });
      await h.user.send('DEMO ADMISSIONS');
      await h.user.tap('alerts:yes');
      expect(h.lastInteractive()).toMatchObject({
        type: 'button',
        header: { type: 'image' },
        body: { text: expect.stringContaining('Preview: the approved template') },
      });
      expect(h.lastChoices()).toEqual(['menu:finder', 'alerts:stop']);
    });

    it('respects "No thanks"', async () => {
      const h = setup();
      await h.user.send('DEMO ADMISSIONS');
      h.clear();
      await h.user.tap('alerts:no');
      expect(h.callsTo('POST', /\/consent$/)).toHaveLength(0);
      expect(h.lastInteractive()).toMatchObject({ body: { text: expect.stringContaining('no alerts') } });
    });
  });

  describe('edges', () => {
    it('nudges on unknown input and routes keywords', async () => {
      const h = setup();
      await h.user.send('DEMO ADMISSIONS');
      await h.user.send('hmm');
      expect(h.lastInteractive()).toMatchObject({
        body: { text: expect.stringContaining("didn't catch that") },
      });
      await h.user.send('I want to talk to a counsellor');
      expect(h.lastChoices()[0]).toMatch(/^counsel:slot:/);
      await h.user.send('looking for MBA programs');
      expect(h.lastInteractive()).toMatchObject({ type: 'flow' });
      await h.user.tap('apply:intake:not-real:2027-01');
      expect(h.lastInteractive()).toMatchObject({
        body: { text: expect.stringContaining("didn't catch that") },
      });
      await h.user.message('contacts', { contacts: [] });
      expect(h.lastInteractive()).toMatchObject({ type: 'list' });
    });

    it('goes quiet after 24 hours idle', async () => {
      const h = setup();
      await h.user.send('DEMO ADMISSIONS');
      h.advance(25 * HOUR);
      h.clear();
      expect(await h.user.send('menu')).toMatchObject({ status: 'ignored' });
      expect(h.messages()).toHaveLength(0);
    });
  });

  describe('helpers', () => {
    it('computes intakes and deadlines from the calendar', () => {
      const now = new Date('2026-10-23T09:00:00+05:30');
      expect(intakeOptions(now).map((option) => option.id)).toEqual([
        '2027-spring',
        '2027-summer',
        '2027-fall',
      ]);
      const monash = findProgram('monash-mit')!;
      expect(nextIntakes(monash, now)).toEqual([
        { year: 2027, month: 2 },
        { year: 2027, month: 7 },
        { year: 2028, month: 2 },
      ]);
      expect(deadlineFor({ year: 2027, month: 9 }).toISOString()).toBe('2027-06-23T00:00:00.000Z');
      expect(
        matchPrograms(
          { country: 'germany', level: 'pg', field: 'cs', intake: null, budget: 'b15', ielts: '7.0' },
          now,
        ).programs.map((program) => program.id),
      ).toEqual(['tum-msc-informatics']);
    });

    it('provisions the intake template: uploads the sample, then creates it', async () => {
      const calls: { url: string; method: string; body: unknown }[] = [];
      const fakeFetch: typeof fetch = async (input, init) => {
        const url = input instanceof Request ? input.url : input.toString();
        calls.push({ url, method: init?.method ?? 'GET', body: init?.body });
        if (url.includes('unsplash')) {
          return new Response(new Uint8Array([0xff, 0xd8, 0xff]), { status: 200 });
        }
        if (url.endsWith('/v1/templates/media')) {
          return Response.json({ handle: '4::aW1hZ2U=:ARb' });
        }
        return Response.json({ uuid: 't1', name: TEMPLATES.intake, status: 'pending' }, { status: 201 });
      };
      const lines: string[] = [];
      const handle = await provisionIntakeTemplate({
        apiKey: 'sk_test_x',
        baseUrl: 'https://lazyapp.test',
        dryRun: false,
        fetch: fakeFetch,
        log: (line) => lines.push(line),
      });
      expect(handle).toBe('4::aW1hZ2U=:ARb');
      expect(calls[1]?.body).toBeInstanceOf(FormData);
      expect(JSON.parse(String(calls[2]?.body))).toMatchObject({
        name: TEMPLATES.intake,
        category: 'MARKETING',
        header: { format: 'IMAGE', example_handle: '4::aW1hZ2U=:ARb' },
        submit: true,
      });
      expect(lines).toEqual([`created ${TEMPLATES.intake}: pending`]);
    });
  });
});
