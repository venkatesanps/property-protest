# Roadmap: CAD Evidence Integration & Auto Counter-Strategy

**Goal:** Transform ProtestIQ from a standalone analysis tool into a **complete property tax protest platform** that:
1. Works for ANY county (all 254 in Texas)
2. Automatically analyzes CAD evidence packets
3. Generates tailored counter-strategies
4. Produces county-specific talking points and settlement targets

---

## Current State (Post June 13, 2026)

✅ Street-level comparable analysis (same-street comps detection)  
✅ Homestead cap floor calculation  
✅ Equity analysis with multiple methods  
✅ Market-value evidence (RentCast, manual comps, recent purchase)  
✅ PDF generation (Board packet + Personal playbook)  
❌ CAD evidence intake  
❌ Automated counter-strategy analysis  
❌ County-specific settlement guidance  

---

## Phase 1: Universalize Street-Level Comp Analysis (DONE)

**Status:** Deployed June 13, 2026

Code changes:
- `src/engine/equity.ts`: Street-name extraction + same-street comp filtering
- `src/engine/verdict.ts`: Prioritize street-level indicated values as candidates
- `src/pdf/packet.ts`: Lead talking points with street-level comps when available

Verification needed:
- [ ] Test with Collin County property (Frisco/Plano area)
- [ ] Test with Tarrant County property (Arlington/Fort Worth area)
- [ ] Verify street-name extraction handles all address formats

---

## Phase 2: CAD Evidence PDF Upload & Parsing

### 2.1 UI Enhancement: Evidence Upload Component

**Location:** `src/App.tsx` → AdvancedPanel (or new Evidence section)

```typescript
// New component: CADEvidenceUpload
interface CADEvidenceUpload {
  file: File;
  county: County;
  propertyId?: string;
}

// Data extracted from PDF:
interface ExtractedCADEvidence {
  county: County;
  propertyId: string;
  subjectAddress: string;
  currentAppraised: number;
  currentNetAppraised: number;
  homesteadCap: number | null;
  
  // Market value approach (if DCAD used sales comps)
  marketComps: {
    address: string;
    salePrice: number;
    saleDate: string;
    sqft: number;
    adjustments?: Record<string, number>;
  }[];
  marketMedian?: number;
  
  // Equity approach (if DCAD used appraisal comps)
  equityComps: {
    address: string;
    appraised: number;
    sqft: number;
    class?: string;
    yearBuilt?: number;
    landValue?: number;
    improvementValue?: number;
    adjustments?: Record<string, number>;
  }[];
  equityMedian?: number;
  
  // DCAD's reasoning
  valuationMethod: 'cost-approach' | 'market-sales' | 'equity' | 'hybrid';
  adjustmentDetails: Record<string, number>;
  
  // Metadata
  extractedAt: string;
  confidence: number; // 0-1, how confident we are in the extraction
}
```

### 2.2 PDF Parsing Logic

**New file:** `src/utils/pdf-parser.ts`

Use `pdfjs-dist` library to:
1. Extract all text from PDF
2. Identify sections (comparable sales, equity analysis, subject property card)
3. Parse tables (comps with addresses, values, sqft, adjustments)
4. Extract key numeric values
5. Map DCAD field names to standard schema

**Challenges:**
- Each county's CAD has different evidence packet format
- Denton CAD: structured tables, clear headings
- Collin CAD: likely similar format, need to verify
- Tarrant CAD: unknown format
- Some CADs hand-write values or use scans → OCR needed

**Solution:** Start with Denton (we have the example), add Collin/Tarrant as needed.

### 2.3 Evidence Intake Flow

```
User → Advanced Panel → "Upload CAD Evidence" button
          ↓
   Select PDF file (county auto-detected from content)
          ↓
   PDF parser extracts data
          ↓
   Confidence check: if <60%, ask user to review & correct
          ↓
   Store evidence in app state
          ↓
   Re-run analysis with CAD evidence context
          ↓
   Generate counter-strategy report
```

---

## Phase 3: Automated Counter-Strategy Analysis

### 3.1 New Engine: `src/engine/counter-strategy.ts`

```typescript
interface CADAnalysis {
  // What DCAD did
  evidenceUsed: ExtractedCADEvidence;
  
  // What we found
  analysis: {
    // Inconsistencies in their analysis
    inconsistencies: {
      type: 'indicated-vs-appraised' | 'market-vs-equity' | 'methodology-shift';
      severity: 'minor' | 'moderate' | 'major';
      description: string;
      dollar_impact: number;
    }[];
    
    // Where they're weak
    weaknesses: {
      type: 'cherry-picked-comps' | 'different-street' | 'outdated-sales' | 'methodology-issue';
      strength: 'weak' | 'moderate' | 'strong';
      description: string;
      counter_evidence: string; // how to rebut
    }[];
    
    // Where they're strong (be honest)
    strengths: {
      description: string;
      how_to_address: string;
    }[];
  };
  
  // Recommended strategy
  strategy: {
    primary_argument: string; // what to lead with
    secondary_arguments: string[];
    weaknesses_to_avoid: string[];
    
    settlement_targets: {
      aggressive: number; // 90% of user's street-level indicated
      reasonable: number; // 95% 
      conservative: number; // 98%
    };
    
    county_specific_notes: string; // how Denton ARBs typically rule
    likely_objections: {
      objection: string;
      your_response: string;
    }[];
  };
}

export function analyzeCADEvidence(
  evidence: ExtractedCADEvidence,
  userAnalysis: AnalysisResult
): CADAnalysis
```

### 3.2 Key Analysis Points

For each CAD evidence packet, check:

1. **Indicated vs Appraised Gap:**
   - If DCAD's indicated values suggest higher OR lower value than appraised
   - If gap > 1%, flag inconsistency

2. **Comp Selection Bias:**
   - Are comps all on different streets while user has same-street comps available?
   - Are comp properties notably different (size, age, class) when better matches exist?
   - Did DCAD exclude obvious comparables?

3. **Methodology Shifting:**
   - Did DCAD use market sales for one property, equity for another?
   - Did they switch methods mid-analysis without explanation?

4. **Adjustment Suspicion:**
   - Are adjustments asymmetric (always upward, always downward)?
   - Are adjustments justified in the evidence?

5. **Market vs Equity Conflict:**
   - If market comps indicate lower value than equity approach, which is defensible?
   - Use the lower one as your target.

6. **County Patterns:**
   - Denton ARBs historically accept ±5% variance from indicated value
   - Tarrant ARBs focus on same-street evidence
   - Collin ARBs weight certified roll vintage heavily
   → Tailor strategy accordingly

---

## Phase 4: Enhanced Talking Points & Settlement Guide

### 4.1 New PDF Output: Counter-Strategy Report

**New file:** `src/pdf/counter-strategy-packet.ts`

Generate a 3–4 page report that:
1. Shows DCAD's evidence visually (copy relevant pages)
2. Annotates their weaknesses (margin notes)
3. Shows your counter-evidence (side-by-side)
4. Provides county-specific settlement guidance
5. Lists likely objections + your rebuttals
6. Gives settlement negotiation flowchart

### 4.2 County-Specific Modules

**New directory:** `src/counties/`

```
src/counties/
  collin.ts        (Collin County ARB patterns, settlement targets, objections)
  denton.ts        (Denton County — we have this knowledge already)
  tarrant.ts       (Tarrant County — need to build)
  [others].ts      (Add as needed)
```

Each module exports:
```typescript
interface CountyProfile {
  name: string;
  arbPatterns: {
    historical_acceptance_range: [min: number, max: number]; // % from indicated
    favored_methods: ('equity' | 'market' | 'cost')[]; // in order of weight
    settlement_likelihood: number; // 0-1
    typical_settlement_discount: number; // how much they move
  };
  objection_responses: Record<string, string>;
  settlement_guidance: {
    ask: number;
    target: number;
    walk_away: number;
  };
}
```

---

## Phase 5 (Future): Automated CAD Portal Scraping

**Not in MVP, but possible future enhancement:**

- **Collin:** Public Socrata API → Auto-fetch comparable sales
- **Denton:** Portal requires JS rendering → Use Puppeteer or similar
- **Tarrant:** TADMap ArcGIS → Query via API
- **Others:** Vary by CAD

Would require:
- County detection from address
- Portal URL mapping
- Login automation (if required) OR public link generation
- Evidence ID extraction from URL parameters

---

## Implementation Roadmap

### Sprint 1: PDF Upload & Parsing (1–2 weeks)
- [ ] Add CAD Evidence Upload button to AdvancedPanel
- [ ] Implement `pdf-parser.ts` for Denton CAD format
- [ ] Parse tables, extract comps, identify methodology
- [ ] Store evidence in component state
- [ ] Display parsed evidence back to user for review/correction

### Sprint 2: Counter-Strategy Engine (1 week)
- [ ] Build `counter-strategy.ts` analyzer
- [ ] Detect inconsistencies in DCAD analysis
- [ ] Compare DCAD comps against user's street-level comps
- [ ] Generate talking points + rebuttals

### Sprint 3: Enhanced PDF Output (1 week)
- [ ] Create Counter-Strategy Report PDF
- [ ] Add DCAD evidence annotations
- [ ] County-specific settlement guidance

### Sprint 4: County Profiles (2–3 weeks)
- [ ] Build Collin County profile
- [ ] Build Tarrant County profile
- [ ] Test with real users in each county
- [ ] Refine settlement targets based on feedback

### Sprint 5: QA & Launch (1 week)
- [ ] Test full flow: upload → parse → analyze → generate PDFs
- [ ] Test across counties
- [ ] Documentation update
- [ ] User guide for uploading CAD evidence

---

## Design Mockup: Evidence Upload Flow

```
┌─────────────────────────────────────────────────────────────────┐
│ ProtestIQ Analysis Results                                       │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│ [Your Results]  [CAD Evidence Analysis]  [Counter-Strategy]      │
│                                                                   │
│ ┌───────────────────────────────────────────────────────────────┐│
│ │ CAD Evidence Analysis                                         ││
│ │                                                               ││
│ │ Upload your CAD's evidence packet (PDF) to analyze their     ││
│ │ methodology and identify weaknesses in their appraisal.      ││
│ │                                                               ││
│ │ [ Choose File... ]  [Upload]                                 ││
│ │                                                               ││
│ │ Supported: Denton, Collin, Tarrant Counties                  ││
│ │                                                               ││
│ └───────────────────────────────────────────────────────────────┘│
│                                                                   │
│ [After Upload]                                                    │
│                                                                   │
│ ┌───────────────────────────────────────────────────────────────┐│
│ │ CAD EVIDENCE EXTRACTED                                        ││
│ │                                                               ││
│ │ County: Denton CAD                                            ││
│ │ Current Appraised: $836,185                                   ││
│ │ Methodology: Equity analysis (5 Rolling Thunder Rd comps)     ││
│ │                                                               ││
│ │ ⚠️ INCONSISTENCY DETECTED:                                   ││
│ │    DCAD's indicated value: $852,928                           ││
│ │    But appraised you at: $836,185                             ││
│ │    Gap: $16,743 (undervalued relative to own comps)          ││
│ │                                                               ││
│ │ 💡 WEAKNESS FOUND:                                           ││
│ │    DCAD used Rolling Thunder Rd comps (0.06–0.16 mi away)     ││
│ │    But your street (Angel Falls Dr) has 3 better comps       ││
│ │    Same street, same class, same year built                  ││
│ │                                                               ││
│ │ ✅ STRONG COUNTER: Same-street median: $241.87/sqft          ││
│ │    Indicates: $808,789 (defendable, beats cap floor)         ││
│ │                                                               ││
│ └───────────────────────────────────────────────────────────────┘│
│                                                                   │
│ [Download] Counter-Strategy Report                               │
│ [Download] Talking Points (Denton ARB-specific)                  │
│ [Download] Board Evidence Packet (updated)                       │
│                                                                   │
└─────────────────────────────────────────────────────────────────┘
```

---

## Success Metrics

1. **Phase 1:** All county addresses correctly identify same-street comps
2. **Phase 2:** PDF parser extracts >90% of data correctly; confidence >70%
3. **Phase 3:** Counter-strategy identifies 3+ inconsistencies per packet
4. **Phase 4:** Settlement targets match historical ARB patterns within 5%
5. **Overall:** Users using counter-strategy settle 60%+ of cases (vs 30% baseline)

---

## Questions for User

1. **Priority:** Should we do Phase 2 (PDF upload) next, or verify Phase 1 works across all counties first?

2. **Scope:** Should counter-strategy apply to all 254 Texas counties, or focus on major ones (Collin, Denton, Tarrant, Harris, Dallas, etc.)?

3. **User Effort:** For Phase 2, is asking users to upload CAD evidence acceptable, or do we wait for Phase 5 (auto-fetch)?

4. **Timeline:** How urgent? MVP for your case was done June 13. For this expanded vision?

---

## Files to Create/Modify

**New files:**
- `src/types.ts` → add `CADEvidenceData`, `CountyProfile`, `CADAnalysis` types
- `src/utils/pdf-parser.ts` → PDF extraction logic
- `src/engine/counter-strategy.ts` → Inconsistency detection & strategy generation
- `src/pdf/counter-strategy-packet.ts` → New PDF type
- `src/counties/collin.ts`, `denton.ts`, `tarrant.ts` → County profiles
- `src/App.tsx` → CAD Evidence upload UI component

**Modified files:**
- `src/App.tsx` → Add evidence tab/panel
- `src/pdf/packet.ts` → Reference counter-strategy data if available
