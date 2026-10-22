/**
 * Seed data for BrightPath Overseas Education, a (fictional) study-abroad consultancy with
 * offices in Pune, Bengaluru and Hyderabad. Universities and programs are real; tuition is
 * indicative (converted to lakh ₹ per year) and every message says so.
 */

export const COUNTRIES = [
  { id: 'uk', title: 'United Kingdom', flag: '🇬🇧', brochure: 'brochure-uk.pdf' },
  { id: 'canada', title: 'Canada', flag: '🇨🇦', brochure: 'brochure-canada.pdf' },
  { id: 'australia', title: 'Australia', flag: '🇦🇺', brochure: 'brochure-australia.pdf' },
  { id: 'germany', title: 'Germany', flag: '🇩🇪', brochure: 'brochure-germany.pdf' },
  { id: 'usa', title: 'United States', flag: '🇺🇸', brochure: 'brochure-usa.pdf' },
  { id: 'ireland', title: 'Ireland', flag: '🇮🇪', brochure: 'brochure-ireland.pdf' },
] as const;

export type CountryId = (typeof COUNTRIES)[number]['id'];

export const LEVELS = [
  { id: 'ug', title: "Bachelor's (UG)" },
  { id: 'pg', title: "Master's (PG)" },
  { id: 'mba', title: 'MBA' },
] as const;

export type LevelId = (typeof LEVELS)[number]['id'];

export const FIELDS = [
  { id: 'cs', title: 'Computer Science & IT' },
  { id: 'data', title: 'Data Science & Analytics' },
  { id: 'business', title: 'Business & Management' },
  { id: 'engineering', title: 'Engineering' },
  { id: 'finance', title: 'Finance & Accounting' },
] as const;

export type FieldId = (typeof FIELDS)[number]['id'];

/** Tuition bands, lakh ₹ per year. */
export const BUDGETS = [
  { id: 'b15', title: 'Up to ₹15 lakh / year', maxLakh: 15 },
  { id: 'b25', title: '₹15–25 lakh / year', maxLakh: 25 },
  { id: 'b35', title: '₹25–35 lakh / year', maxLakh: 35 },
  { id: 'bany', title: 'Above ₹35 lakh / year', maxLakh: Number.POSITIVE_INFINITY },
] as const;

export type BudgetId = (typeof BUDGETS)[number]['id'];

export const IELTS_BANDS = [
  { id: 'none', title: 'Not taken yet', score: null },
  { id: '6.0', title: '6.0', score: 6 },
  { id: '6.5', title: '6.5', score: 6.5 },
  { id: '7.0', title: '7.0 or above', score: 7 },
] as const;

export type IeltsId = (typeof IELTS_BANDS)[number]['id'];

export interface Program {
  readonly id: string;
  readonly university: string;
  readonly shortUniversity: string;
  readonly name: string;
  readonly country: CountryId;
  readonly city: string;
  readonly level: LevelId;
  readonly field: FieldId;
  readonly duration: string;
  /** Indicative tuition, lakh ₹ per year (0 = no tuition). */
  readonly tuitionLakh: number;
  readonly ieltsMin: number;
  /** Months (1–12) the program starts. */
  readonly intakeMonths: readonly number[];
  readonly scholarship: string;
  readonly image: string;
}

const img = (id: string) => `https://images.unsplash.com/${id}?w=800&q=80&auto=format&fit=crop`;
const IMAGES = {
  london: img('photo-1513635269975-59663e0ac1ad'),
  canada: img('photo-1503614472-8c93d56e92ce'),
  sydney: img('photo-1506973035872-a4ec16b8e8d9'),
  germany: img('photo-1467269204594-9661b134dd2b'),
  newYork: img('photo-1517935706615-2717063c2225'),
  liberty: img('photo-1485738422979-f5c462d49f74'),
  dublin: img('photo-1549918864-48ac978761a4'),
  campusRed: img('photo-1592280771190-3e2e4d571952'),
  campusLawn: img('photo-1562774053-701939374585'),
  campusPath: img('photo-1607237138185-eedd9c632b0b'),
  library: img('photo-1564981797816-1043664bf78d'),
  graduates: img('photo-1541339907198-e08756dedf3f'),
} as const;

/** Header image of the intake announcement template. */
export const ANNOUNCEMENT_IMAGE = IMAGES.graduates;

export const PROGRAMS: readonly Program[] = [
  {
    id: 'leeds-msc-ds',
    university: 'University of Leeds',
    shortUniversity: 'Leeds',
    name: 'MSc Data Science',
    country: 'uk',
    city: 'Leeds',
    level: 'pg',
    field: 'data',
    duration: '1 year',
    tuitionLakh: 31,
    ieltsMin: 6.5,
    intakeMonths: [9],
    scholarship: 'International Excellence Scholarship up to £5,000',
    image: IMAGES.campusRed,
  },
  {
    id: 'manchester-msc-acs',
    university: 'University of Manchester',
    shortUniversity: 'Manchester',
    name: 'MSc Advanced Computer Science',
    country: 'uk',
    city: 'Manchester',
    level: 'pg',
    field: 'cs',
    duration: '1 year',
    tuitionLakh: 36,
    ieltsMin: 7,
    intakeMonths: [9],
    scholarship: 'Global Futures Scholarship £5,000',
    image: IMAGES.london,
  },
  {
    id: 'glasgow-msc-finance',
    university: 'University of Glasgow',
    shortUniversity: 'Glasgow',
    name: 'MSc Finance & Investment',
    country: 'uk',
    city: 'Glasgow',
    level: 'pg',
    field: 'finance',
    duration: '1 year',
    tuitionLakh: 33,
    ieltsMin: 6.5,
    intakeMonths: [9],
    scholarship: 'Global Leadership Scholarship £10,000',
    image: IMAGES.campusLawn,
  },
  {
    id: 'coventry-mba',
    university: 'Coventry University',
    shortUniversity: 'Coventry',
    name: 'MBA (Global)',
    country: 'uk',
    city: 'Coventry',
    level: 'mba',
    field: 'business',
    duration: '1 year',
    tuitionLakh: 20,
    ieltsMin: 6.5,
    intakeMonths: [1, 5, 9],
    scholarship: 'Vice-Chancellor scholarship £2,000 for early applicants',
    image: IMAGES.campusPath,
  },
  {
    id: 'birmingham-bsc-cs',
    university: 'University of Birmingham',
    shortUniversity: 'Birmingham',
    name: 'BSc Computer Science',
    country: 'uk',
    city: 'Birmingham',
    level: 'ug',
    field: 'cs',
    duration: '3 years',
    tuitionLakh: 29,
    ieltsMin: 6,
    intakeMonths: [9],
    scholarship: 'Global Excellence Scholarship £4,000 / year',
    image: IMAGES.library,
  },
  {
    id: 'waterloo-meng-ece',
    university: 'University of Waterloo',
    shortUniversity: 'Waterloo',
    name: 'MEng Electrical & Computer Eng.',
    country: 'canada',
    city: 'Waterloo, Ontario',
    level: 'pg',
    field: 'engineering',
    duration: '16 months',
    tuitionLakh: 30,
    ieltsMin: 7,
    intakeMonths: [1, 5, 9],
    scholarship: 'International Master’s Award of Excellence',
    image: IMAGES.canada,
  },
  {
    id: 'humber-pgc-business',
    university: 'Humber Polytechnic',
    shortUniversity: 'Humber',
    name: 'PG Certificate, Business Management',
    country: 'canada',
    city: 'Toronto',
    level: 'pg',
    field: 'business',
    duration: '1 year',
    tuitionLakh: 11,
    ieltsMin: 6.5,
    intakeMonths: [1, 5, 9],
    scholarship: 'International entrance scholarship up to CA$2,000',
    image: IMAGES.campusLawn,
  },
  {
    id: 'ubc-bsc-cs',
    university: 'University of British Columbia',
    shortUniversity: 'UBC',
    name: 'BSc Computer Science',
    country: 'canada',
    city: 'Vancouver',
    level: 'ug',
    field: 'cs',
    duration: '4 years',
    tuitionLakh: 30,
    ieltsMin: 6.5,
    intakeMonths: [9],
    scholarship: 'International Major Entrance Scholarship',
    image: IMAGES.canada,
  },
  {
    id: 'monash-mit',
    university: 'Monash University',
    shortUniversity: 'Monash',
    name: 'Master of Information Technology',
    country: 'australia',
    city: 'Melbourne',
    level: 'pg',
    field: 'cs',
    duration: '2 years',
    tuitionLakh: 30,
    ieltsMin: 6.5,
    intakeMonths: [2, 7],
    scholarship: 'Monash International Merit Scholarship A$10,000 / year',
    image: IMAGES.sydney,
  },
  {
    id: 'melbourne-meng',
    university: 'University of Melbourne',
    shortUniversity: 'Melbourne',
    name: 'Master of Engineering',
    country: 'australia',
    city: 'Melbourne',
    level: 'pg',
    field: 'engineering',
    duration: '3 years',
    tuitionLakh: 33,
    ieltsMin: 6.5,
    intakeMonths: [2, 7],
    scholarship: 'Melbourne Graduate Scholarship (fee remission)',
    image: IMAGES.campusRed,
  },
  {
    id: 'deakin-mba',
    university: 'Deakin University',
    shortUniversity: 'Deakin',
    name: 'Master of Business Administration',
    country: 'australia',
    city: 'Melbourne',
    level: 'mba',
    field: 'business',
    duration: '2 years',
    tuitionLakh: 25,
    ieltsMin: 6.5,
    intakeMonths: [3, 7, 11],
    scholarship: 'Deakin Vice-Chancellor’s International Scholarship (up to 100%)',
    image: IMAGES.sydney,
  },
  {
    id: 'tum-msc-informatics',
    university: 'Technical University of Munich',
    shortUniversity: 'TU Munich',
    name: 'MSc Informatics',
    country: 'germany',
    city: 'Munich',
    level: 'pg',
    field: 'cs',
    duration: '2 years',
    tuitionLakh: 0,
    ieltsMin: 6.5,
    intakeMonths: [4, 10],
    scholarship: 'DAAD study scholarship (€992 / month)',
    image: IMAGES.germany,
  },
  {
    id: 'rwth-msc-mech',
    university: 'RWTH Aachen University',
    shortUniversity: 'RWTH Aachen',
    name: 'MSc Mechanical Engineering',
    country: 'germany',
    city: 'Aachen',
    level: 'pg',
    field: 'engineering',
    duration: '2 years',
    tuitionLakh: 0,
    ieltsMin: 6.5,
    intakeMonths: [4, 10],
    scholarship: 'Deutschlandstipendium €300 / month',
    image: IMAGES.germany,
  },
  {
    id: 'asu-ms-cs',
    university: 'Arizona State University',
    shortUniversity: 'ASU',
    name: 'MS Computer Science',
    country: 'usa',
    city: 'Tempe, Arizona',
    level: 'pg',
    field: 'cs',
    duration: '2 years',
    tuitionLakh: 28,
    ieltsMin: 6.5,
    intakeMonths: [1, 8],
    scholarship: 'Graduate assistantships with tuition waiver',
    image: IMAGES.liberty,
  },
  {
    id: 'northeastern-ms-da',
    university: 'Northeastern University',
    shortUniversity: 'Northeastern',
    name: 'MS Data Analytics Engineering',
    country: 'usa',
    city: 'Boston',
    level: 'pg',
    field: 'data',
    duration: '2 years',
    tuitionLakh: 38,
    ieltsMin: 6.5,
    intakeMonths: [1, 9],
    scholarship: 'Dean’s scholarship up to 25% of tuition',
    image: IMAGES.newYork,
  },
  {
    id: 'uic-ms-ba',
    university: 'University of Illinois Chicago',
    shortUniversity: 'UIC',
    name: 'MS Business Analytics',
    country: 'usa',
    city: 'Chicago',
    level: 'pg',
    field: 'data',
    duration: '1.5 years',
    tuitionLakh: 27,
    ieltsMin: 6.5,
    intakeMonths: [1, 8],
    scholarship: 'Liautaud merit awards up to US$10,000',
    image: IMAGES.liberty,
  },
  {
    id: 'ucd-msc-ba',
    university: 'University College Dublin',
    shortUniversity: 'UCD',
    name: 'MSc Business Analytics',
    country: 'ireland',
    city: 'Dublin',
    level: 'pg',
    field: 'data',
    duration: '1 year',
    tuitionLakh: 25,
    ieltsMin: 6.5,
    intakeMonths: [9],
    scholarship: 'Global Excellence Scholarship 50% of tuition',
    image: IMAGES.dublin,
  },
  {
    id: 'tcd-msc-cs',
    university: 'Trinity College Dublin',
    shortUniversity: 'Trinity',
    name: 'MSc Computer Science',
    country: 'ireland',
    city: 'Dublin',
    level: 'pg',
    field: 'cs',
    duration: '1 year',
    tuitionLakh: 27,
    ieltsMin: 6.5,
    intakeMonths: [9],
    scholarship: 'Global Excellence Postgraduate Scholarship €5,000',
    image: IMAGES.dublin,
  },
];

export interface Scholarship {
  readonly id: string;
  readonly title: string;
  readonly countries: readonly CountryId[];
  readonly summary: string;
  readonly detail: string;
  /** Official page; null when it varies by university. */
  readonly url: string | null;
}

export const SCHOLARSHIPS: readonly Scholarship[] = [
  {
    id: 'chevening',
    title: 'Chevening (UK)',
    countries: ['uk'],
    summary: "Fully funded 1-year master's",
    detail:
      "The UK government's flagship award: tuition, living allowance, flights and visa for a 1-year master's. Needs 2 years of work experience. Applications usually open in August and close in early November.",
    url: 'https://www.chevening.org/scholarships/',
  },
  {
    id: 'great',
    title: 'GREAT Scholarships (UK)',
    countries: ['uk'],
    summary: '£10,000 towards tuition',
    detail:
      'Funded by the British Council and UK universities for Indian students: at least £10,000 towards a 1-year postgraduate course. Each university sets its own deadline, usually in spring.',
    url: 'https://study-uk.britishcouncil.org/scholarships-funding/great-scholarships',
  },
  {
    id: 'fulbright',
    title: 'Fulbright-Nehru (USA)',
    countries: ['usa'],
    summary: "Fully funded master's in the US",
    detail:
      "USIEF's Fulbright-Nehru Master's Fellowships cover tuition, living costs and travel for Indian professionals with 3 years of work experience. Applications typically close in May for the next year.",
    url: 'https://www.usief.org.in/',
  },
  {
    id: 'daad',
    title: 'DAAD (Germany)',
    countries: ['germany'],
    summary: '€992 a month + travel',
    detail:
      "DAAD's study scholarships for graduates pay a monthly stipend, health insurance and travel. Public universities in Germany charge no tuition, so DAAD covers most living costs.",
    url: 'https://www.daad.in/en/',
  },
  {
    id: 'goi-ies',
    title: 'Government of Ireland (IES)',
    countries: ['ireland'],
    summary: '€10,000 stipend + fee waiver',
    detail:
      'The Government of Ireland International Education Scholarship gives 60 students a €10,000 stipend and a full tuition waiver for one year of study in Ireland.',
    url: 'https://hea.ie/policy/internationalisation/goi-ies/',
  },
  {
    id: 'university-merit',
    title: 'University merit awards',
    countries: ['uk', 'canada', 'australia', 'usa', 'ireland'],
    summary: 'Automatic for strong profiles',
    detail:
      'Most partner universities give automatic merit scholarships of 10–50% of tuition to early applicants with strong grades. Your counsellor checks every one you qualify for when shortlisting.',
    url: null,
  },
];

export interface Counsellor {
  readonly id: string;
  readonly name: string;
  readonly countries: readonly CountryId[];
  readonly bio: string;
}

/** Also the counsellor for students who have not picked a country yet. */
const PRIYA: Counsellor = {
  id: 'priya',
  name: 'Priya Sharma',
  countries: ['uk', 'ireland'],
  bio: 'UK & Ireland admissions, 9 years. Former university admissions officer.',
};

export const COUNSELLORS: readonly Counsellor[] = [
  PRIYA,
  {
    id: 'rohan',
    name: 'Rohan Mehta',
    countries: ['usa', 'canada'],
    bio: 'USA & Canada, 7 years. GRE strategy and assistantship applications.',
  },
  {
    id: 'ananya',
    name: 'Ananya Iyer',
    countries: ['australia', 'germany'],
    bio: 'Australia & Germany, 6 years. APS, blocked account and visa files.',
  },
];

export const DOCUMENTS = [
  { id: 'passport', title: 'Passport', hint: 'First and last page', levels: ['ug', 'pg', 'mba'] },
  { id: 'class10', title: 'Class 10 marksheet', hint: 'Board marksheet', levels: ['ug', 'pg', 'mba'] },
  { id: 'class12', title: 'Class 12 marksheet', hint: 'Board marksheet', levels: ['ug', 'pg', 'mba'] },
  { id: 'degree', title: 'Degree transcripts', hint: 'All semesters + certificate', levels: ['pg', 'mba'] },
  { id: 'english', title: 'IELTS / PTE score', hint: 'Test report form', levels: ['ug', 'pg', 'mba'] },
  {
    id: 'sop',
    title: 'Statement of purpose',
    hint: 'Draft is fine, we review it',
    levels: ['ug', 'pg', 'mba'],
  },
  {
    id: 'lor',
    title: 'Recommendation letters',
    hint: 'Two, academic or employer',
    levels: ['ug', 'pg', 'mba'],
  },
  { id: 'resume', title: 'Resume / CV', hint: 'Work experience for PG/MBA', levels: ['pg', 'mba'] },
  {
    id: 'funds',
    title: 'Proof of funds',
    hint: 'Bank statement or loan letter',
    levels: ['ug', 'pg', 'mba'],
  },
] as const;

export type DocumentId = (typeof DOCUMENTS)[number]['id'];

/** Application processing fee per university, paise. */
export const APPLICATION_FEE = 250000;

export function findProgram(id: string): Program | undefined {
  return PROGRAMS.find((program) => program.id === id);
}

export function findCountry(id: string): (typeof COUNTRIES)[number] | undefined {
  return COUNTRIES.find((country) => country.id === id);
}

export function counsellorFor(country: string | null): Counsellor {
  const match = COUNSELLORS.find((counsellor) => counsellor.countries.some((entry) => entry === country));
  return match ?? PRIYA;
}

export function documentsFor(level: LevelId | null): readonly (typeof DOCUMENTS)[number][] {
  const effective = level ?? 'pg';
  return DOCUMENTS.filter((document) => (document.levels as readonly string[]).includes(effective));
}

export function findDocument(id: string): (typeof DOCUMENTS)[number] | undefined {
  return DOCUMENTS.find((document) => document.id === id);
}

/** "₹31 lakh / year (indicative)" or "No tuition". */
export function tuitionLabel(program: Program): string {
  return program.tuitionLakh === 0 ? 'No tuition fee' : `~₹${program.tuitionLakh} lakh / year`;
}
