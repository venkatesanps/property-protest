// One-off: build sample PDF packets for 13705 Whistler Dr from LIVE Collin data,
// running it through the real engine. Run with: npx tsx scripts/gen-sample.ts
import { writeFileSync } from 'node:fs';
import type { SubjectProperty, Comp } from '../src/types';
import { computeCapFloor } from '../src/engine/cap';
import { computeEquity } from '../src/engine/equity';
import { computeVerdict } from '../src/engine/verdict';
import { generateBoardPacket, generatePersonalPacket } from '../src/pdf/packet';

const BASE = 'https://data.texas.gov/resource/vffy-snc6.json';
const num = (v?: string) => (v ? parseFloat(v) : 0);

async function soql<T>(where: string, select: string, limit: number): Promise<T[]> {
  const u = new URL(BASE);
  u.searchParams.set('$where', where);
  u.searchParams.set('$select', select);
  u.searchParams.set('$limit', String(limit));
  const r = await fetch(u.toString(), { headers: { Accept: 'application/json' } });
  if (!r.ok) throw new Error(`SODA ${r.status}`);
  return r.json() as Promise<T[]>;
}

interface Row {
  propid?: string;
  situsconcat?: string;
  imprvmainarea?: string;
  imprvyearbuilt?: string;
  imprvclasscd?: string;
  nbhdcode?: string;
  currvalappraised?: string;
  currvalmarket?: string;
  currvalland?: string;
  currvalimprv?: string;
  prevvalappraised?: string;
}

async function main() {
  const [s] = await soql<Row>(
    "situsbldgnum='13705' AND situsstreetname LIKE 'WHISTLER%' AND propcategorycode='A'",
    'propid,situsconcat,imprvmainarea,imprvyearbuilt,imprvclasscd,nbhdcode,currvalappraised,currvalmarket,currvalland,currvalimprv,prevvalappraised',
    5
  );
  const subject: SubjectProperty = {
    account: s.propid ?? '',
    address: s.situsconcat ?? '',
    county: 'collin',
    livingAreaSqft: num(s.imprvmainarea),
    yearBuilt: num(s.imprvyearbuilt),
    qualityClass: s.imprvclasscd ?? '',
    neighborhoodCode: s.nbhdcode ?? '',
    stateClass: 'A',
    appraisedValue: num(s.currvalappraised),
    marketValue: num(s.currvalmarket),
    netAppraisedValue: null,
    homesteadCapAmount: null,
    landValue: num(s.currvalland),
    improvementValue: num(s.currvalimprv),
    priorYearValue: s.prevvalappraised ? num(s.prevvalappraised) : null,
    lat: null,
    lng: null,
  };

  const rows = await soql<Row>(
    `nbhdcode='${subject.neighborhoodCode}' AND propcategorycode='A' AND imprvmainarea>0 AND currvalappraised>0`,
    'propid,situsconcat,imprvmainarea,imprvyearbuilt,imprvclasscd,currvalappraised,currvalland,currvalimprv',
    500
  );
  const comps: Comp[] = rows
    .filter((r) => r.propid !== subject.account)
    .map((r) => {
      const sqft = num(r.imprvmainarea);
      const appr = num(r.currvalappraised);
      return {
        account: r.propid ?? '',
        address: r.situsconcat ?? '',
        county: 'collin',
        livingAreaSqft: sqft,
        yearBuilt: num(r.imprvyearbuilt),
        qualityClass: r.imprvclasscd ?? '',
        appraisedValue: appr,
        pricePerSqft: sqft > 0 ? appr / sqft : 0,
        landValue: num(r.currvalland),
        improvementValue: num(r.currvalimprv),
        isRefined: false,
      };
    });

  const capFloor = computeCapFloor(subject);
  const equity = computeEquity(subject, comps);
  const market = null;
  const verdict = computeVerdict(subject, capFloor, equity, market);

  const analysis = { geocode: null, subject, capFloor, equity, market, purchase: null, rentcastError: null, verdict };
  writeFileSync(
    '/Users/venkatesanps/property-protest/sample-whistler-board.pdf',
    await generateBoardPacket(analysis)
  );
  writeFileSync(
    '/Users/venkatesanps/property-protest/sample-whistler-personal.pdf',
    await generatePersonalPacket(analysis)
  );
  console.log('subject:', subject.address, '| class', subject.qualityClass, '| nbhd', subject.neighborhoodCode);
  console.log('comps:', comps.length, '| verdict:', verdict.code, '| target:', verdict.targetValue, '| basis:', verdict.methodUsed);
  console.log('wrote sample-whistler-board.pdf + sample-whistler-personal.pdf');
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
