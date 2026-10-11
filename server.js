/**
 * EFORHUG — standalone Express server for self-hosting the storefront on
 * your own domain, while every payment still runs through real Whop
 * Payments infrastructure.
 *
 * Prices are recomputed here from the same catalog as the live site.
 * The browser never sends an amount.
 */
require('dotenv').config()
const express = require('express')
const path = require('path')

const app = express()
app.use(express.json({ limit: '32kb' }))

const COMPANY_ID = 'biz_7piuls4sNczwad'
const PRODUCT_ID = 'prod_DGIxQlYvYOZ8B'
const API_VERSION_DATE = '2026-07-29'
const PAYMENT_ID = /^pay_[A-Za-z0-9]{4,60}$/
const COLORS = ['Gri', 'Pembe']
const MAX_BLANKETS = 6

const PAYMENTS_URL = 'https://api.whop.com/api/v1/payments'
const MEMBERSHIPS_URL = 'https://api.whop.com/api/v1/memberships'
const CHECKOUT_CONFIGS_URL = 'https://api.whop.com/api/v1/checkout_configurations'

const PACKS = {
  1: { price: 1849, compare: 3760, qty: 1 },
  2: { price: 3328.2, compare: 7520, qty: 2 },
  3: { price: 4714.95, compare: 11280, qty: 3 },
}
const POWERBANK_PRICE = 499

const MANUAL_STATUS_LABELS = {
  hazirlaniyor: 'Hazırlanıyor',
  kargoya_verildi: 'Kargoya Verildi',
  dagitimda: 'Dağıtımda',
  teslim_edildi: 'Teslim Edildi',
}

function whopHeaders(apiKey) {
  return {
    Authorization: `Bearer ${apiKey}`,
    Accept: 'application/json',
    'Api-Version-Date': API_VERSION_DATE,
  }
}

function money2(n) {
  return Math.round(n * 100) / 100
}

function normalizeLine(raw) {
  const type = raw && raw.type === 'powerbank' ? 'powerbank' : 'blanket'
  if (type === 'powerbank') {
    const qty = Number.isInteger(raw.qty) ? raw.qty : 1
    if (qty < 1 || qty > 3) throw new Error('Powerbank adedi 1-3 arasında olmalı')
    return { type, qty }
  }
  const packQty = PACKS[raw && raw.packQty] ? raw.packQty : null
  if (!packQty) throw new Error(`Bilinmeyen paket: ${JSON.stringify(raw && raw.packQty)}`)
  const pack = PACKS[packQty]
  const colors = Array.isArray(raw.colors) ? raw.colors.slice(0, pack.qty) : []
  const safeColors = []
  for (let i = 0; i < pack.qty; i += 1) {
    safeColors.push(COLORS.includes(colors[i]) ? colors[i] : 'Gri')
  }
  return {
    type: 'blanket',
    packQty,
    colors: safeColors,
    includePowerbank: Boolean(raw.includePowerbank),
  }
}

function computeTotal(lines) {
  let total = 0
  let blankets = 0
  for (const line of lines) {
    if (line.type === 'powerbank') {
      total += POWERBANK_PRICE * line.qty
      continue
    }
    const pack = PACKS[line.packQty]
    blankets += pack.qty
    total += pack.price
    if (line.includePowerbank) total += POWERBANK_PRICE
  }
  if (blankets > MAX_BLANKETS) {
    throw new Error(`Aynı siparişte en fazla ${MAX_BLANKETS} battaniye alınabilir.`)
  }
  return money2(total)
}

app.post('/api/checkout-session', async (req, res) => {
  try {
    const apiKey = process.env.WHOP_CHECKOUT_API_KEY
    if (!apiKey) {
      return res.status(500).json({
        error: 'Sunucu WHOP_CHECKOUT_API_KEY olmadan çalıştırılıyor — .env dosyasını doldur.',
      })
    }

    const { lines } = req.body || {}
    if (!Array.isArray(lines) || lines.length === 0) {
      return res.status(400).json({ error: 'Sepet boş.' })
    }

    const safeLines = lines.map(normalizeLine)
    const amount = computeTotal(safeLines)
    if (amount <= 0) {
      return res.status(400).json({ error: 'Sepet toplamı sıfır olamaz.' })
    }

    const response = await fetch(CHECKOUT_CONFIGS_URL, {
      method: 'POST',
      headers: { ...whopHeaders(apiKey), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        account_id: COMPANY_ID,
        mode: 'payment',
        plan: {
          account_id: COMPANY_ID,
          product_id: PRODUCT_ID,
          title: 'EforHug siparişi',
          plan_type: 'one_time',
          currency: 'try',
          initial_price: amount,
        },
      }),
    })

    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      return res.status(502).json({
        error: `Whop checkout_configurations failed (${response.status}): ${detail.slice(0, 300)}`,
      })
    }

    const json = await response.json()
    if (!json.id) {
      return res.status(502).json({ error: 'Whop yanıtında oturum kimliği yok.' })
    }

    res.json({ sessionId: json.id, amount })
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Bilinmeyen hata' })
  }
})

function toShipmentInfo(raw) {
  if (!raw || typeof raw.status !== 'string') return null
  return {
    status: raw.status,
    trackingNumber: typeof raw.tracking_number === 'string' ? raw.tracking_number : null,
    carrier: typeof raw.carrier === 'string' ? raw.carrier : null,
    trackingUrl: typeof raw.tracking_url === 'string' ? raw.tracking_url : null,
  }
}

function paymentEmail(payment) {
  const userEmail = payment && payment.user && typeof payment.user.email === 'string'
    ? payment.user.email
    : ''
  const customer = typeof payment.customer_email === 'string' ? payment.customer_email : ''
  return (customer || userEmail).trim().toLowerCase()
}

function paymentAccountId(payment) {
  return (
    payment.account_id ||
    (payment.account && payment.account.id) ||
    (payment.company && payment.company.id) ||
    null
  )
}

function paymentTotal(payment) {
  if (typeof payment.total === 'number') return payment.total
  if (payment.total && typeof payment.total.amount === 'string') {
    const n = Number(payment.total.amount)
    return Number.isFinite(n) ? n : null
  }
  return null
}

async function fetchManualStatus(apiKey, membershipId) {
  try {
    const res = await fetch(`${MEMBERSHIPS_URL}/${membershipId}`, { headers: whopHeaders(apiKey) })
    if (!res.ok) return { status: null, updatedAt: null }
    const body = await res.json()
    const metadata = body.metadata || {}
    const status = Object.prototype.hasOwnProperty.call(MANUAL_STATUS_LABELS, metadata.shipping_status)
      ? metadata.shipping_status
      : null
    const updatedAt =
      typeof metadata.shipping_status_updated_at === 'string' ? metadata.shipping_status_updated_at : null
    return { status, updatedAt }
  } catch {
    return { status: null, updatedAt: null }
  }
}

app.post('/api/track-order', async (req, res) => {
  const NOT_FOUND = { found: false }
  try {
    const apiKey = process.env.WHOP_CHECKOUT_API_KEY
    if (!apiKey) return res.json(NOT_FOUND)

    const orderId = String(req.body && req.body.orderId ? req.body.orderId : '').trim().slice(0, 100)
    const email = String(req.body && req.body.email ? req.body.email : '').trim().slice(0, 200)
    if (!PAYMENT_ID.test(orderId) || email === '') return res.json(NOT_FOUND)

    const response = await fetch(`${PAYMENTS_URL}/${orderId}`, { headers: whopHeaders(apiKey) })
    if (!response.ok) return res.json(NOT_FOUND)
    const payment = await response.json()

    if (paymentAccountId(payment) !== COMPANY_ID) return res.json(NOT_FOUND)
    const onFile = paymentEmail(payment)
    if (onFile === '' || onFile !== email.toLowerCase()) return res.json(NOT_FOUND)

    const membershipId =
      (payment.membership && typeof payment.membership.id === 'string' && payment.membership.id) ||
      (typeof payment.membership_id === 'string' ? payment.membership_id : null)
    const manual = membershipId ? await fetchManualStatus(apiKey, membershipId) : { status: null, updatedAt: null }

    res.json({
      found: true,
      status: typeof payment.status === 'string' ? payment.status : 'unknown',
      createdAt: typeof payment.created_at === 'string' ? payment.created_at : '',
      total: paymentTotal(payment),
      currency: typeof payment.currency === 'string' ? payment.currency : 'try',
      shipment: toShipmentInfo(payment.shipment),
      manualStatus: manual.status,
      manualStatusLabel: manual.status ? MANUAL_STATUS_LABELS[manual.status] : null,
      manualStatusUpdatedAt: manual.updatedAt,
    })
  } catch {
    res.json(NOT_FOUND)
  }
})

app.get('/styles.css', (req, res) => {
  res.set('Content-Type', 'text/css; charset=utf-8')
  res.sendFile(path.join(__dirname, 'styles.css'))
})
app.get('/cart.js', (req, res) => {
  res.set('Content-Type', 'application/javascript; charset=utf-8')
  res.sendFile(path.join(__dirname, 'cart.js'))
})

const page = (name) => (req, res) => {
  res.set('Content-Type', 'text/html; charset=utf-8')
  res.sendFile(path.join(__dirname, name))
}

app.get('/', page('index.html'))
app.get('/product', page('product.html'))
app.get('/products/cozywarm™-tasinabilir-isitmali-battaniye', page('product.html'))
app.get('/products/cozywarm-tasinabilir-isitmali-battaniye', page('product.html'))
app.get('/collections/all', page('product.html'))
app.get('/odeme', page('odeme.html'))
app.get('/checkout', page('odeme.html'))
app.get('/siparis-takip', page('siparis-takip.html'))
app.get('/pages/contact', page('contact.html'))
app.get('/iade-politikasi', page('iade-politikasi.html'))
app.get('/gizlilik-politikasi', page('gizlilik-politikasi.html'))
app.get('/policies/privacy-policy', page('gizlilik-politikasi.html'))
app.get('/kargo-politikasi', page('kargo-politikasi.html'))
app.get('/kullanim-kosullari', page('kullanim-kosullari.html'))

app.use(express.static(__dirname, { maxAge: '7d', index: false }))

const port = process.env.PORT || 3000
app.listen(port, () => {
  console.log(`EforHug standalone server running on http://localhost:${port}`)
})
