---
title: Octoprint Setup
description: A complete Octoprint setup documentation.
keywords: Octoprint, 3D Printing, Raspberry Pi, Print server, Remote printing, Print monitoring, Web interface, Print farm, Printer control, Plugin configuration, Network printing
thumbnail: /assets/images/Octoprint/laboctoprint.jpg
date: 2021-09-01
date_modified: 2023-11-15
hide:
  - navigation
  - tags
template: comments.html
---

{.newthought}[Octoprint](https://octoprint.org/) takes 3D printing{/.newthought} to new heights, creating a more concise workflow with more accessible machine control. The opensource [Octoprint project](https://github.com/OctoPrint/OctoPrint) was created and maintained by [Gina Häußge](https://octoprint.org/support-octoprint/). The software enables a machine with a web interface with full machine controls and a world of community plugins - all of which run on a Raspberry Pi made Server with an octoprint image. I use Octoprint on all of my personal printers, and a special CNC-focused fork of the software for my [MPCNC](https://www.v1engineering.com/). As mentioned above, web interfacing a machine creates a more concise workflow and thus is great for personal machines. However, an Octoprint setup shines even more in a print farm instance. During the winter months of my sophomore year (2020) I set up secure Octoprint instances on each of my lab's array of 20 FDM printers. Each of my setup instances can be read seen under the [My Octoprint Instances](https://theodore.net/projects/Octoprint/#my-octoprint-instances) section of this page. 

## Octoprint Installation

!!! abstract "[Octoprint](https://octoprint.org/) Installation Requirements"

    You'll need a Raspberry Pi *(Recommended hardware: Raspberry Pi 3B, 3B+ or 4B)*, a sufficient power source for the Pi, as well as a micro SD card *(4GB or larger)* to flash the Octorpint image to.

<figure markdown="1">

[Download the Latest Octopi Image :fontawesome-solid-download:](https://github.com/guysoft/OctoPi){ .md-button .md-button--primary }

</figure>

First, download and flash the latest [Octoprint](https://octoprint.org/) image (linked above). This Pi image can be flashed as you would with any other Raspberry Pi project - I use [balenaEtcher](https://www.balena.io/etcher/) for flashing, its simple 3-step interface makes the process super straightforward. After a successful flash of this image on your Pi's SD card configure your WiFi information in the *octopi-wpa-supplicant.txt* located on the flashed SD card *(If you're using wired internet, you can skip this setup)*. To update the *octopi-wpa-supplicant.txt* file with your network, open the file in a code editor of your choice.

!!! warning "Do not use WordPad (Windows) or TextEdit (MacOS X)"

    These editors will mess with the file layout, and cause problems with your setup.

 Next, locate the type of network you'll be connecting to - for this example, I'll be using the *WPA/WPA2 Secured* standard, 

``` c++
## WPA/WPA2 secured
#network={
#  ssid="put SSID here"
#  psk="put password here"
#}
```

for any type of connection you choose, you can enable it by uncommenting the sections lines with a single hashtag, leaving you with a block like below.

``` c++
## WPA/WPA2 secured
network={
  ssid="put SSID here" // (1)
  psk="put password here" // (2)
}
```

1.  Replace *"put SSID here"* with your network's SSID.
2.  Replace *"put password here"* with your network's password.

Next, scroll down to the bottom of the document to the section starting *"# Uncomment the country your Pi is in..."*. Here, remove the hashtag in front of your network's country, and add a hashtag in front of all other (non-selected) countries.

Then, after saving your file and ejecting your SD, you can install your flashed SD in your Pi and boot.

Next, some basic Pi config. Make sure you are on the same WiFi network you set up your Pi on, and then SSH into your booted Pi at the IP *octopi.local* with the Pi's default credentials (Username - *pi* / Password - *raspberry*). I use [Putty](https://www.putty.org/) as my SSH client as again, it's pretty straightforward to use. Once connected to your Pi, run the command ...

``` py linenums="1"
sudo raspi-config
```

to open the configuration GUI. Here you can change your Pi's credentials (highly recommended), set up your local timezone (to allow for accurate machine ETAs), and change your machine's hostname (thus changing the URL from the default *octopi.local* to *YOURHOSTNAME.local*). After all, changes, be sure to reboot your Pi.

!!! success "Congrats!"

    You have now installed [Octoprint](https://octoprint.org/) on your Raspberry Pi, and can now connect to its web server with the URL *http://octopi.local* ( or if you changed your hostname, with the URL *http://YOURHOSTNAME.local*).

## Octoprint Configuration

With an Octoprint instance up and running, the difficult part of the setup is complete. Access to the web interface allows for easy machine and interface setup, in addition to some more customizations in the form of community plug-ins.

### Interface Config

Beginning with the configuration of the interface itself, basic settings can be found in the web interface by clicking on the wrench icon on the right side of the navigation bar located at the top of the interface. Scrolling through these menus allows for total customization of the interface. A good starting place is under the *Octoprint* section in the *Appearance* menu. Here (as shown below) you can customize the interface title - displayed in the interface's navigation bar, as well as the default interface highlight color.

<figure markdown="1">

![Octoprint appearance settings menu](../assets/images/Octoprint/AppearanceSettings.png){ width="95%" }

</figure>

### Printer Setup

To enable Octoprint's main purpose, a machine must be connected to the hardware running Octoprint via serial. This connection can come in the form of a USB cable in the simplest setup, or GPIO pins can be used for communication as well. 

!!! example "Personal Setup"

    In the case of my Prusa I3 MK3S+, I took advantage of this GPIO communication setup, to allow for the mounting of my Raspberry Pi directly under my printer's mainboard (via [this](https://www.prusaprinters.org/prints/24475-remix-of-raspberry-pi-4-case-3030-hanging-mount-fo) Raspberry Pi 4 Case) without a bulky USB cable connecting them ...
<figure markdown="1">

![Raspberry Pi mounted under printer mainboard using 3030 mount](../assets/images/Octoprint/mountedelectronics.jpg){ width="95%" }

</figure>


Your serial connection must be set up software side in the *Serial Connection* menu found under the *Printer* section of the interface settings. Octoprint can automatically detect your *Serial Port* and *Baudrate* when *AUTO* is selected in these dropdowns, however, you may also specify specifics for each field.

<figure markdown="1">

![Serial connection settings for printer configuration](../assets/images/Octoprint/serialconnection.png){ width="95%" }

</figure>

Next, a machine profile must be created for your connected machine to ensure safe machine control with regard to hardware limits. A profile can be created in the *Printer Profiles* menu under the *Printer* section of the interface's settings. Create a new profile by clicking the *Add Profile...* button in the lower right corner of the menu, and fill out the profile with your machine's information.

<figure markdown="1">

![Printer profiles configuration menu](../assets/images/Octoprint/printerpofiles.png){ width="95%" }

</figure>

One key feature of Octoprint is its webcam machine stream, allowing for remote supervision of your machine. Anything from USB webcams to Raspberry Pi ribbon cable cameras can be used for this stream & Octoprint will automatically find this attached webcam and will use it to stream your machine (some more exotic cameras or mounting styles may require an additional configuration - discussed below). 

!!! example "Personal Setup"

    On my printer, I've mounted a Raspberry Pi camera to the X-Axis stepper of my machine (via [this](https://www.thingiverse.com/thing:3121052) Raspberry Pi camera mount), yielding a pretty nice side view of prints, shown below.
<div class="figure-grid grid-2x1">
<img src="../../assets/images/Octoprint/cameramount.png" alt="Raspberry Pi camera mounted to X-axis stepper motor">
<img src="../../assets/images/Octoprint/CameraWindow.png" alt="Octoprint webcam feed showing side view of print">
</div>

Due to my printers camera mount, my Raspberry Pi camera is heald in an upsidedown orientation and thus needs to be compensated for on the software side. Luckily, in the *Webcam & Timelapse* menu under the *Features* section of the Octorprint interface settings, webcam orientation can be changed. In addition, more advanced webcam options can be found, allowing for the use of almost all cameras connected to the hardware running Octorpint.

<figure markdown="1">

![Webcam and timelapse settings configuration](../assets/images/Octoprint/webcamsettings.png){ width="95%" }

</figure>

### Plugins

One of the greatest features of Octorpint stems from its open-source nature ... its community plugins. Under the *Plugin Manager* menu in the *Octoprint* section of the interface's settings, plugins can be added to the octoprint instance, allowing for entire customization of the instance from the interface to machine interaction. There are tons upon tons of plugins that exist in the Octorprint community, and you may even develop your own, however below is a list of plugins I find to be amazing additions to an instance 

!!! note "Note" 

    Some of these shown plugins are machine specific to my Prusa I3 MK3S+

<figure markdown="1">

![Plugin manager showing installed plugins](../assets/images/Octoprint/pluginsettings.png){ width="95%" }

</figure>

 - Access Anywhere - The Spaghetti Detective{.sidenote}[The Spaghetti Detective Plugin](https://plugins.octoprint.org/plugins/thespaghettidetective/){/.sidenote} - AI-powered failure detection & Remote Octoprint Access 

<div class="figure-grid grid-3x1">
<img src="../../assets/images/Octoprint/homescreen.jpg" alt="The Spaghetti Detective home interface">
<img src="../../assets/images/Octoprint/tsdapp.jpg" alt="The Spaghetti Detective mobile app interface">
<img src="../../assets/images/Octoprint/tsdcontrol.jpg" alt="The Spaghetti Detective printer control interface">
</div>

 - Bed Visualizer{.sidenote}[Bed Visualizer Plugin](https://plugins.octoprint.org/plugins/bedlevelvisualizer/){/.sidenote} - Uses Plotly js library to render a 3D surface of the bed’s reported mesh 
 
<figure markdown="1">

![Bed visualizer showing mesh leveling data in 3D](../assets/images/Octoprint/bedlevlevisualizer.png){ width="95%" }

</figure>

 - Custom Background{.sidenote}[Custom Background Plugin](https://plugins.octoprint.org/plugins/custombackground/){/.sidenote} - Change the background image on the temperature graph 

<figure markdown="1">

![Custom background image on temperature graph](../assets/images/Octoprint/custombackground.png){ width="95%" }

</figure>

 - Exclude Region{.sidenote}[plugins.octoprint.org: excluderegion](https://plugins.octoprint.org/plugins/excluderegion/){/.sidenote} - Adds the ability to prevent printing within rectangular or circular regions of the currently active gcode file 

<figure markdown="1">

![Exclude region configuration menu](../assets/images/Octoprint/excluderegions.png){ width="95%" }

</figure>

 - Floating Navbar{.sidenote}[plugins.octoprint.org: floatingnavbar](https://plugins.octoprint.org/plugins/floatingnavbar/){/.sidenote} - Make the navbar stick to the top of the page while scrolling
 - GcodeEditor{.sidenote}[plugins.octoprint.org: GcodeEditor](https://plugins.octoprint.org/plugins/GcodeEditor/){/.sidenote} - Edit gcode that's been uploaded to OctoPrint

<div class="figure-grid grid-2x1">
<img src="../../assets/images/Octoprint/edit_gcode.png" alt="Gcode editor interface">
<img src="../../assets/images/Octoprint/edit_gcode2.png" alt="Gcode editor interface">
</div>

 - Heater Timeout{.sidenote}[plugins.octoprint.org: HeaterTimeout](https://plugins.octoprint.org/plugins/HeaterTimeout/){/.sidenote} - Automatically shut off heaters if no print has been started
 - Navbar Temp{.sidenote}[plugins.octoprint.org: navbartemp](https://plugins.octoprint.org/plugins/navbartemp/){/.sidenote} - Display temperatures on the navbar

<figure markdown="1">

![Navbar temperature display](../assets/images/Octoprint/navbar.png){ width="100%" }

</figure>

 - Octoprint Display ETA{.sidenote}[plugins.octoprint.org: display_eta](https://plugins.octoprint.org/plugins/display_eta/){/.sidenote} - Show finish time (ETA) for current print

<figure markdown="1">

![](../assets/images/Octoprint/eta.png)

</figure>

 - PrettyGCode{.sidenote}[plugins.octoprint.org: prettygcode](https://plugins.octoprint.org/plugins/prettygcode/){/.sidenote} - adds a 3D GCode visualizer tab in Octoprint

<figure markdown="1">

![PrettyGCode 3D GCode visualizer tab](../assets/images/Octoprint/PrettyGcode-Screen3.jpg){ width="75%" }

</figure>

 - Themeify{.sidenote}[plugins.octoprint.org: themeify](https://plugins.octoprint.org/plugins/themeify/){/.sidenote} - Beautiful themes for octoprint
 - ipOnConnect{.sidenote}[plugins.octoprint.org: ipOnConnect](https://plugins.octoprint.org/plugins/ipOnConnect/){/.sidenote} - Display the ip address of the connected OctoPrint instance on the control panel *:warning: MK3S+ specific*

<figure markdown="1">

![IP address display on control panel](../assets/images/Octoprint/ipdisplay.jpg){ width="95%" }

</figure>

## Octoprint Interface Workflow

Although the Octoprint web interface is rather intuitive, the number of stock features (not to mention plugin-enabled ones) can be a bit overwhelming without a bit of exploring. Below is a short PowerPoint I put together walking through the basics of the interface for students using my lab print farm, allowing for a bit of knowledge before exploration.

<div class="embed-frame"><div class="embed-inner">
<iframe src="https://docs.google.com/presentation/d/e/2PACX-1vR6_FehCcFtgrH6KYo5DuwZ3WEcFPoPesZBn_naPUVLJ-wylwF8p8eu6KqsSV9Zz71wESnbA-aIAoqa/embed?start=false&loop=false&delayms=5000" frameborder="0" width="100%" height="550" allowfullscreen="true" mozallowfullscreen="true" webkitallowfullscreen="true"></iframe>
</div></div>

## My Octoprint Instances

{.marginnote}My Personal Octoprint Enabled Prusa I3 MK3S+{/.marginnote}

{.marginnote}My Lab's Octoprint Enabled Printer Farm{/.marginnote}

<div class="figure-grid grid-2x1">
<img src="../../assets/images/Octoprint/personaloctoprint.jpg" alt="Personal Octoprint enabled Prusa I3 MK3S+">
<img src="../../assets/images/Octoprint/laboctoprint.jpg" alt="Lab's Octoprint enabled printer farm">
</div>