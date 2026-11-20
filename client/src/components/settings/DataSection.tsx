"use client";

// Settings › Data (design handoff v2): download everything as JSON, export entries as CSV or
// JSON, and import a CSV in the export's format after a preview.

import { useRef, useState } from "react";
import { Download, Upload } from "lucide-react";
import { createClient } from "@/utils/supabase/client";
import { checkImport } from "@/lib/csvImport.mjs";
import { inr } from "@/lib/money.mjs";
import { exportAllCsv, exportAllJson, exportMyData, fetchAllTransactions, importEntries } from "@/lib/settings.mjs";
import { errorFields, reportClientError } from "@/lib/log.mjs";
import Dialog from "../ui/Dialog";
import { useToast } from "../ui/Toast";
import type { Category } from "../dashboard/types";
import { BTN_LINE, Card, Row, SectionHead, download } from "./parts";

const FAILED = "Couldn’t reach SaveFirst. Check your connection and try again.";
type Preview = ReturnType<typeof checkImport> & { file: string };

/** "Download all my data" as one JSON file; shared with the Delete account card. */
export async function downloadAllData(): Promise<boolean> {
  const { json, error } = await exportMyData(createClient());
  if (error) return false;
  download("savefirst-my-data.json", json, "application/json");
  return true;
}

export default function DataSection({ categories, onImported }: { categories: Category[]; onImported: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [exported, setExported] = useState<number | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);

  const all = async () => {
    setBusy("all");
    const ok = await downloadAllData();
    setBusy(null);
    if (!ok) {
      reportClientError("download_all_data_failed");
      toast(FAILED, { error: true });
    }
  };
  const entries = async (kind: "csv" | "json") => {
    setBusy(kind);
    const db = createClient();
    const r = kind === "csv" ? await exportAllCsv(db) : await exportAllJson(db);
    setBusy(null);
    if (r.error) {
      reportClientError("export_entries_failed", { kind, ...errorFields(r.error) });
      return toast(FAILED, { error: true });
    }
    download(
      `savefirst-entries.${kind}`,
      "csv" in r ? r.csv : r.json,
      kind === "csv" ? "text/csv" : "application/json",
    );
    setExported(r.count);
  };

  const pick = async (f: File | undefined) => {
    if (!f) return;
    if (f.size > 2 * 1024 * 1024)
      return toast("That file is over 2 MB. Split it and import the parts.", { error: true });
    setBusy("check");
    const [text, existing] = await Promise.all([f.text(), fetchAllTransactions(createClient())]);
    setBusy(null);
    if (existing.error) return toast(FAILED, { error: true });
    setImportError(null);
    setPreview({ ...checkImport(text, { categories, existing: existing.data }), file: f.name });
  };
  const runImport = async () => {
    if (!preview?.rows.length) return setPreview(null);
    if (!navigator.onLine) return setImportError(FAILED);
    setBusy("import");
    const { added, duplicates, error } = await importEntries(createClient(), preview.rows);
    setBusy(null);
    if (error) {
      reportClientError("import_entries_failed", { ...errorFields(error), rowsCount: preview.rows.length });
      return setImportError(`Nothing was imported. ${error.message ?? FAILED}`);
    }
    setPreview(null);
    onImported();
    toast(
      `Imported ${added} ${added === 1 ? "entry" : "entries"}${duplicates ? ` · ${duplicates} already saved` : ""}`,
    );
  };

  const total = preview?.rows.reduce((s, r) => s + (r.type === "expense" ? r.amount : 0), 0) ?? 0;
  return (
    <>
      <SectionHead title="Data" lede="Take your data with you, or bring entries in." />
      <Card>
        <Row
          label="Download all my data"
          help="Profile, plan, plan history, categories, recurring items, goals, every entry and your settings, in one JSON file."
        >
          <button
            type="button"
            onClick={all}
            disabled={!!busy}
            className="flex h-[38px] cursor-pointer items-center gap-2 rounded-full border-0 bg-ink px-4 text-[13px] font-bold text-bg disabled:opacity-60"
          >
            <Download size={14} />
            {busy === "all" ? "Preparing…" : "Download"}
          </button>
        </Row>
        <Row
          label="Export entries"
          help={
            exported === null
              ? "Every entry since you joined, as a file you can open in a spreadsheet."
              : `Exported just now · ${exported} ${exported === 1 ? "entry" : "entries"}`
          }
        >
          <div className="flex gap-2">
            <button type="button" onClick={() => entries("csv")} disabled={!!busy} className={BTN_LINE}>
              {busy === "csv" ? "Exporting…" : "CSV"}
            </button>
            <button type="button" onClick={() => entries("json")} disabled={!!busy} className={BTN_LINE}>
              {busy === "json" ? "Exporting…" : "JSON"}
            </button>
          </div>
        </Row>
        <Row
          label="Import"
          help="A CSV with date, amount, category and note columns, like the export. You’ll see a preview before anything is added."
        >
          <button type="button" onClick={() => file.current?.click()} disabled={!!busy} className={`${BTN_LINE} gap-2`}>
            <Upload size={14} />
            {busy === "check" ? "Checking…" : "Import CSV"}
          </button>
          <input
            ref={file}
            type="file"
            accept=".csv,text/csv"
            aria-label="CSV file to import"
            className="hidden"
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </Row>
      </Card>

      {preview && (
        <Dialog
          open
          onClose={() => setPreview(null)}
          eyebrow={preview.file}
          title="Import entries"
          size="lg"
          error={preview.error ?? importError}
          onSubmit={runImport}
          busy={busy === "import"}
          hint="All entries go in together, or none do"
          submitLabel={
            busy === "import"
              ? "Importing…"
              : preview.rows.length
                ? `Import ${preview.rows.length} ${preview.rows.length === 1 ? "entry" : "entries"}`
                : "Close"
          }
        >
          {!preview.error && (
            <div role="status" className="flex flex-col gap-1 rounded-2xl bg-tile-2 px-5 py-[18px]">
              <span className="eyebrow">Ready to import</span>
              <span className="tabular font-serif text-[44px] leading-none">{preview.rows.length}</span>
              <span className="text-[13px] text-muted">
                {inr(total)} of spending
                {preview.duplicates ? ` · ${preview.duplicates} already saved, skipped` : ""}
                {preview.skipped.length ? ` · ${preview.skipped.length} can’t be imported` : ""}
              </span>
            </div>
          )}
          {preview.skipped.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="eyebrow">Skipped</span>
              <ul className="m-0 flex max-h-[240px] list-none flex-col overflow-y-auto p-0">
                {preview.skipped.map((s) => (
                  <li key={s.line} className="flex gap-3 border-b border-line py-2 text-sm">
                    <span className="tabular w-16 flex-none text-muted">Row {s.line}</span>
                    <span>{s.reason}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Dialog>
      )}
    </>
  );
}
