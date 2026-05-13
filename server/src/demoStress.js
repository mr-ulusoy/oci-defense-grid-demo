import os from "node:os";
import { Worker } from "node:worker_threads";

const DEFAULT_DURATION_SECONDS = 260;
const MIN_DURATION_SECONDS = 15;
const MAX_DURATION_SECONDS = 600;
const MAX_WORKERS = 8;

let activeJob = null;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function finiteNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function availableWorkers() {
  const parallelism = typeof os.availableParallelism === "function" ? os.availableParallelism() : os.cpus().length;
  return clamp(finiteNumber(parallelism, 2), 1, MAX_WORKERS);
}

function normalizeDurationSeconds(value) {
  return clamp(finiteNumber(value, DEFAULT_DURATION_SECONDS), MIN_DURATION_SECONDS, MAX_DURATION_SECONDS);
}

function normalizeWorkers(value) {
  return clamp(finiteNumber(value, availableWorkers()), 1, availableWorkers());
}

function workerSource() {
  return `
    const { parentPort, workerData } = require("node:worker_threads");
    const end = Date.now() + workerData.durationMs;
    let seed = 1;

    while (Date.now() < end) {
      for (let index = 0; index < 200000; index += 1) {
        seed = (seed * 16807) % 2147483647;
        Math.sqrt(seed);
      }
    }

    parentPort.postMessage({ done: true, seed });
  `;
}

function cleanupFinishedJob() {
  if (activeJob && activeJob.endsAt <= Date.now()) {
    activeJob = null;
  }
}

function statusFromJob(job = activeJob) {
  if (!job) {
    return {
      active: false,
      status: "idle"
    };
  }

  return {
    active: true,
    status: "running",
    startedAt: new Date(job.startedAt).toISOString(),
    endsAt: new Date(job.endsAt).toISOString(),
    remainingSeconds: Math.max(0, Math.ceil((job.endsAt - Date.now()) / 1000)),
    workers: job.workers.length,
    durationSeconds: job.durationSeconds
  };
}

function finishWorker(worker) {
  if (!activeJob) {
    return;
  }

  activeJob.workers = activeJob.workers.filter((candidate) => candidate !== worker);
  if (activeJob.workers.length === 0) {
    activeJob = null;
  }
}

export function stressStatus() {
  cleanupFinishedJob();
  return statusFromJob();
}

export function stopStress() {
  cleanupFinishedJob();
  if (!activeJob) {
    return {
      active: false,
      status: "idle",
      stopped: false,
      stoppedWorkers: 0
    };
  }

  const workers = [...activeJob.workers];
  activeJob = null;
  for (const worker of workers) {
    worker.terminate();
  }

  return {
    active: false,
    status: "stopped",
    stopped: true,
    stoppedWorkers: workers.length
  };
}

export function startStress({ durationSeconds, workers } = {}) {
  cleanupFinishedJob();
  if (activeJob) {
    return {
      ...statusFromJob(),
      reused: true
    };
  }

  const normalizedDuration = normalizeDurationSeconds(durationSeconds);
  const normalizedWorkers = normalizeWorkers(workers);
  const durationMs = normalizedDuration * 1000;
  const startedAt = Date.now();

  activeJob = {
    startedAt,
    endsAt: startedAt + durationMs,
    durationSeconds: normalizedDuration,
    workers: []
  };

  for (let index = 0; index < normalizedWorkers; index += 1) {
    const worker = new Worker(workerSource(), {
      eval: true,
      workerData: { durationMs }
    });
    worker.on("message", () => finishWorker(worker));
    worker.on("error", () => finishWorker(worker));
    worker.on("exit", () => finishWorker(worker));
    activeJob.workers.push(worker);
  }

  return {
    ...statusFromJob(),
    reused: false
  };
}
