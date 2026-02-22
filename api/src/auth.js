import mongoose from 'mongoose'

const User = mongoose.models.User || mongoose.model('AuthUser', new mongoose.Schema({}, { collection: 'users', strict: false }))

// API Key model for IPC device authentication
const apiKeySchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  operatorId: { type: String, required: true },
  hid: { type: String, default: '' },
  scopes: [{ type: String }],
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now },
  lastUsedAt: { type: Date, default: null },
}, { collection: 'api_keys' })
const ApiKey = mongoose.models.ApiKey || mongoose.model('ApiKey', apiKeySchema)

// Cache: token → { user, expiresAt }
const tokenCache = new Map()
const CACHE_TTL = 5 * 60 * 1000 // 5 minutes

// Public operations that don't require auth (consumer-facing read)
const PUBLIC_OPERATIONS = new Set([
  'shopProducts',       // browsing shop
  '__schema',           // introspection
])

export async function authenticateRequest(req) {
  const auth = req.headers?.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  
  if (!token) return null
  
  // IPC device API key (ivm_ prefix)
  if (token.startsWith('ivm_')) {
    const cached = tokenCache.get(token)
    if (cached && cached.expiresAt > Date.now()) return cached.user
    const ak = await ApiKey.findOne({ key: token, active: true })
    if (!ak) return null
    ApiKey.updateOne({ _id: ak._id }, { lastUsedAt: new Date() }).catch(() => {})
    const user = { isApiKey: true, operatorId: ak.operatorId, hid: ak.hid, scopes: ak.scopes || [] }
    tokenCache.set(token, { user, expiresAt: Date.now() + CACHE_TTL })
    return user
  }
  
  // Check cache (LINE token)
  const cached = tokenCache.get(token)
  if (cached && cached.expiresAt > Date.now()) {
    return cached.user
  }
  
  try {
    // Verify with LINE API
    const verifyRes = await fetch(`https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(token)}`)
    if (!verifyRes.ok) return null
    const verifyData = await verifyRes.json()
    
    // Check channel ID matches our LIFF app
    if (String(verifyData.client_id) !== '2009020003') return null
    
    // Get profile
    const profileRes = await fetch('https://api.line.me/v2/profile', {
      headers: { Authorization: `Bearer ${token}` }
    })
    if (!profileRes.ok) return null
    const profile = await profileRes.json()
    
    // Find user in DB
    const dbUser = await User.findOne({ lineUserId: profile.userId }).lean()
    
    const user = {
      lineUserId: profile.userId,
      displayName: profile.displayName,
      isAdmin: dbUser?.isAdmin || false,
      operatorRoles: dbUser?.operatorRoles || [],
    }
    
    // Cache it
    tokenCache.set(token, {
      user,
      expiresAt: Date.now() + Math.min(verifyData.expires_in * 1000, CACHE_TTL)
    })
    
    // Prune cache if too large
    if (tokenCache.size > 1000) {
      const now = Date.now()
      for (const [k, v] of tokenCache) {
        if (v.expiresAt < now) tokenCache.delete(k)
      }
    }
    
    return user
  } catch (e) {
    console.error('Auth error:', e.message)
    return null
  }
}

export function requireAuth(user) {
  if (!user) throw new Error('未登入，請重新開啟應用')
}

export function requireAdmin(user) {
  requireAuth(user)
  if (!user.isAdmin) throw new Error('需要管理員權限')
}

export function requireOperatorAccess(user, operatorId) {
  requireAuth(user)
  if (user.isAdmin) return // admin can access all
  const hasRole = user.operatorRoles.some(r => r.operatorId === operatorId)
  if (!hasRole) throw new Error('無權存取此營運商資料')
}

export function requireOperatorRole(user, operatorId, role) {
  requireAuth(user)
  if (user.isAdmin) return
  const opRole = user.operatorRoles.find(r => r.operatorId === operatorId)
  if (!opRole || !opRole.roles.includes(role)) throw new Error(`需要 ${role} 權限`)
}

export function isOwner(user, lineUserId) {
  return user && user.lineUserId === lineUserId
}
