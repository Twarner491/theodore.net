---
hide:
  - navigation
  - toc
  - feedback
template: index.html
search:
  exclude: true
title: Avian Visitors
product: true
order: 1
id: avian-visitors
published: true
teaser: A battery-powered e-paper frame that collages birds heard in your ZIP code.
sub: A battery-powered e-paper frame that collages birds heard in your ZIP code.
description: A battery-powered e-paper frame that collages birds heard in your ZIP code.
imageBase: /assets/images/AvianVisitors/
images:
  - avianAssembledTop.png
  - avianAssembledBack.png
  - avianAssembledSide.png
defaultBuild: assembled
project: /projects/AvianVisitors/
related:
  - avian-mic
storeListings:
  - category: products
    build: assembled
    variants:
      - assembled
    title: Avian Visitors
variants:
  - id: assembled
    image: avianAssembledTop.png
    label: Assembled
    # Drop gate: the page (and the email countdown image) counts down to launchAt (quoted UTC;
    # Thu Oct 29, 9:00 AM PT). soldout never sells; to open by itself at launchAt, set
    # status: available ahead of time (with stripePriceLive and inventory provisioned).
    # Checkout refuses this variant before launchAt. Leave launchAt in place after the drop.
    status: available
    launchAt: "2026-10-29T16:00:00Z"
    launchLabel: Batch 1
    price: 699
    weight: 4   # PLACEHOLDER (Teddy, 2026-10-17): guessed from the kit, maybe slightly over. Weigh a packed
                #   frame and update it before Oct 29 9 AM PT or after Batch 1 settles: orders in flight are bound to it.
    stripePrice: price_1UAyqjRPSNpqisAPDHJxogp3
    stripePriceLive: "price_1URc2XRPSNpqisAPNxAEEUEQ"
    localPreview: true
    maxQuantity: 20
    shippingProfile: contiguous-us-ground
    inventorySku: avian-gen3-batch-01
    batchSize: 20
    batchSizePrivate: true   # never show "N of 20"; only "Only N left" at 5 or fewer
    softwareNote: Batch 1 ships Q4 2026.
    contents:
      - Fully assembled 13.3-inch e-paper frame with rechargeable battery
      - Wall-hanging hardware
sections:
  - label: How it works
    html: The framed e-ink display dynamically updates to show a collage of the birds heard most recently within your ZIP code.
  - label: Pairs with
    html: <a href="/store/avian-mic/">Bird Mic Kit</a> or <a href="https://www.birdweather.com/shop-birdweather-puc" target="_blank" rel="noopener noreferrer">BirdWeather PUC</a> to populate the screen with your own bioacoustics data. Not required.
  - label: Dimensions
    html: 11.75 × 14.75 × 0.96 in
---

<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <script src="https://kit.fontawesome.com/79ff35ecec.js" crossorigin="anonymous" defer></script>
  <link rel="stylesheet" href="/assets/css/index.css">
  <link rel="stylesheet" href="/assets/css/store.css">
  <link rel="stylesheet" href="/assets/css/header.css">
</head>

<body>

  <nav class="main-navigation">
    <ul>
      <li><a class="home" href="https://teddywarner.com"><span class="navnum">01</span> Home</a></li>
      <li><a class="proj" href="/projects"><span class="navnum">02</span> Projects</a></li>
      <li><a class="writ" href="/writings"><span class="navnum">03</span> Writing</a></li>
      <li><a class="stor" href="/store"><span class="navnum">04</span> Store</a></li>
    </ul>
  </nav>

  <div class="blur-overlay"></div>

  <main data-scroll-container>
  <div class="content-container">
    <section class="intro-section">
      <div class="content1">
        <div id="product-detail" data-product="avian-visitors"><!-- rendered by store.js --></div>
      </div>
    </section>

    <section class="footer">
      <div class="content8">
        <div class="socialpar"><a target="_blank" href="https://github.com/Twarner491" aria-label="GitHub Profile"><i class="fa-brands fa-github"></i></a></div>
        <div class="socialpar"><a target="_blank" href="https://x.com/intent/follow?screen_name=WarnerTeddy" aria-label="X (Twitter) Profile"><i class="fa-brands fa-x-twitter"></i></a></div>
        <div class="socialpar"><a target="_blank" href="mailto:teddy@warner.net" aria-label="Send Email"><i class="fa-solid fa-paper-plane"></i></a></div>
        <a target="_blank" href="https://github.com/Twarner491/theodore.net/blob/main/LICENSE"><p class="copyright">Copyright © 2026 Teddy Warner</p></a>
        <p class="store-legal"><a href="/privacy">Privacy</a> <a href="/terms">Terms</a> <a href="/returns">Returns</a></p>
      </div>
    </section>
  </div>
  <h1 style="display:none;">Avian Visitors - Teddy Warner</h1>
  </main>

  <script src="/assets/js/store.js" defer></script>
  <script src="/assets/js/header.js" defer></script>
</body>
</html>
