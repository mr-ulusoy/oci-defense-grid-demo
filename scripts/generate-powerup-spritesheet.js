import { readFile, writeFile } from "node:fs/promises";
import { deflateSync } from "node:zlib";

const frameSize = 32;
const width = frameSize * 2;
const height = frameSize * 2;
const pixels = Buffer.alloc(width * height * 4);

const oracleSvg = await readFile("oracle.svg", "utf8");
const oraclePath = oracleSvg.match(/\sd="([^"]+)"/)?.[1];

if (!oraclePath) {
  throw new Error("oracle.svg must contain a path with a d attribute.");
}

const frameColors = [
  [255, 216, 84, 255],
  [96, 214, 255, 255],
  [70, 230, 166, 255],
  [255, 108, 148, 255]
];

function blendPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= width || y >= height || a <= 0) return;
  const offset = (y * width + x) * 4;
  const alpha = a / 255;
  pixels[offset] = Math.round(r * alpha + pixels[offset] * (1 - alpha));
  pixels[offset + 1] = Math.round(g * alpha + pixels[offset + 1] * (1 - alpha));
  pixels[offset + 2] = Math.round(b * alpha + pixels[offset + 2] * (1 - alpha));
  pixels[offset + 3] = Math.min(255, Math.round(a + pixels[offset + 3] * (1 - alpha)));
}

function setPixel(x, y, color) {
  blendPixel(x, y, color[0], color[1], color[2], color[3] ?? 255);
}

function tokenizePath(pathData) {
  return pathData.match(/[a-zA-Z]|[-+]?(?:\d*\.)?\d+(?:e[-+]?\d+)?/gi) ?? [];
}

function parseOraclePath(pathData) {
  const tokens = tokenizePath(pathData);
  const commands = [];
  let index = 0;
  let command = "";
  let current = { x: 0, y: 0 };

  function isCommand(token) {
    return /^[a-zA-Z]$/.test(token);
  }

  function number() {
    return Number(tokens[index++]);
  }

  while (index < tokens.length) {
    if (isCommand(tokens[index])) {
      command = tokens[index++];
    }

    if (command === "M") {
      current = { x: number(), y: number() };
      commands.push({ type: "M", ...current });
      command = "L";
    } else if (command === "L") {
      current = { x: number(), y: number() };
      commands.push({ type: "L", ...current });
    } else if (command === "C") {
      const c1 = { x: number(), y: number() };
      const c2 = { x: number(), y: number() };
      current = { x: number(), y: number() };
      commands.push({ type: "C", c1, c2, ...current });
    } else if (command === "Z" || command === "z") {
      commands.push({ type: "Z" });
      command = "";
    } else {
      throw new Error(`Unsupported SVG command: ${command}`);
    }
  }

  return commands;
}

function cubicPoint(p0, p1, p2, p3, t) {
  const mt = 1 - t;
  return {
    x: mt ** 3 * p0.x + 3 * mt ** 2 * t * p1.x + 3 * mt * t ** 2 * p2.x + t ** 3 * p3.x,
    y: mt ** 3 * p0.y + 3 * mt ** 2 * t * p1.y + 3 * mt * t ** 2 * p2.y + t ** 3 * p3.y
  };
}

function flattenPath(commands) {
  const polygons = [];
  let polygon = [];
  let current = { x: 0, y: 0 };
  let start = { x: 0, y: 0 };

  for (const command of commands) {
    if (command.type === "M") {
      if (polygon.length) polygons.push(polygon);
      current = { x: command.x, y: command.y };
      start = current;
      polygon = [current];
    } else if (command.type === "L") {
      current = { x: command.x, y: command.y };
      polygon.push(current);
    } else if (command.type === "C") {
      const from = current;
      for (let step = 1; step <= 20; step += 1) {
        polygon.push(cubicPoint(from, command.c1, command.c2, { x: command.x, y: command.y }, step / 20));
      }
      current = { x: command.x, y: command.y };
    } else if (command.type === "Z") {
      polygon.push(start);
      polygons.push(polygon);
      polygon = [];
    }
  }

  if (polygon.length) polygons.push(polygon);
  return polygons;
}

function pointInPolygon(point, polygon) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const xi = polygon[i].x;
    const yi = polygon[i].y;
    const xj = polygon[j].x;
    const yj = polygon[j].y;
    const intersects =
      yi > point.y !== yj > point.y &&
      point.x < ((xj - xi) * (point.y - yi)) / (yj - yi || 1e-9) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

const oraclePolygons = flattenPath(parseOraclePath(oraclePath));

function oracleContains(x, y) {
  let inside = false;
  for (const polygon of oraclePolygons) {
    if (pointInPolygon({ x, y }, polygon)) {
      inside = !inside;
    }
  }
  return inside;
}

function drawOracleLogo(frameIndex) {
  const frameX = frameIndex % 2;
  const frameY = Math.floor(frameIndex / 2);
  const ox = frameX * frameSize;
  const oy = frameY * frameSize;
  const color = frameColors[frameIndex];

  const scaleX = 1.13;
  const scaleY = 1.45;
  const offsetX = 2.4;
  const offsetY = 0.6;

  for (let y = 0; y < frameSize; y += 1) {
    for (let x = 0; x < frameSize; x += 1) {
      const svgX = (x + 0.5 - offsetX) / scaleX;
      const svgY = (y + 0.5 - offsetY) / scaleY;
      if (oracleContains(svgX, svgY)) {
        setPixel(ox + x, oy + y, color);
      }
    }
  }
}

for (let frameIndex = 0; frameIndex < 4; frameIndex += 1) {
  drawOracleLogo(frameIndex);
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuffer = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])));
  return Buffer.concat([length, typeBuffer, data, crc]);
}

const scanlines = Buffer.alloc((width * 4 + 1) * height);
for (let y = 0; y < height; y += 1) {
  scanlines[y * (width * 4 + 1)] = 0;
  pixels.copy(scanlines, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4);
}

const header = Buffer.alloc(13);
header.writeUInt32BE(width, 0);
header.writeUInt32BE(height, 4);
header[8] = 8;
header[9] = 6;
header[10] = 0;
header[11] = 0;
header[12] = 0;

const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk("IHDR", header),
  chunk("IDAT", deflateSync(scanlines)),
  chunk("IEND", Buffer.alloc(0))
]);

await writeFile("assets/sprites/power-up.png", png);
