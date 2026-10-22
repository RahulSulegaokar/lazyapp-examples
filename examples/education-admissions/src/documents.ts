import { DEMO_FOOTER, RESERVED_IDS } from '@lazyapp-examples/demo-kit';
import { documentsFor, findDocument } from './catalog.js';
import type { Ctx } from './context.js';
import { assetUrl, tagContact } from './context.js';
import { MENU_IDS } from './menu.js';
import type { ReceivedMedia } from './state.js';

export const DOC_IDS = {
  uploadPrefix: 'docs:upload:',
  classifyPrefix: 'docs:is:',
  checklistPdf: 'docs:pdf',
  skip: 'docs:skip',
} as const;

const ACCEPTED = /^(image\/(jpeg|png|webp|heic)|application\/pdf)$/;

function missingDocuments(ctx: Ctx) {
  return documentsFor(ctx.state.profile.level).filter(
    (document) => ctx.state.documents[document.id] === undefined,
  );
}

function progress(ctx: Ctx): { done: number; total: number } {
  const required = documentsFor(ctx.state.profile.level);
  return {
    done: required.filter((document) => ctx.state.documents[document.id] !== undefined).length,
    total: required.length,
  };
}

/** The checklist: what is in, what is missing, and a row per missing document to upload it. */
export async function showDocuments(ctx: Ctx): Promise<void> {
  const required = documentsFor(ctx.state.profile.level);
  const missing = missingDocuments(ctx);
  const { done, total } = progress(ctx);
  const lines = required.map(
    (document) => `${ctx.state.documents[document.id] === undefined ? '⬜' : '✅'} ${document.title}`,
  );
  ctx.setState((state) => ({ ...state, step: 'documents', awaitingDocument: null }));
  if (missing.length === 0) {
    await ctx.send.buttons({
      header: `Documents ${done}/${total} ✅`,
      body: `${lines.join('\n')}\n\nEverything is in. Your counsellor checks each file within one working day.`,
      footer: DEMO_FOOTER,
      buttons: [
        { id: MENU_IDS.application, title: 'My application' },
        { id: RESERVED_IDS.menu, title: 'Main menu' },
      ],
    });
    return;
  }
  await ctx.send.list({
    header: `Documents ${done}/${total}`,
    body: `${lines.join('\n')}\n\nPick one to upload, or just send photos and PDFs and I'll ask what each one is.`,
    button: 'Upload a document',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Still needed',
        rows: [
          ...missing.slice(0, 9).map((document) => ({
            id: `${DOC_IDS.uploadPrefix}${document.id}`,
            title: document.title,
            description: document.hint,
          })),
          {
            id: DOC_IDS.checklistPdf,
            title: 'Checklist (PDF)',
            description: 'Everything you need, on one page',
          },
        ],
      },
    ],
  });
}

export async function onUploadRequest(ctx: Ctx, documentId: string): Promise<void> {
  const document = findDocument(documentId);
  if (document === undefined) {
    return showDocuments(ctx);
  }
  ctx.setState((state) => ({ ...state, step: 'awaiting-document', awaitingDocument: document.id }));
  await ctx.send.text(
    `Send your *${document.title}* (${document.hint.toLowerCase()}) as a clear photo or a PDF.`,
  );
}

export async function onChecklistPdf(ctx: Ctx): Promise<void> {
  await ctx.send.document(
    assetUrl(ctx, 'document-checklist.pdf'),
    'BrightPath-Document-Checklist.pdf',
    'Your application checklist. Send each document here as a photo or PDF.',
  );
}

/** A photo or file arrived: file it under the document we asked for, or ask what it is. */
export async function onMedia(ctx: Ctx, media: ReceivedMedia & { mediaType: string }): Promise<void> {
  const accepted =
    (media.mediaType === 'image' || media.mediaType === 'document') &&
    (media.mimeType === null || ACCEPTED.test(media.mimeType));
  if (!accepted) {
    await ctx.send.react('⚠️');
    await ctx.send.text(
      'I can only accept photos (JPG, PNG) or PDFs for documents. Please send it again in one of those.',
    );
    return;
  }
  const target = ctx.state.awaitingDocument;
  if (target !== null && findDocument(target) !== undefined) {
    return record(ctx, target, media);
  }
  const missing = missingDocuments(ctx);
  if (missing.length === 0) {
    await ctx.send.react('👍');
    await ctx.send.text(
      'Thanks! All your documents are already in, so I passed this one to your counsellor as an extra.',
    );
    return;
  }
  ctx.setState((state) => ({
    ...state,
    step: 'classify-document',
    pendingMedia: { mediaId: media.mediaId, mimeType: media.mimeType, filename: media.filename },
  }));
  await ctx.send.list({
    body: `Got ${media.filename ?? 'it'}. Which document is this?`,
    button: 'Choose document',
    footer: DEMO_FOOTER,
    sections: [
      {
        title: 'Still needed',
        rows: missing
          .slice(0, 10)
          .map((document) => ({ id: `${DOC_IDS.classifyPrefix}${document.id}`, title: document.title })),
      },
    ],
  });
}

export async function onClassify(ctx: Ctx, documentId: string): Promise<void> {
  const media = ctx.state.pendingMedia;
  if (media === null || findDocument(documentId) === undefined) {
    return showDocuments(ctx);
  }
  return record(ctx, documentId, media);
}

async function record(ctx: Ctx, documentId: string, media: ReceivedMedia): Promise<void> {
  const document = findDocument(documentId);
  if (document === undefined) {
    return showDocuments(ctx);
  }
  const firstUpload = Object.keys(ctx.state.documents).length === 0;
  ctx.setState((state) => ({
    ...state,
    documents: { ...state.documents, [documentId]: { ...media, at: ctx.now().toISOString() } },
    pendingMedia: null,
    awaitingDocument: null,
  }));
  ctx.kv.set(`document:${ctx.user.address}:${documentId}`, { ...media, at: ctx.now().toISOString() });
  const { done, total } = progress(ctx);
  const [next] = missingDocuments(ctx);
  if (next === undefined) {
    await tagContact(ctx, ['admissions:docs-complete'], firstUpload ? [] : ['admissions:docs-in-progress']);
  } else if (firstUpload) {
    await tagContact(ctx, ['admissions:docs-in-progress']);
  }
  await ctx.send.react('✅');
  if (next === undefined) {
    ctx.setState((state) => ({ ...state, step: 'menu' }));
    await ctx.send.buttons({
      body: `${document.title} received. That's all ${total} documents! 🎉 Your counsellor reviews them within one working day.`,
      footer: DEMO_FOOTER,
      buttons: [
        { id: MENU_IDS.application, title: 'My application' },
        { id: RESERVED_IDS.menu, title: 'Main menu' },
      ],
    });
    return;
  }
  ctx.setState((state) => ({ ...state, step: 'awaiting-document', awaitingDocument: next.id }));
  await ctx.send.buttons({
    body: `${document.title} received (${done}/${total}).\n\nNext: *${next.title}* (${next.hint.toLowerCase()}). Send it now, or come back later.`,
    footer: DEMO_FOOTER,
    buttons: [
      { id: DOC_IDS.skip, title: 'Later' },
      { id: MENU_IDS.documents, title: 'See checklist' },
    ],
  });
}
