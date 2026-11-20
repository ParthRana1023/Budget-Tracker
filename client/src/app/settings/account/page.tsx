import type { Metadata } from "next";
import SettingsClient from "@/components/settings/SettingsClient";
import { loadSettingsPage, pick } from "../load";

export const metadata: Metadata = { title: "Account · SaveFirst" };

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [data, q] = await Promise.all([loadSettingsPage(), searchParams]);
  return <SettingsClient view="account" data={data} section={pick(q.s)} field={pick(q.f)} />;
}
