@echo off
powershell -ExecutionPolicy Bypass -File "%~dp0build-oem-dtc.ps1" > "%~dp0..\data\dtc\oem\build-output.txt" 2>&1
echo EXIT=%ERRORLEVEL%>> "%~dp0..\data\dtc\oem\build-output.txt"
