"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { UsedPick } from "./dashboard";

const RESULTS = ["win", "loss", "push"] as const;

export function PicksPanel({
  season,
  used,
  available,
  currentWeek,
}: {
  season: number;
  used: UsedPick[];
  available: string[];
  currentWeek: number;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [week, setWeek] = useState(currentWeek);
  const [team, setTeam] = useState(available[0] ?? "");
  const [error, setError] = useState<string | null>(null);

  async function save(result: (typeof RESULTS)[number] | null) {
    setError(null);
    const res = await fetch("/api/picks", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ season, week, team, result }),
    });
    if (!res.ok) {
      const body = (await res.json()) as { error?: string };
      setError(body.error ?? "Failed to save");
      return;
    }
    startTransition(() => router.refresh());
  }

  async function remove(w: number) {
    setError(null);
    await fetch(`/api/picks?season=${season}&week=${w}`, { method: "DELETE" });
    startTransition(() => router.refresh());
  }

  const losses = used.filter((u) => u.result === "loss").length;

  return (
    <div className="grid gap-6 md:grid-cols-2">
      <section className="rounded-lg bg-slate-900/50 p-4 ring-1 ring-slate-800">
        <h2 className="mb-3 font-semibold">Record a pick</h2>

        <div className="flex flex-wrap items-end gap-3">
          <label className="text-sm">
            <span className="mb-1 block text-slate-400">Week</span>
            <select
              value={week}
              onChange={(e) => setWeek(Number(e.target.value))}
              className="rounded bg-slate-800 px-2 py-1.5 text-slate-200"
            >
              {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
                <option key={w} value={w}>
                  {w}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm">
            <span className="mb-1 block text-slate-400">Team</span>
            <select
              value={team}
              onChange={(e) => setTeam(e.target.value)}
              className="rounded bg-slate-800 px-2 py-1.5 text-slate-200"
            >
              {available.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>

          <div className="flex gap-2">
            <button
              onClick={() => save(null)}
              disabled={pending || !team}
              className="rounded bg-slate-700 px-3 py-1.5 text-sm hover:bg-slate-600 disabled:opacity-50"
            >
              Save
            </button>
            {RESULTS.map((r) => (
              <button
                key={r}
                onClick={() => save(r)}
                disabled={pending || !team}
                className="rounded bg-slate-800 px-3 py-1.5 text-sm capitalize text-slate-300 hover:bg-slate-700 disabled:opacity-50"
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {error && (
          <p className="mt-3 rounded border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <p className="mt-3 text-xs text-slate-500">
          Saving without a result records the pick as pending. A team can only
          be used once per season — the database enforces it.
        </p>
      </section>

      <section className="rounded-lg bg-slate-900/50 p-4 ring-1 ring-slate-800">
        <h2 className="mb-3 font-semibold">
          Season so far{" "}
          <span className="text-sm font-normal text-slate-400">
            — {used.length} picks, {3 - losses} lives left
          </span>
        </h2>

        {used.length === 0 ? (
          <p className="text-sm text-slate-500">No picks recorded yet.</p>
        ) : (
          <table className="w-full text-sm nums">
            <tbody>
              {used
                .slice()
                .sort((a, b) => a.week - b.week)
                .map((p) => (
                  <tr key={p.week} className="border-t border-slate-800/70">
                    <td className="py-1.5 text-slate-500">w{p.week}</td>
                    <td className="py-1.5 font-semibold">{p.team}</td>
                    <td className="py-1.5">
                      <span
                        className={
                          p.result === "loss"
                            ? "text-red-400"
                            : p.result === "win"
                              ? "text-emerald-400"
                              : "text-slate-500"
                        }
                      >
                        {p.result ?? "pending"}
                      </span>
                    </td>
                    <td className="py-1.5 text-right">
                      <button
                        onClick={() => remove(p.week)}
                        disabled={pending}
                        className="text-xs text-slate-500 hover:text-red-400 disabled:opacity-50"
                      >
                        remove
                      </button>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
