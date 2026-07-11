/**
 * 上游绑定二维码解析。
 *
 * 上游渠道的绑定二维码与路由自身扫码绑定的二维码同源，都是微信侧下发的
 * liteapp 配对 URL，形如：
 *   https://liteapp.weixin.qq.com/q/7GiQu1?qrcode=f92e403f6f78e775fe1d5990a5f84532&bot_type=3
 *
 * 其中：
 *   - `qrcode`  是配对 token，用于提交到微信 liteapp 协议完成上游绑定
 *   - `bot_type` 是机器人类型（路由自身为 3）
 *
 * 注意：@wechatbot/wechatbot SDK 仅暴露了路由自身的登录/扫码流程，
 * 没有暴露"用 token 绑定上游"的接口。本模块只负责把二维码解码并解析出
 * token / bot_type，真正的提交配对由调用方（或后续协议层）完成。
 */

/** 已知的微信 liteapp 二维码域名。 */
const LITEAPP_HOSTS = new Set([
  'liteapp.weixin.qq.com',
  'ilinkai.weixin.qq.com',
]);

export interface ParsedQr {
  /** 二维码原始文本（解码后的 URL 或字符串）。 */
  raw: string;
  /** 是否识别为已知的上游绑定二维码。 */
  recognized: boolean;
  /** 解析出的完整 URL（识别成功时）。 */
  url?: string;
  /** 配对 token（qrcode 参数）。 */
  qrcode?: string;
  /** 路径段，如 7GiQu1。 */
  pathSegment?: string;
  /** 机器人类型，默认 3。 */
  botType?: number;
  /** 所有查询参数（兜底用）。 */
  params?: Record<string, string>;
  /** 识别失败时的提示。 */
  error?: string;
}

/**
 * 解析一段文本（通常是二维码解码后的字符串），识别是否为上游绑定二维码。
 * 接受完整 URL，也接受裸 token（按 qrcode= 后面的值处理）。
 */
export function parseQrContent(input: string): ParsedQr {
  const raw = (input || '').trim();
  if (!raw) {
    return { raw, recognized: false, error: '内容为空' };
  }

  // 形如 f92e403f6f78e775fe1d5990a5f84532 —— 当作裸 token
  if (/^[a-f0-9]{16,64}$/i.test(raw)) {
    return {
      raw,
      recognized: true,
      qrcode: raw,
      botType: 3,
    };
  }

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    // 不是 URL 也不是裸 token —— 不认识，但把原文返回供调用方自行处理
    return {
      raw,
      recognized: false,
      error: '不是有效的 URL 或配对 token',
    };
  }

  const host = url.hostname.toLowerCase();
  const params: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    params[k] = v;
  });

  // 兼容：路径里也可能带 qrcode=（少数变体）
  const pathSegment = url.pathname.replace(/^\/q\//, '').replace(/^\/+|\/+$/g, '') || undefined;

  const qrcode = params.qrcode || undefined;
  const botTypeRaw = params.bot_type;
  const botType = botTypeRaw ? Number(botTypeRaw) : undefined;

  const recognized = LITEAPP_HOSTS.has(host) && !!qrcode;

  const result: ParsedQr = {
    raw,
    recognized,
    url: url.toString(),
    qrcode,
    pathSegment,
    botType: Number.isFinite(botType) ? botType : undefined,
    params,
  };
  if (!recognized) {
    result.error = !LITEAPP_HOSTS.has(host)
      ? `非 liteapp 域名: ${host}`
      : '缺少 qrcode 参数';
  }
  return result;
}

/**
 * 从一个 ImageBitmap / HTMLImageElement 解码二维码。
 * 浏览器端使用：把图片画到 canvas，取 ImageData，交给 jsQR 识别。
 *
 * 返回二维码文本，识别失败返回 null。
 */
export async function decodeImageToQrText(
  image: ImageBitmap | HTMLImageElement,
): Promise<string | null> {
  // 动态加载 jsQR，避免影响首屏包体
  const { default: jsQR } = await import('jsqr');

  const width = 'width' in image ? image.width : 0;
  const height = 'height' in image ? image.height : 0;
  if (!width || !height) return null;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image as CanvasImageSource, 0, 0, width, height);
  const imageData = ctx.getImageData(0, 0, width, height);

  const code = jsQR(imageData.data, width, height, {
    inversionAttempts: 'attemptBoth',
  });
  return code?.data ?? null;
}
