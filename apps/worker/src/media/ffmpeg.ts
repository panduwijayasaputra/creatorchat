import { execFile } from 'node:child_process';

const TIMEOUT_MS = 120_000;

export interface FfmpegPaths {
  ffmpeg: string;
  ffprobe: string;
}

export interface VideoFacts {
  /** ffprobe's container list, e.g. `mov,mp4,m4a,3gp,3g2,mj2`. */
  formatName: string;
  durationSeconds: number | null;
  video: { codec: string; width: number; height: number; rotation: number } | null;
}

/** Runs a binary with an argument array (never a shell string) and a hard timeout. */
function run(file: string, args: string[], maxBuffer = 10 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: TIMEOUT_MS, maxBuffer }, (error, stdout) => {
      if (error) reject(new Error(`${file} failed`));
      else resolve(stdout);
    });
  });
}

/** True when ffprobe answers `-version`; the media processor is only registered then. */
export async function ffprobeAvailable(paths: FfmpegPaths): Promise<boolean> {
  try {
    await run(paths.ffprobe, ['-version']);
    return true;
  } catch {
    return false;
  }
}

interface ProbeJson {
  format?: { format_name?: string; duration?: string };
  streams?: {
    codec_type?: string;
    codec_name?: string;
    width?: number;
    height?: number;
    tags?: { rotate?: string };
    side_data_list?: { rotation?: number }[];
  }[];
}

export async function probe(paths: FfmpegPaths, file: string): Promise<VideoFacts> {
  const json = JSON.parse(
    await run(paths.ffprobe, [
      '-v',
      'error',
      '-print_format',
      'json',
      '-show_format',
      '-show_streams',
      file,
    ]),
  ) as ProbeJson;
  const stream = json.streams?.find((s) => s.codec_type === 'video');
  const duration = Number(json.format?.duration);
  const rotation = Math.abs(
    Number(
      stream?.side_data_list?.find((d) => d.rotation !== undefined)?.rotation ??
        stream?.tags?.rotate ??
        0,
    ),
  );
  return {
    formatName: json.format?.format_name ?? '',
    durationSeconds: Number.isFinite(duration) && duration > 0 ? duration : null,
    video:
      stream?.codec_name && stream.width && stream.height
        ? { codec: stream.codec_name, width: stream.width, height: stream.height, rotation }
        : null,
  };
}

/**
 * Copies the streams without re-encoding and drops every metadata tag (this is where a phone's GPS
 * position lives), chapters and data tracks. Only the first video stream and audio are kept.
 */
export async function remux(
  paths: FfmpegPaths,
  input: string,
  output: string,
  container: 'mp4' | 'mov',
  hevc: boolean,
): Promise<void> {
  await run(paths.ffmpeg, [
    '-nostdin',
    '-y',
    '-v',
    'error',
    '-i',
    input,
    '-map',
    '0:v:0',
    '-map',
    '0:a?',
    '-map_metadata',
    '-1',
    '-map_chapters',
    '-1',
    '-c',
    'copy',
    ...(hevc && container === 'mp4' ? ['-tag:v', 'hvc1'] : []),
    '-movflags',
    '+faststart',
    '-f',
    container,
    output,
  ]);
}

/** One frame as a JPEG, taken at `atSeconds`. */
export async function poster(
  paths: FfmpegPaths,
  input: string,
  output: string,
  atSeconds: number,
): Promise<void> {
  await run(paths.ffmpeg, [
    '-nostdin',
    '-y',
    '-v',
    'error',
    '-ss',
    String(atSeconds),
    '-i',
    input,
    '-frames:v',
    '1',
    output,
  ]);
}
