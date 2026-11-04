@echo off
node "%~dp0tester.mjs" --live
if errorlevel 1 pause
