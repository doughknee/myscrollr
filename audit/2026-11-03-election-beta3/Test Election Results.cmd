@echo off
node "%~dp0tester.mjs" --fresh
if errorlevel 1 pause
