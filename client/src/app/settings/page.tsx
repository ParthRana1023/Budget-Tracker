import type { Metadata } from "next";
import SettingsClient from "@/components/settings/SettingsClient";
import { loadSettingsPage, pick } from "./load";

export const metadata: Metadata = { title: "Settings · SaveFirst" };

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const [data, q] = await Promise.all([loadSettingsPage(), searchParams]);
  return <SettingsClient view="settings" data={data} section={pick(q.s)} field={pick(q.f)} />;
}
