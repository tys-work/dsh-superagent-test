#!/usr/bin/env node
/**
 * scan-videos.mjs
 *
 * 递归扫描目录中的视频文件，用 ffprobe 读取时长、分辨率、视频编码和码率，
 * 导出 UTF-8（无 BOM）CSV。零 npm 依赖，只使用 Node 内置模块。
 * 需要 Node.js 18.3+ 与系统已安装的 ffprobe（FFmpeg）。
 *
 * 用法:
 *   node scan-videos.mjs <目录> [--out out.csv]
 */

import { execFile } from 'node:child_process';
import { readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { parseArgs, promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const VIDEO_EXTENSIONS = new Set(['.mp4', '.mkv', '.mov']);
const CSV_HEADER = ['file', 'duration_s', 'width', 'height', 'codec', 'bitrate_kbps'];
const DEFAULT_OUTPUT = 'videos.csv';

const USAGE = `用法: node scan-videos.mjs <目录> [--out out.csv]

递归扫描 <目录> 中的 .mp4/.mkv/.mov 文件，用 ffprobe 读取视频信息并导出 CSV。

选项:
  --out <文件>  CSV 输出路径（默认: ./${DEFAULT_OUTPUT}）
  -h, --help    显示本帮助
`;

function fatal(message) {
  process.stderr.write(`错误: ${message}\n`);
  process.exit(1);
}

function parseArguments(argv) {
  try {
    return parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        out: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
  } catch (error) {
    return fatal(`参数错误: ${error.message}\n\n${USAGE}`);
  }
}

/**
 * 递归收集目录下的视频文件。子目录读取失败时记录警告并继续，
 * 根目录读取失败则向上抛出。
 */
async function findVideoFiles(directory, { ignoreReadErrors = false } = {}, warnings = []) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (!ignoreReadErrors) throw error;
    warnings.push({ directory, message: error.message });
    return [];
  }

  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findVideoFiles(fullPath, { ignoreReadErrors: true }, warnings)));
    } else if (entry.isFile() && VIDEO_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }
  return files;
}

function toFiniteNumber(value) {
  if (value === undefined || value === null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function roundTo(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function describeProbeError(error) {
  if (error?.code === 'ENOENT') return '找不到 ffprobe 命令';
  if (typeof error?.stderr === 'string') {
    const lines = error.stderr.trim().split(/\r?\n/).filter(Boolean);
    if (lines.length > 0) return lines[lines.length - 1];
  }
  return error?.message ?? 'ffprobe 执行失败';
}

async function ensureFfprobeAvailable() {
  try {
    await execFileAsync('ffprobe', ['-version']);
  } catch (error) {
    fatal(`无法运行 ffprobe（${describeProbeError(error)}），请先安装 FFmpeg`);
  }
}

/** 用 ffprobe 读取单个视频文件的元数据；失败时抛出带可读原因的错误。 */
async function probeVideo(filePath) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync(
      'ffprobe',
      [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=codec_name,width,height,bit_rate:format=duration,bit_rate',
        '-of', 'json',
        filePath,
      ],
      { maxBuffer: 10 * 1024 * 1024 },
    ));
  } catch (error) {
    throw new Error(describeProbeError(error));
  }

  let data;
  try {
    data = JSON.parse(stdout);
  } catch {
    throw new Error('ffprobe 返回了无效的 JSON');
  }

  const stream = data.streams?.[0];
  if (!stream) throw new Error('没有视频流');

  const duration = toFiniteNumber(data.format?.duration);
  const bitrate = toFiniteNumber(stream.bit_rate) ?? toFiniteNumber(data.format?.bit_rate);

  return {
    duration_s: duration === null ? '' : String(roundTo(duration, 3)),
    width: stream.width ?? '',
    height: stream.height ?? '',
    codec: stream.codec_name ?? '',
    bitrate_kbps: bitrate === null ? '' : String(Math.round(bitrate / 1000)),
  };
}

function escapeCsvField(value) {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function buildCsv(rows) {
  const lines = [CSV_HEADER.join(',')];
  for (const row of rows) {
    const fields = [
      row.file,
      row.duration_s,
      row.width,
      row.height,
      row.codec,
      row.bitrate_kbps,
    ];
    lines.push(fields.map(escapeCsvField).join(','));
  }
  return `${lines.join('\n')}\n`;
}

function toPosixPath(filePath) {
  return filePath.split(path.sep).join('/');
}

async function main() {
  const { values, positionals } = parseArguments(process.argv.slice(2));

  if (values.help) {
    process.stdout.write(USAGE);
    return;
  }
  if (positionals.length !== 1) {
    fatal(`需要且只需要一个目录参数\n\n${USAGE}`);
  }
  if (values.out === '') {
    fatal('--out 不能为空');
  }

  const rootDirectory = path.resolve(positionals[0]);
  const outputPath = path.resolve(values.out ?? DEFAULT_OUTPUT);

  let rootStat;
  try {
    rootStat = await stat(rootDirectory);
  } catch (error) {
    fatal(`无法访问目录 ${rootDirectory}: ${error.message}`);
  }
  if (!rootStat.isDirectory()) {
    fatal(`不是目录: ${rootDirectory}`);
  }

  await ensureFfprobeAvailable();

  const warnings = [];
  const files = await findVideoFiles(rootDirectory, {}, warnings);
  files.sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  for (const warning of warnings) {
    process.stderr.write(`[警告] 无法读取目录 ${warning.directory}: ${warning.message}\n`);
  }

  const rows = [];
  const failures = [];
  for (const file of files) {
    const relativePath = toPosixPath(path.relative(rootDirectory, file));
    try {
      const metadata = await probeVideo(file);
      rows.push({ file: relativePath, ...metadata });
    } catch (error) {
      failures.push({ file: relativePath, message: error.message });
      process.stderr.write(`[失败] ${relativePath}: ${error.message}\n`);
    }
  }

  try {
    await writeFile(outputPath, buildCsv(rows), 'utf8');
  } catch (error) {
    fatal(`无法写入 ${outputPath}: ${error.message}`);
  }

  process.stdout.write(`扫描完成：成功 ${rows.length} 个，失败 ${failures.length} 个\n`);
  process.stdout.write(`CSV 已写入: ${outputPath}\n`);
}

main().catch((error) => {
  fatal(error?.message ?? String(error));
});
