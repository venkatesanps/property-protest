import { useState } from 'react';
import type { ManualComp } from '../types';
import { parseCompsFromPaste, type ParsedComp } from '../utils/parse-comps';

export function BulkCompsModal({
  onAdd,
  onClose,
}: {
  onAdd: (comps: ManualComp[]) => void;
  onClose: () => void;
}) {
  const [pastedText, setPastedText] = useState('');
  const [preview, setPreview] = useState<ParsedComp[] | null>(null);
  const [errors, setErrors] = useState<{ row: number; error: string }[]>([]);
  const [step, setStep] = useState<'paste' | 'review'>('paste');

  function handleParse() {
    const result = parseCompsFromPaste(pastedText);
    if (result.comps.length === 0) {
      setErrors(result.errors.length > 0 ? result.errors : [{ row: 0, error: 'No valid comps found' }]);
      return;
    }
    setPreview(result.comps);
    setErrors(result.errors);
    setStep('review');
  }

  function handleAdd() {
    if (!preview) return;
    const manualComps: ManualComp[] = preview.map((c) => ({
      address: c.address,
      livingAreaSqft: c.livingAreaSqft,
      salePrice: c.price,
      saleDate: `${c.yearSold}-01-01`,
      yearSold: c.yearSold,
      notes: '',
    }));
    onAdd(manualComps);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-lg max-w-2xl w-full max-h-[90vh] overflow-y-auto">
        <div className="p-6 border-b border-slate-200 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-slate-900">Bulk Add Comparable Properties</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 text-2xl leading-none"
          >
            ×
          </button>
        </div>

        {step === 'paste' ? (
          <div className="p-6 space-y-4">
            <p className="text-sm text-slate-600">
              Paste your comparable properties in CSV or tab-separated format. Include columns for:
              <br />
              <strong>address, sqft, price, year</strong>
            </p>

            <div className="bg-slate-50 border border-slate-200 rounded p-3 text-xs text-slate-700 font-mono">
              Example:
              <br />
              973 ANGEL FALLS DR, FRISCO TX | 3228 | 780000 | 2016
              <br />
              1093 ANGEL FALLS DR, FRISCO TX | 3204 | 775000 | 2015
            </div>

            <textarea
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              placeholder="Paste your comps here..."
              className="w-full h-40 p-3 border border-slate-300 rounded-lg font-mono text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
            />

            <div className="flex gap-3 justify-end">
              <button
                onClick={onClose}
                className="px-4 py-2 text-slate-700 hover:text-slate-900 font-medium"
              >
                Cancel
              </button>
              <button
                onClick={handleParse}
                disabled={!pastedText.trim()}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                Preview
              </button>
            </div>
          </div>
        ) : (
          <div className="p-6 space-y-4">
            {errors.length > 0 && (
              <div className="bg-yellow-50 border border-yellow-200 rounded-lg p-4">
                <p className="text-sm font-medium text-yellow-900">
                  {errors.length} row{errors.length !== 1 ? 's' : ''} skipped:
                </p>
                <ul className="mt-2 space-y-1">
                  {errors.map((e, i) => (
                    <li key={i} className="text-xs text-yellow-800">
                      Row {e.row}: {e.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-900">Preview ({preview?.length || 0} comps)</p>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-100">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-semibold text-slate-700">Address</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-700">Sqft</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-700">Price</th>
                      <th className="px-3 py-2 text-right text-xs font-semibold text-slate-700">Year</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200">
                    {preview?.map((comp, i) => (
                      <tr key={i} className="hover:bg-slate-50">
                        <td className="px-3 py-2 text-slate-900">{comp.address}</td>
                        <td className="px-3 py-2 text-right text-slate-600">{comp.livingAreaSqft.toLocaleString()}</td>
                        <td className="px-3 py-2 text-right text-slate-600">
                          ${comp.price.toLocaleString()}
                        </td>
                        <td className="px-3 py-2 text-right text-slate-600">{comp.yearSold}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex gap-3 justify-end">
              <button
                onClick={() => setStep('paste')}
                className="px-4 py-2 text-slate-700 hover:text-slate-900 font-medium"
              >
                Back
              </button>
              <button
                onClick={handleAdd}
                disabled={!preview || preview.length === 0}
                className="px-4 py-2 bg-emerald-600 text-white rounded-lg font-medium hover:bg-emerald-700 disabled:opacity-50"
              >
                Add {preview?.length || 0} Comps
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
