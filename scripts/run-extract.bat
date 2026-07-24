@echo off
python "%~dp0extract-docx.py"
type "%~dp0..\docs\obd-research-extract.txt"
