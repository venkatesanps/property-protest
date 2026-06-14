import type { ManualComp } from '../types';
import { fmtUSD, fmtPsf } from '../format';

export function CompAnalysis({ comps, subjectSqft }: { comps: ManualComp[]; subjectSqft: number }) {
  if (comps.length === 0) return null;

  const validComps = comps.filter((c) => c.salePrice > 0 && c.livingAreaSqft > 0);
  if (validComps.length === 0) return null;

  // Calculate statistics
  const prices = validComps.map((c) => c.salePrice).sort((a, b) => a - b);
  const psfs = validComps.map((c) => c.salePrice / c.livingAreaSqft).sort((a, b) => a - b);

  const median = prices[Math.floor(prices.length / 2)];
  const medianPsf = psfs[Math.floor(psfs.length / 2)];
  const avgPsf = validComps.reduce((sum, c) => sum + c.salePrice / c.livingAreaSqft, 0) / validComps.length;
  const indicatedValue = Math.round(subjectSqft * medianPsf);

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  return (
    <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
      <h3 className="font-semibold text-slate-900">📊 Comparable Properties Analysis</h3>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Comps Found</p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">{validComps.length}</p>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Median Sale Price</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{fmtUSD(median)}</p>
          <p className="mt-0.5 text-xs text-slate-600">
            Range: {fmtUSD(minPrice)} — {fmtUSD(maxPrice)}
          </p>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Median $/SqFt</p>
          <p className="mt-1 text-2xl font-bold text-slate-900">{fmtPsf(medianPsf)}</p>
          <p className="mt-0.5 text-xs text-slate-600">Average: {fmtPsf(avgPsf)}</p>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Your Indicated Value
          </p>
          <p className="mt-1 text-2xl font-bold text-emerald-700">{fmtUSD(indicatedValue)}</p>
          <p className="mt-0.5 text-xs text-slate-600">
            {subjectSqft.toLocaleString()} sqft × {fmtPsf(medianPsf)}
          </p>
        </div>
      </div>

      <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-xs font-medium text-slate-700">How This Works</p>
        <ul className="mt-2 space-y-2 text-xs text-slate-600">
          <li>
            ✓ <strong>Median price:</strong> We take the middle value from your {validComps.length} comps
            to avoid outliers.
          </li>
          <li>
            ✓ <strong>$/sqft:</strong> Dividing each sale price by living area shows how the market values
            per square foot.
          </li>
          <li>
            ✓ <strong>Your indicated value:</strong> Your property's sqft × median $/sqft = what ARB thinks
            your home should be worth.
          </li>
          <li>
            ✓ <strong>Settlement targets:</strong> We compare your indicated value to your current appraisal
            to calculate Ask, Target, and Floor.
          </li>
        </ul>
      </div>

      <div className="mt-4 rounded-lg bg-blue-50 border border-blue-200 p-4">
        <p className="text-xs font-medium text-blue-900">💡 Pro Tip</p>
        <p className="mt-1 text-xs text-blue-800">
          Same-street comps are strongest in ARB hearings. If all your comps are on the same street, lead
          with that in your opening statement: "I have comparable homes on my street that support a lower
          value."
        </p>
      </div>

      <div className="mt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-slate-100 border-b border-slate-200">
            <tr>
              <th className="px-3 py-2 text-left font-semibold text-slate-700">Address</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-700">Sold</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-700">Price</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-700">SqFt</th>
              <th className="px-3 py-2 text-right font-semibold text-slate-700">$/SqFt</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {validComps.map((comp, i) => {
              const psf = comp.salePrice / comp.livingAreaSqft;
              const year = comp.saleDate ? comp.saleDate.split('-')[0] : '—';
              return (
                <tr key={i} className="hover:bg-slate-50">
                  <td className="px-3 py-2 text-slate-900">{comp.address}</td>
                  <td className="px-3 py-2 text-right text-slate-600">{year}</td>
                  <td className="px-3 py-2 text-right font-medium text-slate-900">
                    {fmtUSD(comp.salePrice)}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">
                    {comp.livingAreaSqft.toLocaleString()}
                  </td>
                  <td className="px-3 py-2 text-right text-slate-600">{fmtPsf(psf)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
