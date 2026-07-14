/**
 * Parallel TD(0) self-play trainer for JS-NNUE.
 *
 * Spawns one child process per game (scripts/_td-game.ts) so the expensive
 * alpha-beta search runs across all CPU cores, while the cheap gradient
 * updates stay in the main process. ~6-8x faster than the single-threaded
 * train-nnue-td.ts on an 8-core machine.
 *
 * Run: npx tsx scripts/train-nnue-td-parallel.ts [totalGames] [epochsPerGame] [parallelism]
 * Weights exported to public/js/weights/nnue-weights.json.
 */

import { spawn } from "child_process";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { randomWeights, trainStep, type NNUEWeights } from "../js/nnue.ts";

const PARALLELISM = Number(process.argv[4] ?? 6);
const TOTAL_GAMES = Number(process.argv[2] ?? 60);
const EPOCHS = Number(process.argv[3] ?? 4);
const LR = 0.02;

function weightsToObj(w: NNUEWeights) {
  return {
    w1: Array.from(w.w1),
    b1: Array.from(w.b1),
    w2: Array.from(w.w2),
    b2: Array.from(w.b2),
    w3: Array.from(w.w3),
    b3: Array.from(w.b3),
  };
}

function objToWeights(o: any): NNUEWeights {
  return {
    w1: Float32Array.from(o.w1),
    b1: Float32Array.from(o.b1),
    w2: Float32Array.from(o.w2),
    b2: Float32Array.from(o.b2),
    w3: Float32Array.from(o.w3),
    b3: Float32Array.from(o.b3),
  };
}

/** Run one child game, return its trajectory temp path. */
function runGame(
  weightsPath: string,
  outPath: string,
  gameId: number,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "npx",
      ["tsx", "scripts/_td-game.ts", weightsPath, outPath, String(gameId)],
      { cwd: process.cwd() },
    );
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(outPath);
      else reject(new Error(`game ${gameId} exited ${code}`));
    });
  });
}

async function main(): Promise<void> {
  const workdir = mkdtempSync(join(tmpdir(), "td-"));
  let w = randomWeights();
  let weightsPath = join(workdir, "weights.json");
  writeFileSync(weightsPath, JSON.stringify(weightsToObj(w)));

  let done = 0;
  while (done < TOTAL_GAMES) {
    const batch = Math.min(PARALLELISM, TOTAL_GAMES - done);
    const outs = Array.from({ length: batch }, (_, i) =>
      join(workdir, `game-${done + i}.json`),
    );
    // Run the batch of games in parallel.
    await Promise.all(
      outs.map((out, i) => runGame(weightsPath, out, done + i)),
    );
    // Collect trajectories and train.
    const all: { vec: Float32Array; label: number }[] = [];
    for (const out of outs) {
      const data = JSON.parse(readFileSync(out, "utf8"));
      for (const t of data.traj) {
        all.push({ vec: Float32Array.from(t.vec), label: t.label });
      }
      rmSync(out);
    }
    for (let e = 0; e < EPOCHS; e++) trainStep(w, all, LR);
    // Persist updated weights for the next batch.
    weightsPath = join(workdir, "weights.json");
    writeFileSync(weightsPath, JSON.stringify(weightsToObj(w)));
    done += batch;
    console.log(
      `Games ${done}/${TOTAL_GAMES}: traj=${all.length} positions trained`,
    );
  }

  // Export final weights.
  writeFileSync(
    "public/js/weights/nnue-weights.json",
    JSON.stringify(weightsToObj(w)),
  );
  rmSync(workdir, { recursive: true, force: true });
  console.log(
    "TD-trained weights written to public/js/weights/nnue-weights.json",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
