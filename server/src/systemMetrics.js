import { readFile } from "node:fs/promises";
import os from "node:os";

let lastCpuSample = null;
let lastDiskSample = null;
let lastProcessIoSample = null;

function clampPercent(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function readCpuSample() {
  const totals = os.cpus().reduce(
    (accumulator, cpu) => {
      const total = Object.values(cpu.times).reduce((sum, value) => sum + value, 0);
      accumulator.total += total;
      accumulator.idle += cpu.times.idle;
      return accumulator;
    },
    { idle: 0, total: 0 }
  );

  return { ...totals, sampledAt: Date.now() };
}

function cpuPercent() {
  const current = readCpuSample();
  const previous = lastCpuSample;
  lastCpuSample = current;

  if (!previous) {
    const loadAverage = os.loadavg()[0] || 0;
    return clampPercent((loadAverage / os.cpus().length) * 100);
  }

  const idleDelta = current.idle - previous.idle;
  const totalDelta = current.total - previous.total;
  if (totalDelta <= 0) {
    return 0;
  }

  return clampPercent((1 - idleDelta / totalDelta) * 100);
}

function shouldCountDiskDevice(name) {
  if (/^(loop|ram|fd|sr|dm-)/.test(name)) {
    return false;
  }

  return /^(nvme\d+n\d+|vd[a-z]+|xvd[a-z]+|sd[a-z]+)$/.test(name);
}

async function readLinuxDiskIoSample() {
  const content = await readFile("/proc/diskstats", "utf8");
  let sectorsRead = 0;
  let sectorsWritten = 0;

  for (const line of content.trim().split("\n")) {
    const parts = line.trim().split(/\s+/);
    const name = parts[2];
    if (!shouldCountDiskDevice(name)) {
      continue;
    }

    sectorsRead += Number(parts[5] ?? 0);
    sectorsWritten += Number(parts[9] ?? 0);
  }

  return {
    bytesRead: sectorsRead * 512,
    bytesWritten: sectorsWritten * 512,
    sampledAt: Date.now()
  };
}

function throughput(previous, current) {
  if (!previous) {
    return { readKbps: 0, writeKbps: 0 };
  }

  const seconds = Math.max(0.001, (current.sampledAt - previous.sampledAt) / 1000);
  return {
    readKbps: Math.max(0, Math.round((current.bytesRead - previous.bytesRead) / 1024 / seconds)),
    writeKbps: Math.max(0, Math.round((current.bytesWritten - previous.bytesWritten) / 1024 / seconds))
  };
}

async function linuxDiskIo() {
  try {
    const current = await readLinuxDiskIoSample();
    const previous = lastDiskSample;
    lastDiskSample = current;

    return {
      supported: true,
      source: "host",
      ...throughput(previous, current)
    };
  } catch {
    return null;
  }
}

function processIoSample() {
  const usage = process.resourceUsage();
  return {
    bytesRead: Number(usage.fsRead ?? 0) * 1024,
    bytesWritten: Number(usage.fsWrite ?? 0) * 1024,
    sampledAt: Date.now()
  };
}

function processDiskIo() {
  const current = processIoSample();
  const previous = lastProcessIoSample;
  lastProcessIoSample = current;

  return {
    supported: true,
    source: "process",
    ...throughput(previous, current)
  };
}

async function diskIo() {
  const hostIo = await linuxDiskIo();
  if (hostIo) {
    return hostIo;
  }

  return processDiskIo();
}

export async function systemMetrics() {
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const io = await diskIo();

  return {
    cpuCores: os.cpus().length,
    cpuPercent: cpuPercent(),
    ramPercent: clampPercent(((totalMem - freeMem) / totalMem) * 100),
    diskIo: io
  };
}
