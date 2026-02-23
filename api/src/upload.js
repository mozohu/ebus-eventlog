/**
 * Product image upload endpoint
 * POST /upload/product-image
 * multipart/form-data with field "file"
 * Returns { url: "https://..." }
 */
import http from 'http'
import crypto from 'crypto'
import path from 'path'

const MINIO_HOST = process.env.MINIO_HOST || 'minio-minio-1'
const MINIO_PORT = process.env.MINIO_PORT || '9000'
const MINIO_ACCESS_KEY = process.env.MINIO_ACCESS_KEY || 'mozo'
const MINIO_SECRET_KEY = process.env.MINIO_SECRET_KEY || 'Fuesrumb2go'
const MINIO_BUCKET = process.env.MINIO_BUCKET || 'products'
const MINIO_PUBLIC_URL = process.env.MINIO_PUBLIC_URL || 'https://honeypie.zgovend.com:8443/s3'

// Simple multipart parser (single file)
function parseMultipart(buf, boundary) {
  const sep = Buffer.from('--' + boundary)
  const parts = []
  let start = 0
  while (true) {
    const idx = buf.indexOf(sep, start)
    if (idx === -1) break
    if (start > 0) {
      // Remove trailing \r\n before boundary
      let end = idx - 2
      if (end < start) end = start
      parts.push(buf.subarray(start, end))
    }
    start = idx + sep.length
    // skip \r\n or --
    if (buf[start] === 0x2d && buf[start + 1] === 0x2d) break
    if (buf[start] === 0x0d) start += 2
  }

  for (const part of parts) {
    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd === -1) continue
    const headers = part.subarray(0, headerEnd).toString()
    const body = part.subarray(headerEnd + 4)
    const nameMatch = headers.match(/name="([^"]+)"/)
    const filenameMatch = headers.match(/filename="([^"]+)"/)
    const ctMatch = headers.match(/Content-Type:\s*(.+)/i)
    if (nameMatch && filenameMatch) {
      return {
        fieldName: nameMatch[1],
        filename: filenameMatch[1],
        contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
        data: body,
      }
    }
  }
  return null
}

// S3v4 signing
function signV4(method, objectPath, headers, payload, accessKey, secretKey, region = 'us-east-1') {
  const now = new Date()
  const dateStamp = now.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z'
  const shortDate = dateStamp.substring(0, 8)
  const scope = `${shortDate}/${region}/s3/aws4_request`

  const signedHeaderKeys = Object.keys(headers).map(k => k.toLowerCase()).sort()
  const signedHeaders = signedHeaderKeys.join(';')
  const canonicalHeaders = signedHeaderKeys.map(k => `${k}:${headers[Object.keys(headers).find(h => h.toLowerCase() === k)]}\n`).join('')

  const payloadHash = crypto.createHash('sha256').update(payload).digest('hex')
  const canonicalRequest = [method, objectPath, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const stringToSign = ['AWS4-HMAC-SHA256', dateStamp, scope, crypto.createHash('sha256').update(canonicalRequest).digest('hex')].join('\n')

  function hmac(key, data) { return crypto.createHmac('sha256', key).update(data).digest() }
  const kDate = hmac('AWS4' + secretKey, shortDate)
  const kRegion = hmac(kDate, region)
  const kService = hmac(kRegion, 's3')
  const kSigning = hmac(kService, 'aws4_request')
  const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex')

  return {
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    'x-amz-date': dateStamp,
    'x-amz-content-sha256': payloadHash,
  }
}

function putToMinio(objectKey, data, contentType) {
  return new Promise((resolve, reject) => {
    const objectPath = `/${MINIO_BUCKET}/${objectKey}`
    const headers = {
      'Host': `${MINIO_HOST}:${MINIO_PORT}`,
      'Content-Type': contentType,
      'Content-Length': String(data.length),
    }
    const authHeaders = signV4('PUT', objectPath, headers, data, MINIO_ACCESS_KEY, MINIO_SECRET_KEY)
    Object.assign(headers, authHeaders)

    const req = http.request({
      hostname: MINIO_HOST,
      port: parseInt(MINIO_PORT),
      path: objectPath,
      method: 'PUT',
      headers,
    }, (res) => {
      let body = ''
      res.on('data', c => body += c)
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve()
        else reject(new Error(`MinIO PUT ${res.statusCode}: ${body}`))
      })
    })
    req.on('error', reject)
    req.end(data)
  })
}

/**
 * Handle upload request on a raw Node http.IncomingMessage
 */
export async function handleUpload(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

  if (req.method !== 'POST') {
    res.writeHead(405, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Method not allowed' }))
    return
  }

  const ct = req.headers['content-type'] || ''
  const boundaryMatch = ct.match(/boundary=(.+)/)
  if (!boundaryMatch) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Missing multipart boundary' }))
    return
  }

  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  const buf = Buffer.concat(chunks)

  const file = parseMultipart(buf, boundaryMatch[1])
  if (!file) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'No file found in request' }))
    return
  }

  // Max 2MB
  if (file.data.length > 2 * 1024 * 1024) {
    res.writeHead(413, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'File too large (max 2MB)' }))
    return
  }

  const ext = path.extname(file.filename).toLowerCase() || '.jpg'
  const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp']
  if (!allowed.includes(ext)) {
    res.writeHead(400, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Invalid file type' }))
    return
  }

  const objectKey = `images/${crypto.randomUUID()}${ext}`

  try {
    await putToMinio(objectKey, file.data, file.contentType)
    const publicUrl = MINIO_PUBLIC_URL
      ? `${MINIO_PUBLIC_URL}/${MINIO_BUCKET}/${objectKey}`
      : `http://${MINIO_HOST}:${MINIO_PORT}/${MINIO_BUCKET}/${objectKey}`

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ url: publicUrl, key: objectKey }))
  } catch (e) {
    console.error('Upload error:', e)
    res.writeHead(500, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'Upload failed: ' + e.message }))
  }
}
