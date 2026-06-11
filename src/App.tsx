import { useState, useEffect, useRef, useCallback } from 'react';
import type { County, ManualComp, AppStep } from './types';
import { runAnalysis } from './engine/run';
import type { AnalysisResult } from './engine/run';
import { suggestAddresses, type AddressSuggestion } from './adapters/suggest';
import {
  generateBoardPacket,
  generatePersonalPacket,
  downloadPacket,
} from './pdf/packet';
import { fmtUSD, fmtNum, fmtPsf } from './format';
import { DISCLAIMER, PROTEST_DEADLINE, COMPTROLLER_FORM } from './constants';

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
  unsupported: 'bg-slate-100 text-slate-600',
};

function App() {
  const [address, setAddress] = useState('');
  const [selected, setSelected] = useState<AddressSuggestion | null>(null);
  const [step, setStep] = useState<AppStep>('input');
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AnalysisResult | null>(null);

  // optional evidence inputs
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [rentcastKey, setRentcastKey] = useState(
    () => localStorage.getItem(RENTCAST_KEY_STORAGE) ?? ''
  );
  const [manualComps, setManualComps] = useState<ManualComp[]>([]);
  const [purchasePrice, setPurchasePrice] = useState('');
  const [purchaseDate, setPurchaseDate] = useState('');
  const [repairTotal, setRepairTotal] = useState('');

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
            'No matching property found in Collin or Denton County. Check the address (this tool covers the Frisco / Collin / Denton area only).'
          );
          setStep('input');
          return;
        }
        target = matches[0];
        setSelected(target);
        setAddress(target.label);
      }

      const extras = {
        county: target.county as County,
        account: target.account,
        rentcastKey: rentcastKey.trim() || undefined,
        manualComps: manualComps.length ? manualComps : undefined,
        recentPurchasePrice: purchasePrice ? Number(purchasePrice) : undefined,
        recentPurchaseDate: purchaseDate || undefined,
        repairEstimateTotal: repairTotal ? Number(repairTotal) : undefined,
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
            Collin &amp; Denton County property tax protests
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

          <div className="mt-7 max-w-2xl">
            <AddressAutocomplete
              value={address}
              onChange={(v) => {
                setAddress(v);
                setSelected(null);
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

            <button
              type="button"
              onClick={() => setShowAdvanced((v) => !v)}
              className="mt-3 text-sm font-medium text-emerald-700 underline-offset-2 hover:underline"
            >
              {showAdvanced ? '− Hide' : '+ Add'} evidence to strengthen your case (optional)
            </button>

            {showAdvanced && (
              <AdvancedPanel
                rentcastKey={rentcastKey}
                setRentcastKey={setRentcastKey}
                manualComps={manualComps}
                addManualComp={addManualComp}
                updateComp={updateComp}
                removeComp={removeComp}
                purchasePrice={purchasePrice}
                setPurchasePrice={setPurchasePrice}
                purchaseDate={purchaseDate}
                setPurchaseDate={setPurchaseDate}
                repairTotal={repairTotal}
                setRepairTotal={setRepairTotal}
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
        {result && <Results result={result} onDownload={handleDownload} />}
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
}: {
  result: AnalysisResult;
  onDownload: (kind: 'board' | 'personal') => void;
}) {
  const { subject, capFloor, equity, market, verdict } = result;
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
        <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-4">
          <Stat label="Appraised" value={fmtUSD(subject.appraisedValue)} />
          <Stat label="Market" value={fmtUSD(subject.marketValue)} />
          <Stat label="Living area" value={`${fmtNum(subject.livingAreaSqft)} sqft`} />
          <Stat
            label="Taxable floor"
            value={capFloor.floor != null ? fmtUSD(capFloor.floor) : 'n/a'}
          />
        </div>
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
      </section>

      {/* equity */}
      {equity && (
        <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="font-semibold text-slate-900">Unequal appraisal (equity) analysis</h3>
          <div className="mt-5 grid grid-cols-2 gap-5 sm:grid-cols-3 lg:grid-cols-6">
            <Stat label="Your $/sqft" value={fmtPsf(equity.subjectPsf)} />
            <Stat label="Median $/sqft" value={fmtPsf(equity.neighborhoodMedianPsf)} />
            <Stat label="Indicated (refined)" value={fmtUSD(equity.indicatedValueRefined)} accent />
            {equity.indicatedValueClassMatched != null && (
              <Stat
                label={`Indicated (class ${subject.qualityClass})`}
                value={fmtUSD(equity.indicatedValueClassMatched)}
              />
            )}
            <Stat label="Indicated (size adj.)" value={fmtUSD(equity.indicatedValueSizeAdjusted)} />
            <Stat label="Rank" value={`#${equity.subjectRankOf} of ${equity.neighborhoodCount}`} />
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Rank 1 = highest $/sqft (most over-appraised). You are appraised higher than{' '}
            {equity.percentileHigher.toFixed(0)}% of comparable homes.
          </p>
          <CompTable
            comps={equity.refinedComps.length >= 3 ? equity.refinedComps : equity.comps}
            subjectPsf={equity.subjectPsf}
          />
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
                : 'your manual comps'}
          </p>
          <div className="mt-4">
            <Stat label="Estimated market value" value={fmtUSD(market.estimatedValue)} accent />
          </div>
        </section>
      )}

      {/* how to file */}
      <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="font-semibold text-slate-900">How to file</h3>
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
      </section>
    </div>
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

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</div>
      <div className={`mt-1 text-lg font-semibold ${accent ? 'text-emerald-600' : 'text-slate-900'}`}>
        {value}
      </div>
    </div>
  );
}

function Note({ children, tone }: { children: React.ReactNode; tone: 'info' | 'muted' }) {
  const cls =
    tone === 'info'
      ? 'border-sky-200 bg-sky-50 text-sky-800'
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
  updateComp: (i: number, patch: Partial<ManualComp>) => void;
  removeComp: (i: number) => void;
  purchasePrice: string;
  setPurchasePrice: (v: string) => void;
  purchaseDate: string;
  setPurchaseDate: (v: string) => void;
  repairTotal: string;
  setRepairTotal: (v: string) => void;
}) {
  const inp =
    'w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100';
  return (
    <div className="mt-4 space-y-5 rounded-xl border border-slate-200 bg-slate-50 p-5">
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
          <p className="mt-1 text-xs text-slate-500">
            A recent arms-length sale is the strongest market evidence.
          </p>
        </div>
        <div>
          <label className="block text-sm font-semibold text-slate-700">
            Documented repair estimates total
          </label>
          <input
            type="number"
            value={props.repairTotal}
            onChange={(e) => props.setRepairTotal(e.target.value)}
            placeholder="e.g. 35000"
            className={`mt-1 ${inp}`}
          />
          <p className="mt-1 text-xs text-slate-500">
            Contractor bids for foundation, roof, HVAC, etc. Deducted from the requested value.
          </p>
        </div>
      </div>

      <div>
        <div className="flex items-center justify-between">
          <label className="text-sm font-semibold text-slate-700">Manual comparable sales</label>
          <button
            type="button"
            onClick={props.addManualComp}
            className="rounded-lg bg-slate-200 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-300"
          >
            + Add comp
          </button>
        </div>
        {props.manualComps.map((c, i) => (
          <div key={i} className="mt-2 grid grid-cols-12 gap-2">
            <input
              className="col-span-5 rounded border border-slate-300 px-2 py-1 text-sm"
              placeholder="Address"
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
              className="col-span-3 rounded border border-slate-300 px-2 py-1 text-sm"
              placeholder="SqFt"
              type="number"
              value={c.livingAreaSqft || ''}
              onChange={(e) => props.updateComp(i, { livingAreaSqft: Number(e.target.value) })}
            />
            <button
              type="button"
              onClick={() => props.removeComp(i)}
              className="col-span-1 rounded text-slate-400 hover:text-red-600"
              aria-label="Remove"
            >
              ×
            </button>
          </div>
        ))}
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
          Optional automated valuation. May be blocked by the browser (CORS); manual comps are the
          reliable fallback.
        </p>
      </details>
    </div>
  );
}

export default App;
