<?xml version="1.0" encoding="UTF-8"?>
<!-- Filled by scripts/tizen.mjs package from .env.tizen. Add a privilege only with the phase that uses it. -->
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" id="http://secretary-tv.local/movies" version="{{VERSION}}" viewmodes="maximized">
  <name>Secretary Cinema</name>
  <icon src="icon.png"/>
  <content src="index.html"/>
  <feature name="http://tizen.org/feature/screen.size.all"/>
  <tizen:application id="{{PACKAGE_ID}}.Movies" package="{{PACKAGE_ID}}" required_version="9.0"/>
  <tizen:profile name="tv-samsung"/>
  <tizen:setting screen-orientation="landscape" context-menu="disable" background-support="disable" encryption="disable" install-location="auto" hwkey-event="enable"/>
  <tizen:privilege name="http://tizen.org/privilege/internet"/>
  <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
  <tizen:privilege name="http://tizen.org/privilege/application.launch"/>
  <!-- webapis.productinfo.isUdPanelSupported: the 4K cap providers are told (catalog-kit/lib/device.ts). -->
  <tizen:privilege name="http://developer.samsung.com/privilege/productinfo"/>
  <access origin="*" subdomains="true"/>
</widget>
