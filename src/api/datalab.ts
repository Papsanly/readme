/**
 * datalab.to Marker API client.
 *
 * Used by the Original View feature to obtain page-level block layout
 * (polygon, bounding box, label, raw text) for the original PDF, so the
 * reader can display polygon overlays aligned with the VLM-extracted
 * narration blocks.
 *
 * Flow:
 *   1. POST `/api/v1/marker` with the PDF — returns a `request_check_url`.
 *   2. Poll that URL until `status === 'complete'`. Backoff + max-attempts.
 *   3. Walk the returned block tree (Document → Pages → Blocks) and emit
 *      a flat list of `RawOcrBlock` with `pageIndex`, polygon, bbox, label,
 *      and text. Coordinates are in pixel space of the rasterization
 *      datalab performed (each page's polygon doubles as page dims).
 */

import { File } from 'expo-file-system';

const DEFAULT_BASE_URL = 'https://www.datalab.to';
const MARKER_PATH = '/api/v1/marker';
// Submitting a 14MB PDF over a slow connection can take a couple of minutes;
// 5 min keeps a generous ceiling so the upload itself doesn't get aborted
// while the underlying network is still streaming bytes.
const DEFAULT_REQUEST_TIMEOUT_MS = 300_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;
const DEFAULT_MAX_POLLS = 300;
const ERROR_BODY_TRUNCATION = 1_000;

export class MissingDatalabKeyError extends Error {
  constructor(message = 'EXPO_PUBLIC_DATALAB_API_KEY is not set') {
    super(message);
    this.name = 'MissingDatalabKeyError';
  }
}

export class DatalabError extends Error {
  readonly cause?: unknown;
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'DatalabError';
    this.cause = cause;
  }
}

/** A flat ocr block extracted from one page of the marker tree. */
export type RawOcrBlock = {
  /** 1-based page number. */
  pageIndex: number;
  /** Datalab block label, e.g. "Text", "SectionHeader", "Picture", "PageHeader". */
  label: string;
  /** Plain-text content (HTML stripped). May be empty for pictures. */
  text: string;
  /** Polygon (4+ points) in pixel coordinates of the rasterized page. */
  polygon: [number, number][];
  /** Axis-aligned bbox `[x1, y1, x2, y2]` in same pixel space as polygon. */
  bbox: [number, number, number, number];
};

/** Per-page rasterization dimensions reported by datalab (pixels). */
export type RawOcrPage = {
  pageIndex: number;
  width: number;
  height: number;
  blocks: RawOcrBlock[];
};

export type RawOcrResult = {
  pages: RawOcrPage[];
};

export type DatalabClientOptions = {
  apiKey?: string;
  baseUrl?: string;
  /** Per-HTTP-request timeout (does NOT include polling wait). */
  requestTimeoutMs?: number;
  /** Polling interval in ms between status checks. */
  pollIntervalMs?: number;
  /** Max polls before giving up. */
  maxPolls?: number;
};

export type RunMarkerOptions = {
  pdfUri: string;
  signal?: AbortSignal;
  /** Called once per poll with the elapsed-poll count for progress UI. */
  onPoll?: (pollCount: number, maxPolls: number) => void;
};

export type RunMarkerForPageOptions = {
  /** Pre-rasterized PNG of the page (typically `paths.bookPage(bookId, N)`). */
  pageImageUri: string;
  /** 1-based page number — used only to label the result. */
  pageNumber: number;
  signal?: AbortSignal;
  onPoll?: (pollCount: number, maxPolls: number) => void;
};

function readEnvKey(): string | undefined {
  const v = process.env.EXPO_PUBLIC_DATALAB_API_KEY;
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max)}…(${s.length - max} more chars)`;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}

function mimeForExt(ext: string): string {
  switch (ext) {
    case 'pdf':
      return 'application/pdf';
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    default:
      return 'application/octet-stream';
  }
}

function stripHtml(html: string): string {
  // Drop tags, decode common entities, collapse whitespace.
  const noTags = html.replace(/<[^>]*>/g, ' ');
  const decoded = noTags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return decoded.replace(/\s+/g, ' ').trim();
}

function coercePolygon(raw: unknown): [number, number][] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: [number, number][] = [];
  for (const pt of raw) {
    if (
      Array.isArray(pt) &&
      pt.length >= 2 &&
      typeof pt[0] === 'number' &&
      typeof pt[1] === 'number'
    ) {
      out.push([pt[0], pt[1]]);
    }
  }
  return out.length >= 3 ? out : undefined;
}

function coerceBbox(raw: unknown): [number, number, number, number] | undefined {
  if (
    Array.isArray(raw) &&
    raw.length >= 4 &&
    typeof raw[0] === 'number' &&
    typeof raw[1] === 'number' &&
    typeof raw[2] === 'number' &&
    typeof raw[3] === 'number'
  ) {
    return [raw[0], raw[1], raw[2], raw[3]];
  }
  return undefined;
}

function bboxFromPolygon(poly: [number, number][]): [number, number, number, number] {
  let minX = Infinity,
    minY = Infinity,
    maxX = -Infinity,
    maxY = -Infinity;
  for (const [x, y] of poly) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

function extractText(node: Record<string, unknown>): string {
  // Prefer `html` (marker emits this for text blocks); fall back to `text` /
  // recursively concatenate children.
  const html = node.html;
  if (typeof html === 'string' && html.length > 0) return stripHtml(html);
  const text = node.text;
  if (typeof text === 'string' && text.length > 0) return text.trim();
  const children = node.children;
  if (Array.isArray(children)) {
    const parts: string[] = [];
    for (const child of children) {
      if (isObject(child)) {
        const t = extractText(child);
        if (t) parts.push(t);
      }
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  return '';
}

/**
 * Walk a marker block tree node, collecting leaf-ish blocks (with polygon)
 * for the given page index.
 *
 * Strategy: prefer fine-grained children when they carry polygons, but if
 * recursion produces NOTHING (children are empty / pictures with no
 * grandchildren that emit), fall back to emitting the parent — so we never
 * lose a region just because marker decorated it as e.g. a Picture group.
 * This catches stylized layouts (yellow tag headings, decorated badges)
 * where the parent is the only useful overlay.
 */
function walkPageBlocks(node: unknown, pageIndex: number, out: RawOcrBlock[]): void {
  if (!isObject(node)) return;
  const label = typeof node.block_type === 'string' ? node.block_type : '';
  const polygon = coercePolygon(node.polygon);
  const children = Array.isArray(node.children) ? node.children : [];

  let hasSpatialChildren = false;
  for (const child of children) {
    if (isObject(child) && coercePolygon(child.polygon)) {
      hasSpatialChildren = true;
      break;
    }
  }

  if (hasSpatialChildren) {
    const before = out.length;
    for (const child of children) walkPageBlocks(child, pageIndex, out);
    if (out.length > before) return; // children emitted; nothing left to do
    // Fallthrough: recursion produced nothing → emit this node so the region
    // doesn't go silently missing from the overlay.
  }

  if (polygon) {
    const bbox = coerceBbox(node.bbox) ?? bboxFromPolygon(polygon);
    out.push({
      pageIndex,
      label: label || 'Unknown',
      text: extractText(node),
      polygon,
      bbox
    });
  }
}

function parseMarkerJson(rawJson: unknown): RawOcrResult {
  if (!isObject(rawJson)) {
    throw new DatalabError('Marker response is not an object');
  }
  // Accept either the document tree at the top level, or under `json`/`document`.
  let root: unknown = rawJson;
  if (isObject(rawJson.json)) root = rawJson.json;
  else if (isObject(rawJson.document)) root = rawJson.document;

  if (!isObject(root)) {
    throw new DatalabError('Marker response: could not locate document root');
  }

  // Find pages: either children of a Document node, or a `pages` array.
  const pageNodes: unknown[] = [];
  if (Array.isArray(root.children)) {
    for (const child of root.children) {
      if (isObject(child) && child.block_type === 'Page') pageNodes.push(child);
    }
  }
  if (pageNodes.length === 0 && Array.isArray(root.pages)) {
    for (const p of root.pages) pageNodes.push(p);
  }
  // Last-resort: if the root itself is a Page.
  if (pageNodes.length === 0 && root.block_type === 'Page') pageNodes.push(root);

  if (pageNodes.length === 0) {
    throw new DatalabError('Marker response contains no Page nodes');
  }

  const pages: RawOcrPage[] = [];
  for (let i = 0; i < pageNodes.length; i += 1) {
    const node = pageNodes[i];
    if (!isObject(node)) continue;
    const pageIndex = typeof node.page === 'number' ? node.page : i + 1;
    const polygon = coercePolygon(node.polygon);
    const bbox = polygon ? bboxFromPolygon(polygon) : coerceBbox(node.bbox);
    const width = bbox ? bbox[2] - bbox[0] : 0;
    const height = bbox ? bbox[3] - bbox[1] : 0;

    const blocks: RawOcrBlock[] = [];
    if (Array.isArray(node.children)) {
      for (const child of node.children) walkPageBlocks(child, pageIndex, blocks);
    }

    pages.push({ pageIndex, width, height, blocks });
  }

  pages.sort((a, b) => a.pageIndex - b.pageIndex);
  return { pages };
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  externalSignal?: AbortSignal
): Promise<Response> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  let externalHandler: (() => void) | undefined;
  if (externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else {
      externalHandler = () => controller.abort();
      externalSignal.addEventListener('abort', externalHandler, { once: true });
    }
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    if (timedOut) {
      throw new DatalabError(`Request timed out after ${timeoutMs}ms (url=${url})`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
    if (externalSignal && externalHandler) {
      externalSignal.removeEventListener('abort', externalHandler);
    }
  }
}

async function sleepCancellable(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  return new Promise<void>((resolve, reject) => {
    let abortHandler: (() => void) | undefined;
    const timer = setTimeout(() => {
      if (abortHandler && signal) signal.removeEventListener('abort', abortHandler);
      resolve();
    }, ms);
    if (signal) {
      abortHandler = () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal.addEventListener('abort', abortHandler, { once: true });
    }
  });
}

export class DatalabClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly requestTimeoutMs: number;
  private readonly pollIntervalMs: number;
  private readonly maxPolls: number;

  constructor(options: DatalabClientOptions = {}) {
    const apiKey = options.apiKey ?? readEnvKey();
    if (!apiKey) throw new MissingDatalabKeyError();
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    this.maxPolls = options.maxPolls ?? DEFAULT_MAX_POLLS;
  }

  /**
   * Submit a PDF to the marker endpoint and poll until complete. Returns
   * the parsed flat block list per page.
   */
  async runMarker(opts: RunMarkerOptions): Promise<RawOcrResult> {
    const { pdfUri, signal, onPoll } = opts;
    const file = new File(pdfUri);
    if (!file.exists) throw new DatalabError(`PDF not found at ${pdfUri}`);

    const submitJson = await this.submitMarker(pdfUri, undefined, signal);
    return this.pollUntilComplete(submitJson, signal, onPoll);
  }

  /**
   * Submit a single rasterized page PNG to the marker endpoint and return its
   * layout. Used by the on-demand Original View loader: each page is uploaded
   * separately (~500KB instead of the full PDF) so requests are fast and
   * cheap, and so RN's FormData large-file edge cases don't bite us.
   */
  async runMarkerForPage(opts: RunMarkerForPageOptions): Promise<RawOcrPage> {
    const { pageImageUri, pageNumber, signal, onPoll } = opts;
    const file = new File(pageImageUri);
    if (!file.exists) throw new DatalabError(`Page image not found at ${pageImageUri}`);
    if (!Number.isInteger(pageNumber) || pageNumber < 1) {
      throw new DatalabError(`Invalid pageNumber: ${pageNumber}`);
    }

    const submitJson = await this.submitMarker(pageImageUri, undefined, signal);
    const result = await this.pollUntilComplete(submitJson, signal, onPoll);

    const page = result.pages[0];
    if (!page) {
      throw new DatalabError(`Marker returned no pages for page ${pageNumber}`);
    }
    // Force the page index to what the caller asked for so downstream code
    // can look up by 1-based number.
    return { ...page, pageIndex: pageNumber };
  }

  private async pollUntilComplete(
    submitJson: { request_check_url?: string },
    signal: AbortSignal | undefined,
    onPoll: ((p: number, m: number) => void) | undefined
  ): Promise<RawOcrResult> {
    const checkUrl = submitJson.request_check_url;
    if (!checkUrl) {
      throw new DatalabError(
        `Marker submit missing request_check_url. Body: ${truncate(JSON.stringify(submitJson), ERROR_BODY_TRUNCATION)}`
      );
    }

    for (let attempt = 1; attempt <= this.maxPolls; attempt += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      onPoll?.(attempt, this.maxPolls);
      await sleepCancellable(this.pollIntervalMs, signal);

      const status = await this.checkStatus(checkUrl, signal);
      if (status.status === 'complete') {
        if (status.success === false) {
          const err = typeof status.error === 'string' ? status.error : 'Marker job failed';
          throw new DatalabError(`Marker error: ${err}`);
        }
        return parseMarkerJson(status);
      }
      // Otherwise keep polling.
    }
    throw new DatalabError(`Marker did not complete within ${this.maxPolls} polls`);
  }

  private async submitMarker(
    fileUri: string,
    pageRange: string | undefined,
    signal?: AbortSignal
  ): Promise<{ request_check_url?: string; request_id?: string; success?: boolean }> {
    const file = new File(fileUri);
    const sizeBytes = file.size ?? 0;
    const ext = (fileUri.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? 'bin').toLowerCase();
    const mime = mimeForExt(ext);
    console.log(
      `[datalab] submit marker prep: file=${fileUri} size=${sizeBytes}b mime=${mime} pageRange=${pageRange ?? 'all'} keyLen=${this.apiKey.length}`
    );

    const form = new FormData();
    // React Native FormData accepts the `{ uri, name, type }` shape for files.
    form.append('file', {
      uri: fileUri,
      name: `source.${ext}`,
      type: mime
    } as unknown as Blob);
    form.append('output_format', 'json');
    form.append('use_llm', 'false');
    // Force OCR even when marker thinks the input has embedded text. For
    // stylized infographic layouts, embedded-text extraction often misses
    // decorated badges and tag headers; full OCR catches them.
    form.append('force_ocr', 'true');
    form.append('strip_existing_ocr', 'false');
    form.append('paginate', 'true');
    if (pageRange) form.append('page_range', pageRange);

    const url = `${this.baseUrl}${MARKER_PATH}`;
    const startMs = Date.now();
    console.log(`[datalab] submit fetch start url=${url}`);
    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'X-Api-Key': this.apiKey },
        body: form
      },
      this.requestTimeoutMs,
      signal
    );
    const body = await res.text();
    console.log(
      `[datalab] submit response: http=${res.status} elapsed=${Date.now() - startMs}ms bodyLen=${body.length} bodyPreview=${truncate(body, 200)}`
    );
    if (!res.ok) {
      throw new DatalabError(
        `HTTP ${res.status} from marker submit: ${truncate(body, ERROR_BODY_TRUNCATION)}`
      );
    }
    try {
      const parsed = JSON.parse(body);
      console.log(
        `[datalab] submit parsed: success=${parsed.success} hasCheckUrl=${!!parsed.request_check_url} requestId=${parsed.request_id ?? '?'}`
      );
      return parsed;
    } catch (err) {
      throw new DatalabError(
        `Marker submit returned non-JSON: ${truncate(body, ERROR_BODY_TRUNCATION)}`,
        err
      );
    }
  }

  private async checkStatus(
    checkUrl: string,
    signal?: AbortSignal
  ): Promise<Record<string, unknown>> {
    const res = await fetchWithTimeout(
      checkUrl,
      { method: 'GET', headers: { 'X-Api-Key': this.apiKey } },
      this.requestTimeoutMs,
      signal
    );
    const body = await res.text();
    if (!res.ok) {
      throw new DatalabError(
        `HTTP ${res.status} from marker check: ${truncate(body, ERROR_BODY_TRUNCATION)}`
      );
    }
    try {
      const parsed = JSON.parse(body) as Record<string, unknown>;
      // Log only when status is interesting (not an in-progress poll).
      if (parsed.status === 'complete') {
        console.log(
          `[datalab] check complete: keys=[${Object.keys(parsed).join(',')}] success=${parsed.success}`
        );
      }
      return parsed;
    } catch (err) {
      throw new DatalabError(
        `Marker check returned non-JSON: ${truncate(body, ERROR_BODY_TRUNCATION)}`,
        err
      );
    }
  }
}

let cachedDefaultClient: DatalabClient | undefined;

export function getDefaultDatalabClient(): DatalabClient {
  if (!cachedDefaultClient) cachedDefaultClient = new DatalabClient();
  return cachedDefaultClient;
}
