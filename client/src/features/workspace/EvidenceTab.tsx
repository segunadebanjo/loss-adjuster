import { useRef, useState, type DragEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, Eye, EyeOff, FileSpreadsheet, FileText, Film, ImageIcon, Pencil, Trash2, UploadCloud, X } from "lucide-react";
import clsx from "clsx";
import { errorMessage, fieldErrors } from "@/shared/api/client";
import type { ClaimDetail, EvidenceFile } from "@/shared/api/types";
import { workspaceApi, workspaceKeys } from "@/shared/api/workspace";
import { formatDateTime } from "@/shared/lib/claims";
import { Button, Card, EmptyState, ErrorNote, Field, Input, Modal, Select, Spinner, Textarea } from "@/shared/components/ui";

const MB = 1024 * 1024;
const ACCEPT = ".jpg,.jpeg,.png,.webp,.heic,.mp4,.mov,.webm,.3gp,.pdf,.docx,.xlsx,image/*,video/*";

function sizeLabel(bytes: number) {
  return bytes >= MB ? `${(bytes / MB).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** Quick checks before sending; the server decides from the file's bytes. */
function precheck(f: File): string | null {
  const video = f.type.startsWith("video/") || /\.(mp4|mov|webm|3gp)$/i.test(f.name);
  const limit = video ? 100 * MB : 15 * MB;
  if (f.size > limit) return `Larger than ${limit / MB} MB`;
  if (!/\.(jpe?g|png|webp|heic|mp4|mov|webm|3gp|pdf|docx|xlsx)$/i.test(f.name)) return "Not an accepted file type";
  return null;
}

function FileIcon({ file, className }: { file: Pick<EvidenceFile, "mimeType">; className?: string }) {
  const m = file.mimeType;
  const Icon = m.startsWith("image/") ? ImageIcon : m.startsWith("video/") ? Film : m.includes("sheet") ? FileSpreadsheet : FileText;
  return <Icon className={className} aria-hidden />;
}

function Uploader({ claimId, categories, onDone }: { claimId: number; categories: string[]; onDone: (files: EvidenceFile[]) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [staged, setStaged] = useState<File[]>([]);
  const [over, setOver] = useState(false);
  const [category, setCategory] = useState("Site Damage Photo");
  const [caption, setCaption] = useState("");
  const [share, setShare] = useState(false);
  const [progress, setProgress] = useState(0);
  const m = useMutation({
    mutationFn: () => workspaceApi.upload(claimId, staged, { category, caption, visibleToInsurer: share }, setProgress),
    onSuccess: (files) => {
      onDone(files);
      setStaged([]);
      setCaption("");
      // Sharing is decided for each batch, never carried over to the next.
      setShare(false);
      setProgress(0);
    },
    onError: () => setProgress(0),
  });
  const add = (list: FileList | null) => {
    if (!list) return;
    m.reset();
    setStaged((prev) => [...prev, ...Array.from(list)].slice(0, 20));
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setOver(false);
    add(e.dataTransfer.files);
  };
  const problems = staged.map(precheck);
  const blocked = problems.some(Boolean);
  const serverProblems = fieldErrors(m.error);

  return (
    <Card title="Upload evidence">
      <div
        onDragOver={(e) => { e.preventDefault(); setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={onDrop}
        className={clsx("rounded-xl border-2 border-dashed p-6 text-center transition-colors", over ? "border-brand-500 bg-brand-50" : "border-slate-300")}
      >
        <UploadCloud className="mx-auto size-8 text-slate-400" />
        <p className="mt-2 text-sm">
          Drag photos, videos or documents here, or{" "}
          <button type="button" className="font-medium text-brand-700 hover:underline" onClick={() => inputRef.current?.click()}>choose files</button>
        </p>
        <p className="mt-1 text-xs text-slate-500">JPG, PNG, HEIC, WebP, MP4, MOV, PDF, Word, Excel · photos and documents up to 15 MB, videos up to 100 MB · 20 at a time</p>
        <input ref={inputRef} type="file" multiple accept={ACCEPT} className="sr-only" onChange={(e) => { add(e.target.files); e.target.value = ""; }} />
      </div>

      {staged.length > 0 && (
        <div className="mt-4 space-y-4">
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200">
            {staged.map((f, i) => (
              <li key={`${f.name}-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                <FileIcon file={{ mimeType: f.type }} className="size-4 shrink-0 text-slate-400" />
                <span className="min-w-0 flex-1 truncate">{f.name}</span>
                <span className="text-xs text-slate-500 tabular-nums">{sizeLabel(f.size)}</span>
                {(problems[i] || serverProblems[f.name]) && <span className="text-xs text-red-700">{problems[i] ?? serverProblems[f.name]}</span>}
                <button type="button" aria-label={`Remove ${f.name}`} disabled={m.isPending} onClick={() => setStaged((s) => s.filter((_, j) => j !== i))} className="grid size-8 place-items-center rounded text-slate-400 hover:bg-slate-100">
                  <X className="size-4" />
                </button>
              </li>
            ))}
          </ul>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" required>
              {(id) => (
                <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>
                  {categories.map((c) => <option key={c}>{c}</option>)}
                </Select>
              )}
            </Field>
            <Field label="Caption" hint="Applies to every file in this batch; edit each later.">{(id, d) => <Input id={id} aria-describedby={d} value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="e.g. Store, north wall after the fire" />}</Field>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={share} onChange={(e) => setShare(e.target.checked)} className="size-4 accent-brand-600" />
            Share with the insurer
          </label>
          {m.isError && <ErrorNote message={errorMessage(m.error)} />}
          {m.isPending && (
            <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label="Upload progress">
              <div className="h-full rounded-full bg-brand-500 transition-[width]" style={{ width: `${Math.max(3, progress * 100)}%` }} />
            </div>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={m.isPending} onClick={() => setStaged([])}>Clear</Button>
            <Button loading={m.isPending} disabled={blocked} onClick={() => m.mutate()}>
              Upload {staged.length} file{staged.length === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function EditDialog({ claimId, file, categories, onClose }: { claimId: number; file: EvidenceFile; categories: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const [category, setCategory] = useState(file.category);
  const [caption, setCaption] = useState(file.caption ?? "");
  const m = useMutation({
    mutationFn: () => workspaceApi.updateEvidence(claimId, file.id, { category, caption }),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: workspaceKeys.evidence(claimId) }); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title="Edit file details" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button loading={m.isPending} onClick={() => m.mutate()}>Save</Button></>}>
      <div className="space-y-4">
        {m.isError && <ErrorNote message={errorMessage(m.error)} />}
        <Field label="Category">{(id) => <Select id={id} value={category} onChange={(e) => setCategory(e.target.value)}>{categories.map((c) => <option key={c}>{c}</option>)}</Select>}</Field>
        <Field label="Caption">{(id) => <Input id={id} value={caption} onChange={(e) => setCaption(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}

function RemoveDialog({ claimId, file, onClose }: { claimId: number; file: EvidenceFile; onClose: () => void }) {
  const qc = useQueryClient();
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: () => workspaceApi.deleteEvidence(claimId, file.id, reason),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: workspaceKeys.evidence(claimId) }); onClose(); },
  });
  return (
    <Modal open onClose={onClose} title="Remove this file from the claim?" footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button variant="danger" loading={m.isPending} onClick={() => m.mutate()}>Remove</Button></>}>
      <p className="mb-4 text-sm text-slate-600">{file.fileName} will no longer show on the claim. The stored original is kept and the removal is recorded in the audit trail.</p>
      {m.isError && <ErrorNote message={errorMessage(m.error)} className="mb-4" />}
      <Field label="Reason" required>{(id) => <Textarea id={id} rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Uploaded to the wrong claim" />}</Field>
    </Modal>
  );
}

function Viewer({ file, onClose }: { file: EvidenceFile; onClose: () => void }) {
  return (
    <Modal open onClose={onClose} title={file.fileName} size="lg" footer={<a href={file.downloadUrl} className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-slate-300 px-4 text-sm font-medium hover:bg-slate-50"><Download className="size-4" /> Download original</a>}>
      {file.mimeType.startsWith("image/") ? (
        <img src={file.url} alt={file.caption ?? file.fileName} className="mx-auto max-h-[65dvh] rounded-lg object-contain" />
      ) : file.mimeType.startsWith("video/") ? (
        <video src={file.url} controls className="mx-auto max-h-[65dvh] w-full rounded-lg bg-black" />
      ) : null}
      <dl className="mt-4 grid grid-cols-[8rem_1fr] gap-y-1 text-sm">
        <dt className="text-slate-500">Category</dt><dd>{file.category}</dd>
        {file.caption && <><dt className="text-slate-500">Caption</dt><dd>{file.caption}</dd></>}
        <dt className="text-slate-500">Uploaded</dt><dd>{formatDateTime(file.createdAt)} by {file.uploadedBy.fullName}</dd>
        <dt className="text-slate-500">Size</dt><dd>{sizeLabel(file.sizeBytes)}</dd>
        <dt className="text-slate-500">SHA-256</dt><dd className="font-mono text-xs break-all">{file.sha256}</dd>
      </dl>
    </Modal>
  );
}

export function EvidenceTab({ claim, readOnly }: { claim: ClaimDetail; readOnly?: boolean }) {
  const qc = useQueryClient();
  const key = workspaceKeys.evidence(claim.id);
  const { data, isPending, isError, error } = useQuery({ queryKey: key, queryFn: () => workspaceApi.evidence(claim.id) });
  const [filter, setFilter] = useState("");
  const [viewing, setViewing] = useState<EvidenceFile | null>(null);
  const [editing, setEditing] = useState<EvidenceFile | null>(null);
  const [removing, setRemoving] = useState<EvidenceFile | null>(null);
  const share = useMutation({
    mutationFn: (f: EvidenceFile) => workspaceApi.updateEvidence(claim.id, f.id, { visibleToInsurer: !f.visibleToInsurer }),
    onSuccess: () => void qc.invalidateQueries({ queryKey: key }),
  });
  const canWrite = !readOnly && claim.permissions.edit;
  const files = (data?.data ?? []).filter((f) => !filter || f.category === filter);
  const used = Array.from(new Set((data?.data ?? []).map((f) => f.category)));

  return (
    <div className="space-y-4">
      {canWrite && data && <Uploader claimId={claim.id} categories={data.categories} onDone={() => void qc.invalidateQueries({ queryKey: key })} />}
      {isPending && <Spinner />}
      {isError && <ErrorNote message={errorMessage(error)} />}
      {share.isError && <ErrorNote message={errorMessage(share.error)} />}
      {data && (
        <Card
          title={`Evidence (${data.data.length})`}
          actions={
            used.length > 1 && (
              <div className="w-52 shrink-0">
                <Select aria-label="Filter by category" value={filter} onChange={(e) => setFilter(e.target.value)} className="py-1.5">
                  <option value="">All categories</option>
                  {used.map((c) => <option key={c}>{c}</option>)}
                </Select>
              </div>
            )
          }
        >
          {files.length === 0 ? (
            <EmptyState title={readOnly ? "Nothing shared yet" : "No evidence yet"}>{readOnly ? "The adjusters will share photos and documents here." : "Upload site photos, reports and estimates above."}</EmptyState>
          ) : (
            <ul className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4">
              {files.map((f) => {
                const previewable = f.mimeType.startsWith("image/") || f.mimeType.startsWith("video/");
                return (
                  <li key={f.id} className="group overflow-hidden rounded-xl border border-slate-200">
                    <button
                      type="button"
                      onClick={() => (previewable ? setViewing(f) : window.open(f.url, "_blank", "noopener"))}
                      className="relative block aspect-[4/3] w-full bg-slate-100"
                      aria-label={`Open ${f.fileName}`}
                    >
                      {f.thumbnailUrl ? (
                        <img src={f.thumbnailUrl} alt={f.caption ?? f.fileName} loading="lazy" className="size-full object-cover" />
                      ) : (
                        <span className="grid size-full place-items-center"><FileIcon file={f} className="size-10 text-slate-400" /></span>
                      )}
                      {f.mimeType.startsWith("video/") && <Film className="absolute top-2 left-2 size-5 rounded bg-black/60 p-0.5 text-white" aria-hidden />}
                      {!readOnly && f.visibleToInsurer && <span className="absolute top-2 right-2 rounded-full bg-white/90 px-2 py-0.5 text-[11px] font-medium text-brand-700">Shared</span>}
                    </button>
                    <div className="p-3 text-xs">
                      <p className="truncate text-sm font-medium" title={f.fileName}>{f.caption || f.fileName}</p>
                      <p className="mt-0.5 truncate text-slate-500">{f.category} · {sizeLabel(f.sizeBytes)}</p>
                      <p className="truncate text-slate-400">{formatDateTime(f.createdAt)}</p>
                      <div className="mt-2 flex gap-1">
                        <a href={f.downloadUrl} className="grid size-8 place-items-center rounded text-slate-500 hover:bg-slate-100" aria-label={`Download ${f.fileName}`} title="Download"><Download className="size-4" /></a>
                        {canWrite && (
                          <>
                            <button type="button" onClick={() => share.mutate(f)} className="grid size-8 place-items-center rounded text-slate-500 hover:bg-slate-100" aria-label={f.visibleToInsurer ? "Stop sharing with the insurer" : "Share with the insurer"} title={f.visibleToInsurer ? "Stop sharing with the insurer" : "Share with the insurer"}>
                              {f.visibleToInsurer ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                            </button>
                            <button type="button" onClick={() => setEditing(f)} className="grid size-8 place-items-center rounded text-slate-500 hover:bg-slate-100" aria-label={`Edit ${f.fileName}`} title="Edit details"><Pencil className="size-4" /></button>
                            <button type="button" onClick={() => setRemoving(f)} className="ml-auto grid size-8 place-items-center rounded text-slate-400 hover:bg-red-50 hover:text-red-700" aria-label={`Remove ${f.fileName}`} title="Remove"><Trash2 className="size-4" /></button>
                          </>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}
      {viewing && <Viewer file={viewing} onClose={() => setViewing(null)} />}
      {editing && data && <EditDialog claimId={claim.id} file={editing} categories={data.categories} onClose={() => setEditing(null)} />}
      {removing && <RemoveDialog claimId={claim.id} file={removing} onClose={() => setRemoving(null)} />}
    </div>
  );
}
