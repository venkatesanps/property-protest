import { useState } from 'react';
import type { County, ManualComp, AppStep } from './types';
import { runAnalysis } from './engine/run';
import type { AnalysisResult } from './engine/run';
import { CensusCorsBridgeError, countyFromZip } from './adapters/census';
import { generatePacket, downloadPacket } from './pdf/packet';
import { fmtUSD, fmtNum, fmtPsf } from './format';
import { DISCLAIMER, PROTEST_DEADLINE, COMPTROLLER_FORM } from './constants';

const STEP_LABEL: Record<AppStep, string> = {
  input: '',
  geocoding: 'Finding your county...',
  loading_property: 'Loading your property record...',
  loading_comps: 'Gathering neighborhood comparables...',
  results: '',
  error: '',
};

const RENTCAST_KEY_STORAGE = 'protest.rentcastKey';

function App() {
  const [address, setAddress] = useState('');
  const [step, setStep] = useState<AppStep>('input');
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [needCounty, setNeedCounty] = useState(false);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  // optional market inputs
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [rentcastKey, setRentcastKey] = useState(
    () => localStorage.getItem(RENTCAST_KEY_STORAGE) ?? ''
  );
  const [manualComps, setManualComps] = useState<ManualComp[]>([]);

  const busy = step === 'geocoding' || step === 'loading_property' || step === 'loading_comps';

  async function analyze(forceCounty?: County) {
    if (!address.trim()) {
      setError('Please enter a property address.');
      return;
    }
    setError(null);
    setNeedCounty(false);
    setResult(null);
    if (rentcastKey.trim()) localStorage.setItem(RENTCAST_KEY_STORAGE, rentcastKey.trim());

    try {
      const r = await runAnalysis({
        address: address.trim(),
        county: forceCounty,
        rentcastKey: rentcastKey.trim() || undefined,
        manualComps: manualComps.length ? manualComps : undefined,
        onStep: (s) => {
          setStep(s);
          setBusyLabel(STEP_LABEL[s]);
        },
      });
      setResult(r);
      setStep('results');
    } catch (err) {
      if (err instanceof CensusCorsBridgeError) {
        // geocoder blocked — let the user pick a county manually
        const zipMatch = address.match(/\b(\d{5})\b/);
        const guessed = zipMatch ? countyFromZip(zipMatch[1]) : 'unsupported';
        if (guessed !== 'unsupported') {
          await analyze(guessed);
          return;
        }
        setNeedCounty(true);
        setStep('input');
        return;
      }
      setError(err instanceof Error ? err.message : 'Something went wrong.');
      setStep('error');
    }
  }

  async function handleDownload() {
    if (!result) return;
    const bytes = await generatePacket(result);
    const safe = result.subject.address.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40) || 'property';
    downloadPacket(bytes, `protest_packet_${safe}.pdf`);
  }

  function addManualComp() {
    setManualComps((c) => [
      ...c,
      { address: '', salePrice: 0, saleDate: '', livingAreaSqft: 0, notes: '' },
    ]);
  }
  function updateComp(i: number, patch: Partial<ManualComp>) {
    setManualComps((c) => c.map((m, idx) => (idx === i ? { ...m, ...patch } : m)));
  }
  function removeComp(i: number) {
    setManualComps((c) => c.filter((_, idx) => idx !== i));
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="bg-slate-900 text-white">
        <div className="mx-auto max-w-4xl px-6 py-8">
          <h1 className="text-2xl font-bold sm:text-3xl">Texas Property Tax Protest Helper</h1>
          <p className="mt-2 text-slate-300">
            Collin &amp; Denton County (Frisco area). Enter your address to check whether protesting
            is worth it, and generate an evidence packet for Form {COMPTROLLER_FORM}.
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* ── Address form ─────────────────────────────────────────── */}
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <label htmlFor="addr" className="block text-sm font-semibold text-slate-700">
            Property address
          </label>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row">
            <input
              id="addr"
              type="text"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && !busy && analyze()}
              placeholder="1069 Angel Falls Drive, Frisco TX 75036"
              className="flex-1 rounded-lg border border-slate-300 px-4 py-2.5 text-slate-900 outline-none focus:border-slate-500 focus:ring-2 focus:ring-slate-200"
            />
            <button
              type="button"
              onClick={() => analyze()}
              disabled={busy}
              className="rounded-lg bg-slate-900 px-6 py-2.5 font-semibold text-white transition hover:bg-slate-700 disabled:opacity-50"
            >
              {busy ? 'Analyzing...' : 'Analyze'}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowAdvanced((v) => !v)}
            className="mt-3 text-sm text-slate-500 underline-offset-2 hover:underline"
          >
            {showAdvanced ? 'Hide' : 'Add'} market-value evidence (optional)
          </button>

          {showAdvanced && (
            <div className="mt-4 space-y-4 rounded-lg bg-slate-50 p-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700">
                  RentCast API key (optional, 50 free calls/mo)
                </label>
                <input
                  type="password"
                  value={rentcastKey}
                  onChange={(e) => setRentcastKey(e.target.value)}
                  placeholder="stored only in your browser"
                  className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-slate-500"
                />
                <p className="mt-1 text-xs text-slate-500">
                  May be blocked by the browser (CORS). If so, the app falls back to the manual
                  comps below.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-slate-700">
                    Manual comparable sales
                  </label>
                  <button
                    type="button"
                    onClick={addManualComp}
                    className="rounded bg-slate-200 px-3 py-1 text-xs font-semibold hover:bg-slate-300"
                  >
                    + Add comp
                  </button>
                </div>
                {manualComps.map((c, i) => (
                  <div key={i} className="mt-2 grid grid-cols-12 gap-2">
                    <input
                      className="col-span-5 rounded border border-slate-300 px-2 py-1 text-sm"
                      placeholder="Address"
                      value={c.address}
                      onChange={(e) => updateComp(i, { address: e.target.value })}
                    />
                    <input
                      className="col-span-3 rounded border border-slate-300 px-2 py-1 text-sm"
                      placeholder="Sale price"
                      type="number"
                      value={c.salePrice || ''}
                      onChange={(e) => updateComp(i, { salePrice: Number(e.target.value) })}
                    />
                    <input
                      className="col-span-3 rounded border border-slate-300 px-2 py-1 text-sm"
                      placeholder="SqFt"
                      type="number"
                      value={c.livingAreaSqft || ''}
                      onChange={(e) => updateComp(i, { livingAreaSqft: Number(e.target.value) })}
                    />
                    <button
                      type="button"
                      onClick={() => removeComp(i)}
                      className="col-span-1 rounded text-slate-400 hover:text-red-600"
                      aria-label="Remove"
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* county fallback */}
          {needCounty && (
            <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4">
              <p className="text-sm text-amber-800">
                We couldn't auto-detect your county (the Census geocoder is blocked from the
                browser). Select it manually:
              </p>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => analyze('collin')}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                >
                  Collin County
                </button>
                <button
                  type="button"
                  onClick={() => analyze('denton')}
                  className="rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
                >
                  Denton County
                </button>
              </div>
            </div>
          )}

          {busy && <p className="mt-4 text-sm text-slate-500">{busyLabel}</p>}
          {error && (
            <p className="mt-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>
          )}
        </section>

        {/* ── Results ──────────────────────────────────────────────── */}
        {result && <Results result={result} onDownload={handleDownload} />}

        <footer className="mt-10 text-center text-xs text-slate-400">{DISCLAIMER}</footer>
      </main>
    </div>
  );
}

// ─── Results dashboard ─────────────────────────────────────────────────────────

function Results({ result, onDownload }: { result: AnalysisResult; onDownload: () => void }) {
  const { subject, capFloor, equity, market, verdict } = result;
  const tone =
    verdict.code === 'protest'
      ? 'border-green-300 bg-green-50 text-green-900'
      : verdict.code === 'dont_protest'
        ? 'border-slate-300 bg-slate-100 text-slate-800'
        : 'border-amber-300 bg-amber-50 text-amber-900';

  return (
    <div className="mt-8 space-y-6">
      {/* verdict */}
      <section className={`rounded-xl border p-6 shadow-sm ${tone}`}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold">{verdict.headline}</h2>
            <p className="mt-2 text-sm">{verdict.summary}</p>
          </div>
          <button
            type="button"
            onClick={onDownload}
            className="shrink-0 rounded-lg bg-slate-900 px-4 py-2 text-sm font-semibold text-white hover:bg-slate-700"
          >
            Download PDF packet
          </button>
        </div>
      </section>

      {/* subject card */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-3 font-semibold text-slate-700">Your property</h3>
        <p className="text-sm text-slate-500">{subject.address}</p>
        <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat label="Appraised" value={fmtUSD(subject.appraisedValue)} />
          <Stat label="Market" value={fmtUSD(subject.marketValue)} />
          <Stat label="Living area" value={`${fmtNum(subject.livingAreaSqft)} sqft`} />
          <Stat
            label="Taxable floor"
            value={capFloor.floor != null ? fmtUSD(capFloor.floor) : 'n/a'}
          />
        </div>
        {capFloor.available && capFloor.isCapped && (
          <p className="mt-4 rounded bg-blue-50 p-3 text-xs text-blue-800">
            Your homestead 10% cap holds the taxable value at {fmtUSD(capFloor.floor ?? 0)} — below
            market. A protest only helps if comps fall below that floor.
          </p>
        )}
        {!capFloor.available && (
          <p className="mt-4 rounded bg-slate-50 p-3 text-xs text-slate-500">
            The taxable (capped) value isn't published for this county dataset. If you have a
            homestead exemption, check your appraisal notice before protesting.
          </p>
        )}
      </section>

      {/* equity */}
      {equity && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-3 font-semibold text-slate-700">
            Unequal appraisal (equity) analysis
          </h3>
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <Stat label="Your $/sqft" value={fmtPsf(equity.subjectPsf)} />
            <Stat label="Median $/sqft" value={fmtPsf(equity.neighborhoodMedianPsf)} />
            <Stat label="Indicated value" value={fmtUSD(equity.indicatedValueRefined)} />
            <Stat
              label="Rank"
              value={`#${equity.subjectRankOf} of ${equity.neighborhoodCount}`}
            />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Rank 1 = highest $/sqft (most over-appraised). You are higher than{' '}
            {equity.percentileHigher.toFixed(0)}% of comparable homes.
          </p>
          <CompTable
            comps={equity.refinedComps.length >= 3 ? equity.refinedComps : equity.comps}
            subjectPsf={equity.subjectPsf}
          />
        </section>
      )}

      {/* market */}
      {market && (
        <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-1 font-semibold text-slate-700">Market value evidence</h3>
          <p className="text-xs text-slate-500">
            Source: {market.source === 'rentcast' ? 'RentCast AVM' : 'your manual comps'}
          </p>
          <div className="mt-3">
            <Stat label="Estimated market value" value={fmtUSD(market.estimatedValue)} />
          </div>
        </section>
      )}

      {/* how to file */}
      <section className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-3 font-semibold text-slate-700">How to file</h3>
        <ol className="list-decimal space-y-1 pl-5 text-sm text-slate-600">
          <li>
            File Comptroller Form {COMPTROLLER_FORM} with your appraisal district by{' '}
            {PROTEST_DEADLINE} (or 30 days after your notice).
          </li>
          <li>Check both grounds: "over market value" and "unequal appraisal."</li>
          <li>Attach the downloaded PDF packet as your evidence.</li>
        </ol>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-0.5 text-lg font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function CompTable({
  comps,
  subjectPsf,
}: {
  comps: import('./types').Comp[];
  subjectPsf: number;
}) {
  return (
    <div className="mt-4 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase text-slate-400">
            <th className="py-2 pr-4">Address</th>
            <th className="py-2 pr-4 text-right">SqFt</th>
            <th className="py-2 pr-4 text-right">Year</th>
            <th className="py-2 pr-4 text-right">Appraised</th>
            <th className="py-2 text-right">$/sqft</th>
          </tr>
        </thead>
        <tbody>
          {comps.slice(0, 15).map((c) => (
            <tr key={c.account} className="border-b border-slate-100">
              <td className="py-1.5 pr-4 text-slate-600">{c.address}</td>
              <td className="py-1.5 pr-4 text-right">{fmtNum(c.livingAreaSqft)}</td>
              <td className="py-1.5 pr-4 text-right">{c.yearBuilt || '-'}</td>
              <td className="py-1.5 pr-4 text-right">{fmtUSD(c.appraisedValue)}</td>
              <td
                className={`py-1.5 text-right font-medium ${
                  c.pricePerSqft < subjectPsf ? 'text-green-600' : 'text-slate-500'
                }`}
              >
                {fmtPsf(c.pricePerSqft)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default App;
