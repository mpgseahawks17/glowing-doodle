/**
 * Rectangular assignment problem (Hungarian / Jonker-Volgenant algorithm).
 *
 * Planning a survivor season is exactly this problem: assign one distinct team
 * to each of the next K weeks so that the chance of surviving all of them is as
 * high as possible. Survival across weeks is a product of probabilities, so
 * maximising that product is the same as maximising the sum of log
 * probabilities -- which is a linear assignment, solvable exactly.
 *
 * Picking greedily week by week is NOT equivalent: taking the best team in
 * week 2 can strand week 5 with nothing good left. The whole point of solving
 * it properly is to see when that happens.
 *
 * O(n^2 m) with n = weeks (<= ~9) and m = teams (32), so it is instant here.
 */

/** Cost used for a pairing that is not allowed (bye week, or no data). */
export const INFEASIBLE = 1e9;

/**
 * Minimise total cost. `cost[i][j]` is the cost of assigning row i to column j.
 * Requires rows <= cols. Returns the column chosen for each row, or -1.
 */
export function solveAssignment(cost: number[][]): number[] {
  const n = cost.length;
  if (n === 0) return [];
  const m = cost[0]!.length;
  if (n > m) {
    throw new Error(`solveAssignment needs rows <= cols, got ${n}x${m}`);
  }

  const INF = Number.POSITIVE_INFINITY;
  // 1-indexed potentials and matching, following the standard formulation.
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(m + 1).fill(0);
  const p = new Array<number>(m + 1).fill(0); // p[j] = row matched to column j
  const way = new Array<number>(m + 1).fill(0);

  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(m + 1).fill(INF);
    const used = new Array<boolean>(m + 1).fill(false);

    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = INF;
      let j1 = 0;

      for (let j = 1; j <= m; j++) {
        if (used[j]) continue;
        const cur = cost[i0 - 1]![j - 1]! - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }

      for (let j = 0; j <= m; j++) {
        if (used[j]) {
          u[p[j]!] = u[p[j]!]! + delta;
          v[j] = v[j]! - delta;
        } else {
          minv[j] = minv[j]! - delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);

    // Walk the augmenting path back, flipping the matching.
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0);
  }

  const assignment = new Array<number>(n).fill(-1);
  for (let j = 1; j <= m; j++) {
    const row = p[j]!;
    if (row > 0) assignment[row - 1] = j - 1;
  }
  return assignment;
}

/** Convenience wrapper: maximise a value matrix instead of minimising cost. */
export function solveAssignmentMax(value: number[][]): number[] {
  return solveAssignment(value.map((row) => row.map((x) => -x)));
}
