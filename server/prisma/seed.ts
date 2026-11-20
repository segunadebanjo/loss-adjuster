/**
 * Development seed: realistic but FICTIONAL Nigerian insurance data (no real insurer, broker or insured).
 * Wipes every table first, so it refuses to run in production. Every user's password is SEED_PASSWORD.
 *
 *   npm run db:seed -w server
 */
import bcrypt from "bcryptjs";
import { PrismaClient, type ClaimStatus, type PolicyType, type Role } from "@prisma/client";
import { toKobo, fromKobo } from "../src/lib/money.js";

const prisma = new PrismaClient();

if (process.env.NODE_ENV === "production") {
  console.error("Refusing to seed: NODE_ENV is production and the seed deletes every row.");
  process.exit(1);
}
const PASSWORD = process.env.SEED_PASSWORD || "Password123!";
const TODAY = new Date("2026-11-20T00:00:00Z");

const day = (iso: string) => new Date(`${iso}T00:00:00Z`);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const naira = (n: number) => fromKobo(toKobo(n.toFixed(2)));

// The workflow order; a seeded claim's history walks this path up to its status.
const PATH: ClaimStatus[] = [
  "NEW_INSTRUCTION",
  "INSPECTION_SCHEDULED",
  "UNDER_INVESTIGATION",
  "PRELIM_REPORT_SUBMITTED",
  "AWAITING_DOCUMENTS",
  "FINAL_REPORT_DRAFTED",
  "PENDING_SIGNOFF",
  "SETTLED",
];

async function wipe() {
  // Children first.
  await prisma.auditLog.deleteMany();
  await prisma.feeNote.deleteMany();
  await prisma.report.deleteMany();
  await prisma.valuationItem.deleteMany();
  await prisma.evidenceFile.deleteMany();
  await prisma.inspection.deleteMany();
  await prisma.claimStatusHistory.deleteMany();
  await prisma.claim.deleteMany();
  await prisma.claimSequence.deleteMany();
  await prisma.policy.deleteMany();
  await prisma.refreshToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.organisation.deleteMany();
  await prisma.slaTarget.deleteMany();
}

async function main() {
  await wipe();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);

  // --- SLA targets (CLAUDE.md section 4; editable by an admin later) ---
  await prisma.slaTarget.createMany({
    data: [
      { key: "INSPECTION", label: "Site inspection after instruction", targetDays: 2, businessDays: true },
      { key: "PRELIM_REPORT", label: "Preliminary report after instruction", targetDays: 7, businessDays: false },
      { key: "FINAL_REPORT", label: "Final report after documents complete", targetDays: 14, businessDays: false },
      { key: "SIGNOFF", label: "Principal sign-off after final report", targetDays: 3, businessDays: true },
    ],
  });

  // --- Organisations (fictional) ---
  const org = async (name: string, type: "INSURER" | "BROKER", extra: Record<string, string>) =>
    prisma.organisation.create({ data: { name, type, ...extra } });
  const lagoon = await org("Lagoon Assurance Plc", "INSURER", {
    naicomLicenceNo: "RIC-041",
    email: "claims@lagoonassurance.example",
    phone: "+2348011112222",
    address: "14 Adeola Odeku Street, Victoria Island, Lagos",
  });
  const delta = await org("Niger Delta General Insurance Ltd", "INSURER", {
    naicomLicenceNo: "RIC-077",
    email: "claims@ndgi.example",
    phone: "+2348033334444",
    address: "22 Aba Road, Port Harcourt, Rivers",
  });
  const sahel = await org("Sahel Mutual Insurance Plc", "INSURER", {
    naicomLicenceNo: "RIC-112",
    email: "claims@sahelmutual.example",
    phone: "+2348055556666",
    address: "5 Bompai Road, Kano",
  });
  const marina = await org("Marina Insurance Brokers Ltd", "BROKER", {
    naicomLicenceNo: "BRK-0388",
    email: "operations@marinabrokers.example",
    phone: "+2348077778888",
    address: "3 Marina, Lagos Island, Lagos",
  });
  const capital = await org("Capital Risk Brokers Ltd", "BROKER", {
    naicomLicenceNo: "BRK-0521",
    email: "claims@capitalrisk.example",
    phone: "+2348099990000",
    address: "Plot 1102 Cadastral Zone, Wuse II, Abuja",
  });

  // --- Users ---
  const user = (fullName: string, email: string, role: Role, extra: Record<string, unknown> = {}) =>
    prisma.user.create({ data: { fullName, email, role, passwordHash, ...extra } });

  const principal = await user("Olufemi Adeyemi", "principal@pinnacle-adjusters.example", "ADMIN", {
    phone: "+2348020000001",
    naicomLicenseNo: "LA/2011/0147",
    ciiQualification: "FCII",
  });
  const chiamaka = await user("Chiamaka Eze", "chiamaka.eze@pinnacle-adjusters.example", "ADJUSTER", {
    phone: "+2348020000002",
    naicomLicenseNo: "LA/2016/0392",
    ciiQualification: "ACII",
  });
  const ibrahim = await user("Ibrahim Musa", "ibrahim.musa@pinnacle-adjusters.example", "ADJUSTER", {
    phone: "+2348020000003",
    naicomLicenseNo: "LA/2018/0455",
    ciiQualification: "AIIN",
  });
  const tamuno = await user("Tamunotonye Briggs", "tamuno.briggs@pinnacle-adjusters.example", "ADJUSTER", {
    phone: "+2348020000004",
    naicomLicenseNo: "LA/2014/0301",
    ciiQualification: "ACII",
  });
  const funmi = await user("Funmilayo Ogunleye", "funmi.ogunleye@pinnacle-adjusters.example", "ADJUSTER", {
    phone: "+2348020000005",
    naicomLicenseNo: "LA/2020/0518",
    ciiQualification: "AIIN",
  });
  await user("Ngozi Okafor", "ngozi.okafor@lagoonassurance.example", "INSURER", {
    organisationId: lagoon.id,
    phone: "+2348030000010",
  });
  await user("Ebiere Douglas", "ebiere.douglas@ndgi.example", "INSURER", {
    organisationId: delta.id,
    phone: "+2348030000011",
  });
  await user("Aminu Bello", "aminu.bello@sahelmutual.example", "INSURER", {
    organisationId: sahel.id,
    phone: "+2348030000012",
  });
  await user("Kunle Bakare", "kunle.bakare@marinabrokers.example", "INSURER", {
    organisationId: marina.id,
    phone: "+2348030000013",
  });
  // An inactive account, to show that deactivated users can't sign in.
  await user("Segun Alabi", "segun.alabi@pinnacle-adjusters.example", "ADJUSTER", {
    isActive: false,
    ciiQualification: "AIIN",
  });

  // --- Policies ---
  interface PolicySeed {
    no: string;
    uid: string;
    insurer: typeof lagoon;
    broker?: typeof marina;
    insured: string;
    contact: string;
    type: PolicyType;
    sumInsured: number;
    excessAmount: number;
    excessPct: number;
    start: string;
  }
  const policySeeds: PolicySeed[] = [
    { no: "LAP/MTR/2026/004512", uid: "NUID-MTR-26-00045120", insurer: lagoon, broker: marina, insured: "Adaeze Nwosu", contact: "+2348061234567, adaeze.nwosu@mail.example", type: "MOTOR", sumInsured: 28_500_000, excessAmount: 50_000, excessPct: 5, start: "2026-02-01" },
    { no: "LAP/FIR/2026/000873", uid: "NUID-FIR-26-00008730", insurer: lagoon, broker: marina, insured: "Ikeja Plastics Manufacturing Ltd", contact: "Mr. Tunde Ajayi (Fin. Controller), +2348022223333", type: "PROPERTY_FIRE", sumInsured: 450_000_000, excessAmount: 500_000, excessPct: 10, start: "2026-01-01" },
    { no: "LAP/MCG/2026/001290", uid: "NUID-MCG-26-00012900", insurer: lagoon, insured: "Apapa Agro Commodities Ltd", contact: "+2348098887777, imports@apapaagro.example", type: "MARINE_CARGO", sumInsured: 96_000_000, excessAmount: 250_000, excessPct: 2.5, start: "2026-06-15" },
    { no: "NDG/ONG/2026/000041", uid: "NUID-ONG-26-00000410", insurer: delta, broker: capital, insured: "Bonny Coastal Energy Services Ltd", contact: "HSE Manager, +2348035550001", type: "OIL_AND_GAS", sumInsured: 2_400_000_000, excessAmount: 10_000_000, excessPct: 10, start: "2026-03-01" },
    { no: "NDG/CAR/2026/000188", uid: "NUID-CAR-26-00001880", insurer: delta, insured: "Trans-Amadi Builders Ltd", contact: "+2348036660002, projects@transamadi.example", type: "ENGINEERING_CAR", sumInsured: 780_000_000, excessAmount: 2_500_000, excessPct: 10, start: "2026-04-10" },
    { no: "NDG/MTR/2026/007730", uid: "NUID-MTR-26-00077300", insurer: delta, insured: "Rivers Haulage & Logistics Ltd", contact: "Fleet Manager, +2348037770003", type: "MOTOR", sumInsured: 62_000_000, excessAmount: 100_000, excessPct: 10, start: "2026-01-20" },
    { no: "SMI/FIR/2026/000315", uid: "NUID-FIR-26-00003150", insurer: sahel, broker: capital, insured: "Sabon Gari Textiles Ltd", contact: "Alhaji Usman Garba, +2348038880004", type: "PROPERTY_FIRE", sumInsured: 320_000_000, excessAmount: 1_000_000, excessPct: 10, start: "2026-02-15" },
    { no: "SMI/GA/2026/002201", uid: "NUID-GAC-26-00022010", insurer: sahel, insured: "Kano Cash Logistics Ltd (Cash-in-Transit)", contact: "+2348039990005", type: "GENERAL_ACCIDENT", sumInsured: 45_000_000, excessAmount: 250_000, excessPct: 5, start: "2026-05-01" },
    { no: "SMI/MTR/2026/010044", uid: "NUID-MTR-26-00100440", insurer: sahel, broker: capital, insured: "Dr. Halima Abubakar", contact: "+2348031110006", type: "MOTOR", sumInsured: 19_000_000, excessAmount: 25_000, excessPct: 5, start: "2026-07-01" },
    { no: "LAP/FIR/2026/000951", uid: "NUID-FIR-26-00009510", insurer: lagoon, broker: capital, insured: "Wuse Plaza Retail Ltd", contact: "+2348032220007, facilities@wuseplaza.example", type: "PROPERTY_FIRE", sumInsured: 210_000_000, excessAmount: 500_000, excessPct: 10, start: "2026-03-20" },
  ];
  const policies = new Map<string, number>();
  for (const p of policySeeds) {
    const start = day(p.start);
    const created = await prisma.policy.create({
      data: {
        policyNumber: p.no,
        naicomUid: p.uid,
        insurerOrgId: p.insurer.id,
        brokerOrgId: p.broker?.id ?? null,
        insurerName: p.insurer.name,
        brokerName: p.broker?.name ?? null,
        insuredName: p.insured,
        insuredContact: p.contact,
        policyType: p.type,
        sumInsured: naira(p.sumInsured),
        excessAmount: naira(p.excessAmount),
        excessPercentage: p.excessPct.toFixed(2),
        startDate: start,
        endDate: addDays(start, 364),
      },
    });
    policies.set(p.no, created.id);
  }

  // --- Claims ---
  interface ClaimSeed {
    policy: string;
    adjuster: typeof chiamaka | null;
    loss: string;
    instructed: string;
    state: string;
    lga: string;
    address: string;
    description: string;
    status: ClaimStatus;
    reserve: number;
    valueAtRisk?: number;
    applyAverage?: boolean;
    recommended?: number;
    fee?: number;
    insurerClaimNo?: string;
    repudiation?: string;
    items?: Array<[string, string, number, number, number, number, string?]>;
  }
  const claimSeeds: ClaimSeed[] = [
    {
      policy: "LAP/MTR/2026/004512", adjuster: chiamaka, loss: "2026-08-03", instructed: "2026-08-05", state: "Lagos", lga: "Eti-Osa",
      address: "Lekki-Epe Expressway by Chevron roundabout, Lekki", status: "SETTLED", reserve: 4_500_000,
      description: "Insured's Toyota Highlander (2021) was hit from behind by a commercial bus in heavy traffic, damaging the rear bumper, tailgate, both tail lamps and rear sensors. Police extract obtained from Maroko division.",
      recommended: 3_120_000, fee: 350_000, insurerClaimNo: "LAP-CLM-26-1187",
      items: [
        ["Rear bumper assembly", "Motor Parts", 850_000, 780_000, 0, 0],
        ["Tailgate (panel beating and respray)", "Motor Parts", 1_200_000, 950_000, 0, 0],
        ["Tail lamps (pair), genuine", "Motor Parts", 960_000, 920_000, 0, 0],
        ["Parking sensors (4)", "Motor Parts", 420_000, 380_000, 60_000, 0],
        ["Labour and paint", "Labor", 300_000, 200_000, 0, 0],
      ],
    },
    {
      policy: "LAP/FIR/2026/000873", adjuster: chiamaka, loss: "2026-09-14", instructed: "2026-09-15", state: "Lagos", lga: "Ikeja",
      address: "Plot 7, Oregun Industrial Estate, Ikeja", status: "PENDING_SIGNOFF", reserve: 180_000_000, valueAtRisk: 520_000_000, applyAverage: true,
      description: "Fire started in the raw-materials store at about 02:30, reportedly from an electrical fault during a power surge after grid restoration. Lagos State Fire Service attended; store building, two injection-moulding machines and stock were affected.",
      recommended: 101_350_000, fee: 4_500_000, insurerClaimNo: "LAP-CLM-26-1402",
      items: [
        ["Raw-materials store: roof, walls and electrical reinstatement", "Building/Civil Works", 48_000_000, 41_500_000, 6_200_000, 0],
        ["Injection-moulding machine No. 3 (Haitian 280T)", "Plant & Machinery", 62_000_000, 54_000_000, 8_100_000, 2_000_000],
        ["Injection-moulding machine No. 4 control panel", "Plant & Machinery", 14_500_000, 12_800_000, 1_900_000, 0],
        ["Polypropylene resin stock (182 bags)", "Stock & Contents", 38_000_000, 33_600_000, 0, 0],
        ["Debris removal", "Labor", 4_200_000, 3_500_000, 0, 0],
        ["Salvage: scrap metal sold", "Salvage Recovery", 0, 2_400_000, 0, 0],
      ],
    },
    {
      policy: "LAP/MCG/2026/001290", adjuster: ibrahim, loss: "2026-10-02", instructed: "2026-10-06", state: "Lagos", lga: "Apapa",
      address: "Apapa Port, Terminal C, Wharf Road", status: "AWAITING_DOCUMENTS", reserve: 22_000_000,
      description: "Consignment of 2,400 bags of parboiled rice discharged from MV Atlantic Star with 310 bags wet-damaged by seawater. Survey requested at the terminal before delivery to the insured's warehouse.",
      insurerClaimNo: "LAP-CLM-26-1561",
    },
    {
      policy: "NDG/ONG/2026/000041", adjuster: tamuno, loss: "2026-09-21", instructed: "2026-09-23", state: "Rivers", lga: "Bonny",
      address: "Finima Jetty Support Base, Bonny Island", status: "UNDER_INVESTIGATION", reserve: 650_000_000,
      description: "Crane collapse during lifting operations at the support base damaged the crane, a supply vessel's deck and adjoining pipe racks. One worker injured; DPR/NUPRC notified. Cause of collapse under investigation (suspected wire-rope failure).",
      insurerClaimNo: "NDG-CLM-26-0094",
    },
    {
      policy: "NDG/CAR/2026/000188", adjuster: tamuno, loss: "2026-10-18", instructed: "2026-10-20", state: "Rivers", lga: "Port Harcourt",
      address: "Trans-Amadi Industrial Layout, Plot 44", status: "PRELIM_REPORT_SUBMITTED", reserve: 85_000_000,
      description: "Heavy rainfall caused partial collapse of excavation shoring on a 4-storey office project; basement formwork and reinforcement damaged and a section of the site flooded.",
    },
    {
      policy: "NDG/MTR/2026/007730", adjuster: ibrahim, loss: "2026-11-09", instructed: "2026-11-12", state: "Rivers", lga: "Obio/Akpor",
      address: "East-West Road near Rumuokoro flyover", status: "INSPECTION_SCHEDULED", reserve: 9_500_000,
      description: "Insured's Mack truck (fleet No. RH-17) overturned while avoiding a pothole; cab and trailer damaged. Cargo (empty containers) unaffected.",
    },
    {
      policy: "SMI/FIR/2026/000315", adjuster: funmi, loss: "2026-07-27", instructed: "2026-07-29", state: "Kano", lga: "Fagge",
      address: "12 Ibrahim Taiwo Road, Sabon Gari", status: "FINAL_REPORT_DRAFTED", reserve: 95_000_000, valueAtRisk: 400_000_000, applyAverage: true,
      description: "Fire spread from a neighbouring warehouse to the insured's finished-goods store; 1,150 bales of printed fabric destroyed. Kano State Fire Service report obtained.",
      recommended: 63_400_000, fee: 3_200_000,
      items: [
        ["Finished goods: printed fabric (1,150 bales)", "Stock & Contents", 86_000_000, 79_000_000, 0, 0],
        ["Store roof and steel trusses", "Building/Civil Works", 9_000_000, 7_400_000, 1_100_000, 0],
        ["Salvage: smoke-damaged bales sold at 20%", "Salvage Recovery", 0, 3_200_000, 0, 0],
      ],
    },
    {
      policy: "SMI/GA/2026/002201", adjuster: funmi, loss: "2026-10-30", instructed: "2026-11-02", state: "Kano", lga: "Nassarawa",
      address: "Zaria Road by Gadon Kaya junction", status: "REPUDIATED", reserve: 18_000_000,
      description: "Alleged robbery of cash-in-transit van carrying ₦17.6m. Investigation found the van travelled without the armed escort required by the policy's security warranty.",
      repudiation: "Breach of the armed-escort warranty: the cash was carried without the police escort the policy requires for sums above ₦5,000,000.",
    },
    {
      policy: "SMI/MTR/2026/010044", adjuster: null, loss: "2026-11-17", instructed: "2026-11-19", state: "FCT", lga: "Abuja Municipal",
      address: "Aminu Kano Crescent, Wuse II", status: "NEW_INSTRUCTION", reserve: 2_800_000,
      description: "Insured's Honda Accord was damaged by a falling billboard during a rainstorm while parked; windscreen, roof and bonnet affected.",
    },
    {
      policy: "LAP/FIR/2026/000951", adjuster: chiamaka, loss: "2026-11-14", instructed: "2026-11-16", state: "FCT", lga: "Abuja Municipal",
      address: "Wuse Plaza, Plot 233 Adetokunbo Ademola Crescent, Wuse II", status: "INSPECTION_SCHEDULED", reserve: 25_000_000,
      description: "Burst sprinkler main flooded the ground-floor retail units; stock, shop fit-outs and ceiling boards damaged.",
    },
    {
      policy: "LAP/MTR/2026/004512", adjuster: ibrahim, loss: "2026-11-15", instructed: "2026-11-18", state: "Lagos", lga: "Lagos Mainland",
      address: "Third Mainland Bridge, Oworonshoki end", status: "NEW_INSTRUCTION", reserve: 1_200_000,
      description: "Side-mirror and front-door damage from a hit-and-run by a motorcycle (okada). Second claim on this policy this year.",
    },
    {
      policy: "NDG/MTR/2026/007730", adjuster: tamuno, loss: "2026-08-22", instructed: "2026-08-25", state: "Delta", lga: "Warri South",
      address: "NPA Expressway, Warri", status: "SETTLED", reserve: 6_000_000,
      description: "Truck (fleet No. RH-09) collided with a road barrier at night; front axle and radiator damaged.",
      recommended: 4_050_000, fee: 420_000,
      items: [
        ["Front axle assembly", "Motor Parts", 2_800_000, 2_500_000, 400_000, 0],
        ["Radiator and hoses", "Motor Parts", 950_000, 820_000, 0, 0],
        ["Labour and towing", "Labor", 1_100_000, 900_000, 0, 0],
      ],
    },
    {
      policy: "SMI/FIR/2026/000315", adjuster: funmi, loss: "2026-11-01", instructed: "2026-11-04", state: "Kano", lga: "Fagge",
      address: "12 Ibrahim Taiwo Road, Sabon Gari", status: "UNDER_INVESTIGATION", reserve: 12_000_000,
      description: "Roof sheets and solar panels blown off the administrative block during a windstorm; rainwater damaged office equipment.",
    },
    {
      policy: "NDG/CAR/2026/000188", adjuster: tamuno, loss: "2026-11-11", instructed: "2026-11-13", state: "Rivers", lga: "Port Harcourt",
      address: "Trans-Amadi Industrial Layout, Plot 44", status: "INSPECTION_SCHEDULED", reserve: 15_000_000,
      description: "Theft of reinforcement bars and a concrete vibrator from the site store over a weekend; security guard's statement and police report pending.",
    },
    {
      policy: "LAP/MCG/2026/001290", adjuster: ibrahim, loss: "2026-11-06", instructed: "2026-11-10", state: "Ogun", lga: "Ado-Odo/Ota",
      address: "Lagos-Abeokuta Expressway, Sango-Ota", status: "UNDER_INVESTIGATION", reserve: 8_400_000,
      description: "Truck carrying 600 cartons of vegetable oil from Apapa overturned in transit; about 140 cartons damaged or looted.",
    },
  ];

  const seq = new Map<number, number>();
  for (const c of claimSeeds) {
    const instructed = day(c.instructed);
    const year = instructed.getUTCFullYear();
    const n = (seq.get(year) ?? 0) + 1;
    seq.set(year, n);
    const claimReference = `LA-${year}-${String(n).padStart(4, "0")}`;
    const closed = c.status === "SETTLED" || c.status === "REPUDIATED";

    const claim = await prisma.claim.create({
      data: {
        claimReference,
        policyId: policies.get(c.policy)!,
        assignedAdjusterId: c.adjuster?.id ?? null,
        insurerClaimNo: c.insurerClaimNo ?? null,
        dateOfLoss: day(c.loss),
        dateInstructed: instructed,
        lossState: c.state,
        lossLga: c.lga,
        lossAddress: c.address,
        incidentDescription: c.description,
        status: c.status,
        initialReserve: naira(c.reserve),
        valueAtRisk: c.valueAtRisk != null ? naira(c.valueAtRisk) : null,
        applyAverage: c.applyAverage ?? false,
        recommendedSettlement: c.recommended != null ? naira(c.recommended) : null,
        settledAmount: c.status === "SETTLED" && c.recommended != null ? naira(c.recommended) : null,
        adjusterFee: c.fee != null ? naira(c.fee) : null,
        repudiationReason: c.repudiation ?? null,
        closedAt: closed ? addDays(instructed, 40) : null,
        createdAt: instructed,
      },
    });

    // Status history: walk the workflow up to the claim's status, a few days per step, never past today.
    const target = c.status === "REPUDIATED" ? "UNDER_INVESTIGATION" : c.status;
    const steps = PATH.slice(0, PATH.indexOf(target) + 1);
    if (c.status === "REPUDIATED") steps.push("REPUDIATED");
    let at = instructed;
    let prev: ClaimStatus | null = null;
    for (const [i, s] of steps.entries()) {
      if (i > 0) at = addDays(at, i === 1 ? 1 : 4);
      if (at > TODAY) at = TODAY;
      await prisma.claimStatusHistory.create({
        data: {
          claimId: claim.id,
          fromStatus: prev,
          toStatus: s,
          changedById: s === "SETTLED" || s === "REPUDIATED" || s === "NEW_INSTRUCTION" ? principal.id : c.adjuster?.id ?? principal.id,
          reason: s === "REPUDIATED" ? c.repudiation ?? null : null,
          changedAt: at,
        },
      });
      prev = s;
    }

    // An inspection for every claim past NEW_INSTRUCTION; completed once investigation has started.
    if (c.adjuster && c.status !== "NEW_INSTRUCTION") {
      const scheduled = addDays(instructed, 1);
      const completed = c.status !== "INSPECTION_SCHEDULED";
      await prisma.inspection.create({
        data: {
          claimId: claim.id,
          adjusterId: c.adjuster.id,
          scheduledDate: c.status === "INSPECTION_SCHEDULED" ? addDays(TODAY, 1) : scheduled,
          completedDate: completed ? scheduled : null,
          siteNotes: completed ? "Site visited with the insured's representative; damage photographed and measured." : null,
          causeOfLossVerified: completed,
          policyLiabilityConfirmed: completed && c.status !== "REPUDIATED",
          thirdPartyInvolvement: /bus|motorcycle|neighbouring|collided/.test(c.description),
        },
      });
    }

    // Schedule of loss lines: [description, category, claimed, assessed, depreciation, betterment].
    for (const [i, [desc, category, claimed, assessed, dep, bet]] of (c.items ?? []).entries()) {
      const net = category === "Salvage Recovery" ? assessed : Math.max(0, assessed - dep - bet);
      await prisma.valuationItem.create({
        data: {
          claimId: claim.id,
          itemDescription: desc,
          category,
          claimedAmount: naira(claimed),
          assessedAmount: naira(assessed),
          depreciationAmount: naira(dep),
          bettermentDeduction: naira(bet),
          netPayable: naira(net),
          sortOrder: i + 1,
        },
      });
    }

    await prisma.auditLog.create({
      data: {
        claimId: claim.id,
        userId: principal.id,
        action: "CLAIM_INSTRUCTED",
        entityType: "Claim",
        entityId: claim.id,
        details: { claimReference, source: "seed" },
        createdAt: instructed,
      },
    });
  }
  for (const [year, lastNo] of seq) await prisma.claimSequence.create({ data: { year, lastNo } });

  const counts = {
    organisations: await prisma.organisation.count(),
    users: await prisma.user.count(),
    policies: await prisma.policy.count(),
    claims: await prisma.claim.count(),
    valuationItems: await prisma.valuationItem.count(),
  };
  console.log("Seeded:", counts);
  console.log(`Sign in as ${principal.email} (or any seeded user) with password "${PASSWORD}".`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
