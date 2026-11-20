"use client";

// Account › Profile (design handoff v2): photo, name (saves on its own), email with its
// verified badge, and a read-only plan summary.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/utils/supabase/client";
import { formatMoney } from "@/lib/money.mjs";
import { authErrorFor, isValidEmail } from "@/lib/auth.mjs";
import {
  AVATAR_TYPES,
  avatarProblem,
  payDayLabel,
  removeAvatar,
  savePreferences,
  uploadAvatar,
} from "@/lib/settings.mjs";
import { errorFields, reportClientError } from "@/lib/log.mjs";
import type { Settings } from "../dashboard/types";
import { Avatar, BTN_LINK, Card, INPUT, Row, SAVE_ERROR, SaveState, useSave } from "./parts";

/** `providers`: how the user can sign in ("email", "google"). */
export type AccountUser = { id: string; email: string; verified: boolean; createdAt: string; providers: string[] };
const EMAIL_IDLE = { editing: false, value: "", busy: false, error: null as string | null, sentTo: "" };

export default function ProfileSection({
  user,
  settings,
  onSaved,
}: {
  user: AccountUser;
  settings: Settings;
  onSaved: (patch: Partial<Settings>) => void;
}) {
  const db = createClient();
  const nameSave = useSave();
  const [name, setName] = useState(settings.display_name ?? "");
  const savedName = useRef(settings.display_name ?? "");
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const [email, setEmail] = useState(EMAIL_IDLE);

  // Supabase emails a confirmation link; the address changes once it's opened.
  const changeEmail = async () => {
    const value = email.value.trim();
    if (!isValidEmail(value)) return setEmail({ ...email, error: "Enter a valid email address." });
    if (value.toLowerCase() === user.email.toLowerCase())
      return setEmail({ ...email, error: "That’s already your email." });
    setEmail({ ...email, busy: true, error: null });
    const { error } = await db.auth.updateUser(
      { email: value },
      { emailRedirectTo: `${window.location.origin}/auth/confirm?next=/settings/account` },
    );
    if (error) return setEmail({ ...email, busy: false, error: authErrorFor(error).message });
    setEmail({ ...EMAIL_IDLE, sentTo: value });
  };

  const saveName = (v: string) => {
    clearTimeout(timer.current);
    const next = v.trim();
    if (next === savedName.current) return;
    void nameSave
      .run(() => savePreferences(db, { display_name: next || null }))
      .then((ok) => {
        if (!ok) return;
        savedName.current = next;
        onSaved({ display_name: next || null });
      });
  };

  const shownName = settings.display_name || user.email.split("@")[0];
  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    const problem = avatarProblem(file);
    if (problem) return setPhotoError(problem);
    setPhotoError(null);
    setPhotoBusy(true);
    const { url, error } = await uploadAvatar(db, user.id, file);
    setPhotoBusy(false);
    if (error) {
      reportClientError("avatar_upload_failed", { userId: user.id, ...errorFields(error) });
      return setPhotoError(SAVE_ERROR);
    }
    onSaved({ avatar_url: url });
  };
  const dropPhoto = async () => {
    setPhotoError(null);
    setPhotoBusy(true);
    const { error } = await removeAvatar(db, user.id);
    setPhotoBusy(false);
    if (error) {
      reportClientError("avatar_remove_failed", { userId: user.id, ...errorFields(error) });
      return setPhotoError(SAVE_ERROR);
    }
    onSaved({ avatar_url: null });
  };

  const salary = Number(settings.take_home_pay ?? 0);
  return (
    <>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-5">
        <Avatar url={settings.avatar_url} name={shownName} size={112} className="font-serif text-[48px]" />
        <div className="flex flex-col gap-2">
          <span className="font-serif text-[36px] leading-none">{shownName}</span>
          <span className="text-[13px] text-muted">
            Member since {new Date(user.createdAt).toLocaleDateString("en-GB", { month: "long", year: "numeric" })}
          </span>
          <div className="flex gap-3.5 pt-0.5">
            <label
              className="cursor-pointer text-[13px] font-semibold text-lime-text focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-lime hover:text-ink"
              aria-disabled={photoBusy}
            >
              {photoBusy ? "Saving…" : settings.avatar_url ? "Change photo" : "Upload photo"}
              <input
                type="file"
                accept={AVATAR_TYPES.join(",")}
                disabled={photoBusy}
                onChange={(e) => {
                  void pickPhoto(e.target.files?.[0]);
                  e.target.value = "";
                }}
                className="absolute h-px w-px opacity-0"
              />
            </label>
            {settings.avatar_url && !photoBusy && (
              <button type="button" onClick={dropPhoto} className={`${BTN_LINK} text-muted`}>
                Remove
              </button>
            )}
          </div>
          {photoError && (
            <span role="alert" className="text-[13px] font-semibold text-danger">
              {photoError}
            </span>
          )}
        </div>
      </div>

      <Card>
        <Row label="Name" htmlFor="f-name">
          <input
            id="f-name"
            value={name}
            maxLength={80}
            autoComplete="name"
            onChange={(e) => {
              setName(e.target.value);
              clearTimeout(timer.current);
              const v = e.target.value;
              timer.current = setTimeout(() => saveName(v), 800);
            }}
            onBlur={() => saveName(name)}
            className={`${INPUT} flex-[1_1_220px]`}
          />
          <SaveState status={nameSave.status} />
        </Row>
        <Row label="Email">
          {email.sentTo ? (
            <span className="flex min-w-0 flex-[1_1_220px] flex-col text-sm [overflow-wrap:anywhere]">
              {user.email}
              <span role="status" className="text-[13px] font-semibold text-warn">
                Check {email.sentTo} for a link. Your email changes once you open it.
              </span>
            </span>
          ) : email.editing ? (
            <span className="flex min-w-0 flex-[1_1_220px] flex-wrap gap-2">
              <input
                type="email"
                autoComplete="email"
                aria-label="New email address"
                placeholder="New email address"
                value={email.value}
                onChange={(e) => setEmail({ ...email, value: e.target.value, error: null })}
                onKeyDown={(e) => e.key === "Enter" && changeEmail()}
                className={`${INPUT} h-11 flex-[1_1_200px] text-[15px]`}
              />
              <button
                type="button"
                onClick={changeEmail}
                disabled={email.busy}
                className="h-11 cursor-pointer rounded-full border-0 bg-lime px-4 text-[13px] font-bold text-lime-ink disabled:opacity-60"
              >
                {email.busy ? "Sending…" : "Send link"}
              </button>
              <button
                type="button"
                onClick={() => setEmail(EMAIL_IDLE)}
                className="h-11 cursor-pointer border-0 bg-transparent px-2.5 text-[13px] font-semibold text-muted"
              >
                Cancel
              </button>
              {email.error && (
                <span role="alert" className="basis-full text-[13px] font-semibold text-danger">
                  {email.error}
                </span>
              )}
            </span>
          ) : (
            <span className="flex min-w-0 flex-[1_1_220px] flex-wrap items-center gap-2.5 text-[15px] [overflow-wrap:anywhere]">
              {user.email}
              <span
                className="flex h-6 items-center rounded-full px-[9px] text-xs font-bold"
                style={{
                  background: user.verified ? "var(--lime-soft)" : "var(--warn-soft)",
                  color: user.verified ? "var(--lime-text)" : "var(--warn)",
                }}
              >
                {user.verified ? "Verified" : "Not verified"}
              </span>
              <button
                type="button"
                onClick={() => setEmail({ ...EMAIL_IDLE, editing: true })}
                className={`${BTN_LINK} ml-auto`}
              >
                Change
              </button>
            </span>
          )}
        </Row>
      </Card>

      <div className="flex flex-wrap items-center gap-x-8 gap-y-4 rounded-[18px] border border-line bg-tile px-6 py-5">
        <div className="flex flex-col">
          <span className="text-xs text-muted">Salary</span>
          <span className="tabular text-xl font-semibold">{formatMoney(salary, settings.number_format)}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-muted">Payday</span>
          <span className="text-xl font-semibold">{payDayLabel(settings.month_start_day ?? 1).replace(/^l/, "L")}</span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-muted">Saved first</span>
          <span className="text-xl font-semibold text-lime-text">{settings.savings_pct ?? 0}%</span>
        </div>
        <Link href="/settings?s=plan" className={`${BTN_LINK} ml-auto`}>
          Edit in Settings
        </Link>
      </div>
    </>
  );
}
