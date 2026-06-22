---
hide:
  - navigation
  - toc
  - feedback
template: index.html
search:
  exclude: true
title: Bird Mic
product: true
order: 2
id: avian-mic
published: true
teaser: A tiny microphone that listens out your window for any birds passing by.
sub: A tiny microphone that listens out your window for any birds passing by, and collages them on a local website accessible in your home.
imageBase: /assets/images/AvianVisitors/
images:
  - bird-mic.png
  - birdMicElectronics.png
  - birdMic3D.png
defaultBuild: electronics
weight: 0.4  
project: /projects/AvianVisitors/
related:
  - avian-visitors
variants:
  - id: electronics
    image: birdMicElectronics.png
    label: Electronics Kit
    price: 180
    stripePrice: "price_1TkCtvRPSNpqisAPIZwrcXYN"
    stripePriceLive: "price_1TkD4vRPSNpqisAP3P4gBDiF"
    desc: All electronics you need to start capturing avian visitors passing by your home.
    contents:
      - Raspberry Pi 4
      - USB microphone
      - microSD card
      - Power cable & brick
  - id: electronics-printed
    image: birdMic3D.png
    label: "+ 3D Printed Case"
    price: 210
    stripePrice: "price_1TkCtwRPSNpqisAPNx2Q6qnQ"
    stripePriceLive: "price_1TkD4vRPSNpqisAPXdZHZgwA"
    weight: 0.5   
    desc: All electronics plus the 3D-printed case.
    contents:
      - Everything in the Electronics Kit
      - 3D-printed case
softwareNote: Hardware only. You install the open-source software on your own device at first setup.
sections:
  - label: Open Source
    items:
      - This work, like all <a href="/projects/">my other projects</a>, is open source and usually in a state of continuous revision and development. Expect things to change, and (hopefully) get sleeker and easier to use over time. If any features or tweaks or fixes to this product would make your life easier, <a href="mailto:support@theodore.net">please do let me know</a>. And if you haven't already, check out the <a href="/projects/AvianVisitors/">Bird Mic project writeup</a>!
  - label: Technical specs
    items:
      - Bird Mic hosts an atlas of all birds it's heard on a website local to your network. You can see the atlas anytime you're on your home WiFi at `birdnet.local`
      - Add an <a href="/store/avian-visitors/">Avian Visitors</a> display to see all the birds you've heard framed on your wall.
      - The bird mic case is dialed for california weather and thus really isn't meant for anything besides clear blue skies. So if you live in a place with four seasons be somewhat wary of where you mount this mic for the time being, and stay tuned for an all-weather case for both the pi and the mic soon!
  - label: Dimensions
    items:
      - 3D printed case is 5.62" tall, 2.70" wide, and 1.15" thick
      - Mic cable runs 20ft, allowing you to place your Pi somewhere discrete, away from your window. 
colophon: 'Sold as hardware. BirdNET software and Cornell’s model install on your own device for personal use. Bird ID by <a href="https://birdnet.cornell.edu/" target="_blank" rel="noopener">BirdNET</a>, Cornell Lab of Ornithology (CC BY-NC-SA 4.0).'
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
        <div id="product-detail" data-product="avian-mic"><!-- rendered by store.js --></div>
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
  <h1 style="display:none;">Bird Mic - Teddy Warner</h1>
  </main>

  <script src="/assets/js/store.js" defer></script>
  <script src="/assets/js/header.js" defer></script>
</body>
</html>
