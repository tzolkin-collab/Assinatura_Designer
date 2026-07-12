import { FFmpeg } from '@ffmpeg/ffmpeg';
import { fetchFile } from '@ffmpeg/util';

let ffmpeg: FFmpeg | null = null;

export async function initFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg) return ffmpeg;

  ffmpeg = new FFmpeg();
  
  // Need to load core WASM files from CDN or local public folder. 
  // For prototypes, using the default unpkg CDN works best.
  await ffmpeg.load({
    coreURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js',
    wasmURL: 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm',
  });

  return ffmpeg;
}

/**
 * Converts a static image Data URL into a short 3-second MP4 video loop.
 * Demonstrates the WebAssembly FFMPEG integration (C2/C4).
 */
export async function createVideoFromImage(imageDataUrl: string): Promise<string> {
  const instance = await initFFmpeg();

  // Write the image file to FFMPEG's virtual filesystem
  await instance.writeFile('input.png', await fetchFile(imageDataUrl));

  // Run the FFMPEG command to loop the image for 3 seconds at 30fps
  // -loop 1: loop the single input
  // -t 3: duration 3 seconds
  // -pix_fmt yuv420p: ensures compatibility with most players
  await instance.exec([
    '-loop', '1',
    '-i', 'input.png',
    '-c:v', 'libx264',
    '-t', '3',
    '-pix_fmt', 'yuv420p',
    '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', // Ensure even dimensions for h264
    'output.mp4'
  ]);

  // Read the resulting file
  const data = await instance.readFile('output.mp4');

  // Limpa o FS virtual do ffmpeg — sem isto, input/output acumulam na memória
  // WASM a cada chamada.
  await instance.deleteFile('input.png').catch(() => {});
  await instance.deleteFile('output.mp4').catch(() => {});

  if (typeof data === 'string') {
    throw new Error('Falha ao gerar MP4');
  }
  const bytes = new Uint8Array(data);
  
  // Create a blob URL
  const blob = new Blob([bytes], { type: 'video/mp4' });
  const url = URL.createObjectURL(blob);
  
  return url;
}
