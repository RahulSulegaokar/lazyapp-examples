import { loadExamples } from '@lazyapp-examples/demo-kit';
import type { AnyExample, TemplateSpec } from '@lazyapp-examples/demo-kit';
import type { CreateTemplateInput, TemplateButton } from '@lazyapp-examples/sdk';
import { describe, expect, it } from 'vitest';

/**
 * Checks every example against the rules of the shared demo number and Meta's template review,
 * so a mistake fails CI instead of a template rejection (or a demo that answers the wrong people).
 */
const examples: AnyExample[] = await loadExamples(undefined, { includeReference: true });

const VARIABLE = /\{\{(\d+)\}\}/g;

/** Meta's structural rules for a standard template. Returns readable problems, empty when valid. */
function templateProblems(input: CreateTemplateInput): string[] {
  const problems: string[] = [];
  if (!/^[a-z0-9_]{1,512}$/.test(input.name)) {
    problems.push('name must be lowercase letters, digits and underscores');
  }
  problems.push(...textProblems('body', input.body_text ?? '', input.body_examples, 1024));
  if (input.footer_text !== undefined) {
    if (input.footer_text.length > 60) {
      problems.push('footer is longer than 60 characters');
    }
    if (variablesIn(input.footer_text).length > 0) {
      problems.push('footer cannot contain variables');
    }
    if (input.limited_time_offer !== undefined) {
      problems.push('a limited-time offer template cannot have a footer');
    }
  }
  if (input.header?.format === 'TEXT') {
    if (input.header.text.length > 60) {
      problems.push('text header is longer than 60 characters');
    }
    if (variablesIn(input.header.text).length > 1) {
      problems.push('text header can have at most one variable');
    }
  }
  problems.push(...buttonProblems(input.buttons ?? []));
  const cards = input.carousel_cards ?? [];
  if (cards.length > 0) {
    if (cards.length < 2 || cards.length > 10) {
      problems.push('a carousel needs 2 to 10 cards');
    }
    const shapes = new Set(
      cards.map((card) => `${card.header.format}:${(card.buttons ?? []).map((b) => b.type).join(',')}`),
    );
    if (shapes.size > 1) {
      problems.push('every carousel card needs the same header format and buttons');
    }
    cards.forEach((card, index) => {
      problems.push(
        ...textProblems(`card ${index + 1} body`, card.body_text ?? '', card.body_examples, 160).map(
          (problem) => problem.replace(/^body /, ''),
        ),
        ...buttonProblems(card.buttons ?? [], 2).map((problem) => `card ${index + 1}: ${problem}`),
      );
    });
  }
  return problems;
}

function variablesIn(text: string): number[] {
  return [...text.matchAll(VARIABLE)].map((match) => Number(match[1]));
}

function textProblems(
  label: string,
  text: string,
  examples: readonly string[] | undefined,
  maxLength: number,
): string[] {
  const problems: string[] = [];
  if (text.trim() === '') {
    return [`${label} is empty`];
  }
  if (text.length > maxLength) {
    problems.push(`${label} is longer than ${maxLength} characters`);
  }
  const trimmed = text.trim();
  if (/^\{\{\d+\}\}/.test(trimmed) || /\{\{\d+\}\}[.!?]?$/.test(trimmed)) {
    problems.push(`${label} cannot start or end with a variable`);
  }
  const unique = [...new Set(variablesIn(text))].sort((a, b) => a - b);
  if (unique.some((value, index) => value !== index + 1)) {
    problems.push(`${label} variables must be {{1}}..{{n}} without gaps`);
  }
  if (unique.length > 0 && (examples?.length ?? 0) !== unique.length) {
    problems.push(`${label} has ${unique.length} variables but ${examples?.length ?? 0} examples`);
  }
  return problems;
}

function buttonProblems(buttons: readonly TemplateButton[], max = 10): string[] {
  const problems: string[] = [];
  if (buttons.length > max) {
    problems.push(`more than ${max} buttons`);
  }
  if (buttons.filter((button) => button.type === 'URL').length > 2) {
    problems.push('more than 2 URL buttons');
  }
  if (buttons.filter((button) => button.type === 'PHONE_NUMBER').length > 1) {
    problems.push('more than 1 phone button');
  }
  for (const button of buttons) {
    const text = 'text' in button ? button.text : undefined;
    if (text !== undefined && text.length > 25) {
      problems.push(`button "${text}" is longer than 25 characters`);
    }
  }
  // Quick replies must be grouped together, before or after the other buttons.
  const kinds = buttons.map((button) => (button.type === 'QUICK_REPLY' ? 'q' : 'o')).join('');
  if (/q+o+q+|o+q+o+/.test(kinds)) {
    problems.push('quick reply buttons must be grouped together');
  }
  return problems;
}

const prefix = (example: AnyExample): string => `demo_${example.id.replace(/-/g, '_')}_`;

const templateName = (spec: TemplateSpec): string => spec.input.name;

describe('examples on the shared number', () => {
  it('have unique ids, start codes and commands', () => {
    const unique = (values: readonly string[]) => new Set(values).size === values.length;
    expect(unique(examples.map((example) => example.id))).toBe(true);
    expect(unique(examples.map((example) => example.startCode.toUpperCase()))).toBe(true);
    const commands = examples.flatMap((example) => example.manifest.command?.name ?? []);
    expect(unique(commands)).toBe(true);
  });

  it.each(examples.map((example) => [example.id, example] as const))(
    '%s: start code, QR prefill and ice breaker open the demo explicitly',
    (_id, example) => {
      expect(example.startCode).toMatch(/^DEMO [A-Z0-9]+$/);
      const { qrPrefill, iceBreaker } = example.manifest;
      for (const text of [qrPrefill, iceBreaker]) {
        if (text !== undefined) {
          expect(text.toUpperCase().startsWith(example.startCode)).toBe(true);
        }
      }
      if (iceBreaker !== undefined) {
        expect(iceBreaker.length).toBeLessThanOrEqual(80);
      }
    },
  );

  it.each(examples.map((example) => [example.id, example] as const))(
    '%s: template and flow names are namespaced to the example',
    (_id, example) => {
      for (const spec of example.manifest.templates ?? []) {
        expect(templateName(spec).startsWith(prefix(example)), templateName(spec)).toBe(true);
      }
    },
  );

  it('never reuse a template name across examples', () => {
    const names = examples.flatMap((example) => (example.manifest.templates ?? []).map(templateName));
    expect(new Set(names).size).toBe(names.length);
  });

  const standard = examples.flatMap((example) =>
    (example.manifest.templates ?? []).flatMap((spec) =>
      spec.kind === 'standard' ? [[spec.input.name, spec.input] as const] : [],
    ),
  );

  it.each(standard)('%s passes Meta structural rules', (_name, input) => {
    expect(templateProblems(input)).toEqual([]);
  });

  it('the template linter catches the mistakes Meta rejects', () => {
    expect(
      templateProblems({
        name: 'Bad-Name',
        language: 'en',
        category: 'UTILITY',
        body_text: '{{1}}, your order {{3}} shipped',
        body_examples: ['Asha'],
        footer_text: 'Hi {{1}}',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Track' },
          { type: 'URL', text: 'Open', url: 'https://example.com' },
          { type: 'QUICK_REPLY', text: 'A quick reply that is far too long' },
        ],
      }),
    ).toEqual([
      'name must be lowercase letters, digits and underscores',
      'body cannot start or end with a variable',
      'body variables must be {{1}}..{{n}} without gaps',
      'body has 2 variables but 1 examples',
      'footer cannot contain variables',
      'button "A quick reply that is far too long" is longer than 25 characters',
      'quick reply buttons must be grouped together',
    ]);
  });
});
