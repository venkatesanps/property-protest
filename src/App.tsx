import { useState, useEffect, useRef, useCallback } from 'react';
import type { County, ManualComp, AppStep, PropertyCondition, PropertyCharacteristics, ExtractedCADEvidence, CADAnalysis } from './types';
import { runAnalysis } from './engine/run';
import type { AnalysisResult } from './engine/run';
import { suggestAddresses, type AddressSuggestion } from './adapters/suggest';
import {
  generateBoardPacket,
  generatePersonalPacket,
  downloadPacket,
} from './pdf/packet';
import { fmtUSD, fmtNum, fmtPsf } from './format';
import { adjustToToday } from './adapters/hpi';
import { DISCLAIMER, PROTEST_DEADLINE, COMPTROLLER_FORM, protestSeason, countyInfo } from './constants';
import { getZipTrend } from './adapters/redfinTrend';
import { CADEvidenceUpload } from './components/CADEvidenceUpload';
import { BulkCompsModal } from './components/BulkCompsModal';
import { CompAnalysis } from './components/CompAnalysis';
import { analyzeCADEvidence } from './engine/counter-strategy';

const STEP_LABEL: Record<AppStep, string> = {
  input: '',
  geocoding: 'Locating your property...',
  loading_property: 'Loading your appraisal record...',
  loading_comps: 'Gathering neighborhood comparables...',
  results: '',
  error: '',
};

const RENTCAST_KEY_STORAGE = 'protest.rentcastKey';

const COUNTY_BADGE: Record<string, string> = {
  collin: 'bg-sky-100 text-sky-700',
  denton: 'bg-violet-100 text-violet-700',
  tarrant: 'bg-amber-100 text-amber-700',
  unsupported: 'bg-slate-100 text-slate-600',
};

function App() {
  const [address, setAddress] = useState('');
  const [selected, setSelected] = useState<AddressSuggestion | null>(null);
  const [step, setStep] = useState<AppStep>('input');
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [cadEvidence, setCADEvidence] = useState<ExtractedCADEvidence | null>(null);
  const [cadAnalysis, setCADAnalysis] = useState<CADAnalysis | null>(null);

  // optional evidence inputs
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showBulkCompsModal, setShowBulkCompsModal] = useState(false);
  const [rentcastKey, setRentcastKey] = useState(
    () => localStorage.getItem(RENTCAST_KEY_STORAGE) ?? ''
  );
  const [manualComps, setManualComps] = useState<ManualComp[]>([]);
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [repairTotal, setRepairTotal] = useState('');
  const [condition, setCondition] = useState<PropertyCondition>({
    foundation: 0, roof: 0, hvac: 0, plumbingElectrical: 0, other: 0, notes: '',
  });
  const [characteristics, setCharacteristics] = useState<PropertyCharacteristics>({
    actualSqft: null, wrongQualityClass: false, characteristicsNotes: '',
  });

  const busy = step === 'geocoding' || step === 'loading_property' || step === 'loading_comps';

  async function analyze(pick?: AddressSuggestion) {
    const chosen = pick ?? selected;
    if (!chosen && !address.trim()) {
      setError('Start typing your property address and pick it from the list.');
      return;
    }
    setError(null);
    setResult(null);
    if (rentcastKey.trim()) localStorage.setItem(RENTCAST_KEY_STORAGE, rentcastKey.trim());

    try {
      // Resolve a concrete property: prefer the selected suggestion; otherwise
      // look up the typed text and take the best match (skips the geocoder).
      let target = chosen;
      if (!target) {
        setStep('geocoding');
        setBusyLabel(STEP_LABEL.geocoding);
        const matches = await suggestAddresses(address);
        if (matches.length === 0) {
          setError(
            'No matching property found in Collin, Denton, or Tarrant County. Check the address and try again.'
          );
          setStep('input');
          return;
        }
        target = matches[0];
        setSelected(target);
        setAddress(target.label);
      }

      const conditionTotal = condition.foundation + condition.roof + condition.hvac +
        condition.plumbingElectrical + condition.other;
      const hasCondition = conditionTotal > 0 || condition.notes.trim().length > 0;
      const hasCharacteristics = characteristics.actualSqft != null ||
        characteristics.wrongQualityClass || characteristics.characteristicsNotes.trim().length > 0;

      const extras = {
        county: target.county as County,
        account: target.account,
        rentcastKey: rentcastKey.trim() || undefined,
        manualComps: manualComps.length ? manualComps : undefined,
        recentPurchasePrice: purchasePrice ? Number(purchasePrice) : undefined,
        recentPurchaseDate: purchaseDate || undefined,
        repairEstimateTotal: repairTotal ? Number(repairTotal) : undefined,
        condition: hasCondition ? condition : null,
        characteristics: hasCharacteristics ? characteristics : null,
      };

      const r = await runAnalysis({
        address: target.raw,
        ...extras,
        onStep: (s) => {
          setStep(s);
          setBusyLabel(STEP_LABEL[s]);
        },
      });
      setResult(r);
      setStep('results');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
      setStep('error');
    }
  }

  async function handleDownload(kind: 'board' | 'personal') {
    if (!result) return;
    const safe =
      result.subject.address.replace(/[^A-Za-z0-9]+/g, '_').slice(0, 40) || 'property';
    const bytes =
      kind === 'board'
        ? await generateBoardPacket(result)
        : await generatePersonalPacket(result);
    downloadPacket(bytes, `ProtestIQ_${kind}_${safe}.pdf`);
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
  function addBulkComps(comps: ManualComp[]) {
    setManualComps((c) => [...c, ...comps]);
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      {/* ── Header ─────────────────────────────────────────────── */}
      <header className="border-b border-slate-800 bg-slate-900 text-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-5">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-500 font-bold text-slate-900">
              P
            </span>
            <span className="text-lg font-semibold tracking-tight">
              Protest<span className="text-emerald-400">IQ</span>
            </span>
          </div>
          <span className="hidden text-sm text-slate-400 sm:block">
            Collin, Denton &amp; Tarrant County property tax protests
          </span>
        </div>
      </header>

      {/* ── Hero + search ──────────────────────────────────────── */}
      <section className="border-b border-slate-200 bg-white">
        <div className="mx-auto max-w-5xl px-6 py-12">
          <h1 className="max-w-2xl text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
            Find out if your property tax appraisal is{' '}
            <span className="text-emerald-600">worth protesting.</span>
          </h1>
          <p className="mt-3 max-w-2xl text-base text-slate-600">
            Enter your address. We pull your county appraisal record, compare it against your
            neighbors, and build two ready-to-use protest packets &mdash; in seconds.
          </p>

          {/* Quick Start Guide */}
          <div className="mt-8 rounded-2xl border-2 border-emerald-300 bg-emerald-50 p-6 max-w-2xl">
            <div className="flex items-start gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-sm font-bold text-white">✓</span>
              <div>
                <p className="font-semibold text-slate-900">3-Step Winning Strategy</p>
                <ol className="mt-3 space-y-3 text-sm text-slate-700">
                  <li className="flex gap-3">
                    <span className="font-bold text-emerald-700">1.</span>
                    <span><strong>Enter your address</strong> — We analyze your appraisal vs. your county records</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-bold text-emerald-700">2.</span>
                    <span><strong>Add comps</strong> — Paste homes that sold on your street or nearby (use 📋 Bulk Paste button)</span>
                  </li>
                  <li className="flex gap-3">
                    <span className="font-bold text-emerald-700">3.</span>
                    <span><strong>Download packets</strong> — Board Packet for your ARB hearing + Personal Playbook for strategy</span>
                  </li>
                </ol>
                <p className="mt-3 text-xs text-emerald-700 font-medium">💡 Pro tip: Same-street comps are strongest evidence. We'll show you exactly how to find and format them.</p>
              </div>
            </div>
          </div>

          <div className="mt-7 max-w-2xl">
            <AddressAutocomplete
              value={address}
              onChange={(v) => {
                setAddress(v);
                setSelected(null);
                if (!v) { setResult(null); setError(null); }
              }}
              onSelect={(s) => {
                setSelected(s);
                setAddress(s.label);
                analyze(s);
              }}
              onEnter={() => !busy && analyze()}
              disabled={busy}
              onAnalyze={() => analyze()}
              busy={busy}
            />

            <div className="mt-4 flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowAdvanced((v) => !v)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition ${showAdvanced ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
              >
                <span className="text-lg">{showAdvanced ? '−' : '+'}</span>
                <span>Add comparable sales & other evidence</span>
              </button>
              <span className="inline-block bg-emerald-500 text-white text-[10px] font-bold px-2 py-1 rounded">RECOMMENDED</span>
            </div>

            {showAdvanced && (
              <AdvancedPanel
                rentcastKey={rentcastKey}
                setRentcastKey={setRentcastKey}
                manualComps={manualComps}
                addManualComp={addManualComp}
                addBulkComps={addBulkComps}
                setShowBulkCompsModal={setShowBulkCompsModal}
                updateComp={updateComp}
                removeComp={removeComp}
                purchasePrice={purchasePrice}
                setPurchasePrice={setPurchasePrice}
                purchaseDate={purchaseDate}
                setPurchaseDate={setPurchaseDate}
                repairTotal={repairTotal}
                setRepairTotal={setRepairTotal}
                condition={condition}
                setCondition={setCondition}
                characteristics={characteristics}
                setCharacteristics={setCharacteristics}
              />
            )}

            {showBulkCompsModal && (
              <BulkCompsModal
                onAdd={addBulkComps}
                onClose={() => setShowBulkCompsModal(false)}
              />
            )}

            {busy && (
              <div className="mt-4 flex items-center gap-2 text-sm text-slate-500">
                <Spinner />
                {busyLabel}
              </div>
            )}
            {error && (
              <p className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {error}
              </p>
            )}
          </div>

          {!result && !busy && (
            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-500">
              <Trust>Free &amp; no login</Trust>
              <Trust>Runs in your browser &mdash; nothing is stored</Trust>
              <Trust>Official county appraisal data</Trust>
            </div>
          )}
        </div>
      </section>

      {/* ── Results ─────────────────────────────────────────────── */}
      <main className="mx-auto max-w-5xl px-6 py-10">
        {result && (
          <>
            <button
              type="button"
              onClick={() => {
                setResult(null);
                setAddress('');
                setError(null);
                setSelected(null);
                setManualComps([]);
                setCADEvidence(null);
                setCADAnalysis(null);
              }}
              className="mb-6 flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-800"
            >
              <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                <path fillRule="evenodd" d="M17 10a.75.75 0 0 1-.75.75H5.56l3.72 3.72a.75.75 0 1 1-1.06 1.06l-5-5a.75.75 0 0 1 0-1.06l5-5a.75.75 0 1 1 1.06 1.06L5.56 9.25H16.25A.75.75 0 0 1 17 10Z" clipRule="evenodd" />
              </svg>
              Search another property
            </button>
            <Results
              result={result}
              onDownload={handleDownload}
              manualComps={manualComps}
              cadEvidence={cadEvidence}
              cadAnalysis={cadAnalysis}
              onCADEvidenceLoaded={(evidence) => {
                setCADEvidence(evidence);
                const analysis = analyzeCADEvidence(evidence, result.equity);
                setCADAnalysis(analysis);
              }}
            />
          </>
        )}
        {!result && !busy && (
          <>
            <HowItWorks />
            <RealExamples />
            <OtherGrounds />
          </>
        )}
        <footer className="mt-12 border-t border-slate-200 pt-6 text-center text-xs text-slate-400">
          {DISCLAIMER}
        </footer>
      </main>
    </div>
  );
}

// ─── Address autocomplete ──────────────────────────────────────────────────────

function AddressAutocomplete({
  value,
  onChange,
  onSelect,
  onEnter,
  onAnalyze,
  disabled,
  busy,
}: {
  value: string;
  onChange: (v: string) => void;
  onSelect: (s: AddressSuggestion) => void;
  onEnter: () => void;
  onAnalyze: () => void;
  disabled: boolean;
  busy: boolean;
}) {
  const [items, setItems] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(-1);
  const boxRef = useRef<HTMLDivElement>(null);
  const acRef = useRef<AbortController | null>(null);

  // Debounced suggestion fetch. All state updates happen inside the (async) timer
  // callback so nothing fires synchronously in the effect body.
  useEffect(() => {
    const q = value.trim();
    const t = setTimeout(async () => {
      if (q.length < 4 || !/^\d/.test(q)) {
        setItems([]);
        setLoading(false);
        return;
      }
      setLoading(true);
      acRef.current?.abort();
      const ac = new AbortController();
      acRef.current = ac;
      try {
        const res = await suggestAddresses(q, ac.signal);
        setItems(res);
        setOpen(true);
        setActive(-1);
      } catch {
        /* aborted or failed — leave items as-is */
      } finally {
        setLoading(false);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [value]);

  // Close on outside click.
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const choose = useCallback(
    (s: AddressSuggestion) => {
      setOpen(false);
      setItems([]);
      onSelect(s);
    },
    [onSelect]
  );

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open || items.length === 0) {
      if (e.key === 'Enter') onEnter();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, items.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (active >= 0) choose(items[active]);
      else onEnter();
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={boxRef} className="relative">
      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <svg
            className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
            viewBox="0 0 20 20"
            fill="currentColor"
            aria-hidden="true"
          >
            <path
              fillRule="evenodd"
              d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
              clipRule="evenodd"
            />
          </svg>
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => items.length && setOpen(true)}
            placeholder="Start typing your address — e.g. 13705 Whistler Dr"
            autoComplete="off"
            className="w-full rounded-xl border border-slate-300 bg-white py-3.5 pl-11 pr-4 text-slate-900 shadow-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
          />
          {loading && (
            <div className="absolute right-3.5 top-1/2 -translate-y-1/2">
              <Spinner />
            </div>
          )}
        </div>
        <button
          type="button"
          onClick={onAnalyze}
          disabled={disabled}
          className="rounded-xl bg-emerald-600 px-7 py-3.5 font-semibold text-white shadow-sm transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? 'Analyzing…' : 'Analyze'}
        </button>
      </div>

      {open && items.length > 0 && (
        <ul className="absolute z-20 mt-2 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          {items.map((s, i) => (
            <li key={`${s.county}-${s.account}`}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(s)}
                onMouseEnter={() => setActive(i)}
                className={`flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm ${
                  i === active ? 'bg-emerald-50' : 'bg-white'
                }`}
              >
                <span className="truncate text-slate-700">{s.label}</span>
                <span
                  className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium capitalize ${COUNTY_BADGE[s.county]}`}
                >
                  {s.county}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── Results dashboard ─────────────────────────────────────────────────────────

function Results({
  result,
  onDownload,
  manualComps,
  cadEvidence,
  cadAnalysis,
  onCADEvidenceLoaded,
}: {
  result: AnalysisResult;
  onDownload: (kind: 'board' | 'personal') => void;
  manualComps: ManualComp[];
  cadEvidence: ExtractedCADEvidence | null;
  cadAnalysis: CADAnalysis | null;
  onCADEvidenceLoaded: (evidence: ExtractedCADEvidence) => void;
}) {
  const { subject, capFloor, equity, market, purchase, rentcastError, listing, floodZone, condition, characteristics, verdict } = result;
  const season = protestSeason();
  // Warn from April on, when the current year's notices exist but the dataset
  // may still be serving last year's certified values.
  const staleRoll =
    subject.rollYear != null && subject.rollYear < season.taxYear && new Date().getMonth() >= 3;
  const isProtest = verdict.code === 'protest';
  const tone = isProtest
    ? 'border-emerald-200 bg-emerald-50'
    : verdict.code === 'incomplete'
      ? 'border-amber-200 bg-amber-50'
      : 'border-slate-200 bg-white';

  return (
    <div className="space-y-6">
      {/* verdict */}
      <section className={`rounded-2xl border p-6 shadow-sm sm:p-7 ${tone}`}>
        <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="max-w-2xl">
            <div className="flex items-center gap-2">
              <VerdictPill code={verdict.code} />
              {verdict.targetValue != null && (
                <span className="text-sm font-medium text-slate-500">
                  Target value {fmtUSD(verdict.targetValue)}
                </span>
              )}
            </div>
            <h2 className="mt-2 text-2xl font-bold text-slate-900">{verdict.headline}</h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-600">{verdict.summary}</p>
          </div>
          {verdict.equityReduction != null && (
            <div className="shrink-0 rounded-xl bg-white/70 px-5 py-4 text-center ring-1 ring-emerald-200">
              <div className="text-xs font-medium uppercase tracking-wide text-emerald-700">
                Potential reduction
              </div>
              <div className="mt-1 text-2xl font-bold text-emerald-700">
                {fmtUSD(verdict.equityReduction)}
              </div>
            </div>
          )}
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <DownloadButton
            primary
            title="Board evidence packet"
            subtitle="File / present to the ARB"
            onClick={() => onDownload('board')}
          />
          <DownloadButton
            title="Your hearing playbook"
            subtitle="Personal prep — what to say & bring"
            onClick={() => onDownload('personal')}
          />
        </div>
      </section>

      {/* subject */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold text-slate-900">Your property</h3>
          <span
            className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${COUNTY_BADGE[subject.county]}`}
          >
            {subject.county} County
          </span>
        </div>
        <p className="mt-1 text-sm text-slate-500">{subject.address}</p>
        <p className="mt-0.5 text-xs text-slate-400">Values from the {subject.rollLabel}.</p>
        <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label="Appraised" value={fmtUSD(subject.appraisedValue)} />
          <Stat label="Market" value={fmtUSD(subject.marketValue)} />
          <Stat label="Living area" value={`${fmtNum(subject.livingAreaSqft)} sqft`} />
          <Stat
            label="Taxable floor"
            value={capFloor.floor != null ? fmtUSD(capFloor.floor) : 'n/a'}
          />
        </div>
        {(subject.lotSizeSqft != null || subject.hasPool != null) && (
          <div className="mt-3 grid grid-cols-2 gap-5 sm:grid-cols-4">
            {subject.lotSizeSqft != null && (
              <Stat
                label="Lot size"
                value={`${fmtNum(subject.lotSizeSqft)} sqft`}
                help="Land area on the CAD record. Larger or smaller lots than your comps can justify a land-value adjustment."
              />
            )}
            {subject.hasPool != null && (
              <Stat
                label="Pool"
                value={subject.hasPool ? 'Yes' : 'No'}
                help="Whether the CAD record flags a pool. A pool the comps lack (or vice-versa) is grounds for an equity adjustment."
              />
            )}
          </div>
        )}
        {capFloor.available && capFloor.isCapped && (
          <Note tone="info">
            Your homestead 10% cap holds the taxable value at {fmtUSD(capFloor.floor ?? 0)} — below
            market. A protest only lowers your bill if your argued value falls below that floor.
          </Note>
        )}
        {!capFloor.available && (
          <Note tone="muted">
            The taxable (capped) value isn&apos;t published in this county dataset. If you have a
            homestead exemption, check your appraisal notice before protesting.
          </Note>
        )}
        {staleRoll && (
          <Note tone="warn">
            These values are from the {subject.rollYear} roll — the {season.taxYear} values on your
            appraisal notice may differ. Use the numbers on your notice for filing; this analysis
            is still valid as relative evidence among neighbors.
          </Note>
        )}
        {subject.county === 'denton' &&
          !capFloor.isCapped &&
          !/\bHS\b|HOMESTEAD/i.test(subject.exemptions ?? '') && (
            <Note tone="warn">
              No homestead exemption appears on this record
              {subject.exemptions ? ` (codes: ${subject.exemptions})` : ''}. If this is your
              primary residence, filing the exemption is free, can be backdated up to two years,
              and usually saves more than a protest — check your record at the Denton CAD before
              your hearing.
            </Note>
          )}
        {subject.county === 'tarrant' && (
          <Note tone="info">
            Tarrant CAD publishes market values only. The homestead cap (10%/yr) and net
            appraised value are not available here — check your notice or{' '}
            <a href={countyInfo('tarrant').propertySearchUrl} target="_blank" rel="noreferrer"
               className="underline">tarrant.prodigycad.com</a> for your exact taxable value.
          </Note>
        )}
      </section>

      {/* equity */}
      {equity && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="font-semibold text-slate-900">Unequal appraisal (equity) analysis</h3>
          <p className="mt-1 text-xs text-slate-600">
            Hover over the ⓘ icons below to see how each number is calculated. <strong>Key insight:</strong> If "Indicated value" is HIGHER than your current appraisal, your home is appraised fairly (or low). If it's LOWER, you have a strong protest case.
          </p>
          {equity.sameStreetComps && equity.sameStreetComps.length >= 3 && (
            <div className="mt-3 rounded-lg border border-emerald-300 bg-emerald-50 p-3">
              <p className="text-xs font-semibold text-emerald-900">
                ✓ {equity.refinedSameStreetComps && equity.refinedSameStreetComps.length < equity.sameStreetComps.length
                  ? `Selected the ${equity.refinedSameStreetComps.length} best-match comps (of ${equity.sameStreetComps.length} on your street)`
                  : `Found ${equity.sameStreetComps.length} same-street comps`
                } — using as PRIMARY basis (§41.43(b)(3))
              </p>
            </div>
          )}
          <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
            <Stat
              label="Your $/sqft"
              value={fmtPsf(equity.subjectPsf)}
              help="Your property's appraised value ÷ living area. Shows what the appraiser values per square foot."
            />
            {equity.sameStreetComps && equity.sameStreetComps.length >= 3 ? (
              <Stat
                label={equity.refinedSameStreetComps && equity.refinedSameStreetComps.length >= 3 ? "Best same-street $/sqft" : "Same-street median $/sqft"}
                value={fmtPsf(equity.sameStreetMedianPsf ?? equity.neighborhoodMedianPsf)}
                help={equity.refinedSameStreetComps && equity.refinedSameStreetComps.length >= 3
                  ? "The middle $/sqft from your best-match homes ON YOUR STREET (similar size & age). Legally the most comparable under §41.43(b)(3)."
                  : "The middle $/sqft from homes ON YOUR STREET. Legally the most comparable under §41.43(b)(3). This is the strongest basis for your appraisal value."}
              />
            ) : (
              <Stat
                label="Neighborhood median $/sqft"
                value={fmtPsf(equity.neighborhoodMedianPsf)}
                help="The middle $/sqft value from comparable properties in your neighborhood. This is what the law requires your appraisal to match."
              />
            )}
            <Stat
              label={equity.sameStreetComps && equity.sameStreetComps.length >= 3 ? "Indicated (same-street)" : "Indicated (refined)"}
              value={fmtUSD(
                equity.sameStreetComps && equity.sameStreetComps.length >= 3
                  ? equity.indicatedValueSameStreet ?? equity.indicatedValueRefined
                  : equity.indicatedValueRefined
              )}
              accent
              help={
                equity.sameStreetComps && equity.sameStreetComps.length >= 3
                  ? "What your home SHOULD be worth based on same-street appraised values. This is the strongest legal argument under §41.43(b)(3)."
                  : "What your home SHOULD be worth: Living area × Median $/sqft. This is the legal benchmark. Compare to your appraisal to find your gap."
              }
            />
            {equity.indicatedValueClassMatched != null && (
              <Stat
                label={`Indicated (class ${subject.qualityClass})`}
                value={fmtUSD(equity.indicatedValueClassMatched)}
                help="Same calculation but using only comps with your exact quality class. Focuses on your home's specific category."
              />
            )}
            <Stat
              label="Indicated (size adj.)"
              value={fmtUSD(equity.indicatedValueSizeAdjusted)}
              help="Adjusted for differences in living area between your home and the comps. If your comps average 3,200 sqft and you have 3,343, this accounts for that difference."
            />
            {equity.indicatedValueSplit != null && (
              <Stat
                label="Indicated (land + bldg)"
                value={fmtUSD(equity.indicatedValueSplit)}
                accent
                help="Land and building values calculated separately, then added together. Shows how much of your appraised value is land vs structure."
              />
            )}
            <Stat
              label="Rank"
              value={`#${equity.subjectRankOf} of ${equity.neighborhoodCount}`}
              help={`Your rank among all homes in your neighborhood. Rank 1 = highest $/sqft (most over-appraised). You're appraised higher than ${equity.percentileHigher.toFixed(0)}% of comparable homes.`}
            />
          </div>

          {/* Interpretation guide */}
          <div className="mt-5 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
            <p className="text-sm font-semibold text-emerald-900">📊 What does this mean?</p>
            {(() => {
              const hasSameStreet = equity.sameStreetComps && equity.sameStreetComps.length >= 3;
              const indicatedValue = hasSameStreet
                ? equity.indicatedValueSameStreet ?? equity.indicatedValueRefined
                : equity.indicatedValueRefined;
              const compSource = hasSameStreet
                ? `same-street comps (${equity.refinedSameStreetComps && equity.refinedSameStreetComps.length >= 3 ? equity.refinedSameStreetComps.length : equity.sameStreetComps.length} homes)`
                : "neighborhood comps";
              const gap = subject.marketValue - indicatedValue;
              if (gap > 0) {
                return (
                  <p className="mt-2 text-xs text-emerald-800">
                    <strong>Your appraisal appears LOW by ${fmtUSD(gap).replace('$', '')}.</strong> The {compSource} indicate your home should be worth {fmtUSD(indicatedValue)}, but it's appraised at {fmtUSD(subject.marketValue)}. You may not have a strong equity-based protest case — focus on other grounds (CAD data errors, property defects, market conditions).
                  </p>
                );
              } else {
                return (
                  <p className="mt-2 text-xs text-emerald-800">
                    <strong>Your appraisal is HIGH by ${fmtUSD(-gap).replace('$', '')}.</strong> The {compSource} indicate your home should be worth {fmtUSD(indicatedValue)}, but it's appraised at {fmtUSD(subject.marketValue)}. You have a strong §41.43(b)(3) unequal appraisal case{hasSameStreet ? " — same-street comps are the strongest evidence." : ". Add same-street comps (if available) to strengthen even further."}
                  </p>
                );
              }
            })()}
          </div>
          {equity.indicatedValueSplit != null &&
            equity.indicatedLandValue != null &&
            equity.indicatedImprovementValue != null && (
              <p className="mt-1 text-xs text-slate-500">
                Land + building split: {fmtUSD(equity.indicatedLandValue)} land +{' '}
                {fmtUSD(equity.indicatedImprovementValue)} building (
                {fmtPsf(equity.improvementMedianPsf ?? 0)}/sqft) ={' '}
                {fmtUSD(equity.indicatedValueSplit)}.
              </p>
            )}

          {/* Same-street vs Neighborhood comparison */}
          {equity.sameStreetComps && equity.sameStreetComps.length >= 3 && (
            <div className="mt-5 rounded-lg border border-blue-200 bg-blue-50 p-4">
              <p className="text-sm font-semibold text-blue-900">🏘️ Same-Street vs Neighborhood Comparison</p>
              <div className="mt-3 grid grid-cols-2 gap-4 text-xs">
                <div>
                  <p className="font-semibold text-blue-900">
                    {equity.refinedSameStreetComps && equity.refinedSameStreetComps.length >= 3
                      ? `Best Match on Your Street (${equity.refinedSameStreetComps.length})`
                      : `Your Street (${equity.sameStreetComps.length} homes)`}
                  </p>
                  <p className="text-blue-700 mt-1">Median $/sqft: {fmtPsf(equity.sameStreetMedianPsf ?? 0)}</p>
                  <p className="text-blue-700">Indicated value: {fmtUSD(equity.indicatedValueSameStreet ?? 0)}</p>
                  {equity.refinedSameStreetComps && equity.refinedSameStreetComps.length >= 3 && (
                    <p className="text-blue-600 text-xs mt-1">(Similar size ±20%, age ±12 yrs)</p>
                  )}
                </div>
                <div>
                  <p className="font-semibold text-slate-700">Full Neighborhood ({equity.neighborhoodCount} homes)</p>
                  <p className="text-slate-600 mt-1">Median $/sqft: {fmtPsf(equity.neighborhoodMedianPsf)}</p>
                  <p className="text-slate-600">Indicated value: {fmtUSD(equity.indicatedValueRefined)}</p>
                </div>
              </div>
              <p className="mt-3 text-xs text-blue-800 leading-relaxed">
                <strong>Why same-street is stronger:</strong> §41.43(b)(3) requires "most comparable properties" — same street is automatically most comparable.
                {equity.refinedSameStreetComps && equity.refinedSameStreetComps.length >= 3
                  ? ` We auto-filtered to ${equity.refinedSameStreetComps.length} best matches (similar size & age) out of ${equity.sameStreetComps.length} on your street.`
                  : ` These ${equity.sameStreetComps.length} homes have identical location, school district, and typically similar condition.`} Neighborhood data includes properties up to 0.4 miles away, which may have different characteristics.
              </p>
            </div>
          )}

          <CompTable
            comps={
              equity.refinedSameStreetComps && equity.refinedSameStreetComps.length >= 3
                ? equity.refinedSameStreetComps
                : equity.sameStreetComps && equity.sameStreetComps.length >= 3
                  ? equity.sameStreetComps
                  : equity.refinedComps.length >= 3
                    ? equity.refinedComps
                    : equity.comps
            }
            subjectPsf={equity.subjectPsf}
          />
        </section>
      )}

      {/* Manual comps analysis */}
      {manualComps.length > 0 && result && (
        <CompAnalysis
          comps={manualComps}
          subjectSqft={result.subject.livingAreaSqft}
        />
      )}

      {/* CAD evidence upload & analysis */}
      {!cadEvidence && (
        <CADEvidenceUpload
          onEvidenceLoaded={onCADEvidenceLoaded}
        />
      )}

      {cadAnalysis && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
          <h3 className="font-semibold text-slate-900">Counter-Strategy Analysis</h3>
          <div className="mt-4 space-y-4 text-sm">
            <div>
              <p className="font-medium text-slate-700">Primary Argument</p>
              <p className="mt-1 text-slate-600">{cadAnalysis.recommendedStrategy.primaryArgument}</p>
            </div>
            {cadAnalysis.weaknesses.length > 0 && (
              <div>
                <p className="font-medium text-slate-700">Weaknesses Found</p>
                <ul className="mt-1 space-y-1">
                  {cadAnalysis.weaknesses.map((w, i) => (
                    <li key={i} className="flex gap-2 text-slate-600">
                      <span className={`font-medium ${w.severity === 'major' ? 'text-red-600' : w.severity === 'moderate' ? 'text-amber-600' : 'text-slate-500'}`}>
                        •
                      </span>
                      <span>
                        <strong>{w.type.replace(/-/g, ' ')}:</strong> {w.description}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <p className="font-medium text-slate-700">Settlement Negotiation Strategy</p>
              <p className="mt-1 text-xs text-slate-600">
                The CAD's current position is <strong>${cadEvidence?.currentAppraised.toLocaleString()}</strong>. Here's your negotiation range:
              </p>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded bg-slate-100 p-2 text-center">
                  <p className="text-[10px] text-slate-600 font-medium">Their Opening</p>
                  <p className="text-sm font-semibold text-slate-900">${cadEvidence?.currentAppraised.toLocaleString()}</p>
                  <p className="text-[9px] text-slate-500 mt-1">Current appraisal</p>
                </div>
                <div className="rounded bg-white/70 p-2 text-center">
                  <p className="text-[10px] text-slate-500 font-medium">Your Ask</p>
                  <p className="text-sm font-semibold text-emerald-700">${cadAnalysis.recommendedStrategy.settlementTargets.ask.toLocaleString()}</p>
                  <p className="text-[9px] text-slate-500 mt-1">Your strongest comps</p>
                </div>
                <div className="rounded bg-emerald-100 p-2 text-center">
                  <p className="text-[10px] text-emerald-700 font-medium">Likely Target</p>
                  <p className="text-sm font-semibold text-emerald-700">${cadAnalysis.recommendedStrategy.settlementTargets.target.toLocaleString()}</p>
                  <p className="text-[9px] text-emerald-600 mt-1">Expected settlement</p>
                </div>
                <div className="rounded bg-white/70 p-2 text-center">
                  <p className="text-[10px] text-slate-500 font-medium">Your Floor</p>
                  <p className="text-sm font-semibold text-emerald-700">${cadAnalysis.recommendedStrategy.settlementTargets.floor.toLocaleString()}</p>
                  <p className="text-[9px] text-slate-500 mt-1">Minimum acceptable</p>
                </div>
              </div>
              <div className="mt-3 rounded-lg bg-blue-50 border border-blue-200 p-3 text-xs text-blue-800 space-y-1">
                <p>
                  <strong>How this works:</strong> You open with your "ask" (strongest comparable value). ARB negotiates between your ask and their current appraisal. The "target" is where ARB typically settles (usually 60% of the gap). Never accept below your "floor."
                </p>
                <p className="text-[11px] mt-2">
                  <strong>Gap:</strong> ${(cadEvidence?.currentAppraised ?? 0 - cadAnalysis.recommendedStrategy.settlementTargets.ask).toLocaleString()} difference between their appraisal and your ask.
                </p>
              </div>
            </div>
            <div>
              <p className="font-medium text-slate-700">County Notes</p>
              <p className="mt-1 text-xs text-slate-600">{cadAnalysis.recommendedStrategy.countySpecificNotes}</p>
            </div>
          </div>
        </section>
      )}

      {/* free sold comps helper */}
      <FreeComps subject={subject} />

      {/* recent purchase (HPI-aged) */}
      {purchase && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="font-semibold text-slate-900">Recent purchase evidence</h3>
          <p className="mt-1 text-xs text-slate-500">
            An arms-length sale is the strongest market evidence. Older purchases are aged to
            today&apos;s market with the public FHFA House Price Index.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-3">
            <Stat label="You paid" value={fmtUSD(purchase.price)} />
            {purchase.date && <Stat label="Purchase date" value={purchase.date} />}
            <Stat
              label={purchase.hpi ? "Today's market (aged)" : 'Market value'}
              value={fmtUSD(purchase.marketValue)}
              accent
            />
          </div>
          {purchase.hpi && (
            <p className="mt-3 text-xs text-slate-500">
              {purchase.hpi.area} index rose{' '}
              {purchase.hpi.pctChange >= 0 ? '+' : ''}
              {purchase.hpi.pctChange.toFixed(0)}% from {purchase.hpi.fromLabel} to{' '}
              {purchase.hpi.toLabel}, so {fmtUSD(purchase.price)} then ≈{' '}
              {fmtUSD(purchase.marketValue)} now.
            </p>
          )}
        </section>
      )}

      {/* market */}
      {market && market.estimatedValue > 0 && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="font-semibold text-slate-900">Market value evidence</h3>
          <p className="mt-1 text-xs text-slate-500">
            Source:{' '}
            {market.source === 'rentcast'
              ? 'RentCast automated valuation'
              : market.source === 'purchase'
                ? 'recent purchase price'
                : `your manual comps (${market.comparables?.length ?? 0})`}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-3">
            <Stat label="Estimated market value" value={fmtUSD(market.estimatedValue)} accent />
            {market.lowRange != null && market.highRange != null && (
              <Stat
                label="Range across comps"
                value={`${fmtUSD(market.lowRange)} – ${fmtUSD(market.highRange)}`}
              />
            )}
          </div>
        </section>
      )}

      {/* active MLS listing */}
      {listing && (
        <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
          <h3 className="font-semibold text-slate-900">Active MLS listing</h3>
          <p className="mt-1 text-xs text-slate-500">
            This property is currently listed for sale
            {listing.mlsName ? ` on ${listing.mlsName}` : ''}
            {listing.mlsNumber ? ` · MLS# ${listing.mlsNumber}` : ''}.
            A list price below the CAD appraisal is strong market-value evidence.
          </p>
          <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-3">
            <Stat label="List price" value={fmtUSD(listing.listPrice)} accent />
            {listing.daysOnMarket != null && (
              <Stat label="Days on market" value={String(listing.daysOnMarket)} />
            )}
            {listing.listedDate && (
              <Stat label="Listed" value={listing.listedDate.slice(0, 10)} />
            )}
          </div>
          {listing.listPrice < subject.appraisedValue && (
            <Note tone="warn">
              List price ({fmtUSD(listing.listPrice)}) is{' '}
              {fmtUSD(subject.appraisedValue - listing.listPrice)} below your CAD appraised
              value ({fmtUSD(subject.appraisedValue)}). Include this as Exhibit A in your
              protest packet.
            </Note>
          )}
        </section>
      )}

      {/* rentcast skipped */}
      {rentcastError && (
        <Note tone="warn">
          RentCast was skipped: {rentcastError}
        </Note>
      )}

      {/* flood zone */}
      {floodZone && (
        <section className={`rounded-2xl border p-6 shadow-sm ${
          floodZone.sfha
            ? 'border-red-200 bg-red-50'
            : 'border-slate-200 bg-white'
        }`}>
          <h3 className="font-semibold text-slate-900">FEMA flood zone</h3>
          <div className="mt-4 grid grid-cols-2 gap-5 sm:grid-cols-3">
            <Stat label="Zone" value={floodZone.zone} accent={floodZone.sfha} />
            <Stat label="High-risk area" value={floodZone.sfha ? 'Yes (SFHA)' : 'No'} />
          </div>
          <p className="mt-3 text-xs text-slate-500">{floodZone.description}</p>
          {floodZone.sfha && (
            <Note tone="warn">
              This property is in a Special Flood Hazard Area (Zone {floodZone.zone}). Mandatory
              flood insurance typically adds $1,500–$4,000/yr in holding costs and buyers
              discount flood-zone homes 5–15% vs comparable non-flood properties. This
              supports a §41.43(a) market-value reduction. Include the{' '}
              <a
                href={floodZone.firmPanelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                FEMA FIRM panel map
              </a>{' '}
              as an exhibit.
            </Note>
          )}
          {!floodZone.sfha && (
            <p className="mt-2 text-xs text-slate-400">
              Minimal flood hazard — no flood-zone value impact.{' '}
              <a
                href={floodZone.firmPanelUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="underline"
              >
                View FIRM map
              </a>
            </p>
          )}
        </section>
      )}

      {/* condition + characteristics */}
      {(condition || characteristics) && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="font-semibold text-slate-900">Additional protest grounds</h3>
          {condition && (condition.foundation + condition.roof + condition.hvac +
            condition.plumbingElectrical + condition.other) > 0 && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                Condition / deferred maintenance
              </p>
              <div className="mt-2 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {condition.foundation > 0 && (
                  <Stat label="Foundation" value={fmtUSD(condition.foundation)} />
                )}
                {condition.roof > 0 && <Stat label="Roof" value={fmtUSD(condition.roof)} />}
                {condition.hvac > 0 && <Stat label="HVAC" value={fmtUSD(condition.hvac)} />}
                {condition.plumbingElectrical > 0 && (
                  <Stat label="Plumbing / Elec." value={fmtUSD(condition.plumbingElectrical)} />
                )}
                {condition.other > 0 && <Stat label="Other" value={fmtUSD(condition.other)} />}
                <Stat
                  label="Total deduction"
                  value={fmtUSD(condition.foundation + condition.roof + condition.hvac +
                    condition.plumbingElectrical + condition.other)}
                  accent
                />
              </div>
              {condition.notes && (
                <p className="mt-2 text-xs text-slate-500">{condition.notes}</p>
              )}
            </div>
          )}
          {characteristics && (
            <div className="mt-4">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                CAD record discrepancies
              </p>
              {characteristics.actualSqft != null && (
                <p className="mt-2 text-sm text-slate-700">
                  <span className="font-medium">Square footage:</span> CAD shows{' '}
                  {fmtNum(subject.livingAreaSqft)} sqft — you report{' '}
                  {fmtNum(characteristics.actualSqft)} sqft
                  {characteristics.actualSqft < subject.livingAreaSqft && (
                    <span className="ml-1 text-emerald-700 font-medium">
                      ({fmtNum(subject.livingAreaSqft - characteristics.actualSqft)} sqft over-count
                      in the record — strong grounds for reduction)
                    </span>
                  )}
                </p>
              )}
              {characteristics.wrongQualityClass && (
                <p className="mt-1 text-sm text-slate-700">
                  <span className="font-medium">Quality class:</span> CAD shows{' '}
                  {subject.qualityClass} — you believe this is incorrect.
                </p>
              )}
              {characteristics.characteristicsNotes && (
                <p className="mt-1 text-xs text-slate-500">
                  {characteristics.characteristicsNotes}
                </p>
              )}
            </div>
          )}
        </section>
      )}

      {/* what to do now — phase-aware for the protest calendar */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="font-semibold text-slate-900">What to do now</h3>
        {season.phase === 'filing' && (
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
            <li>
              File Comptroller Form {COMPTROLLER_FORM} with your appraisal district by{' '}
              {PROTEST_DEADLINE} (or 30 days after your notice).
            </li>
            <li>Check both grounds: &ldquo;over market value&rdquo; and &ldquo;unequal appraisal.&rdquo;</li>
            <li>Attach the <strong>board evidence packet</strong> above.</li>
            <li>
              Keep the <strong>hearing playbook</strong> for yourself — it has your talking points and
              what to bring.
            </li>
          </ol>
        )}
        {season.phase === 'hearing' && (
          <div className="mt-3 space-y-3 text-sm text-slate-600">
            <div>
              <p className="font-medium text-slate-700">Already filed your protest?</p>
              <ol className="mt-1 list-decimal space-y-1.5 pl-5">
                <li>
                  Request the CAD&apos;s evidence for your hearing (Tex. Tax Code §41.461 — they must
                  provide it free at least 14 days before the hearing). If their own comps support
                  you, attach them.
                </li>
                <li>
                  Try the <strong>informal review</strong> with a district appraiser first — most
                  reductions happen there. Bring the <strong>board evidence packet</strong>.
                </li>
                <li>
                  At the ARB hearing, follow the <strong>hearing playbook</strong>: state the
                  requested value, walk the comp table, stop talking.
                </li>
              </ol>
            </div>
            <div>
              <p className="font-medium text-slate-700">
                Missed the {PROTEST_DEADLINE} deadline?
              </p>
              <ol className="mt-1 list-decimal space-y-1.5 pl-5">
                <li>
                  You can still file a <strong>late protest for good cause</strong> (§41.44(b)) until
                  the ARB approves the appraisal records — typically mid-July. File Form{' '}
                  {COMPTROLLER_FORM} now with a written good-cause explanation.
                </li>
                <li>
                  After that, a <strong>§25.25 motion</strong> can still correct clerical errors
                  (25.25(c)) or a substantial over-appraisal (25.25(d), value more than one-third —
                  one-fourth for homesteads — above correct) before taxes go delinquent.
                </li>
              </ol>
            </div>
          </div>
        )}
        {season.phase === 'planning' && (
          <ol className="mt-3 list-decimal space-y-1.5 pl-5 text-sm text-slate-600">
            <li>
              The regular {season.taxYear} protest window has closed. A <strong>§25.25 motion</strong>{' '}
              can still fix clerical errors (25.25(c)) or a substantial over-appraisal (25.25(d))
              before taxes go delinquent on Feb 1.
            </li>
            <li>
              Verify your <strong>homestead exemption</strong> is on file — it&apos;s free and caps
              taxable-value growth at 10%/year.
            </li>
            <li>
              Save this analysis and your evidence — when the {season.taxYear + 1} notice arrives in
              April, you&apos;ll be ready to file by {PROTEST_DEADLINE}.
            </li>
          </ol>
        )}
      </section>
    </div>
  );
}

// ─── How it works ──────────────────────────────────────────────────────────────

function HowItWorks() {
  return (
    <section className="mt-10 space-y-6">
      <div>
        <h2 className="text-xl font-bold text-slate-900">How ProtestIQ works</h2>
        <p className="mt-1 text-sm text-slate-500">
          The analysis is grounded in Texas property tax law, not guesswork.
        </p>
        <p className="mt-2 text-sm text-emerald-700 font-medium">
          💡 <strong>Pro tip:</strong> Add your own comparable sales (especially same-street homes) for even stronger evidence. See "Add comparable sales" button above.
        </p>
      </div>

      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        <HowCard
          step="1"
          title="We pull your official record"
          body="Your appraisal data comes directly from the county appraisal district — Collin CAD (Texas Open Data), Denton CAD (ArcGIS), or Tarrant CAD (TAD's own ArcGIS service). Living area, year built, quality class, land value, improvement value — the same numbers on your appraisal notice."
        />
        <HowCard
          step="2"
          title="We analyze comparable properties (yours or county's)"
          body="You can add your own comparables (especially same-street homes — strongest legal argument) using the bulk paste button above, OR we automatically find comparable homes in your appraisal neighborhood — properties the district uses to set values uniformly. We filter to homes within ±40% of your square footage and same quality class for an apples-to-apples comparison."
        />
        <HowCard
          step="3"
          title="We calculate the median $/sqft"
          body="For each comparable home we compute its appraisal per square foot. Then we take the median of that group. The median is what matters legally — it is the fairness benchmark Texas law requires. Same-street comps typically have lower $/sqft, strengthening your argument."
        />
        <HowCard
          step="4"
          title="We apply the Texas unequal-appraisal law"
          body={
            <>
              <strong>Tex. Tax Code §41.43(b)(3)</strong> says your appraised value cannot exceed the median appraised value per square foot of a reasonable number of comparable properties, multiplied by your square footage. If your $/sqft is higher than that median, you are legally entitled to a reduction.
            </>
          }
        />
        <HowCard
          step="5"
          title="We check your homestead cap"
          body="If you have a homestead exemption, the 10% annual cap limits how much your taxable value can rise. Even if the appraisal is over market, a protest only saves money on your tax bill if the argued value beats the cap floor. We surface this so you don't waste a hearing."
        />
        <HowCard
          step="6"
          title="We generate two ready-to-use documents"
          body="The board evidence packet is formatted for filing with the Appraisal Review Board — it states your legal argument, lists your comparables (yours or county's), and shows the indicated value. The personal playbook coaches you on what to say at the hearing, with specific rebuttals for ARB objections."
        />
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5">
        <p className="text-sm font-semibold text-amber-900">The key legal principle, plain English</p>
        <p className="mt-2 text-sm text-amber-800 leading-relaxed">
          Texas does not require your property to be appraised at market value — it requires it to be appraised <em>consistently</em> with your neighbors. If a house two streets over is 2,400 sqft and appraised at $200/sqft, yours cannot be appraised at $240/sqft without a specific reason. The law calls this &ldquo;unequal appraisal,&rdquo; and it is the most winnable protest argument in the state — no sale-price evidence required.
        </p>
        <p className="mt-3 text-xs text-amber-700">
          Authority: Tex. Tax Code §41.43(b)(3) — unequal appraisal based on median of comparable properties.
        </p>
      </div>
    </section>
  );
}

function HowCard({ step, title, body }: { step: string; title: string; body: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="mb-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-emerald-100 text-sm font-bold text-emerald-700">
        {step}
      </div>
      <h3 className="text-sm font-semibold text-slate-900">{title}</h3>
      <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{body}</p>
    </div>
  );
}

// ─── Real examples ─────────────────────────────────────────────────────────────

const EXAMPLE_PROPERTIES = [
  {
    address: '7137 Reflection Bay Dr, Frisco TX 75036',
    county: 'Denton' as const,
    appraised: 528408,
    indicated: 419315,
    saving: 106485,
    pct: 20.3,
    sqft: 1652,
    subjectPsf: 319.86,
    medianPsf: 249.23,
    comps: 70,
    note: 'Cluster of 1,652 sqft homes in the same neighborhood — three nearby sold at the median rate while this one was appraised 28% higher per sqft.',
  },
  {
    address: '12491 Piper Dr, Frisco TX 75033',
    county: 'Denton' as const,
    appraised: 726620,
    indicated: 634896,
    saving: 91724,
    pct: 12.6,
    sqft: 2081,
    subjectPsf: 349.17,
    medianPsf: 255.68,
    comps: 23,
    note: 'Appraised at $349/sqft while 23 comparable homes in the same neighborhood average $255/sqft — a $93/sqft gap the district cannot justify.',
  },
  {
    address: '2603 Del Largo Way, Frisco TX 75033',
    county: 'Denton' as const,
    appraised: 757885,
    indicated: 584297,
    saving: 173588,
    pct: 22.9,
    sqft: 3066,
    subjectPsf: 247.19,
    medianPsf: 197.25,
    comps: 84,
    note: 'Largest mid-range savings found: $173K reduction supported by 84 comparable homes in the same appraisal neighborhood.',
  },
  {
    address: '7699 Jodpur Ln, Frisco TX 75036',
    county: 'Denton' as const,
    appraised: 1463730,
    indicated: 1077956,
    saving: 385774,
    pct: 26.4,
    sqft: 3903,
    subjectPsf: 375.03,
    medianPsf: 279.05,
    comps: 125,
    note: 'Highest savings in this scan: 26% over the neighborhood median, backed by 125 comparable homes. Strong case with plenty of comps.',
  },
  {
    address: '7985 Lawler Park Dr, Frisco TX 75035',
    county: 'Collin' as const,
    appraised: 1226125,
    indicated: 996492,
    saving: 229633,
    pct: 18.7,
    sqft: 3881,
    subjectPsf: 315.93,
    medianPsf: 256.72,
    comps: 180,
    note: 'Best-supported Collin County example — 180 comparable homes confirm the subject is appraised 23% above neighborhood median per sqft.',
  },
  {
    address: '11225 La Cantera Trl, Frisco TX 75033',
    county: 'Denton' as const,
    appraised: 577769,
    indicated: 478702,
    saving: 99067,
    pct: 17.1,
    sqft: 2207,
    subjectPsf: 261.79,
    medianPsf: 197.25,
    comps: 48,
    note: 'Strong example in the sub-$600K range: $99K savings indicated, 48 comps, 32% above median per sqft.',
  },
] as const;

function RealExamples() {
  return (
    <section className="mt-12">
      <div className="mb-1 flex items-center gap-3">
        <h2 className="text-xl font-bold text-slate-900">Real properties found worth protesting</h2>
        <span className="rounded-full bg-emerald-100 px-2.5 py-0.5 text-xs font-semibold text-emerald-700">
          Live data
        </span>
      </div>
      <p className="mb-6 text-sm text-slate-500">
        We ran our engine across 39 appraisal neighborhoods in Collin and Denton counties and found 67 protest-worthy properties. Here are six — pulled from official county appraisal records, no estimates.
      </p>
      <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {EXAMPLE_PROPERTIES.map((ex) => (
          <div
            key={ex.address}
            className="flex flex-col rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-sm font-semibold leading-snug text-slate-900">{ex.address}</p>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                  ex.county === 'Collin'
                    ? 'bg-sky-100 text-sky-700'
                    : 'bg-violet-100 text-violet-700'
                }`}
              >
                {ex.county}
              </span>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Appraised</p>
                <p className="mt-0.5 text-sm font-semibold text-slate-800">{fmtUSD(ex.appraised)}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Indicated fair</p>
                <p className="mt-0.5 text-sm font-semibold text-emerald-700">{fmtUSD(ex.indicated)}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Your $/sqft</p>
                <p className="mt-0.5 text-sm font-semibold text-red-600">{fmtPsf(ex.subjectPsf)}</p>
              </div>
              <div>
                <p className="text-[10px] font-medium uppercase tracking-wide text-slate-400">Median $/sqft</p>
                <p className="mt-0.5 text-sm font-semibold text-slate-700">{fmtPsf(ex.medianPsf)}</p>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2">
              <span className="text-base font-bold text-emerald-700">↓ {fmtUSD(ex.saving)}</span>
              <span className="text-xs text-emerald-600">potential savings ({ex.pct.toFixed(1)}%)</span>
            </div>

            <p className="mt-3 flex-1 text-xs leading-relaxed text-slate-500">{ex.note}</p>
            <p className="mt-2 text-[10px] text-slate-400">{ex.comps} comparable properties · official {ex.county} CAD data</p>
          </div>
        ))}
      </div>

      <p className="mt-6 text-xs text-slate-400">
        These properties are shown as educational examples only. Values are from official county appraisal records and reflect the unequal-appraisal analysis under Tex. Tax Code §41.43(b)(3). Savings estimates are based on the indicated value at the neighborhood median $/sqft and are not legal advice.
      </p>
    </section>
  );
}

// ─── Other grounds landing section ─────────────────────────────────────────────

const GROUNDS = [
  {
    icon: '⚖️',
    label: 'Unequal Appraisal',
    badge: 'Primary',
    badgeColor: 'bg-emerald-100 text-emerald-700',
    statute: 'Tex. Tax Code §41.43(b)(3)',
    body:
      'The CAD must appraise your home at the same $/sqft ratio it uses for comparable homes in the same neighborhood. If your ratio is higher than the median, you are over-appraised relative to your neighbors — and you can win without ever proving what the house would sell for. This is the most reliably winnable ground: all the data comes directly from the CAD\'s own records.',
    bullets: [
      'No sale required — the argument is based purely on equity among neighbors',
      'Engine computes your rank: if you are above the median, you have a case',
      'The ARB cannot raise anyone else\'s value to make the math work — they can only lower yours',
    ],
    links: [],
  },
  {
    icon: '🏷️',
    label: 'Over Market Value',
    badge: 'Strong with evidence',
    badgeColor: 'bg-sky-100 text-sky-700',
    statute: 'Tex. Tax Code §41.43(a)',
    body:
      'If you can show the CAD appraised your home above what a willing buyer would pay in today\'s market, you win on market-value grounds. The strongest evidence is a recent arms-length purchase price. Older purchases can be aged to today using the FHFA House Price Index (public, free). Manual comps from recent nearby sales also work.',
    bullets: [
      'Recent purchase price — single strongest piece of evidence; file within 2 years',
      'FHFA House Price Index — ages an older purchase to today\'s market (Dallas-Plano-Irving CBSA)',
      'Comparable sales — nearby homes sold within 12 months; attach MLS printouts',
      'AVM estimates (Zillow / Redfin) — supporting evidence, not primary',
      'Texas A&M Real Estate Center market reports (free, public)',
    ],
    links: [
      { label: 'FHFA HPI data (public)', url: 'https://www.fhfa.gov/data/hpi' },
      { label: 'TX A&M Real Estate Center', url: 'https://trerc.tamu.edu/' },
    ],
  },
  {
    icon: '🌊',
    label: 'FEMA Flood Zone (SFHA)',
    badge: 'Market value support',
    badgeColor: 'bg-blue-100 text-blue-700',
    statute: 'Tex. Tax Code §41.43(a) — market factor',
    body:
      'Properties in a FEMA Special Flood Hazard Area (Zone AE/A/AH/AO) must carry mandatory flood insurance ($1,500–$4,000+/yr). Research shows SFHA homes sell 5–15% below comparable non-flood properties because of the insurance cost and perceived risk. Enter your address above and the engine will automatically look up your flood zone via FEMA\'s public API.',
    bullets: [
      'Mandatory flood insurance reduces buyer purchasing power',
      'Attach the FEMA FIRM map panel as an exhibit (link in results)',
      'Cite the discount percentage and show comparable non-SFHA sales nearby',
    ],
    links: [
      { label: 'FEMA Flood Map Service Center', url: 'https://msc.fema.gov/portal/home' },
    ],
  },
  {
    icon: '📐',
    label: 'Wrong CAD Record (sqft / quality class)',
    badge: 'Often overlooked',
    badgeColor: 'bg-amber-100 text-amber-700',
    statute: 'Tex. Tax Code §41.41(a)(1) — incorrect appraisal',
    body:
      'If the CAD record shows the wrong square footage or a higher quality class than your home actually is, the $/sqft ratio is inflated before the comparison even starts. You can fix this as a separate ground — independent of the equity or market-value arguments. The ARB can reduce the value and correct the record.',
    bullets: [
      'Measure your actual living area (exclude garage, porches, unfinished spaces)',
      'Bring a floor plan, prior appraisal, or Realist/Zillow record showing correct sqft',
      'Check the CAD quality class (A, B, C, D, F) on your county\'s property search',
      'A one-class downgrade typically reduces value by 10–20% at the district level',
    ],
    links: [
      { label: 'Collin CAD property search', url: 'https://esearch.collincad.org/' },
      { label: 'Denton CAD property search', url: 'https://www.dentoncad.com/property-search' },
    ],
  },
  {
    icon: '🔨',
    label: 'Deferred Maintenance / Property Condition',
    badge: 'Supports §41.43(a)',
    badgeColor: 'bg-rose-100 text-rose-700',
    statute: 'Tex. Tax Code §41.43(a) — condition adjustment',
    body:
      'Major repairs that a buyer would need to make immediately reduce the effective market value of the home. Foundation issues, roof replacement, failing HVAC, and outdated electrical are the most persuasive. The ARB wants to see contractor bids — not estimates — for each category. Enter your repair estimates in the Advanced Options panel above.',
    bullets: [
      'Foundation: get a structural engineer or foundation company bid',
      'Roof: at least two roofing contractor quotes',
      'HVAC: age + condition report from an HVAC technician',
      'Do NOT include routine maintenance the CAD already factors in (paint, carpet)',
      'Total documented repairs reduce the indicated market value dollar-for-dollar',
    ],
    links: [],
  },
  {
    icon: '📋',
    label: 'Request CAD Evidence Under Texas PIA',
    badge: 'Advanced',
    badgeColor: 'bg-slate-100 text-slate-600',
    statute: 'Tex. Gov\'t Code §552 — Public Information Act',
    body:
      'You can request the comparable sales data the CAD\'s own appraiser used to set your value — the exact comps they ran. Send a written PIA request to the CAD; they must respond within 10 business days. If their own comps show you are over market, that\'s your strongest exhibit.',
    bullets: [
      'Email the CAD records department: "I request all comparable sales data used to appraise account [your account]"',
      'Ask for the sales grid / CAMA model output if available',
      'Attach the CAD\'s own comps as Exhibit A in your board packet',
      'Texas Open Records Hotline: 512-478-6736 (if the CAD refuses)',
    ],
    links: [
      { label: 'Texas AG: your PIA rights', url: 'https://www.texasattorneygeneral.gov/open-government/members-public' },
    ],
  },
];

function OtherGrounds() {
  const [open, setOpen] = useState<number | null>(null);
  return (
    <section className="mt-14">
      <div className="mb-1 flex items-center gap-3">
        <h2 className="text-xl font-bold text-slate-900">All grounds for protest — and how to use them</h2>
      </div>
      <p className="mb-6 text-sm text-slate-500">
        Texas law gives property owners multiple independent grounds to reduce an appraised value.
        Each ground below explains the legal basis, what evidence you need, and where to get it —
        all from public, free sources.
      </p>
      <div className="grid gap-4 sm:grid-cols-2">
        {GROUNDS.map((g, i) => (
          <div
            key={g.label}
            className="flex flex-col rounded-2xl border border-slate-200 bg-white shadow-sm"
          >
            <button
              className="flex w-full items-start gap-3 px-5 py-4 text-left"
              onClick={() => setOpen(open === i ? null : i)}
            >
              <span className="mt-0.5 text-xl" role="img" aria-label="">{g.icon}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-slate-900">{g.label}</span>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${g.badgeColor}`}>
                    {g.badge}
                  </span>
                </div>
                <p className="mt-0.5 text-[11px] text-slate-400">{g.statute}</p>
              </div>
              <span className="mt-1 shrink-0 text-slate-400">{open === i ? '▲' : '▼'}</span>
            </button>
            {open === i && (
              <div className="border-t border-slate-100 px-5 pb-5 pt-3">
                <p className="mb-3 text-sm leading-relaxed text-slate-700">{g.body}</p>
                <ul className="mb-3 space-y-1.5">
                  {g.bullets.map((b) => (
                    <li key={b} className="flex gap-2 text-xs text-slate-600">
                      <span className="mt-0.5 shrink-0 text-emerald-500">✓</span>
                      <span>{b}</span>
                    </li>
                  ))}
                </ul>
                {g.links.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {g.links.map((l) => (
                      <a
                        key={l.label}
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-100"
                      >
                        {l.label} ↗
                      </a>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs text-slate-400">
        The unequal-appraisal ground (§41.43(b)(3)) is automatically computed when you enter your address above. Use the Advanced Options panel to add flood zone, condition, and characteristics evidence.
      </p>
    </section>
  );
}

// ─── Small presentational pieces ───────────────────────────────────────────────

function DownloadButton({
  title,
  subtitle,
  onClick,
  primary,
}: {
  title: string;
  subtitle: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex flex-1 items-center gap-3 rounded-xl px-4 py-3 text-left transition ${
        primary
          ? 'bg-slate-900 text-white hover:bg-slate-800'
          : 'border border-slate-300 bg-white text-slate-800 hover:border-slate-400'
      }`}
    >
      <svg
        className={`h-6 w-6 shrink-0 ${primary ? 'text-emerald-400' : 'text-emerald-600'}`}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="7 10 12 15 17 10" />
        <line x1="12" y1="15" x2="12" y2="3" />
      </svg>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className={`block text-xs ${primary ? 'text-slate-300' : 'text-slate-500'}`}>
          {subtitle}
        </span>
      </span>
    </button>
  );
}

function VerdictPill({ code }: { code: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    protest: { label: 'Worth protesting', cls: 'bg-emerald-600 text-white' },
    dont_protest: { label: 'Likely not worth it', cls: 'bg-slate-200 text-slate-700' },
    borderline: { label: 'Borderline', cls: 'bg-amber-200 text-amber-900' },
    incomplete: { label: 'Not enough data', cls: 'bg-amber-200 text-amber-900' },
  };
  const v = map[code] ?? map.incomplete;
  return (
    <span className={`rounded-full px-3 py-1 text-xs font-semibold ${v.cls}`}>{v.label}</span>
  );
}

function FreeComps({ subject }: { subject: import('./types').SubjectProperty }) {
  const zip = subject.address.match(/\b(7\d{4})\b/)?.[1] ?? null;
  const trend = getZipTrend(zip);

  const zillowUrl = zip
    ? `https://www.zillow.com/homes/recently_sold/${zip}_rb/`
    : `https://www.zillow.com/homes/recently_sold/${encodeURIComponent(subject.address)}_rb/`;
  const redfinUrl = zip
    ? `https://www.redfin.com/zipcode/${zip}/filter/include=sold-6mo`
    : `https://www.redfin.com/stingray/do/location-autocomplete?location=${encodeURIComponent(subject.address)}&v=2`;

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="font-semibold text-slate-900">Find free sold comps</h3>
      <p className="mt-1 text-xs text-slate-500">
        Use these links to find recently sold homes near yours. Enter the prices below under
        Advanced options → Recent comparable sales to strengthen your market-value argument.
      </p>

      {trend && zip && (
        <div className="mt-3 rounded-lg bg-slate-50 px-4 py-2.5 text-xs text-slate-600">
          <span className="font-medium">ZIP {zip} median sale price:</span>{' '}
          {fmtUSD(trend.medianSalePrice)} ({trend.latestMonth}),{' '}
          <span className={trend.pctChange12mo >= 0 ? 'text-emerald-700' : 'text-red-600'}>
            {trend.pctChange12mo >= 0 ? '+' : ''}{trend.pctChange12mo.toFixed(1)}%
          </span>{' '}
          vs a year ago &middot;{' '}
          <a
            href="https://www.redfin.com/news/data-center/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Redfin Data Center
          </a>
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-3">
        <a
          href={zillowUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Zillow sold listings ↗
        </a>
        <a
          href={redfinUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Redfin sold listings ↗
        </a>
      </div>

      <ol className="mt-4 space-y-1 text-xs text-slate-500 list-decimal list-inside">
        <li>Open a link above and filter to homes sold in the last 12 months, ±20% of your {subject.livingAreaSqft > 0 ? `${subject.livingAreaSqft.toLocaleString()} sqft` : 'size'}.</li>
        <li>Pick 3–5 comparable sales — note the address, sale price, sqft, and date.</li>
        <li>Enter them under <strong className="text-slate-700">Advanced options → Recent comparable sales</strong> above and re-run.</li>
      </ol>

      <p className="mt-3 text-xs text-slate-400">
        ~Half of TX sold listings hide the price (non-disclosure state). If a price is hidden:
        any realtor will run a free CMA from NTREIS, or request the CAD&apos;s own comp grid
        under Tex. Tax Code §41.461.
      </p>
    </section>
  );
}

function Stat({ label, value, accent, help }: { label: string; value: string; accent?: boolean; help?: string }) {
  const [showHelp, setShowHelp] = useState(false);

  return (
    <div>
      <div className="flex items-center gap-1">
        <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
        {help && (
          <button
            type="button"
            onMouseEnter={() => setShowHelp(true)}
            onMouseLeave={() => setShowHelp(false)}
            onClick={() => setShowHelp(!showHelp)}
            className="text-slate-300 hover:text-slate-500 text-xs font-bold"
            title="Click for explanation"
          >
            ⓘ
          </button>
        )}
      </div>
      <div className={`mt-1 text-lg font-semibold ${accent ? 'text-emerald-600' : 'text-slate-900'}`}>
        {value}
      </div>
      {help && showHelp && (
        <div className="mt-2 text-xs text-slate-600 bg-slate-50 p-2 rounded border border-slate-200 leading-relaxed">
          {help}
        </div>
      )}
    </div>
  );
}

function Note({ children, tone }: { children: React.ReactNode; tone: 'info' | 'muted' | 'warn' }) {
  const cls =
    tone === 'info'
      ? 'border-sky-200 bg-sky-50 text-sky-800'
      : tone === 'warn'
        ? 'border-amber-200 bg-amber-50 text-amber-800'
        : 'border-slate-200 bg-slate-50 text-slate-500';
  return <p className={`mt-4 rounded-lg border p-3 text-xs ${cls}`}>{children}</p>;
}

function Trust({ children }: { children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <svg className="h-4 w-4 text-emerald-500" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
        <path
          fillRule="evenodd"
          d="M16.704 5.29a1 1 0 010 1.42l-7.5 7.5a1 1 0 01-1.42 0l-3.5-3.5a1 1 0 011.42-1.42l2.79 2.79 6.79-6.79a1 1 0 011.42 0z"
          clipRule="evenodd"
        />
      </svg>
      {children}
    </span>
  );
}

function Spinner() {
  return (
    <svg className="h-4 w-4 animate-spin text-emerald-600" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
    </svg>
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
    <div className="mt-5 overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-400">
            <th className="py-2 pr-4 font-medium">Address</th>
            <th className="py-2 pr-4 text-right font-medium">SqFt</th>
            <th className="py-2 pr-4 text-right font-medium">Year</th>
            <th className="py-2 pr-4 text-right font-medium">Appraised</th>
            <th className="py-2 text-right font-medium">$/sqft</th>
          </tr>
        </thead>
        <tbody>
          {comps.slice(0, 15).map((c) => (
            <tr key={c.account} className="border-b border-slate-100">
              <td className="py-1.5 pr-4 text-slate-600">{c.address}</td>
              <td className="py-1.5 pr-4 text-right text-slate-600">{fmtNum(c.livingAreaSqft)}</td>
              <td className="py-1.5 pr-4 text-right text-slate-600">{c.yearBuilt || '-'}</td>
              <td className="py-1.5 pr-4 text-right text-slate-600">{fmtUSD(c.appraisedValue)}</td>
              <td
                className={`py-1.5 text-right font-medium ${
                  c.pricePerSqft < subjectPsf ? 'text-emerald-600' : 'text-slate-500'
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

// ─── Advanced evidence panel ───────────────────────────────────────────────────

function AdvancedPanel(props: {
  rentcastKey: string;
  setRentcastKey: (v: string) => void;
  manualComps: ManualComp[];
  addManualComp: () => void;
  addBulkComps: (comps: ManualComp[]) => void;
  setShowBulkCompsModal: (show: boolean) => void;
  updateComp: (i: number, patch: Partial<ManualComp>) => void;
  removeComp: (i: number) => void;
  purchasePrice: string;
  setPurchasePrice: (v: string) => void;
  purchaseDate: string;
  setPurchaseDate: (v: string) => void;
  repairTotal: string;
  setRepairTotal: (v: string) => void;
  condition: PropertyCondition;
  setCondition: (v: PropertyCondition) => void;
  characteristics: PropertyCharacteristics;
  setCharacteristics: (v: PropertyCharacteristics) => void;
}) {
  const inp =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';
  const conditionTotal =
    props.condition.foundation + props.condition.roof + props.condition.hvac +
    props.condition.plumbingElectrical + props.condition.other;

  return (
    <div className="mt-4 space-y-6 rounded-xl border border-slate-200 bg-slate-50 p-5">

      {/* ── Purchase price ─────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="block text-sm font-semibold text-slate-700">
            Recent purchase price
          </label>
          <input
            type="number"
            value={props.purchasePrice}
            onChange={(e) => props.setPurchasePrice(e.target.value)}
            placeholder="e.g. 1025000"
            className={`mt-1 ${inp}`}
          />
          <input
            type="date"
            value={props.purchaseDate}
            onChange={(e) => props.setPurchaseDate(e.target.value)}
            className={`mt-2 ${inp}`}
          />
          {(() => {
            const adj = adjustToToday(Number(props.purchasePrice), props.purchaseDate);
            if (adj) {
              return (
                <p className="mt-1 text-xs text-emerald-700">
                  ≈ {fmtUSD(adj.adjustedValue)} in today&apos;s market ({adj.area} HPI{' '}
                  {adj.pctChange >= 0 ? '+' : ''}
                  {adj.pctChange.toFixed(0)}% since {adj.fromLabel}).
                </p>
              );
            }
            return (
              <p className="mt-1 text-xs text-slate-500">
                A recent arms-length sale is the strongest market evidence. Add the date and we
                age it to today with the public FHFA price index.
              </p>
            );
          })()}
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700">
            Other repair estimate total
          </label>
          <input
            type="number"
            value={props.repairTotal}
            onChange={(e) => props.setRepairTotal(e.target.value)}
            placeholder="e.g. 35000"
            className={`mt-1 ${inp}`}
          />
          <p className="mt-1 text-xs text-slate-500">
            Use if you have a single lump-sum estimate. Or itemize below.
          </p>
        </div>
      </div>

      {/* ── Property condition ─────────────────────────────────── */}
      <div>
        <label className="block text-sm font-semibold text-slate-700">
          Property condition issues
        </label>
        <p className="mt-1 text-xs text-slate-500">
          Enter contractor bids or estimates for known defects. These reduce the market value we
          argue and are listed as supporting evidence in your board packet.
        </p>
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {(
            [
              { key: 'foundation', label: 'Foundation' },
              { key: 'roof',       label: 'Roof' },
              { key: 'hvac',       label: 'HVAC' },
              { key: 'plumbingElectrical', label: 'Plumbing / Elec.' },
            ] as { key: keyof PropertyCondition; label: string }[]
          ).map(({ key, label }) => (
            <div key={key}>
              <label className="text-[11px] font-medium text-slate-500">{label}</label>
              <input
                type="number"
                min="0"
                value={(props.condition[key] as number) || ''}
                onChange={(e) =>
                  props.setCondition({ ...props.condition, [key]: Number(e.target.value) })
                }
                placeholder="$0"
                className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
            </div>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3">
          <div>
            <label className="text-[11px] font-medium text-slate-500">Other</label>
            <input
              type="number"
              min="0"
              value={props.condition.other || ''}
              onChange={(e) =>
                props.setCondition({ ...props.condition, other: Number(e.target.value) })
              }
              placeholder="$0"
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          {conditionTotal > 0 && (
            <div className="flex items-end pb-1.5">
              <span className="text-sm font-semibold text-emerald-700">
                Total: {fmtUSD(conditionTotal)}
              </span>
            </div>
          )}
        </div>
        <input
          type="text"
          value={props.condition.notes}
          onChange={(e) => props.setCondition({ ...props.condition, notes: e.target.value })}
          placeholder="Notes (e.g. 'foundation quote from ABC Contractors, June 2025')"
          className={`mt-2 ${inp}`}
        />
      </div>

      {/* ── Property characteristics mismatch ─────────────────── */}
      <div>
        <label className="block text-sm font-semibold text-slate-700">
          CAD record discrepancies
        </label>
        <p className="mt-1 text-xs text-slate-500">
          Wrong square footage in the CAD record is one of the most common and winnable
          protest grounds — it directly changes the $/sqft math. Note any discrepancies here
          and we&apos;ll include them as an additional argument.
        </p>
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="text-[11px] font-medium text-slate-500">
              Your actual living area (sqft), if different from the CAD record
            </label>
            <input
              type="number"
              min="0"
              value={props.characteristics.actualSqft ?? ''}
              onChange={(e) =>
                props.setCharacteristics({
                  ...props.characteristics,
                  actualSqft: e.target.value ? Number(e.target.value) : null,
                })
              }
              placeholder="Leave blank if correct"
              className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
            />
          </div>
          <div className="flex items-end pb-1.5">
            <label className="flex cursor-pointer items-center gap-2 text-sm text-slate-600">
              <input
                type="checkbox"
                checked={props.characteristics.wrongQualityClass}
                onChange={(e) =>
                  props.setCharacteristics({
                    ...props.characteristics,
                    wrongQualityClass: e.target.checked,
                  })
                }
                className="h-4 w-4 rounded border-slate-300 accent-emerald-600"
              />
              Quality class / grade is wrong
            </label>
          </div>
        </div>
        <input
          type="text"
          value={props.characteristics.characteristicsNotes}
          onChange={(e) =>
            props.setCharacteristics({
              ...props.characteristics,
              characteristicsNotes: e.target.value,
            })
          }
          placeholder="Describe what is wrong (e.g. 'CAD shows 4-car garage, we have 2')"
          className={`mt-2 ${inp}`}
        />
      </div>

      {/* ── Manual comps ──────────────────────────────────────── */}
      <div className="rounded-lg border-2 border-emerald-200 bg-emerald-50 p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex-1">
            <label className="text-sm font-semibold text-slate-900">💡 Add comparable sales (strongest evidence)</label>
            <p className="mt-1 text-xs text-slate-700">
              Homes on your street that sold recently. Same-street comps are most powerful for ARB hearings.
            </p>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => props.setShowBulkCompsModal(true)}
              className="rounded-lg bg-emerald-600 text-white px-4 py-2 text-sm font-semibold hover:bg-emerald-700 whitespace-nowrap shadow-md"
            >
              📋 Bulk Paste
            </button>
            <button
              type="button"
              onClick={props.addManualComp}
              className="rounded-lg bg-white border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              + Single
            </button>
          </div>
        </div>
        <p className="mt-3 text-xs text-slate-600 border-t border-emerald-200 pt-3">
          <strong>How to find comps:</strong> Go to Zillow or Redfin &rarr; Filter "Sold" homes &rarr; Search your street &rarr; Copy addresses, sqft, prices, dates &rarr; Paste here using the 📋 Bulk Paste button.
        </p>
        {props.manualComps.length > 0 && (
          <div className="mt-2 grid grid-cols-12 gap-2 px-1 text-[11px] font-medium uppercase tracking-wide text-slate-400">
            <span className="col-span-4">Address</span>
            <span className="col-span-3">Sale price</span>
            <span className="col-span-2">SqFt</span>
            <span className="col-span-2">Sold date</span>
            <span className="col-span-1" />
          </div>
        )}
        {props.manualComps.map((c, i) => {
          const psf = c.salePrice > 0 && c.livingAreaSqft > 0 ? c.salePrice / c.livingAreaSqft : 0;
          return (
            <div key={i} className="mt-1">
              <div className="grid grid-cols-12 gap-2">
                <input
                  className="col-span-4 rounded border border-slate-300 px-2 py-1 text-sm"
                  placeholder="123 Main St"
                  value={c.address}
                  onChange={(e) => props.updateComp(i, { address: e.target.value })}
                />
                <input
                  className="col-span-3 rounded border border-slate-300 px-2 py-1 text-sm"
                  placeholder="Sale price"
                  type="number"
                  value={c.salePrice || ''}
                  onChange={(e) => props.updateComp(i, { salePrice: Number(e.target.value) })}
                />
                <input
                  className="col-span-2 rounded border border-slate-300 px-2 py-1 text-sm"
                  placeholder="SqFt"
                  type="number"
                  value={c.livingAreaSqft || ''}
                  onChange={(e) => props.updateComp(i, { livingAreaSqft: Number(e.target.value) })}
                />
                <input
                  className="col-span-2 rounded border border-slate-300 px-2 py-1 text-sm"
                  type="date"
                  value={c.saleDate}
                  onChange={(e) => props.updateComp(i, { saleDate: e.target.value })}
                />
                <button
                  type="button"
                  onClick={() => props.removeComp(i)}
                  className="col-span-1 rounded text-slate-400 hover:text-red-600"
                  aria-label="Remove comp"
                >
                  ×
                </button>
              </div>
              {psf > 0 && (
                <p className="mt-0.5 pr-8 text-right text-[11px] text-slate-500">
                  {fmtPsf(psf)}/sqft
                </p>
              )}
            </div>
          );
        })}
      </div>

      <details className="text-sm">
        <summary className="cursor-pointer text-slate-500">RentCast API key (advanced)</summary>
        <input
          type="password"
          value={props.rentcastKey}
          onChange={(e) => props.setRentcastKey(e.target.value)}
          placeholder="stored only in your browser"
          className={`mt-2 ${inp}`}
        />
        <p className="mt-1 text-xs text-slate-500">
          Optional automated valuation. May be blocked by the browser (CORS); manual comps are
          the reliable fallback.
        </p>
      </details>
    </div>
  );
}

export default App;
