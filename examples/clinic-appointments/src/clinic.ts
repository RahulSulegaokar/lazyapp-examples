/**
 * Seed data for Aarogya Clinics, a (fictional) three-branch family clinic in Bengaluru.
 * Everything a front desk knows: branches, hours, specialties, doctors, fees and weekly rosters.
 */

export interface Branch {
  readonly id: string;
  readonly name: string;
  readonly address: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly hours: string;
}

export const BRANCHES = [
  {
    id: 'kor',
    name: 'Aarogya Clinics Koramangala',
    address: '80 Feet Road, Koramangala 4th Block, Bengaluru 560034',
    latitude: 12.9339,
    longitude: 77.6237,
    hours: 'Mon–Sat 8:00 AM–9:00 PM · Sun 9:00 AM–1:00 PM',
  },
  {
    id: 'ind',
    name: 'Aarogya Clinics Indiranagar',
    address: '100 Feet Road, HAL 2nd Stage, Indiranagar, Bengaluru 560038',
    latitude: 12.9719,
    longitude: 77.6412,
    hours: 'Mon–Sat 9:00 AM–8:00 PM · Sun closed',
  },
  {
    id: 'hsr',
    name: 'Aarogya Clinics HSR Layout',
    address: '27th Main Road, Sector 1, HSR Layout, Bengaluru 560102',
    latitude: 12.9116,
    longitude: 77.6474,
    hours: 'Mon–Sat 8:30 AM–8:30 PM · Sun 10:00 AM–2:00 PM',
  },
] as const satisfies readonly Branch[];

export type BranchId = (typeof BRANCHES)[number]['id'];

export interface Specialty {
  readonly id: string;
  readonly title: string;
  readonly description: string;
}

export const SPECIALTIES = [
  { id: 'gp', title: 'General Medicine', description: 'Fever, infections, diabetes, BP, check-ups' },
  { id: 'paed', title: 'Paediatrics', description: 'Children 0–16: vaccines, growth, illness' },
  { id: 'derm', title: 'Dermatology', description: 'Skin, hair, acne, allergies' },
  { id: 'cardio', title: 'Cardiology', description: 'Heart, chest pain, ECG, BP review' },
  { id: 'ortho', title: 'Orthopaedics', description: 'Bones, joints, back pain, sports injuries' },
  { id: 'gyn', title: 'Obstetrics & Gynaecology', description: "Women's health and pregnancy care" },
  { id: 'ent', title: 'ENT', description: 'Ear, nose, throat, sinus, hearing' },
] as const satisfies readonly Specialty[];

export type SpecialtyId = (typeof SPECIALTIES)[number]['id'];

/** A weekly roster: which weekdays (0 = Sunday) and the session windows, in IST. */
export interface Roster {
  readonly days: readonly number[];
  readonly sessions: readonly { readonly from: string; readonly to: string }[];
  readonly slotMinutes: number;
}

export interface Doctor {
  readonly id: string;
  readonly name: string;
  readonly specialty: SpecialtyId;
  readonly qualifications: string;
  readonly experienceYears: number;
  readonly languages: string;
  readonly branch: BranchId;
  /** Paise. */
  readonly fee: number;
  /** Paise. Follow-up within 14 days of a visit. */
  readonly followUpFee: number;
  readonly photo: string;
  readonly roster: Roster;
}

const photo = (id: string) => `https://images.unsplash.com/${id}?w=800&q=80&auto=format&fit=crop`;

export const DOCTORS = [
  {
    id: 'kavita-rao',
    name: 'Dr. Kavita Rao',
    specialty: 'gp',
    qualifications: 'MBBS, MD (General Medicine)',
    experienceYears: 14,
    languages: 'English, Hindi, Kannada',
    branch: 'kor',
    fee: 60000,
    followUpFee: 30000,
    photo: photo('photo-1559839734-2b71ea197ec2'),
    roster: {
      days: [1, 2, 3, 4, 5, 6],
      sessions: [
        { from: '09:30', to: '13:30' },
        { from: '17:00', to: '20:00' },
      ],
      slotMinutes: 15,
    },
  },
  {
    id: 'sanjay-hegde',
    name: 'Dr. Sanjay Hegde',
    specialty: 'gp',
    qualifications: 'MBBS, DNB (Family Medicine)',
    experienceYears: 9,
    languages: 'English, Kannada, Tamil',
    branch: 'hsr',
    fee: 50000,
    followUpFee: 25000,
    photo: photo('photo-1612349317150-e413f6a5b16d'),
    roster: { days: [0, 1, 2, 3, 4, 5, 6], sessions: [{ from: '10:00', to: '14:00' }], slotMinutes: 15 },
  },
  {
    id: 'arjun-menon',
    name: 'Dr. Arjun Menon',
    specialty: 'paed',
    qualifications: 'MBBS, MD (Paediatrics)',
    experienceYears: 11,
    languages: 'English, Malayalam, Hindi',
    branch: 'ind',
    fee: 70000,
    followUpFee: 35000,
    photo: photo('photo-1622253692010-333f2da6031d'),
    roster: {
      days: [1, 2, 3, 4, 5, 6],
      sessions: [
        { from: '10:00', to: '13:00' },
        { from: '17:30', to: '19:30' },
      ],
      slotMinutes: 20,
    },
  },
  {
    id: 'sneha-kulkarni',
    name: 'Dr. Sneha Kulkarni',
    specialty: 'derm',
    qualifications: 'MBBS, MD (Dermatology)',
    experienceYears: 8,
    languages: 'English, Marathi, Hindi',
    branch: 'kor',
    fee: 80000,
    followUpFee: 40000,
    photo: photo('photo-1594824476967-48c8b964273f'),
    roster: { days: [1, 3, 5, 6], sessions: [{ from: '11:00', to: '16:00' }], slotMinutes: 20 },
  },
  {
    id: 'rajesh-iyer',
    name: 'Dr. Rajesh Iyer',
    specialty: 'cardio',
    qualifications: 'MBBS, MD, DM (Cardiology)',
    experienceYears: 22,
    languages: 'English, Tamil, Hindi',
    branch: 'ind',
    fee: 120000,
    followUpFee: 60000,
    photo: photo('photo-1537368910025-700350fe46c7'),
    roster: { days: [2, 4, 6], sessions: [{ from: '16:00', to: '19:00' }], slotMinutes: 20 },
  },
  {
    id: 'farhan-qureshi',
    name: 'Dr. Farhan Qureshi',
    specialty: 'ortho',
    qualifications: 'MBBS, MS (Orthopaedics)',
    experienceYears: 12,
    languages: 'English, Hindi, Urdu',
    branch: 'hsr',
    fee: 90000,
    followUpFee: 45000,
    photo: photo('photo-1582750433449-648ed127bb54'),
    roster: { days: [1, 2, 3, 4, 5], sessions: [{ from: '09:00', to: '13:00' }], slotMinutes: 20 },
  },
  {
    id: 'meera-nair',
    name: 'Dr. Meera Nair',
    specialty: 'gyn',
    qualifications: 'MBBS, MS (OBG), FRCOG',
    experienceYears: 18,
    languages: 'English, Malayalam, Kannada',
    branch: 'kor',
    fee: 90000,
    followUpFee: 45000,
    photo: photo('photo-1651008376811-b90baee60c1f'),
    roster: { days: [1, 2, 4, 5, 6], sessions: [{ from: '10:00', to: '14:00' }], slotMinutes: 20 },
  },
  {
    id: 'vikram-shetty',
    name: 'Dr. Vikram Shetty',
    specialty: 'ent',
    qualifications: 'MBBS, MS (ENT)',
    experienceYears: 10,
    languages: 'English, Kannada, Tulu',
    branch: 'ind',
    fee: 70000,
    followUpFee: 35000,
    photo: photo('photo-1622902046580-2b47f47f5471'),
    roster: { days: [1, 3, 5], sessions: [{ from: '17:00', to: '20:00' }], slotMinutes: 15 },
  },
] as const satisfies readonly Doctor[];

export type DoctorId = (typeof DOCTORS)[number]['id'];

/** The clinic's 24×7 emergency desk and the national ambulance number. */
export const EMERGENCY = { ambulance: '108' } as const;

/** Online refunds are automatic up to this long before the appointment. */
export const FREE_CANCELLATION_MS = 4 * 60 * 60 * 1000;
/** Reschedules close this long before the appointment. */
export const RESCHEDULE_CUTOFF_MS = 2 * 60 * 60 * 1000;
/** How long a slot is held while the patient pays. */
export const HOLD_MS = 15 * 60 * 1000;
/** Slots open this far ahead. */
export const BOOKING_HORIZON_DAYS = 7;
/** Earliest bookable slot, from now. */
export const MIN_LEAD_MS = 60 * 60 * 1000;

export function findDoctor(id: string): Doctor | undefined {
  return DOCTORS.find((doctor) => doctor.id === id);
}

export function findSpecialty(id: string): Specialty | undefined {
  return SPECIALTIES.find((specialty) => specialty.id === id);
}

export function findBranch(id: string): Branch | undefined {
  return BRANCHES.find((branch) => branch.id === id);
}

export function doctorsFor(specialty: string): Doctor[] {
  return DOCTORS.filter((doctor) => doctor.specialty === specialty);
}

/** "General Medicine · Koramangala · ₹600". */
export function doctorLine(doctor: Doctor): string {
  const branch = findBranch(doctor.branch);
  return `${findSpecialty(doctor.specialty)?.title ?? ''} · ${branch?.name.replace('Aarogya Clinics ', '') ?? ''}`;
}
