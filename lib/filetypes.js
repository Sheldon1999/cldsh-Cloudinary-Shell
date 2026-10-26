// Cloudinary resource type for a local file, by extension.
// Images include PDF, SVG and the other formats Cloudinary stores as `image`; audio is stored as
// `video`; everything else is `raw`.
import path from 'node:path';

const IMAGE_EXTENSIONS = new Set([
  'jpg', 'jpeg', 'jpe', 'jfif', 'png', 'gif', 'webp', 'avif', 'heic', 'heif', 'tif', 'tiff', 'bmp', 'ico',
  'svg', 'pdf', 'psd', 'ai', 'eps', 'jp2', 'jxl', 'jxr', 'wdp', 'hdp', 'tga', 'arw', 'cr2', 'dng', 'djvu',
]);

const VIDEO_EXTENSIONS = new Set([
  // video
  'mp4', 'm4v', 'mov', 'webm', 'mkv', 'avi', 'flv', 'wmv', 'mpg', 'mpeg', '3gp', '3g2', 'ogv', 'ts', 'm2ts', 'mts', 'mxf',
  // audio (Cloudinary stores audio as resource type "video")
  'mp3', 'wav', 'ogg', 'oga', 'm4a', 'aac', 'flac', 'opus', 'wma', 'aif', 'aiff', 'amr', 'weba',
]);

/** Lower-case extension without the dot ('' when there is none). */
export function extensionOf(filePath) {
  return path.extname(String(filePath ?? '')).slice(1).toLowerCase();
}

/** @returns {'image' | 'video' | 'raw'} */
export function classifyFile(filePath) {
  const ext = extensionOf(filePath);
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  return 'raw';
}
