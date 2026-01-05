import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  BarChart,
  Bar,
} from "recharts";
import { motion } from "framer-motion";
import {
  Download,
  Upload,
  ShieldAlert,
  Flame,
  Repeat,
  Radar,
  Brain,
  Clock,
  Lightbulb,
  Info,
  Maximize2,
  Minimize2,
} from "lucide-react";

/**
 * Persona Retention Dashboard
 * - Upload a CSV of user-month aggregates (recommended) OR raw text entries.
 * - Classifies dominant persona per user per month based on keyword groups.
 * - Computes next-month retention per persona, plus MoM deltas.
 *
 * Expected aggregate CSV columns (recommended):
 *   user_id, month, text, active_next_month
 * where:
 *   - month: YYYY-MM (calendar month)
 *   - text: concatenated messages for that user in that month (or a single message)
 *   - active_next_month: 1/0 (optional; if absent, dashboard derives it from presence of next month for same user)
 *
 * Optional raw format CSV columns:
 *   user_id, created_at, text
 * where created_at: ISO datetime. Month is derived.
 */

// --- Persona model (dominant priority):
const PERSONAS = [
  {
    key: "trust_erosion",
    label: "Trust erosion",
    priority: 1,
    icon: ShieldAlert,
    description: "Credibility damage: predicts retention loss.",
  },
  {
    key: "emotional",
    label: "Breaking point",
    priority: 2,
    icon: Flame,
    description: "Late-stage frustration: often right before disengagement.",
  },
  {
    key: "escalation",
    label: "Escalation & fatigue",
    priority: 3,
    icon: Repeat,
    description: "Repeated reporting / fatigue: power-complainer risk.",
  },
  {
    key: "reliability",
    label: "Reliability & predictability",
    priority: 4,
    icon: Radar,
    description: "Inconsistent behavior / outages: credibility erosion channel.",
  },
  {
    key: "overload",
    label: "Cognitive overload",
    priority: 5,
    icon: Brain,
    description: "System logic confusion: fixable but dangerous if ignored.",
  },
  {
    key: "veteran",
    label: "Veteran & habit",
    priority: 6,
    icon: Clock,
    description: "High-LTV users signalling dependency / routine.",
  },
  {
    key: "suggestion",
    label: "Suggestion-stage",
    priority: 7,
    icon: Lightbulb,
    description: "Constructive drift: early warning when repeated.",
  },
];

// --- Persona colors (consistent across charts & UI)
const PERSONA_COLORS = {
  trust_erosion: "#ef4444", // red-500
  emotional: "#f97316", // orange-500
  escalation: "#eab308", // yellow-500
  reliability: "#3b82f6", // blue-500
  overload: "#8b5cf6", // violet-500
  veteran: "#10b981", // emerald-500
  suggestion: "#06b6d4", // cyan-500
};

const personaColor = (key) => PERSONA_COLORS[key] || "#64748b"; // slate-500 fallback

// --- Keyword dictionaries (Dutch-focused, editable inline)
const DEFAULT_KEYWORDS = {
  trust_erosion: [
    "vertrouwen",
    "betrouwbaar",
    "onbetrouwbaar",
    "ik reken hierop",
    "ik durf niet",
    "kan hier niet op vertrouwen",
    "onzeker",
    "voelt niet veilig",
    "niet veilig",
  ],
  veteran: [
    "al jaren",
    "dagelijks",
    "elke rit",
    "altijd gebruikt",
    "sinds het begin",
    "onderdeel van mijn routine",
    "ik ben afhankelijk",
    "afhankelijk",
    "routine",
  ],
  reliability: [
    "onvoorspelbaar",
    "inconsistent",
    "werkt soms",
    "soms wel",
    "soms niet",
    "wisselend",
    "niet consequent",
    "foutmeldingen",
    "valt uit",
    "crash",
    "loopt vast",
  ],
  escalation: [
    "weer",
    "opnieuw",
    "al vaker gemeld",
    "niet de eerste keer",
    "al meerdere keren",
    "nog steeds",
    "al eens",
    "al gemeld",
  ],
  overload: [
    "ik snap niet waarom",
    "onduidelijk",
    "logica ontbreekt",
    "waarom doet hij dit",
    "niet uit te leggen",
    "tegenstrijdig",
    "klopt niet",
  ],
  emotional: [
    "frustrerend",
    "klaar mee",
    "irritant",
    "teleurgesteld",
    "dit werkt zo niet",
    "zo wordt het lastig",
    "word ik gek van",
  ],
  suggestion: [
    "zou handig zijn",
    "misschien kunnen jullie",
    "ik mis",
    "ik vraag me af waarom",
    "zou fijn zijn",
    "kunnen jullie",
    "idee:",
  ],
};

// --- Helpers
const norm = (s) => (s || "").toString().toLowerCase();

function pickSuggestionText(obj) {
    // Exact column (Typeform export may truncate header in different ways, so we also fallback)
    const exact =
      obj["Beschrijf je suggestie hieronder zo duidelijk mogelijk. Heb j... voordeel kan zijn voor je medegebruikers? Laat dit dan weten."];
    if (exact && String(exact).trim() !== "") return exact;
  
    // Heuristic: find a column that contains 'beschrijf' or 'suggestie'
    for (const k of Object.keys(obj || {})) {
      const lk = k.toLowerCase();
      if (lk.includes("beschrijf") || lk.includes("suggestie")) {
        const v = obj[k];
        if (v && String(v).trim() !== "") return v;
      }
    }
  
    // Fallback: 2nd column is often the open text field
    const keys = Object.keys(obj || {});
    if (keys.length >= 2) return obj[keys[1]];
  
    return obj.text || obj.message || obj.body || "";
  }

function detectDelimiter(firstLine) {
    const line = (firstLine || "").replace(/^\uFEFF/, "");
    const commas = (line.match(/,/g) || []).length;
    const semis = (line.match(/;/g) || []).length;
    const tabs = (line.match(/\t/g) || []).length;
    if (semis > commas && semis >= tabs) return ";";
    if (tabs > commas && tabs > semis) return "\t";
    return ",";
  }
  
  function parseCSV(text) {
    const raw = (text || "").toString().replace(/^\uFEFF/, "");
    const firstLine = raw.split(/\r?\n/)[0] || "";
    const DELIM = detectDelimiter(firstLine);
  
    const rows = [];
    let i = 0;
    let field = "";
    let row = [];
    let inQuotes = false;
  
    const pushField = () => {
      row.push(field);
      field = "";
    };
    const pushRow = () => {
      rows.push(row);
      row = [];
    };
  
    while (i < raw.length) {
      const c = raw[i];
  
      if (inQuotes) {
        if (c === '"') {
          if (raw[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }
  
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
  
      if (c === DELIM) {
        pushField();
        i++;
        continue;
      }
  
      if (c === "\n") {
        pushField();
        pushRow();
        i++;
        continue;
      }
  
      if (c === "\r") {
        i++;
        continue;
      }
  
      field += c;
      i++;
    }
  
    pushField();
    if (row.length > 1 || row[0] !== "") pushRow();
  
    const header = (rows[0] || []).map((h) => (h || "").trim());
    if (!header.length || header.every((h) => !h)) return [];
  
    const out = [];
    for (let r = 1; r < rows.length; r++) {
      const obj = {};
      for (let c = 0; c < header.length; c++) obj[header[c]] = rows[r][c];
      const nonEmpty = Object.values(obj).some((v) => (v || "").toString().trim() !== "");
      if (nonEmpty) out.push(obj);
    }
    return out;
  }

function monthFromDateString(s) {
  // Accepts YYYY-MM, YYYY-MM-DD, ISO, etc.
  const t = (s || "").trim();
  if (!t) return "";
  if (/^\d{4}-\d{2}$/.test(t)) return t;
  const m = t.match(/(\d{4})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}`;
  const d = new Date(t);
  if (Number.isNaN(d.getTime())) return "";
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${yyyy}-${mm}`;
}

function nextMonth(yyyyMm) {
  const [y, m] = (yyyyMm || "").split("-").map((x) => parseInt(x, 10));
  if (!y || !m) return "";
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

function classifyDominantPersona(text, keywords) {
  const t = norm(text);
  const flags = {};
  for (const p of PERSONAS) {
    const list = keywords[p.key] || [];
    flags[p.key] = list.some((kw) => t.includes(norm(kw)));
  }

  // If nothing matched, return null.
  const any = Object.values(flags).some(Boolean);
  if (!any) return { persona: null, flags };

  // Dominant by priority.
  const sorted = [...PERSONAS].sort((a, b) => a.priority - b.priority);
  for (const p of sorted) {
    if (flags[p.key]) return { persona: p.key, flags };
  }
  return { persona: null, flags };
}

function downloadCSV(filename, rows) {
  const headers = Object.keys(rows[0] || {});
  const esc = (v) => {
    const s = (v ?? "").toString();
    if (/[",\n\r]/.test(s)) return '"' + s.replaceAll('"', '""') + '"';
    return s;
  };
  const lines = [headers.join(",")];
  for (const r of rows) {
    lines.push(headers.map((h) => esc(r[h])).join(","));
  }
  const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

const SAMPLE = `user_id,month,text
u1,2025-09,"Ik reken hierop, maar dit voelt niet veilig."
u2,2025-09,"Werkt soms wel soms niet, al vaker gemeld."
u3,2025-09,"Zou handig zijn als jullie dit toevoegen."
u1,2025-10,"Nog steeds onbetrouwbaar. Klaar mee."
u2,2025-10,"Opnieuw foutmeldingen."
u3,2025-10,"Ik mis een optie, onduidelijk waarom het zo werkt."
`;

function Pill({ tone = "neutral", children }) {
  const cls =
    tone === "danger"
      ? "bg-red-100 text-red-900 border-red-200"
      : tone === "warn"
        ? "bg-amber-100 text-amber-900 border-amber-200"
        : tone === "good"
          ? "bg-emerald-100 text-emerald-900 border-emerald-200"
          : "bg-slate-100 text-slate-900 border-slate-200";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs ${cls}`}>
      {children}
    </span>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="text-sm text-slate-600">{label}</div>
      <div className="text-sm font-medium">{value}</div>
    </div>
  );
}

function TooltipBox({ active, payload, label, valueFormatter }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-white p-3 shadow-sm">
      <div className="text-sm font-semibold">{label}</div>
      <div className="mt-1 space-y-1">
        {payload.map((p) => (
          <div key={p.dataKey} className="flex items-center justify-between gap-6 text-sm">
            <span className="text-slate-600">{p.name}</span>
            <span className="font-medium">{valueFormatter ? valueFormatter(p.value) : p.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function PersonaRetentionDashboard() {
    const [csvText, setCsvText] = useState(SAMPLE);
    const [csvError, setCsvError] = useState("");
    const [csvInfo, setCsvInfo] = useState("");
    const fileInputRef = useRef(null);
    const [keywords, setKeywords] = useState(DEFAULT_KEYWORDS);
  const [query, setQuery] = useState("");
  const [selectedPersona, setSelectedPersona] = useState("all");
  const [view, setView] = useState("retention");
  const [dominanceMode, setDominanceMode] = useState("dominant"); // dominant | multi
  const [minUsers, setMinUsers] = useState(5);
  const [selectedMonthForDetails, setSelectedMonthForDetails] = useState("");
  const [feedbackFullscreen, setFeedbackFullscreen] = useState(false);
  const [minEntryChars, setMinEntryChars] = useState(0);

  // Parse CSV
  const rawRows = useMemo(() => {
    try {
      return parseCSV(csvText);
    } catch {
      return [];
    }
  }, [csvText]);

  // Normalize rows to user-month records
  const userMonthRows = useMemo(() => {
    if (!rawRows.length) return [];

    // Detect schema
    const cols = Object.keys(rawRows[0]);
    const hasMonth = cols.includes("month");
    const hasCreatedAt = cols.includes("created_at");

    const rows = rawRows
      .map((r) => {
        const user_id = String(r.user_id || r.userid || r.user || r["Network ID"] || r.network_id || "").trim();
const text = String(pickSuggestionText(r) || "");
const month = hasMonth
  ? monthFromDateString(r.month)
  : monthFromDateString(r.created_at || r["Start Date (UTC)"]);
        const active_next_month = (r.active_next_month ?? "").toString().trim();
        if (!user_id || !month) return null;
        return { user_id, month, text, active_next_month };
      })
      .filter(Boolean);

    // Aggregate per user-month (concat texts)
    const map = new Map();
    for (const r of rows) {
      const key = `${r.user_id}__${r.month}`;
      if (!map.has(key)) map.set(key, { user_id: r.user_id, month: r.month, text: "", active_next_month: r.active_next_month });
      const cur = map.get(key);
      cur.text = (cur.text ? cur.text + "\n" : "") + r.text;
      // prefer explicit active_next_month if present
      if (r.active_next_month !== "") cur.active_next_month = r.active_next_month;
    }

    return Array.from(map.values()).sort((a, b) => (a.month === b.month ? a.user_id.localeCompare(b.user_id) : a.month.localeCompare(b.month)));
  }, [rawRows]);

  // Build presence index to derive next-month activity if active_next_month not provided
  const presence = useMemo(() => {
    const map = new Map();
    for (const r of userMonthRows) {
      const key = `${r.user_id}__${r.month}`;
      map.set(key, true);
    }
    return map;
  }, [userMonthRows]);

  // Classify personas & compute metrics
  const computed = useMemo(() => {
    const classified = userMonthRows.map((r) => {
      const { persona, flags } = classifyDominantPersona(r.text, keywords);

      // Determine active next month
      let activeNext = null;
      if (r.active_next_month !== "") {
        activeNext = ["1", "true", "yes", "y"].includes(norm(r.active_next_month));
      } else {
        const nm = nextMonth(r.month);
        activeNext = presence.has(`${r.user_id}__${nm}`);
      }

      return {
        ...r,
        dominant_persona: persona,
        flags,
        active_next_month: activeNext,
      };
    });

    // Build month list
    const months = Array.from(new Set(classified.map((r) => r.month))).sort();

    // Per month × persona aggregates
    const keyFor = (month, persona) => `${month}__${persona}`;
    const agg = new Map();

    function ensure(month, persona) {
      const k = keyFor(month, persona);
      if (!agg.has(k)) {
        agg.set(k, {
          month,
          persona,
          users: new Set(),
          retainedUsers: new Set(),
          churnedUsers: new Set(),
        });
      }
      return agg.get(k);
    }

    for (const r of classified) {
      // Determine which personas to count this record for
      let personasToCount = [];
      if (dominanceMode === "dominant") {
        if (r.dominant_persona) personasToCount = [r.dominant_persona];
      } else {
        // multi: count all persona flags as true
        personasToCount = PERSONAS.map((p) => p.key).filter((k) => r.flags?.[k]);
      }

      for (const p of personasToCount) {
        const a = ensure(r.month, p);
        a.users.add(r.user_id);
        if (r.active_next_month) a.retainedUsers.add(r.user_id);
        else a.churnedUsers.add(r.user_id);
      }
    }

    const rows = Array.from(agg.values()).map((a) => {
      const users = a.users.size;
      const retained = a.retainedUsers.size;
      const churned = a.churnedUsers.size;
      const retention = users ? retained / users : 0;
      return {
        month: a.month,
        persona: a.persona,
        users,
        retained,
        churned,
        retention,
      };
    });

    // MoM delta for retention and user count
    const byPersona = new Map();
    for (const r of rows) {
      if (!byPersona.has(r.persona)) byPersona.set(r.persona, []);
      byPersona.get(r.persona).push(r);
    }
    for (const [persona, arr] of byPersona.entries()) {
      arr.sort((a, b) => a.month.localeCompare(b.month));
      for (let i = 0; i < arr.length; i++) {
        const prev = arr[i - 1];
        arr[i].retention_mom = prev ? arr[i].retention - prev.retention : null;
        arr[i].users_mom = prev ? arr[i].users - prev.users : null;
      }
    }

    const outRows = Array.from(byPersona.values()).flat();

    // Build chart-friendly series
    const personaLabel = (k) => PERSONAS.find((p) => p.key === k)?.label || k;
    const retentionSeries = months.map((m) => {
      const obj = { month: m };
      for (const p of PERSONAS) {
        const r = outRows.find((x) => x.month === m && x.persona === p.key);
        obj[personaLabel(p.key)] = r ? Math.round(r.retention * 1000) / 10 : 0;
      }
      return obj;
    });

    const volumeSeries = months.map((m) => {
      const obj = { month: m };
      for (const p of PERSONAS) {
        const r = outRows.find((x) => x.month === m && x.persona === p.key);
        obj[personaLabel(p.key)] = r ? r.users : 0;
      }
      return obj;
    });

    return { classified, outRows, months, retentionSeries, volumeSeries };
  }, [userMonthRows, keywords, presence, dominanceMode]);

  const personaLabel = (k) => PERSONAS.find((p) => p.key === k)?.label || k;
  const personaMeta = (k) => PERSONAS.find((p) => p.key === k);

  const filteredRows = useMemo(() => {
    const q = norm(query);
    return computed.outRows
      .filter((r) => (selectedPersona === "all" ? true : r.persona === selectedPersona))
      .filter((r) => (r.users >= minUsers ? true : false))
      .filter((r) => {
        if (!q) return true;
        return (
          r.month.includes(q) ||
          personaLabel(r.persona).toLowerCase().includes(q)
        );
      })
      .sort((a, b) => (a.month === b.month ? a.persona.localeCompare(b.persona) : b.month.localeCompare(a.month)));
  }, [computed.outRows, query, selectedPersona, minUsers]);

  // Key KPIs: trust+veteran spotlight
  const spotlight = useMemo(() => {
    const lastMonth = computed.months[computed.months.length - 1];
    const prevMonth = computed.months[computed.months.length - 2];
    const pick = (month, persona) => computed.outRows.find((r) => r.month === month && r.persona === persona);

    const trustNow = pick(lastMonth, "trust_erosion");
    const trustPrev = pick(prevMonth, "trust_erosion");
    const vetNow = pick(lastMonth, "veteran");
    const vetPrev = pick(prevMonth, "veteran");

    function safePct(x) {
      if (!x) return "—";
      return `${Math.round(x.retention * 1000) / 10}%`;
    }
    function safeDelta(now, prev) {
      if (!now || !prev) return "—";
      const d = now.retention - prev.retention;
      const sign = d > 0 ? "+" : d < 0 ? "" : "";
      return `${sign}${Math.round(d * 1000) / 10}pp`;
    }
    function safeUsersDelta(now, prev) {
      if (!now || !prev) return "—";
      const d = now.users - prev.users;
      const sign = d > 0 ? "+" : d < 0 ? "" : "";
      return `${sign}${d}`;
    }

    return {
      lastMonth,
      trust: {
        users: trustNow?.users ?? 0,
        retention: safePct(trustNow),
        retentionDelta: safeDelta(trustNow, trustPrev),
        usersDelta: safeUsersDelta(trustNow, trustPrev),
      },
      veteran: {
        users: vetNow?.users ?? 0,
        retention: safePct(vetNow),
        retentionDelta: safeDelta(vetNow, vetPrev),
        usersDelta: safeUsersDelta(vetNow, vetPrev),
      },
    };
  }, [computed.months, computed.outRows]);

  const riskNotes = useMemo(() => {
    const lastMonth = computed.months[computed.months.length - 1];
    if (!lastMonth) return [];

    const get = (persona) => computed.outRows.find((r) => r.month === lastMonth && r.persona === persona);
    const trust = get("trust_erosion");
    const emotional = get("emotional");
    const escalation = get("escalation");
    const suggestion = get("suggestion");

    const notes = [];
    if (trust && trust.users >= minUsers && trust.retention_mom !== null && trust.retention_mom < 0 && trust.users_mom !== null && trust.users_mom > 0) {
      notes.push({
        tone: "danger",
        title: "Trust erosion expanding + retention falling",
        text: "Brand-level credibility issue. Treat as retention incident, not feature request.",
      });
    }
    if (suggestion && emotional && suggestion.users_mom !== null && suggestion.users_mom < 0 && emotional.users_mom !== null && emotional.users_mom > 0) {
      notes.push({
        tone: "warn",
        title: "Constructive feedback drying up",
        text: "Suggestion-stage shrinking while breaking-point grows: users stop helping before they leave.",
      });
    }
    if (escalation && escalation.users_mom !== null && escalation.users_mom > 0) {
      notes.push({
        tone: "warn",
        title: "Escalation rising",
        text: "More users repeating themselves — power complainer risk. Prioritize closure loops.",
      });
    }
    if (!notes.length) {
      notes.push({
        tone: "good",
        title: "No acute persona alarm",
        text: "Keep watching Trust erosion + Veteran. Validate with absolute counts and confidence.",
      });
    }
    return notes;
  }, [computed.months, computed.outRows, minUsers]);

 
  function handleUpload(file, inputEl) {
    if (!file) return;
  
    setCsvError("");
    setCsvInfo(`${file.name} • ${Math.round(file.size / 1024)} KB`);
  
    const reader = new FileReader();
    reader.onload = () => {
      const txt = reader.result?.toString() || "";
      setCsvText(txt);
  
      try {
        const parsed = parseCSV(txt);
        if (!parsed.length) {
          setCsvError("Parsed 0 rows. Check delimiter (comma/semicolon) or whether the file has a header row.");
        }
      } catch (e) {
        setCsvError(`CSV parse error: ${e?.message || String(e)}`);
      }
  
      if (inputEl) inputEl.value = ""; // re-upload same file works
    };
    reader.onerror = () => {
      setCsvError("Could not read the file.");
      if (inputEl) inputEl.value = "";
    };
  
    reader.readAsText(file);
  }

  const personaOptions = [{ key: "all", label: "All personas" }, ...PERSONAS.map((p) => ({ key: p.key, label: p.label }))];

  const chartData = view === "retention" ? computed.retentionSeries : computed.volumeSeries;

  const seriesDefs = PERSONAS
  .filter((p) => selectedPersona === "all" || p.key === selectedPersona)
  .map((p) => ({
    key: p.key,
    label: personaLabel(p.key),
    color: personaColor(p.key),
  }));

  const fmtPct = (v) => `${v}%`;

  const handleChartClick = (chartState) => {
    const m = chartState?.activeLabel;
    if (m) setSelectedMonthForDetails(m);
  };
  
  const monthDetailMonth =
    selectedMonthForDetails || computed.months[computed.months.length - 1] || "";
  
  const monthDetails = useMemo(() => {
    if (!monthDetailMonth) return [];
    const byPriority = (personaKey) =>
      PERSONAS.find((p) => p.key === personaKey)?.priority ?? 999;

    return (computed.classified || [])
      .filter((r) => r.month === monthDetailMonth)
      .map((r) => ({
        user_id: r.user_id,
        persona: r.dominant_persona,
        text: r.text,
      }))
      .filter((r) => (r.text || "").length >= minEntryChars)
      .sort((a, b) => {
        const pa = byPriority(a.persona);
        const pb = byPriority(b.persona);
        if (pa !== pb) return pa - pb;
        return (a.user_id || "").localeCompare(b.user_id || "");
      });
  }, [computed.classified, monthDetailMonth, minEntryChars]);

  // Fullscreen feedback table: close on Escape
  useEffect(() => {
    if (!feedbackFullscreen) return;
    const onKeyDown = (e) => {
      if (e.key === "Escape") setFeedbackFullscreen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [feedbackFullscreen]);

  return (
    <div className="min-h-screen w-full bg-slate-50 p-4 md:p-8">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35 }}
        className="w-full max-w-none space-y-6"
      >
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <div className="text-2xl font-semibold tracking-tight">Persona Retention Dashboard</div>
              <Badge variant="secondary" className="rounded-full">Monthly</Badge>
            </div>
            <div className="mt-1 text-sm text-slate-600">
              Keyword-based persona detection → dominant persona per user-month → next-month retention.
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="mr-2 h-4 w-4" /> Upload CSV
            </Button>
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => handleUpload(e.target.files?.[0], e.target)}
            />
            <Button
              variant="outline"
              className="rounded-xl"
              onClick={() => downloadCSV("persona_retention_export.csv", filteredRows.map((r) => ({
                month: r.month,
                persona: personaLabel(r.persona),
                users: r.users,
                retained: r.retained,
                churned: r.churned,
                retention_pct: Math.round(r.retention * 1000) / 10,
                retention_mom_pp: r.retention_mom === null ? "" : Math.round(r.retention_mom * 1000) / 10,
                users_mom: r.users_mom === null ? "" : r.users_mom,
              })))}
            >
              <Download className="mr-2 h-4 w-4" /> Export table
            </Button>
          </div>
          {(csvInfo || csvError) && (
  <div className="mt-3 w-full rounded-2xl border bg-white p-3 text-sm">
    {csvInfo && <div className="font-medium text-slate-800">Loaded: {csvInfo}</div>}
    {csvError && <div className="mt-1 text-red-600">{csvError}</div>}
  </div>
)}
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div className="flex flex-col gap-4 md:col-span-2">
            <Card className="rounded-2xl shadow-sm">
            <CardHeader className="gap-2 pb-2">
              <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                <div>
                  <CardTitle className="text-base">Trends</CardTitle>
                  <CardDescription>{view === "retention" ? "Retention % per persona" : "Persona size (users) per month"}</CardDescription>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Select value={view} onValueChange={setView}>
                    <SelectTrigger className="w-[200px] rounded-xl bg-white">
                      <SelectValue placeholder="View" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="retention">Retention %</SelectItem>
                      <SelectItem value="volume">Persona size</SelectItem>
                    </SelectContent>
                  </Select>
                  <Select value={dominanceMode} onValueChange={setDominanceMode}>
                    <SelectTrigger className="w-[200px] rounded-xl bg-white">
                      <SelectValue placeholder="Mode" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="dominant">Dominant persona</SelectItem>
                      <SelectItem value="multi">Multi-label (all flags)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex h-[420px] flex-col p-0">
              <div className="flex-1">
                <ResponsiveContainer width="100%" height="100%">
                  {view === "retention" ? (
                    <LineChart
                      data={chartData}
                      margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                      onClick={handleChartClick}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis tickFormatter={(v) => (view === "retention" ? `${v}%` : v)} />
                      <Tooltip
                        content={
                          <TooltipBox
                            valueFormatter={(v) => (view === "retention" ? fmtPct(v) : v)}
                          />
                        }
                      />
                      <Legend />
                      {seriesDefs.map((s) => (
                        <Line
                          key={s.key}
                          name={s.label}
                          type="monotone"
                          dataKey={s.label}
                          dot={false}
                          strokeWidth={2}
                          stroke={s.color}
                        />
                      ))}
                    </LineChart>
                  ) : (
                    <BarChart
                      data={chartData}
                      margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
                      onClick={handleChartClick}
                    >
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="month" />
                      <YAxis />
                      <Tooltip content={<TooltipBox />} />
                      <Legend />
                      {seriesDefs.map((s) => (
                        <Bar key={s.key} name={s.label} dataKey={s.label} fill={s.color} />
                      ))}
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
            <Card className="rounded-2xl shadow-sm">
              <CardHeader className="gap-2">
                <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
                  <div>
                    <CardTitle className="text-base">User feedback</CardTitle>
                    <CardDescription>
                      Feedback entries for <span className="font-medium">{monthDetailMonth || "—"}</span> (click a month in the chart to change)
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-xs text-slate-600">
                      {monthDetails.length} entries
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="text-xs text-slate-600">Min chars</div>
                      <Input
                        value={minEntryChars}
                        onChange={(e) =>
                          setMinEntryChars(
                            Math.max(0, parseInt(e.target.value || "0", 10))
                          )
                        }
                        className="h-8 w-24 rounded-xl bg-white"
                        type="number"
                        min={0}
                      />
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 rounded-xl"
                      onClick={() => setFeedbackFullscreen(true)}
                      disabled={!monthDetails.length}
                    >
                      <Maximize2 className="mr-2 h-4 w-4" />
                      Full screen
                    </Button>
                  </div>
                </div>
              </CardHeader>

              <CardContent className="p-0">
                <div className="overflow-hidden rounded-b-2xl border-t bg-white">
                  <div className="max-h-[520px] overflow-y-auto">
                    <Table>
                      <TableHeader className="sticky top-0 bg-white">
                        <TableRow>
                          <TableHead>User</TableHead>
                          <TableHead>Persona</TableHead>
                          <TableHead>Feedback</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {monthDetails.map((r, idx) => (
                          <TableRow key={`${r.user_id}_${idx}`}>
                            <TableCell className="whitespace-nowrap font-medium">
                              {r.user_id}
                            </TableCell>
                            <TableCell className="whitespace-nowrap">
                              {r.persona ? (
                                <div className="flex items-center gap-2">
                                  <span
                                    className="h-2.5 w-2.5 rounded-full"
                                    style={{ backgroundColor: personaColor(r.persona) }}
                                  />
                                  <span>{personaLabel(r.persona)}</span>
                                </div>
                              ) : (
                                "—"
                              )}
                            </TableCell>
                            <TableCell className="whitespace-pre-wrap text-sm leading-6 text-slate-700">
                              {r.text}
                            </TableCell>
                          </TableRow>
                        ))}
                        {!monthDetails.length && (
                          <TableRow>
                            <TableCell colSpan={3} className="py-10 text-center text-sm text-slate-600">
                              No entries for this month (or they are below the Min chars filter). Click a month in the chart or lower the filter.
                            </TableCell>
                          </TableRow>
                        )}
                      </TableBody>
                    </Table>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Keywords</CardTitle>
              <CardDescription>Edit keyword lists (comma-separated)</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {PERSONAS.map((p) => {
                const Icon = p.icon;
                return (
                  <div key={p.key} className="rounded-2xl border bg-white p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Icon className="h-4 w-4" />
                          <div className="text-sm font-semibold">{p.label}</div>
                          <Badge variant="secondary" className="rounded-full">P{p.priority}</Badge>
                        </div>
                        <div className="mt-1 text-xs text-slate-600">{p.description}</div>
                      </div>
                    </div>
                    <Input
                      className="mt-2 rounded-xl bg-slate-50"
                      value={(keywords[p.key] || []).join(", ")}
                      onChange={(e) => {
                        const parts = e.target.value
                          .split(",")
                          .map((x) => x.trim())
                          .filter(Boolean);
                        setKeywords((prev) => ({ ...prev, [p.key]: parts }));
                      }}
                    />
                  </div>
                );
              })}

              <div className="rounded-2xl border bg-slate-50 p-3 text-sm text-slate-700">
                <div className="text-sm font-semibold">Tip</div>
                <div className="mt-1 text-sm text-slate-600">
                  Keep short phrases. The matcher is case-insensitive and uses simple “contains”.
                </div>
              </div>
            </CardContent>
          </Card>
        </div>



        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Spotlight: Trust erosion</CardTitle>
              <CardDescription>Latest month ({spotlight.lastMonth || "—"})</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <InfoRow label="Users" value={spotlight.trust.users} />
              <InfoRow label="Retention" value={spotlight.trust.retention} />
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-slate-600">MoM Δ</div>
                <div className="flex items-center gap-2">
                  <Pill tone={spotlight.trust.retentionDelta.startsWith("+") ? "good" : spotlight.trust.retentionDelta.startsWith("-") ? "danger" : "neutral"}>
                    {spotlight.trust.retentionDelta}
                  </Pill>
                  <Pill tone={spotlight.trust.usersDelta.startsWith("+") ? "warn" : "neutral"}>
                    users {spotlight.trust.usersDelta}
                  </Pill>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Spotlight: Veteran & habit</CardTitle>
              <CardDescription>High-LTV segment watch</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <InfoRow label="Users" value={spotlight.veteran.users} />
              <InfoRow label="Retention" value={spotlight.veteran.retention} />
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-slate-600">MoM Δ</div>
                <div className="flex items-center gap-2">
                  <Pill tone={spotlight.veteran.retentionDelta.startsWith("+") ? "good" : spotlight.veteran.retentionDelta.startsWith("-") ? "danger" : "neutral"}>
                    {spotlight.veteran.retentionDelta}
                  </Pill>
                  <Pill tone={spotlight.veteran.usersDelta.startsWith("+") ? "warn" : "neutral"}>
                    users {spotlight.veteran.usersDelta}
                  </Pill>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Data health</CardTitle>
              <CardDescription>Quick sanity checks</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <InfoRow label="User-month rows" value={computed.classified.length} />
              <InfoRow label="Months" value={computed.months.length} />
              <InfoRow
                label="Mode"
                value={dominanceMode === "dominant" ? "Dominant persona" : "Multi-label"}
              />
              <div className="mt-2 rounded-xl border bg-slate-50 p-3 text-sm text-slate-700">
                <div className="flex items-start gap-2">
                  <Info className="mt-0.5 h-4 w-4" />
                  <div>
                    If you don’t provide <span className="font-medium">active_next_month</span>, the app derives retention from the presence of the same user in the next month.
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Filters</CardTitle>
              <CardDescription>Slice by persona, search, export</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="flex flex-col gap-2 md:flex-row">
                <Select value={selectedPersona} onValueChange={setSelectedPersona}>
                  <SelectTrigger className="rounded-xl bg-white">
                    <SelectValue placeholder="Persona" />
                  </SelectTrigger>
                  <SelectContent>
                    {personaOptions.map((p) => (
                      <SelectItem key={p.key} value={p.key}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search month or persona…"
                  className="rounded-xl bg-white"
                />
              </div>

              <div className="rounded-2xl border bg-slate-50 p-3 text-sm text-slate-700">
                <div className="font-semibold">CSV formats supported</div>
                <div className="mt-1 text-sm text-slate-600">
                  Recommended: <span className="font-medium">user_id, month, text</span> (+ optional <span className="font-medium">active_next_month</span>).
                  <br />
                  Raw: <span className="font-medium">user_id, created_at, text</span>.
                </div>
                <div className="mt-2 flex flex-wrap gap-2">
                  <Button variant="outline" className="rounded-xl" onClick={() => setCsvText(SAMPLE)}>
                    Load sample
                  </Button>
                  <Button
                    variant="outline"
                    className="rounded-xl"
                    onClick={() => downloadCSV(
                      "template_user_month.csv",
                      [{ user_id: "u123", month: "2025-11", text: "<concatenated monthly messages>", active_next_month: "1" }]
                    )}
                  >
                    Download template
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl shadow-sm">
            <CardHeader>
              <CardTitle className="text-base">Alerts</CardTitle>
              <CardDescription>Rule-based interpretation for the latest month</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {riskNotes.map((n, idx) => (
                <div key={idx} className={`rounded-2xl border p-3 ${n.tone === "danger" ? "bg-red-50" : n.tone === "warn" ? "bg-amber-50" : "bg-emerald-50"}`}>
                  <div className="text-sm font-semibold">{n.title}</div>
                  <div className="mt-1 text-sm text-slate-700">{n.text}</div>
                </div>
              ))}

              <div className="rounded-2xl border bg-white p-3">
                <div className="text-sm font-semibold">Noise guard</div>
                <div className="mt-2 flex items-center gap-2">
                  <div className="text-sm text-slate-600">Min users</div>
                  <Input
                    value={minUsers}
                    onChange={(e) => setMinUsers(Math.max(0, parseInt(e.target.value || "0", 10)))}
                    className="h-9 w-24 rounded-xl"
                    type="number"
                    min={0}
                  />
                </div>
                <div className="mt-2 text-xs text-slate-600">
                  Alerts and table rows ignore persona-months below this threshold.
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Monthly retention table</CardTitle>
            <CardDescription>
              Dominant persona per user-month. Retention = active again next month.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="overflow-auto rounded-2xl border bg-white">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Persona</TableHead>
                    <TableHead className="text-right">Users</TableHead>
                    <TableHead className="text-right">Retention</TableHead>
                    <TableHead className="text-right">MoM Δ</TableHead>
                    <TableHead className="text-right">Users Δ</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map((r, idx) => {
                    const meta = personaMeta(r.persona);
                    const Icon = meta?.icon || Info;
                    const retentionPct = Math.round(r.retention * 1000) / 10;
                    const mom = r.retention_mom === null ? null : Math.round(r.retention_mom * 1000) / 10;
                    const usersMom = r.users_mom;
                    return (
                      <TableRow key={`${r.month}_${r.persona}_${idx}`}>
                        <TableCell className="font-medium">{r.month}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <span
                              className="h-2.5 w-2.5 rounded-full"
                              style={{ backgroundColor: personaColor(r.persona) }}
                              aria-hidden="true"
                            />
                            <Icon className="h-4 w-4" />
                            <span>{personaLabel(r.persona)}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right">{r.users}</TableCell>
                        <TableCell className="text-right">{retentionPct}%</TableCell>
                        <TableCell className="text-right">
                          {mom === null ? (
                            <span className="text-slate-500">—</span>
                          ) : (
                            <Pill tone={mom < 0 ? "danger" : mom > 0 ? "good" : "neutral"}>
                              {mom > 0 ? "+" : ""}{mom}pp
                            </Pill>
                          )}
                        </TableCell>
                        <TableCell className="text-right">
                          {usersMom === null ? (
                            <span className="text-slate-500">—</span>
                          ) : (
                            <Pill tone={usersMom > 0 ? "warn" : "neutral"}>
                              {usersMom > 0 ? "+" : ""}{usersMom}
                            </Pill>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}

                  {!filteredRows.length && (
                    <TableRow>
                      <TableCell colSpan={6} className="py-10 text-center text-sm text-slate-600">
                        No rows. Try lowering “Min users”, switching to “Multi-label”, or uploading data.
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>

        <Card className="rounded-2xl shadow-sm">
          <CardHeader>
            <CardTitle className="text-base">Raw data (CSV)</CardTitle>
            <CardDescription>Paste CSV here if you don’t want to upload a file.</CardDescription>
          </CardHeader>
          <CardContent>
            <textarea
              className="min-h-[200px] w-full rounded-2xl border bg-white p-3 font-mono text-xs leading-5 outline-none focus:ring-2 focus:ring-slate-200"
              value={csvText}
              onChange={(e) => setCsvText(e.target.value)}
            />
          </CardContent>
        </Card>
        {feedbackFullscreen && (
          <div className="fixed inset-0 z-50">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setFeedbackFullscreen(false)}
            />
            <div className="absolute inset-4 md:inset-10 flex flex-col overflow-hidden rounded-2xl border bg-white shadow-xl">
              <div className="flex items-center justify-between gap-3 border-b p-4">
                <div className="min-w-0">
                  <div className="text-sm font-semibold">
                    User feedback for {monthDetailMonth || "—"}
                  </div>
                  <div className="text-xs text-slate-600">
                    {monthDetails.length} entries • Min chars {minEntryChars} • Press Esc to close
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-xl"
                  onClick={() => setFeedbackFullscreen(false)}
                >
                  <Minimize2 className="mr-2 h-4 w-4" />
                  Close
                </Button>
              </div>

              <div className="flex-1 overflow-auto">
                <Table>
                  <TableHeader className="sticky top-0 bg-white">
                    <TableRow>
                      <TableHead>User</TableHead>
                      <TableHead>Persona</TableHead>
                      <TableHead>Feedback</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {monthDetails.map((r, idx) => (
                      <TableRow key={`fs_${r.user_id}_${idx}`}>
                        <TableCell className="whitespace-nowrap font-medium">
                          {r.user_id}
                        </TableCell>
                        <TableCell className="whitespace-nowrap">
                          {r.persona ? (
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 rounded-full"
                                style={{ backgroundColor: personaColor(r.persona) }}
                                aria-hidden="true"
                              />
                              <span>{personaLabel(r.persona)}</span>
                            </div>
                          ) : (
                            "—"
                          )}
                        </TableCell>
                        <TableCell className="whitespace-pre-wrap text-sm text-slate-700">
                          {r.text}
                        </TableCell>
                      </TableRow>
                    ))}
                    {!monthDetails.length && (
                      <TableRow>
                        <TableCell
                          colSpan={3}
                          className="py-10 text-center text-sm text-slate-600"
                        >
                          No entries for this month (or they are below the Min chars filter). Click a month in the chart or lower the filter.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        )}
      </motion.div>
    </div>
  );
}
