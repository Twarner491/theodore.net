---
title: Klipper Enabled Ender 3
description: As the name suggests, an Ender 3 with Klipper firmware.
keywords: Klipper, Ender 3, 3D Printer, Firmware, FluiddPi, Raspberry Pi, DIY, Printer modifications, Direct drive, Auto bed leveling, Custom firmware, 3D printing
thumbnail: /assets/images/KlipperEnder3/hero.png
date: 2021-05-01
date_modified: 2021-09-01
hide:
  - navigation
  - tags
template: comments.html
---

{.newthought}Due to uncertainty{/.newthought} surrounding lab access during the Covid-19 pandemic, I received an Ender 3 3D-printer at the start of my cycle in [Fab Academy](https://fabacademy.org/). During my [second week](http://fabacademy.org/2021/labs/charlotte/students/theodore-warner/Assignments/week02/) in the course, I built and began to mod this machine as a little side project to the course work. However as the cycle progressed, I quickly ran out of time to keep working on this machine's mods and moved the machine to my closet, where it sat up until the [Klipper](https://www.klipper3d.org/) firmware piqued my interest. After modding the printer during Fab Academy{.sidenote}[Fab Academy Week 2](http://fabacademy.org/2021/labs/charlotte/students/theodore-warner/Assignments/week02/){/.sidenote}, I was running the machine on Marlin linked to Octoprint{.sidenote}[Octoprint Project Page](https://theodore.net/projects/Octoprint/){/.sidenote}, a setup I use on my other machines. This setup worked great with my machine mods, allowing me to print over a network through Octoprint as I would on any of my other Octoprint enabled machines. In this configuration, a Raspberry Pi running Octorpint hosts a local server that *.gcode* flies can be uploaded to and ran from. The Pi sends this uploaded *.gcode* to the machine's mainboard, where the code is processed, and movements/operations are determined.

!!! abstract "Klipper Opperation Principal"

    [Klipper](https://www.klipper3d.org/) on the other hand operates on a different principle. The firmware runs across both the mainboard and the Raspberry Pi, allowing for the same type of hosted server to exist (I used [FluiddPi](https://github.com/cadriel/FluiddPI) as my servers GUI), but instead of relying on the machines mainboard to compute *.gcode*, the code parsing is done by the Raspberry Pi - the more powerful computer- leaving the machine mainboard to only worry about stepper movements and operations. This setup uses the given hardware of a setup more optimally, allowing for faster calculations and more precise movements.

  After learning about the benefits of [Klipper](https://www.klipper3d.org/) I knew I had to try it out and thus, the Ender 3 modding project was revied and pulled from the closet.

## Ender 3 Modding

 Before the installation of Klipper, here are all the hardware mods done to the machine. I upgraded the main bored from the original factory board to a [SKR Mini E3 V2](https://www.biqu.equipment/products/bigtreetech-skr-mini-e3-v2-0-32-bit-control-board-integrated-tmc2209-uart-for-ender-3), and the original factory screen I switched out to a [TFT35 Touchscreen](https://www.biqu.equipment/products/btt-tft35-e3-v3-0-display-touch-screen-two-working-modes?variant=31955093815394). Following that I added a [Bltouch](https://www.antclabs.com/bltouch) for auto bed leveling, and switched the machine from Bowen to direct drive, with this Thingiverse [design](https://www.thingiverse.com/thing:3856703). I spent some time adding some customization to the machine as well, giving the direct drive system a little nameplate.

<figure markdown="1">

![Direct drive system with custom nameplate on Ender 3](../assets/images/KlipperEnder3/directdrive.jpg){ width="70%" }

</figure>

Finally, I moved all of the electronics of the machine to the rear of the machine using this Thingiverse [design](https://www.thingiverse.com/thing:3688967). This mod gave the space to add a raspberry pi and a means of power for it in addition to the mainboard, a perfect case for a Klipper-enabled machine.

<div class="figure-grid grid-2x1">
<img src="../../assets/images/KlipperEnder3/electronicsenclouser.jpg" alt="Electronics enclosure at the rear of the Ender 3">
<img src="../../assets/images/KlipperEnder3/installedelebox.jpg" alt="Installed electronics box with Raspberry Pi and mainboard">
</div>

I used this Thingiverse [design](https://www.thingiverse.com/thing:2886101) to mount a raspberry pi camera to my printer's x-axis as shown in one of the pictures below. All of these modifications were done with parts printed on my [Prusa I3 Mk3S+](https://shop.prusa3d.com/en/3d-printers/181-original-prusa-i3-mk3s-3d-printer.html), and electronics I had laying around, making these printer modifications only take around three days to complete, including the time it took to print the parts.

<figure markdown="1">

![Raspberry Pi camera mounted on Ender 3's x-axis](../assets/images/KlipperEnder3/ender3cam.jpg){ width="80%" }

</figure>

![](../assets/images/KlipperEnder3/wholeprinter.jpg){: align=right width="30%" alt="Full view of the modified Ender 3 printer"}

## Klipper Installation

As mentioned in the introduction paragraph of this page, I settled on using [FluiddPi](https://github.com/cadriel/FluiddPI) as the GUI for this Klipper setup. As opposed to a more broadly know GUI like Octoprint, FluiddPi offers some features that work directly with Klipper that make the entire experience pretty seamless. [FluiddPi](https://github.com/cadriel/FluiddPI) in addition to containing the servers GUI also packages Klipper & Moonraker into the software image, making the install of Klipper super straightforward. 

<figure markdown="1">

[Download the Latest FluiddPi Image :fontawesome-solid-download:](https://github.com/cadriel/FluiddPI/releases/tag/v1.16.2){ .md-button .md-button--outlined }

</figure>

Beginning the installation of Klipper, the first step is to download and flash the latest [FluiddPi](https://github.com/cadriel/FluiddPI) image (linked above). This Pi image can be flashed as you would with any other Raspberry Pi project - I use [balenaEtcher](https://www.balena.io/etcher/) for flashing, its simple 3-step interface makes the process super straightforward. After a successful flash of this image on your Pi's SD card configure your WiFi information in the *fluiddpi-wpa-supplicant.txt* located on the flashed SD card *(If you're using wired internet, you can skip this setup)*. Then, you can install your flashed SD in your Pi and boot. 

Next, some basic Pi config. Make sure you are on the same WiFi network you set up your Pi on, and then SSH into your booted Pi at the IP *fluiddpi.local* with the Pi's default credentials (Username - *pi* / Password - *raspberry*). I use [Putty](https://www.putty.org/) as my SSH client as again, it's pretty straightforward to use. Once connected to your Pi, run the command ...

``` py 
sudo raspi-config
```

to open the configuration GUI. Here you can change your Pi's credentials (highly recommended), set up your local timezone (to allow for accurate machine ETAs), and change your machine's hostname (thus changing the URL from the default *fluiddpi.local* to *YOURHOSTNAME.local*). After all, changes, reboot your Pi and then confirm all software is up to date with the lines

``` py 
sudo apt-get update
sudo apt-get upgrade
```

!!! success "Congrats!"

    You have now successfully set up [FluiddPi](https://github.com/cadriel/FluiddPI) on your Raspberry Pi, and can now connect to its web server with the URL *http://fluiddpi.local* ( or if you changed your hostname, with the URL *http://YOURHOSTNAME.local*).

{.marginnote}The FluiddPi Web Server Interface{/.marginnote}

<figure markdown="1">

![FluiddPi web server interface for Klipper](../assets/images/KlipperEnder3/fluiddinterface.png){ width="95%" }

</figure>


Upon connection, the webserver will throw an error with a lack of a *printer.cfg* file. This file is your machine config file. Notably different from Marlin, Klipper does not require a machine to be specified before the flash but instead looks to this *printer.cfg* file for machine configuration. One of the benefits of using [FluiddPi](https://github.com/cadriel/FluiddPI) for Klipper is the ability to alter this *printer.cfg* file and reboot the firmware right from the server's GUI. The machine configuration for my Klipper Enabled Ender 3 is covered later on this page under the [Klipper Configuration](https://theodore.net/projects/KlipperEnder3/#klipper-configuration) section, but for any other machines, preconfigured *printer.cfg* files can be found online.

Next up, building Klipper to for machines mainboard. SSH back into your Raspberry Pi (making sure to change your IP to match your altered hostname if you changed it) and run the commands ...

``` py 
cd ~/klipper/
make menuconfig
```

to open the mainboard configuration GUI. Work through this interface with your mainboards information before running the command ...

``` py 
make
```

to build your set configurations. Now, connect your Pi and machine mainboard via USB and determine the connected serial port with the line

``` py 
ls /dev/serial/by-id/*
```

the report this line will yield provides the serial port that connects your mainboard to your Pi, take note of this.

Now, to begin the flashing, run the lines...

``` py 
sudo service klipper stop
make flash FLASH_DEVICE=YOUR-SERIAL-PORT-INFORMATION-HERE
sudo service klipper start
```

making sure to paste in the reported serial port where it says *YOUR-SERIAL-PORT-INFORMATION-HERE*. This will flash the built Klipper instance to your machine's mainboard, and then begin communication between the two parallel boards. 

!!! success "Good Work!"

     Klipper is now installed.

## Klipper Configuration

As mentioned prior, unlike the Marlin firmware, Klipper is not compiled for a specific machine. Instead, the firmware looks to a machine configuration file - *printer.cfg*. This file can be altered without the reflashing of the firmware, just a simple reboot, thus making machine tinkering and hardware swapping significantly simpler. This *printer.cfg* file can be altered in the [FluiddPi](https://github.com/cadriel/FluiddPI) web server interface, simplifying the configuration process even more. 

{.marginnote}FluiddPi's Configuration Menu in Web Server Interface{/.marginnote}

<figure markdown="1">

![FluiddPi configuration menu for printer.cfg file](../assets/images/KlipperEnder3/fluiddconfig.png){ width="95%" }

</figure>

As shown above, your *printer.cfg* file can be accessed in FluiddPi's configuration menu. Due to Klipper's ability to experiment with your machine config, my printer's configuration is always subject to change, but included below is the latest machine config running on my Klipper Enabled Ender 3.

<figure markdown="1">

### *printer.cfg*

</figure>

<div style="height:660px; overflow:scroll;">

  ```yaml  title="printer.cfg"
  # See docs/Config_Reference.md for a description of parameters.

  [virtual_sdcard]
  path: ~/gcode_files

  [display_status]

  [pause_resume]

  [stepper_x]
  step_pin: PB13
  dir_pin: !PB12
  enable_pin: !PB14
  microsteps: 16
  rotation_distance: 40
  endstop_pin: ^PC0
  position_endstop: 0
  position_max: 235
  homing_speed: 50

  [tmc2209 stepper_x]
  uart_pin: PC11
  tx_pin: PC10
  uart_address: 0
  run_current: 0.580
  hold_current: 0.500
  stealthchop_threshold: 999999

  [stepper_y]
  step_pin: PB10
  dir_pin: !PB2
  enable_pin: !PB11
  microsteps: 16
  rotation_distance: 40
  endstop_pin: ^PC1
  position_endstop: 0
  position_max: 235
  homing_speed: 50

  [tmc2209 stepper_y]
  uart_pin: PC11
  tx_pin: PC10
  uart_address: 2
  run_current: 0.580
  hold_current: 0.500
  stealthchop_threshold: 999999

  [stepper_z]
  step_pin: PB0
  dir_pin: PC5
  enable_pin: !PB1
  microsteps: 16
  rotation_distance: 8
  endstop_pin: probe:z_virtual_endstop
  #position_endstop: 0.0
  position_min: -5
  position_max: 250

  [tmc2209 stepper_z]
  uart_pin: PC11
  tx_pin: PC10
  uart_address: 1
  run_current: 0.580
  hold_current: 0.500
  stealthchop_threshold: 999999

  [extruder]
  step_pin: PB3
  dir_pin: !PB4
  enable_pin: !PD2
  microsteps: 16
  rotation_distance: 7.61
  pressure_advance = 0.235
  nozzle_diameter: 0.400
  filament_diameter: 1.750
  heater_pin: PC8
  sensor_type: EPCOS 100K B57560G104F
  sensor_pin: PA0
  #control: pid
  #pid_Kp: 21.527
  #pid_Ki: 1.063
  #pid_Kd: 108.982
  min_temp: 0
  max_temp: 250

  [tmc2209 extruder]
  uart_pin: PC11
  tx_pin: PC10
  uart_address: 3
  run_current: 0.650
  hold_current: 0.500
  stealthchop_threshold: 999999

  [heater_bed]
  heater_pin: PC9
  sensor_type: ATC Semitec 104GT-2
  sensor_pin: PC3
  #control: pid
  #pid_Kp: 54.027
  #pid_Ki: 0.770
  #pid_Kd: 948.182
  min_temp: 0
  max_temp: 130

  [heater_fan nozzle_cooling_fan]
  pin: PC7

  [fan]
  pin: PC6

  [mcu]
  serial: /dev/serial/by-id/usb-Klipper_stm32f103xe_36FFDB05424E313841781457-if00

  [printer]
  kinematics: cartesian
  max_velocity: 300
  max_accel: 3000
  max_z_velocity: 5
  max_z_accel: 100

  [static_digital_output usb_pullup_enable]
  pins: !PA14

  [board_pins]
  aliases:
      # EXP1 header
      EXP1_1=PB5,  EXP1_3=PA9,   EXP1_5=PA10, EXP1_7=PB8,  EXP1_9=<GND>,
      EXP1_2=PA15, EXP1_4=<RST>, EXP1_6=PB9,  EXP1_8=PB15, EXP1_10=<5V>

  [display]
  lcd_type: st7920
  cs_pin: EXP1_7
  sclk_pin: EXP1_6
  sid_pin: EXP1_8
  encoder_pins: ^EXP1_5, ^EXP1_3
  click_pin: ^!EXP1_2

  [bltouch]
  sensor_pin: ^PC2
  control_pin: PA1
  x_offset: 32
  y_offset: -2
  #z_offset = 3.050

  [safe_z_home]
  home_xy_position: 85.5,119.5
  speed: 75
  z_hop: 10                 
  z_hop_speed: 5

  [bed_mesh]
  speed: 120
  horizontal_move_z: 5
  mesh_min: 32,44
  mesh_max: 202, 220
  probe_count: 3,3

  [screws_tilt_adjust]
  screw1: 0,45
  screw1_name: front left screw
  screw2: 164,45
  screw2_name: front right screw
  screw3: 164,220
  screw3_name: rear right screw
  screw4: 0,220
  screw4_name: rear left screw
  horizontal_move_z: 10.
  speed: 50.
  screw_thread: CW-M4

  [gcode_macro PAUSE]
  description: Pause the actual running print
  rename_existing: PAUSE_BASE
  # change this if you need more or less extrusion
  variable_extrude: 1.0
  gcode:
    ##### read E from pause macro #####
    {% set E = printer["gcode_macro PAUSE"].extrude|float %}
    ##### set park positon for x and y #####
    # default is your max posion from your printer.cfg
    {% set x_park = printer.toolhead.axis_maximum.x|float - 5.0 %}
    {% set y_park = printer.toolhead.axis_maximum.y|float - 5.0 %}
    ##### calculate save lift position #####
    {% set max_z = printer.toolhead.axis_maximum.z|float %}
    {% set act_z = printer.toolhead.position.z|float %}
    {% if act_z < (max_z - 2.0) %}
        {% set z_safe = 2.0 %}
    {% else %}
        {% set z_safe = max_z - act_z %}
    {% endif %}
    ##### end of definitions #####
    PAUSE_BASE
    G91
    {% if printer.extruder.can_extrude|lower == 'true' %}
      G1 E-{E} F2100
    {% else %}
      {action_respond_info("Extruder not hot enough")}
    {% endif %}
    {% if "xyz" in printer.toolhead.homed_axes %}
      G1 Z{z_safe} F900
      G90
      G1 X{x_park} Y{y_park} F6000
    {% else %}
      {action_respond_info("Printer not homed")}
    {% endif %} 

  [gcode_macro RESUME]
  description: Resume the actual running print
  rename_existing: RESUME_BASE
  gcode:
    ##### read E from pause macro #####
    {% set E = printer["gcode_macro PAUSE"].extrude|float %}
    #### get VELOCITY parameter if specified ####
    {% if 'VELOCITY' in params|upper %}
      {% set get_params = ('VELOCITY=' + params.VELOCITY)  %}
    {%else %}
      {% set get_params = "" %}
    {% endif %}
    ##### end of definitions #####
    {% if printer.extruder.can_extrude|lower == 'true' %}
      G91
      G1 E{E} F2100
    {% else %}
      {action_respond_info("Extruder not hot enough")}
    {% endif %}  
    RESUME_BASE {get_params}

  [gcode_macro CANCEL_PRINT]
  description: Cancel the actual running print
  rename_existing: CANCEL_PRINT_BASE
  gcode:
    TURN_OFF_HEATERS
    CANCEL_PRINT_BASE

  [gcode_macro START_PRINT]
  gcode:
      {% set BED_TEMP = params.BED_TEMP|default(60)|float %}
      {% set EXTRUDER_TEMP = params.EXTRUDER_TEMP|default(190)|float %}
      # Start bed heating
      M140 S{BED_TEMP}
      # Use absolute coordinates
      G90
      # Reset the G-Code Z offset (adjust Z offset if needed)
      SET_GCODE_OFFSET Z=0.395
      # Home the printer
      G28
      # Move the nozzle
      G1 Z10 F3000
      G0 X10 Y0
      # Wait for bed to reach temperature
      M190 S{BED_TEMP}
      # Set and wait for nozzle to reach temperature
      M109 S{EXTRUDER_TEMP}

      G92 E0 ; reset extruder G1 Z1.0 F3000 ; move z up little to prevent scratching of surface
      G1 X0.1 Y20 Z0.395 F5000.0 ; move to start-line position
      G1 X0.1 Y200.0 Z0.395 F1500.0 E15 ; draw 1st line
      G1 X0.4 Y200.0 Z0.395 F5000.0 ; move to side a little
      G1 X0.4 Y20 Z0.395 F1500.0 E30 ; draw 2nd line
      G92 E0 ; reset extruder
      
  [gcode_macro END_PRINT]
  gcode:
      # Turn off bed, extruder, and fan
      M140 S0
      M104 S0
      M106 S0
      # Move nozzle away from print while retracting
      G91
      G1 X-2 Y-2 E-3 F300
      # Raise nozzle by 15mm
      G1 Z15 F3000
      # Present Print
      G90
      G1 X0 Y190 F6000
      G90
      # Disable steppers
      M84

  [gcode_macro M600]
  gcode:
      {% set X = params.X|default(50)|float %}
      {% set Y = params.Y|default(0)|float %}
      {% set Z = params.Z|default(10)|float %}
      SAVE_GCODE_STATE NAME=M600_state
      PAUSE
      G91
      G1 E-.8 F2700
      G1 Z{Z}
      G90
      G1 X{X} Y{Y} F3000
      G91
      G1 E-50 F1000
      RESTORE_GCODE_STATE NAME=M600_state

  #*# <---------------------- SAVE_CONFIG ---------------------->
  #*# DO NOT EDIT THIS BLOCK OR BELOW. The contents are auto-generated.
  #*#
  #*# [bed_mesh default]
  #*# version = 1
  #*# points =
  #*# 	  -0.160000, -0.305000, -0.365000
  #*# 	  0.107500, -0.015000, -0.337500
  #*# 	  0.097500, -0.020000, -0.162500
  #*# tension = 0.2
  #*# min_x = 32.0
  #*# algo = lagrange
  #*# y_count = 3
  #*# mesh_y_pps = 2
  #*# min_y = 44.0
  #*# x_count = 3
  #*# max_y = 220.0
  #*# mesh_x_pps = 2
  #*# max_x = 202.0
  #*#
  #*# [heater_bed]
  #*# control = pid
  #*# pid_kp = 63.826
  #*# pid_ki = 1.462
  #*# pid_kd = 696.505
  #*#
  #*# [extruder]
  #*# control = pid
  #*# pid_kp = 25.693
  #*# pid_ki = 1.338
  #*# pid_kd = 123.326
  #*#
  #*# [bltouch]
  #*# z_offset = 2.900
  ```

</div>

## Slicer Configuration

Check out my Klipper Enabled Ender 3 machine profile page, linked below, for information regarding the slicer setup & config, as well as my profile download.

<figure markdown="1">

[Klipper Enabled Ender 3 Profile](https://github.com/Twarner491/project-files/blob/main/PrusaSlicer%20Profiles/Klipper-Ender3-PrusaSlicer-Config.ini){ .md-button .md-button--primary }

</figure>