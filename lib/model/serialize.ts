import type { ProbInputs, ProbMatrix } from "./types";
import type { WeekMatchup } from "./engine";

/**
 * Maps do not survive the server -> client boundary, so the matrix crosses as
 * a plain object and is rehydrated in the browser.
 *
 * The point of shipping it at all: lib/model is pure, so the same scoring code
 * runs client-side. That makes the lambda and weight controls recompute
 * instantly instead of round-tripping to the server on every drag.
 */
export type SerializedMatrix = Record<string, Record<string, ProbInputs>>;
export type SerializedMatchups = Record<string, WeekMatchup>;

export function serializeMatrix(matrix: ProbMatrix): SerializedMatrix {
  const out: SerializedMatrix = {};
  for (const [week, teams] of matrix) {
    out[String(week)] = Object.fromEntries(teams);
  }
  return out;
}

export function deserializeMatrix(raw: SerializedMatrix): ProbMatrix {
  const matrix: ProbMatrix = new Map();
  for (const [week, teams] of Object.entries(raw)) {
    matrix.set(Number(week), new Map(Object.entries(teams)));
  }
  return matrix;
}

export function serializeMatchups(m: Map<string, WeekMatchup>): SerializedMatchups {
  return Object.fromEntries(m);
}

export function deserializeMatchups(raw: SerializedMatchups): Map<string, WeekMatchup> {
  return new Map(Object.entries(raw));
}
