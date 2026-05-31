---
title: Avian Visitors
description: A live bird collage from your window.
keywords: avianvisitors, birdnet-pi, birding, raspberry pi, ml, audio classification, gemini, kachō-e, illustration, generative art, apartment project, home automation
thumbnail: https://bird.onethreenine.net/thumb.png
date: 2026-05-28
hide:
  - navigation
  - tags
template: comments.html
---

{.newthought}I was initally planning{/.newthought} on leaving this as a 'true' personal project of sorts. I love a good [project writeup](https://theodore.net/projects/) of course, but frankly I thought this was too quick an afternoon project to warrant any more documentation than a tweet. Twitter thought otherwise ...

<center>
  <br>
  <div class="tweet-container">
    <div class="tweet-item single">
      <span class="lighttweet"><blockquote class="twitter-tweet"><p lang="en" dir="ltr">i mounted a tiny microphone on my apartment balcony to listen for any birds passing by and built a site to collage them as they&#39;re heard <a href="https://t.co/85KrLRL5tu">pic.twitter.com/85KrLRL5tu</a></p>&mdash; Teddy (@WarnerTeddy) <a href="https://x.com/WarnerTeddy/status/2060018688645115964?ref_src=twsrc%5Etfw">May 28, 2026</a></blockquote> <script async src="https://platform.x.com/widgets.js" charset="utf-8"></script> </span>
      <span class="darktweet"><blockquote class="twitter-tweet" data-theme="dark"><p lang="en" dir="ltr">i mounted a tiny microphone on my apartment balcony to listen for any birds passing by and built a site to collage them as they&#39;re heard <a href="https://t.co/85KrLRL5tu">pic.twitter.com/85KrLRL5tu</a></p>&mdash; Teddy (@WarnerTeddy) <a href="https://x.com/WarnerTeddy/status/2060018688645115964?ref_src=twsrc%5Etfw">May 28, 2026</a></blockquote> <script async src="https://platform.x.com/widgets.js" charset="utf-8"></script> </span>
    </div>
  </div>
  <br>
</center>

... so I've thrown together this short writeup for any of you who want to monitor any avian visitors that may be passing by your own place. It's short and sweet for now in an attempt to get something out quickly, but this work is part of a longer chain of bird-tangent projects i'll write something up about soon!

---

### Apartment Birds

Avian Visitors is a fork of [BirdNET-Pi](https://github.com/Nachtzuster/BirdNET-Pi) with a kachō-e collage overlay on top of it. BirdNET-Pi handles the audio capture and the species identification, running Cornell's [BirdNET](https://birdnet.cornell.edu/) acoustic classifier against whatever a USB mic on the Pi picks up. 

See it running at [bird.onethreenine.net](https://bird.onethreenine.net):

<div class="embed-frame" style="--embed-height: 700px;">
  <iframe
    src="https://bird.onethreenine.net/"
    frameborder="0"
    sandbox="allow-scripts allow-same-origin allow-forms"
    tabindex="-1"
  ></iframe>
</div>

#### BOM

Building a bird tracking station of your own is easy enough. The full project repo is at [github.com/Twarner491/AvianVisitors](https://github.com/Twarner491/AvianVisitors). Here's all you need:

<div class="bom-table" markdown>

| Qty | Description | Price | Link |
|-----|-------------|-------|------|
| 1 | Raspberry Pi (4B / 5 / Zero 2W) | ~$35-80 | [Raspberry Pi](https://www.raspberrypi.com/products/) |
| 1 | Micro SD Card (≥32 GB) | ~$10 | [Amazon](https://www.amazon.com/s?k=32gb+micro+sd+card&i=electronics&crid=1RCJAD1J0EPDX&sprefix=32gb+micro+sd+card%2Celectronics%2C226&ref=nb_sb_noss_1) |
| 1 | USB lavalier microphone | $16.95 | [Amazon](https://www.amazon.com/dp/B0176NRE1G) |
| 1 | Pi power supply | ~$10 | - |
| | **Total** | **~$80** | | |

</div>

While you're at it, grab a [Gemini API key](https://aistudio.google.com/apikey) to restyle illustrations (free-tier is fine), an [eBird API key](https://ebird.org/api/keygen) to filter species by region.

### Birdnet [dot] local

Flash the SD card with [Raspberry Pi Imager](https://www.raspberrypi.com/software/). Pick Raspberry Pi OS Lite (64-bit). In the customisation dialog set:

- Username
- WiFi SSID + password
- Hostname: `birdnet`
- Enable SSH with password auth

Plug the USB mic into the Pi and place it in a window or mount it outside. I stuck mine to the screen of a small window facing towards my balcony, keeping the Pi inside and away from the elements. Then boot! 

??? warning "If using a Raspberry Pi Zero 2 W"
    The RPi Zero 2 W has a few additional pre-reqs to handle low power wifi and low ram. Per the upstream [BirdNET-Pi RPi0W2 guide](https://github.com/mcguirepr89/BirdNET-Pi/wiki/RPi0W2-Installation-Guide):

    ```bash
    sudo apt update
    sudo apt install dphys-swapfile
    sudo sed -i 's/CONF_SWAPSIZE=100/CONF_SWAPSIZE=2048/g' /etc/dphys-swapfile
    sudo sed -i 's/#CONF_MAXSWAP=2048/CONF_MAXSWAP=4096/g' /etc/dphys-swapfile

    # wifi power-save defeats long-running connections; disable on every boot
    sudo sed -i '/^exit 0/i sudo iw wlan0 set power_save off' /etc/rc.local
    sudo reboot
    ```

Once the Pi's up on your network, SSH in and run the installer:

```bash
ssh <your-username>@birdnet.local
curl -s https://raw.githubusercontent.com/Twarner491/AvianVisitors/avian-visitors/newinstaller.sh | bash
```

The installer assumes passwordless sudo (Raspberry Pi OS Lite default - if you've tightened it, run `sudo raspi-config` -> *System Options* -> restore the default first).

This clones the fork, runs BirdNET-Pi's installer (audio capture, model, web UI, all the things), symlinks the AvianVisitors overlay into the Caddy web root, and reboots itself once everything's in place. The whole thing takes 20-40 minutes depending on your Pi model and Wi-Fi speed, and when the Pi comes back up, the collage lives at `http://birdnet.local/` with the stock BirdNET-Pi UI still reachable at `http://birdnet.local/index.php`. The menu drawer in the top right opens an admin overlay with native settings, system, log, and tool panels that hit a small JSON facade on the Pi, so you can tune the analyzer, watch services, and tail logs without leaving the collage.

??? example "Forward off your LAN (Optional)"

    The default install keeps everything on your LAN, but [`avian/forwarding/`](https://github.com/Twarner491/AvianVisitors/tree/avian-visitors/avian/forwarding) has three potential alternatives:

    *Cloudflare Tunnel*

    This gives you a public HTTPS URL with no port forwarding and no exposed home IP, which is what I'm using for [bird.onethreenine.net](https://bird.onethreenine.net). Needs a free Cloudflare account and ~5 minutes to set up. Start by installing `cloudflared` on the Pi:

    ```bash
    sudo apt install -y lsb-release
    curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
      | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
    echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
      | sudo tee /etc/apt/sources.list.d/cloudflared.list
    sudo apt update && sudo apt install -y cloudflared
    ```

    Then authenticate and create the tunnel, pointing it at a hostname on a domain you own:

    ```bash
    cloudflared tunnel login
    cloudflared tunnel create birds
    cloudflared tunnel route dns birds birds.your-domain.com
    ```

    Drop the bundled config into place, point the `tunnel:` field at the UUID `cloudflared tunnel create` printed back, then install + start the service:

    ```bash
    sudo cp ~/BirdNET-Pi/avian/forwarding/cloudflared.yml /etc/cloudflared/config.yml
    sudo nano /etc/cloudflared/config.yml
    sudo cloudflared service install
    sudo systemctl restart cloudflared
    ```

    To add a password gate on the public URL, set up Cloudflare Access (free tier covers up to 50 users) and add a policy on the hostname. If you'd rather use HTTP Basic auth via Caddy itself, the [`caddy-auth.caddy`](https://github.com/Twarner491/AvianVisitors/blob/avian-visitors/avian/forwarding/caddy-auth.caddy) snippet has a working example.

    *Home Assistant REST sensor*

    This surfaces the most-recent detection as `sensor.latest_bird` in Home Assistant, so you can wire it into automations (flash a light when a rare species is heard, push a notification, etc). Add to your `configuration.yaml`:

    ```yaml
    rest:
      - resource: http://birdnet.local/avian/api/birdnet-api.php?action=recent&hours=1
        scan_interval: 60
        sensor:
          - name: "Latest Bird"
            value_template: "{{ value_json.species[0].com if value_json.species else 'none' }}"
            json_attributes_path: "$.species[0]"
            json_attributes:
              - sci
              - n
              - last_seen
              - best_conf
    ```

    The `recent` endpoint already returns species ordered by count descending, so `species[0]` gives you the most-frequent bird in the last hour. If you'd rather sort by `last_seen`, swap the `value_template` accordingly.

    *MQTT bridge*

    The MQTT bridge polls the recent-detections endpoint once a minute and publishes new species under `birdnet/<slug>` as JSON, which is useful if you want detections flowing through your existing MQTT broker into other services. Install paho-mqtt, copy the bridge script + service file, and enable:

    ```bash
    sudo pip3 install paho-mqtt --break-system-packages
    cp ~/BirdNET-Pi/avian/forwarding/mqtt-bridge.py ~/avian-mqtt.py
    nano ~/avian-mqtt.py    # set broker host, topic prefix, credentials
    sudo cp ~/BirdNET-Pi/avian/forwarding/avian-mqtt.service /etc/systemd/system/
    sudo nano /etc/systemd/system/avian-mqtt.service   # set User= if not 'birdnet'
    sudo systemctl daemon-reload
    sudo systemctl enable --now avian-mqtt
    ```

    Dedup is in-memory only, so the bridge re-publishes the last hour of detections every time the service restarts. Downstream consumers should be idempotent.

#### Illustrations + Collage

The collage ships with 450 bundled illustrations of the most common North American species, generated via Gemini's [`gemini-2.5-flash-image`](https://ai.google.dev/gemini-api/docs/image-generation) model. Each species gets two poses: perched <img src="https://bird.onethreenine.net/api/img?sci=Corvus%20brachyrhynchos&com=American%20Crow" alt="perched American Crow" style="height: 1.6em; vertical-align: middle; margin: 0 0.15em;"> and in-flight <img src="https://bird.onethreenine.net/api/sketch?sci=Corvus%20brachyrhynchos&pose=2&com=American%20Crow" alt="American Crow in flight" style="height: 1.6em; vertical-align: middle; margin: 0 0.15em;">. The prompt template lives at [`avian/scripts/prompt.template.md`](https://github.com/Twarner491/AvianVisitors/blob/avian-visitors/avian/scripts/prompt.template.md):

```
Generate a {pose} {com_name} ({sci_name}) in the style of an
Edo-period Japanese kachō-e woodblock print. Confident sumi-e ink
linework with soft watercolor washes. Earthy, restrained palette:
burnt umber, ochre, indigo, vermillion, muted greens. Plumage
details rendered with short directional brush strokes; eye, beak,
and feet drawn with crisp ink. The bird is the only subject.
NO background, NO branch unless the pose requires it (a single
sparse twig is fine for perched), NO border or frame, NO text or
signature.

Anatomy must be biologically accurate for the named species:

- Exactly two wings. Two legs. One head. One beak. One tail.
- Posture, color, markings, and body proportions matching
  {com_name} field-guide references.
- For perched poses: one wing folded against the body, the other
  tucked behind. For flight: both wings extended in a natural
  flapping position.

Render at high resolution on a fully transparent background. Cut
the bird out cleanly. No shadow, no paper texture, no caption.
```

Three template variables get substituted per request: scientific name, common name, pose. Restyling the whole image set is a matter of editing this file and re-running the pre-gen script with `--force`.

```bash
export GEMINI_API_KEY='your-key'

# Re-render every species in BirdNET-Pi's model:
python3 ~/BirdNET-Pi/avian/scripts/pregen.py \
  --labels ~/BirdNET-Pi/model/labels.txt --force

# Or filter to species observed in your eBird region:
export EBIRD_API_KEY='your-key'
python3 ~/BirdNET-Pi/avian/scripts/pregen.py \
  --labels ~/BirdNET-Pi/model/labels.txt \
  --ebird-region US-CA
```

When you pass `--ebird-region`, the pre-gen script intersects BirdNET's full species list with whatever eBird reports as observed in that region,{.marginnote}eBird region codes are `<country>-<state>` (e.g. `US-CA`) for state-level filtering, or `<country>-<state>-<county>` (e.g. `US-CA-085` for Santa Clara County) for tighter filtering.{/.marginnote} which cuts the render count from ~3000 species globally down to whatever's actually flying past your place.

It's worth flagging that Gemini hallucinates anatomy here with non-trivial frequency, so the repo ships the post-audit image set with extra wings, disembodied feet, and training-image watermarks already removed.{.marginnote}The audit pass that produced the current bundled set caught ~3% anatomical defects on perched poses and ~5% on flight poses. Flight poses are harder because Gemini's strong prior for "wings spread" reads any feather mass near the body as a candidate wing, so the same chickadee can take five or six regen attempts before producing a clean output.{/.marginnote}

<figure markdown="1">

![](../assets/images/AvianVisitors/collage.png)

</figure>

Each species ships with a binary alpha mask{.marginnote}Generated offline by downsampling the illustration to ~93px wide, thresholding the alpha channel, and packing the result into a base64-encoded bit-array. Full mask registry at [`avian/frontend/masks.json`](https://github.com/Twarner491/AvianVisitors/blob/avian-visitors/avian/frontend/masks.json), ~280KB for 249 species.{/.marginnote} that encodes the bird's silhouette. The frontend uses these masks for two things: tile-packing (so bounding boxes can overlap as long as the silhouettes don't), and hover hit-testing (so the right bird highlights when you mouse over a region where two tiles' bounding boxes overlap).

The packing algorithm itself is a center-out spiral: tiles get sorted by area descending, the largest is placed at the center of mass, and each subsequent tile spirals outward from the center until finding a position where its mask doesn't intersect any already-placed mask. The cost function biases horizontally to produce wider, more landscape-friendly clusters:

$$\text{cost}(x, y) = \sqrt{\left(\frac{\Delta x}{b}\right)^2 + \Delta y^2}$$

where $b = 2.1$ is the ellipse aspect bias.

Tile sizing was the trickier piece to get right. The naive approach here is to set each tile's area as a power of its detection count and clamp the result to a per-tile maximum:

$$A_i = \min(A_{\text{max}}, \, A_{\text{base}} \cdot n_i^{1.2})$$

This breaks the moment any species crosses the clamp threshold, because every loud species above it renders at the same maximum size regardless of actual count, which flattens the visual hierarchy that's the whole point of sizing tiles by frequency. The fix is to normalize against a viewport area budget instead: each tile gets a count-weighted score, all scores get scaled so they sum to a fraction of the viewport, and tile sizes derive from the scaled areas:

$$s_i = n_i^{0.65} \quad,\quad A_i = \max\left(A_{\text{min}}, \, \frac{B}{\sum_j s_j} \cdot s_i\right) \quad,\quad w_i = \sqrt{A_i \cdot \text{ar}_i}$$

where $B$ is the viewport area budget (28% to 46% of viewport depending on species count) and $\text{ar}_i$ is the species' aspect ratio. The 0.65 exponent gives a visible hierarchy (a 400-call species renders ~5× the area of a 30-call one) without the cap-induced flattening, and because everything's normalized against viewport area, the same logic produces a sensible layout at any screen size.

After the initial pack, if any tile lands off-screen, every tile shrinks by 7% and the whole layout repacks, looping up to 10 times before bailing (by which point the linear scale is ~50% of original). This guarantees every species fits at every viewport from 390px mobile widths up through 2560px studio displays, which matters more than you'd think on a site where the collage IS the page.

#### ~ Real Time

The frontend polls the recent-detections endpoint every 30 seconds, and when a new species crosses into the current time window it joins the layout at the next refresh, with the cluster shifting just slightly to make room.{.marginnote}The frontend does a full re-pack rather than incremental insertion. Repacking ~10 species at the current grid stride (4px) takes <20ms in V8 on a Pi 4 client.{/.marginnote} The window picker (`1H / 12H / 24H / 7D / ALL`) refetches with the matching `?hours=N` and re-renders in place, and the whole thing happens quietly enough that I've left the page open for hours at a time without noticing the transitions.

Clicking any tile in the collage (or any card in the atlas view) opens a detail modal that hits a Wikipedia summary endpoint for the species description and offers both perched and flight poses via a toggle. The recordings list pulls the most-recent BirdNET-Pi-archived mp3s for the species, matched on the common name and sourced from `$HOME/BirdSongs/Extracted/By_Date/<date>/<Common_Name>/`, each rendered alongside its spectrogram, with wiki and eBird chips at the bottom for external references.

---

And there you have it, a wonderfuly simple build to keep track of any little guys that may be passing by :)