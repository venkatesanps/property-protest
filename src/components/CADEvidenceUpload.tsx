import { useState } from 'react';
import type { ExtractedCADEvidence } from '../types';
import { parseCADEvidencePDF } from '../utils/pdf-parser';

export function CADEvidenceUpload({
  onEvidenceLoaded,
}: {
  onEvidenceLoaded: (evidence: ExtractedCADEvidence) => void;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [extracted, setExtracted] = useState<ExtractedCADEvidence | null>(null);

  async function handleFileSelect(file: File) {
    if (!file.type.includes('pdf')) {
      setError('Please upload a PDF file.');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const evidence = await parseCADEvidencePDF(file);
      setExtracted(evidence);
      onEvidenceLoaded(evidence);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to parse PDF';
      setError(msg);
    } finally {
      setIsLoading(false);
    }
  }

  if (extracted) {
    return (
      <section className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
        <h3 className="font-semibold text-slate-900">CAD Evidence Extracted</h3>
        <div className="mt-4 space-y-3 text-sm">
          <div>
            <p className="font-medium text-slate-700">County</p>
            <p className="text-slate-600 capitalize">{extracted.county} CAD</p>
          </div>
          {extracted.propertyId && (
            <div>
              <p className="font-medium text-slate-700">Property ID</p>
              <p className="text-slate-600">{extracted.propertyId}</p>
            </div>
          )}
          <div>
            <p className="font-medium text-slate-700">Methodology</p>
            <p className="capitalize text-slate-600">{extracted.valuationMethod}</p>
          </div>
          <div>
            <p className="font-medium text-slate-700">Comparables found</p>
            <p className="text-slate-600">
              {extracted.equityComps.length} equity
              {extracted.marketComps.length > 0 && ` + ${extracted.marketComps.length} market`}
            </p>
          </div>
          {extracted.equityIndicatedValue && (
            <div>
              <p className="font-medium text-slate-700">DCAD's equity indicated value</p>
              <p className="text-emerald-700 font-semibold">
                ${extracted.equityIndicatedValue.toLocaleString()}
              </p>
            </div>
          )}
          {extracted.extractionNotes.length > 0 && (
            <div className="rounded bg-white/50 p-2">
              <p className="text-xs font-medium text-slate-700">Notes</p>
              {extracted.extractionNotes.map((note, i) => (
                <p key={i} className="text-xs text-slate-600">
                  • {note}
                </p>
              ))}
            </div>
          )}
          <p className="text-xs text-slate-500 italic">
            Confidence: {(extracted.confidence * 100).toFixed(0)}%
            {extracted.confidence < 0.7 && ' (review data for accuracy)'}
          </p>
        </div>
        <button
          onClick={() => {
            setExtracted(null);
            setError(null);
          }}
          className="mt-4 text-sm text-emerald-700 hover:text-emerald-800 font-medium underline"
        >
          Upload different PDF
        </button>
      </section>
    );
  }

  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="font-semibold text-slate-900">CAD Evidence Analysis</h3>
      <p className="mt-1 text-sm text-slate-600">
        Upload your CAD's evidence packet (PDF) to identify weaknesses and generate a counter-strategy.
      </p>

      <div className="mt-4 rounded-lg border-2 border-dashed border-slate-300 bg-slate-50 p-6 text-center">
        <label className="cursor-pointer">
          <div className="space-y-2">
            <div className="text-2xl text-slate-400">📄</div>
            <p className="font-medium text-slate-700">
              {isLoading ? 'Parsing PDF...' : 'Choose a PDF file'}
            </p>
            <p className="text-xs text-slate-500">
              {isLoading
                ? 'This may take a few seconds for larger documents'
                : 'Supported: Denton, Collin, Tarrant Counties'}
            </p>
          </div>
          <input
            type="file"
            accept=".pdf"
            onChange={(e) => {
              const file = e.currentTarget.files?.[0];
              if (file) handleFileSelect(file);
            }}
            disabled={isLoading}
            className="hidden"
          />
        </label>
      </div>

      {error && (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3">
          <p className="text-sm font-medium text-red-900">Error parsing PDF</p>
          <p className="text-xs text-red-700 mt-1">{error}</p>
        </div>
      )}

      <p className="mt-4 text-xs text-slate-500">
        📎 <strong>Where to get it:</strong> Log into your county CAD's evidence portal or request the evidence
        packet from the CAD directly under §41.461 of the Texas Tax Code.
      </p>
    </section>
  );
}
