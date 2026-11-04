@echo off
node "%~dp0tester.mjs" --national --live
if errorlevel 1 pause
