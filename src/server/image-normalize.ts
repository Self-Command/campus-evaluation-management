import sharp from "sharp";

// Ghost 在 image-transform 包中的做法：关闭缓存并限制并发，控制小内存服务器上
// libvips 的常驻内存与并发解码开销。
sharp.cache(false);
sharp.concurrency(1);

const MAX_EDGE = 1920;
const BYTES_THRESHOLD = 300 * 1024;
const QUALITY = 80;
const PROCESS_TIMEOUT_SECONDS = 10;

// svg/gif/ico 不重编码：svg 无尺寸收益，gif/动图会丢动画（同 Ghost shouldResizeFileExtension 的取舍）。
const NORMALIZABLE_MIME = new Set(["image/jpeg", "image/png", "image/webp", "image/avif", "image/tiff"]);

export type NormalizedImage = {
	bytes: Buffer;
	mime: string;
	normalized: boolean;
	originalMime: string;
	originalSize: number;
};

export async function normalizeUploadedImage(bytes: Buffer, mime: string): Promise<NormalizedImage> {
	if (!NORMALIZABLE_MIME.has(mime)) {
		return { bytes, mime, normalized: false, originalMime: mime, originalSize: bytes.length };
	}
	try {
		const metadata = await sharp(bytes).metadata();
		if ((metadata.pages ?? 1) > 1 || !metadata.width || !metadata.height) {
			return { bytes, mime, normalized: false, originalMime: mime, originalSize: bytes.length };
		}
		const oversized = metadata.width > MAX_EDGE || metadata.height > MAX_EDGE;
		if (!oversized && bytes.length <= BYTES_THRESHOLD) {
			return { bytes, mime, normalized: false, originalMime: mime, originalSize: bytes.length };
		}
		const output = await sharp(bytes)
			.rotate()
			.resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
			.webp({ quality: QUALITY })
			.timeout({ seconds: PROCESS_TIMEOUT_SECONDS })
			.toBuffer();
		if (output.length >= bytes.length) {
			return { bytes, mime, normalized: false, originalMime: mime, originalSize: bytes.length };
		}
		return { bytes: output, mime: "image/webp", normalized: true, originalMime: mime, originalSize: bytes.length };
	} catch {
		// 无法解码的图片不阻塞上传：identify 已校验魔数，保留原始字节。
		return { bytes, mime, normalized: false, originalMime: mime, originalSize: bytes.length };
	}
}
