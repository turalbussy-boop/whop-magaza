# EforHug — kendi hosting'in için tam paket (frontend + backend)

## 📦 Tek dosya olarak indir

**https://eforhug.whop.site/eforhug-kit.zip**

İndirdikten sonra zip'i aç (çift tıkla / "Extract"), içinden çıkan **tüm
dosyaları** (klasör değil, dosyaların kendisini) GitHub reponun ana sayfasına
sürükle-bırak yükle. Tarayıcı hiçbir dosyayı değiştirmez.

Bu klasör, mevcut EforHug Whop sitendekiyle **aynı sepet mantığını** (Gri/Pembe
renk, 1/2/3'lü paket indirimi, hediye powerbank, ekstra powerbank) kendi
domain'inde çalıştırman için gereken her şeyi içerir.

Görseller ve CSS paketin içinde. Dışarıdaki Bunny veya hashed CSS dosyasına
bağımlı değil.

## Neden bir backend gerekiyor?

Whop'un ödeme API anahtarın **gizli** bir anahtar — tarayıcıya asla
gönderilemez. Sepet toplamı sunucuda hesaplanıp Whop'a bildirilir; tarayıcı
sadece oturum kimliğini alıp ödeme kutusunu açar. `server.js` bunu yapan
küçük Node.js sunucusu.

## İçindekiler

Hepsi **aynı klasörde**, alt klasör YOK.

- `server.js` — Express.
  - `/api/checkout-session` — sepeti fiyatlandırıp Whop ödeme oturumu açar.
  - `/api/track-order` — `pay_…` + e-posta ile sipariş sorgulama.
  - Sayfa rotaları: `/`, `/product`, `/odeme`, `/siparis-takip`, `/pages/contact`,
    `/iade-politikasi`, `/gizlilik-politikasi`, `/kargo-politikasi`,
    `/kullanim-kosullari`
- `index.html` — Ana sayfa
- `product.html` — Ürün (renk, paket, sepete ekle)
- `odeme.html` — Sipariş özeti + gerçek Whop ödeme kutusu. Sadece sepetten
  "Ödemeye Geç" ile açılır.
- `siparis-takip.html`, `contact.html`, yasal sayfalar
- `cart.js` — Sepet çekmecesi (`localStorage`)
- `styles.css` — Sitenin kendi tasarımı, bu sunucudan
- `package.json`, `.env.example`
- Ürün görselleri (`logo.avif`, `hero.webp`, `gri.webp`, `pembe.png`, …)

## ⚠️ GitHub'a yüklerken: hepsi repo'nun ANA klasörüne

`server.js`, `package.json`, `index.html` ve diğer tüm dosyalar repo kökünde,
birbirinin yanında durmalı.

## Kurulum

```bash
npm install
cp .env.example .env
# .env dosyasını aç, WHOP_CHECKOUT_API_KEY= satırına kendi anahtarını yapıştır
# (whop.com/dashboard/biz_7piuls4sNczwad/developer/ sayfasındaki
#  "Storefront Checkout" anahtarı — apik_ ile başlayan)
npm start
```

Sunucu `http://localhost:3000` üzerinde ayağa kalkar.

## Railway / Render

1. GitHub'a dosyaları kök dizine yükle.
2. Railway'de New Project → GitHub repo.
3. Variables: `WHOP_CHECKOUT_API_KEY` = `apik_...`
4. Start command: `npm start` (package.json zaten bunu tanımlıyor).
5. Domain'i Railway'in verdiği adrese CNAME / A kaydı ile bağla.

Ödeme Whop'ta kalır. Kart bilgisi senin sunucuna gelmez.

## Sipariş takip izni

`/api/track-order` için API anahtarında `payment:basic:read` olmalı. Checkout
bu izin olmadan da çalışır.

## Neyin aynı, neyin farklı olduğu

**Aynı:** Fiyatlar (1.849 / 3.328,20 / 4.714,95 TL), Gri/Pembe, paket indirimi,
hediye powerbank, sepet çekmecesi, Whop ödeme kutusu, ürün görselleri.

**Basitleştirilmiş:** Whop panelindeki admin / analitik burada yok. Bu paket
müşterinin gördüğü vitrin + ödeme + sipariş sorgulama.
