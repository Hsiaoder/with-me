@echo off
chcp 65001 >nul
title MOUSE-OWNER LIVE  (winprobe follow)
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0winprobe.ps1" follow
