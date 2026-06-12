---
title: 8-bit Breadboard Computer
description: A dive into computer logic, and processor workings.
date: 2022-01-01
draft: true
keywords: 8-bit computer, Breadboard computer, Computer logic, Digital electronics, Ben Eater, Logic gates, Computer architecture, Digital circuits, Hardware engineering, Electronics projects, DIY computer, Processor design, Digital logic, Computer engineering, Hardware development
thumbnail: /assets/images/thumb.png
hide:
  - navigation
  - tags
template: comments.html
---

{.newthought}I've used microcontrollers{/.newthought} in most of my past projects. IC data sheets are super helpful in board design with their pinouts, but I've noticed much of the contents have been pretty foreign to me. Every once in a while, the youtube algorithm recommended one of [Ben Eater's](https://eater.net) computer concept videos to me, which provide a great explanation of the simplistic logic and proofs in computers. I ended up watching his entire [8-bit Breadboard Computer](https://eater.net/8bit) series (embedded below) over the fall of 2021, to try to get a bit of a better idea of the workings of a microcontroller. The computer is an "as simple as possible"{.sidenote}[https://eater.net/8bit](https://eater.net/8bit){/.sidenote} take on an 8-bit computer, using only simple logic to create an 8-bit computer on breadboards. The computer is built-in sectioned modules and then interfaced together, making each section a bit easier to swallow.

!!! abstract "Documentation Style"

    This page is a bit different than my other project pages, as it is a build log for my take on this [8-bit Breadboard Computer](https://eater.net/8bit). Instead of outlining project development (as Mr. Eaters' videos do an amazing job with that), this page will be a collection of media behind each of my computer modules, as well as some final programs ran on the computer.


## Bill of Materials

<div class="bom-table" markdown>

| Qty | Description | Cost | Link |
|-----|-------------|------|------|
| 14 | Breadboard | $112 | [link](https://amzn.to/4e7nOyh) |
| 10 | 1kΩ resistor | | :material-arrow-down-thin: |
| 9 | 10kΩ resistor | | :material-arrow-down-thin: |
| 1 | 100kΩ resistor | | :material-arrow-down-thin: |
| 24 | 470Ω resistor | | :material-arrow-down-thin: |
| 1 | 1MΩ resistor | $16.99 | [link](https://amzn.to/4e59YfU) |
| 1 | 1MΩ potentiometer | $1.39 | [link](https://www.jameco.com/webapp/wcs/stores/servlet/ProductDisplay?storeId=10001&langId=-1&catalogId=10001&productId=2161422&avad=234285_b24a928cd&source=Avantlink) |
| 6 | 0.01µF capacitor | $1.20 | [link](https://www.jameco.com/webapp/wcs/stores/servlet/ProductDisplay?storeId=10001&langId=-1&catalogId=10001&productId=15229&avad=234285_e24a83cb1&source=Avantlink) |
| 16 | 0.1µF capacitor | $3.00 | [link](https://www.jameco.com/webapp/wcs/stores/servlet/ProductDisplay?storeId=10001&langId=-1&catalogId=10001&productId=151116&avad=234285_f24a7e1b9&source=Avantlink) |
| 1 | 1µF capacitor | $0.15 | [link](https://www.jameco.com/webapp/wcs/stores/servlet/ProductDisplay?storeId=10001&langId=-1&catalogId=10001&productId=330431&avad=234285_c24a8fac5&source=Avantlink) |
| 4 | 555 timer IC | $0.63 | [link](https://www.aliexpress.com/item/32823042746.html?spm=a2g0o.productlist.0.0.2786782fopOSRM&algo_pvid=96d0349a-68b7-4336-988d-4738811be810&algo_exp_id=96d0349a-68b7-4336-988d-4738811be810-0&pdp_ext_f=%7B%22sku_id%22%3A%2264903037377%22%7D) |
| 2 | 74LS00 (Quad NAND gate) | $0.76 | [link](https://www.aliexpress.com/item/1005003103565042.html?spm=a2g0o.productlist.0.0.3a184f8baiaLU3&algo_pvid=07ae07c6-5f66-4969-989e-1b63359f0b36&algo_exp_id=07ae07c6-5f66-4969-989e-1b63359f0b36-0&pdp_ext_f=%7B%22sku_id%22%3A%2212000024102730486%22%7D) |
| 1 | 74LS02 (Quad NOR gate) | $0.76 | [link](https://www.aliexpress.com/item/1005003103565042.html?spm=a2g0o.productlist.0.0.3a184f8baiaLU3&algo_pvid=07ae07c6-5f66-4969-989e-1b63359f0b36&algo_exp_id=07ae07c6-5f66-4969-989e-1b63359f0b36-0&pdp_ext_f=%7B%22sku_id%22%3A%2212000024102730486%22%7D) |
| 5 | 74LS04 (Hex inverter) | $0.87 | [link](https://www.aliexpress.com/item/1005003103565042.html?spm=a2g0o.productlist.0.0.3a184f8baiaLU3&algo_pvid=07ae07c6-5f66-4969-989e-1b63359f0b36&algo_exp_id=07ae07c6-5f66-4969-989e-1b63359f0b36-0&pdp_ext_f=%7B%22sku_id%22%3A%2212000024102730486%22%7D) |
| 3 | 74LS08 (Quad AND gate) | $0.72 | [link](https://www.aliexpress.com/item/1005003103565042.html?spm=a2g0o.cart.0.0.faec3c00RQNoMs&mp=1) |
| 1 | 74LS32 (Quad OR gate) | $0.89 | [link](https://www.aliexpress.com/item/1005003103565042.html?spm=a2g0o.cart.0.0.faec3c00RQNoMs&mp=1) |
| 1 | 74LS107 (Dual JK flip-flop)<br><small>Note: The 74LS76 is hard to find. The 74LS107 is functionally equivalent but has a different pinout.</small> | $1.58 | [link](https://www.aliexpress.com/item/32837207073.html?spm=a2g0o.productlist.0.0.207015cbIMimMw&algo_pvid=c81f15db-70af-4c8a-b7f0-f3ad2aefd724&algo_exp_id=c81f15db-70af-4c8a-b7f0-f3ad2aefd724-0&pdp_ext_f=%7B%22sku_id%22%3A%2212000021439605652%22%7D) |
| 2 | 74LS86 (Quad XOR gate) | $1.11 | [link](https://www.aliexpress.com/item/1005003103565042.html?spm=a2g0o.cart.0.0.faec3c00RQNoMs&mp=1) |
| 1 | 74LS138 (3-to-8 line decoder) | $0.80 | [link](https://www.aliexpress.com/item/1005003102981081.html?spm=a2g0o.productlist.0.0.7d5673d7KhGF0Y&algo_pvid=c8b19dec-d621-4c22-9ff8-5dee7269a3cb&algo_exp_id=c8b19dec-d621-4c22-9ff8-5dee7269a3cb-0&pdp_ext_f=%7B%22sku_id%22%3A%2212000024100200959%22%7D) |
| 1 | 74LS139 (Dual 2-to-4 line decoder) | $1.55 | [link](https://www.aliexpress.com/item/32835244421.html?spm=a2g0o.productlist.0.0.3122402fsGGTYE&algo_pvid=3748f071-9375-479f-b6c5-85001b10ac54&algo_exp_id=3748f071-9375-479f-b6c5-85001b10ac54-0&pdp_ext_f=%7B%22sku_id%22%3A%2265146220182%22%7D) |
| 4 | 74LS157 (Quad 2-to-1 line selector) | $1.58 | [link](http://link/) |
| 2 | 74LS161 (4-bit synchronous binary counter) | $1.95 | [link](https://www.aliexpress.com/item/33020267124.html?spm=a2g0o.productlist.0.0.1677721es4x1SK&algo_pvid=d2780b90-5738-4546-b5de-5d6bb2d811c9&algo_exp_id=d2780b90-5738-4546-b5de-5d6bb2d811c9-1&pdp_ext_f=%7B%22sku_id%22%3A%2212000021439709306%22%7D) |
| 8 | 74LS173 (4-bit D-type register) | $1.45 | [link](https://www.aliexpress.com/item/33018650807.html?spm=a2g0o.productlist.0.0.14e742d1pRCGVb&algo_pvid=8a07540f-898b-486a-8838-56f791cd0250&algo_exp_id=8a07540f-898b-486a-8838-56f791cd0250-1&pdp_ext_f=%7B%22sku_id%22%3A%2267178993411%22%7D) |
| 2 | 74189 (64-bit RAM) | $9.90 | [link](https://www.jameco.com/webapp/wcs/stores/servlet/ProductDisplay?storeId=10001&langId=-1&catalogId=10001&productId=49883&avad=234285_e24a84fe5&source=Avantlink) |
| 6 | 74LS245 (Octal bus transceiver) | $1.26 | [link](https://www.aliexpress.com/item/1005001437010289.html?spm=a2g0o.productlist.0.0.2a9464edzJi9rC&algo_pvid=8b6dcbac-4a44-40e8-9cf1-13b00ce0ea20&algo_exp_id=8b6dcbac-4a44-40e8-9cf1-13b00ce0ea20-1&pdp_ext_f=%7B%22sku_id%22%3A%2212000016109356828%22%7D) |
| 1 | 74LS273 (Octal D flip-flop) | $1.99 | [link](https://www.aliexpress.com/item/32904754683.html?spm=a2g0o.productlist.0.0.103f6a156A0dsq&algo_pvid=a4d9d0cb-9b2a-49b2-aad8-2dc4b3f1ecc3&algo_exp_id=a4d9d0cb-9b2a-49b2-aad8-2dc4b3f1ecc3-1&pdp_ext_f=%7B%22sku_id%22%3A%2265797111425%22%7D) |
| 2 | 74LS283 (4-bit binary full adder) | $1.38 | [link](https://www.aliexpress.com/item/32903704766.html?spm=a2g0o.productlist.0.0.5be92163FIwyiz&algo_pvid=4123097d-3bbb-4234-b315-ca930c2e2f42&algo_exp_id=4123097d-3bbb-4234-b315-ca930c2e2f42-0&pdp_ext_f=%7B%22sku_id%22%3A%2212000021439617925%22%7D) |
| 3 | 28C16 EEPROM | $11.85 | [link](https://www.jameco.com/webapp/wcs/stores/servlet/ProductDisplay?storeId=10001&langId=-1&catalogId=10001&productId=74691&avad=234285_b24a93fbd&source=Avantlink) |
| 3 | Double-throw toggle switch | $2.97 | [link](https://www.jameco.com/webapp/wcs/stores/servlet/ProductDisplay?history=&catalogId=10001&langId=-1&freeText=2258831&storeId=10001&productId=2258831&avad=234285_f24a7f961&source=Avantlink) |
| 3 | Momentary 6mm tact switch | $1.05 | [link](https://www.jameco.com/webapp/wcs/stores/servlet/ProductDisplay?storeId=10001&langId=-1&catalogId=10001&productId=149948&avad=234285_b24a94221&source=Avantlink) |
| 1 | 8-position DIP switch | $0.79 | [link](https://www.jameco.com/webapp/wcs/stores/servlet/ProductDisplay?storeId=10001&langId=-1&catalogId=10001&productId=38842&avad=234285_f24a7fa49&source=Avantlink) |
| 1 | 4-position DIP switch | $0.79 | [link](https://www.jameco.com/webapp/wcs/stores/servlet/ProductDisplay?storeId=10001&langId=-1&catalogId=10001&productId=38820&avad=234285_e24a855bd&source=Avantlink) |
| 44 | Red LED | | :material-arrow-down-thin: |
| 8 | Yellow LED | | :material-arrow-down-thin: |
| 12 | Green LED | | :material-arrow-down-thin: |
| 21 | Blue LED | $12.99 | [link](https://amzn.to/4xs9bNF) |
| 4 | Common cathode 7-segment display | $4.36 | [link](https://www.jameco.com/z/UA5651-11-R-Jameco-Valuepro-LED-Display-7-Segment-Red-0-56-Inch-Common-Anode-RHDP-0-8mcd_335090.html?CID=MERCH) |
| 1 | 22 AWG Solid Tinned-Copper Hook-Up Wire | $29.95 | [link](https://www.adafruit.com/product/3174?gclid=Cj0KCQjww4OMBhCUARIsAILndv4TcRmMF-8TiYvh74DqYKzl6-iRXDQZRWgg_geBEG7LG3p2uWDhGiQaAlhYEALw_wcB) |
| | **Total** | **$228.66** | |

</div>



## Clock Module



<figure markdown="1">

![Setup of astable circuit](../assets/images/8-bitComputer/setastable.jpg){ width="80%" }

</figure>



<figure markdown="1">

![Oscilloscope display showing clock vs capacitor waveforms](../assets/images/8-bitComputer/555wave.jpg){ width="100%" }

</figure>

Clock vs Capacitor

<figure markdown="1">

![Variable astable multivibrator circuit setup](../assets/images/8-bitComputer/variableastable.jpg){ width="80%" }

</figure>



<figure markdown="1">

![Monostable multivibrator circuit setup](../assets/images/8-bitComputer/monostable.jpg){ width="80%" }

</figure>









<figure markdown="1">

![Completed clock module assembly](../assets/images/8-bitComputer/clockmodule.jpg){ width="100%" }

</figure>



## Registers





<figure markdown="1">

![8-bit register module assembly](../assets/images/8-bitComputer/8-BitRegister.jpg){ width="100%" }

</figure>





## Arithmetic Logic Unit (ALU)







## Random Access Memory Module (RAM)







## Program Counter



## Output Register









## Module Meshing

## CPU Control Logic

### Fibonacci Sequence

{.marginfigure}![Fibonacci spiral](../assets/images/8-bitComputer/Fibonaccisequencespiral.png)
The Fibonacci spiral — each square's side length is a Fibonacci number.{/.marginfigure}

$$F_n = \frac{1}{\sqrt{5}} \left( \left( \frac{1 + \sqrt{5}}{2} \right)^n - \left( \frac{1 - \sqrt{5}}{2} \right)^n \right)$$

**First 12 Numbers in the Fibonacci Sequence**


| n   | Fibonacci Number |
| --- | ---------------- |
| 0   | 0                |
| 1   | 1                |
| 2   | 1                |
| 3   | 2                |
| 4   | 3                |
| 5   | 5                |
| 6   | 8                |
| 7   | 13               |
| 8   | 21               |
| 9   | 34               |
| 10  | 55               |
| 11  | 89               |