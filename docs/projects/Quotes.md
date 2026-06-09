---
title: Quote Receipts
description: Did I really say that? Why yes, you did.
keywords: quote receipt printer, thermal printer project, raspberry pi, flask web server, DIY printer, quote collection, thermal receipt, python project, home automation, apartment project, raspberry pi 5, quote printer, receipt printer hack, thermal printing, local web server, skeuomorphic design
thumbnail: /assets/images/quotes/thumb.png
date: 2025-09-01
hide:
  - navigation
  - tags
template: comments.html
---

<link rel="stylesheet" href="../../assets/css/projects/receipts.css">

<div style="
  width: 100%;
  padding: 2rem 0;
  font-family: 'Courier New', monospace;
  text-align: center;
  line-height: 1.4;
  color: var(--md-default-fg-color);
  margin: 2rem 0;
">
  <div style="
    font-size: 1.2em;
    font-weight: bold;
    margin-bottom: 1rem;
    letter-spacing: 2px;
    color: var(--md-default-fg-color);
  ">QUOTE RECEIPT</div>
  <div style="
    border-top: 1px dashed var(--md-default-fg-color--light);
    border-bottom: 1px dashed var(--md-default-fg-color--light);
    padding: 0.5rem 0;
    margin: 1rem auto;
    font-size: 0.9em;
    color: var(--md-default-fg-color--light);
    max-width: 300px;
  ">2025-10-04 21:48:01</div>
  <div style="
    margin: 1.5rem 0;
    font-style: italic;
    font-size: 0.95em;
    color: var(--md-default-fg-color);
  ">"Did I really say that?" Why yes, you did.</div>
  <div style="
    border-top: 1px solid var(--md-default-fg-color--light);
    padding-top: 1rem;
    margin: 1.5rem auto 0rem;
    text-align: right;
    font-size: 0.9em;
    color: var(--md-default-fg-color--light);
    max-width: 300px;
  ">-Teddy</div>
</div>

{.newthought}I have some really wonderful friends.{/.newthought} They, like I, say many silly things. 

I wanted some means of capturing all of these quotes for later reference. Or to keep as nice souvenirs of thought.

My roommate and I have been going all in on the apartment projects (AIPhone, Cathode Ray Doorbell, StairGuitar™, etc. - I'll do write-ups on some of these at some point in the future), and I figured to stay in the same vein that my weekend project should attempt to solve my quote attribution problem. I also happened to have an [80mm Thermal Receipt Printer](https://www.amazon.com/dp/B0DFB82NPF?ref=ppx_pop_mob_ap_share) lying around from another project I never got around to finishing.

And boom, I now knew how I would be spending my Saturday morning.

<center>

<div class="embed-frame"><div class="embed-inner">
<iframe width="100%" height="650" src="https://www.youtube.com/embed/F5_00bj8dHo" title="Quote Receipt" frameborder="0" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
</div></div>

</center>

### "That's a Quote."

The general premise of this build is pretty easy: people in my apartment say silly / interesting / funny things all the time. Upon hearing one of these silly / interesting / funny things, a user should be able to print said thing with little imposition. As such, we'll need a locally hosted website, of course - A user will hear a quote, open said local website, and then a "quote receipt" will be generated and printed to memoralize that silly / interesting / funny moment for all of eternity.

This user flow demands a few things: first, a locally hosted webpage where a user can upload a quote. It's probably important that this remains local to our apartment network, as I think it provides a nice scope for what quotes are fit to be printed (and so the gimmick doesn't burn out too quickly). Also, this makes development easier. Second, a printer capable of quickly printing these "quote receipts". I'll be fitting this printer with a Raspberrry Pi 5 to handle the webserver hosting / printing.

#### Receipt [dot] Local

To start, lets take on this local webserver! For the sake of simplicity, I'll be sticking to some skeuomorphism and designing a webform to look like a receipt. I started by flashing a fresh copy of Raspberry Pi OS Lite (64-bit) onto an SD card and updating the WiFi credentials. 

Then I SSH'ed into the fresh RPI OS instance and got to work.

  ```bash
  # SSH into your Pi
  ssh pi@raspberrypi.local # Default password is usually 'raspberry'

  # Update system
  sudo apt update && sudo apt upgrade -y
  ```

A few config bits first:

  ```bash
  # Set timezone
  sudo raspi-config

  # Navigate to: Localization Options > Timezone > Select yours

  # Change default password (recommended)
  passwd
  ```

Set Hostname to 'receipt' or whatever tickles your fancy, but this allows users to go to 'receipt.local' to upload their quote.

  ```bash
  # Set hostname
  sudo hostnamectl set-hostname receipt

  # Update hosts file
  sudo nano /etc/hosts

  # Change the line: 127.0.1.1 raspberrypi
  # To: 127.0.1.1 receipt
  # Save: Ctrl+O, Enter, Ctrl+X

  # Reboot to apply
  sudo reboot
  ```

  After reboot, reconnect with:

  ```bash
  ssh pi@receipt.local
  ```

Then install Dependencies
  ```bash
  # Install system packages
  sudo apt install -y python3-pip python3-dev python3-pil libusb-1.0-0-dev avahi-daemon

  # Install Python libraries (both user and system-wide for sudo)
  pip3 install flask python-escpos pyusb pillow --break-system-packages
  sudo pip3 install flask python-escpos pyusb pillow --break-system-packages

  # Enable and start mDNS service
  sudo systemctl enable avahi-daemon
  sudo systemctl start avahi-daemon

  # Reboot to ensure everything loads properly
  sudo reboot
  ```

Plug in USB thermal printer, run `lsusb` to get vendor/product ID.

  ```bash
  lsusb

  ```

  Output example:

  ```
  Bus 001 Device 005: ID 0483:5720 STMicroelectronics

  ```

  Note: `0483:5720` → Vendor=`0x0483`, Product=`0x5720`

  ```bash
  # Get USB endpoint addresses
  lsusb -v -d 0483:5720 | grep -A 5 "bEndpointAddress"

  ```

  Output example:

  ```
  bEndpointAddress     0x03  EP 3 OUT
  ...
  bEndpointAddress     0x81  EP 1 IN

  ```

  *Note your values:* Vendor ID: `0x0483`, Product ID: `0x5720`, OUT Endpoint: `0x03`, IN Endpoint: `0x81`

Then we'll create a very minimal project structure - I'm keeping this build to two files: a frontend HTML template and a simple Python backend. Clone the project repository:

  ```bash
  git clone https://github.com/Twarner491/quotes.git ~/quotes
  cd ~/quotes
  sudo pip3 install -r requirements.txt --break-system-packages
  ```

  Update [`src/app.py`](https://github.com/Twarner491/quotes/blob/main/src/app.py) with your printer's vendor/product/endpoint IDs:

  ```python
  VENDOR_ID = 0x0483      # Your vendor ID
  PRODUCT_ID = 0x5720     # Your product ID
  OUT_EP = 0x03           # Your OUT endpoint
  IN_EP = 0x81            # Your IN endpoint
  ```

  The frontend template lives in [`src/templates/index.html`](https://github.com/Twarner491/quotes/blob/main/src/templates/index.html).

  I'm super happy with how the squedomorphic design came out here - Thermal Printers are somewhat limited in their output (due to binary color option) and as such I was pretty constrined when designing how I wanted the output reciept to look. Once i had a boilerplate from the backend, making this frontend match was easy.

<div class="embed-frame" style="--embed-height: 700px;">
  <iframe
    class="plotter-iframe"
    data-src="https://receipt.onethreenine.net/"
    frameborder="0"
    width="100%"
    sandbox="allow-scripts allow-same-origin allow-forms"
    tabindex="-1"
  ></iframe>
</div>

To get our RPI app up and running with the printer, we need to set some permissions. The udev rules are included in the repo:

  ```bash
  sudo cp ~/quotes/system-config/99-thermal-printer.rules /etc/udev/rules.d/
  sudo udevadm control --reload-rules
  sudo udevadm trigger

  # Add user to printer groups
  sudo usermod -a -G lp,dialout $USER

  # Reboot for permissions to take effect
  sudo reboot
  ```

... and then we can test! Just be sure the printer is plugged into power, 80mm Thermal paper is loaded (I used [MPRT 5 Rolls 3-1/8" x 230](https://www.amazon.com/dp/B0D14DYMHQ?ref=ppx_pop_mob_ap_share)), and the printer is wired to the RPI via USB.

  ```bash
  ssh pi@receipt.local
  cd ~/quotes
  sudo python3 src/app.py
  ```

  You should see:

  ```
  * Running on all addresses (0.0.0.0)
  * Running on http://127.0.0.1:5000
  ```

  Test from browser: `http://receipt.local:5000`

  Press `Ctrl+C` to stop when done testing.

As a final step to prep for step 2: Printer Hacking, we'll set up this app to auto run upon boot. The systemd service file is included in the repo at [`system-config/receipt-printer-flask.service`](https://github.com/Twarner491/quotes/blob/main/system-config/receipt-printer-flask.service):

  ```bash
  sudo cp ~/quotes/system-config/receipt-printer-flask.service /etc/systemd/system/receipt-printer.service
  sudo systemctl daemon-reload
  sudo systemctl enable --now receipt-printer.service

  # Check status
  sudo systemctl status receipt-printer.service

  # Test reboot
  sudo reboot
  ```

  After reboot, http://receipt.local:5000 should be live automatically!

{.marginnote}Here's the first print with the Quote Printer{/.marginnote}

<center>

<div class="embed-frame"><div class="embed-inner">
<iframe width="100%" height="650" src="https://www.youtube.com/embed/sNBxLepgpb0" title="First Quote Receipt" frameborder="0" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
</div></div>

</center>

??? example "Home Assistant Integration (Optional)"

    As mentioned at the start of the article, my roommate and I have been going all in on the apartment projects. My roommate Andrew set up a [Home Assistant Yellow](https://www.home-assistant.io/yellow/) the other week which we use alongside a few local MQTT servers to host all of our IOT devices and projects locally - way better than a ton of apps / interfaces on my phone. I wanted our quote printer to be accessible from anywhere and populate in our Home Assistant admin panel, so I've appended this optional MQTT integration to the project.

    The setup is straightforward: a webhook automation in Home Assistant receives print requests from the frontend, publishes them to an MQTT topic, and an MQTT subscriber script on the Pi listens for messages and triggers the printer. This allows the frontend to be hosted publicly (I'm using GitHub Pages) while the printer itself remains on the local network, bridged through Home Assistant.

    The relevant files are [`src/mqtt_print_subscriber.py`](https://github.com/Twarner491/quotes/blob/main/src/mqtt_print_subscriber.py) for the Pi-side MQTT listener and [`system-config/receipt-printer-mqtt.service`](https://github.com/Twarner491/quotes/blob/main/system-config/receipt-printer-mqtt.service) for the systemd service.

    **Home Assistant Automation**

    Add to `automations.yaml`:

    ```yaml
    alias: "Quote Receipt Print"
    trigger:
      - platform: webhook
        webhook_id: quote_receipt_print
        allowed_methods: [POST]
        local_only: false
    action:
      - service: mqtt.publish
        data:
          topic: "home/receipt_printer/print"
          payload_template: >
            {"quote": "{{ trigger.json.quote }}", "author": "{{ trigger.json.author | default('Anonymous') }}", "image": "{{ trigger.json.image | default('') }}"}
    ```

    **Enable CORS**

    Add to `configuration.yaml`:

    ```yaml
    http:
      cors_allowed_origins:
        - https://your-frontend-domain.com
    ```

    **Pi MQTT Setup**

    Edit `src/mqtt_print_subscriber.py` with your MQTT broker IP and printer IDs, then:

    ```bash
    sudo cp system-config/receipt-printer-mqtt.service /etc/systemd/system/receipt-printer.service
    sudo systemctl daemon-reload
    sudo systemctl enable --now receipt-printer.service
    ```

    **Frontend**

    To enable remote access on your fork, add your HA webhook URL as a GitHub Secret:
    
     - Go to Settings → Secrets and variables → Actions
     - Add secret: `HA_WEBHOOK_URL` = Your Home Assistant webhook URL (e.g., `https://your-ha.com/api/webhook/quote_receipt_print`)

#### A Dot or Nothing

Sometimes a quote deserves a photo, to further commemorate its moment. Receipt [dot] local offers an upload button to fulfill this end, which surfaces a little problem: how do you print an image on a binary thermal printer head? With some fun dithering of course: scatter pure black dots at the right density and let your eye average them back into greys, spending the spatial resolution the printer has to buy back the tones it doesn't. It lays down a row of $384$ dots, and each one is either burned black or left blank, a single bit. The photo you handed it, though, carries $2^8 = 256$ shades per pixel.

<div class="dither-diagram-wrap" style="margin: 0.5rem 0 1.25rem;">
<svg class="dither-diagram" viewBox="0 0 1000 512" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" style="color:var(--md-default-fg-color);width:100%;height:auto" font-family="Palatino, Georgia, &quot;Times New Roman&quot;, serif">
<style>.dd-bits{image-rendering:pixelated}</style>
<defs><clipPath id="ddReveal"><rect id="ddRevealRect" x="80" y="44" width="150.0" height="447"/></clipPath></defs>
<image class="dd-photo" x="80" y="44" width="300" height="447" preserveAspectRatio="none" xlink:href="data:image/png;base64,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" href="data:image/png;base64,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"/>
<g clip-path="url(#ddReveal)"><image class="dd-photo dd-bits" x="80" y="44" width="300" height="447" preserveAspectRatio="none" xlink:href="data:image/png;base64,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" href="data:image/png;base64,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"/></g>
<rect x="80" y="44" width="300" height="447" fill="none" stroke="currentColor" stroke-opacity="0.45" stroke-width="1.4"/>
<line id="ddLeader" x1="230.0" y1="161.2" x2="618" y2="267" stroke="currentColor" stroke-opacity="0.4" stroke-width="0.8"/>
<g><rect x="88" y="52" width="48" height="22" rx="4" fill="var(--md-default-bg-color, #fff)" stroke="currentColor" stroke-opacity="0.25"/><text x="94" y="67" fill="currentColor" fill-opacity="0.75" font-size="13" text-anchor="start">1 bit</text></g>
<g><rect x="295" y="52" width="77" height="22" rx="4" fill="var(--md-default-bg-color, #fff)" stroke="currentColor" stroke-opacity="0.25"/><text x="366" y="67" fill="currentColor" fill-opacity="0.75" font-size="13" text-anchor="end">256 greys</text></g>
<g id="ddCursor" transform="translate(150.0,0)"><line x1="80" y1="34" x2="80" y2="501" stroke="currentColor" stroke-width="1.3"/><path d="M 74 34 L 86 34 L 80 44 Z" fill="currentColor"/><path d="M 74 501 L 86 501 L 80 491 Z" fill="currentColor"/></g>
<g><rect x="631" y="147" width="240" height="240" fill="#ffffff"/><rect id="dd_c_0_0" x="632" y="148" width="34" height="34" fill="#18181c" fill-opacity="0.0"/><rect x="632" y="148" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_0_1" x="666" y="148" width="34" height="34" fill="#18181c" fill-opacity="1.0"/><rect x="666" y="148" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_0_2" x="700" y="148" width="34" height="34" fill="#18181c" fill-opacity="0.0"/><rect x="700" y="148" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_0_3" x="734" y="148" width="34" height="34" fill="#18181c" fill-opacity="0.384"/><rect x="734" y="148" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_0_4" x="768" y="148" width="34" height="34" fill="#18181c" fill-opacity="0.471"/><rect x="768" y="148" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_0_5" x="802" y="148" width="34" height="34" fill="#18181c" fill-opacity="0.471"/><rect x="802" y="148" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_0_6" x="836" y="148" width="34" height="34" fill="#18181c" fill-opacity="0.333"/><rect x="836" y="148" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_1_0" x="632" y="182" width="34" height="34" fill="#18181c" fill-opacity="0.0"/><rect x="632" y="182" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_1_1" x="666" y="182" width="34" height="34" fill="#18181c" fill-opacity="0.0"/><rect x="666" y="182" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_1_2" x="700" y="182" width="34" height="34" fill="#18181c" fill-opacity="1.0"/><rect x="700" y="182" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_1_3" x="734" y="182" width="34" height="34" fill="#18181c" fill-opacity="0.329"/><rect x="734" y="182" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_1_4" x="768" y="182" width="34" height="34" fill="#18181c" fill-opacity="0.325"/><rect x="768" y="182" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_1_5" x="802" y="182" width="34" height="34" fill="#18181c" fill-opacity="0.275"/><rect x="802" y="182" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_1_6" x="836" y="182" width="34" height="34" fill="#18181c" fill-opacity="0.29"/><rect x="836" y="182" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_2_0" x="632" y="216" width="34" height="34" fill="#18181c" fill-opacity="1.0"/><rect x="632" y="216" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_2_1" x="666" y="216" width="34" height="34" fill="#18181c" fill-opacity="0.0"/><rect x="666" y="216" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_2_2" x="700" y="216" width="34" height="34" fill="#18181c" fill-opacity="0.0"/><rect x="700" y="216" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_2_3" x="734" y="216" width="34" height="34" fill="#18181c" fill-opacity="0.125"/><rect x="734" y="216" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_2_4" x="768" y="216" width="34" height="34" fill="#18181c" fill-opacity="0.157"/><rect x="768" y="216" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_2_5" x="802" y="216" width="34" height="34" fill="#18181c" fill-opacity="0.216"/><rect x="802" y="216" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_2_6" x="836" y="216" width="34" height="34" fill="#18181c" fill-opacity="0.31"/><rect x="836" y="216" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_3_0" x="632" y="250" width="34" height="34" fill="#18181c" fill-opacity="0.0"/><rect x="632" y="250" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_3_1" x="666" y="250" width="34" height="34" fill="#18181c" fill-opacity="0.0"/><rect x="666" y="250" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_3_2" x="700" y="250" width="34" height="34" fill="#18181c" fill-opacity="0.0"/><rect x="700" y="250" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_3_3" x="734" y="250" width="34" height="34" fill="#18181c" fill-opacity="0.188"/><rect x="734" y="250" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_3_4" x="768" y="250" width="34" height="34" fill="#18181c" fill-opacity="0.231"/><rect x="768" y="250" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_3_5" x="802" y="250" width="34" height="34" fill="#18181c" fill-opacity="0.251"/><rect x="802" y="250" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_3_6" x="836" y="250" width="34" height="34" fill="#18181c" fill-opacity="0.353"/><rect x="836" y="250" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_4_0" x="632" y="284" width="34" height="34" fill="#18181c" fill-opacity="1.0"/><rect x="632" y="284" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_4_1" x="666" y="284" width="34" height="34" fill="#18181c" fill-opacity="0.0"/><rect x="666" y="284" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_4_2" x="700" y="284" width="34" height="34" fill="#18181c" fill-opacity="1.0"/><rect x="700" y="284" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_4_3" x="734" y="284" width="34" height="34" fill="#18181c" fill-opacity="0.224"/><rect x="734" y="284" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_4_4" x="768" y="284" width="34" height="34" fill="#18181c" fill-opacity="0.255"/><rect x="768" y="284" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_4_5" x="802" y="284" width="34" height="34" fill="#18181c" fill-opacity="0.29"/><rect x="802" y="284" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_4_6" x="836" y="284" width="34" height="34" fill="#18181c" fill-opacity="0.396"/><rect x="836" y="284" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_5_0" x="632" y="318" width="34" height="34" fill="#18181c" fill-opacity="1.0"/><rect x="632" y="318" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_5_1" x="666" y="318" width="34" height="34" fill="#18181c" fill-opacity="0.0"/><rect x="666" y="318" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_5_2" x="700" y="318" width="34" height="34" fill="#18181c" fill-opacity="0.0"/><rect x="700" y="318" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_5_3" x="734" y="318" width="34" height="34" fill="#18181c" fill-opacity="0.259"/><rect x="734" y="318" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_5_4" x="768" y="318" width="34" height="34" fill="#18181c" fill-opacity="0.298"/><rect x="768" y="318" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_5_5" x="802" y="318" width="34" height="34" fill="#18181c" fill-opacity="0.349"/><rect x="802" y="318" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_5_6" x="836" y="318" width="34" height="34" fill="#18181c" fill-opacity="0.447"/><rect x="836" y="318" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_6_0" x="632" y="352" width="34" height="34" fill="#18181c" fill-opacity="0.0"/><rect x="632" y="352" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_6_1" x="666" y="352" width="34" height="34" fill="#18181c" fill-opacity="0.0"/><rect x="666" y="352" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_6_2" x="700" y="352" width="34" height="34" fill="#18181c" fill-opacity="1.0"/><rect x="700" y="352" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_6_3" x="734" y="352" width="34" height="34" fill="#18181c" fill-opacity="0.275"/><rect x="734" y="352" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_6_4" x="768" y="352" width="34" height="34" fill="#18181c" fill-opacity="0.345"/><rect x="768" y="352" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_6_5" x="802" y="352" width="34" height="34" fill="#18181c" fill-opacity="0.416"/><rect x="802" y="352" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect id="dd_c_6_6" x="836" y="352" width="34" height="34" fill="#18181c" fill-opacity="0.518"/><rect x="836" y="352" width="34" height="34" fill="none" stroke="#18181c" stroke-opacity="0.18" stroke-width="0.7"/><rect x="632" y="148" width="238" height="238" fill="none" stroke="#18181c" stroke-opacity="0.4" stroke-width="1.2"/><rect x="734" y="250" width="34" height="34" fill="none" stroke="#18181c" stroke-width="2.2"/><line x1="762.6" y1="267.0" x2="772.8" y2="267.0" stroke="#18181c" stroke-opacity="0.55" stroke-width="1.3"/><polyline points="767.5,269.9 772.8,267.0 767.5,264.1" fill="none" stroke="#18181c" stroke-opacity="0.55" stroke-width="1.3"/><text x="785.0" y="271.0" fill="#18181c" fill-opacity="0.85" font-size="11" text-anchor="middle" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke">7/16</text><line x1="742.8" y1="275.2" x2="725.7" y2="292.3" stroke="#18181c" stroke-opacity="0.55" stroke-width="1.3"/><polyline points="727.3,286.6 725.7,292.3 731.4,290.7" fill="none" stroke="#18181c" stroke-opacity="0.55" stroke-width="1.3"/><text x="717.0" y="305.0" fill="#18181c" fill-opacity="0.85" font-size="11" text-anchor="middle" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke">3/16</text><line x1="751.0" y1="278.6" x2="751.0" y2="288.8" stroke="#18181c" stroke-opacity="0.55" stroke-width="1.3"/><polyline points="748.1,283.5 751.0,288.8 753.9,283.5" fill="none" stroke="#18181c" stroke-opacity="0.55" stroke-width="1.3"/><text x="751.0" y="305.0" fill="#18181c" fill-opacity="0.85" font-size="11" text-anchor="middle" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke">5/16</text><line x1="759.2" y1="275.2" x2="776.3" y2="292.3" stroke="#18181c" stroke-opacity="0.55" stroke-width="1.3"/><polyline points="770.6,290.7 776.3,292.3 774.7,286.6" fill="none" stroke="#18181c" stroke-opacity="0.55" stroke-width="1.3"/><text x="785.0" y="305.0" fill="#18181c" fill-opacity="0.85" font-size="11" text-anchor="middle" stroke="#ffffff" stroke-width="3" stroke-linejoin="round" paint-order="stroke">1/16</text><text x="632" y="136" fill="currentColor" fill-opacity="0.6" font-size="13">AT A PIXEL</text><text x="632" y="408" fill="currentColor" fill-opacity="0.6" font-size="14">round to black or white, then spill the error onward</text></g>
<script><![CDATA[
(function(){
var G=[[48, 58, 88, 96, 102, 103, 112, 111, 104, 123, 113, 104, 108, 110, 118, 100, 79, 98, 100, 106, 131, 88, 150, 176, 168, 132, 99, 126, 155, 164, 82, 38, 45, 17, 81, 167, 158, 177, 146, 135, 158, 195, 194, 108, 111, 156, 175, 170, 157, 135, 135, 170, 183, 156, 111, 63, 22, 16, 21, 15, 6, 8, 16, 15, 2, 54, 80, 72, 75, 77, 82, 93, 86, 86, 93, 92, 108, 98, 129, 168, 185, 187, 180, 179, 180, 179, 166, 160, 160, 150, 128, 135, 150, 159, 134, 131], [50, 58, 91, 100, 94, 106, 123, 105, 105, 122, 118, 100, 100, 104, 120, 84, 79, 99, 89, 99, 110, 86, 112, 140, 135, 97, 106, 83, 132, 131, 81, 39, 40, 10, 85, 193, 187, 176, 150, 170, 180, 185, 187, 123, 126, 168, 177, 169, 171, 172, 185, 181, 171, 147, 106, 50, 20, 14, 17, 16, 6, 8, 9, 20, 7, 29, 66, 54, 70, 77, 95, 106, 94, 92, 90, 86, 100, 104, 115, 148, 181, 173, 173, 174, 167, 163, 164, 165, 159, 153, 132, 136, 141, 156, 136, 131], [52, 66, 89, 94, 87, 90, 101, 98, 101, 101, 98, 100, 98, 87, 86, 82, 89, 92, 83, 71, 88, 80, 75, 93, 102, 93, 115, 76, 100, 100, 89, 38, 28, 10, 81, 190, 192, 205, 206, 203, 181, 195, 181, 143, 147, 179, 213, 215, 223, 215, 200, 176, 154, 130, 90, 43, 14, 15, 15, 16, 11, 11, 8, 19, 14, 19, 74, 74, 75, 76, 90, 94, 88, 85, 82, 76, 82, 81, 99, 136, 175, 178, 171, 171, 166, 159, 165, 169, 160, 149, 140, 154, 148, 141, 133, 136], [65, 91, 102, 90, 100, 100, 93, 98, 114, 107, 96, 84, 87, 101, 76, 76, 87, 95, 83, 73, 82, 76, 73, 74, 78, 88, 100, 69, 88, 81, 87, 47, 34, 13, 61, 169, 179, 197, 202, 195, 183, 210, 183, 144, 154, 177, 199, 201, 207, 196, 191, 165, 141, 114, 77, 34, 17, 21, 18, 22, 19, 16, 11, 18, 15, 19, 100, 92, 87, 81, 90, 87, 82, 85, 84, 71, 80, 80, 90, 107, 135, 155, 155, 161, 159, 160, 159, 159, 149, 143, 143, 141, 139, 134, 129, 136], [68, 116, 94, 66, 69, 90, 82, 79, 80, 92, 90, 75, 92, 99, 88, 72, 87, 81, 70, 73, 76, 70, 75, 75, 78, 80, 85, 71, 71, 64, 57, 43, 43, 32, 35, 159, 194, 197, 196, 188, 187, 204, 180, 145, 143, 174, 189, 195, 198, 190, 181, 154, 124, 100, 68, 31, 18, 17, 18, 22, 17, 17, 9, 15, 14, 20, 100, 112, 100, 123, 134, 130, 130, 134, 130, 137, 134, 132, 132, 131, 137, 143, 150, 147, 145, 146, 136, 136, 135, 130, 133, 138, 138, 136, 122, 113], [71, 98, 72, 61, 48, 76, 83, 81, 76, 84, 88, 81, 99, 105, 98, 92, 89, 80, 80, 67, 67, 70, 78, 74, 64, 68, 67, 66, 55, 53, 48, 37, 38, 25, 24, 134, 187, 189, 197, 181, 178, 206, 177, 147, 134, 167, 185, 187, 189, 179, 166, 141, 111, 88, 56, 26, 20, 17, 18, 23, 21, 12, 10, 9, 16, 14, 42, 58, 59, 65, 82, 93, 93, 94, 102, 101, 114, 128, 134, 137, 143, 148, 151, 149, 138, 123, 122, 104, 99, 130, 147, 138, 125, 129, 98, 92], [71, 96, 80, 65, 55, 76, 83, 81, 73, 84, 87, 78, 83, 92, 99, 93, 95, 94, 80, 78, 77, 87, 81, 80, 76, 74, 69, 62, 51, 40, 38, 41, 36, 17, 17, 105, 167, 188, 184, 158, 170, 218, 161, 130, 122, 149, 200, 185, 185, 167, 149, 123, 98, 82, 51, 28, 18, 22, 17, 22, 22, 10, 16, 10, 16, 22, 38, 51, 58, 55, 57, 71, 70, 76, 72, 73, 71, 75, 86, 105, 120, 113, 110, 113, 104, 95, 110, 85, 79, 95, 111, 87, 85, 88, 83, 94]],B=[[1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0], [1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0], [1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0], [1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1], [1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1], [1, 0, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0], [1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 0, 1, 1, 1, 1, 0, 1, 0, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1, 1, 1, 1]],SX=80,SW=300,NW=96,K=7,HK=3,DUR=5200,SY=44;
var d=document,cur=d.getElementById('ddCursor'),rev=d.getElementById('ddRevealRect'),
led=d.getElementById('ddLeader'),C=[];
for(var i=0;i<K;i++){C[i]=[];for(var j=0;j<K;j++){C[i][j]=d.getElementById('dd_c_'+i+'_'+j);}}
function E(t){return t<0.5?4*t*t*t:1-Math.pow(-2*t+2,3)/2;}
function upd(col){var c0=col-HK;for(var i=0;i<K;i++){for(var j=0;j<K;j++){var el=C[i][j];
if(!el)continue;var gc=c0+j,op=0,dec=(j<HK);
if(gc>=0&&gc<NW){op=dec?B[i][gc]:(1-G[i][gc]/255);}el.setAttribute('fill-opacity',op.toFixed(3));}}}
function fr(now){var ph=(now%DUR)/DUR,t=ph<0.5?E(ph*2):E((1-ph)*2),x=t*SW,cx=SX+x;
cur.setAttribute('transform','translate('+x.toFixed(2)+',0)');
rev.setAttribute('width',x.toFixed(2));
var col=Math.round(x/SW*NW);if(col<0)col=0;if(col>NW-1)col=NW-1;upd(col);
led.setAttribute('x1',cx.toFixed(2));requestAnimationFrame(fr);}
requestAnimationFrame(fr);
})();
]]></script>
</svg>
</div>

{.marginnote}The whole pipeline lives in [`process_image_for_thermal`](https://github.com/Twarner491/quotes/blob/main/src/app.py): greyscale, a nudge of contrast and sharpness for thermal paper, then the dither.{/.marginnote}

We're using Floyd-Steinberg for error diffusion, which is what Pillow uses under the hood when you `convert('1')`. Sweep the image one pixel at a time, at each pixel, round its grey value $v$ to whichever endpoint is closer

$$q = \begin{cases} 0 & v < 128 \\ 255 & v \ge 128, \end{cases}$$

... and you have made a rounding error $e = v - q$, the exact sliver of tone that one dot couldn't represent. Rather than discard it, Floyd-Steinberg spreads $e$ onto the neighbours it hasn't reached yet, weighted by proximity:

$$\frac{1}{16}\begin{bmatrix} & \ast & 7 \\ 3 & 5 & 1 \end{bmatrix}.$$

A pixel forced to white thus leaves its darkness behind as a debt the next pixels have to settle, tugging them toward black so the local average stays honest. Because the weights sum to one, $\tfrac{7 + 3 + 5 + 1}{16} = 1$, none of that brightness escapes the image; it only gets rearranged into the dot texture above. That small act of conservation is the whole trick, and it's why a couple hundred scattered dots still resolve into a face.

#### Printer Hacking

What fun is a whimsical apartment project if it doesn't look inconspicuous! To start, I removed the bottom of my [miemieyo Thermal Receipt Printer](https://www.amazon.com/dp/B0DFB82NPF?ref=ppx_pop_mob_ap_share) to get a better sense of the space we have to work with by removing the two screws under the printer, as well as the two within the paper tray.

<figure markdown="1">

![](../assets/images/quotes/noBackPrinter.JPG){ width="80%" }

</figure>

Unsurprisingly the internals of this receipt printer hardly fill the printer cavity, so retrofitting with our updated internals should be no problem at all. While the base piece that came on the machine has a suprisingly perfect cut out to fit a Raspberry Pi (almost like they were asking for this quote printer to be built), I opted to redesign the base of the printer entirly to allow for proper mounting of the stock printer mainboard, as well as the Raspberry Pi 5 and the [LM2596 Buck Converter](https://www.amazon.com/dp/B0DBVYP91F?ref=cm_sw_r_cso_cp_apin_dp_3M2S1XQWDF42DGM55ED8&ref_=cm_sw_r_cso_cp_apin_dp_3M2S1XQWDF42DGM55ED8&social_share=cm_sw_r_cso_cp_apin_dp_3M2S1XQWDF42DGM55ED8&titleSource=true&th=1) I'm using to power it.

<center>

<div class="embed-frame"><div class="embed-inner">
<iframe src="https://gmail5303747.autodesk360.com/shares/public/SH90d2dQT28d5b602811b204791807ac66bf?mode=embed" width="100%" height="650" allowfullscreen="true" webkitallowfullscreen="true" mozallowfullscreen="true"  frameborder="0"></iframe>
</div></div>

</center>

I printed this new base on my Prusa I3 MK3S+, cleaned it up, and then prepared the thermal printer for installation. This primarly involved unmounting and detaching all plugs from the mainboard to prepare to mount it to the new base. Additionally, I used some wire snippers to remove the old mainboard mounts (as pictured below)

<div class="figure-grid grid-2x1">
<img src="../../assets/images/quotes/finishedprint.JPG" alt="">
<img src="../../assets/images/quotes/cutpegs.JPG" alt="">
</div>

Then I started mounting components to the 3D printed baseplate, first the raspberry pi, then the buck converter.

<div class="figure-grid grid-2x1">
<img src="../../assets/images/quotes/mountedPi.JPG" alt="">
<img src="../../assets/images/quotes/mountedBuck.JPG" alt="">
</div>

Before continuing with the mainboard mounting, I wired the - IN terminal of the buck converter to the 24V in connector on the printer mainboard and the + IN to the printer power switch(note polarity below), and then used the potentiometer on the buck converter to set the output voltage to 5V.

<div class="figure-grid grid-2x1">
<img src="../../assets/images/quotes/solderedBuck.JPG" alt="">
<img src="../../assets/images/quotes/buckTuning.JPG" alt="">
</div>

I wired the +/- 5V output lines from the buck converter to the Raspberry Pi's GPIO, connected the printer mainboard to the Raspberry Pi via USB, and plugged in the printer mainboard's power (don't actually attach this to the wall yet, get everything mounted and closed up first) and then mounted the mainboard to the 3D printed baseplate (you'll need to plug in all the wires before mounting, its a tight fit).

<figure markdown="1">

![](../assets/images/quotes/mountedMainboard.JPG){ width="80%" }

</figure>

I then reattached the printer mainboard wires, 

<figure markdown="1">

![](../assets/images/quotes/wiredSystem.JPG){ width="40%" }

</figure>

... and attached the new base plate to the printer (wiggling all the wires into place to ensure nothing gets caught/clamped), reattached the screws in the paper tray, and finally, the screws under the printer. Amazing - the quote receipt printer is good to go!

<center>

<div class="embed-frame"><div class="embed-inner">
<iframe width="100%" height="650" src="https://www.youtube.com/embed/b8bMIGniOwY" title="First Quote Receipt Printer Test" frameborder="0" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
</div></div>

</center>

#### BOM

Building a quote receipt printer of your own is easy enough. The full project repo is at [github.com/Twarner491/quotes](https://github.com/Twarner491/quotes). Here's all you need:

<div class="bom-table" markdown>

| Qty | Description | Price | Link | Notes |
|-----|-------------|-------|------|-------|
| 1 | Thermal Receipt Printer 80mm | $65.99 | [Link](https://www.amazon.com/dp/B0DFB82NPF?ref=ppx_pop_mob_ap_share) | miemieyo |
| 1 | Thermal Paper 3-1/8" x 230' | $15.99 | [Link](https://www.amazon.com/dp/B0D14DYMHQ?ref=ppx_pop_mob_ap_share) | MPRT, 5 rolls |
| 1 | LM2596 Buck Converter | $7.99 | [Link](https://www.amazon.com/dp/B0DBVYP91F) | |
| 1 | Raspberry Pi 5 | $79.95 | [Link](https://www.raspberrypi.com/products/raspberry-pi-5/) | Any Pi model works |
| - | Spare Wire | - | - | |
| ∞ | Friends that say silly things | Free | [Link](https://apps.apple.com/us/app/find-my-friends/id466122094) | |
| | **Total** | **~$169.92** | | |

</div>

### Quotebook

This thing is so awesome. I've had some great fun printing out quotes this weekend and attached a few favorites below. I'll update this every once in a while as I log more silly things.

<div class="receipt-carousel-container">
  <div class="receipt-carousel">
    <div class="receipt-item">
      <img src="../../assets/images/quotes/receipts/IMG_7548.JPG" alt="Quote Receipt 16" class="receipt-image">
    </div>
    <div class="receipt-item">
      <img src="../../assets/images/quotes/receipts/IMG_7536.JPG" alt="Quote Receipt 4" class="receipt-image">
    </div>    
    <div class="receipt-item">
      <img src="../../assets/images/quotes/receipts/IMG_7540.JPG" alt="Quote Receipt 8" class="receipt-image">
    </div>
    <div class="receipt-item">
      <img src="../../assets/images/quotes/receipts/IMG_7533.JPG" alt="Quote Receipt 1" class="receipt-image">
    </div>
    <div class="receipt-item">
      <img src="../../assets/images/quotes/receipts/IMG_7534.JPG" alt="Quote Receipt 2" class="receipt-image">
    </div>
    <div class="receipt-item">
      <img src="../../assets/images/quotes/receipts/IMG_7535.JPG" alt="Quote Receipt 3" class="receipt-image">
    </div>
    <div class="receipt-item">
      <img src="../../assets/images/quotes/receipts/IMG_7537.JPG" alt="Quote Receipt 5" class="receipt-image">
    </div>
    <div class="receipt-item">
      <img src="../../assets/images/quotes/receipts/IMG_7538.JPG" alt="Quote Receipt 6" class="receipt-image">
    </div>
    <div class="receipt-item">
      <img src="../../assets/images/quotes/receipts/IMG_7539.JPG" alt="Quote Receipt 7" class="receipt-image">
    </div>
    <div class="receipt-item">
      <img src="../../assets/images/quotes/receipts/IMG_7541.JPG" alt="Quote Receipt 9" class="receipt-image">
    </div>
    <div class="receipt-item">
      <img src="../../assets/images/quotes/receipts/IMG_7542.JPG" alt="Quote Receipt 10" class="receipt-image">
    </div>
    <div class="receipt-item">
      <img src="../../assets/images/quotes/receipts/IMG_7543.JPG" alt="Quote Receipt 11" class="receipt-image">
    </div>
    <div class="receipt-item">
      <img src="../../assets/images/quotes/receipts/IMG_7544.JPG" alt="Quote Receipt 12" class="receipt-image">
    </div>
    <div class="receipt-item">
      <img src="../../assets/images/quotes/receipts/IMG_7545.JPG" alt="Quote Receipt 13" class="receipt-image">
    </div>
    <div class="receipt-item">
      <img src="../../assets/images/quotes/receipts/IMG_7546.JPG" alt="Quote Receipt 14" class="receipt-image">
    </div>
    <div class="receipt-item">
      <img src="../../assets/images/quotes/receipts/IMG_7547.JPG" alt="Quote Receipt 15" class="receipt-image">
    </div>
  </div>
</div>

Also, thermal printers are really wonderful pieces of technology. I was astonished by how quickly these things print, very low latency from silly quote being said to quote receipt in hand. To stress test, I decided to print the entire Bee Movie script.

<center>

<div class="embed-frame"><div class="embed-inner">
<iframe width="100%" height="650" src="https://www.youtube.com/embed/d4OV7coOji8" title="Bee Movie" frameborder="0" allow="autoplay; encrypted-media" referrerpolicy="strict-origin-when-cross-origin" allowfullscreen></iframe>
</div></div>

</center>

I hung the results like tinsel in my living room.

<figure markdown="1">

![](../assets/images/quotes/bms.JPG){ width="100%" }

</figure>

p.s. This "i before e except after c" shenanigans really throws me off. Apologies in advance for any "reciepts" left in this piece lol.

<div style="
  width: 100%;
  padding: 2rem 0;
  font-family: 'Courier New', monospace;
  text-align: center;
  line-height: 1.4;
  color: #333;
  margin: 2rem 0;
">
  <div style="
    margin-top: 2rem;
    padding-top: 1rem;
    border-top: 1px dashed var(--md-default-fg-color--light);
    max-width: 400px;
    margin-left: auto;
    margin-right: auto;
  ">
    <div style="
      font-weight: bold;
      text-decoration: underline;
      margin-bottom: 0.5rem;
      color: var(--md-default-fg-color);
    ">CERTIFIED STUPID</div>
    <div style="
      font-size: 0.8em;
      color: var(--md-default-fg-color--light);
      line-height: 1.3;
    ">
      No refunds. No context.<br>
      Memories printed. Dignity sold.
    </div>
  </div>
</div>

<script src="../../assets/js/reciepts.js"></script>

<script>
// Simple deferred iframe loading - no scroll lock
(function() {
  const observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        const iframe = entry.target;
        const src = iframe.dataset.src;
        if (src && !iframe.src) {
          iframe.src = src;
        }
        observer.unobserve(iframe);
      }
    });
  }, { rootMargin: '200px' });
  
  document.querySelectorAll('iframe[data-src]').forEach(iframe => {
    observer.observe(iframe);
  });
})();
</script>
