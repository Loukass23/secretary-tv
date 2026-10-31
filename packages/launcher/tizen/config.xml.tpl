<?xml version="1.0" encoding="UTF-8"?>
<!-- Filled by tv-kit's tizen.mjs package from .env.tizen. Add a privilege only with the feature that uses it. -->
<widget xmlns="http://www.w3.org/ns/widgets" xmlns:tizen="http://tizen.org/ns/widgets" id="http://secretary-tv.local/launcher" version="{{VERSION}}" viewmodes="maximized">
  <name>Secretary Nest</name>
  <icon src="icon.png"/>
  <content src="index.html"/>
  <feature name="http://tizen.org/feature/screen.size.all"/>
  <tizen:application id="{{PACKAGE_ID}}.Launcher" package="{{PACKAGE_ID}}" required_version="9.0"/>
  <tizen:profile name="tv-samsung"/>
  <tizen:setting screen-orientation="landscape" context-menu="disable" background-support="disable" encryption="disable" install-location="auto" hwkey-event="enable"/>
  <tizen:privilege name="http://tizen.org/privilege/internet"/>
  <tizen:privilege name="http://tizen.org/privilege/application.launch"/>
  <tizen:privilege name="http://tizen.org/privilege/application.info"/>
  <tizen:privilege name="http://tizen.org/privilege/tv.inputdevice"/>
  <access origin="*" subdomains="true"/>
</widget>
