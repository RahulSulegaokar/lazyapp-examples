import type { DeliveryAddress, DeliverySlot } from './state.js';

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** Delivery windows offered each day, in IST hours. */
const WINDOWS = [
  { id: 'am', from: 9, to: 13, label: '9 am – 1 pm' },
  { id: 'pm', from: 13, to: 17, label: '1 pm – 5 pm' },
  { id: 'eve', from: 17, to: 21, label: '5 pm – 9 pm' },
] as const;

/**
 * The next three delivery days (from tomorrow; same-day dispatch closes at noon IST),
 * three windows each: nine rows, which fits one WhatsApp list.
 */
export function deliverySlots(now: Date): DeliverySlot[] {
  const istNow = new Date(now.getTime() + IST_OFFSET_MS);
  const firstDay = istNow.getUTCHours() < 12 ? 1 : 2;
  const slots: DeliverySlot[] = [];
  for (let offset = firstDay; offset < firstDay + 3; offset++) {
    const day = new Date(istNow.getTime() + offset * DAY_MS);
    const date = day.toISOString().slice(0, 10);
    const dayLabel = day.toLocaleDateString('en-IN', {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      timeZone: 'UTC',
    });
    for (const window of WINDOWS) {
      slots.push({ id: `${date}:${window.id}`, label: `${dayLabel}, ${window.label}` });
    }
  }
  return slots;
}

export function findSlot(id: string, now: Date): DeliverySlot | undefined {
  return deliverySlots(now).find((slot) => slot.id === id);
}

/**
 * Courier serviceability by PIN prefix. Prepaid ships everywhere; these remote
 * areas (Andaman & Nicobar, Lakshadweep, parts of the North East) are prepaid only.
 */
const PREPAID_ONLY_PREFIXES = ['744', '682555', '790', '791', '792', '795', '796', '797', '798'];

export function isCodAvailable(pincode: string): boolean {
  return !PREPAID_ONLY_PREFIXES.some((prefix) => pincode.startsWith(prefix));
}

/** Indian PIN codes are six digits and never start with 0. */
export function isValidPincode(value: string): boolean {
  return /^[1-9]\d{5}$/.test(value.trim());
}

/**
 * Turns an India address-message submission into a delivery address, or field
 * errors in Meta's `validation_errors` shape so the form can be sent back.
 */
export function addressFromForm(
  values: Readonly<Record<string, string>>,
): { ok: true; address: DeliveryAddress } | { ok: false; errors: Record<string, string> } {
  const get = (key: string): string => (values[key] ?? '').trim();
  const errors: Record<string, string> = {};
  if (get('name') === '') {
    errors.name = 'Please add the name of the person receiving the order';
  }
  if (!isValidPincode(get('in_pin_code'))) {
    errors.in_pin_code = 'Enter a 6-digit PIN code';
  }
  const line1 = [get('house_number'), get('floor_number'), get('tower_number'), get('building_name')]
    .filter((part) => part !== '')
    .join(', ');
  const street = get('address');
  if (line1 === '' && street === '') {
    errors.address = 'Add a house number and street';
  }
  if (get('city') === '') {
    errors.city = 'Add a city';
  }
  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    address: {
      name: get('name'),
      phone: get('phone_number') === '' ? null : get('phone_number'),
      line1: line1 === '' ? street : line1,
      line2: line1 === '' || street === '' ? null : street,
      landmark: get('landmark_area') === '' ? null : get('landmark_area'),
      city: get('city'),
      state: get('state') === '' ? '—' : get('state'),
      pincode: get('in_pin_code'),
    },
  };
}

/**
 * Parses a typed address ("Asha Rao, 12 MG Road, Indiranagar, Bengaluru 560038"):
 * the fallback when neither the address message nor the address flow is available.
 */
export function addressFromText(text: string, name: string | null): DeliveryAddress | null {
  const pincode = /\b([1-9]\d{5})\b/.exec(text)?.[1];
  if (pincode === undefined) {
    return null;
  }
  const parts = text
    .replace(pincode, '')
    .split(/[,\n]/)
    .map((part) => part.trim())
    .filter((part) => part !== '');
  if (parts.length < 2) {
    return null;
  }
  const city = parts.at(-1) ?? '';
  return {
    name: name ?? 'Customer',
    phone: null,
    line1: parts.slice(0, -1).join(', '),
    line2: null,
    landmark: null,
    city,
    state: '—',
    pincode,
  };
}

export function formatAddress(address: DeliveryAddress): string {
  return [
    address.name,
    address.line1,
    address.line2,
    address.landmark === null ? null : `Near ${address.landmark}`,
    `${address.city} ${address.pincode}`,
  ]
    .filter((part): part is string => part !== null && part !== '')
    .join(', ');
}

/** The address in Meta's address-message shape, for `saved_addresses` and prefill. */
export function toAddressValues(address: DeliveryAddress): Record<string, string> {
  return {
    name: address.name,
    ...(address.phone === null ? {} : { phone_number: address.phone }),
    in_pin_code: address.pincode,
    address: [address.line1, address.line2].filter((part) => part !== null).join(', '),
    ...(address.landmark === null ? {} : { landmark_area: address.landmark }),
    city: address.city,
    ...(address.state === '—' ? {} : { state: address.state }),
  };
}
