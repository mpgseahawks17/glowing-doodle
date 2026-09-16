"use client";

export function SettingsBar({
  lambda,
  onLambda,
  wVegas,
  onWVegas,
  horizon,
  onHorizon,
  week,
  onWeek,
  currentWeek,
}: {
  lambda: number;
  onLambda: (v: number) => void;
  wVegas: number;
  onWVegas: (v: number) => void;
  horizon: number;
  onHorizon: (v: number) => void;
  week: number;
  onWeek: (v: number) => void;
  currentWeek: number;
}) {
  return (
    <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-4 rounded-lg bg-slate-900/50 px-4 py-3 ring-1 ring-slate-800">
      <label className="flex items-center gap-2 text-sm">
        <span className="text-slate-400">Week</span>
        <select
          value={week}
          onChange={(e) => onWeek(Number(e.target.value))}
          className="rounded bg-slate-800 px-2 py-1 text-slate-200"
        >
          {Array.from({ length: 18 }, (_, i) => i + 1).map((w) => (
            <option key={w} value={w}>
              {w}
              {w === currentWeek ? " (current)" : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="flex items-center gap-3 text-sm">
        <span className="text-slate-400" title="Opportunity-cost multiplier">
          λ
        </span>
        <input
          type="range"
          min={0}
          max={2}
          step={0.05}
          value={lambda}
          onChange={(e) => onLambda(Number(e.target.value))}
          className="w-36 accent-emerald-500"
        />
        <span className="w-8 text-right nums text-slate-200">
          {lambda.toFixed(2)}
        </span>
      </label>

      <label className="flex items-center gap-3 text-sm">
        <span className="text-slate-400">Vegas / Silver</span>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={wVegas}
          onChange={(e) => onWVegas(Number(e.target.value))}
          className="w-36 accent-sky-500"
        />
        <span className="w-20 text-right nums text-slate-200">
          {(wVegas * 100).toFixed(0)} / {((1 - wVegas) * 100).toFixed(0)}
        </span>
      </label>

      <label className="flex items-center gap-2 text-sm">
        <span className="text-slate-400">Horizon</span>
        <select
          value={horizon}
          onChange={(e) => onHorizon(Number(e.target.value))}
          className="rounded bg-slate-800 px-2 py-1 text-slate-200"
        >
          {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((h) => (
            <option key={h} value={h}>
              {h}w
            </option>
          ))}
        </select>
      </label>

      <span className="text-xs text-slate-500">
        λ=0 ranks by raw win probability; higher λ defers teams with strong
        future spots.
      </span>
    </div>
  );
}
